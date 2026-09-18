import { Body, Controller, ForbiddenException, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminPermissionGuard } from '../access-control/admin-permission.guard';
import { RequirePermissions } from '../access-control/require-permissions.decorator';
import { buildPermissionCode } from '../access-control/permission-code.util';
import { ApprovalActorContext } from '../../governance/approvals/constants/approval.constants';
import { TierUpgradeWorkflowService } from './tier-upgrade-workflow.service';

@ApiTags('Admin - Tier Upgrade')
@Controller('admin/customers')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
@ApiBearerAuth()
export class TierUpgradeAdminController {
  constructor(private readonly workflow: TierUpgradeWorkflowService) {}

  @Post(':customerNo/tier-upgrade-acceptance')
  @ApiOperation({ summary: '提请档位升级核准（运营 maker → 高管 checker）' })
  @RequirePermissions(buildPermissionCode('POST', '/admin/customers/:customerNo/tier-upgrade-acceptance'))
  submit(@Req() req: any, @Param('customerNo') customerNo: string, @Body() body: { reason: string }) {
    if (req.user?.type !== 'ADMIN') throw new ForbiddenException('Admin token required');
    const actor: ApprovalActorContext = {
      actorType: 'ADMIN',
      userId: req.user?.userId,
      userNo: req.user?.userNo,
      role: req.user?.role,
      roleCodes: req.user?.roleCodes || (req.user?.role ? [req.user.role] : []),
    };
    return this.workflow.submitAcceptance(customerNo, body?.reason ?? '', actor);
  }

  @Get(':customerNo/tier-upgrade')
  @ApiOperation({ summary: '管理台档位升级全貌（当前档 + 申请单 + 关联审批单）' })
  @RequirePermissions(buildPermissionCode('GET', '/admin/customers/:customerNo/tier-upgrade'))
  getAdminView(@Param('customerNo') customerNo: string) {
    return this.workflow.getAdminView(customerNo);
  }
}
