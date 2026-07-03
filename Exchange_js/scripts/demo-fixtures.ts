// scripts/demo-fixtures.ts
//
// 共享 demo 夹具：造"真实卡在半路"的在途单。被 demo:in-transit（Command 1）
// 与 recon-demo scenario-1（Command 2 去壳）复用——一份逻辑两处用。
//
// Spec: doc-final/superpowers/specs/2026-07-04-recon-demo-realdata-design.md
// Plan: doc-final/superpowers/plans/2026-07-04-recon-demo-realdata-plan.md (Task 1)
//
// 走真实 workflow + funds_order.advance（和人在管理台点击同一条路径），不开 Prisma 后门
// 造业务状态；仅外部对账镜像（external_balances / external_statement_lines）用 Prisma 写入
// ——那本来就是"外部银行/托管商喂进来的数据"，不是内部业务状态。

import { Prisma } from '@prisma/client';
import { FundsOrderAction, FundsOrderStatus } from '../src/modules/funds-orders/dto/funds-order.dto';
import { WalletBalanceCheckerService } from '../src/modules/clearing-settle/reconciliation/engine/v2/wallet-balance-checker.service';
import { sleep, waitFor } from './demo-lib';

// 与 recon-demo.ts 一致：法币走银行对账单（ZAND），虚拟币走托管（HEXTRUST）。
function sourceFor(assetCode: string): 'HEXTRUST' | 'ZAND' {
  return /^(USDT|BTC|ETH|USDC)/i.test(assetCode) ? 'HEXTRUST' : 'ZAND';
}

// dedupKey / referenceNo 前缀，reset 时可精确定位并清理本夹具造的行。
export const DEMO_STUCK_WD_REF_PREFIX = 'DEMO-STUCK-WD-';
export const DEMO_STUCK_SWAP_REF_PREFIX = 'DEMO-STUCK-SWAP-';

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * 造"外部已过账、内部账本尚未记该腿"的对账镜像，让 recon 能看见该钱包并把差额认领为
 * 在途。提现 / swap 两个卡单夹具共用——一份逻辑两处用（Task 2）。
 *
 * recon 只核 external_balances @ cutoff 里出现的钱包（wallet-recon-run.service §2），故必须
 * upsert 该钱包的 ExternalBalance；再插一条同方向 statement line（银行/托管已过账该笔）。
 * 该钱包内部 POSTED 净额由 recon 引擎自己的 balanceChecker 算（与对账口径 0 漂移），外部
 * closing 相对内部按方向 bump 一个 `amount`：
 *   - OUT（钱出去了，外部先反映减少）：closing = internalPosted − amount，line.direction=OUT
 *   - IN （钱进来了，外部先反映增加）：closing = internalPosted + amount，line.direction=IN
 * 于是 recon：delta = external − internal = ±amount；在途 Pass3 认领该腿 → inTransitSigned = ±amount；
 *   残差 = delta − inTransitSigned = 0 且 inTransitCount>0 → IN_TRANSIT。
 *
 * ⚠️ 单位一致性（实测踩坑）：funds_orders.amount / statement_lines.amount 存"主单位"（如 498），
 *   account_flows / balanceChecker.delta 是"最小单位"（如 49800）。bump 当作与 line.amount 同值
 *   的裸数直接加减 closing——delta 因此等于该裸数（内部基数的绝对刻度被抵消）。故 closing 用
 *   `internalPosted ± 裸 amount`，不要按 decimals 放大，否则 delta≠inTransitSigned 落 BREAK。
 *
 * `book` 只是 ExternalBalance / statement line 上的存储字段，不参与 delta 计算——钱包 kind 由
 * balanceChecker 从 account_flows 的 code 自证（CUSTOMER 100/101 vs FIRM 200-203）。仍按钱包
 * 真实归属（客户钱包=CLIENT，平台钱包=FIRM）写对，供 case/快照展示口径一致。
 */
