import { Body, Controller, Get, Param, Post, Query, Req, UseGuards, UsePipes, ValidationPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { AdminPermissionGuard } from '../../identity/access-control/admin-permission.guard';
import { RequirePermissions } from '../../identity/access-control/require-permissions.decorator';
import { buildPermissionCode } from '../../identity/access-control/permission-code.util';
import { ApprovalActorContext } from '../../governance/approvals/constants/approval.constants';
import { LpExchangeService } from './lp-exchange.service';
import { LpExchangeWorkflowService } from './lp-exchange-workflow.service';
import { CancelLpExchangeDto, InitiateLpExchangeDto, LpExchangeListQueryDto } from './dto/lp-exchange.dto';

/** 战役乙波一 T6 · LP 兑换端点。开单 / 撤回 / 验收归金库（LP_WRITE），列表 / 详情归
 *  LP_READ；写动作全在 workflow（同 internal-transfer.controller.ts / lp-profile.controller.ts
 *  先例）。simulate-delivery 是 ⚡演示件，但推的是单据不是时间——归 LP_WRITE，不挂
 *  DEMO_CLOCK_WRITE（同 funds-orders push/sync·push/manual 先例：FUNDS_ORDER_ACT 而非拨钟组）。 */
@ApiTags('Admin - LP Desk')
@ApiBearerAuth()
@Controller('admin/lp-exchanges')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
export class LpExchangeController {
  constructor(
    private readonly workflow: LpExchangeWorkflowService,
    private readonly exchanges: LpExchangeService,
  ) {}

  /** 同 internal-transfer.controller.ts / lp-profile.controller.ts：整个 actor 往下传。 */
  private buildActor(req: any): ApprovalActorContext {
    const user = req.user;
    return { actorType: 'ADMIN', userId: user.userId || user.sub, userNo: user.userNo, role: user.role, roleCodes: user.roleCodes || (user.role ? [user.role] : []) };
  }

  @Post()
  @ApiOperation({ summary: 'Initiate an LP exchange (sell one asset, buy another) — CFO signs it off' })
  @RequirePermissions(buildPermissionCode('POST', '/admin/lp-exchanges'))
  initiate(@Body() dto: InitiateLpExchangeDto, @Req() req: any) {
    return this.workflow.initiate(dto, this.buildActor(req));
  }

  @Post(':exchangeNo/cancel')
  @ApiOperation({ summary: 'Cancel a pending-approval LP exchange' })
  @RequirePermissions(buildPermissionCode('POST', '/admin/lp-exchanges/:exchangeNo/cancel'))
  cancel(@Param('exchangeNo') exchangeNo: string, @Body() dto: CancelLpExchangeDto, @Req() req: any) {
    return this.workflow.cancel(exchangeNo, dto, this.buildActor(req));
  }

  @Post(':exchangeNo/accept')
  @ApiOperation({ summary: 'Accept LP delivery — transfer the buy leg from the front desk to the operating account' })
  @RequirePermissions(buildPermissionCode('POST', '/admin/lp-exchanges/:exchangeNo/accept'))
  accept(@Param('exchangeNo') exchangeNo: string, @Req() req: any) {
    return this.workflow.accept(exchangeNo, this.buildActor(req));
  }

  @Post(':exchangeNo/simulate-delivery')
  @ApiOperation({ summary: 'Simulate the LP delivering the buy leg to the front desk (demo only)' })
  @RequirePermissions(buildPermissionCode('POST', '/admin/lp-exchanges/:exchangeNo/simulate-delivery'))
  simulateDelivery(@Param('exchangeNo') exchangeNo: string, @Req() req: any) {
    return this.workflow.simulateDelivery(exchangeNo, this.buildActor(req));
  }

  @Get()
  @ApiOperation({ summary: 'List LP exchanges' })
  @RequirePermissions(buildPermissionCode('GET', '/admin/lp-exchanges'))
  list(@Query() q: LpExchangeListQueryDto) {
    return this.exchanges.list(q);
  }

  @Get(':exchangeNo')
  @ApiOperation({ summary: 'Get LP exchange detail (with funds-order legs)' })
  @RequirePermissions(buildPermissionCode('GET', '/admin/lp-exchanges/:exchangeNo'))
  detail(@Param('exchangeNo') exchangeNo: string) {
    return this.exchanges.getView(exchangeNo);
  }
}
