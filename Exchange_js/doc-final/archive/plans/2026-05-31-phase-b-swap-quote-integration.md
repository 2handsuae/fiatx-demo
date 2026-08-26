# Phase B: SwapQuoteService Integration + PricingCenterService Elimination — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete SwapQuoteService as the sole swap quote owner (with Binance rate fetching + full pricing), migrate all callers away from PricingCenterService, then delete PricingCenterService (2926 lines).

**Architecture:** SwapQuoteService gains BinanceRateProvider + AuditLogsService injections to become a fully self-contained quote service. All swap-side callers (customer controller, orchestrator, admin controller) switch to SwapQuoteService. Withdrawal-side callers inline their 2 trivial PricingCenterService calls. PricingCenterModule retains only PricingEngineService + BinanceRateProvider as utility exports.

**Tech Stack:** NestJS, Prisma, TypeScript, React

---

### Task 1: Complete SwapQuoteService — Full Quote Creation with Binance Rates

**Files:**
- Modify: `src/modules/trading/swap-fee-level/swap-quote.service.ts`
- Modify: `src/modules/trading/swap-fee-level/swap-fee-level.module.ts`

The current `createQuote()` sets `amountOut=0, rateAllIn=0, marketRate=0`. We need to:
1. Inject `BinanceRateProvider` + `AuditLogsService`
2. Fetch market rate from Binance
3. Call `PricingEngineService.buildSwapQuote()` to calculate amountOut, apply spread, compute fees
4. Create SwapQuote with full pricing data + unique quoteNo retry
5. Record audit log
6. Add admin query methods (`findAllForAdmin`, `findOneForAdmin`)
7. Add `resolveOwnerNo()` private helper

- [ ] **Step 1: Rewrite swap-quote.service.ts**

Replace the entire file `src/modules/trading/swap-fee-level/swap-quote.service.ts` with:

