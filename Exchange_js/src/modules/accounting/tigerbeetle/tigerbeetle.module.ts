import { Module } from '@nestjs/common';
import { TigerBeetleService } from './tigerbeetle.service';
import { AccountingService } from './accounting.service';
import { TbEvidenceService } from './tb-evidence.service';
import { TbAccountRegistryService } from './tb-account-registry.service';
import { TbManualAccountService } from './tb-manual-account.service';
import { TbAdminController } from './tb-admin.controller';
import { PrismaModule } from '../../../core/prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [TbAdminController],
  providers: [
    TigerBeetleService,
    AccountingService,
    TbEvidenceService,
    TbAccountRegistryService,
    TbManualAccountService,
  ],
  exports: [
    AccountingService,
    TbEvidenceService,
    TbAccountRegistryService,
    TbManualAccountService,
  ],
})
export class TigerBeetleModule {}
