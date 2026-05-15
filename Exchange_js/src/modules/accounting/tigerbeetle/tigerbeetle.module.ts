import { Module } from '@nestjs/common';
import { TigerBeetleService } from './tigerbeetle.service';
import { AccountingService } from './accounting.service';
import { TbEvidenceService } from './tb-evidence.service';
import { TbAccountRegistryService } from './tb-account-registry.service';
import { TbManualAccountService } from './tb-manual-account.service';
import { TbAccountBatchService } from './tb-account-batch.service';
import { TbAdminController } from './tb-admin.controller';

@Module({
  controllers: [TbAdminController],
  providers: [
    TigerBeetleService,
    AccountingService,
    TbEvidenceService,
    TbAccountRegistryService,
    TbManualAccountService,
    TbAccountBatchService,
  ],
  exports: [
    AccountingService,
    TbEvidenceService,
    TbAccountRegistryService,
    TbManualAccountService,
    TbAccountBatchService,
  ],
})
export class TigerBeetleModule {}
