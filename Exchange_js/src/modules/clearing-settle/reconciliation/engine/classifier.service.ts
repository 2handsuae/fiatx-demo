import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { MatchResult } from './match-engine.service';

export interface LineItemDraft {
  matchStatus: 'ORPHAN_INTERNAL' | 'ORPHAN_EXTERNAL' | 'AMOUNT_MISMATCH';
  internalSourceType?: string; internalSourceId?: string; internalSourceNo?: string;
  internalAmount?: Prisma.Decimal; internalDirection?: string; internalTxHash?: string | null;
  externalSource?: string; externalTxId?: string; externalTxHash?: string | null;
  externalAmount?: Prisma.Decimal; externalDirection?: string; externalTimestamp?: Date;
  signedDelta: Prisma.Decimal; // 对 (TB − 外部) 的贡献
}

/** unmatched → LineItemDraft；signedDelta 用于闭合自检 Σ = I5 delta。 */
@Injectable()
export class ClassifierService {
  // 符号约定：signedDelta 表示对 (TB − 外部) 的贡献，假设 IN 为正、OUT 为负，
  // 调用方（workflow）须保证传入 amount 已按方向带符号 / 或仅传 IN 流（MVP）。
  classify(m: MatchResult): LineItemDraft[] {
    const out: LineItemDraft[] = [];
    // ORPHAN_INTERNAL：内部有外部无 → TB 比外部多 → +amount（IN）/ 视方向
    for (const ia of m.orphanInternal) {
      out.push({
        matchStatus: 'ORPHAN_INTERNAL',
        internalSourceType: ia.sourceType, internalSourceId: ia.sourceId, internalSourceNo: ia.sourceNo,
        internalAmount: new Prisma.Decimal(ia.amount), internalDirection: ia.direction, internalTxHash: ia.txHash,
        signedDelta: new Prisma.Decimal(ia.amount),
      });
    }
    // ORPHAN_EXTERNAL：外部有内部无 → TB 比外部少 → −amount
    for (const e of m.orphanExternal) {
      out.push({
        matchStatus: 'ORPHAN_EXTERNAL',
        externalSource: e.source, externalTxId: e.txId, externalTxHash: e.txHash,
        externalAmount: new Prisma.Decimal(e.amount), externalDirection: e.direction, externalTimestamp: e.timestamp,
        signedDelta: new Prisma.Decimal(e.amount).negated(),
      });
    }
    // AMOUNT_MISMATCH：差 = internal − external
    for (const { internal: ia, external: e } of m.amountMismatch) {
      out.push({
        matchStatus: 'AMOUNT_MISMATCH',
        internalSourceType: ia.sourceType, internalSourceId: ia.sourceId, internalSourceNo: ia.sourceNo,
        internalAmount: new Prisma.Decimal(ia.amount), internalDirection: ia.direction, internalTxHash: ia.txHash,
        externalSource: e.source, externalTxId: e.txId, externalTxHash: e.txHash,
        externalAmount: new Prisma.Decimal(e.amount), externalDirection: e.direction, externalTimestamp: e.timestamp,
        signedDelta: new Prisma.Decimal(ia.amount).minus(e.amount),
      });
    }
    return out;
  }
}
