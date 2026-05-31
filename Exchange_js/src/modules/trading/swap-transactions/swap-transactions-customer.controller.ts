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
import { AdminPermissionGuard } from 'src/modules/identity/access-control/admin-permission.guard';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { SwapTransactionsService } from './swap-transactions.service';
import { SwapWorkflowService } from './swap-workflow.service';
import { OnboardingService } from '../../identity/onboarding/onboarding.service';
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
    private readonly onboardingService: OnboardingService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('quotes')
  @ApiOperation({ summary: 'Create a firm quote for customer swap' })
  async createQuote(@Request() req: any, @Body() dto: CreateSwapQuoteDto) {
    await this.onboardingService.assertTradingEligibility(req.user.userId, 'SWAP');
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
    @Query('fromAssetId') fromAssetId: string,
    @Query('toAssetId') toAssetId: string,
    @Query('amount') amountRaw: string,
  ) {
    const amount = Number(amountRaw);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new BadRequestException('amount query parameter is required and must be > 0');
    }
    return this.swapTransactionsService.getExecutableRate(
      fromAssetId,
      toAssetId,
      { amount },
    );
  }

  @Post()
  @ApiOperation({
    summary: 'Create a new swap transaction from firm quote',
  })
  async create(@Request() req: any, @Body() dto: CreateSwapFromQuoteDto) {
    return this.swapWorkflowService.executeSwap(req.user.userId, dto.quoteId);
  }

  @Get('my')
  @ApiOperation({ summary: 'Get all swap transactions for current customer' })
  findMy(@Request() req: any, @Query() query: SwapTransactionQueryDto) {
    query.ownerId = req.user.userId;
    query.ownerType = 'CUSTOMER';
    return this.swapTransactionsService.findAll(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get swap transaction by ID' })
  async findOne(@Request() req: any, @Param('id') id: string) {
    const item = await this.swapTransactionsService.findOne(id);
    if (item.ownerId !== req.user.userId) {
      throw new Error('Unauthorized');
    }
    return item;
  }
}
