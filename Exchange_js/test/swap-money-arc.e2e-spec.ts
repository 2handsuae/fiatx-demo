import * as path from 'path';
import * as dotenv from 'dotenv';

// Loaded before any other import so PrismaService / TigerBeetleService see the
// worktree's own DATABASE_URL / TB_ADDRESS regardless of ConfigModule's internal
// load timing (belt-and-braces — mirrors withdraw-money-arcs.e2e-spec.ts, this
// file's template).
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/core/prisma/prisma.service';
import { SwapWorkflowService } from '../src/modules/trading/swap-transactions/swap-workflow.service';
import { SwapTransactionsService } from '../src/modules/trading/swap-transactions/swap-transactions.service';
import { SwapTransactionStatus } from '../src/modules/trading/swap-transactions/dto/swap-transaction.dto';
import { SwapQuoteService } from '../src/modules/trading/swap-fee-level/swap-quote.service';
import { FundsOrderService } from '../src/modules/funds-orders/funds-order.service';
import { FundsOrderAction, FundsOrderStatus } from '../src/modules/funds-orders/dto/funds-order.dto';
import { AccountingService } from '../src/modules/accounting/tigerbeetle/accounting.service';
import { TbEvidenceService } from '../src/modules/accounting/tigerbeetle/tb-evidence.service';
import { TB_ACCOUNT_CODES, TB_CODE_TO_COA } from '../src/modules/accounting/tigerbeetle/constants/tb-account-codes.constant';
import { TB_TRANSFER_CODES } from '../src/modules/accounting/tigerbeetle/constants/tb-transfer-codes.constant';
import { TB_LEDGERS } from '../src/modules/accounting/tigerbeetle/constants/tb-ledgers.constant';
import { CustomerAccessService } from '../src/modules/identity/customers/customer-access.service';
import { CustomerRestrictionsService } from '../src/modules/identity/customers/customer-restrictions.service';
import { SUMSUB_TXN_CLIENT } from '../src/modules/sumsub-shared/sumsub-txn-client.interface';
import { MockSumsubTxnClient } from '../src/modules/sumsub-shared/sumsub-txn-client.mock';
import { AuditActions, AuditEntityTypes } from '../src/modules/audit-logging/constants/audit-actions.constant';

/**
 * Task 12: swap money-arcs e2e — proves the money-moving side of the swap ×
 * Sumsub redesign (Tasks 1-11) actually works end to end against a real
 * AppModule + real TigerBeetle. Only SUMSUB_TXN_CLIENT is mocked (mirrors
 * deposit-money-arcs.e2e-spec.ts / withdraw-money-arcs.e2e-spec.ts, this
 * file's template — see those files' header comments for the harness-shape
 * rationale, repeated only where it differs below).
 *
 * Two arcs:
 *   1. Happy path: initiateSwap (COMPLIANCE_PENDING, nothing booked) → an
 *      approving KYT verdict books leg1 and flips PROCESSING → driving all 4
 *      legs to CONFIRMED chains through to SUCCESS.
 *   2. THE HEADLINE PROPERTY（站3·出生锁版）— 拒绝的兑换：圈全擦、余额复原、零落笔。
 *      Unlike deposit (money already sits in suspense, must be returned or
 *      confiscated) and withdraw (funds pending-locked, must be voided), a
 *      rejected swap costs nothing to unwind because nothing happened: no
 *      funds orders, no TB evidence, no account flows, no balance movement.
 *      If a future change starts booking before the verdict, arc 2 fails loudly.
 *
 * Harness notes:
 * - Uses `demo_acme@example.com` (CORPORATE, but customer-type is irrelevant
 *   to the trading gates — see customer-transaction-guard.ts /
 *   customer-access.service.ts#assertTradingEligibility（站6 自 onboarding 迁入）, neither branches on it) —
 *   NOT alice/bob (deposit suites) or frank/grace (withdraw suites), and NOT
 *   shared with test/swap-sumsub-scenarios.e2e-spec.ts (its own fresh
 *   synthetic customer) — so this file's fixtures never race another spec
 *   file's TB accounts or customer-level `restrictions`/`pendingAction*`
 *   columns. jest's e2e config has no maxWorkers pin, so multiple spec files
 *   may run in parallel workers against the same worktree DB/TigerBeetle
 *   cluster.
 * - No `sumsubApplicantId` is ever set on this customer: `applyKytVerdict` is
 *   called directly (the real production entry point the webhook handler
 *   itself calls, exactly like deposit/withdraw-money-arcs call it) rather
 *   than routing through a simulated webhook, so the sumsubTxnIdOut linkage
 *   the webhook path depends on is irrelevant here (that path is exercised by
 *   test/swap-sumsub-scenarios.e2e-spec.ts instead). `initiateSwap`'s
 *   `submitSumsubTxnOut` call harmlessly no-ops without an applicantId (logs
 *   a warning, never throws — I2, see that method's doc comment).
 */
