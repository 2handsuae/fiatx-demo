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

import { Prisma } from '@prisma/client';
import { bootstrap, ensureSetup, resolveDemoCustomers, waitFor, DemoCtx } from './demo-lib';
import {
  createStuckWithdraw,
  createStuckSwap,
  DEMO_STUCK_WD_REF_PREFIX,
  DEMO_STUCK_SWAP_REF_PREFIX,
} from './demo-fixtures';
import { WalletReconRunService } from '../src/modules/clearing-settle/reconciliation/workflow/wallet-recon-run.service';
import { PushOrderService } from '../src/modules/clearing-settle/reconciliation/disposition/push-order.service';
import { FundsOrderStatus } from '../src/modules/funds-orders/dto/funds-order.dto';

// 卡单参数：提现走法币 AED（~500）；swap 走 USDT→AED，amount 即 fromAmount。
// canon2 后外部镜像入库一律洗成分（× 10^decimals），故 to-asset 精度不再受限、两向皆可造，
// amount 也无需再凑整数 grossTo（旧「≤2 硬约束 / amount 是下限、夹具自调」体操已随 T2 撤除）。
//
// ⚠️ 金额必须**与该钱包历史 POSTED 净额不撞**（实测踩坑，canon2 T6 修）：demo 客户钱包跨轮复用，每次
//   --verify 把卡腿推单 POST 后会在该钱包留一条 WITHDRAW_NET_POST 的 POSTED account_flow（净额×100 分）。
//   reset 只清非终态腿+recon 表，**清不掉已 POST 的历史流水**（其父 withdraw 常被删、flow 成孤儿留存）。
//   若金额与某条历史 POSTED 净额相等，匹配器 Pass2（金额+方向+60min 模糊）会拿历史流水**抢配**本轮外部
//   镜像行 → 该行被吃掉、进不了 Pass3 → 卡腿认不成在途 → 落 BREAK（而非 IN_TRANSIT）。故这里查该客户钱包
//   已存在的 WITHDRAW_NET_POST 净额集合，挑一个**不在集合里**的 amount（净额=amount−2，服务费 Tier 1 FLAT
//   2 AED；区间锁 [500,999] 留足 fee/limit 余量）——本轮外部行只可能与本轮 POST 配对，与任何历史额不撞。
//   （单纯用时间抖动不够：同一分钟/同一秒内连跑两次仍会撞同额，故按实际历史集合避让最稳。）
async function pickCollisionFreeWdAmount(ctx: DemoCtx, customer: any, asset: any): Promise<string> {
  const wallets = (await ctx.prisma.wallet.findMany({
    where: { ownerId: customer.id, network: asset.network },
    select: { id: true },
  })) as Array<{ id: string }>;
  const walletIds = wallets.map((w) => w.id);
  const used = new Set<string>();
  if (walletIds.length > 0) {
    const flows = (await (ctx.prisma as any).accountFlow.findMany({
      where: { walletRef: { in: walletIds }, eventCode: 'WITHDRAW_NET_POST', transferType: 'POSTED' },
      select: { amount: true },
    })) as Array<{ amount: Prisma.Decimal }>;
    for (const f of flows) used.add(new Prisma.Decimal(f.amount).toFixed(0)); // 分
  }
  const pow = new Prisma.Decimal(10).pow(asset.decimals);
  for (let amt = 500; amt <= 999; amt++) {
    const netMinor = new Prisma.Decimal(amt - 2).mul(pow).toFixed(0); // 净额=amount−2（FLAT fee），元→分
    if (!used.has(netMinor)) return String(amt);
  }
  // 500 个候选全被占用（几乎不可能）——退回一个带毫秒抖动的值，至少不必然撞。
  return String(500 + (Date.now() % 490));
}
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
 * --verify 自检（完整 heal 闭环 delta→0；canon2 T6）：
 *   1. 触发一次 recon（in-process 调 WalletReconRunService.run）。
 *   2. 断言提现钱包 + swap 钱包都落 IN_TRANSIT（残差 = delta − inTransitSigned = 0）。← 核心 DETECTION 断言
 *   3. 把提现的卡腿 in-process 推单（PushOrderService.syncPush，键 external statement line）→ 断言 CLEARED。
 *      （swap 腿推单不在范围——BACKLOG「swap 腿推单」；swap 只演 DETECTION。）
 *   4. 再跑一次 recon → 断言提现钱包 **heal 收敛：delta=0 且 inTransitCount=0 且脱离 IN_TRANSIT**。
 *      ← 核心 HEAL 断言（整件事目标）。
 *
 * ✅ 为什么 step 4 现在能断言 delta→0（canon2 T2 修复后）：夹具外部镜像入库已洗成分
 *   （closing = internalPosted − netAmount×10^decimals，见 injectStuckExternalMirror）。推单把腿真 POST
 *   掉时账本按同一最小单位（如 49800 分）动账，于是 delta = closing − internal
 *   = (internal−49800) − (internal−49800) = 0。DETECTION 期的裸元/分错配（旧 49302 残差）已随 T2 消除。
 *
 * ⚠️ 关于 case 状态：钱包 delta 归零（余额已平）是 heal 的硬信号；但 demo 客户钱包是**跨轮复用**的，
 *   历史累积了多笔内部单腿（往轮 WITHDRAW_NET_POST 等），外部对账镜像每轮只喂一条行，故重对账时该钱包
 *   仍有 orphanInternal>0 → 落 COMPENSATING（余额平但逐行证据不全）而非 MATCHED，其 case 不自动 RESOLVED。
 *   case 自愈到 RESOLVED/AUTO_HEALED 需钱包干净（零异常达 MATCHED），已由单测
 *   wallet-recon-run.service.spec.ts（"breaks in run A then recovers in run B → RESOLVED/AUTO_HEALED"）证明。
 *   故本 e2e 断言 delta=0（真 heal 信号），并打印真实 case 状态，不在复用钱包上硬断言 AUTO_HEALED。
 * 全 in-process，不经 HTTP、不用登录。
 */
