import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AMOUNT_TOLERANCE } from '../constants/reconciliation.constants';
import { MatchV2Result, MatchedPair, AmbiguousMatch } from './match-engine-v2.service';
import { InternalLeg } from './leg-projection.service';
import { ExternalLine } from './match-engine-v2.service';

export type AnomalyBucket =
  | 'PASS'
  | 'AMOUNT_MISMATCH'
  | 'ORPHAN_INTERNAL'
  | 'ORPHAN_EXTERNAL'
  | 'MANUAL';

/**
 * 定性（spec §4.3 第二列）：
 * - AMOUNT_DIFF    金额不符（银行扣费/部分到账/汇率差）
 * - TERMINAL_BREAK 内部终态有、外部无（记了没发生 → 真 break；投影只取终态故必为此）
 * - ORPHAN_DEPOSIT 外部有内部无（孤儿入金/漏记）
 * - BANK_FEE       外部独有 OUT（银行 per-tx 费没记）
 * - RETURN         退汇（description=Return），channel_ref 关联回原出金
 * - AMBIGUOUS      模糊回退多候选，挂人工
 */
export type AnomalyQualifier =
  | 'NONE'
  | 'AMOUNT_DIFF'
  | 'TERMINAL_BREAK'
  | 'ORPHAN_DEPOSIT'
  | 'BANK_FEE'
  | 'RETURN'
  | 'AMBIGUOUS'
  | 'INTERNAL_BOOK_LEG'; // 内部转账的账内对手腿（无外部镜像，非 break，不计闭合）

export interface ClassifiedLineItem {
  bucket: AnomalyBucket;
  qualifier: AnomalyQualifier;
  currency: string;
  /** 账本（CLIENT/FIRM）：matched/orphan-external 取外部行 book；orphan-internal/ambiguous 取内部腿 book。按 book 拆 case。 */
  book: string;
  /** 对 (内部 − 外部) 的符号化贡献：ORPHAN_INTERNAL +amt，ORPHAN_EXTERNAL −amt，AMOUNT_MISMATCH (i−e)，PASS 0。 */
  signedDelta: Prisma.Decimal;
  // 内部侧（下钻定位）
  internalSource?: InternalLeg['source'];
  internalSourceId?: string;
  internalSourceNo?: string;
  internalAccount?: string;
  internalSubAccount?: string | null;
  internalAmount?: Prisma.Decimal;
  internalDirection?: string;
  // 外部侧（下钻定位）
  externalId?: string;
  externalSource?: string;
  externalAccountRef?: string;
  externalSubAccount?: string | null;
  externalAmount?: Prisma.Decimal;
  externalDirection?: string;
  externalRef?: string | null;
  channelRef?: string | null; // 退汇关联键
  externalDescription?: string | null;
  // MANUAL 专用
  candidateCount?: number;
}

export interface ClassifierSummary {
  pass: number;
  amountMismatch: number;
  orphanInternal: number;
  orphanExternal: number;
  manual: number;
}

export interface ClassifyResult {
  pass: ClassifiedLineItem[];
  amountMismatch: ClassifiedLineItem[];
  orphanInternal: ClassifiedLineItem[];
  orphanExternal: ClassifiedLineItem[];
  manual: ClassifiedLineItem[];
  /** 内部转账账内对手腿（非 break，不计闭合；保留以便下钻透明）。 */
  internalBookLeg: ClassifiedLineItem[];
  summary: ClassifierSummary;
}

/**
 * 四异常桶 + 定性。spec 2026-06-20 §4.3。
 *   i有 e有 金额等 → ✓ PASS
 *   i有 e有 金额异 → ⚠ AMOUNT_MISMATCH（银行扣费/部分到账/汇率差）
 *   i有 e无       → ⚠ ORPHAN_INTERNAL（投影只取终态 → 真 break）
 *   i无 e有       → ⚠ ORPHAN_EXTERNAL（银行费没记/孤儿入金/漏记）
 *   退汇(Return)  → channel_ref 关联回原出金
 * 纯函数。
 */
@Injectable()
export class AnomalyClassifierService {
  private readonly tol = new Prisma.Decimal(AMOUNT_TOLERANCE);

  classify(m: MatchV2Result): ClassifyResult {
    const out: ClassifyResult = {
      pass: [], amountMismatch: [], orphanInternal: [], orphanExternal: [], manual: [], internalBookLeg: [],
      summary: { pass: 0, amountMismatch: 0, orphanInternal: 0, orphanExternal: 0, manual: 0 },
    };

    // internal_fund 已有任一腿配上外部 → 该 fund 的另一腿是账内对手腿（无外部镜像），非 break。
    const matchedFundIds = new Set(
      m.matched.filter((p) => p.internal.source === 'INTERNALFUND').map((p) => p.internal.sourceId),
    );

    // 桶1/2：matched pair → 金额比对
    for (const pair of m.matched) {
      const item = this.fromMatched(pair);
      if (item.bucket === 'PASS') out.pass.push(item);
      else out.amountMismatch.push(item);
    }
    // 桶3：orphan internal（终态 break）；internal_fund 账内对手腿单列。
    for (const il of m.orphanInternal) {
      if (il.source === 'INTERNALFUND' && matchedFundIds.has(il.sourceId)) {
        out.internalBookLeg.push(this.fromInternalBookLeg(il));
      } else {
        out.orphanInternal.push(this.fromOrphanInternal(il));
      }
    }
    // 桶4：orphan external（含退汇定性）
    for (const e of m.orphanExternal) out.orphanExternal.push(this.fromOrphanExternal(e));
    // 模糊多候选 → 人工
    for (const a of m.ambiguous) out.manual.push(this.fromAmbiguous(a));

    out.summary = {
      pass: out.pass.length,
      amountMismatch: out.amountMismatch.length,
      orphanInternal: out.orphanInternal.length,
      orphanExternal: out.orphanExternal.length,
      manual: out.manual.length,
    };
    return out;
  }

