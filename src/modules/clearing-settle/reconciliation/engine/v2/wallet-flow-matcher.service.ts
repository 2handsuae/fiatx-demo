// src/modules/clearing-settle/reconciliation/engine/v2/wallet-flow-matcher.service.ts
//
// Phase B / T7: per-wallet flow matcher. Pairs the internal source-of-truth
// (account_flows projection, T3) against external statement lines for one
// physical wallet. The engine replaces V8's five-formula identity check
// with a 1:1 evidence comparison.
//
// Match precedence
//   0. 锚配对（戊波二 T9b，spec §4.5）：调账单 / 认损补缺单落账时已经记着「它解释的是哪条内部行 /
//      哪条外部行」，先按锚把它们配成一对或一组，再让剩下的流水走下面三轮。
//      · 有外部行锚：组 = {该调账流水} ∪ {内部行锚（若在本钱包）}，组内签名和 = 外部行 → 一条 MATCHED（resolution = 单号）；
//        不等 → AMOUNT_MISMATCH（内部侧金额 = 组内净额）。
//      · 只有内部行锚：组 = {内部行锚, 该调账流水}；净额 0 → 组内消化（MATCHED，内部对内部，没有外部行）；
//        净额 ≠ 0 → 以净额、净方向、内部行锚的 externalRef 作一条合成内部行，进下面的 Pass 1 / 2。
//      · 锚落在别的钱包上的（改记单的错记方 / 正主方各只认自己这一半）按「没有这个锚」处理。
//   1. externalRef equality (txHash / bank booking id).
//      If amounts also equal → matched via 'ref'.
//      If same ref but amount differs → 'mismatch' (do NOT also count as orphan).
//   2. Fallback: same amount + same direction + |Δt| ≤ timeWindowMinutes.
//      Match in flow-creation order; once consumed, an external line is gone.
//   3. In-transit (Round 3): external lines still orphaned after Pass 1/2
//      are paired against the wallet's non-terminal funds orders (order not
//      yet settled into account_flows, so it has no internal evidence yet).
//      Candidates are sorted by createdAt ascending for determinism, then
//      matched in two sub-passes: (a) externalRef equality against the
//      order's txHash/referenceNo/providerTxnId, (b) amount + direction +
//      72h window fallback when neither side carries a usable ref. This does
//      NOT resolve the external line as evidence-matched — it explains the
//      pending gap so downstream bucket classification can treat it as
//      "explained by an in-flight order" rather than a hard break.
//      Note: in sub-pass (a), a ref hit whose amount does NOT match is
//      intentionally not reported as 'mismatch' — an unsettled order is a
//      pending intent, not hard ledger evidence, so unlike Pass 1 the line
//      simply stays in orphanExternal. This semantic difference from Pass 1's
//      mismatch bucket is deliberate.
//
// Inclusion filter (戊波一 T11 —— 与 WalletBalanceCheckerService 读的是同一个现金户，
// 区别只有一条：余额计入调账行，匹配不计):
//   (a) 只取这个钱包的现金户（cashTbAccountId）上 POSTED、≤ cutoff 的行——现金户上的
//       每一行都是托管方会在对账单上看到的；账本内部的应付 / 暂挂重分类不在现金户上，
//       天然不进来，不再需要"跨外部"标记，也不再按注册表码集过滤。
//   (b) 调账流水（sourceType = 'RECON_ADJUSTMENT'）只有在两个锚至少有一个时才进池，交给第 0 轮按锚配对；
//       **两锚皆空的调账流水不参与匹配、只进余额**（spec 裁定 16：外部对账单上没有对应的行，放进来会被
//       金额+方向+时窗误配到同额外部行上，或者显示成"只有内部"的孤儿）。原来「sourceType 整体排除」的做法退役
//       （裁定 8）：认损补缺的记短缺分录 sourceType 是 INTERNAL_TRANSFER，整体排除罩不住它。
//
// Returns five disjoint buckets:
//   - matched          (internalFlowId, externalLineId, via；via='anchor' 另带 resolution / groupFlowIds，
//                        externalLineId 可为 null = 组内消化)
//   - orphanInternal   (internal evidence with no external line)
//   - orphanExternal   (external line with no internal evidence, and no
//                        non-terminal funds order explains it either)
//   - mismatch         (same ref, different amount — wallet shows a real break)
//   - inTransit        (external line explained by a non-terminal funds
//                        order — Pass 3, see above)

