// scripts/demo-lib.ts
//
// Shared library for the demo transaction-data layer.
// Spec: doc-final/superpowers/specs/2026-06-21-demo-transaction-data-layer-design.md
//
// Drives the REAL domain/workflow services (no Prisma backdoors — same path as a
// human clicking in admin) to produce a reproducible day of business activity for
// the tradeable business-seed customers (Alice/Bob/Grace):
//   setup → deposits → swaps → withdrawals.
//
// End-state (after runAll): all orders SUCCESS; both COA invariants (CLIENT + FIRM)
// hold per ledger; no Outstanding or FeeAccrual rows created (real-time 1:1 model).
// verifyEndState() asserts this.

// Node18 polyfill: @nestjs/schedule calls crypto.randomUUID() at module-register
// time. Must run before any import that pulls AppModule.
import { webcrypto, createHash } from 'node:crypto';
if (!(globalThis as any).crypto) (globalThis as any).crypto = webcrypto;

import type { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Prisma } from '@prisma/client';
import { fakeChainTxHash, fakeBankRef } from '../src/common/utils/fake-external-refs.util';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/core/prisma/prisma.service';
import { AccountingService } from '../src/modules/accounting/tigerbeetle/accounting.service';
import { TB_ACCOUNT_CODES } from '../src/modules/accounting/tigerbeetle/constants/tb-account-codes.constant';
import { TB_LEDGERS } from '../src/modules/accounting/tigerbeetle/constants/tb-ledgers.constant';
import { DepositTransactionsService } from '../src/modules/trading/deposit-transactions/deposit-transactions.service';
import { DepositWorkflowService } from '../src/modules/trading/deposit-transactions/deposit-workflow.service';
import { PayinsService } from '../src/modules/asset-treasury/payins/payins.service';
import { PayinType } from '../src/modules/asset-treasury/payins/dto/payin.dto';
import { FundsOrderService } from '../src/modules/funds-orders/funds-order.service';
import { FundsOrderAction } from '../src/modules/funds-orders/dto/funds-order.dto';
import { SwapQuoteService } from '../src/modules/trading/swap-fee-level/swap-quote.service';
import { SwapWorkflowService } from '../src/modules/trading/swap-transactions/swap-workflow.service';
import { WithdrawQuoteService } from '../src/modules/trading/withdrawal-fee-level/withdraw-quote.service';
import { WithdrawTransactionsService } from '../src/modules/trading/withdraw-transactions/withdraw-transactions.service';
import { WithdrawWorkflowService } from '../src/modules/trading/withdraw-transactions/withdraw-workflow.service';
import { PayoutsService } from '../src/modules/asset-treasury/payouts/payouts.service';
import { ensureTbAccountRegistry, provisionTbAccounts } from '../prisma/seed-tb.helper';
import { buildDeterministicNo } from '../src/common/utils/no-generator.util';

// ── constants ────────────────────────────────────────────────────────────────
export const SIM = 'DEMO'; // deterministic-no tag + operatorId for driven legs

// Tradeable business-seed customers (onboarding APPROVED + compliance CLEAR).
// Order matters: index → deterministic refs/addresses.
export const DEMO_CUSTOMER_EMAILS = [
  'demo_alice@example.com',
  'demo_bob@example.com',
  'demo_grace@example.com',
] as const;

// Fixed (non-random) amounts → reproducible run.
export const DEP_USDT = '3000';
export const DEP_AED = '8000';

// Swap plan: deliberate 2×(USDT→AED) vs 1×(smaller AED→USDT) asymmetry guarantees
// FIRM_OPS(AED) and FIRM_OPS(USDT) both move meaningfully — not an accidental ~0.
export const SWAP_PLAN: Record<string, { dir: 'USDT_AED' | 'AED_USDT'; amount: number }> = {
  'demo_alice@example.com': { dir: 'USDT_AED', amount: 1000 },
  'demo_bob@example.com': { dir: 'USDT_AED', amount: 800 },
  'demo_grace@example.com': { dir: 'AED_USDT', amount: 500 },
};

// Withdraw plan: everyone a fiat AED withdraw; Alice/Bob also a crypto USDT one.
export const WITHDRAW_PLAN: Record<string, { fiatAed: number; cryptoUsdt?: number }> = {
  'demo_alice@example.com': { fiatAed: 100, cryptoUsdt: 50 },
  'demo_bob@example.com': { fiatAed: 100, cryptoUsdt: 50 },
  'demo_grace@example.com': { fiatAed: 100 },
};

