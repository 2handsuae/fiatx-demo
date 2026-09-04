import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../core/prisma/prisma.module';
import { TigerBeetleModule } from '../../accounting/tigerbeetle/tigerbeetle.module';
import { ApprovalsModule } from '../../governance/approvals/approvals.module';
import { AuditLogsModule } from '../../audit-logging/audit-logs.module';
import { AssetsController } from './assets.controller';
import { AssetAdminController } from './asset-admin.controller';
import { AssetsService } from './assets.service';
import { AssetProvisioningService } from './asset-provisioning.service';
import { AssetSuspensionApprovalService } from './asset-suspension-approval.service';
import { AssetReactivationApprovalService } from './asset-reactivation-approval.service';
import { AssetSuspensionWorkflowService } from './asset-suspension-workflow.service';
import { AssetReactivationWorkflowService } from './asset-reactivation-workflow.service';

@Module({
  imports: [PrismaModule, TigerBeetleModule, ApprovalsModule, AuditLogsModule],
  controllers: [AssetsController, AssetAdminController],
  providers: [
    AssetsService,
    AssetProvisioningService,
    AssetSuspensionApprovalService,
    AssetReactivationApprovalService,
    AssetSuspensionWorkflowService,
    AssetReactivationWorkflowService,
  ],
  exports: [AssetsService],
})
export class AssetsModule {}
