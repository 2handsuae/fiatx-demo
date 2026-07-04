// scripts/demo-in-transit.ts — Command 1: 一键造"真实卡在半路"的在途单（提现 + swap）。
//
// Spec: doc-final/superpowers/specs/2026-07-04-recon-demo-realdata-design.md
// Plan: doc-final/superpowers/plans/2026-07-04-recon-demo-realdata-plan.md (Task 3)
//
// 复用 demo-lib 的 bootstrap/ensureSetup/resolveDemoCustomers（和其它 demo 脚本同一 NestJS
// 装配路径），挑一个客户 + 资产，调 createStuckWithdraw + createStuckSwap 两个共享夹具（Task
// 1/2），打印摘要。夹具走真实 workflow + funds_order.advance（和人在管理台点击同路径），只有
// 外部对账镜像用 Prisma 写入——那本来就是"外部银行/托管商喂进来的数据"。
//
// 用法（on-stack 包装器把脚本名之后的参数直接透传给脚本，故 --verify 紧跟脚本名、无需 --）：
//   bash scripts/on-stack.sh self demo:in-transit            # 造两笔在途单
//   bash scripts/on-stack.sh self demo:in-transit --verify   # 造 + 自检（见下方 runVerify）
//
// bootstrap() 在 demo-lib 模块顶部已做 webcrypto polyfill（先于 AppModule import），故此处
// 不重复——与 demo-swap.ts / demo-deposit.ts 一致。

import { Prisma } from '@prisma/client';
import { bootstrap, ensureSetup, resolveDemoCustomers, DemoCtx } from './demo-lib';
import {
  createStuckWithdraw,
  createStuckSwap,
  DEMO_STUCK_WD_REF_PREFIX,
  DEMO_STUCK_SWAP_REF_PREFIX,
} from './demo-fixtures';
import { WalletReconRunService } from '../src/modules/clearing-settle/reconciliation/workflow/wallet-recon-run.service';
import { PushOrderService } from '../src/modules/clearing-settle/reconciliation/disposition/push-order.service';
import { FundsOrderStatus } from '../src/modules/funds-orders/dto/funds-order.dto';

// 卡单参数：提现走法币 AED 500；swap 走 USDT→AED，amount 即 fromAmount（直接用）。
// canon2 后外部镜像入库一律洗成分（× 10^decimals），故 to-asset 精度不再受限、两向皆可造，
// amount 也无需再凑整数 grossTo（旧「≤2 硬约束 / amount 是下限、夹具自调」体操已随 T2 撤除）。
const STUCK_WD_AMOUNT = '500';
const STUCK_SWAP_FROM_AMOUNT = '300';

/**
 * 清掉本命令上一次跑遗留的"外部对账镜像"statement line（按 DEMO-STUCK-* 前缀精确定位），
 * 保证复跑后每个钱包只留一条镜像行。
 *
 * 为什么必须清（实测踩坑）：夹具每跑一次都新造一笔提现/swap（新单号→新 dedupKey），故会往同一
 * 钱包**再插一条** OUT statement line；但该钱包的 ExternalBalance 是 upsert（键 source+accountRef+
 * cutoffDate，后写覆盖），closingBalance 只反映**一条**镜像的 bump。于是 recon：delta=−amount（一条）
 * 而在途 Pass3 子轮B 按金额+方向逐条认领 → inTransitCount=镜像行数（≥2）→ inTransitSigned=−N×amount，
 * 残差=delta−inTransitSigned≠0 → 落 BREAK 而非 IN_TRANSIT。清到只剩一条 → delta 与 inTransitSigned 都
 * =−amount → 残差 0 → IN_TRANSIT。
 *
 * ⚠️ 只删 DEMO-STUCK-* 前缀的镜像行（externalRef / dedupKey），不碰 Command-2 场景数据或任何业务单
 *   ——scoped 清理，不用临时驱动那种 deleteMany({}) 全表清空。ExternalBalance 无需清（upsert 幂等、
 *   自覆盖；跨业务日的旧行 recon 也只读当日 cutoffDate，天然忽略）。历史遗留的非终态资金单腿也无需清
 *   ——没有对应 statement line 就不会被 Pass3 认领（子轮B 是"每条孤儿外部行认领一个单"，行没了就不认）。
 */