```typescript
import { Injectable, Inject, Logger, NotFoundException, BadRequestException, forwardRef } from '@nestjs/common';
import { Prisma, SwapQuote } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { PricingEngineService } from '../pricing-center/pricing-engine.service';
import { BinanceRateProvider } from '../pricing-center/providers/binance-rate.provider';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import {
  AuditActions,
  AuditEntityTypes,
  AuditResult,
} from '../../audit-logging/constants/audit-actions.constant';
import { CalculatedFeeLine } from '../pricing-center/types/pricing.types';
import { SwapFeeLevelService } from './swap-fee-level.service';
import { SwapFeeLevelBindingService } from './swap-fee-level-binding.service';
import { SwapFeeLevelTiersConfig } from './types/fee-level.types';

const SWAP_QUOTE_TTL_SECONDS = 30;
const QUOTE_NO_MAX_RETRIES = 5;

export interface ResolvedSwapLevel {
  feeLevelId: string;
  feeLevelCode: string;
  matchedTierId: string;
  matchedTierName: string;
  rateMarkupBps: number;
  feeItems: any[];
  fees: CalculatedFeeLine[];
  totals: Record<string, string>;
  totalFee: Prisma.Decimal;
}

@Injectable()
export class SwapQuoteService {
  private readonly logger = new Logger(SwapQuoteService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly feeLevelService: SwapFeeLevelService,
    private readonly bindingService: SwapFeeLevelBindingService,
    @Inject(forwardRef(() => PricingEngineService))
    private readonly engineService: PricingEngineService,
    @Inject(forwardRef(() => BinanceRateProvider))
    private readonly binanceRateProvider: BinanceRateProvider,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  /* ── Fee Level Resolution ─────────────────────────────────── */

  async resolveBestLevel(input: {
    fromAssetId: string;
    toAssetId: string;
    amount: Prisma.Decimal;
    customerId: string;
  }): Promise<ResolvedSwapLevel | null> {
    const allLevels = await this.feeLevelService.findActiveByPair(input.fromAssetId, input.toAssetId);
    if (allLevels.length === 0) return null;

    const boundLevelIds = await this.bindingService.findBoundLevelIds(input.customerId);
    const boundSet = new Set(boundLevelIds);

    const applicableLevels = allLevels.filter(
      (l) => l.isDefault || boundSet.has(l.id),
    );
    if (applicableLevels.length === 0) return null;

    const candidates: ResolvedSwapLevel[] = [];

    for (const level of applicableLevels) {
      const config: SwapFeeLevelTiersConfig = JSON.parse(level.tiersJson);
      const matchedTier = this.engineService.findMatchedSwapTier({
        amount: input.amount,
        tiers: config.tiers,
      });
      if (!matchedTier) continue;

      const feeItems = matchedTier.feeItems || [];
      const { lines, totals } = this.engineService.calculateFeeLines(
        input.amount,
        feeItems,
      );

      const totalFee = lines.reduce(
        (sum, line) => sum.add(new Prisma.Decimal(line.amount)),
        new Prisma.Decimal(0),
      );

      candidates.push({
        feeLevelId: level.id,
        feeLevelCode: level.levelCode,
        matchedTierId: matchedTier.id,
        matchedTierName: matchedTier.name,
        rateMarkupBps: matchedTier.rateMarkupBps ?? 0,
        feeItems,
        fees: lines,
        totals,
        totalFee,
      });
    }

    if (candidates.length === 0) return null;
    candidates.sort((a, b) => a.totalFee.comparedTo(b.totalFee));
    return candidates[0];
  }

  /* ── Quote Creation ───────────────────────────────────────── */

  async createQuote(input: {
    ownerType: string;
    ownerId: string;
    ownerNo?: string;
    fromAssetId: string;
    fromAssetCode: string;
    toAssetId: string;
    toAssetCode: string;
    amount: Prisma.Decimal;
    customerId: string;
  }): Promise<SwapQuote> {
    const resolved = await this.resolveBestLevel({
      fromAssetId: input.fromAssetId,
      toAssetId: input.toAssetId,
      amount: input.amount,
      customerId: input.customerId,
    });

    if (!resolved) {
      throw new BadRequestException('No applicable fee level found for this currency pair and amount');
    }

    // Fetch market rate from Binance
    const rateResult = await this.binanceRateProvider.fetchRate(input.fromAssetCode, input.toAssetCode);
    const now = new Date();

    // Build full swap quote via pricing engine
    const pricingResult = this.engineService.buildSwapQuote({
      amount: input.amount,
      baseRate: rateResult.rate,
      markupBps: resolved.rateMarkupBps,
      roundingDp: 8,
      roundingMode: 'ROUND',
      quoteLockSeconds: SWAP_QUOTE_TTL_SECONDS,
      fees: resolved.feeItems,
      createdAt: now,
      pairId: `${input.fromAssetCode}-${input.toAssetCode}`,
      pairName: `${input.fromAssetCode}/${input.toAssetCode}`,
      tierId: resolved.matchedTierId,
      tierName: resolved.matchedTierName,
      baseProvider: 'BINANCE',
      policyCode: `LEVEL:${resolved.feeLevelCode}`,
      policyId: resolved.feeLevelId,
    });

    const marketRate = rateResult.rate;
    const rateAllIn = new Prisma.Decimal(pricingResult.fx.quotedRate);
    const grossAmountOut = new Prisma.Decimal(pricingResult.grossAmountOut);
    const feeTotal = new Prisma.Decimal(pricingResult.feeTotal);
    const feeCurrency = pricingResult.feeCurrency || input.toAssetCode;
    const spreadPercent = new Prisma.Decimal(resolved.rateMarkupBps).div(100);

    const feeBreakdown = JSON.stringify([{
      policyRef: pricingResult.policyRef,
      matched: pricingResult.matched,
      fx: pricingResult.fx,
      fees: pricingResult.fees,
      totals: pricingResult.totals,
    }]);

    const pricingSource = {
      provider: 'BINANCE',
      symbol: rateResult.symbol,
      bid: rateResult.bid,
      ask: rateResult.ask,
      sideUsed: rateResult.sideUsed,
      aedPegApplied: rateResult.aedPegApplied,
      aedPegRate: rateResult.aedPegRate,
      formula: rateResult.formula,
      effectiveBaseRate: rateResult.rate.toString(),
      fetchedAt: rateResult.fetchedAt.toISOString(),
    };

    const expiresAt = new Date(pricingResult.expiresAt);

    // Create with unique quoteNo (retry on collision)
    const created = await this.createWithUniqueNo({
      quoteType: 'FIRM',
      status: 'ACTIVE',
      ownerType: input.ownerType,
      ownerId: input.ownerId,
      ownerNo: input.ownerNo || null,
      fromAssetId: input.fromAssetId,
      fromAssetCode: input.fromAssetCode,
      toAssetId: input.toAssetId,
      toAssetCode: input.toAssetCode,
      side: 'SELL_BASE',
      amountType: 'EXACT_IN',
      amountIn: input.amount,
      currencyIn: input.fromAssetCode,
      amountOut: grossAmountOut,
      currencyOut: input.toAssetCode,
      rateDisplay: rateAllIn,
      rateAllIn,
      marketRate,
      spreadPercent,
      spreadBps: resolved.rateMarkupBps,
      rateSource: 'BINANCE',
      fetchedAt: rateResult.fetchedAt,
      feeTotal,
      feeCurrency,
      feeBreakdown,
      totalsJson: JSON.stringify(pricingResult.totals),
      policyRef: JSON.stringify({ ...pricingResult.policyRef, pricingSource }),
      expiresAt,
      feeLevelId: resolved.feeLevelId,
      feeLevelCode: resolved.feeLevelCode,
    });

    await this.auditLogsService.recordByActor(
      {
        action: AuditActions.SWAP_QUOTE_CREATED,
        entityType: AuditEntityTypes.SWAP_QUOTE,
        entityId: created.id,
        entityNo: created.quoteNo || undefined,
        entityOwnerType: created.ownerType,
        entityOwnerId: created.ownerId,
        entityOwnerNo: created.ownerNo || undefined,
        result: AuditResult.SUCCESS,
        reason: 'Swap quote created',
        sourcePlatform: input.ownerType === 'CUSTOMER' ? 'CUSTOMER_API' : 'SYSTEM',
      },
      {
        actorType: input.ownerType,
        userId: input.ownerId,
      },
    );

    return created;
  }

  /* ── Quote Lifecycle ──────────────────────────────────────── */

  async getActiveQuoteOrThrow(
    quoteId: string,
    ownerType: string,
    ownerId: string,
    now: Date,
    tx?: Prisma.TransactionClient,
  ): Promise<SwapQuote> {
    const db = tx ?? this.prisma;
    const quote = await db.swapQuote.findUnique({ where: { id: quoteId } });
    if (!quote) throw new NotFoundException(`Quote ${quoteId} not found`);
    if (quote.ownerType !== ownerType || quote.ownerId !== ownerId) {
      throw new BadRequestException('Quote does not belong to this owner');
    }
    if (quote.status !== 'ACTIVE') {
      throw new BadRequestException(`Quote is ${quote.status}, not ACTIVE`);
    }
    if (quote.expiresAt < now) {
      await this.markExpired(quoteId, db);
      throw new BadRequestException('Quote has expired');
    }
    return quote;
  }

  async consumeQuote(
    quoteId: string,
    ownerType: string,
    ownerId: string,
    amount: Prisma.Decimal,
    tx?: Prisma.TransactionClient,
  ): Promise<SwapQuote> {
    const db = tx ?? this.prisma;
    const now = new Date();
    const quote = await this.getActiveQuoteOrThrow(quoteId, ownerType, ownerId, now, db as any);

    if (!quote.amountIn.equals(amount)) {
      throw new BadRequestException(
        `Quote amount ${quote.amountIn} does not match input amount ${amount}`,
      );
    }

    const updated = await db.swapQuote.update({
      where: { id: quoteId },
      data: { status: 'USED', usedAt: now },
    });

    await this.auditLogsService.recordByActor(
      {
        action: AuditActions.SWAP_QUOTE_USED,
        entityType: AuditEntityTypes.SWAP_QUOTE,
        entityId: quoteId,
        entityNo: quote.quoteNo || undefined,
        entityOwnerType: quote.ownerType,
        entityOwnerId: quote.ownerId,
        entityOwnerNo: quote.ownerNo || undefined,
        result: AuditResult.SUCCESS,
        reason: 'Swap quote consumed for swap transaction',
        sourcePlatform: 'SYSTEM',
      },
      { actorType: 'SYSTEM', userId: 'SYSTEM' },
    );

    return updated;
  }

  async cancelQuote(
    quoteId: string,
    ownerType: string,
    ownerId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<SwapQuote> {
    const db = tx ?? this.prisma;
    const quote = await db.swapQuote.findUnique({ where: { id: quoteId } });
    if (!quote) throw new NotFoundException(`Quote ${quoteId} not found`);
    if (quote.ownerType !== ownerType || quote.ownerId !== ownerId) {
      throw new BadRequestException('Quote does not belong to this owner');
    }
    if (quote.status !== 'ACTIVE') {
      throw new BadRequestException(`Quote is ${quote.status}, cannot cancel`);
    }
    const now = new Date();
    const updated = await db.swapQuote.update({
      where: { id: quoteId },
      data: { status: 'CANCELLED', cancelledAt: now },
    });

    await this.auditLogsService.recordByActor(
      {
        action: AuditActions.SWAP_QUOTE_CANCELLED,
        entityType: AuditEntityTypes.SWAP_QUOTE,
        entityId: quoteId,
        entityNo: quote.quoteNo || undefined,
        entityOwnerType: quote.ownerType,
        entityOwnerId: quote.ownerId,
        entityOwnerNo: quote.ownerNo || undefined,
        result: AuditResult.SUCCESS,
        reason: 'Swap quote cancelled by owner',
        sourcePlatform: ownerType === 'CUSTOMER' ? 'CUSTOMER_API' : 'SYSTEM',
      },
      { actorType: ownerType, userId: ownerId },
    );

    return updated;
  }

  /* ── Admin Queries ────────────────────────────────────────── */

  async findAllForAdmin(query: {
    status?: string;
    quoteNo?: string;
    ownerNo?: string;
    skip?: number;
    take?: number;
  }) {
    const where: Prisma.SwapQuoteWhereInput = {};
    if (query.status) where.status = query.status;
    if (query.quoteNo) where.quoteNo = { contains: query.quoteNo };
    if (query.ownerNo) where.ownerNo = { contains: query.ownerNo };

    const [items, total] = await Promise.all([
      this.prisma.swapQuote.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: query.skip || 0,
        take: query.take || 20,
        include: { fromAsset: true, toAsset: true },
      }),
      this.prisma.swapQuote.count({ where }),
    ]);

    return { items, total };
  }

  async findOneForAdmin(id: string) {
    const quote = await this.prisma.swapQuote.findUnique({
      where: { id },
      include: {
        fromAsset: true,
        toAsset: true,
        swapTransaction: true,
      },
    });
    if (!quote) throw new NotFoundException(`Quote ${id} not found`);
    return quote;
  }

  /* ── Helpers ──────────────────────────────────────────────── */

  async resolveOwnerNo(ownerType: string, ownerId: string): Promise<string | null> {
    if (ownerType === 'CUSTOMER') {
      const customer = await this.prisma.customerMain.findUnique({
        where: { id: ownerId },
        select: { customerNo: true },
      });
      return customer?.customerNo || null;
    }
    if (ownerType === 'ADMIN') {
      const admin = await this.prisma.user.findUnique({
        where: { id: ownerId },
        select: { userNo: true },
      });
      return admin?.userNo || null;
    }
    return null;
  }

  private async markExpired(
    quoteId: string,
    db: Prisma.TransactionClient | PrismaService,
  ) {
    try {
      await db.swapQuote.update({
        where: { id: quoteId },
        data: { status: 'EXPIRED' },
      });
    } catch {
      this.logger.warn(`Failed to mark quote ${quoteId} as expired`);
    }
  }

  private isUniqueConstraintError(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    );
  }

  private async createWithUniqueNo(
    data: Omit<Prisma.SwapQuoteUncheckedCreateInput, 'quoteNo'>,
  ): Promise<SwapQuote> {
    for (let attempt = 0; attempt < QUOTE_NO_MAX_RETRIES; attempt++) {
      const quoteNo = `SQ-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      try {
        return await this.prisma.swapQuote.create({
          data: { ...data, quoteNo },
        });
      } catch (error) {
        if (this.isUniqueConstraintError(error) && attempt < QUOTE_NO_MAX_RETRIES - 1) {
          continue;
        }
        throw error;
      }
    }
    throw new Error('Failed to generate unique quoteNo after retries');
  }
}
```

- [ ] **Step 2: Update swap-fee-level.module.ts**

In `src/modules/trading/swap-fee-level/swap-fee-level.module.ts`, add BinanceRateProvider injection. The module already imports PricingCenterModule (which exports BinanceRateProvider) and AuditLogsModule, so no new imports needed. Just verify it compiles.

- [ ] **Step 3: Verify build**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/modules/trading/swap-fee-level/swap-quote.service.ts src/modules/trading/swap-fee-level/swap-fee-level.module.ts
git commit -m "feat: complete SwapQuoteService with Binance rate fetching, full pricing, and admin queries"
```

