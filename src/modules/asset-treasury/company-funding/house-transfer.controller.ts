import { Body, Controller, Get, Param, Post, Query, Req, UseGuards, UsePipes, ValidationPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { AdminPermissionGuard } from '../../identity/access-control/admin-permission.guard';
import { RequirePermissions } from '../../identity/access-control/require-permissions.decorator';
import { buildPermissionCode } from '../../identity/access-control/permission-code.util';
import { ApprovalActorContext } from '../../governance/approvals/constants/approval.constants';
import { HouseTransferService } from './house-transfer.service';
import { HouseTransferWorkflowService } from './house-transfer-workflow.service';
import { CancelHouseTransferDto, HouseTransferListQueryDto, InitiateHouseTransferDto } from './dto/house-transfer.dto';

/** 戊波二 T5 · 公司调拨单端点。开单 / 撤回归金库（FUNDING_WRITE），列表 / 详情归 FUNDING_READ（与注资单、付款单同组）；
 *  写动作全在 workflow。腿的推进走资金单页 ⚡（FUNDS_ORDER_ACT），调拨详情页不设推单按钮——落账全在腿事件里自动收口。 */
@ApiTags('Admin - Company Funding')
@ApiBearerAuth()
@Controller('admin/house-transfers')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
export class HouseTransferController {
  constructor(
    private readonly workflow: HouseTransferWorkflowService,
    private readonly transfers: HouseTransferService,
  ) {}

  /** 同 vendor-payment.controller.ts：整个 actor 往下传。 */
  private buildActor(req: any): ApprovalActorContext {
    const user = req.user;
    return { actorType: 'ADMIN', userId: user.userId || user.sub, userNo: user.userNo, role: user.role, roleCodes: user.roleCodes || (user.role ? [user.role] : []) };
  }

  @Post()
  @ApiOperation({ summary: 'Initiate a house transfer (move the firm\'s own money between its operating and fee wallets) — CFO signs it off' })
  @RequirePermissions(buildPermissionCode('POST', '/admin/house-transfers'))
  initiate(@Body() dto: InitiateHouseTransferDto, @Req() req: any) {
    return this.workflow.initiate(dto, this.buildActor(req));
  }

  @Post(':transferNo/cancel')
  @ApiOperation({ summary: 'Cancel a pending-approval house transfer' })
  @RequirePermissions(buildPermissionCode('POST', '/admin/house-transfers/:transferNo/cancel'))
  cancel(@Param('transferNo') transferNo: string, @Body() dto: CancelHouseTransferDto, @Req() req: any) {
    return this.workflow.cancel(transferNo, dto, this.buildActor(req));
  }

  @Get()
  @ApiOperation({ summary: 'List house transfers' })
  @RequirePermissions(buildPermissionCode('GET', '/admin/house-transfers'))
  list(@Query() q: HouseTransferListQueryDto) {
    return this.transfers.list(q);
  }

  @Get(':transferNo')
  @ApiOperation({ summary: 'Get house transfer detail (with the funds-order leg)' })
  @RequirePermissions(buildPermissionCode('GET', '/admin/house-transfers/:transferNo'))
  detail(@Param('transferNo') transferNo: string) {
    return this.transfers.getView(transferNo);
  }
}
