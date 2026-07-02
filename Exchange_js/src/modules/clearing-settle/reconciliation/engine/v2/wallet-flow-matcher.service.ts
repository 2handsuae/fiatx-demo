// src/modules/clearing-settle/reconciliation/engine/v2/wallet-flow-matcher.service.ts
//
// Phase B / T7: per-wallet flow matcher. Pairs the internal source-of-truth
// (account_flows projection, T3) against external statement lines for one
// physical wallet. The engine replaces V8's five-formula identity check
// with a 1:1 evidence comparison.
//
// Match precedence
//   1. externalRef equality (txHash / bank booking id / "SWPxxx:1:pending").
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
// Inclusion filter (must match WalletBalanceCheckerService — the matcher
// compares evidence against the SAME slice of account_flows that the
// balance checker uses to compute internal.total; any drift creates
// phantom orphans that won't show up in the balance delta):
//   (a) isExternalCrossing=true — internal reclasses (e.g.
//       DEPOSIT_SUSPENSE_TO_PAYABLE) live entirely inside the ledger; the
//       external statement is not expected to mention them.
//   (b) tbAccountRegistry code ∈ {100, 101, 200, 201, 202, 203} — drop
//       aggregate legs (CLIENT_ASSET=1 / FIRM_ASSET=50) and any row whose
//       tbAccountId isn't in the registry. Aggregate legs share walletRef
//       purely for traceability; they belong to the aggregate book, not
//       this wallet, so they should not be matched 1:1 against an external
//       statement line. (Mirrors WalletBalanceChecker step 3.)
//
// Returns five disjoint buckets:
//   - matched          (internalFlowId, externalLineId, via)
//   - orphanInternal   (internal evidence with no external line)
//   - orphanExternal   (external line with no internal evidence, and no
//                        non-terminal funds order explains it either)
//   - mismatch         (same ref, different amount — wallet shows a real break)
//   - inTransit        (external line explained by a non-terminal funds
//                        order — Pass 3, see above)

import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../../core/prisma/prisma.service';
import { TB_ACCOUNT_CODES } from '../../../../accounting/tigerbeetle/constants/tb-account-codes.constant';
import { FundsOrderService } from '../../../../funds-orders/funds-order.service';

// Same set used by WalletBalanceChecker — flows must land on a wallet-owned
// L (customer) or E (firm) account to count as evidence. Aggregate A codes
// (1 / 50) and unknown-registry rows are excluded; both surface as bogus
// orphans against an external statement that only mirrors owned-account
// activity (see scripts/recon-demo.ts planWallets step 2).
const OWNED_CODES: ReadonlySet<number> = new Set<number>([
  TB_ACCOUNT_CODES.CLIENT_PAYABLE,    // 100
  TB_ACCOUNT_CODES.DEPOSIT_SUSPENSE,  // 101
  TB_ACCOUNT_CODES.FIRM_OPS,          // 200
  TB_ACCOUNT_CODES.FIRM_SET,          // 201
  TB_ACCOUNT_CODES.FIRM_FEE,          // 202
  TB_ACCOUNT_CODES.FIRM_LIQ,          // 203
]);

export interface ExternalStatementLineInput {
  id: string;
  direction: 'IN' | 'OUT' | string;
  amount: Prisma.Decimal;
  externalRef: string | null;
  datetime: Date;
}

export interface MatcherInput {
  walletRef: string;
  externalLines: ExternalStatementLineInput[];   // pre-filtered to this wallet by caller
  cutoff: Date;
  timeWindowMinutes?: number;                    // default 60
}

export interface MatchedPair {
  internalFlowId: string;
  externalLineId: string;
  via: 'ref' | 'fuzzy';
}

export interface OrphanInternal {
  internalFlowId: string;
  eventCode: string;
  amount: string;
  direction: 'IN' | 'OUT';
  externalRef: string | null;
}

export interface OrphanExternal {
  externalLineId: string;
  amount: string;
  direction: 'IN' | 'OUT';
  externalRef: string | null;
}

