// scripts/verify-two-book.ts
//
// 两本账记账体系 — 全链验收脚本(Task 10/10)。
// 链路:充值 → 兑换(USDT→AED) → 法币腿结算(FIAT_SETTLE_IN) → EOD(清桥+重估)
//       → 提现(net/fee 两腿 + FEE_DECOMMINGLE) → LP 平盘(FX_REALIZED) → 终局守恒。
//
// 断言全部用 bigint units 精确比对;汇率相关断言用关系式(对价源漂移免疫)。
// 前置:fresh dev:rebuild(branch 栈:DB /tmp/exchange_js_branch/dev.db,TB 3503),
//       capital injection 已注入(AED 1,000,000 / USDT 100,000)。
//
// Run:
//   DATABASE_URL="file:/tmp/exchange_js_branch/dev.db" TB_ADDRESS=127.0.0.1:3503 \
//     npx ts-node -r tsconfig-paths/register scripts/verify-two-book.ts

import { webcrypto, createHash } from 'node:crypto';
if (!(globalThis as any).crypto) (globalThis as any).crypto = webcrypto;

import { NestFactory } from '@nestjs/core';
import { Prisma } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/core/prisma/prisma.service';
import { AccountingService } from '../src/modules/accounting/tigerbeetle/accounting.service';
import { TB_ACCOUNT_CODES } from '../src/modules/accounting/tigerbeetle/constants/tb-account-codes.constant';
import { TB_LEDGERS } from '../src/modules/accounting/tigerbeetle/constants/tb-ledgers.constant';
import { DepositTransactionsService } from '../src/modules/trading/deposit-transactions/deposit-transactions.service';
import { DepositWorkflowService } from '../src/modules/trading/deposit-transactions/deposit-workflow.service';
import { SwapQuoteService } from '../src/modules/trading/swap-fee-level/swap-quote.service';
import { SwapWorkflowService } from '../src/modules/trading/swap-transactions/swap-workflow.service';
import { FundsFlowService } from '../src/modules/funds-layer/domain/funds-flow.service';
import { InternalFundAction } from '../src/modules/asset-treasury/internal-funds/dto/internal-fund.dto';
import { EodSettlementWorkflowService } from '../src/modules/funds-layer/workflow/eod-settlement-workflow.service';
import { FxEodService, EodAccountingReport } from '../src/modules/funds-layer/accounting/fx-eod.service';
import { BinanceRateProvider } from '../src/modules/trading/pricing-center/providers/binance-rate.provider';
import { WithdrawQuoteService } from '../src/modules/trading/withdrawal-fee-level/withdraw-quote.service';
import { WithdrawTransactionsService } from '../src/modules/trading/withdraw-transactions/withdraw-transactions.service';
import { PayoutsService } from '../src/modules/asset-treasury/payouts/payouts.service';
import { PayoutAction } from '../src/modules/asset-treasury/payouts/dto/payout.dto';
import { decimalToTbUnits, bigintToDecimal } from '../src/modules/funds-layer/accounting/tb-amount.util';
import { buildDeterministicNo } from '../src/common/utils/no-generator.util';

const AED = TB_LEDGERS.AED;   // ledger 1, 2 decimals
const USDT = TB_LEDGERS.USDT; // ledger 2, 6 decimals

