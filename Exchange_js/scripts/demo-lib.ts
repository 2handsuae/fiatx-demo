// scripts/demo-lib.ts
//
// Shared library for the demo transaction-data layer.
// Spec: doc-final/superpowers/specs/2026-06-21-demo-transaction-data-layer-design.md
//
// Drives the REAL domain/workflow services (no Prisma backdoors — same path as a
// human clicking in admin) to produce a reproducible day of business activity for
// the tradeable business-seed customers (Alice/Bob/Grace):
//   setup → deposits → swaps (fiat settled, crypto pending) → withdrawals.
//
// End-state (after runAll): all orders SUCCESS; fiat settled, crypto pending;
// TRADE_CLEARING(AED) and TRADE_CLEARING(USDT) both non-zero (bridge NOT swept,
// because we deliberately skip crypto EOD). verifyEndState() asserts this.

// Node18 polyfill: @nestjs/schedule calls crypto.randomUUID() at module-register
// time. Must run before any import that pulls AppModule.
import { webcrypto, createHash } from 'node:crypto';
if (!(globalThis as any).crypto) (globalThis as any).crypto = webcrypto;

import type { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Prisma } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/core/prisma/prisma.service';
import { AccountingService } from '../src/modules/accounting/tigerbeetle/accounting.service';
import { TB_ACCOUNT_CODES } from '../src/modules/accounting/tigerbeetle/constants/tb-account-codes.constant';
import { TB_LEDGERS } from '../src/modules/accounting/tigerbeetle/constants/tb-ledgers.constant';
import { DepositTransactionsService } from '../src/modules/trading/deposit-transactions/deposit-transactions.service';
import { DepositWorkflowService } from '../src/modules/trading/deposit-transactions/deposit-workflow.service';
import { PayinsService } from '../src/modules/asset-treasury/payins/payins.service';
import { PayinAction, PayinType } from '../src/modules/asset-treasury/payins/dto/payin.dto';
import { SwapQuoteService } from '../src/modules/trading/swap-fee-level/swap-quote.service';
import { SwapWorkflowService } from '../src/modules/trading/swap-transactions/swap-workflow.service';
import { FundsFlowService } from '../src/modules/funds-layer/domain/funds-flow.service';
import { InternalFundAction } from '../src/modules/funds-layer/dto/internal-fund.dto';
import { WithdrawQuoteService } from '../src/modules/trading/withdrawal-fee-level/withdraw-quote.service';
import { WithdrawTransactionsService } from '../src/modules/trading/withdraw-transactions/withdraw-transactions.service';
import { PayoutsService } from '../src/modules/asset-treasury/payouts/payouts.service';
import { PayoutAction } from '../src/modules/asset-treasury/payouts/dto/payout.dto';
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
// TRADE_CLEARING(AED) nets clearly non-zero (negative) — not an accidental ~0.
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
  deposits: DepositTransactionsService;
  depositWf: any;
  swapQuote: SwapQuoteService;
  swapWf: any;
  fundsFlow: FundsFlowService;
  withdrawQuote: WithdrawQuoteService;
  withdraws: WithdrawTransactionsService;
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
    deposits: app.get(DepositTransactionsService),
    depositWf: app.get(DepositWorkflowService),
    swapQuote: app.get(SwapQuoteService),
    swapWf: app.get(SwapWorkflowService),
    fundsFlow: app.get(FundsFlowService),
    withdrawQuote: app.get(WithdrawQuoteService),
    withdraws: app.get(WithdrawTransactionsService),
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

// ── balance helpers (credit-net, scaled bigint units) ────────────────────────
async function creditNet(accounting: AccountingService, code: number, ledger: number, ownerUuid?: string): Promise<bigint> {
  const id = await accounting.resolveTbAccountId({ code, ledger, ownerType: ownerUuid ? 'CUSTOMER' : 'SYSTEM', ownerUuid });
  const b = await accounting.lookupBalance(id);
  return b.creditsPosted - b.debitsPosted;
}

