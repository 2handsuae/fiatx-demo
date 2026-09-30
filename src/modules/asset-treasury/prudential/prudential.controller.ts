// 战役乙波三 T1 · 审慎地基：只读 status 端点，归既有桶 treasury.view_dashboard 的组
// FUNDING_DASHBOARD_VIEW（金库/CFO/高管/内审四职务本就持有，零权限扩张）。
// 战役乙波三 T3 · 巡检：POST check 端点归新桶 treasury.prudential_check 的新组
// PRUDENTIAL_CHECK_WRITE（唯金库——演示站「每日监控任务」的手动触发替身，只有金库能戳）。
import { Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminPermissionGuard } from '../../identity/access-control/admin-permission.guard';
import { RequirePermissions } from '../../identity/access-control/require-permissions.decorator';
import { buildPermissionCode } from '../../identity/access-control/permission-code.util';
import { ApprovalActorContext } from '../../governance/approvals/constants/approval.constants';
import { PrudentialService } from './prudential.service';

@ApiTags('Admin - Prudential')
@ApiBearerAuth()
@Controller('admin/prudential')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
export class PrudentialController {
  constructor(private readonly prudential: PrudentialService) {}

  /** 同 vendor-payment.controller.ts 先例：整个 actor 往下传。 */
  private buildActor(req: any): ApprovalActorContext {
    const user = req.user;
    return { actorType: 'ADMIN', userId: user.userId || user.sub, userNo: user.userNo, role: user.role, roleCodes: user.roleCodes || (user.role ? [user.role] : []) };
  }

  @Get('status')
  @ApiOperation({ summary: 'Get the current NLA prudential status (per-asset F_OPS balances converted to AED, floor, headroom)' })
  @RequirePermissions(buildPermissionCode('GET', '/admin/prudential/status'))
  status() {
    return this.prudential.computeStatus();
  }

  @Post('check')
  @ApiOperation({ summary: 'Run prudential (NLA) check now and log the result' })
  @RequirePermissions(buildPermissionCode('POST', '/admin/prudential/check'))
  check(@Req() req: any) {
    return this.prudential.performCheck(this.buildActor(req));
  }
}