async function runVerify(
  ctx: DemoCtx,
  wd: { walletRef: string; fundsOrderNo: string; withdrawNo: string },
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

  // 4. 再 recon → heal 收敛：卡腿已 POST，外部 closing 与内部账本按同一分口径归位 → delta=0、
  //    该腿不再被 Pass3 认领（inTransitCount=0）、脱离 IN_TRANSIT。← 核心 HEAL 断言。
  //
  // ⚠️ 必须先等净额 POST 落库再 recon（实测踩坑）：syncPush 只把腿驱到 CLEARED 就返回，真正的**净额 POST**
  //   由 withdraw-workflow 的 @OnEvent(onPayoutLegConfirmed) 异步 handler 完成（写 WITHDRAW_NET_POST
  //   account_flow：OUT→客户 PAYABLE[100]、IN→聚合 CLIENT_ASSET[1]；balanceChecker 只认 owned=100/101，
  //   故内部净额下移 −净额）。若紧接着 recon，该 flow 可能还没 commit → 该轮读到旧内部余额 → delta 仍= −净额
  //   → 误判 BREAK。故这里轮询到该腿的 WITHDRAW_NET_POST 落库再 recon，去竞态。
  await waitFor(
    `${wd.fundsOrderNo} 净额 POST 落库（WITHDRAW_NET_POST）`,
    async () => {
      const posted = await (ctx.prisma as any).accountFlow.count({
        where: { walletRef: wd.walletRef, eventCode: 'WITHDRAW_NET_POST', sourceNo: wd.withdrawNo, transferType: 'POSTED' },
      });
      return posted > 0 ? posted : null;
    },
    8000,
  );
  const cutoff2 = new Date();
  const r2 = await recon.run({ cutoff: cutoff2 });
  const wdRow2 = await latestWalletRow(ctx, r2.runId, wd.walletRef);
  const delta2 = wdRow2 ? new Prisma.Decimal(wdRow2.deltaAmount).toString() : 'n/a';
  check('提现钱包 heal 后 delta=0', wdRow2 != null && delta2 === '0',
    wdRow2 ? `delta=${delta2}（推单 POST 后外部/内部按分归位）` : 'no row');
  check('提现钱包 heal 后卡腿不再在途（inTransitCount=0）', wdRow2 != null && wdRow2.inTransitCount === 0,
    wdRow2 ? `inTransitCount=${wdRow2.inTransitCount}` : 'no row');
  check('提现钱包 heal 后脱离 IN_TRANSIT', wdRow2 != null && wdRow2.bucket !== 'IN_TRANSIT',
    wdRow2 ? `bucket=${wdRow2.bucket}` : 'no row');
  // case 状态如实打印（不硬断言 AUTO_HEALED——复用 demo 钱包有历史内部单腿 → COMPENSATING，见函数头注释）。
  const wdCase = wdRow2?.caseNo
    ? await (ctx.prisma as any).reconciliationCase.findFirst({ where: { caseNo: wdRow2.caseNo } })
    : null;
  console.log(`  ℹ 提现 case ${wdRow2?.caseNo ?? '(none)'}：status=${wdCase?.status ?? 'n/a'} resolution=${wdCase?.resolutionReason ?? '—'} bucket=${wdRow2?.bucket}（delta=${delta2}；余额已平，case 自愈到 RESOLVED 需钱包零异常，见单测）`);

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
    //    金额避开该钱包历史 POSTED 净额 → 本轮外部镜像行不会被历史流水在 Pass2 抢配（见 picker 注释）。
    const wdAmount = await pickCollisionFreeWdAmount(ctx, customer, ctx.aed);
    const wd = await createStuckWithdraw(ctx, { customer, asset: ctx.aed, amount: wdAmount, cutoff });
    console.log(`  ① stuck withdraw (amount=${wdAmount}):`, JSON.stringify(wd));

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
