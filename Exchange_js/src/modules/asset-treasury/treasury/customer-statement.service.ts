import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';

/**
 * Task 10: customer statement read model — aggregates the per-leg evidence
 * rows from TbEvidenceService.getAccountStatement into order-level rows for
 * the client-facing statement. Amounts stay minor-unit integers throughout
 * (mirrors the upstream contract — "金额已是最小单位").
 */

/** One leg as produced by TbEvidenceService.getAccountStatement — already
 *  scoped to a single customer's CLIENT_PAYABLE account for one currency. */
export interface StatementLeg {
  sourceType: string;
  sourceNo: string;
  eventCode: string;
  direction: 'IN' | 'OUT';
  amount: number;
  runningBalance: number;
  externalRef?: string | null;
  createdAt: string | Date;
}

export interface StatementRowRef {
  sourceType: string;
  sourceNo: string;
}

export interface StatementRow {
  postedAt: string;
  kind: string;
  title: string;
  subtitle: string | null;
  /** Signed net amount, minor unit, string. */
  amount: string;
  /** Sum of fee legs (eventCode contains 'FEE') in this row's group, or null if none. */
  feeAmount: string | null;
  balanceAfter: string;
  refs: StatementRowRef[];
}

export interface BuildStatementOptions {
  /** Whether the statement's single currency is a fiat asset (drives the
   *  deposit/withdrawal title wording: "bank transfer" vs "crypto"). */
  isFiat: boolean;
  from?: Date;
  to?: Date;
  skip?: number;
  take?: number;
}

/** Context handed to a ROW_PRESENTATION entry's `present()` to build title/subtitle. */
interface PresentCtx {
  sourceNo: string;
  isFiat: boolean;
  /** Direction of the representative leg, from THIS customer's point of view. */
  legDirection: 'IN' | 'OUT';
  swapCurrencies: { from: string; to: string } | null;
  adjustment: { reasonCustomer: string; relatedOrderNo: string | null; direction: string } | null;
}

interface RowPresentation {
  kind: string;
  /** Grouping tag — legs whose presentation-key maps to the same family merge
   *  into one row when they also share (sourceType, sourceNo). Distinct
   *  families never merge even when sourceNo matches (e.g. a deposit's
   *  original credit vs its later clawback). */
  family: string;
  present: (ctx: PresentCtx) => { title: string; subtitle: string | null };
}

/**
 * Tipping-off judgment table (spec §6, Task 10 Step 1) — keyed by eventCode,
 * except RECON_ADJUSTMENT which is keyed by sourceType (its eventCode is
 * always 'RECON_ADJUSTMENT_POSTED', so the sourceType itself is the key).
 *
 * Event-code inventory & disposition (grep evidence in task-10-report.md):
 *  - Codes below are the ONLY ones ever posted (transferType=POSTED) against a
 *    customer's CLIENT_PAYABLE account. Every other event code touches a
 *    different account (DEPOSIT_SUSPENSE / CLIENT_ASSET / FIRM_* / INCOME_*)
 *    or only ever exists as a PENDING/VOIDED row (WITHDRAW_LOCK_* get
 *    renamed to *_POST on posting via enrichForPost) — those cases are N/A
 *    for this statement and fall through to FALLBACK_PRESENTATION below,
 *    which is also the safety net for any future/unrecognized event code
 *    (including a confiscation/seizure/sanction code, should one ever be
 *    mis-wired to touch CLIENT_PAYABLE) — never leaks eventCode wording.
 */
