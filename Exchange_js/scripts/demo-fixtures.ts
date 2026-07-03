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

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
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

  // ── 3. 外部镜像：该钱包 ExternalBalance = 内部 POSTED 净额 − 出金额，并插 OUT 行 ──
  // 内部 POSTED 净额由 recon 引擎自己的 balanceChecker 算（结构上与对账口径 0 漂移）。
  //
  // ⚠️ 三个数必须是同一个数（实测确认，对标 recon-demo scenario-1 的 bumpClosing 语义）：
  //   ① ExternalBalance 相对内部的差额（bump）
  //   ② 外部 OUT statement line 的 amount
  //   ③ payout 主腿的 netAmount/amount
  // 因为 recon：delta = external − internal = −bump；inTransitSigned = −(line.amount)；
  //   残差 = delta − inTransitSigned = 0 仅当 bump == line.amount。而在途 Pass3 amountOk
  //   又要求 line.amount == 腿.netAmount/amount 才认领。故三者同值。
  // 出金额用 payout 主腿的 netAmount（= 提现净额 = 毛额 − 手续费；银行实际出给客户的是净额）。
  //
  // ⚠️ 单位一致性（关键，实测踩坑）：funds_orders.amount / statement_lines.amount 存的是
  //   "主单位"整数（如 498），而 account_flows / balanceChecker.delta 是"最小单位"（如 49800）。
  //   scenario-1 的做法是把 bump 当作与 line.amount 同值的裸数直接加减 closing——delta 因此
  //   等于该裸数（bump 抵消掉内部基数的绝对刻度）。故此处 closing = internalPosted − 裸净额
  //   （减 498，不是 49800）；不要按 decimals 放大到最小单位，否则 delta≠inTransitSigned 落 BREAK。
  const balanceChecker = ctx.app.get(WalletBalanceCheckerService);
  const bal = await balanceChecker.checkBalance({ walletRef, externalClosing: 0n, cutoff });
  const internalPosted = bal.internal.total as bigint; // 最小单位整数
  const outAmount = new Prisma.Decimal(stuck.netAmount ?? stuck.amount); // 腿净额（主单位，客户实收）
  const closingMinor = internalPosted - BigInt(outAmount.toFixed(0)); // bump = 裸净额（同 line.amount）

  const source = sourceFor(asset.currency);
  const cutoffDate = ymd(cutoff);
  const book = c.ownerType && c.ownerType !== 'CUSTOMER' ? 'FIRM' : 'CLIENT';
  await ctx.prisma.externalBalance.upsert({
    where: { source_accountRef_cutoffDate: { source, accountRef: walletRef, cutoffDate } },
    update: {
      currency: asset.currency,
      book,
      closingBalance: new Prisma.Decimal(closingMinor.toString()),
      openingBalance: new Prisma.Decimal(0),
      asOfAt: cutoff,
      status: 'INGESTED',
      walletRef,
      ownerNo: c.customerNo,
      lineCount: 1,
    },
    create: {
      source,
      accountRef: walletRef,
      currency: asset.currency,
      book,
      cutoffDate,
      closingBalance: new Prisma.Decimal(closingMinor.toString()),
      openingBalance: new Prisma.Decimal(0),
      asOfAt: cutoff,
      status: 'INGESTED',
      walletRef,
      ownerNo: c.customerNo,
      lineCount: 1,
    },
  });

  // OUT statement line：银行已确认出金。externalRef 仅供追溯——recon 在途匹配对 payout 腿
  // 走子轮B（腿无 txHash/referenceNo），不依赖此 ref 相等。
  const externalRef = `${DEMO_STUCK_WD_REF_PREFIX}${wd.withdrawNo}`;
  await ctx.prisma.externalStatementLine.upsert({
    where: { dedupKey: `${DEMO_STUCK_WD_REF_PREFIX}${wd.withdrawNo}` },
    update: {},
    create: {
      source,
      accountRef: walletRef,
      subAccount: walletRef,
      book,
      currency: asset.currency,
      direction: 'OUT',
      amount: outAmount, // 净出金额（= 腿 netAmount），与在途 Pass3 amountOk 对齐
      externalRef,
      datetime: stuck.createdAt, // 与腿创建时刻对齐（在途 Pass3 子轮B 72h 时窗内）
      // ⚠️ recon fetchExternalLinesForWallet 过滤 datetime ≤ cutoff：调用方传入的 cutoff
      //    必须 ≥ 本腿创建时刻（腿在夹具内部创建，晚于调用方预先捕获的时间）。
      //    demo:in-transit / recon:demo 用"当下"cutoff 天然满足；直跑 recon:rerun 用默认 now-cutoff。
      description: 'Demo stuck withdraw — bank confirmed outflow, internal POST pending',
      dedupKey: `${DEMO_STUCK_WD_REF_PREFIX}${wd.withdrawNo}`,
    },
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
