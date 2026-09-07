import {
  Controller,
  Get,
  Body,
  Param,
  Query,
  Post,
  UsePipes,
  ValidationPipe,
  UseGuards,
  Req,
  ForbiddenException,
} from '@nestjs/common';
import { DepositTransactionsService } from './deposit-transactions.service';
import {
  DepositTransactionQueryDto,
  InitiateDepositReturnDto,
  InitiateDepositSupplementDto,
  InitiateDepositClawbackDto,
} from './dto/deposit-transaction.dto';
import { DepositWorkflowService } from './deposit-workflow.service';
import {
  CreateInboundTransferSignalDto,
  InboundTransferSignalQueryDto,
  ScanInboundTransferSignalsDto,
} from './dto/inbound-transfer-signal.dto';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { AdminPermissionGuard } from '../../../modules/identity/access-control/admin-permission.guard';
import { RequirePermissions } from '../../../modules/identity/access-control/require-permissions.decorator';
import { buildPermissionCode } from '../../../modules/identity/access-control/permission-code.util';
import { InboundTransferSignalsService } from './inbound-transfer-signals.service';
import { ApprovalActorContext } from '../../governance/approvals/constants/approval.constants';

@ApiTags('Deposit Transactions')
@ApiBearerAuth()
@Controller('deposit-transactions')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
export class DepositTransactionsController {
  constructor(
    private readonly service: DepositTransactionsService,
    private readonly inboundTransferSignalsService: InboundTransferSignalsService,
    private readonly workflow: DepositWorkflowService,
  ) {}

  private assertAdmin(req: any) {
    if (req.user?.type !== 'ADMIN') {
      throw new ForbiddenException('Admin only');
    }
  }

  @Get('my')
  @ApiOperation({ summary: 'List my deposit transactions' })
  @UsePipes(new ValidationPipe({ transform: true }))
  findMy(@Req() req: any, @Query() query: DepositTransactionQueryDto) {
    const userId = req.user.userId;
    return this.service.findAllForCustomer(userId, query);
  }

  @Get('my/inbound-signals')
  @ApiOperation({ summary: 'List my inbound transfer signals' })
  @UsePipes(new ValidationPipe({ transform: true }))
  findMyInboundSignals(
    @Req() req: any,
    @Query() query: InboundTransferSignalQueryDto,
  ) {
    const userId = req.user.userId;
    return this.inboundTransferSignalsService.findAllForCustomer(userId, query);
  }

  @Post('my/inbound-signals')
  @ApiOperation({ summary: 'Create my inbound transfer signal' })
  @UsePipes(new ValidationPipe({ transform: true }))
  createMyInboundSignal(
    @Req() req: any,
    @Body() dto: CreateInboundTransferSignalDto,
  ) {
    const userId = req.user.userId;
    return this.inboundTransferSignalsService.createForCustomer(userId, dto);
  }

  @Post('my/inbound-signals/scan')
  @ApiOperation({ summary: 'Scan my inbound transfer signals' })
  @UsePipes(new ValidationPipe({ transform: true }))
  scanMyInboundSignals(
    @Req() req: any,
    @Body() dto: ScanInboundTransferSignalsDto,
  ) {
    const userId = req.user.userId;
    return this.inboundTransferSignalsService.scanForCustomer(userId, dto);
  }

  // 2026-08-17 材料请求账：本域补料会话端点（原按 seq 定位的旧端点）已删除。
  // 客户面改走 material-requests.client.controller.ts
  // 的 requestNo 定位端点（Task 14 接入）。

  @Get('my/:depositNo')
  @ApiOperation({ summary: 'Get my deposit transaction detail' })
  getMyDeposit(@Req() req: any, @Param('depositNo') depositNo: string) {
    return this.service.findOneForCustomerByDepositNo(depositNo, req.user.userId);
  }