---

### Task 2: Migrate Swap Customer Controller to SwapQuoteService

**Files:**
- Modify: `src/modules/trading/swap-transactions/swap-transactions-customer.controller.ts`

- [ ] **Step 1: Replace PricingCenterService with SwapQuoteService**

Replace `src/modules/trading/swap-transactions/swap-transactions-customer.controller.ts` with:

```typescript
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
import { Prisma } from '@prisma/client';
import { AuthGuard } from '@nestjs/passport';
import { AdminPermissionGuard } from 'src/modules/identity/access-control/admin-permission.guard';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { SwapTransactionsService } from './swap-transactions.service';
import { SwapWorkflowOrchestrator } from './swap-workflow.orchestrator';
import { OnboardingService } from '../../identity/onboarding/onboarding.service';
import { SwapTransactionQueryDto } from './dto/swap-transaction.dto';
import {
  CancelSwapQuoteDto,
  CreateSwapFromQuoteDto,
  CreateSwapQuoteDto,
} from './dto/swap-quote.dto';
import { SwapQuoteService } from '../swap-fee-level/swap-quote.service';
import { PrismaService } from '../../../core/prisma/prisma.service';

@ApiTags('Customer - Swap Transactions')
@Controller('swap-transactions')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
@ApiBearerAuth()
export class SwapTransactionsCustomerController {
  constructor(
    private readonly swapTransactionsService: SwapTransactionsService,
    private readonly swapQuoteService: SwapQuoteService,
    private readonly orchestrator: SwapWorkflowOrchestrator,
    private readonly onboardingService: OnboardingService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('quotes')
  @ApiOperation({ summary: 'Create a firm quote for customer swap' })
  async createQuote(@Request() req: any, @Body() dto: CreateSwapQuoteDto) {
    const ownerId = req.user.userId;
    await this.onboardingService.assertTradingEligibility(ownerId, 'SWAP');

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

    const ownerNo = await this.swapQuoteService.resolveOwnerNo('CUSTOMER', ownerId);

    const quote = await this.swapQuoteService.createQuote({
      ownerType: 'CUSTOMER',
      ownerId,
      ownerNo: ownerNo ?? undefined,
      fromAssetId: fromAsset.id,
      fromAssetCode: fromAsset.currency,
      toAssetId: toAsset.id,
      toAssetCode: toAsset.currency,
      amount: fromAmount,
      customerId: ownerId,
    });

    return {
      quoteId: quote.id,
      quoteNo: quote.quoteNo,
      status: quote.status,
      fromAssetCode: quote.fromAssetCode,
      toAssetCode: quote.toAssetCode,
      amountIn: quote.amountIn.toString(),
      amountOut: quote.amountOut.toString(),
      rateAllIn: quote.rateAllIn.toString(),
      marketRate: quote.marketRate.toString(),
      spreadBps: quote.spreadBps,
      feeTotal: quote.feeTotal.toString(),
      feeCurrency: quote.feeCurrency,
      createdAt: quote.createdAt,
      expiresAt: quote.expiresAt,
    };
  }

  @Post('quotes/:id/cancel')
  @ApiOperation({ summary: 'Cancel an active customer quote' })
  cancelQuote(
    @Request() req: any,
    @Param('id') id: string,
    @Body() _dto?: CancelSwapQuoteDto,
  ) {
    return this.swapQuoteService.cancelQuote(id, 'CUSTOMER', req.user.userId);
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
    return this.swapTransactionsService.getExecutableRate(fromAssetId, toAssetId, { amount });
  }

  @Post()
  @ApiOperation({ summary: 'Create a new swap transaction from firm quote' })
  async create(@Request() req: any, @Body() dto: CreateSwapFromQuoteDto) {
    const ownerId = req.user.userId;
    await this.onboardingService.assertTradingEligibility(ownerId, 'SWAP');
    return this.orchestrator.createSwapFromQuote(ownerId, dto.quoteId);
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
```

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors (PricingCenterService still exists, just not imported here).

