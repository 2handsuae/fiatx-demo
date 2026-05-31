# V6 Swap (Exchange) Flow Design

## Overview

V6 implements the complete swap (exchange) workflow for a VARA-regulated crypto exchange. Covers: Quote lifecycle, SwapTransaction execution, TB double-entry accounting (with spread + fee capture), large-amount approval gate, SwapFeeLevel governance, and SwapQuote refactoring.

**Scope:** Backend only. Admin/Client UI in separate specs.

---

## 1. Status Machines

### 1.1 SwapQuote

```
ACTIVE ──┬── USED        (consumeQuote: accepted by customer)
         ├── EXPIRED     (TTL elapsed, lazy on next access)
         └── CANCELLED   (customer or system cancellation)
```

- TTL: 30 seconds (constant `SWAP_QUOTE_TTL_SECONDS`)
- 1:1 with SwapTransaction via `quoteId` (unique FK)
- Quote is an **independent entity** — created before SwapTransaction exists

### 1.2 SwapTransaction

```
CREATED ──┬── PENDING_APPROVAL ── APPROVED ──┐
          │                                   ├── SUCCESS
          └── (auto, small amount) ───────────┘
                                              
PENDING_APPROVAL ── REJECTED
CREATED / PENDING_APPROVAL / APPROVED ── CANCELLED (quote expired before execution)
Any non-terminal ── FAILED (TB error, system failure)
```

Terminal states: `SUCCESS`, `REJECTED`, `CANCELLED`, `FAILED`

**Status transitions:**
| From | To | Trigger |
|------|-----|---------|
| — | CREATED | Customer accepts quote, L1 passes |
| CREATED | PENDING_APPROVAL | Amount ≥ 200k AED equivalent |
| CREATED | SUCCESS | Amount < 200k AED, TB transfers succeed |
| PENDING_APPROVAL | APPROVED | ApprovalCase approved |
| APPROVED | SUCCESS | TB transfers succeed |
| PENDING_APPROVAL | REJECTED | ApprovalCase rejected |
| * | CANCELLED | Quote expired before TB execution |
| * | FAILED | TB transfer error or system failure |

---

## 2. End-to-End Flow

### 2.1 Quote Phase

1. Customer selects currency pair + amount
2. `SwapQuoteService.createQuote()`:
   - `resolveBestLevel()`: find applicable SwapFeeLevels (default + customer-bound), pick lowest totalFee
   - Fetch Binance real-time rate (`baseRate`)
   - Apply `rateMarkupBps` from matched tier: `quotedRate = baseRate × (1 - markupBps/10000)`
   - Calculate fee lines via `PricingEngineService.calculateFeeLines()`
   - Compute `grossAmountOut`, `netAmountOut = grossAmountOut - feeTotal`
   - Persist `SwapQuote` with status=ACTIVE, TTL=30s
3. Return quote to customer for review

### 2.2 Accept Phase

4. Customer confirms quote within TTL
5. `SwapWorkflowService.handleQuoteAccepted()`:
   - `SwapQuoteService.getActiveQuoteOrThrow()` — validates ownership + not expired
   - **L1 Eligibility Guard** (synchronous, pre-creation):
     - `assertTradingEligibility()` — customer compliance status check
     - `TransactionLimitPolicy.checkSwapLimit()` — daily/monthly limit check
   - L1 fails → throw, quote remains ACTIVE for retry
   - L1 passes → `SwapQuoteService.consumeQuote()` (ACTIVE → USED)
   - Create `SwapTransaction` with status=CREATED, snapshot quote data
6. Determine approval requirement:
   - Convert `fromAmount` to AED using Binance `baseRate` (all currencies including USDT)
   - If AED equivalent ≥ 200,000 → status = PENDING_APPROVAL, create ApprovalCase
   - If < 200,000 → proceed directly to execution

### 2.3 Execution Phase

7. TB accounting (see Section 3 for detail):
   - Create 3 pending transfers (from-leg, to-leg, fee-leg)
   - Post all 3 transfers
   - Create Outstanding records for crypto legs only
   - Execute internal fund transfer for fiat legs
8. Status → SUCCESS, completedAt = now

### 2.4 Approval Flow (large amounts only)

- ApprovalCase created with type `SWAP_LARGE_AMOUNT`
- Approval policy: configurable (default: single approver)
- On APPROVED → execute TB accounting (same as step 7)
- On REJECTED → status = REJECTED, void pending transfers if any