async function cleanPriorStuckMirror(ctx: DemoCtx): Promise<number> {
  const { count } = await ctx.prisma.externalStatementLine.deleteMany({
    where: {
      OR: [
        { externalRef: { startsWith: DEMO_STUCK_WD_REF_PREFIX } },
        { externalRef: { startsWith: DEMO_STUCK_SWAP_REF_PREFIX } },
        { dedupKey: { startsWith: DEMO_STUCK_WD_REF_PREFIX } },
        { dedupKey: { startsWith: DEMO_STUCK_SWAP_REF_PREFIX } },
      ],
    },
  });
  return count;
}

/** 查最近一次 run 里某钱包的桶行（快照表 reconciliation_run_wallets）。 */
async function latestWalletRow(ctx: DemoCtx, runId: string, walletRef: string): Promise<any | null> {
  return ctx.prisma.reconciliationRunWallet.findFirst({ where: { runId, walletRef } });
}

/**
 * --verify 自检（MVP 范围 + 一个 heal 增量信号；完整 heal-to-delta-0 e2e 是 Task 5）：
 *   1. 触发一次 recon（in-process 调 WalletReconRunService.run）。
 *   2. 断言提现钱包 + swap 钱包都落 IN_TRANSIT（残差 = delta − inTransitSigned = 0）。← 核心 DETECTION 断言
 *   3. 把提现的卡腿 in-process 推单（PushOrderService.syncPush，键 external statement line）→ 断言 CLEARED。
 *      （swap 腿推单不在范围——BACKLOG「swap 腿推单」；swap 只演 DETECTION。）
 *   4. 再跑一次 recon → 断言提现钱包**不再 IN_TRANSIT**（卡腿已终态、Pass3 不再认领它）。
 *
 * ⚠️ 为什么 step 4 不断言 delta→0（实测踩坑）：夹具的外部镜像 bump 用"裸 amount"（498，主单位量级）
 *   减在内部 POSTED 净额（最小单位，如 49800）上——这是为了让 DETECTION 时 delta 与 inTransitSigned
 *   都等于该裸数、抵消成残差 0（见 injectStuckExternalMirror 注释）。可一旦推单把腿真 POST 掉，账本
 *   按**真实最小单位**（49800）动账，而外部 closing 仍冻结在 fixture 时的 `internal − 498`，于是
 *   delta = 49800 − 498 = 49302 ≠ 0。要让 heal 收敛到 0，必须把外部镜像**按真实最小单位重摄入**——那正是
 *   Task 5（完整 heal 闭环）的活。故本 --verify 只断言"推单成功 + 卡腿脱离 IN_TRANSIT"，不强求 delta 归零。
 * 全 in-process，不经 HTTP、不用登录。
 */