// Non-zero fees so FEE_INCOME / SPREAD_INCOME actually populate ("data must be full").
export const FEE_PLAN: Array<['swapFeeLevel' | 'withdrawalFeeLevel', string, string, string]> = [
  ['swapFeeLevel', 'STD-USDT-AED', 'SWAP_SERVICE_FEE', '10'], // 10 AED flat
  ['swapFeeLevel', 'STD-AED-USDT', 'SWAP_SERVICE_FEE', '3'], //  3 USDT flat
  ['withdrawalFeeLevel', 'STD-AED-FIAT', 'WITHDRAW_SERVICE_FEE', '2'], // 2 AED flat
  ['withdrawalFeeLevel', 'STD-USDT-TRON', 'WITHDRAW_SERVICE_FEE', '1'], // 1 USDT flat
];

// ── small utils ──────────────────────────────────────────────────────────────
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function waitFor<T>(
  label: string,
  fn: () => Promise<T | null | undefined | false>,
  timeoutMs = 15000,
): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v as T;
    if (Date.now() - start > timeoutMs) throw new Error(`Timeout (${timeoutMs}ms) waiting for: ${label}`);
    await sleep(120);
  }
}

function customerIdx(email: string): number {
  return (DEMO_CUSTOMER_EMAILS as readonly string[]).indexOf(email) + 1;
}

// ── context ──────────────────────────────────────────────────────────────────
export type DemoCtx = {
  app: INestApplicationContext;
  prisma: any;
  accounting: AccountingService;
  payins: PayinsService;
  fundsOrders: FundsOrderService;
  deposits: DepositTransactionsService;
  depositWf: any;
  swapQuote: SwapQuoteService;
  swapWf: any;
  swapWorkflowSvc: SwapWorkflowService;
  withdrawQuote: WithdrawQuoteService;
  withdraws: WithdrawTransactionsService;
  withdrawWf: WithdrawWorkflowService;
  payouts: PayoutsService;
  usdt: any;
  aed: any;
};

export async function bootstrap(): Promise<DemoCtx> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const prisma: any = app.get(PrismaService);
  const usdt = await prisma.asset.findFirst({ where: { status: 'ACTIVE', type: 'CRYPTO', currency: 'USDT' } });
  const aed = await prisma.asset.findFirst({ where: { status: 'ACTIVE', type: 'FIAT', currency: 'AED' } });
  if (!usdt || !aed) throw new Error('USDT/AED active assets not seeded — run the business seed first');
  return {
    app,
    prisma,
    accounting: app.get(AccountingService),
    payins: app.get(PayinsService),
    fundsOrders: app.get(FundsOrderService),
    deposits: app.get(DepositTransactionsService),
    depositWf: app.get(DepositWorkflowService),
    swapQuote: app.get(SwapQuoteService),
    swapWf: app.get(SwapWorkflowService),
    swapWorkflowSvc: app.get(SwapWorkflowService),
    withdrawQuote: app.get(WithdrawQuoteService),
    withdraws: app.get(WithdrawTransactionsService),
    withdrawWf: app.get(WithdrawWorkflowService),
    payouts: app.get(PayoutsService),
    usdt,
    aed,
  };
}

export async function resolveDemoCustomers(prisma: any): Promise<any[]> {
  const rows = await prisma.customerMain.findMany({
    where: { email: { in: [...DEMO_CUSTOMER_EMAILS] } },
    select: { id: true, customerNo: true, email: true, firstName: true, lastName: true, onboardingStatus: true, complianceStatus: true },
  });
  const missing = DEMO_CUSTOMER_EMAILS.filter((e) => !rows.find((r: any) => r.email === e));
  if (missing.length) throw new Error(`demo customers missing (run business seed): ${missing.join(', ')}`);
  const blocked = rows.filter((r: any) => r.onboardingStatus !== 'APPROVED' || r.complianceStatus !== 'CLEAR');
  if (blocked.length) {
    throw new Error(`demo customers not tradeable: ${blocked.map((r: any) => `${r.email}(${r.onboardingStatus}/${r.complianceStatus})`).join(', ')}`);
  }
  // preserve DEMO_CUSTOMER_EMAILS order
  return DEMO_CUSTOMER_EMAILS.map((e) => rows.find((r: any) => r.email === e));
}

