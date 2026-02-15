import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { DEFAULT_ACCT_EVENTS } from '../../../config/manifests/events.manifest';
import { DEFAULT_JOURNAL_TEMPLATES } from '../../../config/manifests/journal-templates.manifest';

const DEPOSIT_REJECTED_EVENT_CODES = [
  'EVT_DEPOSIT_REJECTED__CRYPTO',
  'EVT_DEPOSIT_REJECTED__FIAT',
] as const;

const DEPOSIT_EVENT_EXPECTED_TO_STATUS: Record<string, string> = {
  EVT_DEPOSIT_CONFIRMED__CRYPTO: 'COMPLIANCE_PENDING',
  EVT_DEPOSIT_CONFIRMED__FIAT: 'COMPLIANCE_PENDING',
  EVT_DEPOSIT_SUCCESS__CRYPTO: 'SUCCESS',
  EVT_DEPOSIT_SUCCESS__FIAT: 'SUCCESS',
};

type DepositEventContractValidation = {
  ok: boolean;
  issues: string[];
};

@Injectable()
export class AcctConfigService implements OnModuleInit {
  private readonly logger = new Logger(AcctConfigService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    const env = (process.env.NODE_ENV || 'development').toLowerCase();
    const syncOnBoot =
      (process.env.ACCT_CONFIG_SYNC_ON_BOOT || '').trim().toLowerCase() ===
      'true';

    if (env === 'production') {
      const validation = await this.validateDepositEventContract();
      if (!validation.ok) {
        this.logger.warn(
          `Deposit accounting event contract mismatch detected (production check-only): ${validation.issues.join(' | ')}`,
        );
      } else {
        this.logger.log(
          'Deposit accounting event contract check passed (production mode).',
        );
      }
      return;
    }

    if (!syncOnBoot) {
      this.logger.log(
        'Skip accounting default auto-sync on boot (set ACCT_CONFIG_SYNC_ON_BOOT=true to enable).',
      );
      try {
        const validation = await this.validateDepositEventContract();
        if (!validation.ok) {
          this.logger.warn(
            `Deposit accounting event contract mismatch detected (non-production check-only): ${validation.issues.join(' | ')}`,
          );
        }
      } catch (error: any) {
        this.logger.error(
          `Failed to validate accounting config on startup: ${error?.message || String(error)}`,
        );
      }
      return;
    }

    try {
      await this.syncDefaults();
      const validation = await this.validateDepositEventContract();
      if (!validation.ok) {
        this.logger.warn(
          `Deposit accounting event contract mismatch detected after sync: ${validation.issues.join(' | ')}`,
        );
      }
    } catch (error: any) {
      this.logger.error(
        `Failed to auto-sync accounting defaults on startup: ${error?.message || String(error)}`,
      );
    }
  }

  private async cleanupRejectedDepositEvents() {
    try {
      await (this.prisma as any).journalHeaderTemplate.deleteMany({
        where: { eventCode: { in: [...DEPOSIT_REJECTED_EVENT_CODES] } },
      });
    } catch (error: any) {
      this.logger.warn(
        `Failed to delete rejected deposit templates, fallback to inactivate: ${error?.message || String(error)}`,
      );
      await (this.prisma as any).journalHeaderTemplate.updateMany({
        where: { eventCode: { in: [...DEPOSIT_REJECTED_EVENT_CODES] } },
        data: { status: 'INACTIVE' },
      });
    }

    try {
      await (this.prisma as any).acctEvent.deleteMany({
        where: { eventCode: { in: [...DEPOSIT_REJECTED_EVENT_CODES] } },
      });
    } catch (error: any) {
      this.logger.warn(
        `Failed to delete rejected deposit events, fallback to deactivate: ${error?.message || String(error)}`,
      );
      await (this.prisma as any).acctEvent.updateMany({
        where: { eventCode: { in: [...DEPOSIT_REJECTED_EVENT_CODES] } },
        data: { isActive: false },
      });
    }
  }

