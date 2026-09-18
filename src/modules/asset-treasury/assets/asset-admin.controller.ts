import { Controller, Post, Body, Param, Req, UseGuards, ForbiddenException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AdminPermissionGuard } from '../../identity/access-control/admin-permission.guard';
import { RequirePermissions } from '../../identity/access-control/require-permissions.decorator';
import { buildPermissionCode } from '../../identity/access-control/permission-code.util';
import { ApprovalActorContext } from '../../governance/approvals/constants/approval.constants';
import { AssetSuspensionWorkflowService } from './asset-suspension-workflow.service';
import { AssetReactivationWorkflowService } from './asset-reactivation-workflow.service';
import { SuspendAssetDto } from './dto/suspend-asset.dto';

/** 波一：资产管理面只剩暂停 / 恢复（提单人运营，裁决人 CISO）；上架 / 激活 / 编辑整条路已退役。 */
@Controller('admin/assets')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
export class AssetAdminController {
  constructor(
    private readonly suspensionWorkflow: AssetSuspensionWorkflowService,
    private readonly reactivationWorkflow: AssetReactivationWorkflowService,
  ) {}

  private ensureAdmin(req: any) {
    if (req.user?.type !== 'ADMIN') throw new ForbiddenException('Admin token required');
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

  @Post(':assetNo/suspend')
  @RequirePermissions(buildPermissionCode('POST', '/admin/assets/:assetNo/suspend'))
  async suspendAsset(@Param('assetNo') assetNo: string, @Body() dto: SuspendAssetDto, @Req() req: any) {
    this.ensureAdmin(req);
    return this.suspensionWorkflow.requestSuspension(assetNo, dto.reason, this.buildAdminActor(req));
  }

  @Post(':assetNo/reactivate')
  @RequirePermissions(buildPermissionCode('POST', '/admin/assets/:assetNo/reactivate'))
  async reactivateAsset(@Param('assetNo') assetNo: string, @Req() req: any) {
    this.ensureAdmin(req);
    return this.reactivationWorkflow.requestReactivation(assetNo, this.buildAdminActor(req));
  }
}