---

## 3. TB Accounting Model

### 3.1 Principle

All accounting uses **market rate** (baseRate from Binance). The spread is not a separate "transfer" — it emerges naturally because the customer receives less than market value. The difference (spread + explicit fees) flows to `FEE_RECEIVABLE`.

### 3.2 Three Transfers per Swap

**Transfer 1: From-leg (customer pays)**
```
DR: Customer CLIENT_CREDIT (fromAsset)
CR: System account (fromAsset)
    - Fiat → BANK
    - Crypto → TRADE_CLEARING
Amount: fromAmount (what customer pays)
```

**Transfer 2: To-leg (customer receives net)**
```
DR: System account (toAsset)
    - Fiat → BANK
    - Crypto → TRADE_CLEARING
CR: Customer CLIENT_CREDIT (toAsset)
Amount: netAmountOut (after spread + fees deducted)
```

**Transfer 3: Fee-leg (platform revenue)**
```
DR: System account (toAsset, same as Transfer 2 source)
    - Fiat → BANK
    - Crypto → TRADE_CLEARING
CR: FEE_RECEIVABLE (toAsset)
Amount: grossAmountOut - netAmountOut = spread + explicit fees
```

### 3.3 Simulation: USDT → AED, spread 2%, fee 25 AED

```
baseRate (Binance):    1 USDT = 3.6725 AED
fromAmount:            1000 USDT
grossAmountOut:        1000 × 3.6725 = 3672.50 AED  (at market rate)
spread (2%):           3672.50 × 0.02 = 73.45 AED
quotedRate:            3.6725 × (1 - 0.02) = 3.5990 AED/USDT
explicitFee:           25 AED
totalDeductions:       73.45 + 25 = 98.45 AED
netAmountOut:          3672.50 - 98.45 = 3574.05 AED

Transfer 1: DR Customer/USDT   CR TRADE_CLEARING/USDT  = 1000 USDT
Transfer 2: DR BANK/AED        CR Customer/AED         = 3574.05 AED
Transfer 3: DR BANK/AED        CR FEE_RECEIVABLE/AED   = 98.45 AED
```

### 3.4 Simulation: AED → USDT, spread 2%, fee 5 USDT

```
baseRate (Binance):    1 USDT = 3.6725 AED → 1 AED = 0.27229 USDT
fromAmount:            3672.50 AED
grossAmountOut:        3672.50 × 0.27229 = 1000.00 USDT (at market rate)
spread (2%):           1000 × 0.02 = 20 USDT
explicitFee:           5 USDT
totalDeductions:       20 + 5 = 25 USDT
netAmountOut:          1000 - 25 = 975 USDT

Transfer 1: DR Customer/AED    CR BANK/AED              = 3672.50 AED
Transfer 2: DR TRADE_CLEARING/USDT CR Customer/USDT     = 975 USDT
Transfer 3: DR TRADE_CLEARING/USDT CR FEE_RECEIVABLE/USDT = 25 USDT
```

### 3.5 Outstanding Records

- Created for **crypto legs only** (TRADE_CLEARING involvement)
- Status: `PENDING_SETTLEMENT` → `SETTLED` (at V7 EOD batch)
- Each crypto transfer (from-leg or to-leg) that touches TRADE_CLEARING creates one Outstanding
- Fiat legs (BANK) are immediate — no Outstanding needed

### 3.6 Fiat Internal Transfer

When a fiat leg involves BANK:
- After TB transfer posts, automatically trigger internal fund transfer
- Purpose: move funds between platform omnibus and customer VIBAN at service provider
- V6 scope: stub the internal transfer call (actual integration in later version)

### 3.7 TB Pending Transfer Pattern

All 3 transfers use TB pending transfers:
- **Create** pending transfers at SwapTransaction creation (locks balance)
- **Post** all 3 on success (auto-approve or approval passed)
- **Void** all 3 on rejection/cancellation/failure (releases balance)

---

## 4. Three-Layer Architecture

### 4.1 Layer Breakdown

| Layer | File | Responsibility |
|-------|------|---------------|
| Domain Service | `swap-transactions.service.ts` | SwapTransaction CRUD, status transitions, invariant checks |
| Approval Sub-Workflow | `swap-large-amount-approval.service.ts` | Extends `ApprovalHandlerBase`, handles APPROVED/REJECTED callbacks |
| Workflow | `swap-workflow.service.ts` | End-to-end orchestration via `@OnEvent()` |

