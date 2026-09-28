import { Body, Controller, Get, Param, Post, Req, UseGuards, UsePipes, ValidationPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { AdminPermissionGuard } from '../../identity/access-control/admin-permission.guard';
import { RequirePermissions } from '../../identity/access-control/require-permissions.decorator';
import { buildPermissionCode } from '../../identity/access-control/permission-code.util';
import { ApprovalActorContext } from '../../governance/approvals/constants/approval.constants';
import { LpProfileService } from './lp-profile.service';
import { LpProfileWorkflowService } from './lp-profile-workflow.service';
import { CreateLpProfileDto, ProposeSettlementChangeDto, ReactivateLpProfileDto, SuspendLpProfileDto } from './dto/lp-profile.dto';

/** 战役乙波一 T3 · LP 档案端点。建档 / 改结算坐标 / 启停归金库（LP_WRITE），列表 / 详情归
 *  LP_READ；写动作全在 workflow（同 internal-transfer.controller.ts 先例）。 */
@ApiTags('Admin - LP Desk')
@ApiBearerAuth()
@Controller('admin/lp-profiles')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
export class LpProfileController {
  constructor(
    private readonly workflow: LpProfileWorkflowService,
    private readonly profiles: LpProfileService,
  ) {}

  private buildActor(req: any): ApprovalActorContext {
    const user = req.user;
    return { actorType: 'ADMIN', userId: user.userId || user.sub, userNo: user.userNo, role: user.role, roleCodes: user.roleCodes || (user.role ? [user.role] : []) };
  }

  @Post()
  @ApiOperation({ summary: 'Register a new liquidity provider (CFO signs off)' })
  @RequirePermissions(buildPermissionCode('POST', '/admin/lp-profiles'))
  create(@Body() dto: CreateLpProfileDto, @Req() req: any) {
    return this.workflow.initiateCreate(dto, this.buildActor(req));
  }

  @Post(':lpNo/settlement-change')
  @ApiOperation({ summary: 'Propose a settlement-coordinate change (CFO signs off)' })
  @RequirePermissions(buildPermissionCode('POST', '/admin/lp-profiles/:lpNo/settlement-change'))
  settlementChange(@Param('lpNo') lpNo: string, @Body() dto: ProposeSettlementChangeDto, @Req() req: any) {
    return this.workflow.proposeSettlementChange(lpNo, dto, this.buildActor(req));
  }

  @Post(':lpNo/suspend')
  @ApiOperation({ summary: 'Suspend a liquidity provider' })
  @RequirePermissions(buildPermissionCode('POST', '/admin/lp-profiles/:lpNo/suspend'))
  suspend(@Param('lpNo') lpNo: string, @Body() dto: SuspendLpProfileDto, @Req() req: any) {
    return this.workflow.suspend(lpNo, dto, this.buildActor(req));
  }

  @Post(':lpNo/reactivate')
  @ApiOperation({ summary: 'Reactivate a suspended liquidity provider' })
  @RequirePermissions(buildPermissionCode('POST', '/admin/lp-profiles/:lpNo/reactivate'))
  reactivate(@Param('lpNo') lpNo: string, @Body() dto: ReactivateLpProfileDto, @Req() req: any) {
    return this.workflow.reactivate(lpNo, dto, this.buildActor(req));
  }

  @Get()
  @ApiOperation({ summary: 'List liquidity providers' })
  @RequirePermissions(buildPermissionCode('GET', '/admin/lp-profiles'))
  list() {
    return this.profiles.list();
  }

  @Get(':lpNo')
  @ApiOperation({ summary: 'Liquidity provider detail' })
  @RequirePermissions(buildPermissionCode('GET', '/admin/lp-profiles/:lpNo'))
  async detail(@Param('lpNo') lpNo: string) {
    const row = await this.profiles.findByNo(lpNo);
    return this.profiles.toView(row);
  }
}