export async function injectStuckExternalMirror(
  ctx: any,
  opts: {
    walletRef: string;
    direction: 'IN' | 'OUT';
    amount: Prisma.Decimal; // 主单位（= 腿 netAmount/amount，与在途 Pass3 amountOk 对齐）
    currency: string;
    book: 'CLIENT' | 'FIRM';
    source: 'HEXTRUST' | 'ZAND';
    externalRef: string;
    dedupKey: string;
    cutoff: Date;
    ownerNo: string | null;
    datetime: Date; // statement line 入账时刻（须 ≤ cutoff，且落在在途 Pass3 子轮B 72h 时窗内）
    description: string;
  },
): Promise<void> {
  const { walletRef, direction, amount, currency, book, source, externalRef, dedupKey, cutoff, ownerNo, datetime, description } = opts;

  // 内部 POSTED 净额（最小单位整数），bump 按方向加减裸 amount。
  const balanceChecker = ctx.app.get(WalletBalanceCheckerService);
  const bal = await balanceChecker.checkBalance({ walletRef, externalClosing: 0n, cutoff });
  const internalPosted = bal.internal.total as bigint;
  const bump = BigInt(amount.toFixed(0)); // 裸 amount（与 line.amount 同值）
  const closingMinor = direction === 'OUT' ? internalPosted - bump : internalPosted + bump;

  const cutoffDate = ymd(cutoff);
  await ctx.prisma.externalBalance.upsert({
    where: { source_accountRef_cutoffDate: { source, accountRef: walletRef, cutoffDate } },
    update: {
      currency, book,
      closingBalance: new Prisma.Decimal(closingMinor.toString()),
      openingBalance: new Prisma.Decimal(0),
      asOfAt: cutoff, status: 'INGESTED', walletRef, ownerNo, lineCount: 1,
    },
    create: {
      source, accountRef: walletRef, currency, book, cutoffDate,
      closingBalance: new Prisma.Decimal(closingMinor.toString()),
      openingBalance: new Prisma.Decimal(0),
      asOfAt: cutoff, status: 'INGESTED', walletRef, ownerNo, lineCount: 1,
    },
  });

  await ctx.prisma.externalStatementLine.upsert({
    where: { dedupKey },
    update: {},
    create: {
      source, accountRef: walletRef, subAccount: walletRef, book, currency,
      direction, amount, externalRef, datetime, description, dedupKey,
    },
  });
}

export interface StuckWithdrawResult {
  withdrawNo: string;
  fundsOrderNo: string;
  walletRef: string;
  externalRef: string;
  amount: string;
  fundsOrderId: string;
}

/**
 * 造一笔真实提现并停在非终态（payout 主腿 SUBMITTED[fiat] / CONFIRMING[crypto]，
 * POST 未做 → funds order 非终态），再把该钱包的外部镜像做成"银行已确认出金、内部账本
 * 尚未记账"的样子 → recon 认领为 IN_TRANSIT。
 *
 * 实测机制（read + 实跑核实，见 Task 1 Step 3）：
 *   - 提现在 PENDING_COMPLIANCE→PAYOUT_PENDING 阶段只建 TB *pending* 锁（预占，非 POSTED
 *     crossing），payout 主腿 CONFIRM 才触发 workflow POST net + CLEAR。所以停在 CONFIRM 之前，
 *     该钱包的 POSTED 账本余额不变（internal 不动）。
 *   - fiat OUT 无 CONFIRMING 态：CREATED --SUBMIT--> SUBMITTED --CONFIRM--> …
 *     故 fiat 停点 = SUBMITTED；crypto OUT 停点 = CONFIRMING（SUBMIT→OBSERVE_CONFIRMING）。
 *   - payout 主腿的 fromWalletId = 客户源钱包（vIBAN/C_DEP），在该钱包上方向为 OUT。
 *     advance() 不写 txHash/referenceNo（全程 null），故 recon 在途 Pass3 子轮A（单号精确）
 *     命不中，落到子轮B（金额+方向+72h 时窗兜底，条件含 refsOf(order).length===0）——匹配成功。
 *
 * 外部镜像（让 recon 能看见并算出差额）：
 *   recon 只核 external_balances @ cutoff 里有的钱包。故本夹具 upsert 该钱包的
 *   ExternalBalance，closingBalance = 内部 POSTED 净额 − amount（钱已出去，外部先反映），
 *   并插一条 OUT statement line（银行确认出金）。
 *   于是 recon：delta = external − internal = −amount；inTransitSigned = −amount（OUT 腿被认领）；
 *   残差 = delta − inTransitSigned = 0 且 inTransitCount>0 → IN_TRANSIT。
 *
 * 返回 { withdrawNo, fundsOrderNo, walletRef, externalRef, amount, fundsOrderId } 供 manifest/断言。
 */