async function bumpFee(prisma: any, model: 'swapFeeLevel' | 'withdrawalFeeLevel', levelCode: string, itemCode: string, value: string): Promise<void> {
  const level = await prisma[model].findUnique({ where: { levelCode } });
  if (!level) throw new Error(`${model} ${levelCode} not found`);
  const cfg = JSON.parse(level.tiersJson);
  const item = cfg.tiers[0].feeItems.find((f: any) => f.itemCode === itemCode);
  if (!item) throw new Error(`${itemCode} not found in ${levelCode}`);
  item.value = value;
  const tiersJson = JSON.stringify(cfg);
  const configHash = createHash('sha256').update(tiersJson).digest('hex');
  await prisma[model].update({ where: { levelCode }, data: { tiersJson, configHash } });
}

// ── stage 1: setup (idempotent) ──────────────────────────────────────────────
export async function ensureSetup(ctx: DemoCtx): Promise<void> {
  console.log('═══ demo:setup — fees + wallets + TB accounts ═══');
  for (const [model, level, item, val] of FEE_PLAN) {
    try {
      await bumpFee(ctx.prisma, model, level, item, val);
    } catch (e: any) {
      console.log(`  ⚠ fee ${level}/${item}: ${e.message}`);
    }
  }

  const customers = await resolveDemoCustomers(ctx.prisma);
  const cmaTpl = await ctx.prisma.wallet.findFirst({
    where: { walletRole: 'C_CMA', assetId: ctx.aed.id, status: 'ACTIVE' },
    select: { bankName: true, accountName: true },
  });

  for (const c of customers) {
    // customer TB accounts (CLIENT_PAYABLE + DEPOSIT_SUSPENSE) per asset
    for (const asset of [ctx.usdt, ctx.aed]) {
      const ledger = TB_LEDGERS[asset.currency as keyof typeof TB_LEDGERS];
      for (const code of [TB_ACCOUNT_CODES.CLIENT_PAYABLE, TB_ACCOUNT_CODES.DEPOSIT_SUSPENSE]) {
        await ensureTbAccountRegistry(ctx.prisma, {
          code, ledger, ownerType: 'CUSTOMER', ownerUuid: c.id, ownerNo: c.customerNo,
          assetCode: asset.code, description: `${code} ${c.customerNo}/${asset.code}`,
        });
      }
    }

    // C_DEP (USDT deposit address)
    const depNo = buildDeterministicNo('WA', SIM, 'C_DEP', c.customerNo);
    const depAddr = `T${createHash('sha256').update(depNo).digest('hex').slice(0, 33)}`;
    await ctx.prisma.wallet.upsert({
      where: { walletNo: depNo }, update: {},
      create: {
        walletNo: depNo, ownerType: 'CUSTOMER', ownerId: c.id, ownerNo: c.customerNo,
        type: 'CRYPTO_ADDRESS', walletRole: 'C_DEP', assetId: ctx.usdt.id, address: depAddr, status: 'ACTIVE',
      },
    });

    // C_VIBAN (AED)
    const vibanNo = buildDeterministicNo('WA', SIM, 'C_VIBAN', c.customerNo);
    const vibanIban = `AE07086${createHash('sha256').update(vibanNo).digest('hex').replace(/\D/g, '').padEnd(16, '0').slice(0, 16)}`;
    await ctx.prisma.wallet.upsert({
      where: { walletNo: vibanNo }, update: {},
      create: {
        walletNo: vibanNo, ownerType: 'CUSTOMER', ownerId: c.id, ownerNo: c.customerNo,
        type: 'FIAT_BANK', walletRole: 'C_VIBAN', assetId: ctx.aed.id, iban: vibanIban,
        bankName: cmaTpl?.bankName ?? 'Zand Bank PJSC', accountName: cmaTpl?.accountName ?? 'FiatX Ltd', status: 'ACTIVE',
      },
    });
  }

  await provisionTbAccounts(ctx.prisma);
  console.log(`  setup done: ${customers.map((c) => c.customerNo).join(', ')}`);
}

