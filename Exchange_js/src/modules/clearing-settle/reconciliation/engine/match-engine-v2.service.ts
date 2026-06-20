import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { InternalLeg, isFiat } from './leg-projection.service';

/**
 * 归一化外部对账单行（external_statement_lines 的匹配相关投影）。spec §2.2。
 */
export interface ExternalLine {
  id: string;
  source: string;
  accountRef: string;
  subAccount: string | null;
  book: string;
  currency: string;
  direction: 'IN' | 'OUT' | string;
  amount: Prisma.Decimal;
  externalRef: string | null;
  channelRef: string | null;
  datetime: Date;
  description: string | null;
}

export type MatchType = 'PRIMARY' | 'FALLBACK';

export interface MatchedPair {
  internal: InternalLeg;
  external: ExternalLine;
  matchType: MatchType;
}

/** 模糊回退命中多个外部候选 → 不自动配，挂人工。 */
export interface AmbiguousMatch {
  internal: InternalLeg;
  candidates: ExternalLine[];
}

export interface MatchV2Result {
  matched: MatchedPair[];
  orphanInternal: InternalLeg[];
  orphanExternal: ExternalLine[];
  ambiguous: AmbiguousMatch[];
}

export interface MatchV2Options {
  /** fallback 模糊配的时间窗口（毫秒），默认 ±48h。 */
  fallbackWindowMs?: number;
}

const DEFAULT_FALLBACK_WINDOW_MS = 48 * 3600_000;

/**
 * 下钻匹配引擎 v2。spec 2026-06-20 §4.2。
 *
 * 主匹配（有 external_ref）：(direction, currency, external_ref) —— **不含金额**（红线，§0 principle 6）。
 *   external_ref(txHash/银行回显号) 全局唯一 → 不把 account 入硬键（crypto 外部 account_ref 是合成池标签，
 *   投影不可复现；金额配上后才比，金额不符留作一条 matched pair 给定性，绝不裂成两条孤儿）。
 * 回退匹配（无 external_ref，主要法币入金）：(sub_account/VIBAN, direction, currency, amount, datetime±窗口)，
 *   贪心 1:1；命中多候选 → ambiguous 挂人工。
 * 纯函数（不碰 DB）。
 */
