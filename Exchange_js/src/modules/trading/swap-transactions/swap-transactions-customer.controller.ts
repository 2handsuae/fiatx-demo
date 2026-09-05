import {
  BadRequestException,
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AdminPermissionGuard } from '../../../modules/identity/access-control/admin-permission.guard';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { SwapTransactionsService } from './swap-transactions.service';
import { SwapWorkflowService } from './swap-workflow.service';
import { CustomerAccessService } from '../../identity/customers/customer-access.service';
import {
  SwapTransactionQueryDto,
} from './dto/swap-transaction.dto';
import {
  CancelSwapQuoteDto,
  CreateSwapFromQuoteDto,
  CreateSwapQuoteDto,
} from './dto/swap-quote.dto';
import { Prisma, SwapQuote } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { SwapQuoteService } from '../swap-fee-level/swap-quote.service';

@ApiTags('Customer - Swap Transactions')
@Controller('swap-transactions')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
@ApiBearerAuth()
export class SwapTransactionsCustomerController {
  constructor(
    private readonly swapTransactionsService: SwapTransactionsService,
    private readonly swapQuoteService: SwapQuoteService,
    private readonly swapWorkflowService: SwapWorkflowService,
    private readonly customerAccess: CustomerAccessService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('quotes')
  @ApiOperation({ summary: 'Create a firm quote for customer swap' })
  async createQuote(@Request() req: any, @Body() dto: CreateSwapQuoteDto) {
    await this.customerAccess.assertTradingEligibility(req.user.userId, 'SWAP');
    const fromAmount = new Prisma.Decimal(dto.fromAmount);
    if (fromAmount.lte(0)) {
      throw new BadRequestException('fromAmount must be greater than 0');
    }
    const [fromAsset, toAsset] = await Promise.all([
      this.prisma.asset.findUnique({ where: { id: dto.fromAssetId } }),
      this.prisma.asset.findUnique({ where: { id: dto.toAssetId } }),
    ]);
    if (!fromAsset || !toAsset) {
      throw new BadRequestException('Asset not found');
    }
    const ownerNo = await this.swapQuoteService.resolveOwnerNo('CUSTOMER', req.user.userId);
    const quote = await this.swapQuoteService.createQuote({
      ownerType: 'CUSTOMER',
      ownerId: req.user.userId,
      ownerNo: ownerNo ?? undefined,
      fromAssetId: fromAsset.id,
      fromAssetCode: fromAsset.currency,
      toAssetId: toAsset.id,
      toAssetCode: toAsset.currency,
      amount: fromAmount,
      customerId: req.user.userId,
    });
    return this.toCustomerQuoteResponse(quote);
  }

  private parseJson<T>(value: string | null | undefined, fallback: T): T {
    if (!value) return fallback;
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }

  private toCustomerQuoteResponse(quote: SwapQuote) {
    const totals = this.parseJson<Record<string, string>>(quote.totalsJson, {});
    const netAmountOut = Number(totals.amountOutNet ?? quote.amountOut);
    return {
      quoteId: quote.id,
      quoteNo: quote.quoteNo,
      quoteType: quote.quoteType,
      status: quote.status,
      createdAt: quote.createdAt,
      expiresAt: quote.expiresAt,
      usedAt: quote.usedAt,
      baseCurrency: quote.fromAssetCode,
      quoteCurrency: quote.toAssetCode,
      side: quote.side,
      amountType: quote.amountType,
      amountIn: Number(quote.amountIn),
      currencyIn: quote.currencyIn,
      amountOut: Number(quote.amountOut),
      netAmountOut,
      currencyOut: quote.currencyOut,
      rateDisplay: Number(quote.rateDisplay),
      rateAllIn: Number(quote.rateAllIn),
      marketRate: Number(quote.marketRate),
      spreadPercent: Number(quote.spreadPercent),
      spreadBps: quote.spreadBps,
      rateSource: quote.rateSource,
      fetchedAt: quote.fetchedAt,
      feeTotal: Number(quote.feeTotal),
      feeCurrency: quote.feeCurrency,
      feeBreakdown: this.parseJson<unknown[]>(quote.feeBreakdown, []),
    };
  }

  @Post('quotes/:id/cancel')
  @ApiOperation({ summary: 'Cancel an active customer quote' })
  cancelQuote(
    @Request() req: any,
    @Param('id') id: string,
    @Body() _dto?: CancelSwapQuoteDto,
  ) {
    return this.swapQuoteService.cancelQuote(
      id,
      'CUSTOMER',
      req.user.userId,
    );
  }

  @Get('rate')
  @ApiOperation({ summary: 'Get executable swap rate for an asset pair' })
  getRate(
    @Request() req: any,
    @Query('fromAssetId') fromAssetId: string,
    @Query('toAssetId') toAssetId: string,
    @Query('amount') amountRaw: string,
  ) {
    const amount = Number(amountRaw);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new BadRequestException('amount query parameter is required and must be > 0');
    }
    // 波二·岔口 4：预览与确认同一身份——resolveBestLevel 按客户标签选档，缺身份就永远落默认档（BACKLOG:20）
    return this.swapTransactionsService.getExecutableRate(fromAssetId, toAssetId, {
      amount,
      ownerType: 'CUSTOMER',
      ownerId: req.user.userId,
    });
  }

  @Post()
  @ApiOperation({
    summary: 'Create a new swap transaction from firm quote',
  })
  async create(@Request() req: any, @Body() dto: CreateSwapFromQuoteDto) {
    return this.swapWorkflowService.initiateSwap(req.user.userId, dto.quoteId);
  }

  @Get('my')
  @ApiOperation({ summary: 'Get all swap transactions for current customer' })
  findMy(@Request() req: any, @Query() query: SwapTransactionQueryDto) {
    return this.swapTransactionsService.findAllForCustomer(req.user.userId, query);
  }

  // ⚠️ 路由声明顺序：`my/:swapNo` 必须写在 `my` **之后**、`:id` 之前。Nest 按
  // 声明先后匹配，先声明的先赢——详情见 deposit-transactions.controller.ts
  // 同址（`my/:depositNo` 在 `:id` 之前）与 customer-withdraw.controller.ts。
  @Get('my/:swapNo')
  @ApiOperation({ summary: 'Get my swap transaction detail by swapNo (customer)' })
  findMyOne(@Request() req: any, @Param('swapNo') swapNo: string) {
    return this.swapTransactionsService.findOneForCustomerBySwapNo(swapNo, req.user.userId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get swap transaction by ID' })
  findOne(@Request() req: any, @Param('id') id: string) {
    return this.swapTransactionsService.findOneForCustomer(id, req.user.userId);
  }
}