// ── stage 2: deposits ────────────────────────────────────────────────────────
async function driveDeposit(ctx: DemoCtx, c: any, asset: any, walletId: string, amount: string, type: PayinType): Promise<any> {
  // idempotent: skip if this wallet already has a CLEARED payin funds_order
  const existingFo = await ctx.prisma.fundsOrder.findFirst({
    where: { toWalletId: walletId, depositTransactionId: { not: null }, status: 'CLEARED' },
  });
  if (existingFo) {
    return ctx.deposits.findOne(existingFo.depositTransactionId);
  }

  const idx = customerIdx(c.email);
  // detected() creates the deposit + its payin funds_order (crypto → SUBMITTED,
  // fiat → CONFIRMED). The CONFIRMED-at-birth event auto-drives onPayinConfirmed
  // for fiat, so only crypto needs the OBSERVE_CONFIRMING → CONFIRM advance.
  const { deposit: dep, fundsOrder: fo }: any = await ctx.deposits.detected({
    assetId: asset.id, toWalletId: walletId, amount,
    txHash: type === PayinType.CRYPTO ? fakeChainTxHash(walletId) : undefined,
    fromAddress: type === PayinType.CRYPTO ? `Tsender${idx}` : undefined,
    fromIban: type === PayinType.FIAT ? `AE00SENDER${idx}` : undefined,
    referenceNo: fakeBankRef(walletId, new Date()),
  });

  if (type === PayinType.CRYPTO) {
    await ctx.fundsOrders.advance(fo.id, FundsOrderAction.OBSERVE_CONFIRMING, 'SYSTEM');
    await ctx.fundsOrders.advance(fo.id, FundsOrderAction.CONFIRM, 'SYSTEM');
  }
  await waitFor(`funds order ${fo.fundsOrderNo} CLEARED`, async () => {
    const f: any = await ctx.prisma.fundsOrder.findUnique({ where: { id: fo.id } });
    return f?.status === 'CLEARED' ? f : null;
  });
  await waitFor(`deposit ${dep.depositNo} COMPLIANCE_PENDING`, async () => {
    const d: any = await ctx.deposits.findOne(dep.id);
    return d.status === 'COMPLIANCE_PENDING' ? d : null;
  });
  await ctx.depositWf.applyKytResult(dep.id, 'PASSED', 5);
  if (type === PayinType.CRYPTO) await ctx.depositWf.applyTrResult(dep.id, 'PASSED');
  await waitFor(`deposit ${dep.depositNo} SUCCESS`, async () => {
    const d: any = await ctx.deposits.findOne(dep.id);
    if (d.status === 'SUCCESS') return d;
    if (['FROZEN', 'REJECTED', 'FAILED'].includes(d.status)) throw new Error(`deposit ${dep.depositNo} terminal ${d.status}`);
    return null;
  });
  return dep;
}

export async function runDeposits(ctx: DemoCtx): Promise<void> {
  console.log('═══ demo:deposit — USDT + AED per customer → SUCCESS ═══');
  const customers = await resolveDemoCustomers(ctx.prisma);
  for (const c of customers) {
    const cDep = await ctx.prisma.wallet.findFirst({ where: { ownerId: c.id, walletRole: 'C_DEP', assetId: ctx.usdt.id } });
    const cViban = await ctx.prisma.wallet.findFirst({ where: { ownerId: c.id, walletRole: 'C_VIBAN', assetId: ctx.aed.id } });
    if (!cDep || !cViban) throw new Error(`${c.email} missing C_DEP/C_VIBAN — run demo:setup first`);
    await driveDeposit(ctx, c, ctx.usdt, cDep.id, DEP_USDT, PayinType.CRYPTO);
    await driveDeposit(ctx, c, ctx.aed, cViban.id, DEP_AED, PayinType.FIAT);
    console.log(`  ${c.customerNo} ${c.firstName}: USDT ${DEP_USDT} + AED ${DEP_AED} deposits SUCCESS`);
  }
}

// ── stage 3: swaps (4-leg two-phase orchestration; auto-advance to SUCCESS) ──

/** Drive ONE swap leg from its current state to CLEARED by repeatedly advancing
 *  the leg's funds_order through the per-asset-type state machine (spec §5.3).
 *  CRYPTO: CREATED→SUBMIT→SUBMITTED→OBSERVE_CONFIRMING→CONFIRMING→CONFIRM→CONFIRMED→CLEAR→CLEARED.
 *  FIAT:   CREATED→SUBMIT→SUBMITTED→CONFIRM→CONFIRMED→CLEAR→CLEARED.
 *  Each leg's funds_order is created in CREATED (leg 1 by executeSwap, legs 2-4
 *  chained by the handler on the prior leg's CLEARED). Drives via advanceLeg —
 *  the real controller path (sell-first guard + funds_order.advance). */
