import {
  Controller,
  Get,
  Body,
  Param,
  Query,
  Patch,
  Post,
  UsePipes,
  ValidationPipe,
  UseGuards,
  Req,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { DepositTransactionsService } from './deposit-transactions.service';
import {
  DepositTransactionQueryDto,
  UpdateDepositTransactionStatusDto,
  DepositTransactionAction,
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
import { AdminPermissionGuard } from 'src/modules/identity/access-control/admin-permission.guard';
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

  // Fix 3 (final review): workflow-only actions carry funds/approval semantics that a
  // raw admin PATCH must never reach directly. `resume` would bypass the A2 MLRO
  // unfreeze approval; `seized_done`/`returned_done`/`confiscate_settle` would jump
  // straight to a terminal status with no ledger legs ever posted, stranding the
  // pending lock forever. Mirrors the existing ACCOUNTING_TERMINALS +
  // DEPOSIT_APPROVE_WORKFLOW_ONLY guard style in deposit-transactions.service.ts.
  private static readonly PATCH_STATUS_WORKFLOW_ONLY_ACTIONS = new Set<DepositTransactionAction>([
    DepositTransactionAction.RESUME,
    DepositTransactionAction.SEIZED_DONE,
    DepositTransactionAction.RETURNED_DONE,
    DepositTransactionAction.CONFISCATE_SETTLE,
  ]);

  @Patch(':id/status')
  @ApiOperation({ summary: 'Update deposit transaction status' })
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateDepositTransactionStatusDto,
    @Req() req: any,
  ) {
    const actor = {
      actorId: req.user?.userId,
      actorRole: req.user?.role,
    };
    switch (dto.action) {
      case DepositTransactionAction.APPROVE:
        return this.workflow.approveDeposit(id);
      case DepositTransactionAction.FREEZE:
        return this.workflow.adminFreeze(id, dto.reason, actor);
      default:
        if (DepositTransactionsController.PATCH_STATUS_WORKFLOW_ONLY_ACTIONS.has(dto.action)) {
          throw new BadRequestException({
            code: 'DEPOSIT_ACTION_WORKFLOW_ONLY',
            message: `Action '${dto.action}' must go through its workflow endpoint/approval, not a direct status patch.`,
            details: { action: dto.action },
          });
        }
        return this.service.updateStatus(id, dto, {
          sourcePlatform: 'ADMIN_API',
          actor: {
            actorType: 'ADMIN',
            actorId: req.user?.userId,
            actorRole: req.user?.role,
          },
        });
    }
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