### 4.2 Domain Events

| Event | Payload | Emitted By |
|-------|---------|------------|
| `swap.quote.created` | `{ quoteId, quoteNo, customerId }` | SwapQuoteService |
| `swap.transaction.created` | `{ swapId, swapNo, customerId, requiresApproval }` | SwapWorkflowService |
| `swap.transaction.approved` | `{ swapId, swapNo, approvalCaseId }` | ApprovalHandler callback |
| `swap.transaction.rejected` | `{ swapId, swapNo, approvalCaseId }` | ApprovalHandler callback |
| `swap.transaction.completed` | `{ swapId, swapNo }` | SwapWorkflowService |
| `swap.transaction.failed` | `{ swapId, swapNo, failureCode, failureReason }` | SwapWorkflowService |

### 4.3 Workflow Orchestration

```typescript
@Injectable()
export class SwapWorkflowService {
  @OnEvent('swap.quote.accepted')
  async handleQuoteAccepted(event) {
    // L1 guard → consume quote → create SwapTransaction
    // → small: execute TB → SUCCESS
    // → large: PENDING_APPROVAL → create ApprovalCase
  }

  @OnEvent('approval.case.decided')
  async handleApprovalDecided(event) {
    // APPROVED → execute TB → SUCCESS
    // REJECTED → void pending transfers → REJECTED
  }
}
```

### 4.4 Audit Logging

| Action | When |
|--------|------|
| `SWAP_QUOTE_CREATED` | Quote created |
| `SWAP_TRANSACTION_CREATED` | SwapTransaction created |
| `SWAP_APPROVAL_REQUESTED` | Large amount sent for approval |
| `SWAP_APPROVED` | Approval case approved |
| `SWAP_REJECTED` | Approval case rejected |
| `SWAP_COMPLETED` | TB transfers posted, status=SUCCESS |
| `SWAP_FAILED` | Execution failure |
| `SWAP_CANCELLED` | Transaction cancelled |

---

## 5. SwapFeeLevel Governance + SwapQuote Refactoring

### 5.1 Core Differences: Swap vs Withdrawal Fee Level

| Dimension | WithdrawalFeeLevel | SwapFeeLevel |
|-----------|-------------------|--------------|
| Dimension key | `assetId` (per asset) | `fromAssetId` + `toAssetId` (per pair) |
| Tier-specific field | — | `rateMarkupBps` (spread markup) |
| Fee item codes | `WITHDRAW_SERVICE_FEE`, `NETWORK_FEE_EST` | `SWAP_SERVICE_FEE`, `COMPLIANCE_FEE` |
| Quote consumption | Amount match only | Amount match + rate window (quote binds rate) |
| Fee currency | Same as asset | Received currency (toAsset) |

### 5.2 New Prisma Models

```prisma
model SwapFeeLevel {
  id               String    @id @default(uuid())
  levelCode        String    @unique
  name             String
  fromAssetId      String
  toAssetId        String
  isDefault        Boolean   @default(false)
  enabled          Boolean   @default(true)
  tiersJson        String    // SwapFeeLevelTiersConfig JSON
  configHash       String
  status           String    @default("PENDING_APPROVAL")
  approvalCaseId   String?
  approvalCaseNo   String?
  createdByUserId  String
  updatedByUserId  String?
  createdAt        DateTime  @default(now())
  updatedAt        DateTime  @updatedAt

  fromAsset        Asset     @relation("SwapFeeLevelFromAsset", ...)
  toAsset          Asset     @relation("SwapFeeLevelToAsset", ...)
  bindings         SwapFeeLevelBinding[]
  changeRequests   SwapFeeLevelChangeRequest[]

  @@index([fromAssetId, toAssetId, status, enabled])
  @@map("swap_fee_levels")
}

model SwapFeeLevelChangeRequest {
  id                 String    @id @default(uuid())
  requestNo          String    @unique @default("TEMP")
  levelId            String
  levelCode          String
  currentTiersJson   String
  currentConfigHash  String
  proposedTiersJson  String
  changeReason       String
  status             String    @default("PENDING_APPROVAL")
  requestedByUserId  String
  approvalCaseId     String?
  approvalCaseNo     String?
  executedAt         DateTime?
  failureReason      String?
  createdAt          DateTime  @default(now())
  updatedAt          DateTime  @updatedAt

  level              SwapFeeLevel @relation(...)

  @@index([levelId, status])
  @@map("swap_fee_level_change_requests")
}

model SwapFeeLevelBinding {
  id              String   @id @default(uuid())
  customerId      String
  levelId         String
  boundByUserId   String
  boundAt         DateTime @default(now())
  createdAt       DateTime @default(now())

  customer        CustomerMain     @relation(...)
  level           SwapFeeLevel     @relation(...)

  @@unique([customerId, levelId])
  @@index([customerId])
  @@index([levelId])
  @@map("swap_fee_level_bindings")
}
```