@Injectable()
export class MatchEngineV2Service {
  match(internal: InternalLeg[], external: ExternalLine[], opts: MatchV2Options = {}): MatchV2Result {
    const windowMs = opts.fallbackWindowMs ?? DEFAULT_FALLBACK_WINDOW_MS;
    const res: MatchV2Result = { matched: [], orphanInternal: [], orphanExternal: [], ambiguous: [] };

    const usedExt = new Set<string>();
    const usedInt = new Set<number>();

    // ── ① 主匹配：external_ref 判别（贪心 1:1）。仅两侧 ref 均非空时参与。 ──
    for (let idx = 0; idx < internal.length; idx++) {
      const il = internal[idx];
      if (!il.externalRef) continue;
      const ex = external.find(
        (e) =>
          !usedExt.has(e.id) &&
          !!e.externalRef &&
          e.externalRef === il.externalRef &&
          e.direction === il.direction &&
          e.currency === il.currency,
      );
      if (!ex) continue;
      usedExt.add(ex.id);
      usedInt.add(idx);
      res.matched.push({ internal: il, external: ex, matchType: 'PRIMARY' });
    }

    // ── ② 回退匹配（法币入金 VIBAN 级）：无 external_ref 的 Payin 入金腿。 ──
    // 模糊键 = (sub_account/VIBAN, direction, currency, datetime±窗口)，**金额不入键**（红线 §0 principle 6：
    // 金额入键会把"金额不符"裂成两条孤儿）。金额仅在多候选时用来消歧；唯一候选直接配上，金额留给定性比对。
    // 仅非 INTERNALFUND 腿走 VIBAN 级（internal_fund 是 intra-CMA 池化转账，VIBAN 不对齐 → 走 ③ 账户级）。
    for (let idx = 0; idx < internal.length; idx++) {
      if (usedInt.has(idx)) continue;
      const il = internal[idx];
      if (il.externalRef) continue; // 有 ref 但没配上 → 留给 orphan（不降级模糊配，避免错配）
      if (il.source === 'INTERNALFUND') continue; // 池化转账留给 ③
      const cands = external.filter(
        (e) =>
          !usedExt.has(e.id) &&
          !e.externalRef && // 仅在两侧都无 ref 时模糊配
          (e.subAccount ?? null) === (il.subAccount ?? null) &&
          e.direction === il.direction &&
          e.currency === il.currency &&
          Math.abs(e.datetime.getTime() - il.datetime.getTime()) <= windowMs,
      );
      this.consumeFallbackCandidates(res, usedExt, usedInt, idx, il, cands);
    }

    // ── ③ 回退匹配（internal_fund 结算转账 账户级，等额贪心 1:1）：剩余法币 INTERNALFUND 腿。 ──
    // 法币 internal_fund 是 intra-CMA 池化转账：银行只在 CMA 主账户记账（sub_account=池化占位，无回显 ref），
    // 客户 VIBAN 不对齐。在 ② 之后跑（VIBAN 级专属入金已消耗），剩余 CMA 行即结算转账行。
    // 池化层无 ref/无 VIBAN，金额是唯一可用判别 → 等额 first-fit 配对（这些是 0 闭合的内部账内转账，非"金额不符"
    // 易裂 break；principle 6 的"金额不入键"针对易裂 break 的 VIBAN/ref 层，已在 ① ② 严守）。
    // 同额可互换的池化转账：任配一条等额行即可（语义等价）。
    for (let idx = 0; idx < internal.length; idx++) {
      if (usedInt.has(idx)) continue;
      const il = internal[idx];
      if (il.source !== 'INTERNALFUND') continue;
      if (!isFiat(il.currency)) continue; // 仅法币 intra-CMA 池化；crypto fund 已在 ① 经 txHash 配
      const hit = external.find(
        (e) =>
          !usedExt.has(e.id) &&
          e.accountRef === il.account && // 账户级（CMA==CMA），不看 sub_account
          e.direction === il.direction &&
          e.currency === il.currency &&
          new Prisma.Decimal(e.amount).equals(il.amount) && // 池化层等额配对
          Math.abs(e.datetime.getTime() - il.datetime.getTime()) <= windowMs,
      );
      if (hit) {
        usedExt.add(hit.id);
        usedInt.add(idx);
        res.matched.push({ internal: il, external: hit, matchType: 'FALLBACK' });
      }
      // 无等额行 → 留 orphanInternal（真 break）/ OUT 腿 → 由 classifier 认作 book-leg
    }

    // ── ④ 收口 orphan ──
    for (let idx = 0; idx < internal.length; idx++) {
      if (!usedInt.has(idx)) res.orphanInternal.push(internal[idx]);
    }
    for (const e of external) {
      if (!usedExt.has(e.id)) res.orphanExternal.push(e);
    }

    return res;
  }

  /**
   * 回退候选消化（贪心 1:1）：唯一候选直接配上（金额留给定性比对）；多候选先用金额精确消歧；仍不唯一 → 挂人工。
   * 0 候选 → 不消耗（留作 orphanInternal）。
   */
  private consumeFallbackCandidates(
    res: MatchV2Result,
    usedExt: Set<string>,
    usedInt: Set<number>,
    idx: number,
    il: InternalLeg,
    cands: ExternalLine[],
  ): void {
    if (cands.length === 1) {
      usedExt.add(cands[0].id);
      usedInt.add(idx);
      res.matched.push({ internal: il, external: cands[0], matchType: 'FALLBACK' });
    } else if (cands.length > 1) {
      const exact = cands.filter((c) => new Prisma.Decimal(c.amount).equals(il.amount));
      if (exact.length === 1) {
        usedExt.add(exact[0].id);
        usedInt.add(idx);
        res.matched.push({ internal: il, external: exact[0], matchType: 'FALLBACK' });
      } else {
        usedInt.add(idx);
        for (const c of cands) usedExt.add(c.id);
        res.ambiguous.push({ internal: il, candidates: cands });
      }
    }
  }
}
