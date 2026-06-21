// scripts/verify-manual-settle.ts
//
// 手动结算 vs EOD 重估 解耦 — 集成验收脚本(funds-layer Task 5/5)。
// 证明:手动结算只做"清桥(成本)"不做 reval;FX 重估仍由 EOD 路径(runReval)独立完成。
//
// 链路:充值 → 兑换(USDT→AED,产生 USDT 桥 + crypto OUT outstanding)
//   ── Phase A:runManualCryptoSettlement → 驱动 EOD/INTERNAL crypto 腿至 CLEAR
//                → CLEAR handler 走 runSweepOnly(成本清桥)→ 断言 FX_UNREALIZED 不变(关键)
//   ── Phase B:fxEod.runReval(batchNo) → 断言 FX_UNREALIZED 被标到 fixing(非零且变化)
//
// 断言全部用 bigint units / 关系式(对价源漂移免疫),与 verify-two-book 同语义。
// 前置:fresh dev:rebuild(branch 栈:DB /tmp/exchange_js_branch/dev.db,TB 3503),
//       capital injection 已注入(AED 1,000,000 / USDT 100,000)。
//
// Run:
//   DATABASE_URL="file:/tmp/exchange_js_branch/dev.db" TB_ADDRESS=127.0.0.1:3503 \
//     npx ts-node -r tsconfig-paths/register scripts/verify-manual-settle.ts

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
import { InternalFundAction } from '../src/modules/funds-layer/dto/internal-fund.dto';
import { EodSettlementWorkflowService } from '../src/modules/funds-layer/workflow/eod-settlement-workflow.service';
import { FxEodService, EodAccountingReport } from '../src/modules/funds-layer/accounting/fx-eod.service';
import { BinanceRateProvider } from '../src/modules/trading/pricing-center/providers/binance-rate.provider';
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

  // swap 费率非零,让 FEE_INCOME / SPREAD 路径真实跑到(与 verify-two-book 一致)。
  async function bumpFee(model: 'swapFeeLevel', levelCode: string, itemCode: string, value: string) {
    const level = await prisma[model].findUnique({ where: { levelCode } });
    if (!level) throw new Error(`${model} ${levelCode} not found`);
    const cfg = JSON.parse(level.tiersJson);
    const item = cfg.tiers[0].feeItems.find((f: any) => f.itemCode === itemCode);
    item.value = value;
    const tiersJson = JSON.stringify(cfg);
    const configHash = createHash('sha256').update(tiersJson).digest('hex');
    await prisma[model].update({ where: { levelCode }, data: { tiersJson, configHash } });
  }
  await bumpFee('swapFeeLevel', 'STD-USDT-AED', 'SWAP_SERVICE_FEE', '10'); // 10 AED flat
  console.log('Fee config: swap SWAP_SERVICE_FEE=10 AED');

  // 客户钱包:USDT 充值地址 + AED C_VIBAN(workflow resolveCustomer 需要)。
  // 用 upsert(不用 create)→ 脚本可重复执行(deterministic walletNo 不撞 P2002)。
  const tag = Date.now().toString();
  const depWalletNo = buildDeterministicNo('WA', 'VERIFYMS', 'C_DEP', alice.customerNo);
  const depWallet = await prisma.wallet.upsert({
    where: { walletNo: depWalletNo },
    update: { status: 'ACTIVE' },
    create: {
      walletNo: depWalletNo, ownerType: 'CUSTOMER', ownerId: alice.id, ownerNo: alice.customerNo,
      type: 'CRYPTO_ADDRESS', walletRole: 'C_DEP', assetId: usdtAsset.id,
      address: `TVERIFYMS${tag}`, status: 'ACTIVE',
    },
  });
  const cma = await prisma.wallet.findFirst({
    where: { walletRole: 'C_CMA', assetId: aedAsset.id, status: 'ACTIVE' },
    select: { bankName: true, accountName: true },
  });
  const vibanNo = buildDeterministicNo('WA', 'VERIFYMS', 'C_VIBAN', alice.customerNo);
  await prisma.wallet.upsert({
    where: { walletNo: vibanNo },
    update: {},
    create: {
      walletNo: vibanNo, ownerType: 'CUSTOMER', ownerId: alice.id, ownerNo: alice.customerNo,
      type: 'FIAT_BANK', walletRole: 'C_VIBAN', assetId: aedAsset.id,
      iban: `AE00VERIFYMS${tag.slice(-8)}`,
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
  const depRow = await depositService.createFromPayin('1000', usdtAsset.id, depWallet.id, `0xverifyms${tag}`);
  const dep = await prisma.depositTransaction.findUnique({ where: { id: depRow.id }, include: { asset: true } });
  await depositWorkflow.executeDepositAccounting(dep, 'STEP_1'); // CUSTODY → DEPOSIT_SUSPENSE
  await depositWorkflow.executeDepositAccounting(dep, 'STEP_2'); // DEPOSIT_SUSPENSE → CLIENT_PAYABLE

  const DEPOSIT_U = 1_000_000_000n; // 1000 USDT @6dp
  assertEq('CLIENT_PAYABLE(USDT, alice) credit-net', await creditNet(TB_ACCOUNT_CODES.CLIENT_PAYABLE, USDT, alice.id), DEPOSIT_U);

  // ═══ Step 2: 兑换 1000 USDT → AED ═════════════════════════
  console.log('\n═══ Step 2: 兑换 1000 USDT → AED(T1 收入确认,产生 USDT 桥 + crypto OUT outstanding)═══');
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
  console.log(`  quote: gross=${gross} fee=${fee} spread=${spread} net=${net}`);

  // TB 实际过账 units(与生产同截断语义)
  const FROM_U = DEPOSIT_U;
  const grossU = toUnitsTrunc(gross, aedAsset.decimals);
  const spreadU = toUnitsTrunc(spread, aedAsset.decimals);
  const costU = grossU + spreadU; // AED 桥实际借方 = FX 头寸成本

  assertEq('TRADE_CLEARING(USDT) = +fromAmount(桥已建)', await creditNet(TB_ACCOUNT_CODES.TRADE_CLEARING, USDT), FROM_U);
  assertEq('TRADE_CLEARING(AED) = −(gross+spread)', await creditNet(TB_ACCOUNT_CODES.TRADE_CLEARING, AED), -costU);

  // 验证 crypto OUT outstanding 已建且 OPEN(手动结算的目标)
  await waitFor('swap crypto(USDT) OUT outstanding OPEN', () =>
    prisma.outstanding.findFirst({ where: { swapTransactionId: swap.id, assetId: usdtAsset.id, direction: 'OUT', status: 'OPEN' } }));

  // ═══ Step 3: 法币腿结算 FIAT_SETTLE_IN(必须先结清,桥才可清)═══
  // 关键:清桥 sweep 以"swap 全部 Outstanding 均 SETTLED"为门(computeOpenBridgeContributions)。
  // swap 同时产生 crypto OUT(USDT)+ fiat IN(AED)两条 Outstanding;只结 crypto 腿,
  // swap 仍算 open → 桥贡献不消 → sweep=0。故须先把 AED IN 腿驱动到 SETTLED(对齐 verify-two-book Step 3)。
  console.log('\n═══ Step 3: 法币腿结算(F_OPS→F_SET→C_VIBAN,net 交付 → AED IN outstanding SETTLED)═══');
  const settleTx: any = await waitFor('FIAT_SETTLEMENT transfer spawned', () =>
    prisma.internalTransaction.findFirst({ where: { sourceType: 'FIAT_SETTLEMENT', sourceId: { startsWith: swap.id } } }));
  const fset = await prisma.wallet.findFirst({ where: { walletRole: 'F_SET', assetId: aedAsset.id, ownerType: 'PLATFORM' } });
  const settleLegs = await prisma.internalFund.findMany({ where: { internalTransactionId: settleTx.id }, orderBy: { createdAt: 'asc' } });
  const hop1 = settleLegs.find((l: any) => l.toWalletId === fset.id);
  const hop2 = settleLegs.find((l: any) => l.fromWalletId === fset.id);
  if (!hop1 || !hop2) throw new Error('FIAT_SETTLE_IN legs not found');
  await driveFiatLeg(hop1.id); // SUBMIT → CONFIRM;CONFIRMED 事件自动 SUBMIT hop2
  await waitFor('hop2 auto-SUBMIT → CONFIRMING', async () => {
    const f = await prisma.internalFund.findUnique({ where: { id: hop2.id } });
    return f.status === 'CONFIRMING' ? f : null;
  });
  await fundsFlow.updateStatus(hop2.id, { action: InternalFundAction.CONFIRM } as any, 'VERIFY');
  await waitFor('swap fiat IN outstanding SETTLED', () =>
    prisma.outstanding.findFirst({ where: { swapTransactionId: swap.id, direction: 'IN', status: 'SETTLED' } }));

  // ═══ Phase A: 手动结算 → sweep-only(清桥成本),不 reval ═══
  console.log('\n═══ Phase A: runManualCryptoSettlement → driveCryptoLeg → CLEAR → runSweepOnly ═══');

  // ① 捕获 reval 之前的 FX_UNREALIZED_PNL(AED)基线 U0
  const U0 = await creditNet(TB_ACCOUNT_CODES.FX_UNREALIZED_PNL, AED);
  console.log(`  U0 = creditNet(FX_UNREALIZED_PNL, AED) BEFORE = ${U0}`);

  const manualRes = await eodWorkflow.runManualCryptoSettlement('VERIFY');
  console.log(`  manual batch=${manualRes.batchNo} spawned=${manualRes.spawned} settledZero=${manualRes.settledZero}`);
  assertTrue('manual settle spawned 1 INTERNAL crypto leg', manualRes.spawned === 1, `spawned=${manualRes.spawned}`);
  if (!manualRes.batchNo) throw new Error('manual settle returned null batchNo');
  const manualBatchNo: string = manualRes.batchNo;

  // 校验:批次是 MANUAL_SETTLE 类型(决定 CLEAR handler 走 sweep-only)
  const manualBatch = await prisma.settlementBatch.findFirst({ where: { batchNo: manualBatchNo }, select: { settlementType: true } });
  assertTrue('batch settlementType = MANUAL_SETTLE', manualBatch?.settlementType === 'MANUAL_SETTLE', `type=${manualBatch?.settlementType}`);

  // 找到该手动批次 spawn 的 EOD_SETTLEMENT internalTransaction + 其 crypto 腿(与 EOD 同 sourceType/sourceNo)
  const manualTx: any = await waitFor('manual INTERNAL crypto transfer', () =>
    prisma.internalTransaction.findFirst({ where: { sourceType: 'EOD_SETTLEMENT', sourceNo: manualBatchNo } }));
  const manualLeg = await prisma.internalFund.findFirst({ where: { internalTransactionId: manualTx.id } });
  if (!manualLeg) throw new Error('manual crypto internalFund leg not found');

  // ② 驱动 crypto 腿至 CLEAR:SIGN→BROADCAST→SEEN_IN_MEMPOOL→CONFIRM → auto-CLEAR → CLEAR handler → runSweepOnly
  await driveCryptoLeg(manualLeg.id);

  // ③ 等 swap 的 crypto(OUT)outstanding → SETTLED
  await waitFor('swap crypto OUT outstanding SETTLED', () =>
    prisma.outstanding.findFirst({ where: { swapTransactionId: swap.id, direction: 'OUT', status: 'SETTLED' } }));
  // 等 sweep-only 把 USDT 桥清零(异步 CLEAR handler)
  await waitFor('USDT bridge swept to 0', async () =>
    (await creditNet(TB_ACCOUNT_CODES.TRADE_CLEARING, USDT)) === 0n ? true : null);

  // ④ Phase A 断言
  console.log('  ── Phase A 断言 ──');
  // ① crypto(USDT)outstanding = SETTLED(上面 waitFor 已保证,这里显式记一笔)
  const cryptoOut = await prisma.outstanding.findFirst({ where: { swapTransactionId: swap.id, direction: 'OUT' }, select: { status: true } });
  assertTrue('① crypto(USDT) Outstanding = SETTLED', cryptoOut?.status === 'SETTLED', `status=${cryptoOut?.status}`);
  // ② TRADE_CLEARING(USDT) 清零(唯一 swap 已结 → 桥全清)
  assertEq('② TRADE_CLEARING(USDT) swept to 0', await creditNet(TB_ACCOUNT_CODES.TRADE_CLEARING, USDT), 0n);
  // ③ FX_POSITION(USDT) credit-net = fromAmount(头寸按成本入账)
  const fxUsdt = await creditNet(TB_ACCOUNT_CODES.FX_POSITION, USDT);
  assertEq('③ FX_POSITION(USDT) credit-net = fromAmount(COST)', fxUsdt, FROM_U);
  // ④ 【关键】FX_UNREALIZED_PNL(AED) === U0 — sweep-only 路径未 reval
  const uAfterManual = await creditNet(TB_ACCOUNT_CODES.FX_UNREALIZED_PNL, AED);
  assertEq('④【关键】FX_UNREALIZED_PNL(AED) UNCHANGED(manual 未 reval)', uAfterManual, U0);

  // sweep-only 后不变式应已满足(I2:USDT 桥=open 贡献=0;AED 桥可能仍残留成本,因为 AED 腿要等 reval 才搬到 FX_POSITION(AED))
  // 注:Phase A 后 AED 桥尚未清(reval 才把 AED 成本腿搬入 FX_POSITION(AED)),故此处只断言 USDT 桥;整体不变式留到 Phase B。

  // ═══ Phase B: EOD 重估 → 把头寸标到 fixing(注入漂移价证明真的重标)═══
  console.log('\n═══ Phase B: fxEod.runReval(batchNo) → 标记 FX_POSITION 到 fixing ═══');
  // 手动已结清全部 outstanding,runEodSettlement 会 early-return(无 open)不 reval;
  // 故直接调 EOD 路径同入口 runReval 来跑重估。batchNo 仅作 evidence sourceNo。
  //
  // 注意:USDT/AED 走 AED 锚定汇率(BinanceRateProvider 恒为 peg 3.6725),swap 也以同价成交,
  // 故"live fixing == 成本价" → 重估 delta 恒为 0。为真正证明"reval 把头寸标到 fixing"且产生
  // 非零浮动盈亏(并与 manual sweep-only 不动 U0 形成对照),这里把 fetchRate 临时打桩成"漂移价",
  // 让 marked ≠ cost。断言全用关系式(marked − cost),对漂移幅度免疫。
  const REVAL_RATE = new Prisma.Decimal('3.7725'); // peg 3.6725 + 0.10 漂移
  const origFetchRate = rateProvider.fetchRate.bind(rateProvider);
  (rateProvider as any).fetchRate = async (from: string, to: string) => {
    const r = await origFetchRate(from, to);
    if (String(from).toUpperCase() === 'USDT' && String(to).toUpperCase() === 'AED') {
      return { ...r, rate: REVAL_RATE };
    }
    return r;
  };
  let revalReport: EodAccountingReport;
  try {
    revalReport = await fxEod.runReval(manualBatchNo);
  } finally {
    (rateProvider as any).fetchRate = origFetchRate; // 还原,避免污染后续(checkInvariants 不取价)
  }
  console.log(`  reval report: sweeps=${JSON.stringify(revalReport.sweeps)} revals=${JSON.stringify(revalReport.revals)}`);

  console.log('  ── Phase B 断言 ──');
  // 用注入的 fixing 关系式断言(对漂移幅度免疫)
  const fixing = REVAL_RATE;
  const fxAedDebit = await debitNet(TB_ACCOUNT_CODES.FX_POSITION, AED);
  const expectedFxAed = decimalToTbUnits(bigintToDecimal(fxUsdt, usdtAsset.decimals).mul(fixing), aedAsset.decimals);
  console.log(`  fixing(USDT/AED)=${fixing} → FX_POSITION(AED) 借方应= ${expectedFxAed}`);
  assertEq('FX_POSITION(AED) 借方 = FX_POSITION(USDT)×fixing', fxAedDebit, expectedFxAed);

  // ⑤ FX_UNREALIZED_PNL(AED) 现在非零 且 ≠ U0(reval 标了头寸);用关系式:marked − cost
  const uAfterReval = await creditNet(TB_ACCOUNT_CODES.FX_UNREALIZED_PNL, AED);
  assertTrue('⑤a FX_UNREALIZED_PNL(AED) 非零(reval 标记完成)', uAfterReval !== 0n, `unreal=${uAfterReval}`);
  assertTrue('⑤b FX_UNREALIZED_PNL(AED) 相对 U0 已变化', uAfterReval !== U0, `before=${U0} after=${uAfterReval}`);
  assertEq('⑤c FX_UNREALIZED = FX_POSITION(AED) − 成本(gross+spread)', uAfterReval, fxAedDebit - costU);

  // ⑥ checkInvariants → violations 为空(USDT 桥 + AED 桥均已清/匹配 open 贡献)
  const invReport: EodAccountingReport = { sweeps: [], revals: [], violations: [] };
  await fxEod.checkInvariants(invReport);
  assertTrue('⑥ checkInvariants violations 为空', invReport.violations.length === 0, JSON.stringify(invReport.violations));

  // ═══ 汇总 ═════════════════════════════════════════════════
  console.log(`\n═══ 断言汇总: ${assertCount - failures.length}/${assertCount} PASS ═══`);
  if (failures.length) {
    console.log('FAILURES:');
    for (const f of failures) console.log(`  ✗ ${f}`);
    await ctx.close();
    process.exit(1);
  }
  console.log('verify-manual-settle: ALL PASS ✅');
  await ctx.close();
  process.exit(0);
}

main().catch((err) => {
  console.error('FATAL', err);
  process.exit(2);
});