export interface AmountMismatch {
  internalFlowId: string;
  externalLineId: string;
  internalAmount: string;
  externalAmount: string;
  ref: string;
}

export interface InTransitMatch {
  externalLineId: string;
  fundsOrderId: string;
  fundsOrderNo: string;
  orderStatus: string;
  amount: string;
  direction: 'IN' | 'OUT';
  externalRef: string | null;
}

export interface MatcherResult {
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

@Injectable()
export class WalletFlowMatcherService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fundsOrders: FundsOrderService,
  ) {}

  async matchFlows(input: MatcherInput): Promise<MatcherResult> {
    const { walletRef, externalLines, cutoff } = input;
    const windowMs = (input.timeWindowMinutes ?? 60) * 60 * 1000;

    const rawInternal = (await (this.prisma as any).accountFlow.findMany({
      where: {
        walletRef,
        isExternalCrossing: true,
        transferType: 'POSTED', // PENDING transfers haven't externally crossed yet — same filter as balanceChecker
        createdAt: { lte: cutoff },
      },
      select: {
        id: true,
        tbAccountId: true,
        direction: true,
        amount: true,
        externalRef: true,
        eventCode: true,
        createdAt: true,
      },
    })) as Array<InternalFlowRow & { tbAccountId: string }>;

    // Filter (b): resolve tbAccountId → code via registry, keep only flows on
    // wallet-owned L/E accounts. Drops aggregate legs (code 1/50) and any row
    // whose tbAccountId isn't in the registry — both would otherwise create
    // bogus orphanInternal entries against an external statement that only
    // mirrors owned-account activity. This must match the slice used by
    // WalletBalanceChecker and scripts/recon-demo.ts:planWallets step 2.
    // tb_account_registry stores tbAccountId in 32-char padded form;
    // account_flows.tbAccountId can be 31-char unpadded. Pad both sides to
    // 32 chars before the join. Without this, F_SET / F_FEE / etc. flows
    // silently drop and surface as bogus orphan{Internal,External} on the
    // engine side — exactly the bug planWallets in recon-demo had.
    const padTbId = (id: string) => (id.length < 32 ? id.padStart(32, '0') : id);
    const tbAccountIds = Array.from(
      new Set(rawInternal.map((f) => padTbId(f.tbAccountId))),
    );
    const regs = tbAccountIds.length
      ? ((await (this.prisma as any).tbAccountRegistry.findMany({
          where: { tbAccountId: { in: tbAccountIds } },
          select: { tbAccountId: true, code: true },
        })) as Array<{ tbAccountId: string; code: number }>)
      : [];
    const codeById = new Map<string, number>(
      regs.map((r) => [padTbId(r.tbAccountId), r.code]),
    );
    const internal: InternalFlowRow[] = rawInternal
      .filter((f) => {
        const code = codeById.get(padTbId(f.tbAccountId));
        return code !== undefined && OWNED_CODES.has(code);
      })
      .map(({ tbAccountId: _drop, ...rest }) => rest);

    const matched: MatchedPair[] = [];
    const mismatch: AmountMismatch[] = [];

    // Track which sides have been resolved (matched OR mismatch).
    const usedInternal = new Set<string>();
    const usedExternal = new Set<string>();

    // ── Pass 1: ref-equality match ──────────────────────────────────────────
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
      const amountOk = (ext: ExternalStatementLineInput, c: (typeof candidates)[number]) =>
        ext.amount.equals(c.netAmount) || ext.amount.equals(c.amount);
      const take = (ext: ExternalStatementLineInput, c: (typeof candidates)[number]) => {
        usedOrders.add(c.id); usedExternal.add(ext.id);
        inTransit.push({ externalLineId: ext.id, fundsOrderId: c.id, fundsOrderNo: c.fundsOrderNo,
          orderStatus: c.status, amount: ext.amount.toString(),
          direction: ext.direction as 'IN' | 'OUT', externalRef: ext.externalRef });
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
