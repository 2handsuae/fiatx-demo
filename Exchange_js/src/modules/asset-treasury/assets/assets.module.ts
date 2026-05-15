import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../core/prisma/prisma.module';
import { TigerBeetleModule } from '../../accounting/tigerbeetle/tigerbeetle.module';
import { ApprovalsModule } from '../../governance/approvals/approvals.module';
import { AuditLogsModule } from '../../audit-logging/audit-logs.module';
import { AssetsController } from './assets.controller';
import { AssetListingController } from './asset-listing.controller';
import { AssetsService } from './assets.service';
import { AssetListingWorkflowService } from './asset-listing-workflow.service';
import { AssetProvisioningService } from './asset-provisioning.service';
import { AssetActivationApprovalService } from './asset-activation-approval.service';
import { AssetActivationWorkflowService } from './asset-activation-workflow.service';
import { AssetSuspensionApprovalService } from './asset-suspension-approval.service';
import { AssetReactivationApprovalService } from './asset-reactivation-approval.service';
import { AssetSuspensionWorkflowService } from './asset-suspension-workflow.service';
import { AssetReactivationWorkflowService } from './asset-reactivation-workflow.service';
import { WalletsModule } from '../wallets/wallets.module';

@Module({
  imports: [PrismaModule, TigerBeetleModule, ApprovalsModule, AuditLogsModule, WalletsModule],
  controllers: [AssetsController, AssetListingController],
  providers: [
    AssetsService,
    AssetListingWorkflowService,
    AssetProvisioningService,
    AssetActivationApprovalService,
    AssetActivationWorkflowService,
    AssetSuspensionApprovalService,
    AssetReactivationApprovalService,
    AssetSuspensionWorkflowService,
    AssetReactivationWorkflowService,
  ],
  exports: [AssetsService],
})
export class AssetsModule {}