export async function createStuckWithdraw(
  ctx: any,
  opts: { customer: any; asset: any; amount: string; cutoff: Date },
): Promise<StuckWithdrawResult> {
  const { customer: c, asset, amount, cutoff } = opts;
  const isCrypto = asset.type === 'CRYPTO';

  // ── 1. 造提现 → PAYOUT_PENDING（照 demo-lib.driveWithdraw 前半段）────────────
  const wq: any = await ctx.withdrawQuote.createQuote({
    ownerType: 'CUSTOMER',
    ownerId: c.id,
    ownerNo: c.customerNo,
    assetId: asset.id,
    assetCode: asset.currency,
    amount: new Prisma.Decimal(amount),
    customerId: c.id,
  } as any);

  // 目标地址：fiat 用客户 vIBAN，crypto 用一个确定性地址（照 demo-lib.runWithdraws）。
  const viban = isCrypto
    ? null
    : await ctx.prisma.wallet.findFirst({
        where: { ownerId: c.id, walletRole: 'C_VIBAN', assetId: asset.id },
      });
  const toIban = isCrypto ? undefined : (viban?.iban ?? undefined);
  const toAddress = isCrypto ? `Tstuckwd${c.customerNo}`.slice(0, 34) : undefined;

  // generateReferenceNo('WD') 只用 4 位随机，繁忙同日命名空间可能 P2002 撞号 → 重试几次。
  let wd: any;
  for (let attempt = 1; ; attempt++) {
    try {
      wd = await ctx.withdrawWf.createWithdrawal(
        { assetId: asset.id, amount, toIban, toAddress, quoteId: wq.id } as any,
        c.id,
        'CUSTOMER',
      );
      break;
    } catch (e: any) {
      if (e?.code === 'P2002' && attempt < 8) {
        await sleep(60);
        continue;
      }
      throw e;
    }
  }

  await waitFor(`${wd.withdrawNo} PENDING_COMPLIANCE`, async () => {
    const w: any = await ctx.prisma.withdrawTransaction.findUnique({ where: { id: wd.id } });
    return w.status === 'PENDING_COMPLIANCE' ? w : null;
  });
  await ctx.withdraws.updateKytStatus(wd.id, 'PASSED', null, 5, 1);
  if (isCrypto) await ctx.withdraws.updateTravelRuleStatus(wd.id, 'PASSED', null);

  await waitFor(
    `${wd.withdrawNo} PAYOUT_PENDING`,
    async () => {
      const w: any = await ctx.prisma.withdrawTransaction.findUnique({ where: { id: wd.id } });
      if (w.status !== 'PAYOUT_PENDING') return null;
      const [payoutLeg] = await ctx.fundsOrders.findByParent({ withdrawTransactionId: wd.id }, { legSeq: 1 });
      return payoutLeg ? w : null;
    },
    8000,
  );

  // ── 2. 拿 payout 主腿（legSeq 1），推到非终态停住（不 CONFIRM → 不 POST/CLEAR）──
  //   实测确认（demo-realdata 栈，AED 法币 500）：SUBMIT 后腿停在 SUBMITTED（非终态），
  //   配合下方外部镜像，recon:rerun 落 IN_TRANSIT（delta=−498, inTransitAmount=−498, 残差 0）。
  //   fiat OUT 无 CONFIRMING 态（CREATED→SUBMIT→SUBMITTED→CONFIRM→…），故 fiat 停点=SUBMITTED；
  //   crypto OUT 有 CONFIRMING（SUBMIT→OBSERVE_CONFIRMING→CONFIRMING），停点=CONFIRMING。
  const [leg] = await ctx.fundsOrders.findByParent({ withdrawTransactionId: wd.id }, { legSeq: 1 });
  const legIsCrypto = (leg.asset?.type || '').toUpperCase() !== 'FIAT';
  await ctx.fundsOrders.advance(leg.id, FundsOrderAction.SUBMIT, 'DEMO');
  await sleep(60);
  if (legIsCrypto) {
    await ctx.fundsOrders.advance(leg.id, FundsOrderAction.OBSERVE_CONFIRMING, 'DEMO');
    await sleep(60);
  }
  const stuck = await ctx.fundsOrders.findById(leg.id);
  if (FundsOrderStatus.CLEARED === stuck.status || FundsOrderStatus.FAILED === stuck.status) {
    throw new Error(`stuck withdraw leg ${stuck.fundsOrderNo} unexpectedly terminal (${stuck.status})`);
  }
  const walletRef: string = stuck.fromWalletId;
  if (!walletRef) throw new Error(`payout leg ${stuck.fundsOrderNo} has no fromWalletId — cannot mirror`);

  // ── 3. 外部镜像：payout 主腿是客户钱包上的 OUT，走共享 injectStuckExternalMirror ──
  //   出金额用 payout 主腿的 netAmount（= 提现净额 = 毛额 − 手续费；银行实际出给客户的是净额）。
  //   book：payout 从客户 vIBAN/C_DEP 出，故 CLIENT（提现主腿永远是客户钱包）。
  //   ⚠️ recon fetchExternalLinesForWallet 过滤 datetime ≤ cutoff：调用方传入的 cutoff 必须 ≥
  //     本腿创建时刻（腿在夹具内部创建，晚于调用方预先捕获的时间）。demo:in-transit / recon:demo
  //     用"当下"cutoff 天然满足；直跑 recon:rerun 用默认 now-cutoff。
  const outAmount = new Prisma.Decimal(stuck.netAmount ?? stuck.amount); // 腿净额（主单位，客户实收）
  const externalRef = `${DEMO_STUCK_WD_REF_PREFIX}${wd.withdrawNo}`;
  await injectStuckExternalMirror(ctx, {
    walletRef,
    direction: 'OUT',
    amount: outAmount,
    currency: asset.currency,
    book: 'CLIENT',
    source: sourceFor(asset.currency),
    externalRef,
    dedupKey: `${DEMO_STUCK_WD_REF_PREFIX}${wd.withdrawNo}`,
    cutoff,
    ownerNo: c.customerNo,
    datetime: stuck.createdAt, // 与腿创建时刻对齐（在途 Pass3 子轮B 72h 时窗内）
    description: 'Demo stuck withdraw — bank confirmed outflow, internal POST pending',
  });

  return {
    withdrawNo: wd.withdrawNo,
    fundsOrderNo: stuck.fundsOrderNo,
    walletRef,
    externalRef,
    amount,
    fundsOrderId: stuck.id,
  };
}

