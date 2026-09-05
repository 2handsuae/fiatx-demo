import { Body, Controller, Get, Param, Post, Query, Req, UseGuards, UsePipes, ValidationPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { AdminPermissionGuard } from '../../identity/access-control/admin-permission.guard';
import { RequirePermissions } from '../../identity/access-control/require-permissions.decorator';
import { buildPermissionCode } from '../../identity/access-control/permission-code.util';
import { ApprovalActorContext } from '../../governance/approvals/constants/approval.constants';
import { InternalTransferService } from './internal-transfer.service';
import { InternalTransferWorkflowService } from './internal-transfer-workflow.service';
import { CancelInternalTransferDto, InitiateAdvanceDto, InitiateCompensationDto, InternalTransferListQueryDto } from './dto/internal-transfer.dto';

/** 平账二期 · 内部划转单端点。发起 / 撤回归金库（INTERNAL_TRANSFER_WRITE），列表 / 详情归 READ；写动作全在 workflow。 */
@ApiTags('Admin - Internal Transfers (平账二期·内部划转单)')
@ApiBearerAuth()
@Controller('admin/internal-transfers')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
export class InternalTransferController {
  constructor(
    private readonly workflow: InternalTransferWorkflowService,
    private readonly transfers: InternalTransferService,
  ) {}

  /** 同 adjustment.controller.ts：整个 actor（UUID + userNo + roleCodes）往下传，SoD 自审拦截才比得上。 */
  private buildActor(req: any): ApprovalActorContext {
    const user = req.user;
    return { actorType: 'ADMIN', userId: user.userId || user.sub, userNo: user.userNo, role: user.role, roleCodes: user.roleCodes || (user.role ? [user.role] : []) };
  }

  @Post('compensation')
  @ApiOperation({ summary: '发起补款（来源 = 已落账的客户池认损调账单）' })
  @RequirePermissions(buildPermissionCode('POST', '/admin/internal-transfers/compensation'))
  compensation(@Body() dto: InitiateCompensationDto, @Req() req: any) {
    return this.workflow.initiateCompensation(dto, this.buildActor(req));
  }

  @Post('advance')
  @ApiOperation({ summary: '发起垫款（来源 = 定性为退汇且余额不足的账单行）' })
  @RequirePermissions(buildPermissionCode('POST', '/admin/internal-transfers/advance'))
  advance(@Body() dto: InitiateAdvanceDto, @Req() req: any) {
    return this.workflow.initiateAdvance(dto, this.buildActor(req));
  }

  @Post(':transferNo/cancel')
  @ApiOperation({ summary: '撤回待批的划转单（仅开单人）' })
  @RequirePermissions(buildPermissionCode('POST', '/admin/internal-transfers/:transferNo/cancel'))
  cancel(@Param('transferNo') transferNo: string, @Body() dto: CancelInternalTransferDto, @Req() req: any) {
    return this.workflow.cancel(transferNo, dto, this.buildActor(req));
  }

  @Get()
  @ApiOperation({ summary: '划转单列表' })
  @RequirePermissions(buildPermissionCode('GET', '/admin/internal-transfers'))
  list(@Query() q: InternalTransferListQueryDto) {
    return this.transfers.list(q);
  }

  @Get(':transferNo')
  @ApiOperation({ summary: '划转单详情（含资金单腿）' })
  @RequirePermissions(buildPermissionCode('GET', '/admin/internal-transfers/:transferNo'))
  detail(@Param('transferNo') transferNo: string) {
    return this.transfers.getView(transferNo);
  }
}
