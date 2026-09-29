import { Body, Controller, Get, Param, Post, Query, Req, UseGuards, UsePipes, ValidationPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { AdminPermissionGuard } from '../../identity/access-control/admin-permission.guard';
import { RequirePermissions } from '../../identity/access-control/require-permissions.decorator';
import { buildPermissionCode } from '../../identity/access-control/permission-code.util';
import { ApprovalActorContext } from '../../governance/approvals/constants/approval.constants';
import { CapitalInjectionService } from './capital-injection.service';
import { CapitalInjectionWorkflowService } from './capital-injection-workflow.service';
import { CancelCapitalInjectionDto, CapitalInjectionListQueryDto, InitiateCapitalInjectionDto } from './dto/capital-injection.dto';

/** 战役乙波二 T3 · 注资单端点。开单 / 撤回 / ⚡到款 / 确认入账归金库（FUNDING_WRITE），
 *  列表 / 详情归 FUNDING_READ；写动作全在 workflow（同 lp-exchange.controller.ts 先例）。
 *  simulate-contribution 是 ⚡演示件，推的是单据不是时间——归 FUNDING_WRITE，不挂
 *  DEMO_CLOCK_WRITE（同 LP simulate-delivery 归组先例）。 */
@ApiTags('Admin - Company Funding')
@ApiBearerAuth()
@Controller('admin/capital-injections')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
export class CapitalInjectionController {
  constructor(
    private readonly workflow: CapitalInjectionWorkflowService,
    private readonly injections: CapitalInjectionService,
  ) {}

  /** 同 lp-exchange.controller.ts：整个 actor 往下传。 */
  private buildActor(req: any): ApprovalActorContext {
    const user = req.user;
    return { actorType: 'ADMIN', userId: user.userId || user.sub, userNo: user.userNo, role: user.role, roleCodes: user.roleCodes || (user.role ? [user.role] : []) };
  }

  @Post()
  @ApiOperation({ summary: 'Initiate a capital injection (contribute funds into the operating account) — CFO signs it off' })
  @RequirePermissions(buildPermissionCode('POST', '/admin/capital-injections'))
  initiate(@Body() dto: InitiateCapitalInjectionDto, @Req() req: any) {
    return this.workflow.initiate(dto, this.buildActor(req));
  }

  @Post(':cinNo/cancel')
  @ApiOperation({ summary: 'Cancel a pending-approval capital injection' })
  @RequirePermissions(buildPermissionCode('POST', '/admin/capital-injections/:cinNo/cancel'))
  cancel(@Param('cinNo') cinNo: string, @Body() dto: CancelCapitalInjectionDto, @Req() req: any) {
    return this.workflow.cancel(cinNo, dto, this.buildActor(req));
  }

  @Post(':cinNo/simulate-contribution')
  @ApiOperation({ summary: 'Simulate the contributor sending the funds into the operating account (demo only)' })
  @RequirePermissions(buildPermissionCode('POST', '/admin/capital-injections/:cinNo/simulate-contribution'))
  simulateContribution(@Param('cinNo') cinNo: string, @Req() req: any) {
    return this.workflow.simulateContribution(cinNo, this.buildActor(req));
  }

  @Post(':cinNo/confirm')
  @ApiOperation({ summary: 'Confirm the contribution (post the entries) — the funds are booked into the firm\'s own assets' })
  @RequirePermissions(buildPermissionCode('POST', '/admin/capital-injections/:cinNo/confirm'))
  confirm(@Param('cinNo') cinNo: string, @Req() req: any) {
    return this.workflow.confirm(cinNo, this.buildActor(req));
  }

  @Get()
  @ApiOperation({ summary: 'List capital injections' })
  @RequirePermissions(buildPermissionCode('GET', '/admin/capital-injections'))
  list(@Query() q: CapitalInjectionListQueryDto) {
    return this.injections.list(q);
  }

  @Get(':cinNo')
  @ApiOperation({ summary: 'Get capital injection detail (with funds-order legs)' })
  @RequirePermissions(buildPermissionCode('GET', '/admin/capital-injections/:cinNo'))
  detail(@Param('cinNo') cinNo: string) {
    return this.injections.getView(cinNo);
  }
}