import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../../core/prisma/prisma.service';
import { FundsOrderService } from '../../../../funds-orders/funds-order.service';
import { RECON_ADJUSTMENT_SOURCE_TYPE } from '../../disposition/adjustment-rules';
import { effectiveCutoffFilter } from './effective-cutoff';

export interface ExternalStatementLineInput {
  id: string;
  direction: 'IN' | 'OUT' | string;
  amount: Prisma.Decimal;
  externalRef: string | null;
  datetime: Date;
}

/**
 * 一条「已落账的解释」：调账单 / 认损补缺单落在本钱包现金户上的那条流水（flowId），
 * 连同它记着的两个锚（真实证据 id：内部流水 / 对账单行）与单号（byNo = ADJ… / ITR…）。
 * 由 ExplainedDifferenceService.indexForWallet 供。
 */
export interface ExplainedAnchor {
  flowId: string;
  anchorFlowId?: string;
  anchorExternalLineId?: string;
  byNo: string;
}

export interface MatcherInput {
  walletRef: string;                             // Pass 3 按钱包找在途资金单
  /** 该钱包现金户的 32 位户号（WalletBalanceCheckerService.resolveCashAccount）；
   *  null = walletRef 不是钱包（未归属外部账户），没有内部侧，外部行全部留作孤儿。 */
  cashTbAccountId: string | null;
  externalLines: ExternalStatementLineInput[];   // pre-filtered to this wallet by caller
  /** 第 0 轮的输入；没有已落账解释的钱包传 []。 */
  explainedAnchors: ExplainedAnchor[];
  cutoff: Date;
  decimals: number;                              // asset.decimals — 元→分 换算，在途金额产出为分
  timeWindowMinutes?: number;                    // default 60
}

interface MatchedPair {
  /** 主行：第 0 轮配出的组取内部行锚（原差异行），没有内部行锚取调账 / 记短缺流水本身。 */
  internalFlowId: string;
  /** null = 第 0 轮组内消化（内部对内部，没有外部行）。 */
  externalLineId: string | null;
  via: 'ref' | 'fuzzy' | 'anchor';
  /** 仅 via = 'anchor'：解释这一组的调账单 / 认损补缺单号。 */
  resolution?: string;
  /** 仅 via = 'anchor'：这一组吃掉的全部内部流水 id（含 internalFlowId 本身）。 */
  groupFlowIds?: string[];
}

interface OrphanInternal {
  internalFlowId: string;
  eventCode: string;
  amount: string;
  direction: 'IN' | 'OUT';
  externalRef: string | null;
}

interface OrphanExternal {
  externalLineId: string;
  amount: string;
  direction: 'IN' | 'OUT';
  externalRef: string | null;
}

interface AmountMismatch {
  internalFlowId: string;
  externalLineId: string;
  internalAmount: string;
  externalAmount: string;
  ref: string;
}

interface InTransitMatch {
  externalLineId: string;
  fundsOrderId: string;
  fundsOrderNo: string;
  orderStatus: string;
  amount: string;
  direction: 'IN' | 'OUT';
  externalRef: string | null;
  externalTimestamp: Date;
}

interface MatcherResult {
  matched: MatchedPair[];
  orphanInternal: OrphanInternal[];
  orphanExternal: OrphanExternal[];
  mismatch: AmountMismatch[];
  inTransit: InTransitMatch[];
}

interface InternalFlowRow {
  id: string;
  direction: string;
  amount: Prisma.Decimal;
  externalRef: string | null;
  eventCode: string;
  createdAt: Date;
}

