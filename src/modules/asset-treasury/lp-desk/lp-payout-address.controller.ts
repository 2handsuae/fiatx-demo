import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards, UsePipes, ValidationPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { AdminPermissionGuard } from '../../identity/access-control/admin-permission.guard';
import { RequirePermissions } from '../../identity/access-control/require-permissions.decorator';
import { buildPermissionCode } from '../../identity/access-control/permission-code.util';
import { ApprovalActorContext } from '../../governance/approvals/constants/approval.constants';
import { SimulateScreeningDto } from '../withdrawal-addresses/dto/simulate-screening.dto';
import { LpPayoutAddressService } from './lp-payout-address.service';
import { LpPayoutAddressWorkflowService } from './lp-payout-address-workflow.service';
import { LpPayoutAddressReasonDto, RegisterLpPayoutAddressDto, UpdateLpPayoutAddressLabelDto } from './dto/lp-payout-address.dto';

/** LP 两步准入 Task 4 · LP 打款地址端点。登记 / 撤回 / 启停退 / 改标签归金库（LP_WRITE），列表 / 详情归 LP_READ；
 *  ⚡筛查覆写站在 Sumsub 一侧，与喂裁决同义 → DEMO_VERDICT_WRITE（零新权限组，同客户地址簿 simulate-screening）。
 *  写动作全在 workflow（同 lp-profile.controller.ts 先例）。两组路径共用一个控制器：按档案挂的登记 / 列表在
 *  /admin/lp-profiles/:lpNo/payout-addresses，按单号的详情与动作在 /admin/lp-payout-addresses/:addressNo。 */
@ApiTags('Admin - LP Desk')
@ApiBearerAuth()
@Controller('admin')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
export class LpPayoutAddressController {
  constructor(
    private readonly workflow: LpPayoutAddressWorkflowService,
    private readonly addresses: LpPayoutAddressService,
  ) {}

  private buildActor(req: any): ApprovalActorContext {
    const user = req.user;
    return { actorType: 'ADMIN', userId: user.userId || user.sub, userNo: user.userNo, role: user.role, roleCodes: user.roleCodes || (user.role ? [user.role] : []) };
  }

  @Post('lp-profiles/:lpNo/payout-addresses')
  @ApiOperation({ summary: 'Register an LP payout address — screened on entry, CFO signs it off' })
  @RequirePermissions(buildPermissionCode('POST', '/admin/lp-profiles/:lpNo/payout-addresses'))
  register(@Param('lpNo') lpNo: string, @Body() dto: RegisterLpPayoutAddressDto, @Req() req: any) {
    return this.workflow.registerAddress(lpNo, dto, this.buildActor(req));
  }

  @Get('lp-profiles/:lpNo/payout-addresses')
  @ApiOperation({ summary: 'List the payout addresses of a liquidity provider' })
  @RequirePermissions(buildPermissionCode('GET', '/admin/lp-profiles/:lpNo/payout-addresses'))
  list(@Param('lpNo') lpNo: string) {
    return this.addresses.listByLp(lpNo);
  }

  @Get('lp-payout-addresses/:addressNo')
  @ApiOperation({ summary: 'LP payout address detail' })
  @RequirePermissions(buildPermissionCode('GET', '/admin/lp-payout-addresses/:addressNo'))
  detail(@Param('addressNo') addressNo: string) {
    return this.addresses.getDetailView(addressNo);
  }

  @Post('lp-payout-addresses/:addressNo/cancel')
  @ApiOperation({ summary: 'Withdraw a pending-approval payout address' })
  @RequirePermissions(buildPermissionCode('POST', '/admin/lp-payout-addresses/:addressNo/cancel'))
  cancel(@Param('addressNo') addressNo: string, @Body() dto: LpPayoutAddressReasonDto, @Req() req: any) {
    return this.workflow.cancel(addressNo, dto, this.buildActor(req));
  }

  @Post('lp-payout-addresses/:addressNo/suspend')
  @ApiOperation({ summary: 'Suspend an active payout address' })
  @RequirePermissions(buildPermissionCode('POST', '/admin/lp-payout-addresses/:addressNo/suspend'))
  suspend(@Param('addressNo') addressNo: string, @Body() dto: LpPayoutAddressReasonDto, @Req() req: any) {
    return this.workflow.suspend(addressNo, dto, this.buildActor(req));
  }

  @Post('lp-payout-addresses/:addressNo/reactivate')
  @ApiOperation({ summary: 'Reactivate a suspended payout address' })
  @RequirePermissions(buildPermissionCode('POST', '/admin/lp-payout-addresses/:addressNo/reactivate'))
  reactivate(@Param('addressNo') addressNo: string, @Body() dto: LpPayoutAddressReasonDto, @Req() req: any) {
    return this.workflow.reactivate(addressNo, dto, this.buildActor(req));
  }

  @Post('lp-payout-addresses/:addressNo/deactivate')
  @ApiOperation({ summary: 'Permanently retire an active payout address' })
  @RequirePermissions(buildPermissionCode('POST', '/admin/lp-payout-addresses/:addressNo/deactivate'))
  deactivate(@Param('addressNo') addressNo: string, @Body() dto: LpPayoutAddressReasonDto, @Req() req: any) {
    return this.workflow.deactivate(addressNo, dto, this.buildActor(req));
  }

  @Patch('lp-payout-addresses/:addressNo/label')
  @ApiOperation({ summary: 'Rename the label of a payout address (coordinates are frozen at registration)' })
  @RequirePermissions(buildPermissionCode('PATCH', '/admin/lp-payout-addresses/:addressNo/label'))
  updateLabel(@Param('addressNo') addressNo: string, @Body() dto: UpdateLpPayoutAddressLabelDto, @Req() req: any) {
    return this.workflow.updateLabel(addressNo, dto, this.buildActor(req));
  }

  @Post('lp-payout-addresses/:addressNo/simulate-screening')
  @ApiOperation({ summary: 'Feed a simulated address screening verdict (demo only)' })
  @RequirePermissions(buildPermissionCode('POST', '/admin/lp-payout-addresses/:addressNo/simulate-screening'))
  simulateScreening(@Param('addressNo') addressNo: string, @Body() dto: SimulateScreeningDto, @Req() req: any) {
    return this.workflow.feedScreening(addressNo, dto.answer, dto.reason, this.buildActor(req));
  }
}