// ── 断言收集器 ─────────────────────────────────────────────
const failures: string[] = [];
let assertCount = 0;
function assertEq(label: string, actual: bigint, expected: bigint) {
  assertCount += 1;
  if (actual === expected) {
    console.log(`  ✓ ${label}: ${actual}`);
  } else {
    failures.push(`${label}: actual=${actual} expected=${expected}`);
    console.log(`  ✗ ${label}: actual=${actual} expected=${expected}`);
  }
}
function assertTrue(label: string, ok: boolean, detail = '') {
  assertCount += 1;
  if (ok) console.log(`  ✓ ${label}${detail ? ` (${detail})` : ''}`);
  else {
    failures.push(`${label}${detail ? ` — ${detail}` : ''}`);
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor<T>(label: string, fn: () => Promise<T | null | undefined | false>, timeoutMs = 8000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v as T;
    if (Date.now() - start > timeoutMs) throw new Error(`Timeout (${timeoutMs}ms) waiting for: ${label}`);
    await sleep(150);
  }
}

// 与生产 decimalToBigint 同语义(截断,非四舍五入)
function toUnitsTrunc(value: any, decimals: number): bigint {
  const str = String(value);
  const [whole, frac = ''] = str.split('.');
  return BigInt(whole + frac.padEnd(decimals, '0').slice(0, decimals));
}

async function main() {
  const ctx = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const prisma: any = ctx.get(PrismaService);
  const accounting = ctx.get(AccountingService);
  const depositService = ctx.get(DepositTransactionsService);
  const depositWorkflow: any = ctx.get(DepositWorkflowService);
  const swapQuoteService = ctx.get(SwapQuoteService);
  const swapWorkflow = ctx.get(SwapWorkflowService);
  const fundsFlow = ctx.get(FundsFlowService);
  const eodWorkflow = ctx.get(EodSettlementWorkflowService);
  const fxEod = ctx.get(FxEodService);
  const rateProvider = ctx.get(BinanceRateProvider);
  const withdrawQuoteService = ctx.get(WithdrawQuoteService);
  const withdrawService = ctx.get(WithdrawTransactionsService);
  const payoutsService = ctx.get(PayoutsService);

  // ── balance helpers ──
  async function rawBal(code: number, ledger: number, ownerUuid?: string) {
    const id = await accounting.resolveTbAccountId({
      code, ledger, ownerType: ownerUuid ? 'CUSTOMER' : 'SYSTEM', ownerUuid,
    });
    return accounting.lookupBalance(id);
  }
  const creditNet = async (code: number, ledger: number, owner?: string) => {
    const b = await rawBal(code, ledger, owner);
    return b.creditsPosted - b.debitsPosted;
  };
  const debitNet = async (code: number, ledger: number, owner?: string) => {
    const b = await rawBal(code, ledger, owner);
    return b.debitsPosted - b.creditsPosted;
  };

  // ── fixtures ──
  const usdtAsset = await prisma.asset.findFirst({ where: { status: 'ACTIVE', type: 'CRYPTO', currency: 'USDT' } });
  const aedAsset = await prisma.asset.findFirst({ where: { status: 'ACTIVE', type: 'FIAT', currency: 'AED' } });
  if (!usdtAsset || !aedAsset) throw new Error('USDT/AED assets not seeded');

  const alice = await prisma.customerMain.findUnique({ where: { email: 'demo_alice@example.com' } });
  if (!alice) throw new Error('demo_alice not seeded');
  console.log(`Customer: ${alice.customerNo} (${alice.firstName} ${alice.lastName})`);

  const CAPITAL_AED = 100_000_000n;       // 1,000,000.00 AED
  const CAPITAL_USDT = 100_000_000_000n;  // 100,000.000000 USDT

  // 费率配置:seed 默认 FLAT 0,这里调成非零,让 FEE_INCOME / FEE_DECOMMINGLE 路径真实跑到。
  async function bumpFee(model: 'swapFeeLevel' | 'withdrawalFeeLevel', levelCode: string, itemCode: string, value: string) {
    const level = await prisma[model].findUnique({ where: { levelCode } });
    if (!level) throw new Error(`${model} ${levelCode} not found`);
    const cfg = JSON.parse(level.tiersJson);
    const item = cfg.tiers[0].feeItems.find((f: any) => f.itemCode === itemCode);
    item.value = value;
    const tiersJson = JSON.stringify(cfg);
    const configHash = createHash('sha256').update(tiersJson).digest('hex');
    await prisma[model].update({ where: { levelCode }, data: { tiersJson, configHash } });
  }
  await bumpFee('swapFeeLevel', 'STD-USDT-AED', 'SWAP_SERVICE_FEE', '10');     // 10 AED flat
  await bumpFee('withdrawalFeeLevel', 'STD-AED-FIAT', 'WITHDRAW_SERVICE_FEE', '2'); // 2 AED flat
  console.log('Fee configs: swap SWAP_SERVICE_FEE=10 AED, withdraw WITHDRAW_SERVICE_FEE=2 AED');

  // 客户钱包:USDT 充值地址 + AED C_VIBAN(workflow resolveCustomer 需要)
  const tag = Date.now().toString();
  const depWallet = await prisma.wallet.create({
    data: {
      walletNo: buildDeterministicNo('WA', 'VERIFY', 'C_DEP', alice.customerNo), ownerType: 'CUSTOMER', ownerId: alice.id, ownerNo: alice.customerNo,
      type: 'CRYPTO_ADDRESS', walletRole: 'C_DEP', assetId: usdtAsset.id,
      address: `TVERIFY${tag}`, status: 'ACTIVE',
    },
  });
  const cma = await prisma.wallet.findFirst({
    where: { walletRole: 'C_CMA', assetId: aedAsset.id, status: 'ACTIVE' },
    select: { bankName: true, accountName: true },
  });
  const vibanNo = buildDeterministicNo('WA', 'VERIFY', 'C_VIBAN', alice.customerNo);
  const viban = await prisma.wallet.upsert({
    where: { walletNo: vibanNo },
    update: {},
    create: {
      walletNo: vibanNo, ownerType: 'CUSTOMER', ownerId: alice.id, ownerNo: alice.customerNo,
      type: 'FIAT_BANK', walletRole: 'C_VIBAN', assetId: aedAsset.id,
      iban: `AE00VERIFY${tag.slice(-10)}`,
      bankName: cma?.bankName ?? null,
      accountName: cma?.accountName ?? null,
      status: 'ACTIVE',
    },
  });

  // 资金腿驱动 helpers(对齐 funds-simulate.controller:fundsFlow.updateStatus)
  async function driveFiatLeg(fundId: string) {
    await fundsFlow.updateStatus(fundId, { action: InternalFundAction.SUBMIT } as any, 'VERIFY');
    await fundsFlow.updateStatus(fundId, { action: InternalFundAction.CONFIRM } as any, 'VERIFY');
  }
  async function driveCryptoLeg(fundId: string) {
    for (const action of [
      InternalFundAction.SIGN, InternalFundAction.BROADCAST,
      InternalFundAction.SEEN_IN_MEMPOOL, InternalFundAction.CONFIRM,
    ]) {
      await fundsFlow.updateStatus(fundId, { action } as any, 'VERIFY');
    }
  }

  // ═══ Step 1: 充值 1000 USDT ═══════════════════════════════
  console.log('\n═══ Step 1: 充值 1000 USDT(deposit STEP_1/STEP_2)═══');
  const depRow = await depositService.createFromPayin('1000', usdtAsset.id, depWallet.id, `0xverify${tag}`);
  const dep = await prisma.depositTransaction.findUnique({ where: { id: depRow.id }, include: { asset: true } });
  await depositWorkflow.executeDepositAccounting(dep, 'STEP_1'); // CUSTODY → DEPOSIT_SUSPENSE
  await depositWorkflow.executeDepositAccounting(dep, 'STEP_2'); // DEPOSIT_SUSPENSE → CLIENT_PAYABLE

  const DEPOSIT_U = 1_000_000_000n; // 1000 USDT @6dp
  assertEq('CLIENT_CUSTODY(USDT) debit-net', await debitNet(TB_ACCOUNT_CODES.CLIENT_CUSTODY, USDT), DEPOSIT_U);
  assertEq('CLIENT_PAYABLE(USDT, alice) credit-net', await creditNet(TB_ACCOUNT_CODES.CLIENT_PAYABLE, USDT, alice.id), DEPOSIT_U);
  assertEq('DEPOSIT_SUSPENSE(USDT, alice)', await creditNet(TB_ACCOUNT_CODES.DEPOSIT_SUSPENSE, USDT, alice.id), 0n);

  // ═══ Step 2: 兑换 1000 USDT → AED ═════════════════════════
  console.log('\n═══ Step 2: 兑换 1000 USDT → AED(T1 收入确认)═══');
  const quote = await swapQuoteService.createQuote({
    ownerType: 'CUSTOMER', ownerId: alice.id, ownerNo: alice.customerNo,
    fromAssetId: usdtAsset.id, fromAssetCode: 'USDT',
    toAssetId: aedAsset.id, toAssetCode: 'AED',
    amount: new Prisma.Decimal(1000), customerId: alice.id,
  });
  const swap = await swapWorkflow.executeSwap(alice.id, quote.id);

  const gross = new Prisma.Decimal(swap.toAmount);
  const fee = new Prisma.Decimal(swap.feeAmount);
  const net = new Prisma.Decimal(swap.netToAmount);
  const spread = new Prisma.Decimal(swap.spreadAmount);
  const marketRate = new Prisma.Decimal(quote.marketRate);
  const mid = new Prisma.Decimal(1000).mul(marketRate).toDecimalPlaces(aedAsset.decimals, Prisma.Decimal.ROUND_HALF_UP);
  console.log(`  quote: marketRate=${marketRate} mid=${mid} gross=${gross} fee=${fee} spread=${spread} net=${net}`);

  // 关系式(汇率漂移免疫)
  assertTrue('net + fee = gross', net.add(fee).eq(gross), `${net}+${fee}=${gross}`);
  assertTrue('gross + spread = mid(fromAmount×marketRate)', gross.add(spread).eq(mid), `${gross}+${spread}=${mid}`);

  // TB 实际过账 units(与生产同截断语义)
  const FROM_U = DEPOSIT_U;
  const grossU = toUnitsTrunc(gross, aedAsset.decimals);
  const feeU = toUnitsTrunc(fee, aedAsset.decimals);
  const spreadU = toUnitsTrunc(spread, aedAsset.decimals);
  const netU = grossU - feeU;
  const costU = grossU + spreadU; // AED 桥实际借方 = FX 头寸成本

  assertEq('CLIENT_PAYABLE(AED, alice) = net', await creditNet(TB_ACCOUNT_CODES.CLIENT_PAYABLE, AED, alice.id), netU);
  assertEq('CLIENT_PAYABLE(USDT, alice) 清零', await creditNet(TB_ACCOUNT_CODES.CLIENT_PAYABLE, USDT, alice.id), 0n);
  assertEq('FEE_INCOME(AED) = fee', await creditNet(TB_ACCOUNT_CODES.FEE_INCOME, AED), feeU);
  assertEq('SPREAD_INCOME(AED) = spread', await creditNet(TB_ACCOUNT_CODES.SPREAD_INCOME, AED), spreadU);
  assertEq('TRADE_CLEARING(USDT) = +fromAmount', await creditNet(TB_ACCOUNT_CODES.TRADE_CLEARING, USDT), FROM_U);
  assertEq('TRADE_CLEARING(AED) = −(gross+spread)', await creditNet(TB_ACCOUNT_CODES.TRADE_CLEARING, AED), -costU);

  // ═══ Step 3: 法币腿结算 FIAT_SETTLE_IN(两跳 → CLEAR → 镜像)═══
  console.log('\n═══ Step 3: 法币腿结算(F_LIQ→F_SET→C_VIBAN,net 交付)═══');
  const settleTx: any = await waitFor('FIAT_SETTLEMENT transfer spawned', () =>
    prisma.internalTransaction.findFirst({ where: { sourceType: 'FIAT_SETTLEMENT', sourceId: { startsWith: swap.id } } }));
  const fset = await prisma.wallet.findFirst({ where: { walletRole: 'F_SET', assetId: aedAsset.id, ownerType: 'PLATFORM' } });
  const legs = await prisma.internalFund.findMany({ where: { internalTransactionId: settleTx.id }, orderBy: { createdAt: 'asc' } });
  const hop1 = legs.find((l: any) => l.toWalletId === fset.id);
  const hop2 = legs.find((l: any) => l.fromWalletId === fset.id);
  if (!hop1 || !hop2) throw new Error('FIAT_SETTLE_IN legs not found');

  await driveFiatLeg(hop1.id); // SUBMIT → CONFIRM;CONFIRMED 事件自动 SUBMIT hop2
  await waitFor('hop2 auto-SUBMIT → CONFIRMING', async () => {
    const f = await prisma.internalFund.findUnique({ where: { id: hop2.id } });
    return f.status === 'CONFIRMING' ? f : null;
  });
  await fundsFlow.updateStatus(hop2.id, { action: InternalFundAction.CONFIRM } as any, 'VERIFY');
  await waitFor('IN outstanding SETTLED', () =>
    prisma.outstanding.findFirst({ where: { sourceId: swap.id, direction: 'IN', status: 'SETTLED' } }));
  await waitFor('SETTLE_FIRM_TO_POOL mirror posted', async () =>
    (await debitNet(TB_ACCOUNT_CODES.CLIENT_BANK, AED)) === netU ? true : null);

  assertEq('CLIENT_BANK(AED) = +net', await debitNet(TB_ACCOUNT_CODES.CLIENT_BANK, AED), netU);
  assertEq('FIRM_TREASURY(AED) = 资本 − net', await debitNet(TB_ACCOUNT_CODES.FIRM_TREASURY, AED), CAPITAL_AED - netU);

  // swap fee/spread 物理归集(Model A:F_LIQ→F_FEE 公司内部倒手,TB no-op)
  const collects = await waitFor('swap fee/spread collections spawned', async () => {
    const rows = await prisma.internalTransaction.findMany({
      where: { sourceType: 'FIAT_FEE_COLLECTION', sourceId: { in: [`${swap.id}:FEE`, `${swap.id}:SPREAD`] } },
    });
    return rows.length === 2 ? rows : null;
  });
  for (const c of collects) {
    const leg = await prisma.internalFund.findFirst({ where: { internalTransactionId: c.id } });
    await driveFiatLeg(leg.id);
  }
  await sleep(300);
  assertEq('FIRM_TREASURY(AED) 不因 F_LIQ→F_FEE 归集而变(TB no-op)', await debitNet(TB_ACCOUNT_CODES.FIRM_TREASURY, AED), CAPITAL_AED - netU);

  // ═══ Step 4: EOD(链上腿结算 + 清桥 + 重估)═══════════════
  console.log('\n═══ Step 4: EOD 结算 + 两本账收口(清桥/重估/对账)═══');
  const eodRes = await eodWorkflow.runEodSettlement('VERIFY');
  console.log(`  EOD batch=${eodRes.batchNo} spawned=${eodRes.spawned} settledZero=${eodRes.settledZero}`);
  assertTrue('EOD spawned 1 INTERNAL_OUT', eodRes.spawned === 1, `spawned=${eodRes.spawned}`);

  const eodTx: any = await waitFor('EOD INTERNAL_OUT transfer', () =>
    prisma.internalTransaction.findFirst({ where: { sourceType: 'EOD_SETTLEMENT', sourceNo: eodRes.batchNo } }));
  const eodLeg = await prisma.internalFund.findFirst({ where: { internalTransactionId: eodTx.id } });
  await driveCryptoLeg(eodLeg.id); // SIGN→BROADCAST→SEEN_IN_MEMPOOL→CONFIRM → auto-CLEAR → mirror + runEodAccounting
  await waitFor('OUT outstanding SETTLED', () =>
    prisma.outstanding.findFirst({ where: { sourceId: swap.id, direction: 'OUT', status: 'SETTLED' } }));
  await waitFor('bridges swept to 0', async () => {
    const u = await creditNet(TB_ACCOUNT_CODES.TRADE_CLEARING, USDT);
    const a = await creditNet(TB_ACCOUNT_CODES.TRADE_CLEARING, AED);
    return u === 0n && a === 0n ? true : null;
  });

  assertEq('TRADE_CLEARING(USDT) = 0', await creditNet(TB_ACCOUNT_CODES.TRADE_CLEARING, USDT), 0n);
  assertEq('TRADE_CLEARING(AED) = 0', await creditNet(TB_ACCOUNT_CODES.TRADE_CLEARING, AED), 0n);
  const fxUsdt = await creditNet(TB_ACCOUNT_CODES.FX_POSITION, USDT);
  assertEq('FX_POSITION(USDT) 贷方 = fromAmount', fxUsdt, FROM_U);

  const { rate: fixing } = await rateProvider.fetchRate('USDT', 'AED');
  const fxAedDebit = await debitNet(TB_ACCOUNT_CODES.FX_POSITION, AED);
  const expectedFxAed = decimalToTbUnits(bigintToDecimal(fxUsdt, usdtAsset.decimals).mul(fixing), aedAsset.decimals);
  console.log(`  fixing(USDT/AED)=${fixing} → FX_POSITION(AED) 借方应= ${expectedFxAed}`);
  assertEq('FX_POSITION(AED) 借方 = FX_POSITION(USDT)×fixing', fxAedDebit, expectedFxAed);

  // 重估差关系式:marked − cost = 浮动盈亏净额(贷方为赚)
  const unrealNet = await creditNet(TB_ACCOUNT_CODES.FX_UNREALIZED_PNL, AED);
  assertEq('FX_UNREALIZED = FX_POSITION(AED) − 成本(gross+spread)', unrealNet, fxAedDebit - costU);
  assertEq('FIRM_TREASURY(USDT) = 资本 + fromAmount', await debitNet(TB_ACCOUNT_CODES.FIRM_TREASURY, USDT), CAPITAL_USDT + FROM_U);

  const eodReport: EodAccountingReport = { sweeps: [], revals: [], violations: [] };
  await fxEod.checkInvariants(eodReport);
  assertTrue('I1/I2 violations 为空', eodReport.violations.length === 0, JSON.stringify(eodReport.violations));

  // ═══ Step 5: 提现 100 AED ═════════════════════════════════
  console.log('\n═══ Step 5: 提现 100 AED(net/fee 两腿 + FEE_DECOMMINGLE)═══');
  const feeIncomeBefore = await creditNet(TB_ACCOUNT_CODES.FEE_INCOME, AED);
  const wq = await withdrawQuoteService.createQuote({
    ownerType: 'CUSTOMER', ownerId: alice.id, ownerNo: alice.customerNo,
    assetId: aedAsset.id, assetCode: 'AED', amount: new Prisma.Decimal(100), customerId: alice.id,
  });
  const wd = await withdrawService.create(
    { assetId: aedAsset.id, amount: 100, toIban: viban.iban, quoteId: wq.id } as any,
    alice.id, 'CUSTOMER',
  );
  const wFeeU = toUnitsTrunc(wd.feeAmount, aedAsset.decimals);
  const wNetU = toUnitsTrunc(wd.netAmount, aedAsset.decimals);
  const wAmountU = toUnitsTrunc(wd.amount, aedAsset.decimals);
  console.log(`  withdraw ${wd.withdrawNo}: amount=${wd.amount} fee=${wd.feeAmount} net=${wd.netAmount}`);
  assertTrue('withdraw fee 来自费率配置(>0)', wFeeU > 0n, `feeU=${wFeeU}`);

  await waitFor('withdraw → PENDING_COMPLIANCE', async () => {
    const w = await prisma.withdrawTransaction.findUnique({ where: { id: wd.id } });
    return w.status === 'PENDING_COMPLIANCE' ? w : null;
  });
  await withdrawService.updateKytStatus(wd.id, 'PASSED', null, 5, 1); // Pre-KYT PASSED → payout phase
  const wdWithPayout = await waitFor('payout created (PAYOUT_PENDING)', async () => {
    const w = await prisma.withdrawTransaction.findUnique({ where: { id: wd.id } });
    return w.status === 'PAYOUT_PENDING' && w.payoutId ? w : null;
  });
  await payoutsService.updateStatus(wdWithPayout.payoutId, { action: PayoutAction.SUBMIT } as any, 'VERIFY');
  await payoutsService.updateStatus(wdWithPayout.payoutId, { action: PayoutAction.CONFIRM } as any, 'VERIFY');
  await waitFor('withdraw SUCCESS(pending posted)', async () => {
    const w = await prisma.withdrawTransaction.findUnique({ where: { id: wd.id } });
    return w.status === 'SUCCESS' ? w : null;
  });

  assertEq('FEE_INCOME(AED) 增量 = withdraw fee', (await creditNet(TB_ACCOUNT_CODES.FEE_INCOME, AED)) - feeIncomeBefore, wFeeU);
  assertEq('CLIENT_PAYABLE(AED) 减 100', await creditNet(TB_ACCOUNT_CODES.CLIENT_PAYABLE, AED, alice.id), netU - wAmountU);
  assertEq('CLIENT_BANK(AED) 减 net(fee 去混同前)', await debitNet(TB_ACCOUNT_CODES.CLIENT_BANK, AED), netU - wNetU);

  // 提现费物理归集 C_VIBAN→F_FEE → CLEAR → FEE_DECOMMINGLE 镜像 CLIENT_BANK→FIRM_TREASURY
  const wFeeCollect: any = await waitFor('withdraw fee collection spawned', () =>
    prisma.internalTransaction.findFirst({ where: { sourceType: 'FIAT_FEE_COLLECTION', sourceId: `${wd.id}:FEE` } }));
  const wFeeLeg = await prisma.internalFund.findFirst({ where: { internalTransactionId: wFeeCollect.id } });
  await driveFiatLeg(wFeeLeg.id);
  await waitFor('FEE_DECOMMINGLE mirror posted', async () =>
    (await debitNet(TB_ACCOUNT_CODES.CLIENT_BANK, AED)) === netU - wNetU - wFeeU ? true : null);

  assertEq('CLIENT_BANK(AED) = net − 100(去混同后)', await debitNet(TB_ACCOUNT_CODES.CLIENT_BANK, AED), netU - wAmountU);
  assertEq('FIRM_TREASURY(AED) = 资本 − net + withdrawFee', await debitNet(TB_ACCOUNT_CODES.FIRM_TREASURY, AED), CAPITAL_AED - netU + wFeeU);

  const i1Report: EodAccountingReport = { sweeps: [], revals: [], violations: [] };
  await fxEod.checkInvariants(i1Report);
  assertTrue('去混同后 I1: CLIENT_BANK = ΣCLIENT_PAYABLE+ΣDEPOSIT_SUSPENSE(violations 空)', i1Report.violations.length === 0, JSON.stringify(i1Report.violations));

  // ═══ Step 6: LP 平盘(realize USDT 头寸)═══════════════════
  console.log('\n═══ Step 6: LP 平盘 realize USDT @ fixing±少许 ═══');
  const fillRate = fixing.add(new Prisma.Decimal('0.0075')); // 活价 fixing + 0.0075
  const firmAedBefore = await debitNet(TB_ACCOUNT_CODES.FIRM_TREASURY, AED);
  await fxEod.realizeFxPosition({ currency: 'USDT', fillRate, operatorId: 'VERIFY' });
  const proceedsU = decimalToTbUnits(bigintToDecimal(FROM_U, usdtAsset.decimals).mul(fillRate), aedAsset.decimals);
  console.log(`  fillRate=${fillRate} proceeds=${proceedsU}`);

  assertEq('FX_POSITION(USDT) = 0', await creditNet(TB_ACCOUNT_CODES.FX_POSITION, USDT), 0n);
  assertEq('FX_POSITION(AED) = 0', await creditNet(TB_ACCOUNT_CODES.FX_POSITION, AED), 0n);
  assertEq('FX_UNREALIZED = 0(回转完毕)', await creditNet(TB_ACCOUNT_CODES.FX_UNREALIZED_PNL, AED), 0n);
  assertEq('FX_REALIZED = proceeds − 成本', await creditNet(TB_ACCOUNT_CODES.FX_REALIZED_PNL, AED), proceedsU - costU);
  assertEq('FIRM_TREASURY(USDT) 减 fromAmount(回到资本)', await debitNet(TB_ACCOUNT_CODES.FIRM_TREASURY, USDT), CAPITAL_USDT);
  assertEq('FIRM_TREASURY(AED) 加 proceeds', await debitNet(TB_ACCOUNT_CODES.FIRM_TREASURY, AED), firmAedBefore + proceedsU);

  // ═══ Step 7: 终态余额表 + 终局守恒 ═══════════════════════
  console.log('\n═══ Step 7: 终态余额表(两本账 × 两币种)═══');
  const SYSTEM_CODES: Array<[string, number]> = [
    ['A.CLIENT_BANK', TB_ACCOUNT_CODES.CLIENT_BANK],
    ['A.CLIENT_CUSTODY', TB_ACCOUNT_CODES.CLIENT_CUSTODY],
    ['A.FIRM_TREASURY', TB_ACCOUNT_CODES.FIRM_TREASURY],
    ['A.FX_POSITION', TB_ACCOUNT_CODES.FX_POSITION],
    ['L.TRADE_CLEARING', TB_ACCOUNT_CODES.TRADE_CLEARING],
    ['E.PAID_IN_CAPITAL', TB_ACCOUNT_CODES.PAID_IN_CAPITAL],
    ['E.RETAINED_EARNINGS', TB_ACCOUNT_CODES.RETAINED_EARNINGS],
    ['R.FEE_INCOME', TB_ACCOUNT_CODES.FEE_INCOME],
    ['R.SPREAD_INCOME', TB_ACCOUNT_CODES.SPREAD_INCOME],
    ['R.FX_UNREALIZED_PNL', TB_ACCOUNT_CODES.FX_UNREALIZED_PNL],
    ['R.FX_REALIZED_PNL', TB_ACCOUNT_CODES.FX_REALIZED_PNL],
  ];
  const { hexToBigint } = await import('../src/modules/accounting/tigerbeetle/utils/tb-id.util');
  async function sumCustomerCode(code: number, ledger: number): Promise<bigint> {
    const rows = await prisma.tbAccountRegistry.findMany({
      where: { code, ledger, ownerType: 'CUSTOMER', status: 'ACTIVE' }, select: { tbAccountId: true },
    });
    let sum = 0n;
    for (const r of rows) {
      const b = await accounting.lookupBalance(hexToBigint(r.tbAccountId));
      sum += b.creditsPosted - b.debitsPosted;
    }
    return sum;
  }

  const table: Record<string, { AED: string; USDT: string }> = {};
  for (const [name, code] of SYSTEM_CODES) {
    const row: any = {};
    for (const [cur, ledger] of [['AED', AED], ['USDT', USDT]] as const) {
      // CLIENT_BANK 仅存在于法币 ledger、CLIENT_CUSTODY 仅存在于 crypto ledger。
      const reg = await prisma.tbAccountRegistry.findFirst({
        where: { code, ledger, ownerType: 'SYSTEM', status: 'ACTIVE' },
      });
      if (!reg) { row[cur] = '—'; continue; }
      const b = await rawBal(code, ledger);
      row[cur] = (b.debitsPosted - b.creditsPosted).toString(); // 借方正
    }
    table[`${name} (借方正)`] = row;
  }
  for (const [name, code] of [['L.CLIENT_PAYABLE Σ', TB_ACCOUNT_CODES.CLIENT_PAYABLE], ['L.DEPOSIT_SUSPENSE Σ', TB_ACCOUNT_CODES.DEPOSIT_SUSPENSE]] as const) {
    table[`${name} (贷方正)`] = {
      AED: (await sumCustomerCode(code, AED)).toString(),
      USDT: (await sumCustomerCode(code, USDT)).toString(),
    };
  }
  console.table(table);

  console.log('── 终局守恒断言 ──');
  const sumCreditAed = await sumCustomerCode(TB_ACCOUNT_CODES.CLIENT_PAYABLE, AED);
  const sumAuditAed = await sumCustomerCode(TB_ACCOUNT_CODES.DEPOSIT_SUSPENSE, AED);
  const sumCreditUsdt = await sumCustomerCode(TB_ACCOUNT_CODES.CLIENT_PAYABLE, USDT);
  assertEq('AED I1: CLIENT_BANK = ΣCREDIT+ΣAUDIT', await debitNet(TB_ACCOUNT_CODES.CLIENT_BANK, AED), sumCreditAed + sumAuditAed);
  assertEq('USDT: 客户持有清零(ΣCREDIT)', sumCreditUsdt, 0n);
  assertEq('USDT: CLIENT_CUSTODY 清零', await debitNet(TB_ACCOUNT_CODES.CLIENT_CUSTODY, USDT), 0n);
  assertEq('USDT: 公司净值不变(FIRM_TREASURY = 资本)', await debitNet(TB_ACCOUNT_CODES.FIRM_TREASURY, USDT), CAPITAL_USDT);

  // 公司 AED 净值变动 = 三桶损益合计(费 + 点差 + 平盘盈亏;浮动已清零)
  const incomeTotal =
    (await creditNet(TB_ACCOUNT_CODES.FEE_INCOME, AED)) +
    (await creditNet(TB_ACCOUNT_CODES.SPREAD_INCOME, AED)) +
    (await creditNet(TB_ACCOUNT_CODES.FX_REALIZED_PNL, AED)) +
    (await creditNet(TB_ACCOUNT_CODES.FX_UNREALIZED_PNL, AED));
  assertEq('AED: ΔFIRM_TREASURY(资本之上) = 三桶损益合计', (await debitNet(TB_ACCOUNT_CODES.FIRM_TREASURY, AED)) - CAPITAL_AED, incomeTotal);

  const finalReport: EodAccountingReport = { sweeps: [], revals: [], violations: [] };
  await fxEod.checkInvariants(finalReport);
  assertTrue('终局 I1/I2 violations 为空', finalReport.violations.length === 0, JSON.stringify(finalReport.violations));

  // ═══ 汇总 ═════════════════════════════════════════════════
  console.log(`\n═══ 断言汇总: ${assertCount - failures.length}/${assertCount} PASS ═══`);
  if (failures.length) {
    console.log('FAILURES:');
    for (const f of failures) console.log(`  ✗ ${f}`);
    await ctx.close();
    process.exit(1);
  }
  console.log('verify-two-book: ALL PASS ✅');
  await ctx.close();
  process.exit(0);
}

main().catch((err) => {
  console.error('FATAL', err);
  process.exit(2);
});
