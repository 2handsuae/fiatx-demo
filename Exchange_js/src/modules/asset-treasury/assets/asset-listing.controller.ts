import { Controller, Post, Body, Param, Req, UseGuards, ForbiddenException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AdminPermissionGuard } from '../../identity/access-control/admin-permission.guard';
import { RequirePermissions } from '../../identity/access-control/require-permissions.decorator';
import { buildPermissionCode } from '../../identity/access-control/permission-code.util';
import { AssetListingWorkflowService } from './asset-listing-workflow.service';
import { AssetSuspensionWorkflowService } from './asset-suspension-workflow.service';
import { AssetReactivationWorkflowService } from './asset-reactivation-workflow.service';
import { SubmitAssetListingDto } from './dto/submit-asset-listing.dto';
import { SuspendAssetDto } from './dto/suspend-asset.dto';

@Controller('admin/assets')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
export class AssetListingController {
  constructor(
    private readonly workflowService: AssetListingWorkflowService,
    private readonly suspensionWorkflow: AssetSuspensionWorkflowService,
    private readonly reactivationWorkflow: AssetReactivationWorkflowService,
  ) {}

  private ensureAdmin(req: any) {
    if (req.user?.type !== 'ADMIN') {
      throw new ForbiddenException('Admin token required');
    }
  }

  private buildAdminActor(req: any) {
    return {
      actorType: 'ADMIN' as const,
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

  // NOTE: activate endpoint moved to AssetActivationWorkflowService (Task 5)

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
