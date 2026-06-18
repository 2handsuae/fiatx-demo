import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AMOUNT_TOLERANCE } from '../constants/reconciliation.constants';

export interface InternalAction {
  sourceType: string; sourceId: string; sourceNo: string;
  amount: Prisma.Decimal; direction: string; txHash?: string | null; referenceNo?: string | null;
}
export interface ExternalTx {
  source: string; txId: string; txHash?: string | null; referenceNo?: string | null;
  amount: Prisma.Decimal; direction: string; timestamp: Date;
}
export interface MatchResult {
  matched: { internal: InternalAction; external: ExternalTx }[];
  amountMismatch: { internal: InternalAction; external: ExternalTx }[];
  orphanInternal: InternalAction[];
  orphanExternal: ExternalTx[];
}

const keyOf = (x: { txHash?: string | null; referenceNo?: string | null }) =>
  x.txHash || x.referenceNo || null;

/** 逐笔 match：主键 txHash/referenceNo，辅 amount+direction。纯函数。 */
@Injectable()
export class MatchEngineService {
  match(internal: InternalAction[], external: ExternalTx[]): MatchResult {
    const res: MatchResult = { matched: [], amountMismatch: [], orphanInternal: [], orphanExternal: [] };
    const usedExt = new Set<string>();
    const tol = new Prisma.Decimal(AMOUNT_TOLERANCE);

    for (const ia of internal) {
      const k = keyOf(ia);
      const ex = external.find(
        e => !usedExt.has(e.txId) && k && keyOf(e) === k && e.direction === ia.direction,
      );
      if (!ex) { res.orphanInternal.push(ia); continue; }
      usedExt.add(ex.txId);
      if (new Prisma.Decimal(ia.amount).minus(ex.amount).abs().greaterThan(tol)) {
        res.amountMismatch.push({ internal: ia, external: ex });
      } else {
        res.matched.push({ internal: ia, external: ex });
      }
    }
    for (const e of external) if (!usedExt.has(e.txId)) res.orphanExternal.push(e);
    return res;
  }
}