const ROW_PRESENTATION: Record<string, RowPresentation> = {
  // Original deposit credit landing in the customer's payable balance.
  DEPOSIT_SUSPENSE_TO_PAYABLE: {
    kind: 'DEPOSIT',
    family: 'DEPOSIT_CREDIT',
    present: ({ sourceNo, isFiat }) => ({
      title: isFiat ? 'Deposit · bank transfer' : 'Deposit · crypto',
      subtitle: sourceNo,
    }),
  },
  // Bank/custodian later clawed back an already-credited deposit.
  DEPOSIT_CLAWBACK: {
    kind: 'DEPOSIT',
    family: 'DEPOSIT_CLAWBACK',
    present: ({ sourceNo }) => ({ title: 'Deposit recalled by bank', subtitle: sourceNo }),
  },
  // Withdrawal principal — merges with its fee leg (same family) into one row.
  WITHDRAW_NET_POST: {
    kind: 'WITHDRAWAL',
    family: 'WITHDRAW_NET',
    present: ({ sourceNo, isFiat }) => ({
      title: isFiat ? 'Withdrawal to bank account' : 'Withdrawal · crypto',
      subtitle: sourceNo,
    }),
  },
  WITHDRAW_FEE_POST: {
    kind: 'WITHDRAWAL',
    family: 'WITHDRAW_NET',
    present: ({ sourceNo, isFiat }) => ({
      title: isFiat ? 'Withdrawal to bank account' : 'Withdrawal · crypto',
      subtitle: sourceNo,
    }),
  },
  // Bank/network bounced an already-posted payout — funds re-enter the balance.
  WITHDRAW_BOUNCE_REENTRY: {
    kind: 'WITHDRAWAL',
    family: 'WITHDRAW_RETURNED',
    present: ({ sourceNo }) => ({ title: 'Withdrawal returned', subtitle: sourceNo }),
  },
  // Swap legs: SELL_CLIENT alone on the "from" currency's account, or
  // BUY_CLIENT + FEE_CLIENT together on the "to" currency's account — all
  // three share the SWAP family so the buy+fee pair merges into one row.
  SWAP_SELL_CLIENT: {
    kind: 'SWAP',
    family: 'SWAP',
    present: ({ sourceNo, swapCurrencies }) => ({
      title: `Swap ${swapCurrencies?.from ?? '?'} → ${swapCurrencies?.to ?? '?'}`,
      subtitle: sourceNo,
    }),
  },
  SWAP_BUY_CLIENT: {
    kind: 'SWAP',
    family: 'SWAP',
    present: ({ sourceNo, swapCurrencies }) => ({
      title: `Swap ${swapCurrencies?.from ?? '?'} → ${swapCurrencies?.to ?? '?'}`,
      subtitle: sourceNo,
    }),
  },
  SWAP_FEE_CLIENT: {
    kind: 'SWAP',
    family: 'SWAP',
    present: ({ sourceNo, swapCurrencies }) => ({
      title: `Swap ${swapCurrencies?.from ?? '?'} → ${swapCurrencies?.to ?? '?'}`,
      subtitle: sourceNo,
    }),
  },
  // Internal transfer credits — the client-side eventCode already encodes the
  // purpose (compensation vs advance), no DB lookup needed for the title.
  INTERNAL_TRANSFER_COMPENSATION_IN: {
    kind: 'TRANSFER',
    family: 'INTERNAL_TRANSFER_COMPENSATION',
    present: () => ({ title: 'Credit from FiatX · balance restoration', subtitle: null }),
  },
  INTERNAL_TRANSFER_ADVANCE_IN: {
    kind: 'TRANSFER',
    family: 'INTERNAL_TRANSFER_ADVANCE',
    present: () => ({ title: 'Credit from FiatX · advance', subtitle: null }),
  },
  // Reconciliation adjustments (keyed by sourceType, not eventCode — every
  // adjustment posts the same 'RECON_ADJUSTMENT_POSTED' eventCode). Never
  // shows the internal ADJ number. The reattribution arc posts one row per
  // customer (misattributed party debited, rightful party credited); the
  // rightful party's INCREASE-side row hides the subtitle so it can't see
  // the misattributed party's original order number.
  RECON_ADJUSTMENT: {
    kind: 'ADJUSTMENT',
    family: 'RECON_ADJUSTMENT',
    present: ({ legDirection, adjustment }) => {
      if (!adjustment) return { title: 'Balance adjustment', subtitle: null };
      const title = `Balance correction · ${adjustment.reasonCustomer}`;
      if (adjustment.direction === 'REATTRIBUTE' && legDirection === 'IN') {
        return { title, subtitle: null };
      }
      return { title, subtitle: adjustment.relatedOrderNo ? `Original order ${adjustment.relatedOrderNo}` : null };
    },
  },
};

/** Default-deny fallback for any eventCode/sourceType not in the whitelist
 *  above — including a confiscation/seizure/sanction-family code, should one
 *  ever be posted against CLIENT_PAYABLE. Never echoes the raw eventCode. */
const FALLBACK_PRESENTATION: RowPresentation = {
  kind: 'ADJUSTMENT',
  family: 'UNRECOGNIZED',
  present: () => ({ title: 'Balance adjustment', subtitle: null }),
};

function presentationKeyFor(leg: StatementLeg): string {
  return leg.sourceType === 'RECON_ADJUSTMENT' ? 'RECON_ADJUSTMENT' : leg.eventCode;
}

function presentationFor(leg: StatementLeg): RowPresentation {
  const key = presentationKeyFor(leg);
  return ROW_PRESENTATION[key] ?? FALLBACK_PRESENTATION;
}

