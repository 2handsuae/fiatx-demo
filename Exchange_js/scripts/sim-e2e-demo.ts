// scripts/sim-e2e-demo.ts
//
// 10-customer end-to-end business simulation (branch stack).
// Modeled on scripts/verify-two-book.ts — drives the REAL domain services:
//   init fees → 10× (crypto + fiat deposit → CLEARED) → 10× random swap
//   → 10× withdraw → EOD settlement + fee collection.
//
// ADDITIVE: creates its own 10 fresh `sim_c01..c10` customers + per-customer
// C_DEP/C_VIBAN wallets + CLIENT_PAYABLE/DEPOSIT_SUSPENSE TB accounts, so the
// report can query only this run's entities. It does NOT reset the DB.
//
// Run:
//   DATABASE_URL="file:/tmp/exchange_js_branch/dev.db" TB_ADDRESS=127.0.0.1:3503 \
//     node -r ts-node/register -r tsconfig-paths/register scripts/sim-e2e-demo.ts

import { webcrypto, createHash } from 'node:crypto';
if (!(globalThis as any).crypto) (globalThis as any).crypto = webcrypto;

import { NestFactory } from '@nestjs/core';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/core/prisma/prisma.service';
import { AccountingService } from '../src/modules/accounting/tigerbeetle/accounting.service';
import { TB_ACCOUNT_CODES } from '../src/modules/accounting/tigerbeetle/constants/tb-account-codes.constant';
import { TB_LEDGERS } from '../src/modules/accounting/tigerbeetle/constants/tb-ledgers.constant';
import { DepositTransactionsService } from '../src/modules/trading/deposit-transactions/deposit-transactions.service';
import { PayinsService } from '../src/modules/asset-treasury/payins/payins.service';
import { PayinAction, PayinType } from '../src/modules/asset-treasury/payins/dto/payin.dto';
import { SwapQuoteService } from '../src/modules/trading/swap-fee-level/swap-quote.service';
import { SwapWorkflowService } from '../src/modules/trading/swap-transactions/swap-workflow.service';
import { FundsFlowService } from '../src/modules/funds-layer/domain/funds-flow.service';
import { InternalFundAction } from '../src/modules/asset-treasury/internal-funds/dto/internal-fund.dto';
import { EodSettlementWorkflowService } from '../src/modules/funds-layer/workflow/eod-settlement-workflow.service';
import { WithdrawQuoteService } from '../src/modules/trading/withdrawal-fee-level/withdraw-quote.service';
import { WithdrawTransactionsService } from '../src/modules/trading/withdraw-transactions/withdraw-transactions.service';
import { PayoutsService } from '../src/modules/asset-treasury/payouts/payouts.service';
import { PayoutAction } from '../src/modules/asset-treasury/payouts/dto/payout.dto';
import { ensureTbAccountRegistry, provisionTbAccounts } from '../prisma/seed-tb.helper';
import { buildDeterministicNo } from '../src/common/utils/no-generator.util';

const SIM = 'SIME2E';                       // tag for deterministic nos
const N = 10;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor<T>(label: string, fn: () => Promise<T | null | undefined | false>, timeoutMs = 15000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v as T;
    if (Date.now() - start > timeoutMs) throw new Error(`Timeout (${timeoutMs}ms) waiting for: ${label}`);
    await sleep(120);
  }
}

// deterministic per-customer RNG so the run is reproducible
function seeded(i: number) {
  let s = (i * 2654435761) >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 0xffffffff; };
}

