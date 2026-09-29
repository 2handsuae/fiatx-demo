import { Body, Controller, Get, Param, Post, Query, Req, UseGuards, UsePipes, ValidationPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { AdminPermissionGuard } from '../../identity/access-control/admin-permission.guard';
import { RequirePermissions } from '../../identity/access-control/require-permissions.decorator';
import { buildPermissionCode } from '../../identity/access-control/permission-code.util';
import { ApprovalActorContext } from '../../governance/approvals/constants/approval.constants';
import { VendorPaymentService } from './vendor-payment.service';
import { VendorPaymentWorkflowService } from './vendor-payment-workflow.service';
import { CancelVendorPaymentDto, InitiateVendorPaymentDto, VendorPaymentListQueryDto } from './dto/vendor-payment.dto';

/** 战役乙波二 T5 · 付款单端点。开单 / 撤回归金库（FUNDING_WRITE），列表 / 详情归
 *  FUNDING_READ；写动作全在 workflow（同 capital-injection.controller.ts 先例）。腿 1
 *  推进走资金单页 ⚡（FUNDS_ORDER_ACT），付款详情页不设推单按钮——本族无 simulate-contribution
 *  / confirm 端点：落账全在腿事件里自动收口，没有金库手动确认这一步（同 T3 唯一差异）。 */
@ApiTags('Admin - Company Funding')
@ApiBearerAuth()
@Controller('admin/vendor-payments')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
export class VendorPaymentController {
  constructor(
    private readonly workflow: VendorPaymentWorkflowService,
    private readonly payments: VendorPaymentService,
  ) {}

  /** 同 capital-injection.controller.ts：整个 actor 往下传。 */
  private buildActor(req: any): ApprovalActorContext {
    const user = req.user;
    return { actorType: 'ADMIN', userId: user.userId || user.sub, userNo: user.userNo, role: user.role, roleCodes: user.roleCodes || (user.role ? [user.role] : []) };
  }

  @Post()
  @ApiOperation({ summary: 'Initiate a vendor payment (pay a registered outsourcing vendor) — CFO signs it off' })
  @RequirePermissions(buildPermissionCode('POST', '/admin/vendor-payments'))
  initiate(@Body() dto: InitiateVendorPaymentDto, @Req() req: any) {
    return this.workflow.initiate(dto, this.buildActor(req));
  }

  @Post(':payNo/cancel')
  @ApiOperation({ summary: 'Cancel a pending-approval vendor payment' })
  @RequirePermissions(buildPermissionCode('POST', '/admin/vendor-payments/:payNo/cancel'))
  cancel(@Param('payNo') payNo: string, @Body() dto: CancelVendorPaymentDto, @Req() req: any) {
    return this.workflow.cancel(payNo, dto, this.buildActor(req));
  }

  @Get()
  @ApiOperation({ summary: 'List vendor payments' })
  @RequirePermissions(buildPermissionCode('GET', '/admin/vendor-payments'))
  list(@Query() q: VendorPaymentListQueryDto) {
    return this.payments.list(q);
  }

  @Get(':payNo')
  @ApiOperation({ summary: 'Get vendor payment detail (with funds-order legs)' })
  @RequirePermissions(buildPermissionCode('GET', '/admin/vendor-payments/:payNo'))
  detail(@Param('payNo') payNo: string) {
    return this.payments.getView(payNo);
  }
}