describe('Swap money arcs (e2e, Task 12)', () => {
  jest.setTimeout(60000);

  let app: INestApplication;
  let prisma: PrismaService;
  let workflow: SwapWorkflowService;
  let swapService: SwapTransactionsService;
  let swapQuote: SwapQuoteService;
  let fundsOrders: FundsOrderService;
  let accounting: AccountingService;
  let tbEvidence: TbEvidenceService;
  let customerAccess: CustomerAccessService;
  let restrictionsService: CustomerRestrictionsService;

  let customerId: string;
  let customerNo: string;

  let aedAssetId: string;
  let aedDecimals: number;
  let usdtAssetId: string;
  let usdtDecimals: number;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(SUMSUB_TXN_CLIENT)
      .useClass(MockSumsubTxnClient)
      .compile();

    app = moduleRef.createNestApplication();
    app.get(EventEmitter2).setMaxListeners(50);
    await app.init();

    prisma = app.get(PrismaService);
    workflow = app.get(SwapWorkflowService);
    swapService = app.get(SwapTransactionsService);
    swapQuote = app.get(SwapQuoteService);
    fundsOrders = app.get(FundsOrderService);
    accounting = app.get(AccountingService);
    tbEvidence = app.get(TbEvidenceService);
    customerAccess = app.get(CustomerAccessService);
    restrictionsService = app.get(CustomerRestrictionsService);

    const customer = await prisma.customerMain.findUnique({
      where: { email: 'demo_acme@example.com' },
    });
    if (!customer) {
      throw new Error(
        "Fixture customer demo_acme@example.com not found — this worktree's self-stack DB " +
          'needs business seed data first: `DATABASE_URL=... TB_ADDRESS=... npm run db:biz:init`.',
      );
    }
    customerId = customer.id;

    // 三轴收敛：便签搬进了 customer_restrictions 独立表，旧写法靠给客户列写
    // restrictions:'[]' 复位，那条列已删。这里显式清场 —— 不清的话上一支/上一轮
    // 留下的 OPEN 便签会被新的 L1 能力门拦住建单，用例之间不再独立。
    await prisma.customerRestriction.deleteMany({ where: { customerId } });
    customerNo = customer.customerNo;

    // Reset state left by a previous run of this suite against a persistent
    // worktree DB — restrictions/hardLine are idempotent to reset (no other
    // suite touches this customer).
    await prisma.customerMain.update({
      where: { id: customerId },
      // restrictions JSON 列已随三轴删除；便签现在是 customer_restrictions 独立表，
      // 由下面 deleteMany 清场，不再靠给客户列写 '[]' 复位。pendingAction* 三列
      // 已随 Task 12 物理删除，客户的软线痕迹现在只活在材料账里，本单测客户不
      // 经过那条链路，不需要清场。
      data: { hardLineDispositionedAt: null },
    });

    const aedAsset = await prisma.asset.findFirst({ where: { currency: 'AED' } });
    const usdtAsset = await prisma.asset.findFirst({ where: { currency: 'USDT' } });
    if (!aedAsset || !aedAsset.tbLedgerId || !usdtAsset || !usdtAsset.tbLedgerId) {
      throw new Error('Fixture assets AED/USDT not seeded (or missing tbLedgerId) — run `npm run db:biz:init` first.');
    }
    aedAssetId = aedAsset.id;
    aedDecimals = aedAsset.decimals;
    usdtAssetId = usdtAsset.id;
    usdtDecimals = usdtAsset.decimals;

    // Customer receiving wallets (R4: initiateSwap's receiving-account gate
    // requires C_VIBAN/C_DEP, CUSTOMER-owned, ACTIVE, for BOTH sides of the pair).
    await ensureCustomerWallet({ assetId: aedAssetId, walletRole: 'C_VIBAN', type: 'FIAT_BANK', iban: `AE_SWAP_ARCS_${customerNo}` });
    await ensureCustomerWallet({ assetId: usdtAssetId, walletRole: 'C_DEP', type: 'CRYPTO_ADDRESS', address: `T_SWAP_ARCS_${customerNo}` });

    // Trading-start precondition gate (assertTradingReady, non-DEPOSIT actions):
    // requires ≥1 ACTIVE BANK withdrawal address on file — not used for payout
    // here, only to satisfy the gate so SWAP/WITHDRAW eligibility checks reach
    // the restrictions check this suite actually exercises.
    await ensureWithdrawalAddress({
      assetId: aedAssetId, addressType: 'BANK', network: 'FIAT',
      address: 'AE070331234567890199999', iban: 'AE070331234567890199999',
    });

    // Pre-fund the customer's CLIENT_PAYABLE balance for both assets (real TB
    // transfer, DEPOSIT_SUSPENSE → CLIENT_PAYABLE — same leg a real deposit's
    // Step 2 posts). Deterministic sourceNo → idempotent across repeated runs.
    await fundCustomer(aedAssetId, 'AED', '1000000');
    await fundCustomer(usdtAssetId, 'USDT', '1000000');
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  // ── helpers ──────────────────────────────────────────────────────────────

  function decimalToBigint(decimalValue: string, decimals: number): bigint {
    const [whole, frac = ''] = decimalValue.split('.');
    const paddedFrac = frac.padEnd(decimals, '0').slice(0, decimals);
    return BigInt(whole + paddedFrac);
  }

  async function ensureCustomerWallet(opts: {
    assetId: string; walletRole: 'C_VIBAN' | 'C_DEP'; type: string; iban?: string; address?: string;
  }): Promise<string> {
    const existing = await (prisma as any).wallet.findFirst({
      where: { ownerType: 'CUSTOMER', ownerId: customerId, assetId: opts.assetId, walletRole: opts.walletRole, status: 'ACTIVE' },
    });
    if (existing) return existing.id;
    const created = await (prisma as any).wallet.create({
      data: {
        ownerType: 'CUSTOMER', ownerId: customerId, ownerNo: customerNo,
        type: opts.type, walletRole: opts.walletRole, assetId: opts.assetId,
        address: opts.address ?? null, iban: opts.iban ?? null, status: 'ACTIVE',
      },
    });
    return created.id;
  }

  async function ensureWithdrawalAddress(opts: {
    assetId: string; addressType: string; network: string; address: string; iban?: string;
  }): Promise<void> {
    const existing = await (prisma as any).withdrawalAddress.findFirst({
      where: { customerId, assetId: opts.assetId, address: opts.address, status: 'ACTIVE' },
    });
    if (existing) return;
    await (prisma as any).withdrawalAddress.create({
      data: {
        addressNo: `WAD-E2E-SWAPARCS-${opts.addressType}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        customerId, customerNo, assetId: opts.assetId, network: opts.network,
        address: opts.address, addressType: opts.addressType, iban: opts.iban ?? null,
        ownershipDeclaredAt: new Date(), ownershipProofType: 'E2E_FIXTURE',
        status: 'ACTIVE', activatesAt: new Date(Date.now() - 1000),
        traceId: 'e2e-swap-money-arcs-address',
      },
    });
  }

  async function fundCustomer(assetId: string, currency: string, amount: string): Promise<void> {
    const asset = await (prisma as any).asset.findUnique({ where: { id: assetId } });
    const ledger = TB_LEDGERS[currency as keyof typeof TB_LEDGERS];
    const amountBigint = decimalToBigint(amount, asset.decimals);
    const suspenseId = await accounting.resolveTbAccountId({ code: TB_ACCOUNT_CODES.DEPOSIT_SUSPENSE, ledger, ownerType: 'CUSTOMER', ownerUuid: customerId });
    const payableId = await accounting.resolveTbAccountId({ code: TB_ACCOUNT_CODES.CLIENT_PAYABLE, ledger, ownerType: 'CUSTOMER', ownerUuid: customerId });
    await accounting.executeTransfer({
      debitAccountId: suspenseId,
      creditAccountId: payableId,
      amount: amountBigint,
      ledger,
      code: TB_TRANSFER_CODES.DEPOSIT_SUSPENSE_TO_PAYABLE,
      evidence: {
        sourceType: 'DEPOSIT',
        sourceNo: `E2E-SWAP-ARCS-FUND-${currency}`,
        eventCode: 'DEPOSIT_SUSPENSE_TO_PAYABLE',
        debitCode: TB_CODE_TO_COA[TB_ACCOUNT_CODES.DEPOSIT_SUSPENSE],
        creditCode: TB_CODE_TO_COA[TB_ACCOUNT_CODES.CLIENT_PAYABLE],
        assetCurrency: currency,
        traceId: `e2e-swap-arcs-fund-${currency}`,
        actorType: 'SYSTEM',
        actorId: 'E2E_HARNESS',
        memo: 'e2e fixture: pre-fund customer balance for swap money-arc tests',
        isExternalCrossing: false,
      },
    });
  }

  async function createQuote(fromAssetId: string, fromAssetCode: string, toAssetId: string, toAssetCode: string, amount: string) {
    return swapQuote.createQuote({
      ownerType: 'CUSTOMER', ownerId: customerId, ownerNo: customerNo,
      fromAssetId, fromAssetCode, toAssetId, toAssetCode,
      amount: new Prisma.Decimal(amount), customerId,
    });
  }

  /** Real production birth: SwapWorkflowService.initiateSwap() via a real
   *  quote — books NOTHING, returns the swap in COMPLIANCE_PENDING. */
  async function createSwap(fromAssetId: string, fromAssetCode: string, toAssetId: string, toAssetCode: string, amount: string) {
    const quote = await createQuote(fromAssetId, fromAssetCode, toAssetId, toAssetCode, amount);
    return { swap: await workflow.initiateSwap(customerId, quote.id), quoteId: quote.id };
  }

  async function auditActionsFor(entityId: string, entityType: string): Promise<string[]> {
    // 8/25 审计改表后按业务键查（primarySubjectNo/Type）；先按类型解出对应单号。
    let subjectNo: string | null = null;
    if (entityType === AuditEntityTypes.SWAP_TRANSACTION) {
      subjectNo = (await (prisma as any).swapTransaction.findUnique({ where: { id: entityId }, select: { swapNo: true } }))?.swapNo ?? null;
    } else if (entityType === AuditEntityTypes.MATERIAL_REQUEST) {
      subjectNo = (await (prisma as any).materialRequest.findUnique({ where: { id: entityId }, select: { requestNo: true } }))?.requestNo ?? null;
    } else if (entityType === AuditEntityTypes.CUSTOMER) {
      // 站6 起 V2 已换新合同——客户审计主对象号是 customerNo,按 id 解号。
      subjectNo = (await (prisma as any).customerMain.findUnique({ where: { id: entityId }, select: { customerNo: true } }))?.customerNo ?? null;
    }
    if (!subjectNo) return [];
    const rows = await (prisma as any).auditLogEvent.findMany({
      where: { primarySubjectNo: subjectNo, primarySubjectType: entityType },
      select: { action: true },
    });
    return rows.map((r: any) => r.action);
  }

  async function availableBalances(): Promise<{ aed: bigint; usdt: bigint }> {
    const [aed, usdt] = await Promise.all([
      accounting.getCustomerAvailableBalance(customerId, 'AED'),
      accounting.getCustomerAvailableBalance(customerId, 'USDT'),
    ]);
    return { aed: aed.available, usdt: usdt.available };
  }

  /** Drives a legSeq's CURRENT (only, in these tests — always attempt=1)
   *  funds_order from CREATED → … → CONFIRMED (spec §5.3). CONFIRMED is the
   *  finalize trigger — the swap workflow's async @OnEvent handler POSTs TB,
   *  auto-CLEARs the leg, and chains the next leg's CREATED row. */
  async function driveLegToClear(swapId: string, swapNo: string, legSeq: number): Promise<void> {
    await waitUntil(async () => {
      const leg = await prisma.fundsOrder.findFirst({ where: { swapTransactionId: swapId, legSeq } });
      return !!leg;
    });
    for (let step = 0; step < 8; step++) {
      const leg: any = await prisma.fundsOrder.findFirst({
        where: { swapTransactionId: swapId, legSeq },
        include: { asset: true },
      });
      if (!leg) throw new Error(`${swapNo} leg ${legSeq} not found`);
      if (leg.status === FundsOrderStatus.CLEARED || leg.status === FundsOrderStatus.CONFIRMED) break;
      const isFiat = (leg.asset?.type || '').toUpperCase() === 'FIAT';
      let action: FundsOrderAction;
      if (isFiat) {
        if (leg.status === FundsOrderStatus.CREATED) action = FundsOrderAction.SUBMIT;
        else if (leg.status === FundsOrderStatus.SUBMITTED) action = FundsOrderAction.CONFIRM;
        else throw new Error(`${swapNo} leg ${legSeq} unexpected fiat status ${leg.status}`);
      } else {
        if (leg.status === FundsOrderStatus.CREATED) action = FundsOrderAction.SUBMIT;
        else if (leg.status === FundsOrderStatus.SUBMITTED) action = FundsOrderAction.OBSERVE_CONFIRMING;
        else if (leg.status === FundsOrderStatus.CONFIRMING) action = FundsOrderAction.CONFIRM;
        else throw new Error(`${swapNo} leg ${legSeq} unexpected crypto status ${leg.status}`);
      }
      await fundsOrders.advance(leg.id, action, 'E2E_HARNESS');
    }
    await waitUntil(async () => {
      const leg = await prisma.fundsOrder.findFirst({ where: { swapTransactionId: swapId, legSeq } });
      return leg?.status === FundsOrderStatus.CLEARED;
    });
  }

  async function waitUntil(predicate: () => Promise<boolean>, timeoutMs = 5000, intervalMs = 40): Promise<void> {
    const start = Date.now();
    for (;;) {
      if (await predicate()) return;
      if (Date.now() - start > timeoutMs) {
        throw new Error(`waitUntil: condition not met within ${timeoutMs}ms`);
      }
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }

  async function waitFor<T>(fn: () => Promise<T | null>, timeoutMs = 8000, intervalMs = 50): Promise<T> {
    const start = Date.now();
    for (;;) {
      const v = await fn();
      if (v) return v;
      if (Date.now() - start > timeoutMs) throw new Error(`waitFor: timed out after ${timeoutMs}ms`);
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }

  // ── arcs ─────────────────────────────────────────────────────────────────

  it('1. happy path: initiateSwap books nothing → approving verdict books leg1 → all 4 legs CLEAR → SUCCESS', async () => {
    const before = await availableBalances();
    const amount = '100';

    const { swap } = await createSwap(usdtAssetId, 'USDT', aedAssetId, 'AED', amount);
    expect(swap.status).toBe(SwapTransactionStatus.COMPLIANCE_PENDING);
    expect(await fundsOrders.findByParent({ swapTransactionId: swap.id }, {})).toHaveLength(0);

    await workflow.applyKytVerdict(swap.id, { verdict: 'approved' });
    const afterVerdict = await swapService.findByIdInternal(swap.id);
    expect(afterVerdict.status).toBe(SwapTransactionStatus.PROCESSING);

    for (const legSeq of [1, 2, 3, 4]) {
      await driveLegToClear(swap.id, swap.swapNo!, legSeq);
    }

    const finalSwap = await waitFor(async () => {
      const s = await swapService.findByIdInternal(swap.id);
      return s.status === SwapTransactionStatus.SUCCESS ? s : null;
    });
    expect(finalSwap.currentStage).toBeNull();
    expect(finalSwap.needsReview).toBe(false);

    const legs = await fundsOrders.findByParent({ swapTransactionId: swap.id }, {});
    expect(legs).toHaveLength(4);
    expect(legs.every((l: any) => l.status === FundsOrderStatus.CLEARED)).toBe(true);
    expect(legs.every((l: any) => l.attempt === 1)).toBe(true);

    // 2(sell)+1(settle)+2(buy)+2(fee) = 7 TB evidence rows for this swap.
    const evidence = await tbEvidence.findBySource('SWAP', swap.swapNo!);
    expect(evidence).toHaveLength(7);

    const actions = await auditActionsFor(swap.id, AuditEntityTypes.SWAP_TRANSACTION);
    expect(actions).toContain(AuditActions.SWAP_KYT_APPROVED);
    expect(actions).toContain(AuditActions.SWAP_SUCCEEDED);

    const after = await availableBalances();
    const fromDelta = decimalToBigint(amount, usdtDecimals);
    const toDelta = decimalToBigint(String(finalSwap.netToAmount), aedDecimals);
    expect(after.usdt).toBe(before.usdt - fromDelta);
    expect(after.aed).toBe(before.aed + toDelta);
  });

  it('2. THE HEADLINE PROPERTY（站3·出生锁版）— KYT rejected swap: 圈全擦、余额复原、零落笔零单据, quote consumed, restrictions block SWAP/WITHDRAW but not DEPOSIT', async () => {
    const before = await availableBalances();
    const amount = '50';

    const { swap, quoteId } = await createSwap(aedAssetId, 'AED', usdtAssetId, 'USDT', amount);
    expect(swap.status).toBe(SwapTransactionStatus.COMPLIANCE_PENDING);

    // Hard-line rejection with no attached remediation action — same shape as
    // the demo's V11_REJECTED_NO_TAG button (fixtures/verdict-buttons.ts).
    await workflow.applyKytVerdict(swap.id, { verdict: 'rejected', applicantActions: [] });

    const after = await swapService.findByIdInternal(swap.id);
    expect(after.status).toBe(SwapTransactionStatus.REJECTED);
    expect(after.rejectReason).toBe('KYT_REJECTED');

    // ── 站3·出生锁（业主 2026-08-27 裁定）后的性质：下单画的圈被全数擦除、
    // 无一笔落笔、零资金单——余额复原（下方 afterBalances 断言）是最终裁判。──
    const orders = await fundsOrders.findByParent({ swapTransactionId: swap.id }, {});
    expect(orders).toHaveLength(0);
    const evidence = await tbEvidence.findBySource('SWAP', swap.swapNo!);
    expect(evidence.length).toBeGreaterThan(0); // 圈画过（出生锁）
    expect(evidence.every((e: any) => e.transferType === 'VOIDED')).toBe(true); // 且全擦
    const flows = await (prisma as any).accountFlow.findMany({
      where: { sourceType: 'SWAP', sourceNo: swap.swapNo, transferType: 'POSTED' },
    });
    expect(flows).toHaveLength(0); // 无一笔真正落账

    const afterBalances = await availableBalances();
    expect(afterBalances).toEqual(before);

    // Quote consumed, cannot be reused.
    const quoteRow = await (prisma as any).swapQuote.findUnique({ where: { id: quoteId } });
    expect(quoteRow!.status).toBe('USED');

    // Restrictions written: SWAP + WITHDRAW blocked, DEPOSIT untouched.
    const rows = await restrictionsService.listOpen(customerId);
    // 聚合视图：一个 restrictionNo 一行，能力在 scopes 里（旧 list() 是一能力一行）。
    expect(rows.flatMap((r) => r.scopes).sort()).toEqual(['SWAP', 'WITHDRAW']);

    const retryQuote = await createQuote(aedAssetId, 'AED', usdtAssetId, 'USDT', '10');
    await expect(workflow.initiateSwap(customerId, retryQuote.id)).rejects.toMatchObject({ status: 403 });
    await expect(customerAccess.assertTradingEligibility(customerId, 'WITHDRAW')).rejects.toMatchObject({ status: 403 });
    await expect(customerAccess.assertTradingEligibility(customerId, 'DEPOSIT')).resolves.toBeUndefined();

    const disposedAudit = await auditActionsFor(swap.id, AuditEntityTypes.SWAP_TRANSACTION);
    expect(disposedAudit).toContain(AuditActions.SWAP_KYT_REJECTED);
    expect(disposedAudit).toContain(AuditActions.SWAP_KYT_REJECTED_DISPOSED);
  });
});
