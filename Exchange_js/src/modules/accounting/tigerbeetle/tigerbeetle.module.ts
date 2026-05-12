import { Module } from '@nestjs/common';
import { TigerBeetleService } from './tigerbeetle.service';
import { AccountingService } from './accounting.service';
import { TbEvidenceService } from './tb-evidence.service';
import { TbAccountRegistryService } from './tb-account-registry.service';

@Module({
  providers: [
    TigerBeetleService,
    AccountingService,
    TbEvidenceService,
    TbAccountRegistryService,
  ],
  exports: [
    AccountingService,
    TbEvidenceService,
    TbAccountRegistryService,
  ],
})
export class TigerBeetleModule {}