- [ ] **Step 3: Commit**

```bash
git add src/modules/trading/swap-transactions/swap-transactions-customer.controller.ts
git commit -m "refactor: migrate swap customer controller from PricingCenterService to SwapQuoteService"
```

---

### Task 3: Migrate Swap Orchestrator to SwapQuoteService

**Files:**
- Modify: `src/modules/trading/swap-transactions/swap-workflow.orchestrator.ts`

- [ ] **Step 1: Replace PricingCenterService calls**

In `src/modules/trading/swap-transactions/swap-workflow.orchestrator.ts`:

1. Replace import: `import { PricingCenterService } from '../pricing-center/pricing-center.service';` → `import { SwapQuoteService } from '../swap-fee-level/swap-quote.service';`

2. Replace constructor injection: `private readonly pricingCenterService: PricingCenterService` → `private readonly swapQuoteService: SwapQuoteService`

3. In `createSwapFromQuote()`, replace:
```typescript
const quote = await this.pricingCenterService.getActiveSwapQuoteOrThrow(
  quoteId, 'CUSTOMER', ownerId, now, tx,
);
```
with:
```typescript
const quote = await this.swapQuoteService.getActiveQuoteOrThrow(
  quoteId, 'CUSTOMER', ownerId, now, tx,
);
```

