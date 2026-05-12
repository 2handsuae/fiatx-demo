import { Controller, Post, Body, Param, Req, UseGuards, ForbiddenException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AdminPermissionGuard } from '../../identity/access-control/admin-permission.guard';
import { RequirePermissions } from '../../identity/access-control/require-permissions.decorator';
import { buildPermissionCode } from '../../identity/access-control/permission-code.util';
import { ApprovalActorContext } from '../../governance/approvals/constants/approval.constants';
import { AssetListingWorkflowService } from './asset-listing-workflow.service';
import { SubmitAssetListingDto } from './dto/submit-asset-listing.dto';
import { SystemWalletProvisioningService } from '../wallets/system-wallet-provisioning.service';

@Controller('admin/assets')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
export class AssetListingController {
  constructor(
    private readonly workflowService: AssetListingWorkflowService,
    private readonly provisioningService: SystemWalletProvisioningService,
  ) {}

  private ensureAdmin(req: any) {
    if (req.user?.type !== 'ADMIN') {
      throw new ForbiddenException('Admin token required');
    }
  }

  private buildAdminActor(req: any): ApprovalActorContext {
    return {
      actorType: 'ADMIN',
      userId: req.user.userId,
      userNo: req.user.userNo,
      role: req.user.role || 'ADMIN',
      roleCodes: req.user.roleCodes || [req.user.role || 'ADMIN'],
    };
  }

  @Post('listing')
  @RequirePermissions(buildPermissionCode('POST', '/admin/assets/listing'))
  async submitListing(@Body() dto: SubmitAssetListingDto, @Req() req: any) {
    this.ensureAdmin(req);
    return this.workflowService.submitListing(dto, this.buildAdminActor(req));
  }

  @Post(':assetNo/activate')
  @RequirePermissions(buildPermissionCode('POST', '/admin/assets/:assetNo/activate'))
  async activateAsset(@Param('assetNo') assetNo: string, @Req() req: any) {
    this.ensureAdmin(req);
    return this.workflowService.activateAsset(assetNo, this.buildAdminActor(req));
  }

  @Post(':assetNo/provision-wallets')
  @RequirePermissions(buildPermissionCode('POST', '/admin/assets/:assetNo/provision-wallets'))
  async provisionWallets(@Param('assetNo') assetNo: string, @Req() req: any) {
    this.ensureAdmin(req);
    return this.provisioningService.provisionSystemWallets(assetNo, this.buildAdminActor(req));
  }
}