// ── leg drivers (mirror funds-simulate controller; sleeps avoid SQLite P2028) ──
export async function driveFiatLeg(fundsFlow: FundsFlowService, fundId: string): Promise<void> {
  await fundsFlow.updateStatus(fundId, { action: InternalFundAction.SUBMIT } as any, SIM);
  await sleep(120);
  await fundsFlow.updateStatus(fundId, { action: InternalFundAction.CONFIRM } as any, SIM);
  await sleep(250);
}

export async function driveCryptoLeg(fundsFlow: FundsFlowService, fundId: string): Promise<void> {
  for (const action of [InternalFundAction.SIGN, InternalFundAction.BROADCAST, InternalFundAction.SEEN_IN_MEMPOOL, InternalFundAction.CONFIRM]) {
    await fundsFlow.updateStatus(fundId, { action } as any, SIM);
    await sleep(120);
  }
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

// Drive FIAT fee-settlement legs to CLEAR so their FeeAccruals flip LOCKED→SETTLED.
// FIAT swap/withdraw success auto-spawns SWAP_FEE_SETTLEMENT / WITHDRAW_FEE_SETTLEMENT
// transfers (F_*→F_FEE) with accruals LOCKED, but the leg is never driven on its own.
// Crypto fee accruals are intentionally left ACCRUED (their settlement is the EOD pass,
// which we skip — consistent with "crypto pending"). Scoped to demo customers + AED.
// Polls a few rounds because the accrual/settle is event-driven (may lag the order).
async function settleFiatFees(ctx: DemoCtx, sourceTypes: string[], label: string): Promise<void> {
  const customers = await resolveDemoCustomers(ctx.prisma);
  const ids = customers.map((c) => c.id);
  let total = 0;
  let quiet = 0;
  for (let round = 0; round < 8 && quiet < 2; round++) {
    await sleep(500);
    const txs = await ctx.prisma.internalTransaction.findMany({
      where: { sourceType: { in: sourceTypes }, assetId: ctx.aed.id, ownerId: { in: ids } },
      select: { id: true },
    });
    let driven = 0;
    for (const tx of txs) {
      const leg = await ctx.prisma.internalFund.findFirst({ where: { internalTransactionId: tx.id, status: { not: 'CLEAR' } } });
      if (!leg) continue;
      await driveFiatLeg(ctx.fundsFlow, leg.id);
      driven += 1; total += 1;
    }
    quiet = driven === 0 ? quiet + 1 : 0;
  }
  console.log(`  fiat ${label} fee-settlement legs driven: ${total}`);
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
  // idempotent: skip if this wallet already has a CLEARED payin
  const existing = await ctx.prisma.payin.findFirst({ where: { toWalletId: walletId, status: 'CLEARED' } });
  if (existing) return existing;

  const idx = customerIdx(c.email);
  const payin: any = await ctx.payins.createDetected({
    assetId: asset.id, toWalletId: walletId, type, amount,
    txHash: type === PayinType.CRYPTO ? `0x${SIM}${idx}USDT` : undefined,
    fromAddress: type === PayinType.CRYPTO ? `Tsender${idx}` : undefined,
    fromIban: type === PayinType.FIAT ? `AE00SENDER${idx}` : undefined,
    referenceNo: `REF-${SIM}-${idx}-${asset.currency}`,
  } as any);

  const dep: any = await waitFor(`deposit for payin ${payin.payinNo}`, () => ctx.deposits.findByPayinId(payin.id));

  if (type === PayinType.CRYPTO) {
    await ctx.payins.updateStatus(payin.id, PayinAction.BLOCK);
    await ctx.payins.updateStatus(payin.id, PayinAction.CONFIRM);
  } else {
    await ctx.payins.updateStatus(payin.id, PayinAction.CONFIRM);
  }
  await waitFor(`payin ${payin.payinNo} CLEARED`, async () => {
    const p: any = await ctx.payins.findOne(payin.id);
    return p.status === 'CLEARED' ? p : null;
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

// ── stage 3: swaps (fiat settled; crypto pending — NO EOD) ────────────────────
export async function runSwaps(ctx: DemoCtx): Promise<void> {
  console.log('═══ demo:swap — fixed-amount swaps; fiat leg settled, crypto pending (no EOD) ═══');
  const customers = await resolveDemoCustomers(ctx.prisma);
  const swaps: Array<{ c: any; swap: any; dir: string }> = [];

  for (const c of customers) {
    const plan = SWAP_PLAN[c.email];
    // idempotent: skip if customer already has a SUCCESS swap
    const existing = await ctx.prisma.swapTransaction.findFirst({ where: { ownerId: c.id, status: 'SUCCESS' } });
    if (existing) {
      console.log(`  ${c.customerNo} ${c.firstName}: swap already exists (${existing.swapNo}) — skip`);
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
    swaps.push({ c, swap, dir: usdtToAed ? 'USDT→AED' : 'AED→USDT' });
    console.log(`  ${c.customerNo} ${c.firstName}: ${swap.swapNo} ${usdtToAed ? 'USDT→AED' : 'AED→USDT'} ${plan.amount} → ${swap.netToAmount} ${to.currency} (fee ${swap.feeAmount}, spread ${swap.spreadAmount})`);
  }

  // drive swap-spawned FIAT settlement legs (FIAT_SETTLE_IN / OUT; 2-hop bank transfer)
  if (swaps.length) console.log('  driving FIAT settlement legs...');
  for (const { c, swap } of swaps) {
    const settleTx: any = await waitFor(`FIAT settle tx for ${swap.swapNo}`, () =>
      ctx.prisma.internalTransaction.findFirst({ where: { sourceType: 'FIAT_SETTLEMENT', sourceId: { startsWith: swap.id } } }));
    const legs = await ctx.prisma.internalFund.findMany({ where: { internalTransactionId: settleTx.id }, orderBy: { createdAt: 'asc' } });
    const hop1 = legs[0];
    const hop2 = legs[1];
    await driveFiatLeg(ctx.fundsFlow, hop1.id);
    if (hop2) {
      await waitFor(`${swap.swapNo} hop2 CONFIRMING`, async () => {
        const f: any = await ctx.prisma.internalFund.findUnique({ where: { id: hop2.id } });
        return f && f.status === 'CONFIRMING' ? f : null;
      });
      await ctx.fundsFlow.updateStatus(hop2.id, { action: InternalFundAction.CONFIRM } as any, SIM);
    }
    console.log(`    ${c.customerNo}: ${swap.swapNo} fiat leg settled`);
  }
  await sleep(500);
  // settle the FIAT swap-fee accruals (fee + spread): drive SWAP_FEE_SETTLEMENT legs.
  await settleFiatFees(ctx, ['SWAP_FEE_SETTLEMENT'], 'swap');
  // NOTE (spec §4.3): deliberately NOT calling runEodSettlement — crypto Outstanding
  // stays OPEN and both TRADE_CLEARING bridges remain live.
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
      wd = await ctx.withdraws.create({ assetId: asset.id, amount, toIban, toAddress, quoteId: wq.id } as any, c.id, 'CUSTOMER');
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

  try {
    const wdp: any = await waitFor(`${wd.withdrawNo} PAYOUT_PENDING`, async () => {
      const w: any = await ctx.prisma.withdrawTransaction.findUnique({ where: { id: wd.id } });
      return w.status === 'PAYOUT_PENDING' && w.payoutId ? w : null;
    }, 8000);
    // Drive payout to CLEARED. CLEAR is gated to system closeout (operatorId='SYSTEM').
    const seq = isCrypto
      ? [PayoutAction.SIGN, PayoutAction.BROADCAST, PayoutAction.SEEN_IN_MEMPOOL, PayoutAction.CONFIRM, PayoutAction.CLEAR]
      : [PayoutAction.SUBMIT, PayoutAction.CONFIRM, PayoutAction.CLEAR];
    for (const action of seq) {
      const op = action === PayoutAction.CLEAR ? 'SYSTEM' : SIM;
      await ctx.payouts.updateStatus(wdp.payoutId, { action } as any, op);
      await sleep(80);
    }
    await waitFor(`${wd.withdrawNo} SUCCESS`, async () => {
      const w: any = await ctx.prisma.withdrawTransaction.findUnique({ where: { id: wd.id } });
      return w.status === 'SUCCESS' ? w : null;
    }, 8000);
  } catch (e: any) {
    // A redundant CLEAR on an already-CLEARED payout (system auto-closeout fired on
    // CONFIRM) throws "Invalid action CLEAR"; that is success, not a failure.
    const w: any = await ctx.prisma.withdrawTransaction.findUnique({ where: { id: wd.id } });
    const po = w.payoutId ? await ctx.prisma.payout.findUnique({ where: { id: w.payoutId } }) : null;
    if (!(w.status === 'SUCCESS' && po?.status === 'CLEARED')) {
      throw new Error(`${wd.withdrawNo} not SUCCESS: withdraw=${w.status} payout=${po?.status ?? 'n/a'} (${e.message})`);
    }
  }
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
  // settle the FIAT withdraw-fee accruals: drive WITHDRAW_FEE_SETTLEMENT legs.
  await settleFiatFees(ctx, ['WITHDRAW_FEE_SETTLEMENT'], 'withdraw');
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
    ['payouts CLEARED', 'payout', 'CLEARED'],
  ] as const) {
    const total = await ctx.prisma[model].count({ where: { ownerId: { in: ids } } });
    const bad = await ctx.prisma[model].count({ where: { ownerId: { in: ids }, status: { not: good } } });
    ok(`all demo ${label}`, total > 0 && bad === 0, `${total - bad}/${total} ${good}`);
  }

  // 2. TRADE_CLEARING ≠ 0 on BOTH ledgers (system bridge, not swept)
  const tcAed = await creditNet(ctx.accounting, TB_ACCOUNT_CODES.TRADE_CLEARING, TB_LEDGERS.AED);
  const tcUsdt = await creditNet(ctx.accounting, TB_ACCOUNT_CODES.TRADE_CLEARING, TB_LEDGERS.USDT);
  ok('TRADE_CLEARING(AED) ≠ 0', tcAed !== 0n, `credit-net=${tcAed}`);
  ok('TRADE_CLEARING(USDT) ≠ 0', tcUsdt !== 0n, `credit-net=${tcUsdt}`);

  // 3. crypto (USDT) Outstanding still OPEN — crypto pending settlement
  const cryptoOpen = await ctx.prisma.outstanding.count({ where: { ownerId: { in: ids }, assetId: ctx.usdt.id, status: { in: ['OPEN', 'LOCKED'] } } });
  ok('crypto(USDT) Outstanding OPEN exists', cryptoOpen > 0, `open=${cryptoOpen}`);

  // 4. fiat (AED) Outstanding all SETTLED
  const fiatOpen = await ctx.prisma.outstanding.count({ where: { ownerId: { in: ids }, assetId: ctx.aed.id, status: { in: ['OPEN', 'LOCKED'] } } });
  ok('fiat(AED) Outstanding all SETTLED', fiatOpen === 0, `stillOpen=${fiatOpen}`);

  // 5. fiat (AED) FeeAccruals all SETTLED (swap fee+spread & withdraw fee)
  const feeTotal = await ctx.prisma.feeAccrual.count({ where: { ownerId: { in: ids }, assetId: ctx.aed.id } });
  const feeUnsettled = await ctx.prisma.feeAccrual.count({ where: { ownerId: { in: ids }, assetId: ctx.aed.id, status: { not: 'SETTLED' } } });
  ok('fiat(AED) FeeAccruals all SETTLED', feeTotal > 0 && feeUnsettled === 0, `${feeTotal - feeUnsettled}/${feeTotal} SETTLED`);
  // info: crypto fee accruals stay pending (deferred to the skipped EOD) — consistent with crypto-pending
  const cryptoFeePending = await ctx.prisma.feeAccrual.count({ where: { ownerId: { in: ids }, assetId: ctx.usdt.id, status: { not: 'SETTLED' } } });
  console.log(`  · crypto(USDT) FeeAccruals pending (deferred to EOD): ${cryptoFeePending}`);

  console.log(`\n  asserts: ${n - fails.length}/${n} PASS`);
  if (fails.length) console.log(`  FAIL: ${fails.join('; ')}`);
  return fails.length === 0;
}