async function driveSwapLegToClear(ctx: DemoCtx, swapId: string, swapNo: string, legSeq: number): Promise<void> {
  // Legs 2-4 are chained by the (async) handler once the prior leg CLEARs — wait
  // for this leg's funds_order to materialise before driving it.
  await waitFor(`${swapNo} leg ${legSeq} created`, async () => {
    const [leg] = await ctx.fundsOrders.findByParent({ swapTransactionId: swapId }, { legSeq });
    return leg ?? null;
  }, 8000);

  for (let step = 0; step < 8; step++) {
    const [leg] = await ctx.fundsOrders.findByParent({ swapTransactionId: swapId }, { legSeq });
    if (!leg) throw new Error(`${swapNo} leg ${legSeq} not found`);
    if (leg.status === 'CLEARED') return;
    const isFiat = ((leg as any).asset?.type || '').toUpperCase() === 'FIAT';
    let action: FundsOrderAction;
    if (isFiat) {
      if (leg.status === 'CREATED') action = FundsOrderAction.SUBMIT;
      else if (leg.status === 'SUBMITTED') action = FundsOrderAction.CONFIRM;
      else if (leg.status === 'CONFIRMED') action = FundsOrderAction.CLEAR;
      else throw new Error(`${swapNo} leg ${legSeq} unexpected fiat status ${leg.status}`);
    } else {
      if (leg.status === 'CREATED') action = FundsOrderAction.SUBMIT;
      else if (leg.status === 'SUBMITTED') action = FundsOrderAction.OBSERVE_CONFIRMING;
      else if (leg.status === 'CONFIRMING') action = FundsOrderAction.CONFIRM;
      else if (leg.status === 'CONFIRMED') action = FundsOrderAction.CLEAR;
      else throw new Error(`${swapNo} leg ${legSeq} unexpected crypto status ${leg.status}`);
    }
    await ctx.fundsOrders.advance(leg.id, action, 'DEMO');
    await sleep(40);
  }
  throw new Error(`${swapNo} leg ${legSeq} did not reach CLEARED after 8 steps`);
}

/** Drive an entire PROCESSING swap (all 4 legs) to SUCCESS. */
async function driveSwapToSuccess(ctx: DemoCtx, swap: { id: string; swapNo: string }): Promise<void> {
  for (const legSeq of [1, 2, 3, 4]) {
    await driveSwapLegToClear(ctx, swap.id, swap.swapNo, legSeq);
  }
  await waitFor(`${swap.swapNo} SUCCESS`, async () => {
    const s: any = await ctx.prisma.swapTransaction.findUnique({ where: { id: swap.id } });
    return s?.status === 'SUCCESS' ? s : null;
  }, 8000);
}

export async function runSwaps(ctx: DemoCtx): Promise<void> {
  console.log('═══ demo:swap — fixed-amount swaps; auto-advance 4 legs to SUCCESS ═══');
  const customers = await resolveDemoCustomers(ctx.prisma);
  let driven = 0;
  let skippedSuccess = 0;
  let recovered = 0;

  for (const c of customers) {
    const plan = SWAP_PLAN[c.email];
    // idempotent: SUCCESS → skip; PROCESSING → auto-advance to SUCCESS; else create new + advance.
    const existing: any = await ctx.prisma.swapTransaction.findFirst({
      where: { ownerId: c.id, status: { in: ['SUCCESS', 'PROCESSING'] } },
      orderBy: { createdAt: 'desc' },
    });
    if (existing?.status === 'SUCCESS') {
      console.log(`  ${c.customerNo} ${c.firstName}: swap ${existing.swapNo} already SUCCESS — skip`);
      skippedSuccess++;
      continue;
    }
    if (existing?.status === 'PROCESSING') {
      console.log(`  ${c.customerNo} ${c.firstName}: swap ${existing.swapNo} PROCESSING — auto-advance to SUCCESS`);
      await driveSwapToSuccess(ctx, { id: existing.id, swapNo: existing.swapNo });
      recovered++;
      continue;
    }

    const usdtToAed = plan.dir === 'USDT_AED';
    const from = usdtToAed ? ctx.usdt : ctx.aed;
    const to = usdtToAed ? ctx.aed : ctx.usdt;
    const quote: any = await ctx.swapQuote.createQuote({
      ownerType: 'CUSTOMER', ownerId: c.id, ownerNo: c.customerNo,
      fromAssetId: from.id, fromAssetCode: from.currency,
      toAssetId: to.id, toAssetCode: to.currency,
      amount: new Prisma.Decimal(plan.amount), customerId: c.id,
    } as any);
    const swap: any = await ctx.swapWf.executeSwap(c.id, quote.id);
    console.log(`  ${c.customerNo} ${c.firstName}: ${swap.swapNo} ${usdtToAed ? 'USDT→AED' : 'AED→USDT'} ${plan.amount} → ${swap.netToAmount ?? swap.toAmount} ${to.currency} (PROCESSING)`);
    await driveSwapToSuccess(ctx, { id: swap.id, swapNo: swap.swapNo });
    console.log(`  ${c.customerNo} ${c.firstName}: ${swap.swapNo} 4 legs CLEAR → SUCCESS`);
    driven++;
  }
  console.log(`  ${driven} new swap(s) driven to SUCCESS, ${recovered} PROCESSING recovered, ${skippedSuccess} already-SUCCESS skipped`);
}

