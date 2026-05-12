import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../core/prisma/prisma.module';
import { TigerBeetleModule } from '../../accounting/tigerbeetle/tigerbeetle.module';
import { ApprovalsModule } from '../../governance/approvals/approvals.module';
import { AuditLogsModule } from '../../audit-logging/audit-logs.module';
import { AssetsController } from './assets.controller';
import { AssetListingController } from './asset-listing.controller';
import { AssetsService } from './assets.service';
import { AssetListingWorkflowService } from './asset-listing-workflow.service';
import { AssetListingApprovalService } from './asset-listing-approval.service';
import { AssetProvisioningService } from './asset-provisioning.service';
import { WalletsModule } from '../wallets/wallets.module';

@Module({
  imports: [PrismaModule, TigerBeetleModule, ApprovalsModule, AuditLogsModule, WalletsModule],
  controllers: [AssetsController, AssetListingController],
  providers: [
    AssetsService,
    AssetListingWorkflowService,
    AssetListingApprovalService,
    AssetProvisioningService,
  ],
  exports: [AssetsService],
})
export class AssetsModule {}