4. Delete the `assertSwapProductAllowedForOwner` call entirely (lines ~195-202).

5. Replace:
```typescript
await this.pricingCenterService.consumeSwapQuoteForSwap(
  tx, quote.id, 'CUSTOMER', ownerId, now,
);
```
with:
```typescript
await this.swapQuoteService.consumeQuote(
  quote.id, 'CUSTOMER', ownerId, new Prisma.Decimal(quote.amountIn), tx,
);
```

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/modules/trading/swap-transactions/swap-workflow.orchestrator.ts
git commit -m "refactor: migrate swap orchestrator from PricingCenterService to SwapQuoteService"
```

---

### Task 4: Migrate Swap Admin Controller + SwapTransactionsService

**Files:**
- Modify: `src/modules/trading/swap-transactions/swap-transactions.controller.ts`
- Modify: `src/modules/trading/swap-transactions/swap-transactions.service.ts`

- [ ] **Step 1: Update swap admin controller**

In `src/modules/trading/swap-transactions/swap-transactions.controller.ts`:

1. Replace import: `import { PricingCenterService } from '../pricing-center/pricing-center.service';` → `import { SwapQuoteService } from '../swap-fee-level/swap-quote.service';`
2. Remove: `import { PricingQuoteBusiness } from '../pricing-center/dto/pricing-center.dto';`
3. Replace constructor: `private readonly pricingCenterService: PricingCenterService` → `private readonly swapQuoteService: SwapQuoteService`
4. Replace `findAllQuotes`:
```typescript
@Get('quotes')
@ApiOperation({ summary: 'List swap quotes' })
findAllQuotes(@Query() query: AdminSwapQuoteQueryDto) {
  return this.swapQuoteService.findAllForAdmin(query);
}
```
5. Replace `findOneQuote`:
```typescript
@Get('quotes/:id')
@ApiOperation({ summary: 'Get swap quote detail' })
findOneQuote(@Param('id') id: string) {
  return this.swapQuoteService.findOneForAdmin(id);
}
```

- [ ] **Step 2: Update swap-transactions.service.ts**

In `src/modules/trading/swap-transactions/swap-transactions.service.ts`:

1. Replace import: `import { PricingCenterService } from '../pricing-center/pricing-center.service';` → `import { SwapQuoteService } from '../swap-fee-level/swap-quote.service';`
2. Replace constructor: `private readonly pricingCenterService: PricingCenterService` → `private readonly swapQuoteService: SwapQuoteService`
3. In `getExecutableRate()`, replace the `pricingCenterService.resolveSwapQuoteForExecution()` call with `swapQuoteService.resolveBestLevel()` and adapt the return shape. The existing method builds a large response object from the resolved data — adapt field names to match the new `ResolvedSwapLevel` interface. For the rate preview, also call `binanceRateProvider.fetchRate()` directly or inject it.

Note: The `getExecutableRate()` method is for the ephemeral `GET /rate` endpoint (no quote creation). It needs rate data that `resolveBestLevel` alone doesn't provide. The simplest fix: inject `BinanceRateProvider` into SwapTransactionsService and call it alongside `resolveBestLevel()`.

- [ ] **Step 3: Verify build**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/modules/trading/swap-transactions/swap-transactions.controller.ts src/modules/trading/swap-transactions/swap-transactions.service.ts
git commit -m "refactor: migrate swap admin controller and service from PricingCenterService"
```