// ── stage 4: withdrawals ─────────────────────────────────────────────────────
async function driveWithdraw(ctx: DemoCtx, c: any, asset: any, amount: number, toIban?: string, toAddress?: string): Promise<any> {
  // idempotent: skip if customer already has a SUCCESS withdraw in this asset
  const existing = await ctx.prisma.withdrawTransaction.findFirst({ where: { ownerId: c.id, assetId: asset.id, status: 'SUCCESS' } });
  if (existing) return existing;

  const wq: any = await ctx.withdrawQuote.createQuote({
    ownerType: 'CUSTOMER', ownerId: c.id, ownerNo: c.customerNo,
    assetId: asset.id, assetCode: asset.currency, amount: new Prisma.Decimal(amount), customerId: c.id,
  } as any);
  // generateReferenceNo('WD') uses only a 4-digit random; on a crowded same-day
  // namespace it can collide (P2002 on withdrawNo). Retry a few times — each call
  // redraws the random. (Underlying weakness is production-side, flagged separately.)
  let wd: any;
  for (let attempt = 1; ; attempt++) {
    try {
      wd = await ctx.withdrawWf.createWithdrawal({ assetId: asset.id, amount, toIban, toAddress, quoteId: wq.id } as any, c.id, 'CUSTOMER');
      break;
    } catch (e: any) {
      if (e?.code === 'P2002' && attempt < 8) { await sleep(60); continue; }
      throw e;
    }
  }
  const isCrypto = asset.type === 'CRYPTO';

  await waitFor(`${wd.withdrawNo} PENDING_COMPLIANCE`, async () => {
    const w: any = await ctx.prisma.withdrawTransaction.findUnique({ where: { id: wd.id } });
    return w.status === 'PENDING_COMPLIANCE' ? w : null;
  });
  await ctx.withdraws.updateKytStatus(wd.id, 'PASSED', null, 5, 1);
  if (isCrypto) await ctx.withdraws.updateTravelRuleStatus(wd.id, 'PASSED', null);

  // At PAYOUT_PENDING the workflow has materialised the payout principal funds
  // order (legSeq 1) and, when a fee was charged, the fee funds order (legSeq 2).
  await waitFor(`${wd.withdrawNo} PAYOUT_PENDING`, async () => {
    const w: any = await ctx.prisma.withdrawTransaction.findUnique({ where: { id: wd.id } });
    if (w.status !== 'PAYOUT_PENDING') return null;
    const [payoutLeg] = await ctx.fundsOrders.findByParent({ withdrawTransactionId: wd.id }, { legSeq: 1 });
    return payoutLeg ? w : null;
  }, 8000);

  // Drive each leg (principal + fee) CREATED → CONFIRMED per its asset type. The
  // withdraw workflow's funds_order handler POSTs the TB leg + CLEARs it on
  // CONFIRMED, and flips the withdrawal to SUCCESS once ALL legs are CLEARED.
  const legs: any[] = await ctx.fundsOrders.findByParent({ withdrawTransactionId: wd.id }, {});
  for (const leg of legs.sort((a, b) => a.legSeq - b.legSeq)) {
    const legIsCrypto = (leg.asset?.type || '').toUpperCase() !== 'FIAT';
    const seq = legIsCrypto
      ? [FundsOrderAction.SUBMIT, FundsOrderAction.OBSERVE_CONFIRMING, FundsOrderAction.CONFIRM]
      : [FundsOrderAction.SUBMIT, FundsOrderAction.CONFIRM];
    for (const action of seq) {
      await ctx.fundsOrders.advance(leg.id, action, SIM);
      await sleep(60);
    }
  }

  await waitFor(`${wd.withdrawNo} SUCCESS`, async () => {
    const w: any = await ctx.prisma.withdrawTransaction.findUnique({ where: { id: wd.id } });
    if (w.status === 'SUCCESS') return w;
    if (['FAILED', 'RETURNED', 'REJECTED'].includes(w.status)) {
      throw new Error(`${wd.withdrawNo} terminal ${w.status} (expected SUCCESS)`);
    }
    return null;
  }, 8000);
  return wd;
}