  private async validateDepositEventContract(): Promise<DepositEventContractValidation> {
    const issues: string[] = [];
    const expectedEventCodes = Object.keys(DEPOSIT_EVENT_EXPECTED_TO_STATUS);

    const rows: Array<{
      eventCode: string;
      triggerType: string | null;
      triggerKey: string | null;
      fromStatus: string | null;
      toStatus: string | null;
      isActive: boolean;
    }> = await (this.prisma as any).acctEvent.findMany({
      where: {
        eventCode: {
          in: [...expectedEventCodes, ...DEPOSIT_REJECTED_EVENT_CODES],
        },
      },
      select: {
        eventCode: true,
        triggerType: true,
        triggerKey: true,
        fromStatus: true,
        toStatus: true,
        isActive: true,
      },
    });

    const byCode = new Map<string, (typeof rows)[number]>(
      rows.map((row) => [row.eventCode, row]),
    );

    for (const eventCode of expectedEventCodes) {
      const row = byCode.get(eventCode);
      if (!row) {
        issues.push(`${eventCode} missing`);
        continue;
      }
      if (!row.isActive) {
        issues.push(`${eventCode} inactive`);
      }
      if (row.triggerType !== 'STATUS_TRANSITION') {
        issues.push(`${eventCode} triggerType=${row.triggerType}`);
      }
      if (row.triggerKey !== 'status') {
        issues.push(`${eventCode} triggerKey=${row.triggerKey}`);
      }
      if (row.fromStatus !== null) {
        issues.push(`${eventCode} fromStatus expected NULL but got ${row.fromStatus}`);
      }
      if (row.toStatus !== DEPOSIT_EVENT_EXPECTED_TO_STATUS[eventCode]) {
        issues.push(
          `${eventCode} toStatus expected ${DEPOSIT_EVENT_EXPECTED_TO_STATUS[eventCode]} but got ${row.toStatus}`,
        );
      }
    }

    for (const rejectedEventCode of DEPOSIT_REJECTED_EVENT_CODES) {
      if (byCode.has(rejectedEventCode)) {
        issues.push(`${rejectedEventCode} should be removed`);
      }
    }

    return { ok: issues.length === 0, issues };
  }

  async syncDefaults() {
    this.logger.log('Starting synchronization of default accounting configuration...');

    // 1. Sync AcctEvents
    for (const event of DEFAULT_ACCT_EVENTS) {
      await (this.prisma as any).acctEvent.upsert({
        where: { eventCode: event.eventCode },
        update: event,
        create: event,
      });
    }

    // 1.1 Cleanup deprecated deposit rejected events/templates
    await this.cleanupRejectedDepositEvents();

    this.logger.log(`Synced ${DEFAULT_ACCT_EVENTS.length} accounting events.`);

    // 2. Sync Journal Templates
    // Get a base asset for templates (default to AED or first available)
    const baseAsset = await (this.prisma as any).asset.findFirst({ where: { code: 'AED' } }) 
                   || await (this.prisma as any).asset.findFirst();
    
    if (!baseAsset) {
      this.logger.warn('No assets found. Skipping journal template synchronization.');
      return { success: true, message: 'Events synced, but no assets found for templates.' };
    }

    for (const tpl of DEFAULT_JOURNAL_TEMPLATES) {
      // Upsert Header
      const headerData = {
        ...tpl.header,
        baseAssetId: baseAsset.id,
      };

      const header = await (this.prisma as any).journalHeaderTemplate.upsert({
        where: { templateCode: tpl.header.templateCode },
        update: headerData,
        create: headerData,
      });

      // Sync Lines (Delete existing and recreate to ensure exact match with defaults)
      await (this.prisma as any).journalLineTemplate.deleteMany({
        where: { templateId: header.id },
      });

      for (const line of tpl.lines) {
        // Ensure COA exists
        const coa = await (this.prisma as any).coa.findUnique({ where: { code: line.accountCode } });
        if (!coa) {
          this.logger.error(`COA ${line.accountCode} missing! Skipping line.`);
          continue;
        }

        await (this.prisma as any).journalLineTemplate.create({
          data: {
            ...line,
            templateId: header.id,
          },
        });
      }
    }
    this.logger.log(`Synced ${DEFAULT_JOURNAL_TEMPLATES.length} journal templates.`);

    return { success: true, message: 'Accounting configuration synchronized successfully.' };
  }
}