### 5.3 SwapFeeLevelTiersConfig Type

```typescript
// swap-fee-level/types/fee-level.types.ts
import { SwapTier } from '../../pricing-center/types/pricing.types';

export interface SwapFeeLevelTiersConfig {
  tiers: SwapTier[];  // Reuses existing SwapTier (has rateMarkupBps + feeItems)
}

export const SWAP_FEE_ITEM_CODES = ['SWAP_SERVICE_FEE', 'COMPLIANCE_FEE'] as const;
```

### 5.4 New Module: `src/modules/trading/swap-fee-level/`

| File | Responsibility | Mirrors |
|------|---------------|---------|
| `swap-fee-level.service.ts` | Level CRUD + Change Request CRUD (hash conflict detection) | `withdrawal-fee-level.service.ts` |
| `swap-fee-level-binding.service.ts` | Customer bind/unbind | `withdrawal-fee-level-binding.service.ts` |
| `swap-quote.service.ts` | Quote resolve/create/consume/cancel | `withdraw-quote.service.ts` |
| `types/fee-level.types.ts` | SwapFeeLevelTiersConfig | `types/fee-level.types.ts` |

**SwapFeeLevelService key methods:**
- `findAll()` / `findById()` / `findByLevelCode()`
- `findActiveByPair(fromAssetId, toAssetId)` — find active levels for a currency pair
- `validateTiersJson()` — validate SwapTier structure (including `rateMarkupBps >= 0`)
- `createLevel()` → status = PENDING_APPROVAL
- `linkApprovalCase()` / `activateLevel()` / `deleteRejectedLevel()`
- `createChangeRequest()` / `executeChange()` (hash conflict detection)
- `rejectChangeRequest()` / `cancelChangeRequest()`

**SwapFeeLevelBindingService** — identical pattern to Withdrawal:
- `bind()` / `unbind()` / `findByCustomer()` / `findByLevel()` / `findBoundLevelIds()`

### 5.5 SwapQuoteService (Extracted from PricingCenterService)

```typescript
@Injectable()
export class SwapQuoteService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly feeLevelService: SwapFeeLevelService,
    private readonly bindingService: SwapFeeLevelBindingService,
    private readonly engineService: PricingEngineService,
  ) {}

  async resolveBestLevel(input: {
    fromAssetId: string;
    toAssetId: string;
    amount: Prisma.Decimal;
    customerId: string;
  }): Promise<ResolvedSwapQuote | null>

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
  }): Promise<SwapQuote>

  async getActiveQuoteOrThrow(quoteId, ownerType, ownerId, now, tx?)
  async consumeQuote(quoteId, ownerType, ownerId, amount, tx?)
  async cancelQuote(quoteId, ownerType, ownerId, tx?)
}
```

**resolveBestLevel difference from Withdrawal:** Swap additionally fetches Binance real-time rate to compute `quotedRate = baseRate × (1 - markupBps/10000)`, then calculates amountOut before computing fees.

**SwapQuote schema additions:**
```prisma
  feeLevelId      String?
  feeLevelCode    String?
```

`policyRef` format changes from JSON to `LEVEL:{levelCode}` (aligned with WithdrawPricingQuote).

### 5.6 PricingCenterService Cleanup

**Remove from PricingCenterService** (moved to SwapQuoteService):
- Swap quote creation logic (buildSwapQuote call + SwapQuote table writes)
- Swap pair/tier lookup (replaced by SwapFeeLevelService)
- SwapPricingPolicy config reads (level system replaces policy JSON)

**Keep in PricingCenterService:**
- `PricingEngineService` (pure math engine, shared by both QuoteServices)
- Binance rate fetching (shared utility, used by SwapQuoteService)
- Withdrawal pricing (if any remains — should also be cleaned to use WithdrawQuoteService)

### 5.7 Governance Workflows (3-Layer Architecture)