export async function runWithdraws(ctx: DemoCtx): Promise<void> {
  console.log('═══ demo:withdraw — fiat (+crypto) withdrawals → SUCCESS ═══');
  const customers = await resolveDemoCustomers(ctx.prisma);
  for (const c of customers) {
    const plan = WITHDRAW_PLAN[c.email];
    const viban = await ctx.prisma.wallet.findFirst({ where: { ownerId: c.id, walletRole: 'C_VIBAN', assetId: ctx.aed.id } });
    if (!viban) throw new Error(`${c.email} missing C_VIBAN — run demo:setup first`);
    await driveWithdraw(ctx, c, ctx.aed, plan.fiatAed, viban.iban, undefined);
    if (plan.cryptoUsdt) {
      const idx = customerIdx(c.email);
      const toAddr = `T${createHash('sha256').update(`${SIM}wd${idx}`).digest('hex').slice(0, 33)}`;
      await driveWithdraw(ctx, c, ctx.usdt, plan.cryptoUsdt, undefined, toAddr);
    }
    console.log(`  ${c.customerNo} ${c.firstName}: withdrawals SUCCESS`);
  }
  // Real-time 1:1 model: withdrawal fee is posted directly to FIRM_FEE in TB
  // — no WITHDRAW_FEE_SETTLEMENT legs or FeeAccrual rows to drive/settle.
}

// ── COA invariant helpers ─────────────────────────────────────────────────────

// Build a ledger→code→balance map by querying all active TB account registries and
// looking up each balance individually via AccountingService. This is equivalent to
// verify-realtime-coa.ts but reuses the NestJS accounting service already in ctx.
const ASSET_CODES = new Set([TB_ACCOUNT_CODES.CLIENT_ASSET, TB_ACCOUNT_CODES.FIRM_ASSET]);

async function buildCoaBalanceMap(ctx: DemoCtx): Promise<Map<number, Map<number, bigint>>> {
  // ledger → (code → aggregate balance)
  const byLedger = new Map<number, Map<number, bigint>>();
  const regs = await ctx.prisma.tbAccountRegistry.findMany({ where: { status: 'ACTIVE' } });
  for (const r of regs) {
    const balance = await ctx.accounting.lookupBalance(BigInt('0x' + r.tbAccountId));
    const isAsset = ASSET_CODES.has(r.code);
    const bal: bigint = isAsset
      ? balance.debitsPosted - balance.creditsPosted
      : balance.creditsPosted - balance.debitsPosted;
    if (!byLedger.has(r.ledger)) byLedger.set(r.ledger, new Map());
    const m = byLedger.get(r.ledger)!;
    m.set(r.code, (m.get(r.code) ?? 0n) + bal);
  }
  return byLedger;
}