export interface StuckSwapResult {
  swapNo: string;
  stuckLegNo: string; // 卡住那条腿的 fundsOrderNo（legSeq 3）
  walletRef: string; // 卡腿的 fromWalletId（平台 F_ 钱包）
  externalRef: string;
  stuckLegId: string;
}

/**
 * 造一笔真实 swap 并让它半途卡住：走 swap workflow 建单（PROCESSING）→ 把 legSeq≤2 推到
 * CLEARED（每腿 SUBMIT →[crypto: OBSERVE_CONFIRMING] → CONFIRM，handler 自 POST+CLEAR 并
 * 链下一腿）→ leg3 由 handler 建成 CREATED 后**不推**（连同 leg4 停在非终态）。
 *
 * swap 4 腿模型（SELL/SETTLE/BUY/FEE，见 swap-leg-plan.constant）：腿在平台 F_ 钱包间与客户
 * 钱包间搬钱。leg3 是 BUY 腿——USDT→AED 时 fromRole=F_SET（平台 AED 结算钱包），AED→USDT 时
 * fromRole=F_OPS（平台 USDT 运营钱包）。两向的**卡腿 fromWalletId 都是平台钱包（book=FIRM）**，
 * 不是客户钱包——这跟提现主腿（客户钱包 book=CLIENT）本质不同。
 *
 * ⚠️ 但本夹具**仅支持 to-asset 精度 ≤ 2 的方向（即 →AED，如 USDT→AED）**：recon 在途匹配器要
 *   卡腿金额（=grossTo）为整数主单位，而 grossTo 按 to-asset 精度舍入——to-USDT（6-8 位）几乎
 *   凑不出整数（见 step 0 的方向性硬 guard）。USDT→AED 的 leg3（F_SET）已是 FIRM 钱包，FIRM
 *   卡单场景完整覆盖；AED→USDT 的 F_OPS 卡单既非必需也不可达。
 *
 * 卡腿在其 fromWalletId 上方向为 OUT（findNonTerminalByWallet：fromWalletId===walletRef → OUT）。
 * 该腿 POST 未做（handler 只在 CONFIRMED 才 postLeg），故这条 OUT 的 code-201/200 记账没落地；
 * 但 leg2 已 CLEAR，把 grossTo 打进了该 F_ 钱包（IN）——所以内部 POSTED 净额此刻 = +grossTo。
 * 外部镜像按 OUT 把 closing 相对内部减 grossTo，插一条 OUT statement line（托管/银行已过账该腿）：
 *   delta = external − internal = −grossTo；在途 Pass3 认领 leg3（金额=grossTo，方向 OUT）→
 *   inTransitSigned = −grossTo；残差 0 且 inTransitCount>0 → IN_TRANSIT。
 *
 * swap 腿 amountRef='grossTo'（leg3），netAmount==amount==grossTo（createLeg 里 net=amount）。
 * 在途 Pass3 amountOk 用 line.amount==腿.netAmount/amount 认领，故 line.amount = grossTo。
 * swap 腿全程无 txHash/referenceNo（advance 不写），在途 Pass3 走子轮B（金额+方向+72h 时窗）。
 *
 * ⚠️ swap push-heal 不在范围（BACKLOG「swap 腿推单」）——本夹具只演 DETECTION（recon 落 IN_TRANSIT）。
 *
 * `opts.amount` 是 fromAmount 下限——因 recon 在途匹配器要求整数主单位金额，夹具会实时探汇率并从
 *   该下限起向上微调到能整出 grossTo 的最小整数 fromAmount（见 step 0；精确名义额非要点）。`toAsset`
 *   须精度 ≤ 2（否则 step 0 当场响亮报错），故实际方向恒为 →AED。
 *
 * 返回 { swapNo, stuckLegNo, walletRef, externalRef, stuckLegId } 供 manifest/断言。
 */