async function main() {
  const ctx = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const prisma: any = ctx.get(PrismaService);
  const accounting = ctx.get(AccountingService);
  const depositService = ctx.get(DepositTransactionsService);
  const payinsService = ctx.get(PayinsService);
  const swapQuoteService = ctx.get(SwapQuoteService);
  const swapWorkflow = ctx.get(SwapWorkflowService);
  const fundsFlow = ctx.get(FundsFlowService);
  const eodWorkflow = ctx.get(EodSettlementWorkflowService);
  const withdrawQuoteService = ctx.get(WithdrawQuoteService);
  const withdrawService = ctx.get(WithdrawTransactionsService);
  const payoutsService = ctx.get(PayoutsService);

  const usdt = await prisma.asset.findFirst({ where: { status: 'ACTIVE', type: 'CRYPTO', currency: 'USDT' } });
  const aed = await prisma.asset.findFirst({ where: { status: 'ACTIVE', type: 'FIAT', currency: 'AED' } });
  if (!usdt || !aed) throw new Error('USDT/AED assets not seeded');

  // ── leg drivers (mirror funds-simulate controller) ──
  // The terminal transition (CONFIRM→CLEAR) fires async event handlers that
  // mirror to TB + write evidence + audit logs, all contending for SQLite's
  // single writer lock. A short settle delay between transitions avoids the
  // P2028 "transaction already closed" 5s timeout under load.
  async function driveFiatLeg(fundId: string) {
    await fundsFlow.updateStatus(fundId, { action: InternalFundAction.SUBMIT } as any, SIM);
    await sleep(120);
    await fundsFlow.updateStatus(fundId, { action: InternalFundAction.CONFIRM } as any, SIM);
    await sleep(250);
  }
  async function driveCryptoLeg(fundId: string) {
    for (const action of [
      InternalFundAction.SIGN, InternalFundAction.BROADCAST,
      InternalFundAction.SEEN_IN_MEMPOOL, InternalFundAction.CONFIRM,
    ]) {
      await fundsFlow.updateStatus(fundId, { action } as any, SIM);
      await sleep(120);
    }
  }

  // ════════════════════════════════════════════════════════════════
  // TASK 1: init business data — non-zero fees BOTH swap dirs + BOTH withdraw levels
  // ════════════════════════════════════════════════════════════════
  console.log('\n═══ TASK 1: init fees (both directions, non-zero) ═══');
  async function bumpFee(model: 'swapFeeLevel' | 'withdrawalFeeLevel', levelCode: string, itemCode: string, value: string) {
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
  await bumpFee('swapFeeLevel', 'STD-USDT-AED', 'SWAP_SERVICE_FEE', '10');  // 10 AED flat
  await bumpFee('swapFeeLevel', 'STD-AED-USDT', 'SWAP_SERVICE_FEE', '3');   // 3 USDT flat (≈11 AED)
  await bumpFee('withdrawalFeeLevel', 'STD-AED-FIAT', 'WITHDRAW_SERVICE_FEE', '2');  // 2 AED flat
  await bumpFee('withdrawalFeeLevel', 'STD-USDT-TRON', 'WITHDRAW_SERVICE_FEE', '1'); // 1 USDT flat
  console.log('  swap STD-USDT-AED=10 AED, STD-AED-USDT=3 USDT; withdraw AED=2, USDT=1');

  // ════════════════════════════════════════════════════════════════
  // Provision 10 fresh customers + wallets + TB accounts
  // ════════════════════════════════════════════════════════════════
  console.log('\n═══ Provision 10 customers + C_DEP/C_VIBAN wallets + TB accounts ═══');
  const passwordHash = await bcrypt.hash('123456', 10);
  const cmaTpl = await prisma.wallet.findFirst({
    where: { walletRole: 'C_CMA', assetId: aed.id, status: 'ACTIVE' },
    select: { bankName: true, accountName: true },
  });

  type Cust = { idx: number; id: string; customerNo: string; email: string; depId: string; vibanId: string; vibanIban: string; depAddr: string };
  const custs: Cust[] = [];

  for (let i = 1; i <= N; i++) {
    const tag = String(i).padStart(2, '0');
    const email = `sim_c${tag}@example.com`;
    const customerNo = buildDeterministicNo('CU', email);
    const customer = await prisma.customerMain.upsert({
      where: { email },
      update: {
        onboardingStatus: 'APPROVED', adminStatus: 'ACTIVE', complianceStatus: 'CLEAR',
        riskRating: 'LOW', tradingTier: 'PREMIUM',
      },
      create: {
        email, customerNo, phone: `+15553${tag}0000`,
        firstName: `Sim${tag}`, lastName: 'E2E', passwordHash, passwordUpdatedAt: new Date(),
        customerType: 'INDIVIDUAL', onboardingStatus: 'APPROVED', adminStatus: 'ACTIVE',
        complianceStatus: 'CLEAR', riskRating: 'LOW', tradingTier: 'PREMIUM', eddRequired: false,
      },
      select: { id: true, customerNo: true },
    });

    // customer TB accounts (CLIENT_PAYABLE + DEPOSIT_SUSPENSE) per asset
    for (const asset of [usdt, aed]) {
      const ledger = TB_LEDGERS[asset.currency as keyof typeof TB_LEDGERS];
      for (const code of [TB_ACCOUNT_CODES.CLIENT_PAYABLE, TB_ACCOUNT_CODES.DEPOSIT_SUSPENSE]) {
        await ensureTbAccountRegistry(prisma, {
          code, ledger, ownerType: 'CUSTOMER', ownerUuid: customer.id, ownerNo: customer.customerNo,
          assetCode: asset.code, description: `${code} for ${customer.customerNo}/${asset.code}`,
        });
      }
    }

    // C_DEP (USDT deposit address)
    const depNo = buildDeterministicNo('WA', SIM, 'C_DEP', customer.customerNo);
    const depAddr = `T${createHash('sha256').update(depNo).digest('hex').slice(0, 33)}`;
    await prisma.wallet.upsert({
      where: { walletNo: depNo }, update: {},
      create: {
        walletNo: depNo, ownerType: 'CUSTOMER', ownerId: customer.id, ownerNo: customer.customerNo,
        type: 'CRYPTO_ADDRESS', walletRole: 'C_DEP', assetId: usdt.id, address: depAddr, status: 'ACTIVE',
      },
    });
    const depW = await prisma.wallet.findUnique({ where: { walletNo: depNo } });

    // C_VIBAN (AED)
    const vibanNo = buildDeterministicNo('WA', SIM, 'C_VIBAN', customer.customerNo);
    const vibanIban = `AE07086${createHash('sha256').update(vibanNo).digest('hex').replace(/\D/g, '').padEnd(16, '0').slice(0, 16)}`;
    await prisma.wallet.upsert({
      where: { walletNo: vibanNo }, update: {},
      create: {
        walletNo: vibanNo, ownerType: 'CUSTOMER', ownerId: customer.id, ownerNo: customer.customerNo,
        type: 'FIAT_BANK', walletRole: 'C_VIBAN', assetId: aed.id, iban: vibanIban,
        bankName: cmaTpl?.bankName ?? 'Zand Bank PJSC', accountName: cmaTpl?.accountName ?? 'FiatX Ltd',
        status: 'ACTIVE',
      },
    });
    const vibanW = await prisma.wallet.findUnique({ where: { walletNo: vibanNo } });

    custs.push({ idx: i, id: customer.id, customerNo: customer.customerNo, email, depId: depW.id, vibanId: vibanW.id, vibanIban, depAddr });
  }
  // push customer TB registry rows into TigerBeetle
  await provisionTbAccounts(prisma);
  console.log(`  provisioned ${custs.length} customers: ${custs[0].customerNo} .. ${custs[N - 1].customerNo}`);

  // ════════════════════════════════════════════════════════════════
  // TASK 2: 10 customers — crypto (USDT) + fiat (AED) deposits → CLEARED
  // Event-driven payin pipeline: createDetected → CONFIRM (→STEP_1 + auto-CLEAR
  // payin (mockBalance credit) + enter compliance) → KYT/TR PASSED → auto STEP_2
  // (CLIENT_PAYABLE credited, consumed by swaps).
  // ════════════════════════════════════════════════════════════════
  console.log('\n═══ TASK 2: 10× crypto + fiat deposits → CLEARED ═══');
  const DEP_USDT = '3000';   // generous so any swap dir/amount has balance
  const DEP_AED = '8000';

  async function driveDeposit(c: Cust, asset: any, walletId: string, amount: string, type: PayinType) {
    // idempotent: skip if this wallet already has a CLEARED payin (re-run safety)
    const existing = await prisma.payin.findFirst({ where: { toWalletId: walletId, status: 'CLEARED' } });
    if (existing) return existing;
    const payin = await payinsService.createDetected({
      assetId: asset.id, toWalletId: walletId, type, amount,
      txHash: type === PayinType.CRYPTO ? `0x${SIM}${c.idx}${asset.code}` : undefined,
      fromAddress: type === PayinType.CRYPTO ? `Tsender${c.idx}` : undefined,
      fromIban: type === PayinType.FIAT ? `AE00SENDER${c.idx}` : undefined,
      referenceNo: `REF-${SIM}-${c.idx}-${asset.code}`,
    } as any);
    // workflow auto-creates the deposit (PAYIN_PENDING) on payin.created
    const dep = await waitFor(`deposit for payin ${payin.payinNo}`, () => depositService.findByPayinId(payin.id));
    // Drive payin DETECTED → CONFIRMED (crypto: BLOCK→CONFIRMING→CONFIRM; fiat: CONFIRM).
    // Reaching CONFIRMED makes the workflow post STEP_1 + auto-CLEAR the payin
    // (mockBalance credit) + move the deposit to COMPLIANCE_PENDING.
    if (type === PayinType.CRYPTO) {
      await payinsService.updateStatus(payin.id, PayinAction.BLOCK);
      await payinsService.updateStatus(payin.id, PayinAction.CONFIRM);
    } else {
      await payinsService.updateStatus(payin.id, PayinAction.CONFIRM);
    }
    await waitFor(`payin ${payin.payinNo} CLEARED`, async () => {
      const p = await payinsService.findOne(payin.id);
      return p.status === 'CLEARED' ? p : null;
    });
    // satisfy compliance gates → auto-approval posts STEP_2 (CLIENT_PAYABLE)
    const depWf: any = ctx.get((await import('../src/modules/trading/deposit-transactions/deposit-workflow.service')).DepositWorkflowService);
    await waitFor(`deposit ${dep.depositNo} COMPLIANCE_PENDING`, async () => {
      const d = await depositService.findOne(dep.id);
      return d.status === 'COMPLIANCE_PENDING' ? d : null;
    });
    await depWf.applyKytResult(dep.id, 'PASSED', 5);
    if (type === PayinType.CRYPTO) await depWf.applyTrResult(dep.id, 'PASSED');
    await waitFor(`deposit ${dep.depositNo} SUCCESS`, async () => {
      const d = await depositService.findOne(dep.id);
      if (d.status === 'SUCCESS') return d;
      if (d.status === 'FROZEN' || d.status === 'REJECTED' || d.status === 'FAILED') {
        throw new Error(`deposit ${dep.depositNo} terminal ${d.status}`);
      }
      return null;
    });
    return dep;
  }

  for (const c of custs) {
    await driveDeposit(c, usdt, c.depId, DEP_USDT, PayinType.CRYPTO);
    await driveDeposit(c, aed, c.vibanId, DEP_AED, PayinType.FIAT);
    process.stdout.write(`  ${c.customerNo}: USDT+AED deposits CLEARED\n`);
  }

  // ════════════════════════════════════════════════════════════════
  // TASK 3: 10 customers — random-direction random-amount swap → success
  // ════════════════════════════════════════════════════════════════
  console.log('\n═══ TASK 3: 10× random swaps ═══');
  const swaps: Array<{ c: Cust; dir: string; amount: number; swapId: string; swapNo: string }> = [];
  for (const c of custs) {
    const rnd = seeded(c.idx);
    // alternate direction by index for guaranteed variety (5 each way), random amount
    const usdtToAed = c.idx % 2 === 1;
    const from = usdtToAed ? usdt : aed;
    const to = usdtToAed ? aed : usdt;
    // amount well within deposited balance; USDT side small, AED side larger
    const amount = usdtToAed
      ? Math.round((50 + rnd() * 450))            // 50..500 USDT
      : Math.round((200 + rnd() * 1800));         // 200..2000 AED
    const quote = await swapQuoteService.createQuote({
      ownerType: 'CUSTOMER', ownerId: c.id, ownerNo: c.customerNo,
      fromAssetId: from.id, fromAssetCode: from.currency,
      toAssetId: to.id, toAssetCode: to.currency,
      amount: new Prisma.Decimal(amount), customerId: c.id,
    } as any);
    const swap = await swapWorkflow.executeSwap(c.id, quote.id);
    swaps.push({ c, dir: usdtToAed ? 'USDT→AED' : 'AED→USDT', amount, swapId: swap.id, swapNo: swap.swapNo });
    process.stdout.write(`  ${c.customerNo}: ${swap.swapNo} ${usdtToAed ? 'USDT→AED' : 'AED→USDT'} ${amount} → ${swap.netToAmount} ${to.currency} (fee ${swap.feeAmount}, spread ${swap.spreadAmount})\n`);
  }

  // Drive swap-spawned FIAT settlement legs (FIAT_SETTLE_IN for buy-fiat,
  // FIAT_SETTLE_OUT for sell-fiat). Both are 2-hop BANK transfers.
  console.log('\n  driving swap-spawned FIAT settlement legs...');
  for (const s of swaps) {
    const settleTx: any = await waitFor(`FIAT settle tx for ${s.swapNo}`, () =>
      prisma.internalTransaction.findFirst({ where: { sourceType: 'FIAT_SETTLEMENT', sourceId: { startsWith: s.swapId } } }));
    const legs = await prisma.internalFund.findMany({ where: { internalTransactionId: settleTx.id }, orderBy: { createdAt: 'asc' } });
    // hop1 first; hop2 auto-SUBMITs on hop1 CONFIRMED, then CONFIRM hop2
    const hop1 = legs[0];
    const hop2 = legs[1];
    await driveFiatLeg(hop1.id);
    if (hop2) {
      await waitFor(`${s.swapNo} hop2 CONFIRMING`, async () => {
        const f = await prisma.internalFund.findUnique({ where: { id: hop2.id } });
        return f && f.status === 'CONFIRMING' ? f : null;
      });
      await fundsFlow.updateStatus(hop2.id, { action: InternalFundAction.CONFIRM } as any, SIM);
    }
  }
  // wait for IN settlements to settle (spawns swap fee/spread collection)
  await sleep(500);

  // ════════════════════════════════════════════════════════════════
  // TASK 4: 10 customers — withdraw (crypto and/or fiat), drive to SUCCESS
  // ════════════════════════════════════════════════════════════════
  console.log('\n═══ TASK 4: 10× withdrawals ═══');
  const withdraws: Array<{ c: Cust; kind: string; amount: number; withdrawNo: string; status: string; payoutDriven: boolean }> = [];
  async function driveWithdraw(c: Cust, asset: any, amount: number, toIban?: string, toAddress?: string) {
    const wq = await withdrawQuoteService.createQuote({
      ownerType: 'CUSTOMER', ownerId: c.id, ownerNo: c.customerNo,
      assetId: asset.id, assetCode: asset.currency, amount: new Prisma.Decimal(amount), customerId: c.id,
    } as any);
    const wd = await withdrawService.create(
      { assetId: asset.id, amount, toIban, toAddress, quoteId: wq.id } as any, c.id, 'CUSTOMER',
    );
    const isCrypto = asset.type === 'CRYPTO';
    // KYT gate
    await waitFor(`${wd.withdrawNo} PENDING_COMPLIANCE`, async () => {
      const w = await prisma.withdrawTransaction.findUnique({ where: { id: wd.id } });
      return w.status === 'PENDING_COMPLIANCE' ? w : null;
    });
    await withdrawService.updateKytStatus(wd.id, 'PASSED', null, 5, 1);
    // crypto withdraw also needs the Travel Rule gate to pass before PAYOUT_PENDING
    if (isCrypto) await withdrawService.updateTravelRuleStatus(wd.id, 'PASSED', null);
    let driven = false;
    let finalStatus = '';
    try {
      const wdWithPayout = await waitFor(`${wd.withdrawNo} PAYOUT_PENDING+payoutId`, async () => {
        const w = await prisma.withdrawTransaction.findUnique({ where: { id: wd.id } });
        return w.status === 'PAYOUT_PENDING' && w.payoutId ? w : null;
      }, 8000);
      // Drive payout fully to CLEARED (mockBalance debit at CLEAR).
      //   fiat:   CREATED→SUBMIT→CONFIRM→CLEAR
      //   crypto: CREATED→SIGN→BROADCAST→SEEN_IN_MEMPOOL→CONFIRM→CLEAR
      const seq = isCrypto
        ? [PayoutAction.SIGN, PayoutAction.BROADCAST, PayoutAction.SEEN_IN_MEMPOOL, PayoutAction.CONFIRM, PayoutAction.CLEAR]
        : [PayoutAction.SUBMIT, PayoutAction.CONFIRM, PayoutAction.CLEAR];
      for (const action of seq) {
        // Payout CLEAR is gated to system closeout (operatorId must be 'SYSTEM').
        const op = action === PayoutAction.CLEAR ? 'SYSTEM' : SIM;
        await payoutsService.updateStatus(wdWithPayout.payoutId, { action } as any, op);
        await sleep(80);
      }
      const w = await waitFor(`${wd.withdrawNo} SUCCESS`, async () => {
        const ww = await prisma.withdrawTransaction.findUnique({ where: { id: wd.id } });
        return ww.status === 'SUCCESS' ? ww : null;
      }, 8000);
      const po = await prisma.payout.findUnique({ where: { id: wdWithPayout.payoutId } });
      driven = true; finalStatus = `${w.status} (payout ${po.status})`;
    } catch (e: any) {
      // A redundant CLEAR on an already-CLEARED payout (system auto-closeout fired
      // on CONFIRM) throws "Invalid action CLEAR"; that is success, not a blocker.
      const w = await prisma.withdrawTransaction.findUnique({ where: { id: wd.id } });
      const po = w.payoutId ? await prisma.payout.findUnique({ where: { id: w.payoutId } }) : null;
      if (w.status === 'SUCCESS' && po?.status === 'CLEARED') {
        driven = true; finalStatus = `${w.status} (payout CLEARED)`;
      } else {
        finalStatus = `${w.status} (payout ${po?.status ?? 'n/a'}; stopped: ${e.message})`;
      }
    }
    return { wd, finalStatus, driven };
  }

  for (const c of custs) {
    // every customer: a fiat withdraw; even-idx also a crypto withdraw
    const rnd = seeded(c.idx + 100);
    const fiatAmt = Math.round(50 + rnd() * 150);   // 50..200 AED
    const r1 = await driveWithdraw(c, aed, fiatAmt, c.vibanIban, undefined);
    withdraws.push({ c, kind: 'fiat AED', amount: fiatAmt, withdrawNo: r1.wd.withdrawNo, status: r1.finalStatus, payoutDriven: r1.driven });
    if (c.idx % 2 === 0) {
      const cryptoAmt = Math.round(20 + rnd() * 80); // 20..100 USDT
      const r2 = await driveWithdraw(c, usdt, cryptoAmt, undefined, `T${createHash('sha256').update(`${SIM}wd${c.idx}`).digest('hex').slice(0, 33)}`);
      withdraws.push({ c, kind: 'crypto USDT', amount: cryptoAmt, withdrawNo: r2.wd.withdrawNo, status: r2.finalStatus, payoutDriven: r2.driven });
    }
    process.stdout.write(`  ${c.customerNo}: ${r1.wd.withdrawNo} fiat ${r1.finalStatus}\n`);
  }

  // Drive withdraw-fee collection legs (C_VIBAN→F_FEE, fiat) spawned per fiat withdraw
  console.log('\n  driving withdraw fee-collection legs...');
  let wfDriven = 0;
  for (const w of withdraws) {
    const wid = (await prisma.withdrawTransaction.findFirst({ where: { withdrawNo: w.withdrawNo } }))?.id;
    if (!wid) continue;
    const feeTx: any = await prisma.internalTransaction.findFirst({ where: { sourceType: 'FIAT_FEE_COLLECTION', sourceId: `${wid}:FEE` } });
    if (!feeTx) continue;
    const leg = await prisma.internalFund.findFirst({ where: { internalTransactionId: feeTx.id } });
    if (leg && leg.status !== 'CLEAR') { await driveFiatLeg(leg.id); wfDriven++; }
  }
  console.log(`  withdraw fee legs driven: ${wfDriven}`);

  // ════════════════════════════════════════════════════════════════
  // TASK 5: EOD settlement (crypto outstandings) + fee collection → drive legs CLEAR
  // ════════════════════════════════════════════════════════════════
  console.log('\n═══ TASK 5: EOD settlement + fee collection ═══');

  // First, any remaining swap fee/spread collection legs (F_OPS→F_FEE) from IN settlements
  const pendingFeeCollects = await prisma.internalTransaction.findMany({
    where: { sourceType: 'FIAT_FEE_COLLECTION', sourceId: { in: swaps.flatMap((s) => [`${s.swapId}:FEE`, `${s.swapId}:SPREAD`]) } },
  });
  let swapFeeLegsDriven = 0;
  for (const c of pendingFeeCollects) {
    const leg = await prisma.internalFund.findFirst({ where: { internalTransactionId: c.id } });
    if (leg && leg.status !== 'CLEAR') { await driveFiatLeg(leg.id); swapFeeLegsDriven++; }
  }
  console.log(`  swap fee/spread collection legs driven: ${swapFeeLegsDriven}`);

  // Run EOD: nets open crypto outstandings per asset, spawns INTERNAL_OUT (C_MAIN→F_OPS)
  const eodRes = await eodWorkflow.runEodSettlement(SIM);
  console.log(`  EOD batch=${eodRes.batchNo} assetCount=${eodRes.assetCount} spawned=${eodRes.spawned} settledZero=${eodRes.settledZero}`);

  if (eodRes.batchNo && eodRes.spawned > 0) {
    const eodTxs = await prisma.internalTransaction.findMany({ where: { sourceType: 'EOD_SETTLEMENT', sourceNo: eodRes.batchNo } });
    for (const tx of eodTxs) {
      const leg = await prisma.internalFund.findFirst({ where: { internalTransactionId: tx.id } });
      if (leg) { await driveCryptoLeg(leg.id); }
    }
    await waitFor('EOD outstandings SETTLED', async () => {
      const open = await prisma.outstanding.count({ where: { sourceId: { in: swaps.map((s) => s.swapId) }, status: { in: ['OPEN', 'LOCKED'] } } });
      return open === 0 ? true : null;
    }, 15000).catch((e) => console.log(`  ! ${e.message}`));
  }

  await sleep(500);
  console.log('\n═══ SIMULATION COMPLETE — see DB report ═══');
  console.log(`  customers: ${custs.map((c) => c.customerNo).join(', ')}`);
  await ctx.close();
  process.exit(0);
}

main().catch((err) => { console.error('FATAL', err); process.exit(2); });
