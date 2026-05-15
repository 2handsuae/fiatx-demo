import { Controller, Post, Patch, Body, Param, Req, UseGuards, ForbiddenException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AdminPermissionGuard } from '../../identity/access-control/admin-permission.guard';
import { RequirePermissions } from '../../identity/access-control/require-permissions.decorator';
import { buildPermissionCode } from '../../identity/access-control/permission-code.util';
import { ApprovalActorContext } from '../../governance/approvals/constants/approval.constants';
import { AssetListingWorkflowService } from './asset-listing-workflow.service';
import { AssetActivationWorkflowService } from './asset-activation-workflow.service';
import { AssetSuspensionWorkflowService } from './asset-suspension-workflow.service';
import { AssetReactivationWorkflowService } from './asset-reactivation-workflow.service';
import { SubmitAssetListingDto } from './dto/submit-asset-listing.dto';
import { UpdateAssetDto } from './dto/update-asset.dto';
import { SuspendAssetDto } from './dto/suspend-asset.dto';

@Controller('admin/assets')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
export class AssetListingController {
  constructor(
    private readonly workflowService: AssetListingWorkflowService,
    private readonly activationWorkflow: AssetActivationWorkflowService,
    private readonly suspensionWorkflow: AssetSuspensionWorkflowService,
    private readonly reactivationWorkflow: AssetReactivationWorkflowService,
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
    const actor = this.buildAdminActor(req);
    return this.workflowService.submitListing(dto, {
      userId: actor.userId,
      userNo: actor.userNo,
      role: actor.role,
    });
  }

  @Patch(':assetNo')
  @RequirePermissions(buildPermissionCode('PATCH', '/admin/assets/:assetNo'))
  async updateAsset(
    @Param('assetNo') assetNo: string,
    @Body() dto: UpdateAssetDto,
    @Req() req: any,
  ) {
    this.ensureAdmin(req);
    const actor = this.buildAdminActor(req);
    return this.workflowService.updateProvisioning(assetNo, dto, {
      userId: actor.userId,
      userNo: actor.userNo,
      role: actor.role,
    });
  }

  @Post(':assetNo/activate')
  @RequirePermissions(buildPermissionCode('POST', '/admin/assets/:assetNo/activate'))
  async activateAsset(@Param('assetNo') assetNo: string, @Req() req: any) {
    this.ensureAdmin(req);
    return this.activationWorkflow.requestActivation(assetNo, this.buildAdminActor(req));
  }

  @Post(':assetNo/suspend')
  @RequirePermissions(buildPermissionCode('POST', '/admin/assets/:assetNo/suspend'))
  async suspendAsset(
    @Param('assetNo') assetNo: string,
    @Body() dto: SuspendAssetDto,
    @Req() req: any,
  ) {
    this.ensureAdmin(req);
    return this.suspensionWorkflow.requestSuspension(
      assetNo,
      dto.reason,
      this.buildAdminActor(req),
    );
  }

  @Post(':assetNo/reactivate')
  @RequirePermissions(buildPermissionCode('POST', '/admin/assets/:assetNo/reactivate'))
  async reactivateAsset(@Param('assetNo') assetNo: string, @Req() req: any) {
    this.ensureAdmin(req);
    return this.reactivationWorkflow.requestReactivation(
      assetNo,
      this.buildAdminActor(req),
    );
  }
}
