import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { DEFAULT_ACCT_EVENTS } from '../../../config/manifests/events.manifest';
import { DEFAULT_JOURNAL_TEMPLATES } from '../../../config/manifests/journal-templates.manifest';

@Injectable()
export class AcctConfigService {
  private readonly logger = new Logger(AcctConfigService.name);

  constructor(private readonly prisma: PrismaService) {}

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