---

### Task 5: Update SwapTransactionsModule Wiring

**Files:**
- Modify: `src/modules/trading/swap-transactions/swap-transactions.module.ts`

- [ ] **Step 1: Replace PricingCenterModule with SwapFeeLevelModule**

Replace `src/modules/trading/swap-transactions/swap-transactions.module.ts`:

```typescript
import { Module, forwardRef } from '@nestjs/common';
import { SwapTransactionsService } from './swap-transactions.service';
import { SwapWorkflowOrchestrator } from './swap-workflow.orchestrator';
import { SwapTransactionsController } from './swap-transactions.controller';
import { SwapTransactionsCustomerController } from './swap-transactions-customer.controller';
import { PrismaModule } from '../../../core/prisma/prisma.module';
import { OnboardingModule } from '../../identity/onboarding/onboarding.module';
import { OutstandingsModule } from '../../clearing-settle/outstandings/outstandings.module';
import { SwapFeeLevelModule } from '../swap-fee-level/swap-fee-level.module';
import { PricingCenterModule } from '../pricing-center/pricing-center.module';
import { TransactionComplianceModule } from '../../risk-engine/transaction-compliance/transaction-compliance.module';
import { SwapTransactionWorkflowService } from './swap-transaction-workflow.service';

@Module({
  imports: [
    PrismaModule,
    OnboardingModule,
    forwardRef(() => SwapFeeLevelModule),
    PricingCenterModule,
    OutstandingsModule,
    TransactionComplianceModule,
  ],
  controllers: [SwapTransactionsController, SwapTransactionsCustomerController],
  providers: [
    SwapTransactionsService,
    SwapWorkflowOrchestrator,
    SwapTransactionWorkflowService,
  ],
  exports: [
    SwapTransactionsService,
    SwapWorkflowOrchestrator,
    SwapTransactionWorkflowService,
  ],
})
export class SwapTransactionsModule {}
```

