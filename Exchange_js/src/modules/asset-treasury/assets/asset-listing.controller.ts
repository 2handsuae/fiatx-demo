import { Controller, Post, Body, Param, Req, UseGuards, ForbiddenException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AdminPermissionGuard } from '../../identity/access-control/admin-permission.guard';
import { ApprovalActorContext } from '../../governance/approvals/constants/approval.constants';
import { AssetListingWorkflowService } from './asset-listing-workflow.service';
import { SubmitAssetListingDto } from './dto/submit-asset-listing.dto';

@Controller('admin/assets')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
export class AssetListingController {
  constructor(private readonly workflowService: AssetListingWorkflowService) {}

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
  async submitListing(@Body() dto: SubmitAssetListingDto, @Req() req: any) {
    this.ensureAdmin(req);
    return this.workflowService.submitListing(dto, this.buildAdminActor(req));
  }

  @Post(':assetNo/activate')
  async activateAsset(@Param('assetNo') assetNo: string, @Req() req: any) {
    this.ensureAdmin(req);
    return this.workflowService.activateAsset(assetNo, this.buildAdminActor(req));
  }
}