function familyFor(leg: StatementLeg): string {
  const presentation = presentationFor(leg);
  // An unrecognized leg gets a family scoped to its own key so two different
  // unrecognized event codes sharing a sourceNo never accidentally merge.
  return presentation === FALLBACK_PRESENTATION
    ? `UNRECOGNIZED::${presentationKeyFor(leg)}`
    : presentation.family;
}

@Injectable()
export class CustomerStatementService {
  constructor(private readonly prisma: PrismaService) {}

  async buildStatement(
    legs: StatementLeg[],
    opts: BuildStatementOptions,
  ): Promise<{ items: StatementRow[]; total: number }> {
    const filtered = legs.filter((leg) => {
      const t = new Date(leg.createdAt).getTime();
      if (opts.from && t < opts.from.getTime()) return false;
      if (opts.to && t > opts.to.getTime()) return false;
      return true;
    });

    const groups = new Map<string, StatementLeg[]>();
    for (const leg of filtered) {
      const key = `${leg.sourceType}::${leg.sourceNo}::${familyFor(leg)}`;
      const bucket = groups.get(key);
      if (bucket) bucket.push(leg);
      else groups.set(key, [leg]);
    }
    const groupList = [...groups.values()];

    // Batch-fetch DB context needed by presentation (reasonCustomer/relatedOrderNo
    // for adjustments, from/to currency for swaps) — one query per kind, no N+1.
    const adjustmentNos = new Set<string>();
    const swapNos = new Set<string>();
    for (const group of groupList) {
      const rep = group[0];
      if (rep.sourceType === 'RECON_ADJUSTMENT') adjustmentNos.add(rep.sourceNo);
      if (rep.sourceType === 'SWAP') swapNos.add(rep.sourceNo);
    }
    const [adjustments, swaps] = await Promise.all([
      adjustmentNos.size
        ? (this.prisma as any).reconciliationAdjustment.findMany({
            where: { adjustmentNo: { in: [...adjustmentNos] } },
            select: { adjustmentNo: true, reasonCustomer: true, relatedOrderNo: true, direction: true },
          })
        : Promise.resolve([]),
      swapNos.size
        ? (this.prisma as any).swapTransaction.findMany({
            where: { swapNo: { in: [...swapNos] } },
            select: { swapNo: true, fromAssetCode: true, toAssetCode: true },
          })
        : Promise.resolve([]),
    ]);
    const adjustmentByNo = new Map<string, any>(adjustments.map((a: any) => [a.adjustmentNo, a]));
    const swapByNo = new Map<string, any>(swaps.map((s: any) => [s.swapNo, s]));

    const rows = groupList.map((group) => this.presentGroup(group, opts.isFiat, adjustmentByNo, swapByNo));
    rows.sort((a, b) => b.sortKey - a.sortKey);

    const total = rows.length;
    const skip = opts.skip ?? 0;
    const take = opts.take ?? 50;
    const items = rows.slice(skip, skip + take).map(({ sortKey: _sortKey, ...row }) => row);

    return { items, total };
  }

  private presentGroup(
    legs: StatementLeg[],
    isFiat: boolean,
    adjustmentByNo: Map<string, any>,
    swapByNo: Map<string, any>,
  ): StatementRow & { sortKey: number } {
    // Ascending order so the group's last leg is the one that finalized the row.
    const sorted = [...legs].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );
    const rep = sorted[0];
    const last = sorted[sorted.length - 1];

    let netAmount = 0;
    let feeAmount = 0;
    let hasFee = false;
    for (const leg of sorted) {
      netAmount += leg.direction === 'IN' ? leg.amount : -leg.amount;
      if (leg.eventCode.includes('FEE')) {
        feeAmount += leg.amount;
        hasFee = true;
      }
    }

    const presentation = presentationFor(rep);
    const { title, subtitle } = presentation.present({
      sourceNo: rep.sourceNo,
      isFiat,
      legDirection: rep.direction,
      swapCurrencies:
        rep.sourceType === 'SWAP'
          ? (() => {
              const swap = swapByNo.get(rep.sourceNo);
              return swap ? { from: swap.fromAssetCode, to: swap.toAssetCode } : null;
            })()
          : null,
      adjustment: rep.sourceType === 'RECON_ADJUSTMENT' ? adjustmentByNo.get(rep.sourceNo) ?? null : null,
    });

    return {
      postedAt: new Date(last.createdAt).toISOString(),
      kind: presentation.kind,
      title,
      subtitle,
      amount: String(netAmount),
      feeAmount: hasFee ? String(feeAmount) : null,
      balanceAfter: String(last.runningBalance),
      refs: sorted.map((leg) => ({ sourceType: leg.sourceType, sourceNo: leg.sourceNo })),
      sortKey: new Date(last.createdAt).getTime(),
    };
  }
}