Note: We keep `PricingCenterModule` import for now because `SwapTransactionsService.getExecutableRate()` needs `BinanceRateProvider` from it. After PricingCenterService is deleted, PricingCenterModule still exports BinanceRateProvider.

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/modules/trading/swap-transactions/swap-transactions.module.ts
git commit -m "refactor: update SwapTransactionsModule to import SwapFeeLevelModule"
```

---

### Task 6: Migrate Withdrawal Side + Remove Legacy Callers

**Files:**
- Modify: `src/modules/trading/withdraw-transactions/withdraw-transactions.service.ts`
- Modify: `src/modules/asset-treasury/payouts/payouts.service.ts`
- Modify: `src/modules/governance/business-config/business-config.service.ts`
- Move: `src/modules/trading/pricing-center/pricing-center.customer.controller.ts` → `src/modules/trading/withdrawal-fee-level/withdraw-quote-customer.controller.ts`
- Modify: `src/modules/trading/withdrawal-fee-level/withdrawal-fee-level.module.ts`
- Modify: `src/modules/trading/withdrawal-fee-level/withdrawal-fee-level.controller.ts`

- [ ] **Step 1: Inline resolveOwnerNo in withdraw-transactions.service.ts**

In `src/modules/trading/withdraw-transactions/withdraw-transactions.service.ts`, find:
```typescript
const ownerNo = await this.pricingCenterService.resolveOwnerNo(ownerType, userId);
```

Replace with inline lookup:
```typescript
let ownerNo: string | null = null;
if (ownerType === 'CUSTOMER') {
  const cust = await this.prisma.customerMain.findUnique({ where: { id: userId }, select: { customerNo: true } });
  ownerNo = cust?.customerNo || null;
}
```

Then delete the `assertWithdrawExtremeVolatilityNotBlocked` call and its surrounding lines. Remove the `PricingCenterService` import and constructor injection if no other calls remain in this file.

- [ ] **Step 2: Remove volatility check from payouts.service.ts**

In `src/modules/asset-treasury/payouts/payouts.service.ts`, delete the `pricingCenterService.assertWithdrawExtremeVolatilityNotBlocked(...)` call block. Remove `PricingCenterService` import and constructor injection.

- [ ] **Step 3: Remove legacy config validation from business-config.service.ts**

In `src/modules/governance/business-config/business-config.service.ts`, delete the try/catch block that calls `pricingCenterService.assertSwapPolicyConfig(...)` and `assertWithdrawalPolicyConfig(...)`. Remove `PricingCenterService` import and constructor injection.

- [ ] **Step 4: Move withdrawal customer controller**

Copy `src/modules/trading/pricing-center/pricing-center.customer.controller.ts` to `src/modules/trading/withdrawal-fee-level/withdraw-quote-customer.controller.ts`. In the new file:

1. Rename class: `PricingCenterCustomerController` → `WithdrawQuoteCustomerController`
2. Remove PricingCenterService import and injection
3. Inline `resolveOwnerNo`:
```typescript
let ownerNo: string | null = null;
if (ownerType === 'CUSTOMER') {
  const cust = await this.prisma.customerMain.findUnique({ where: { id: ownerId }, select: { customerNo: true } });
  ownerNo = cust?.customerNo || null;
}
```

- [ ] **Step 5: Add admin quote endpoints to WithdrawalFeeLevelController**

In `src/modules/trading/withdrawal-fee-level/withdrawal-fee-level.controller.ts`, add two endpoints for admin quote queries:

```typescript
@Get('quotes')
@RequirePermissions(buildPermissionCode('GET', '/admin/withdrawal-fee-levels/quotes'))
async findAllQuotes(
  @Query('status') status?: string,
  @Query('quoteNo') quoteNo?: string,
  @Query('ownerNo') ownerNo?: string,
  @Query('skip') skip?: string,
  @Query('take') take?: string,
) {
  return this.withdrawQuoteService.findAllForAdmin({
    status, quoteNo, ownerNo,
    skip: skip ? parseInt(skip, 10) : undefined,
    take: take ? parseInt(take, 10) : undefined,
  });
}

@Get('quotes/:id')
@RequirePermissions(buildPermissionCode('GET', '/admin/withdrawal-fee-levels/quotes/:id'))
async findOneQuote(@Param('id') id: string) {
  return this.withdrawQuoteService.findOneForAdmin(id);
}
```

This requires adding `findAllForAdmin` and `findOneForAdmin` methods to `WithdrawQuoteService` (similar to SwapQuoteService's admin queries).

- [ ] **Step 6: Register withdrawal customer controller in module**

In `src/modules/trading/withdrawal-fee-level/withdrawal-fee-level.module.ts`:
1. Add import for `WithdrawQuoteCustomerController`
2. Add to `controllers: [WithdrawalFeeLevelController, WithdrawQuoteCustomerController]`
3. Add `OnboardingModule` and `PrismaModule` to imports if not already present

- [ ] **Step 7: Update withdrawal-related modules to remove PricingCenterModule**

- `withdraw-transactions.module.ts`: Remove `PricingCenterModule` from imports (if no longer needed after removing PricingCenterService calls)
- `payouts.module.ts`: Remove `PricingCenterModule` from imports
- `business-config.module.ts`: Remove `PricingCenterModule` from imports

- [ ] **Step 8: Verify build**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "refactor: migrate withdrawal side away from PricingCenterService"
```

---

### Task 7: Delete PricingCenterService + Admin Controller

**Files:**
- Delete: `src/modules/trading/pricing-center/pricing-center.service.ts`
- Delete: `src/modules/trading/pricing-center/pricing-center.admin.controller.ts`
- Delete: `src/modules/trading/pricing-center/pricing-center.customer.controller.ts` (moved in Task 6)
- Modify: `src/modules/trading/pricing-center/pricing-center.module.ts`

- [ ] **Step 1: Update pricing-center.module.ts**

Replace `src/modules/trading/pricing-center/pricing-center.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { PricingEngineService } from './pricing-engine.service';
import { BinanceRateProvider } from './providers/binance-rate.provider';

@Module({
  providers: [PricingEngineService, BinanceRateProvider],
  exports: [PricingEngineService, BinanceRateProvider],
})
export class PricingCenterModule {}
```

- [ ] **Step 2: Delete PricingCenterService**