export async function createStuckSwap(
  ctx: any,
  opts: { customer: any; fromAsset: any; toAsset: any; amount: string; cutoff: Date },
): Promise<StuckSwapResult> {
  const { customer: c, fromAsset, toAsset, amount, cutoff } = opts;

  const mkQuote = (amt: Prisma.Decimal) =>
    ctx.swapQuote.createQuote({
      ownerType: 'CUSTOMER', ownerId: c.id, ownerNo: c.customerNo,
      fromAssetId: fromAsset.id, fromAssetCode: fromAsset.currency,
      toAssetId: toAsset.id, toAssetCode: toAsset.currency,
      amount: amt, customerId: c.id,
    } as any);

  // ── 0. 汇率无关地挑一个能整出 grossTo 的 fromAmount ───────────────────────────────
  //   卡腿（leg3）金额 = grossTo。引擎实际算 grossAmountOut = round(amount × quotedRate,
  //   toAsset.decimals, ROUND_HALF_UP)（pricing-engine.service.ts:220-224，feeDecimals=
  //   to-asset 精度；rateAllIn == quotedRate 见 swap-quote.service.ts:182）。而 recon 在途匹配器
  //   要求**整数主单位金额**（编排器 BigInt(line.amount) 不容小数点 + amountOk 按主单位比对）。
  //
  //   ⚠️ 方向性硬约束（实测确认）：能否凑出整数 grossTo 取决于 **to-asset 的精度**。
  //     to-AED（2 位）：整数 fromAmount 命中整 AED 很密（每 ~10 个就有一个），可用。
  //     to-USDT（6-8 位）：整 USDT 需 amount×rate 落在 5e-7 内命中整数——8 位有效数字的分数汇率
  //       下几乎不可能（实测 [100,200000) 整 AED 输入零命中）。故本夹具**只支持 to-asset 精度 ≤ 2**
  //       的方向（即 →AED）。这不缩小演示价值：USDT→AED 的 leg3 钱包（F_SET）已是平台 FIRM 钱包，
  //       FIRM-钱包卡单场景完整覆盖；AED→USDT 的 leg3（F_OPS）也是 FIRM 钱包但既非必需也不可达。
  //     引擎"在途行小数金额崩/主-最小单位混用"的根因缺陷已单列 backlog（不在本夹具范围修）。
  const toDp: number = toAsset.decimals ?? 8;
  if (toDp > 2) {
    throw new Error(
      `createStuckSwap: to-asset ${toAsset.currency} has ${toDp} decimals — recon in-transit ` +
        `matcher needs an integer major-unit grossTo (BigInt(line.amount)), which is unreachable ` +
        `for a >2-decimal to-asset. Use a direction whose to-asset settles in ≤2 decimals (→AED).`,
    );
  }
  const probe: any = await mkQuote(new Prisma.Decimal(amount)); // 探实时 rateAllIn（费率随 ensureSetup 变）
  const rateAllIn = new Prisma.Decimal(probe.rateAllIn);
  const grossOf = (fromAmt: Prisma.Decimal) =>
    fromAmt.mul(rateAllIn).toDecimalPlaces(toDp, Prisma.Decimal.ROUND_HALF_UP);
  const start = parseInt(new Prisma.Decimal(amount).toFixed(0), 10);
  const WINDOW = 400; // to-AED 2 位命中很密，400 足够
  let chosenFrom = -1;
  for (let a = start; a < start + WINDOW; a++) {
    const g = grossOf(new Prisma.Decimal(a));
    if (g.equals(g.trunc())) { chosenFrom = a; break; }
  }
  if (chosenFrom < 0) {
    throw new Error(
      `createStuckSwap: no integer fromAmount in [${start}, ${start + WINDOW}) yields a whole ` +
        `${toAsset.currency} grossTo at rate ${rateAllIn} (dp=${toDp}) — cannot build an integer-amount stuck leg`,
    );
  }

  // ── 1. 造 swap → PROCESSING（照 demo-lib.runSwaps：createQuote → executeSwap）────────
  const quote: any = await mkQuote(new Prisma.Decimal(chosenFrom));
  const swap: any = await ctx.swapWf.executeSwap(c.id, quote.id);
  await waitFor(`${swap.swapNo} PROCESSING`, async () => {
    const s: any = await ctx.prisma.swapTransaction.findUnique({ where: { id: swap.id } });
    return s?.status === 'PROCESSING' ? s : null;
  }, 8000);

  // ── 2. 把 legSeq 1、2 推到 CLEARED（照 demo-lib.driveSwapLegToClear：CONFIRMED 触发 handler
  //   自 POST + CLEAR + 链下一腿；不发 CLEAR）。leg3 由 leg2 CLEAR 后 handler 建成 CREATED。────
  for (const legSeq of [1, 2]) {
    await waitFor(`${swap.swapNo} leg ${legSeq} created`, async () => {
      const [leg] = await ctx.fundsOrders.findByParent({ swapTransactionId: swap.id }, { legSeq });
      return leg ?? null;
    }, 8000);
    for (let step = 0; step < 8; step++) {
      const [leg] = await ctx.fundsOrders.findByParent({ swapTransactionId: swap.id }, { legSeq });
      if (!leg) throw new Error(`${swap.swapNo} leg ${legSeq} not found`);
      if (leg.status === 'CLEARED' || leg.status === 'CONFIRMED') break;
      const isFiat = ((leg as any).asset?.type || '').toUpperCase() === 'FIAT';
      let action: FundsOrderAction;
      if (isFiat) {
        if (leg.status === 'CREATED') action = FundsOrderAction.SUBMIT;
        else if (leg.status === 'SUBMITTED') action = FundsOrderAction.CONFIRM;
        else throw new Error(`${swap.swapNo} leg ${legSeq} unexpected fiat status ${leg.status}`);
      } else {
        if (leg.status === 'CREATED') action = FundsOrderAction.SUBMIT;
        else if (leg.status === 'SUBMITTED') action = FundsOrderAction.OBSERVE_CONFIRMING;
        else if (leg.status === 'CONFIRMING') action = FundsOrderAction.CONFIRM;
        else throw new Error(`${swap.swapNo} leg ${legSeq} unexpected crypto status ${leg.status}`);
      }
      await ctx.fundsOrders.advance(leg.id, action, 'DEMO');
      await sleep(40);
    }
    await waitFor(`${swap.swapNo} leg ${legSeq} CLEARED`, async () => {
      const [leg] = await ctx.fundsOrders.findByParent({ swapTransactionId: swap.id }, { legSeq });
      return leg?.status === 'CLEARED' ? leg : null;
    }, 8000);
  }

  // ── 3. 拿 leg3（handler 在 leg2 CLEAR 后建成 CREATED），确认非终态、不推它 ────────────────
  const stuck: any = await waitFor(`${swap.swapNo} leg 3 created`, async () => {
    const [leg] = await ctx.fundsOrders.findByParent({ swapTransactionId: swap.id }, { legSeq: 3 });
    return leg ?? null;
  }, 8000);
  if (FundsOrderStatus.CLEARED === stuck.status || SwapWorkflowService_TERMINAL_FAIL.has(stuck.status)) {
    throw new Error(`stuck swap leg ${stuck.fundsOrderNo} unexpectedly terminal (${stuck.status})`);
  }
  const walletRef: string = stuck.fromWalletId; // 卡腿在此钱包上是 OUT（平台 F_ 钱包）
  if (!walletRef) throw new Error(`swap leg3 ${stuck.fundsOrderNo} has no fromWalletId — cannot mirror`);

  // leg3 资产币种：USDT→AED 时 leg3 是 AED（ZAND）；AED→USDT 时 leg3 是 USDT（HEXTRUST）。
  const legAsset: any = (stuck as any).asset;
  const legCurrency: string = legAsset?.currency ?? toAsset.currency;
  const outAmount = new Prisma.Decimal(stuck.netAmount ?? stuck.amount); // swap 腿 amount==netAmount==grossTo

  // ⚠️ 引擎约束（实测踩坑，与在途匹配器口径绑定）：编排器算 inTransitSigned 用
  //   BigInt(line.amount)，要求 line.amount 是**整数字符串**；而在途 Pass3 amountOk 用
  //   line.amount.equals(腿.amount) 认领，要求 line.amount == 腿的主单位金额。两者叠加 →
  //   卡腿主单位金额必须是**整数**，否则 BigInt(小数) 抛错 / Decimal 不等 → 无法认领。
  //   step 0 已按实时汇率把 fromAmount 调到能整出 grossTo，故此处正常恒成立；仅作防御性兜底
  //   （万一 grossTo 计算与 quote.amountOut 口径偏差），炸响而非静默产 BREAK。
  if (!outAmount.equals(outAmount.trunc())) {
    throw new Error(
      `stuck swap leg ${stuck.fundsOrderNo} amount ${outAmount} ${legCurrency} is fractional — ` +
        `recon in-transit matcher needs an integer major-unit amount (BigInt(line.amount)); ` +
        `step 0 should have adjusted fromAmount to avoid this (grossTo vs quote.amountOut drift?).`,
    );
  }

  // ── 4. 外部镜像：该平台钱包上 leg3 是 OUT，走共享 injectStuckExternalMirror（book=FIRM）──
  //   ⚠️ cutoff 耦合（同 createStuckWithdraw，但此处更紧）：statement line datetime = 卡腿创建
  //     时刻（stuck.createdAt），matcher fetchExternalLinesForWallet 过滤 datetime ≤ cutoff，
  //     且 recon 只核 cutoffDate==toBusinessDate(cutoff) 的 ExternalBalance。故调用方传入的 cutoff
  //     必须 ≥ 卡腿创建时刻**且**与之同一业务日。swap 卡腿在推完 leg1/2 之后才由 handler 建成，
  //     创建更晚、时间窗更紧——demo:in-transit / recon:demo 用"当下"cutoff 紧接夹具运行，天然满足。
  const externalRef = `${DEMO_STUCK_SWAP_REF_PREFIX}${swap.swapNo}`;
  await injectStuckExternalMirror(ctx, {
    walletRef,
    direction: 'OUT',
    amount: outAmount,
    currency: legCurrency,
    book: 'FIRM', // 平台 F_ 钱包（F_SET / F_OPS），非客户钱包
    source: sourceFor(legCurrency),
    externalRef,
    dedupKey: externalRef,
    cutoff,
    ownerNo: null, // 平台钱包无 customerNo
    datetime: stuck.createdAt,
    description: 'Demo stuck swap leg — custodian/bank posted the crossing, internal POST pending',
  });

  return {
    swapNo: swap.swapNo,
    stuckLegNo: stuck.fundsOrderNo,
    walletRef,
    externalRef,
    stuckLegId: stuck.id,
  };
}

// swap workflow 的终态失败集合（FAILED/TIMEOUT）——夹具本地判"卡腿不该已终态"用，避免 import 整个
// SwapWorkflowService。与 SwapWorkflowService.TERMINAL_FAIL 同义。
const SwapWorkflowService_TERMINAL_FAIL = new Set<string>([
  FundsOrderStatus.FAILED,
  FundsOrderStatus.TIMEOUT,
]);
