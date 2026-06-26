import { Module } from '@nestjs/common';
import { TigerBeetleService } from './tigerbeetle.service';
import { AccountingService } from './accounting.service';
import { TbEvidenceService } from './tb-evidence.service';
import { TbAccountRegistryService } from './tb-account-registry.service';
import { TbManualAccountService } from './tb-manual-account.service';
import { TbAdminController } from './tb-admin.controller';
import { PrismaModule } from '../../../core/prisma/prisma.module';
// Phase B / T3: AccountFlow projector lives under reconciliation/ (its consumer
// is the recon engine) but its producer is TbEvidenceService. Providing it
// here avoids a cyclic module dependency.
import { AccountFlowProjectorService } from '../../clearing-settle/reconciliation/projector/account-flow-projector.service';

@Module({
  imports: [PrismaModule],
  controllers: [TbAdminController],
  providers: [
    TigerBeetleService,
    AccountingService,
    TbEvidenceService,
    TbAccountRegistryService,
    TbManualAccountService,
    AccountFlowProjectorService,
  ],
  exports: [
    TigerBeetleService,
    AccountingService,
    TbEvidenceService,
    TbAccountRegistryService,
    TbManualAccountService,
    AccountFlowProjectorService,
  ],
})
export class TigerBeetleModule {}