| Workflow | Approval | Description |
|----------|----------|-------------|
| SwapFeeLevelCreation | MLRO + SMO | Create new level → PENDING_APPROVAL → approved → activateLevel() |
| SwapFeeLevelChange | MLRO + SMO | Change tiersJson → request-record pattern → approved → executeChange() with hash conflict detection |
| SwapFeeLevelBinding | No approval | Direct bind/unbind + audit log |

Each workflow consists of:
- `*-approval.service.ts` (extends ApprovalHandlerBase)
- `*-workflow.service.ts` (orchestrates domain service + approval)

---

## 6. Files to Create / Modify / Delete

### Create

| File | Purpose |
|------|---------|
| `src/modules/trading/swap-fee-level/swap-fee-level.module.ts` | Module |
| `src/modules/trading/swap-fee-level/swap-fee-level.service.ts` | Level + ChangeRequest CRUD |
| `src/modules/trading/swap-fee-level/swap-fee-level-binding.service.ts` | Binding CRUD |
| `src/modules/trading/swap-fee-level/swap-quote.service.ts` | Quote resolve/create/consume/cancel |
| `src/modules/trading/swap-fee-level/types/fee-level.types.ts` | SwapFeeLevelTiersConfig |
| `src/modules/trading/swap-fee-level/swap-fee-level-creation-approval.service.ts` | ApprovalHandlerBase |
| `src/modules/trading/swap-fee-level/swap-fee-level-creation-workflow.service.ts` | Creation workflow |
| `src/modules/trading/swap-fee-level/swap-fee-level-change-approval.service.ts` | ApprovalHandlerBase |
| `src/modules/trading/swap-fee-level/swap-fee-level-change-workflow.service.ts` | Change workflow |
| `src/modules/trading/swap-fee-level/swap-fee-level-binding-workflow.service.ts` | Binding workflow |
| `src/modules/trading/swap-transactions/swap-workflow.service.ts` | New end-to-end workflow |
| `src/modules/trading/swap-transactions/swap-large-amount-approval.service.ts` | Large amount approval handler |
| `prisma/migrations/YYYYMMDD_add_swap_fee_level_tables/` | SwapFeeLevel + ChangeRequest + Binding |

### Modify

| File | Change |
|------|--------|
| `prisma/schema.prisma` | Add SwapFeeLevel, SwapFeeLevelChangeRequest, SwapFeeLevelBinding models; add feeLevelId/feeLevelCode to SwapQuote |
| `src/modules/trading/swap-transactions/swap-transactions.service.ts` | Update status enum, add new transition methods |
| `src/modules/trading/swap-transactions/dto/swap-transaction.dto.ts` | New status enum |
| `src/modules/trading/pricing-center/pricing-center.service.ts` | Remove swap quote logic |
| `src/modules/audit-logging/constants/audit-actions.constant.ts` | Add SWAP_* audit actions |

### Delete

| File | Reason |
|------|--------|
| `src/modules/trading/swap-transactions/swap-workflow.orchestrator.ts` | Replaced by swap-workflow.service.ts |
| `src/modules/trading/swap-transactions/swap-transaction-workflow.service.ts` | Replaced by swap-workflow.service.ts |

---

## 7. Key Design Decisions

1. **No L2/L3 compliance for swaps** — Swap has no on-chain transaction at swap time. L1 (eligibility + limits) is synchronous pre-creation. KYT/Travel Rule are irrelevant.

2. **200k AED threshold uses Binance baseRate** — All currencies (including USDT) use real-time Binance rate. No fixed peg for any currency.

3. **Spread + fee combined in FEE_RECEIVABLE** — TB layer records total platform revenue in one transfer. The breakdown (spread vs explicit fee) is in `feeBreakdown` JSON for reporting.

4. **TRADE_CLEARING for crypto, BANK for fiat** — Crypto legs go through clearing (settled at V7 EOD). Fiat legs are immediate with auto internal transfer.

5. **Fee Level replaces Policy JSON** — SwapFeeLevel is a first-class entity with approval governance, replacing the monolithic SwapPricingPolicy config. Each level is per currency pair (vs per asset for withdrawals).

6. **Quote is independent from Transaction** — SwapQuote is created and managed by SwapQuoteService. SwapTransaction references a consumed quote. This enables quote browsing without transaction commitment.

7. **Unified lock flow (Approach A)** — All swaps use TB pending transfers at creation. Small amounts auto-post. Large amounts wait for approval, then post or void.