async function runVerify(
  ctx: DemoCtx,
  wd: { walletRef: string; fundsOrderNo: string },
  swap: { walletRef: string },
): Promise<boolean> {
  const recon = ctx.app.get(WalletReconRunService);
  const push = ctx.app.get(PushOrderService);
  const fails: string[] = [];
  const check = (label: string, cond: boolean, detail = '') => {
    if (cond) console.log(`  ✓ ${label}${detail ? ` (${detail})` : ''}`);
    else { fails.push(label); console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`); }
  };

  console.log('\n═══ --verify: DETECTION（两笔 IN_TRANSIT）+ 提现推单脱离在途 ═══');

  // ⚠️ verify 用**当下**cutoff（夹具已跑完），不复用 main() 里预捕获的 cutoff：夹具的 statement
  //   line datetime = 腿创建时刻（晚于预捕获 cutoff），recon fetchExternalLinesForWallet 过滤
  //   datetime ≤ cutoff——用旧 cutoff 会把新镜像行滤掉→Pass3 认领不到→BREAK（实测踩坑）。当下
  //   cutoff ≥ 所有夹具行时刻且同一业务日（ExternalBalance 按 cutoffDate 读，秒级晚仍同日），命中。
  //   standalone recon:rerun 天然用 now-cutoff 故一直对，这里对齐它。
  const cutoff = new Date();

  // 1/2. recon → 两笔都 IN_TRANSIT，残差 0。
  const r1 = await recon.run({ cutoff });
  const wdRow = await latestWalletRow(ctx, r1.runId, wd.walletRef);
  const swapRow = await latestWalletRow(ctx, r1.runId, swap.walletRef);
  const residual = (row: any): string =>
    row ? new Prisma.Decimal(row.deltaAmount).sub(new Prisma.Decimal(row.inTransitAmount)).toString() : 'n/a';
  check('提现钱包 IN_TRANSIT', wdRow?.bucket === 'IN_TRANSIT',
    wdRow ? `bucket=${wdRow.bucket} delta=${wdRow.deltaAmount} inTransit=${wdRow.inTransitAmount} residual=${residual(wdRow)}` : 'no row');
  check('提现钱包残差 0', wdRow != null && residual(wdRow) === '0', `residual=${residual(wdRow)}`);
  check('swap 钱包 IN_TRANSIT', swapRow?.bucket === 'IN_TRANSIT',
    swapRow ? `bucket=${swapRow.bucket} delta=${swapRow.deltaAmount} inTransit=${swapRow.inTransitAmount} residual=${residual(swapRow)}` : 'no row');
  check('swap 钱包残差 0', swapRow != null && residual(swapRow) === '0', `residual=${residual(swapRow)}`);

  // 3. 提现卡腿推单 → CLEARED。
  let pushed: any = null;
  try {
    pushed = await push.syncPush(wd.fundsOrderNo, 'DEMO');
    check('提现卡腿推单 → CLEARED', pushed.finalStatus === FundsOrderStatus.CLEARED, `finalStatus=${pushed.finalStatus}`);
  } catch (e: any) {
    check('提现卡腿推单 → CLEARED', false, `syncPush threw: ${e.message}`);
  }

  // 4. 再 recon → 提现钱包**不再 IN_TRANSIT**（卡腿已终态、Pass3 不再认领；delta 归零属 Task 5 的重摄入，见上）。
  const cutoff2 = new Date();
  const r2 = await recon.run({ cutoff: cutoff2 });
  const wdRow2 = await latestWalletRow(ctx, r2.runId, wd.walletRef);
  check('提现钱包 heal 后脱离 IN_TRANSIT', wdRow2 != null && wdRow2.bucket !== 'IN_TRANSIT',
    wdRow2 ? `bucket=${wdRow2.bucket} delta=${wdRow2.deltaAmount}（delta≠0 因外部镜像未按最小单位重摄入 → Task 5）` : 'no row');

  const ok = fails.length === 0;
  console.log(`\n  --verify: ${ok ? 'PASS' : 'FAIL'}${ok ? '' : ` — ${fails.join('; ')}`}`);
  return ok;
}

async function main() {
  const verify = process.argv.includes('--verify');
  const ctx = await bootstrap();
  try {
    await ensureSetup(ctx); // idempotent — 保证 wallets/TB 就绪

    // 清上次遗留的 DEMO-STUCK-* 外部镜像行（scoped），保证复跑后每钱包只留一条镜像 → 残差 0。
    const cleaned = await cleanPriorStuckMirror(ctx);
    if (cleaned > 0) console.log(`  清理上次遗留的 ${cleaned} 条 DEMO-STUCK 外部镜像行（复跑幂等）`);

    const customers = await resolveDemoCustomers(ctx.prisma);
    const customer = customers[0]; // demo_alice

    // cutoff 只捕获一次、在调夹具之前——两个夹具的外部 statement line 都以腿创建时刻（≤ cutoff）
    // 入账，recon fetchExternalLinesForWallet 过滤 datetime ≤ cutoff 时才命中。
    const cutoff = new Date();

    console.log('\n═══ demo:in-transit — 造真实提现 + swap 在途单（Command 1）═══');

    // ① 提现在途：法币 AED，payout 主腿停在 SUBMITTED（非终态）→ 客户钱包 OUT 在途（book=CLIENT）。
    const wd = await createStuckWithdraw(ctx, { customer, asset: ctx.aed, amount: STUCK_WD_AMOUNT, cutoff });
    console.log('  ① stuck withdraw:', JSON.stringify(wd));

    // ② swap 在途：USDT→AED，leg3（BUY，平台 F_SET AED 钱包）停在 CREATED（非终态）→ 平台钱包
    //    OUT 在途（book=FIRM）。amount 即 fromAmount 直接用（外部镜像洗成分后 grossTo 不必凑整）。
    const swap = await createStuckSwap(ctx, {
      customer, fromAsset: ctx.usdt, toAsset: ctx.aed, amount: STUCK_SWAP_FROM_AMOUNT, cutoff,
    });
    console.log('  ② stuck swap:   ', JSON.stringify(swap));

    console.log(`\n  cutoff=${cutoff.toISOString()}`);
    console.log(`  → recon 应把 ${wd.walletRef}(CLIENT) 与 ${swap.walletRef}(FIRM) 两钱包都认领为 IN_TRANSIT。`);

    if (verify) {
      const ok = await runVerify(ctx, wd, swap);
      if (!ok) process.exitCode = 1;
    }
  } finally {
    await ctx.app.close();
  }
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