```bash
rm src/modules/trading/pricing-center/pricing-center.service.ts
```

- [ ] **Step 3: Delete PricingCenter admin controller**

```bash
rm src/modules/trading/pricing-center/pricing-center.admin.controller.ts
```

- [ ] **Step 4: Delete the old customer controller (already moved)**

```bash
rm src/modules/trading/pricing-center/pricing-center.customer.controller.ts
```

- [ ] **Step 5: Verify build**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors. If there are errors, they'll be remaining references to deleted files — fix them.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: delete PricingCenterService (2926 lines) and its admin/customer controllers

PricingCenterModule now only exports PricingEngineService + BinanceRateProvider
as utility services. All quote lifecycle logic lives in SwapQuoteService and
WithdrawQuoteService."
```

---

### Task 8: Update Frontend Admin Page Endpoints

**Files:**
- Modify: `admin-web/src/pages/SwapQuoteList.tsx`
- Modify: `admin-web/src/pages/SwapQuoteDetail.tsx`
- Modify: `admin-web/src/pages/WithdrawQuoteList.tsx`
- Modify: `admin-web/src/pages/WithdrawQuoteDetail.tsx`

- [ ] **Step 1: Update SwapQuoteList.tsx endpoint**

Find:
```typescript
`${import.meta.env.VITE_API_URL}/admin/pricing/quotes?${params.toString()}`
```
Replace with:
```typescript
`${import.meta.env.VITE_API_URL}/admin/swap-transactions/quotes?${params.toString()}`
```

- [ ] **Step 2: Update SwapQuoteDetail.tsx endpoint**

Find:
```typescript
`${import.meta.env.VITE_API_URL}/admin/pricing/quotes/SWAP/${id}`
```
Replace with:
```typescript
`${import.meta.env.VITE_API_URL}/admin/swap-transactions/quotes/${id}`
```

- [ ] **Step 3: Update WithdrawQuoteList.tsx endpoint**

Find:
```typescript
`${import.meta.env.VITE_API_URL}/admin/pricing/quotes?${params.toString()}`
```
Replace with:
```typescript
`${import.meta.env.VITE_API_URL}/admin/withdrawal-fee-levels/quotes?${params.toString()}`
```

- [ ] **Step 4: Update WithdrawQuoteDetail.tsx endpoint**

Find the API call URL and replace `/admin/pricing/quotes/WITHDRAWAL/` with `/admin/withdrawal-fee-levels/quotes/`.

- [ ] **Step 5: Commit**

```bash
git add admin-web/src/pages/SwapQuoteList.tsx admin-web/src/pages/SwapQuoteDetail.tsx admin-web/src/pages/WithdrawQuoteList.tsx admin-web/src/pages/WithdrawQuoteDetail.tsx
git commit -m "refactor: update admin quote pages to use domain-specific endpoints"
```

---

### Task 9: RBAC + End-to-End Verification

**Files:**
- Modify: `src/modules/identity/access-control/rbac.catalog.ts` (if new endpoints need permission registration)
- No new code — verification only

- [ ] **Step 1: Register new withdrawal quote admin endpoints in RBAC catalog**

Add route definitions for the new withdrawal quote admin endpoints:
```typescript
route('GET', '/admin/withdrawal-fee-levels/quotes', 'List withdrawal quotes', ['WITHDRAWAL_FEE_LEVEL_READ']),
route('GET', '/admin/withdrawal-fee-levels/quotes/:id', 'Get withdrawal quote detail', ['WITHDRAWAL_FEE_LEVEL_READ']),
```

Run backfill: `npx ts-node -r tsconfig-paths/register scripts/backfill-rbac-permissions.ts --apply`

- [ ] **Step 2: Verify backend build**

Run: `npx tsc --noEmit --pretty 2>&1 | tail -5`
Expected: No errors.

- [ ] **Step 3: Verify PricingCenterService is fully gone**

Run: `grep -rn "PricingCenterService" src/modules/ --include="*.ts" | grep -v "\.spec\." | grep -v "node_modules"`
Expected: Zero results.

- [ ] **Step 4: Verify all files exist**

```bash
ls -la src/modules/trading/swap-fee-level/swap-quote.service.ts
ls -la src/modules/trading/withdrawal-fee-level/withdraw-quote-customer.controller.ts
ls -la src/modules/trading/pricing-center/pricing-engine.service.ts
ls -la src/modules/trading/pricing-center/providers/binance-rate.provider.ts
# Verify deleted files are gone:
test ! -f src/modules/trading/pricing-center/pricing-center.service.ts && echo "DELETED OK"
test ! -f src/modules/trading/pricing-center/pricing-center.admin.controller.ts && echo "DELETED OK"
```

- [ ] **Step 5: Commit RBAC updates**

```bash
git add src/modules/identity/access-control/rbac.catalog.ts
git commit -m "feat: register withdrawal quote admin endpoints in RBAC catalog"
```
