import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';

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
}