  private fromMatched(pair: MatchedPair): ClassifiedLineItem {
    const { internal: il, external: e } = pair;
    const delta = new Prisma.Decimal(il.amount).minus(e.amount);
    const isMismatch = delta.abs().greaterThan(this.tol);
    return {
      bucket: isMismatch ? 'AMOUNT_MISMATCH' : 'PASS',
      qualifier: isMismatch ? 'AMOUNT_DIFF' : 'NONE',
      currency: il.currency,
      book: e.book, // matched pair：外部行 book 权威（内部腿 book 应一致）
      signedDelta: isMismatch ? delta : new Prisma.Decimal(0),
      internalSource: il.source, internalSourceId: il.sourceId, internalSourceNo: il.sourceNo,
      internalAccount: il.account, internalSubAccount: il.subAccount,
      internalAmount: new Prisma.Decimal(il.amount), internalDirection: il.direction,
      externalId: e.id, externalSource: e.source, externalAccountRef: e.accountRef, externalSubAccount: e.subAccount,
      externalAmount: new Prisma.Decimal(e.amount), externalDirection: e.direction, externalRef: e.externalRef,
      channelRef: e.channelRef, externalDescription: e.description,
    };
  }

  private fromOrphanInternal(il: InternalLeg): ClassifiedLineItem {
    // 投影只取终态（§4.1）→ 内部有外部无必为真 break（记了没发生）。
    return {
      bucket: 'ORPHAN_INTERNAL',
      qualifier: 'TERMINAL_BREAK',
      currency: il.currency,
      book: il.book, // 内部有外部无 → 取内部腿 book
      signedDelta: new Prisma.Decimal(il.amount), // 内部多 → +amt
      internalSource: il.source, internalSourceId: il.sourceId, internalSourceNo: il.sourceNo,
      internalAccount: il.account, internalSubAccount: il.subAccount,
      internalAmount: new Prisma.Decimal(il.amount), internalDirection: il.direction,
      externalRef: il.externalRef,
    };
  }

  /** 内部转账的账内对手腿：无外部镜像，非 break，闭合贡献 0（与生成器"funds 0 闭合影响"一致）。 */
  private fromInternalBookLeg(il: InternalLeg): ClassifiedLineItem {
    return {
      bucket: 'ORPHAN_INTERNAL',
      qualifier: 'INTERNAL_BOOK_LEG',
      currency: il.currency,
      book: il.book, // 账内对手腿 → 取内部腿 book
      signedDelta: new Prisma.Decimal(0),
      internalSource: il.source, internalSourceId: il.sourceId, internalSourceNo: il.sourceNo,
      internalAccount: il.account, internalSubAccount: il.subAccount,
      internalAmount: new Prisma.Decimal(il.amount), internalDirection: il.direction,
      externalRef: il.externalRef,
    };
  }

  private fromOrphanExternal(e: ExternalLine): ClassifiedLineItem {
    return {
      bucket: 'ORPHAN_EXTERNAL',
      qualifier: this.qualifyOrphanExternal(e),
      currency: e.currency,
      book: e.book, // 外部有内部无 → 取外部行 book
      signedDelta: new Prisma.Decimal(e.amount).negated(), // 外部多 → −amt
      externalId: e.id, externalSource: e.source, externalAccountRef: e.accountRef, externalSubAccount: e.subAccount,
      externalAmount: new Prisma.Decimal(e.amount), externalDirection: e.direction, externalRef: e.externalRef,
      channelRef: e.channelRef, externalDescription: e.description,
    };
  }

  /** 外部独有定性：Return→退汇（channel_ref 回链）；OUT→银行费；其余→孤儿入金/漏记。 */
  private qualifyOrphanExternal(e: ExternalLine): AnomalyQualifier {
    if ((e.description ?? '').toLowerCase().includes('return')) return 'RETURN';
    if (e.direction === 'OUT') return 'BANK_FEE';
    return 'ORPHAN_DEPOSIT';
  }

  private fromAmbiguous(a: AmbiguousMatch): ClassifiedLineItem {
    return {
      bucket: 'MANUAL',
      qualifier: 'AMBIGUOUS',
      currency: a.internal.currency,
      book: a.internal.book, // 模糊回退 → 取内部腿 book
      signedDelta: new Prisma.Decimal(0), // 未定，人工裁决前不计入闭合
      internalSource: a.internal.source, internalSourceId: a.internal.sourceId, internalSourceNo: a.internal.sourceNo,
      internalAccount: a.internal.account, internalSubAccount: a.internal.subAccount,
      internalAmount: new Prisma.Decimal(a.internal.amount), internalDirection: a.internal.direction,
      candidateCount: a.candidates.length,
    };
  }
}