  @Get()
  @ApiOperation({ summary: 'List deposit transactions' })
  @UsePipes(new ValidationPipe({ transform: true }))
  findAll(@Query() query: DepositTransactionQueryDto) {
    return this.service.findAll(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get deposit transaction details' })
  findOne(@Param('id') id: string, @Req() req: any) {
    if (req.user?.type === 'ADMIN') {
      return this.service.findOneForAdmin(id);
    }
    return this.service.findOneForCustomer(id, req.user?.userId);
  }

  // PATCH :id/status retired (Task 4) — grep across admin-web/scripts/test found zero
  // real callers (the only repo hit was a JSDoc comment in deposit-workflow.service.ts
  // documenting this as one of three historical paths into approveDeposit()). The
  // workflow-only-actions guard existed solely to protect this endpoint, so it goes
  // too; adminFreeze() (deposit-workflow.service.ts) had no other caller and was
  // removed alongside it. service.updateStatus() stays — still the direct call target
  // for every other internal FREEZE/status transition (KYT-rejected auto-freeze etc).

  // 平账 B 批 ①：凭对账账单行补喂入站信号，CFO 批准后走正常充值通道。静态段路径，
  // 但仍按本文件惯例排在所有 `:id` 路由之前声明。
  @Post('supplement')
  @ApiOperation({ summary: 'Recon Batch B ①: supplement a missed deposit using a statement line (CFO maker-checker)' })
  @RequirePermissions(buildPermissionCode('POST', '/deposit-transactions/supplement'))
  initiateSupplement(@Body() dto: InitiateDepositSupplementDto, @Req() req: any) {
    this.assertAdmin(req);
    const actor: ApprovalActorContext = {
      actorType: 'ADMIN',
      userId: req.user?.userId,
      userNo: req.user?.userNo,
      role: req.user?.role,
      roleCodes: req.user?.roleCodes || (req.user?.role ? [req.user.role] : []),
    };
    return this.inboundTransferSignalsService.initiateSupplement(dto, actor);
  }

  @Post(':id/waive-limit')
  @ApiOperation({ summary: 'Waive below-minimum amount hold (PASS disposition)' })
  waiveLimitHold(@Param('id') id: string, @Req() req: any) {
    this.assertAdmin(req);
    const actor = {
      actorId: req.user?.userId,
      actorRole: req.user?.role,
    };
    return this.workflow.waiveLimitHold(id, actor);
  }

  @Post(':id/confiscate')
  @ApiOperation({ summary: 'Confiscate below-minimum deposit as T&C fee (maker-checker approval)' })
  confiscate(
    @Param('id') id: string,
    @Body() body: { reason?: string },
    @Req() req: any,
  ) {
    this.assertAdmin(req);
    const actor: ApprovalActorContext = {
      actorType: 'ADMIN',
      userId: req.user?.userId,
      userNo: req.user?.userNo,
      role: req.user?.role,
      roleCodes: req.user?.roleCodes || (req.user?.role ? [req.user.role] : []),
    };
    return this.workflow.initiateConfiscation(id, { reason: body?.reason ?? '' }, actor);
  }

  // 第四批 C1：充值域「原路退回汇款人」的运营正门。此前 initiateReturn 全仓唯一调用方
  // 是 applyKytRejected 里判 dispoTag === 'RETURN_TO_SENDER' 的分支 —— 控制器上没有路由,
  // 合规官想退钱得跑去 Sumsub 后台改裁决标签,让外部系统替我方发起我方自己的动钱流程。
  // 与 confiscate/seize/unfreeze 同形状:开审批案,不直推。
  @Post(':id/return')
  @ApiOperation({ summary: 'Open a return-to-sender approval (MLRO maker-checker) for a deposit' })
  @RequirePermissions(buildPermissionCode('POST', '/deposit-transactions/:id/return'))
  initiateReturn(
    @Param('id') id: string,
    @Body() dto: InitiateDepositReturnDto,
    @Req() req: any,
  ) {
    this.assertAdmin(req);
    const actor: ApprovalActorContext = {
      actorType: 'ADMIN',
      userId: req.user?.userId,
      userNo: req.user?.userNo,
      role: req.user?.role,
      roleCodes: req.user?.roleCodes || (req.user?.role ? [req.user.role] : []),
    };
    return this.workflow.initiateReturn(id, { reason: dto.reason }, actor);
  }

  // 平账 B 批 ②：认领一笔已 SUCCESS 的入金被银行/托管方事后退汇——CFO maker-checker，
  // 与 supplement 同形状(静态段在前、:depositNo 段在后，排在 :id/return 之后按本文件惯例)。
  @Post(':depositNo/clawback')
  @ApiOperation({ summary: 'Recon Batch B ②: claim a deposit clawed back by the bank (CFO maker-checker)' })
  @RequirePermissions(buildPermissionCode('POST', '/deposit-transactions/:depositNo/clawback'))
  initiateClawback(@Param('depositNo') depositNo: string, @Body() dto: InitiateDepositClawbackDto, @Req() req: any) {
    this.assertAdmin(req);
    const actor: ApprovalActorContext = {
      actorType: 'ADMIN',
      userId: req.user?.userId,
      userNo: req.user?.userNo,
      role: req.user?.role,
      roleCodes: req.user?.roleCodes || (req.user?.role ? [req.user.role] : []),
    };
    return this.workflow.initiateClawback(depositNo, dto, actor);
  }

  @Post(':id/seize')
  @ApiOperation({ summary: 'Seize a frozen deposit under government order (maker-checker approval)' })
  seize(
    @Param('id') id: string,
    @Body() body: { reason?: string; orderRef?: string },
    @Req() req: any,
  ) {
    this.assertAdmin(req);
    const actor: ApprovalActorContext = {
      actorType: 'ADMIN',
      userId: req.user?.userId,
      userNo: req.user?.userNo,
      role: req.user?.role,
      roleCodes: req.user?.roleCodes || (req.user?.role ? [req.user.role] : []),
    };
    return this.workflow.initiateSeize(
      id,
      { reason: body?.reason ?? '', orderRef: body?.orderRef ?? '' },
      actor,
    );
  }

  @Post(':id/unfreeze')
  @ApiOperation({ summary: 'Unfreeze a frozen deposit under delisting/unfreeze order (maker-checker approval)' })
  unfreeze(
    @Param('id') id: string,
    @Body() body: { reason?: string; orderRef?: string },
    @Req() req: any,
  ) {
    this.assertAdmin(req);
    const actor: ApprovalActorContext = {
      actorType: 'ADMIN',
      userId: req.user?.userId,
      userNo: req.user?.userNo,
      role: req.user?.role,
      roleCodes: req.user?.roleCodes || (req.user?.role ? [req.user.role] : []),
    };
    return this.workflow.initiateUnfreeze(
      id,
      { reason: body?.reason ?? '', orderRef: body?.orderRef ?? '' },
      actor,
    );
  }

  @Post(':depositNo/simulate-sla-timeout')
  @ApiOperation({ summary: 'Demo only: push this order\'s SLA deadline into the past so the next scan breaches it' })
  simulateSlaTimeout(@Param('depositNo') depositNo: string, @Req() req: any) {
    this.assertAdmin(req);
    return this.service.setSlaDeadlineByNo(depositNo, new Date(Date.now() - 1000), {
      actorId: req.user?.userId,
      actorRole: req.user?.role,
    });
  }

  @Get('export')
  @ApiOperation({ summary: 'Export deposit transactions' })
  @UsePipes(new ValidationPipe({ transform: true }))
  async export(@Query() query: DepositTransactionQueryDto) {
    // For simplicity, reusing findAll. In production, use stream/csv generator.
    // Front-end usually expects JSON or CSV file.
    // Requirement says "Add data export interface".
    // I will return the data and let frontend handle CSV conversion or return CSV string.
    // Returning JSON is easiest for now.
    const result = await this.service.findAll({ ...query, take: 10000 }); // Limit export
    return result.items;
  }
}