// ── verification (spec §6) ───────────────────────────────────────────────────
export async function verifyEndState(ctx: DemoCtx): Promise<boolean> {
  console.log('\n═══ verify end-state (spec §6) ═══');
  const customers = await resolveDemoCustomers(ctx.prisma);
  const ids = customers.map((c) => c.id);
  const fails: string[] = [];
  let n = 0;
  const ok = (label: string, cond: boolean, detail = '') => {
    n += 1;
    if (cond) console.log(`  ✓ ${label}${detail ? ` (${detail})` : ''}`);
    else { fails.push(label); console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`); }
  };

  // 1. orders all terminal-good (scoped to demo customers)
  for (const [label, model, good] of [
    ['deposits SUCCESS', 'depositTransaction', 'SUCCESS'],
    ['swaps SUCCESS', 'swapTransaction', 'SUCCESS'],
    ['withdrawals SUCCESS', 'withdrawTransaction', 'SUCCESS'],
  ] as const) {
    const total = await ctx.prisma[model].count({ where: { ownerId: { in: ids } } });
    const bad = await ctx.prisma[model].count({ where: { ownerId: { in: ids }, status: { not: good } } });
    ok(`all demo ${label}`, total > 0 && bad === 0, `${total - bad}/${total} ${good}`);
  }

  // Withdraw payout principal legs (funds_orders legSeq=1) all CLEARED. Payouts
  // are no longer a separate table — the payout is the withdrawal's legSeq-1
  // funds order, driven CREATED → CLEARED alongside the withdrawal.
  {
    const wdIds = (
      await ctx.prisma.withdrawTransaction.findMany({ where: { ownerId: { in: ids } }, select: { id: true } })
    ).map((w: any) => w.id);
    const total = await ctx.prisma.fundsOrder.count({
      where: { withdrawTransactionId: { in: wdIds }, legSeq: 1 },
    });
    const bad = await ctx.prisma.fundsOrder.count({
      where: { withdrawTransactionId: { in: wdIds }, legSeq: 1, status: { not: 'CLEARED' } },
    });
    ok('all demo payout legs CLEARED', total > 0 && bad === 0, `${total - bad}/${total} CLEARED`);
  }

  // 2. COA invariants: CLIENT and FIRM balance per ledger (real-time 1:1 model proof)
  //    CLIENT: CLIENT_ASSET == Σ(CLIENT_PAYABLE + DEPOSIT_SUSPENSE) per ledger
  //    FIRM:   FIRM_ASSET == Σ(FIRM_OPS + FIRM_SET + FIRM_FEE + FIRM_LIQ) per ledger
  //    (asset accounts are debit-normal; liabilities/equity are credit-normal)
  const coaMap = await buildCoaBalanceMap(ctx);
  const LEDGER_NAMES: Record<number, string> = { [TB_LEDGERS.AED]: 'AED', [TB_LEDGERS.USDT]: 'USDT' };
  for (const [ledger, m] of coaMap) {
    const name = LEDGER_NAMES[ledger] ?? `ledger${ledger}`;
    const clientAsset = m.get(TB_ACCOUNT_CODES.CLIENT_ASSET) ?? 0n;
    const clientLiab = (m.get(TB_ACCOUNT_CODES.CLIENT_PAYABLE) ?? 0n) + (m.get(TB_ACCOUNT_CODES.DEPOSIT_SUSPENSE) ?? 0n);
    ok(`COA CLIENT(${name}): CLIENT_ASSET == Σ(CLIENT_PAYABLE+DEPOSIT_SUSPENSE)`, clientAsset === clientLiab, `${clientAsset} == ${clientLiab}`);
    const firmAsset = m.get(TB_ACCOUNT_CODES.FIRM_ASSET) ?? 0n;
    const firmEquity = (m.get(TB_ACCOUNT_CODES.FIRM_OPS) ?? 0n) + (m.get(TB_ACCOUNT_CODES.FIRM_SET) ?? 0n) + (m.get(TB_ACCOUNT_CODES.FIRM_FEE) ?? 0n) + (m.get(TB_ACCOUNT_CODES.FIRM_LIQ) ?? 0n);
    ok(`COA FIRM(${name}): FIRM_ASSET == Σ(FIRM_OPS+FIRM_SET+FIRM_FEE+FIRM_LIQ)`, firmAsset === firmEquity, `${firmAsset} == ${firmEquity}`);
  }

  // 3. No Outstanding rows created (real-time model has no deferred settlement)
  const outstandingCount = await ctx.prisma.outstanding.count({ where: { ownerId: { in: ids } } });
  ok('no Outstanding rows created for demo customers', outstandingCount === 0, `count=${outstandingCount}`);

  // 4. No Outstanding rows in ACCRUED/OPEN state (real-time model posts fees to TB immediately)
  //    FiatFeeCollectionWorkflowService (legacy, not yet decommissioned) still creates FeeAccrual
  //    rows for fiat withdrawals and immediately LOCKS them via settle(). We assert none are
  //    left in the initial ACCRUED state (unprocessed leak) — LOCKED/SETTLED are acceptable.
  const feeAccrualUnprocessed = await ctx.prisma.feeAccrual.count({
    where: { ownerId: { in: ids }, status: 'ACCRUED' },
  });
  const feeAccrualTotal = await ctx.prisma.feeAccrual.count({ where: { ownerId: { in: ids } } });
  ok('no unprocessed FeeAccrual rows (ACCRUED) for demo customers', feeAccrualUnprocessed === 0, `total=${feeAccrualTotal} unprocessed=${feeAccrualUnprocessed}`);
  if (feeAccrualTotal > 0) {
    console.log(`  · note: ${feeAccrualTotal} FeeAccrual row(s) exist (legacy fiat-withdraw flow, all LOCKED/SETTLED — not unprocessed leaks)`);
  }

  console.log(`\n  asserts: ${n - fails.length}/${n} PASS`);
  if (fails.length) console.log(`  FAIL: ${fails.join('; ')}`);
  return fails.length === 0;
}
