import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  Req,
  UseGuards,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AdminPermissionGuard } from '../../../modules/identity/access-control/admin-permission.guard';
import { RequirePermissions } from '../../../modules/identity/access-control/require-permissions.decorator';
import { buildPermissionCode } from '../../../modules/identity/access-control/permission-code.util';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { SwapTransactionsService } from './swap-transactions.service';
import { SwapWorkflowService } from './swap-workflow.service';
import {
  AdvanceSwapLegDto,
  CreateSwapTransactionDto,
  SanctionRefundSwapTransactionDto,
  SwapTransactionQueryDto,
  UnfreezeSwapTransactionDto,
} from './dto/swap-transaction.dto';
import { AdminSwapQuoteQueryDto } from './dto/swap-quote.dto';
import { SwapQuoteService } from '../swap-fee-level/swap-quote.service';
import { ApprovalActorContext } from '../../governance/approvals/constants/approval.constants';

@ApiTags('Admin - Swap Transactions')
@Controller('admin/swap-transactions')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
@ApiBearerAuth()
export class SwapTransactionsController {
  constructor(
    private readonly swapTransactionsService: SwapTransactionsService,
    private readonly swapQuoteService: SwapQuoteService,
    private readonly swapWorkflow: SwapWorkflowService,
  ) {}

  private assertAdmin(req: any) {
    if (req.user?.type !== 'ADMIN') {
      throw new ForbiddenException('Admin only');
    }
  }

  private toApprovalActor(req: any): ApprovalActorContext {
    return {
      actorType: 'ADMIN',
      userId: req.user?.userId,
      userNo: req.user?.userNo,
      role: req.user?.role,
      roleCodes: req.user?.roleCodes || (req.user?.role ? [req.user.role] : []),
    };
  }

  /** 铁律⑥ 对外用业务键：详情端点的路由参数是 swapNo，这里换成内部 id
   *  再传给 service（同 customers.controller.ts resolveCustomerId 的镜像约定）。 */
  private async resolveSwapId(swapNo: string): Promise<string> {
    const row = await this.swapTransactionsService.findByNo(swapNo);
    if (!row) throw new NotFoundException('Swap transaction not found');
    return row.id;
  }

  @Post()
  @ApiOperation({ summary: 'Create a new swap transaction' })
  async create(@Body() _createSwapTransactionDto: CreateSwapTransactionDto) {
    throw new ForbiddenException('Admin direct swap creation is disabled');
  }

  @Get()
  @ApiOperation({ summary: 'Get all swap transactions' })
  findAll(@Query() query: SwapTransactionQueryDto) {
    return this.swapTransactionsService.findAll(query);
  }

  @Get('quotes')
  @ApiOperation({ summary: 'List swap quotes' })
  findAllQuotes(@Query() query: AdminSwapQuoteQueryDto) {
    return this.swapQuoteService.findAllForAdmin(query);
  }

  @Get('quotes/:quoteNo')
  @ApiOperation({ summary: 'Get swap quote detail' })
  findOneQuote(@Param('quoteNo') quoteNo: string) {
    return this.swapQuoteService.findOneForAdmin(quoteNo);
  }

  @Post(':swapNo/legs/:legSeq/advance')
  @ApiOperation({ summary: 'Advance a swap settlement leg (manual simulate)' })
  @RequirePermissions(
    buildPermissionCode('POST', '/admin/swap-transactions/:swapNo/legs/:legSeq/advance'),
  )
  advanceSwapLeg(
    @Param('swapNo') swapNo: string,
    @Param('legSeq') legSeq: string,
    @Body() dto: AdvanceSwapLegDto,
    @Req() req: any,
  ) {
    return this.swapWorkflow.advanceLeg(
      swapNo,
      Number(legSeq),
      dto.action,
      req.user?.userNo || req.user?.sub || 'ADMIN',
    );
  }

  @Post(':swapNo/legs/:legSeq/resume')
  @ApiOperation({ summary: 'Resume a NEEDS_REVIEW (stuck) swap leg by creating a fresh attempt' })
  @RequirePermissions(
    buildPermissionCode('POST', '/admin/swap-transactions/:swapNo/legs/:legSeq/resume'),
  )
  resumeSwapLeg(
    @Param('swapNo') swapNo: string,
    @Param('legSeq') legSeq: string,
    @Req() req: any,
  ) {
    const op = req.user?.userNo || req.user?.sub || 'ADMIN';
    return this.swapWorkflow.resumeLeg(swapNo, Number(legSeq), op);
  }

  @Post(':swapNo/simulate-sla-timeout')
  @ApiOperation({ summary: 'Demo only: push this order\'s SLA deadline into the past so the next scan breaches it' })
  @RequirePermissions(
    buildPermissionCode('POST', '/admin/swap-transactions/:swapNo/simulate-sla-timeout'),
  )
  simulateSlaTimeout(@Param('swapNo') swapNo: string, @Req() req: any) {
    this.assertAdmin(req);
    return this.swapTransactionsService.setSlaDeadlineByNo(swapNo, new Date(Date.now() - 1000), {
      actorId: req.user?.userId,
      actorRole: req.user?.role,
    });
  }

  @Post(':id/unfreeze')
  @ApiOperation({ summary: 'Unfreeze a FROZEN swap transaction under delisting/unfreeze order (maker-checker approval)' })
  @RequirePermissions(
    buildPermissionCode('POST', '/admin/swap-transactions/:id/unfreeze'),
  )
  unfreeze(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: UnfreezeSwapTransactionDto,
  ) {
    this.assertAdmin(req);
    return this.swapWorkflow.initiateUnfreeze(
      id,
      { orderRef: dto.orderRef, reason: dto.reason },
      this.toApprovalActor(req),
    );
  }

  @Post(':id/refund')
  @ApiOperation({ summary: 'Refund a FROZEN swap transaction to sender under sanction disposition (maker-checker approval)' })
  @RequirePermissions(
    buildPermissionCode('POST', '/admin/swap-transactions/:id/refund'),
  )
  refund(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: SanctionRefundSwapTransactionDto,
  ) {
    this.assertAdmin(req);
    return this.swapWorkflow.initiateRefund(
      id,
      { reason: dto.reason },
      this.toApprovalActor(req),
    );
  }

  @Get(':swapNo')
  @ApiOperation({ summary: 'Get swap transaction by swap number' })
  async findOne(@Param('swapNo') swapNo: string) {
    // Admin detail — includes parsed Sumsub compliance fields (Task 10);
    // customer-facing detail stays on the plain findOne (see that method's
    // customer controller usage) so those fields never leak to the client.
    const id = await this.resolveSwapId(swapNo);
    return this.swapTransactionsService.findOneForAdmin(id);
  }
}