/**
 * 对账内部侧的取数条件（匹配器与案件页逐行对照共用这一份，几处口径不许各管各的）：
 * 现金户上 POSTED、过截止点，且「非（调账流水 ∧ 两锚皆空）」。
 * 没有锚的调账流水不进池（只进余额）；有锚的调账流水进池，由第 0 轮配对。
 */
export function internalFlowWhere(
  cashTbAccountId: string,
  cutoff: Date,
  explainedAnchors: ExplainedAnchor[],
): Prisma.AccountFlowWhereInput {
  const anchoredFlowIds = explainedAnchors
    .filter((a) => a.anchorFlowId || a.anchorExternalLineId)
    .map((a) => a.flowId);
  return {
    tbAccountId: cashTbAccountId,
    transferType: 'POSTED',
    AND: [
      effectiveCutoffFilter(cutoff),
      { OR: [{ sourceType: { not: RECON_ADJUSTMENT_SOURCE_TYPE } }, { id: { in: anchoredFlowIds } }] },
    ],
  };
}

@Injectable()
export class WalletFlowMatcherService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fundsOrders: FundsOrderService,
  ) {}

  async matchFlows(input: MatcherInput): Promise<MatcherResult> {
    const { walletRef, cashTbAccountId, externalLines, explainedAnchors, cutoff, decimals } = input;
    const windowMs = (input.timeWindowMinutes ?? 60) * 60 * 1000;

    // Canonical-minor boundary (T1). The balance checker operates in minor
    // units (分, from account_flows + closing). external_statement_lines are
    // ALREADY in 分 (contract; the writer emits minor units) — they arrive as a
    // Prisma.Decimal whose value is the integer 分, so take it straight, no
    // scaling. funds_orders still store MAJOR units (元) this round, so ONLY the
    // funds-order side needs 元→分 before it can be compared to a minor external
    // line or to balanceCheck.delta. Prisma.Decimal (never JS float) — money
    // precision; decimals comes from the caller (ultimately asset.decimals),
    // never hardcoded.
    // extMinor: external line is already 分 → integer BigInt, no ×10^decimals.
    const extMinor = (d: Prisma.Decimal): bigint => BigInt(d.toFixed(0));
    // toMinor: funds-order 元 → 分 (×10^decimals). Applied to c.netAmount /
    // c.amount ONLY — never to an external line.
    const toMinor = (d: Prisma.Decimal): bigint =>
      BigInt(d.mul(new Prisma.Decimal(10).pow(decimals)).toFixed(0));

    // 内部侧 = 钱包现金户上的行（POSTED；PENDING 还没上任何对账单）；两锚皆空的调账流水不进池（internalFlowWhere）。
    const fetched: InternalFlowRow[] = cashTbAccountId
      ? ((await this.prisma.accountFlow.findMany({
          where: internalFlowWhere(cashTbAccountId, cutoff, explainedAnchors),
          select: {
            id: true,
            direction: true,
            amount: true,
            externalRef: true,
            eventCode: true,
            createdAt: true,
          },
        })) as InternalFlowRow[])
      : [];

    const matched: MatchedPair[] = [];
    const mismatch: AmountMismatch[] = [];

    // Track which sides have been resolved (matched OR mismatch).
    const usedInternal = new Set<string>();
    const usedExternal = new Set<string>();

    // ── Pass 0: 锚配对（spec §4.5）──────────────────────────────────────────
    // 内部 / 外部金额都是分（见上），签名和 = IN 为正、OUT 为负。
    const signed = (direction: string, amount: Prisma.Decimal): bigint =>
      direction === 'IN' ? BigInt(amount.toFixed(0)) : -BigInt(amount.toFixed(0));
    const absOf = (v: bigint): bigint => (v < 0n ? -v : v);
    const flowById = new Map(fetched.map((f) => [f.id, f]));
    const extById = new Map(externalLines.map((e) => [e.id, e]));
    const consumed = new Set<string>();                    // 被第 0 轮吃掉的内部流水（不再出现在任何一桶）
    const netted = new Map<string, InternalFlowRow>();     // 内部行锚 id → 净额 ≠ 0 的合成行（替换原行进 Pass 1 / 2）
    for (const a of explainedAnchors) {
      const adj = flowById.get(a.flowId);
      if (!adj || consumed.has(adj.id)) continue;
      // 锚落在别的钱包上（或已被别的锚用掉）就按「没有这个锚」处理：改记单两个钱包各认自己那一半。
      const anchorFlow = a.anchorFlowId && a.anchorFlowId !== adj.id && !consumed.has(a.anchorFlowId)
        ? flowById.get(a.anchorFlowId)
        : undefined;
      const anchorExt = a.anchorExternalLineId && !usedExternal.has(a.anchorExternalLineId)
        ? extById.get(a.anchorExternalLineId)
        : undefined;
      const group = anchorFlow ? [anchorFlow, adj] : [adj];
      const net = group.reduce((s, f) => s + signed(f.direction, f.amount), 0n);
      const primary = anchorFlow ?? adj;
      if (anchorExt) {
        group.forEach((f) => consumed.add(f.id));
        usedExternal.add(anchorExt.id);
        if (net === signed(anchorExt.direction, anchorExt.amount)) {
          matched.push({
            internalFlowId: primary.id, externalLineId: anchorExt.id, via: 'anchor',
            resolution: a.byNo, groupFlowIds: group.map((f) => f.id),
          });
        } else {
          mismatch.push({
            internalFlowId: primary.id, externalLineId: anchorExt.id,
            internalAmount: absOf(net).toString(), externalAmount: anchorExt.amount.toString(),
            ref: anchorExt.externalRef ?? '',
          });
        }
      } else if (anchorFlow) {
        consumed.add(adj.id);
        if (net === 0n) {
          consumed.add(anchorFlow.id);
          matched.push({
            internalFlowId: anchorFlow.id, externalLineId: null, via: 'anchor',
            resolution: a.byNo, groupFlowIds: [anchorFlow.id, adj.id],
          });
        } else {
          netted.set(anchorFlow.id, {
            ...anchorFlow, direction: net > 0n ? 'IN' : 'OUT', amount: new Prisma.Decimal(absOf(net).toString()),
          });
        }
      }
      // 两个锚在本钱包都落空：这条流水留在池里，照常走后面的轮次。
    }
    const internal: InternalFlowRow[] = fetched
      .filter((f) => !consumed.has(f.id))
      .map((f) => netted.get(f.id) ?? f);

    // ── Pass 1: ref-equality match ──────────────────────────────────────────
    // Scale note (T1): external_statement_lines and account_flows are BOTH in
    // 分 (external-line contract = minor; account_flow.amount = minor). So
    // Pass 1/2 compare 分 vs 分 directly — NO 元→分 conversion here. Only Pass 3
    // (external 分 vs funds_order 元) converts, and only the funds_order side.
    // Group external lines by ref for O(1) lookup; only non-null refs.
    const externalByRef = new Map<string, ExternalStatementLineInput[]>();
    for (const ext of externalLines) {
      if (!ext.externalRef) continue;
      const arr = externalByRef.get(ext.externalRef) ?? [];
      arr.push(ext);
      externalByRef.set(ext.externalRef, arr);
    }
    for (const intl of internal) {
      if (!intl.externalRef) continue;
      const candidates = externalByRef.get(intl.externalRef);
      if (!candidates || candidates.length === 0) continue;
      // Pick first candidate not yet consumed and direction-compatible.
      const idx = candidates.findIndex(
        (c) => !usedExternal.has(c.id) && c.direction === intl.direction,
      );
      if (idx === -1) continue;
      const ext = candidates[idx];
      const intAmt = intl.amount.toString();
      const extAmt = ext.amount.toString();
      if (intl.amount.equals(ext.amount)) {
        matched.push({ internalFlowId: intl.id, externalLineId: ext.id, via: 'ref' });
      } else {
        mismatch.push({
          internalFlowId: intl.id,
          externalLineId: ext.id,
          internalAmount: intAmt,
          externalAmount: extAmt,
          ref: intl.externalRef,
        });
      }
      usedInternal.add(intl.id);
      usedExternal.add(ext.id);
    }

    // ── Pass 2: fuzzy (amount + direction + time window) ────────────────────
    for (const intl of internal) {
      if (usedInternal.has(intl.id)) continue;
      const intMs = intl.createdAt.getTime();
      for (const ext of externalLines) {
        if (usedExternal.has(ext.id)) continue;
        if (ext.direction !== intl.direction) continue;
        if (!intl.amount.equals(ext.amount)) continue;
        const dt = Math.abs(ext.datetime.getTime() - intMs);
        if (dt > windowMs) continue;
        matched.push({ internalFlowId: intl.id, externalLineId: ext.id, via: 'fuzzy' });
        usedInternal.add(intl.id);
        usedExternal.add(ext.id);
        break;
      }
    }

    // ── Pass 3: 在途匹配（剩余孤儿外部行 ↔ 非终态资金单）──────────────
    const inTransit: InTransitMatch[] = [];
    const leftovers = externalLines.filter((e) => !usedExternal.has(e.id));
    if (leftovers.length > 0) {
      const candidates = (await this.fundsOrders.findNonTerminalByWallet(walletRef))
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
      const usedOrders = new Set<string>();
      const H72 = 72 * 60 * 60 * 1000;
      const refsOf = (c: (typeof candidates)[number]) => [c.txHash, c.referenceNo, c.providerTxnId].filter(Boolean);
      // ext 已是分(extMinor 直取整)，只有 funds_order 元→分(toMinor)。
      const amountOk = (ext: ExternalStatementLineInput, c: (typeof candidates)[number]) =>
        extMinor(ext.amount) === toMinor(c.netAmount) || extMinor(ext.amount) === toMinor(c.amount);
      const take = (ext: ExternalStatementLineInput, c: (typeof candidates)[number]) => {
        usedOrders.add(c.id); usedExternal.add(ext.id);
        inTransit.push({ externalLineId: ext.id, fundsOrderId: c.id, fundsOrderNo: c.fundsOrderNo,
          orderStatus: c.status, amount: extMinor(ext.amount).toString(),
          direction: ext.direction as 'IN' | 'OUT', externalRef: ext.externalRef,
          externalTimestamp: ext.datetime });
      };
      // 子轮 A：单号精确
      for (const ext of leftovers) {
        if (usedExternal.has(ext.id) || !ext.externalRef) continue;
        const hit = candidates.find((c) => !usedOrders.has(c.id) && c.direction === ext.direction
          && refsOf(c).includes(ext.externalRef!) && amountOk(ext, c));
        if (hit) take(ext, hit);
      }
      // 子轮 B：双方无单号可对时的金额+方向+时窗兜底
      for (const ext of leftovers) {
        if (usedExternal.has(ext.id)) continue;
        const hit = candidates.find((c) => !usedOrders.has(c.id) && c.direction === ext.direction
          && amountOk(ext, c)
          && Math.abs(ext.datetime.getTime() - c.createdAt.getTime()) <= H72
          && (ext.externalRef == null || refsOf(c).length === 0));
        if (hit) take(ext, hit);
      }
    }

    // ── Orphans ─────────────────────────────────────────────────────────────
    const orphanInternal: OrphanInternal[] = internal
      .filter((f) => !usedInternal.has(f.id))
      .map((f) => ({
        internalFlowId: f.id,
        eventCode: f.eventCode,
        amount: f.amount.toString(),
        direction: f.direction as 'IN' | 'OUT',
        externalRef: f.externalRef,
      }));
    const orphanExternal: OrphanExternal[] = externalLines
      .filter((e) => !usedExternal.has(e.id))
      .map((e) => ({
        externalLineId: e.id,
        amount: e.amount.toString(),
        direction: e.direction as 'IN' | 'OUT',
        externalRef: e.externalRef,
      }));

    return { matched, orphanInternal, orphanExternal, mismatch, inTransit };
  }
}
