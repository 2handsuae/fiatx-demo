// src/modules/clearing-settle/reconciliation/workflow/wallet-recon-run.service.ts
//
// Phase B / T7: per-wallet reconciliation orchestrator. Replaces the V8
// five-formula identity check with a 1:1 wallet-level comparison:
//   1. Internal-identity pre-gate (sum L per ledger == sum A per ledger).
//      If broken → status='INTERNAL_BREAK', no per-wallet checks (signal
//      that the ledger itself has lost integrity — fix that first).
//   2. For each wallet present in ExternalBalance @ cutoff:
//        a. balanceChecker (T6) — open Case if delta ≠ 0
//        b. flowMatcher       — open Case + LineItems for orphan/mismatch
//   3. Cross-wallet same-externalRef invariant — e.g. WITHDRAW_FEE_POST
//      (client OUT) and WITHDRAW_FEE_FIRM (firm IN) share ref WDRxxx:fee;
//      |amount(client OUT)| must equal |amount(firm IN)|. Mismatch → case.
//   4. Stamp ReconciliationRun.engineVersion='WALLET_V1'.
//
// Out of scope for T7: Case SLA / resolution workflow, Reimbursement
// re-creation, evidence-side line items beyond orphan/mismatch records.

import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../core/prisma/prisma.service';
import {
  WalletBalanceCheckerService,
  WalletBalanceCheckResult,
} from '../engine/v2/wallet-balance-checker.service';
import {
  WalletFlowMatcherService,
  ExternalStatementLineInput,
} from '../engine/v2/wallet-flow-matcher.service';
import {
  TB_ACCOUNT_CODES,
  TB_CODE_TO_COA,
  ASSET_TB_CODES,
} from '../../../accounting/tigerbeetle/constants/tb-account-codes.constant';
import { TigerBeetleService } from '../../../accounting/tigerbeetle/tigerbeetle.service';

const RUN_LAYER = 'WALLET';
const ENGINE_VERSION = 'WALLET_V1';

// T2: severity thresholds (absolute delta in minor-unit ints; hard-coded this
// version, configurable later per plan §Deferred). Used to triage cases in the
// cockpit UI. Magnitude is computed on the raw bigint (no asset-scale lookup);
// since recon caps run inside a single asset, the threshold is comparable
// across runs for that asset.
const SEVERITY_HIGH_THRESHOLD = 10_000n;
const SEVERITY_MED_THRESHOLD = 100n;
export type CaseSeverity = 'HIGH' | 'MEDIUM' | 'LOW';

export function computeSeverity(delta: bigint): CaseSeverity {
  const mag = delta < 0n ? -delta : delta;
  if (mag >= SEVERITY_HIGH_THRESHOLD) return 'HIGH';
  if (mag >= SEVERITY_MED_THRESHOLD) return 'MEDIUM';
  return 'LOW';
}

export interface WalletReconRunInput {
  cutoff: Date;
  manifest?: unknown;
}

export interface WalletReconRunResult {
  runId: string;
  status: 'PASS' | 'BREAK' | 'INTERNAL_BREAK';
  walletsChecked: number;
  casesOpened: number;        // newly created cases this run
  casesReObserved: number;    // existing OPEN cases re-confirmed this run
  casesAutoHealed: number;    // cases auto-resolved this run (previously breaking wallet now passes)
  orphanInternal: number;
  orphanExternal: number;
  mismatch: number;
}

interface InternalIdentityResult {
  balanced: boolean;
  breaks: Array<{ ledger: number; side: 'CLIENT' | 'FIRM'; asset: string; liab: string; delta: string }>;
}

interface ExternalBalanceRow {
  walletRef: string | null;
  closingBalance: Prisma.Decimal;
  book: string;
  currency: string;
  accountRef: string;
}

@Injectable()
export class WalletReconRunService {
  private readonly logger = new Logger(WalletReconRunService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly balanceChecker: WalletBalanceCheckerService,
    private readonly flowMatcher: WalletFlowMatcherService,
    private readonly tigerBeetle: TigerBeetleService,
  ) {}

  async run(input: WalletReconRunInput): Promise<WalletReconRunResult> {
    const { cutoff } = input;
    const businessDate = this.toBusinessDate(cutoff);

    // Stamp the run row up-front so callers always get a runId, even if
    // pre-gate trips.
    const run = await this.createRun(businessDate, input.manifest);

    // ── 1. Internal-identity pre-gate ──────────────────────────────────────
    const identity = await this.computeInternalIdentity(cutoff);
    if (!identity.balanced) {
      this.logger.warn(`[wallet-recon] internal identity break — skipping per-wallet checks. breaks=${JSON.stringify(identity.breaks)}`);
      await this.finishRun(run.id, {
        status: 'INTERNAL_BREAK',
        walletsChecked: 0,
        casesOpened: 0,
        casesReObserved: 0,
        casesAutoHealed: 0,
      });
      return {
        runId: run.id,
        status: 'INTERNAL_BREAK',
        walletsChecked: 0,
        casesOpened: 0,
        casesReObserved: 0,
        casesAutoHealed: 0,
        orphanInternal: 0,
        orphanExternal: 0,
        mismatch: 0,
      };
    }

    // ── 2. List wallets to check ────────────────────────────────────────────
    const cutoffDate = this.toBusinessDate(cutoff);
    const externalBalances = (await (this.prisma as any).externalBalance.findMany({
      where: { cutoffDate, walletRef: { not: null } },
      select: { walletRef: true, closingBalance: true, book: true, currency: true, accountRef: true },
    })) as ExternalBalanceRow[];

    const walletRefs = Array.from(
      new Set(externalBalances.map((b) => b.walletRef).filter((r): r is string => !!r)),
    );
    let casesCreated = 0;
    let casesUpdated = 0;
    let orphanInternal = 0;
    let orphanExternal = 0;
    let mismatch = 0;
    // For cross-wallet ref invariant: track matched (walletRef, internalFlowId)
    // pairs across all wallets so step 3 can group by externalRef.
    const matchedFlowIds: string[] = [];
    // T2 auto-heal input: every walletRef (real wallet OR synthetic XREF key)
    // touched by this run as "still breaking". After all wallets are processed,
    // any OPEN case on this businessDate whose walletRef is NOT in this set is
    // assumed to have recovered → auto-resolve.
    const currentBreakingWallets = new Set<string>();

    for (const walletRef of walletRefs) {
      const bal = externalBalances.find((b) => b.walletRef === walletRef)!;
      const currency = bal.currency;
      const assetId = await this.resolveAssetId(currency);
      if (!assetId) continue;

      // 2a. Balance check (T6)
      const balanceCheck: WalletBalanceCheckResult = await this.balanceChecker.checkBalance({
        walletRef,
        externalClosing: BigInt(bal.closingBalance.toString()),
        cutoff,
      });

      // 2b. Flow match
      const externalLines = await this.fetchExternalLinesForWallet(walletRef, bal.accountRef, cutoff);
      const matcherResult = await this.flowMatcher.matchFlows({
        walletRef,
        externalLines,
        cutoff,
      });
      orphanInternal += matcherResult.orphanInternal.length;
      orphanExternal += matcherResult.orphanExternal.length;
      mismatch += matcherResult.mismatch.length;
      matchedFlowIds.push(...matcherResult.matched.map((m) => m.internalFlowId));

      const flowHasBreak =
        matcherResult.orphanInternal.length > 0 ||
        matcherResult.orphanExternal.length > 0 ||
        matcherResult.mismatch.length > 0;

      // T2: one wallet-level Case per breaking wallet — upsert by (walletRef,
      // businessDate). Whether the break is balance, flow, or both, we land on
      // the same Case row; line items reflect the current run's findings.
      if (!balanceCheck.pass || flowHasBreak) {
        const caseReason = !balanceCheck.pass && flowHasBreak
          ? 'wallet_balance_and_flow_break'
          : !balanceCheck.pass
            ? 'wallet_balance_mismatch'
            : 'wallet_flow_break';
        const { created } = await this.upsertCaseForWallet({
          runId: run.id,
          businessDate,
          assetId,
          assetCode: currency,
          book: balanceCheck.walletKind === 'FIRM' ? 'FIRM' : 'CUSTOMER',
          walletRef,
          coaCode: balanceCheck.coaCode,
          ownerNo: balanceCheck.ownerNo,
          delta: balanceCheck.delta,
          tbAmount: balanceCheck.internal.total,
          actualExternal: balanceCheck.external,
          matcherResult,
          caseReason,
        });
        if (created) casesCreated += 1; else casesUpdated += 1;
        currentBreakingWallets.add(walletRef);
      }
    }

    // ── 3. Cross-wallet same-ref invariant ──────────────────────────────────
    const xrefResult = await this.checkCrossWalletRefInvariant({
      runId: run.id,
      matchedFlowIds,
      businessDate,
    });
    casesCreated += xrefResult.created;
    casesUpdated += xrefResult.updated;
    for (const key of xrefResult.touchedKeys) currentBreakingWallets.add(key);

    // ── 4. Auto-heal: any previously OPEN case whose wallet didn't break in
    // this run is presumed recovered → mark RESOLVED + AUTO_HEALED. Scoped to
    // engineVersion=WALLET_V1 via layer=WALLET so this never touches legacy
    // V8_FORMULA cases.
    const closedCount = await this.autoHealCases({
      runId: run.id,
      businessDate,
      currentBreakingWallets,
    });

    // ── 5. Summarize ────────────────────────────────────────────────────────
    const totalOpenAfter = casesCreated + casesUpdated;
    const status: WalletReconRunResult['status'] = totalOpenAfter > 0 ? 'BREAK' : 'PASS';
    await this.finishRun(run.id, {
      status,
      walletsChecked: walletRefs.length,
      casesOpened: casesCreated,
      casesReObserved: casesUpdated,
      casesAutoHealed: closedCount,
    });

    return {
      runId: run.id,
      status,
      walletsChecked: walletRefs.length,
      casesOpened: casesCreated,
      casesReObserved: casesUpdated,
      casesAutoHealed: closedCount,
      orphanInternal,
      orphanExternal,
      mismatch,
    };
  }

  // ── run row helpers ────────────────────────────────────────────────────────
  private async createRun(businessDate: string, manifest: unknown) {
    const prior = await (this.prisma as any).reconciliationRun.count({
      where: { businessDate, layer: RUN_LAYER },
    });
    const seq = prior + 1;
    const runNo = `RUN-${businessDate.replace(/-/g, '')}-${RUN_LAYER}-${seq}`;
    return (this.prisma as any).reconciliationRun.create({
      data: {
        runNo,
        businessDate,
        layer: RUN_LAYER,
        seq,
        triggerType: 'MANUAL',
        mode: 'APPLY',
        status: 'RUNNING',
        engineVersion: ENGINE_VERSION,
        traceId: `WALLET_V1:${businessDate.replace(/-/g, '')}:${seq}`,
        demoManifest: manifest ? JSON.stringify(manifest) : null,
      },
    });
  }

  private async finishRun(
    runId: string,
    data: {
      status: WalletReconRunResult['status'];
      walletsChecked: number;
      casesOpened: number;
      casesReObserved: number;
      casesAutoHealed: number;
    },
  ): Promise<void> {
    // T2: populate ReconciliationRun summary counters so the UI cockpit can
    // render meaningful totals (the old single-counter `openedCount` lumped
    // create+update together; here we split them and surface auto-heal).
    await (this.prisma as any).reconciliationRun.update({
      where: { id: runId },
      data: {
        status: 'COMPLETED',
        invariantStatus: data.status === 'PASS' ? 'PASS' : 'FAIL',
        openedCount: data.casesOpened,
        reObservedCount: data.casesReObserved,
        closedCount: data.casesAutoHealed,
        completedAt: new Date(),
      },
    });
  }

  // ── Internal-identity pre-gate ────────────────────────────────────────────
  /**
   * Verify L sums equal A sums per ledger by reading TigerBeetle directly.
   * Mirror of `scripts/verify-realtime-coa.ts`: per-account balance =
   *   asset (debit-normal):    debits_posted − credits_posted
   *   L / E (credit-normal):   credits_posted − debits_posted
   * Then per ledger:
   *   sum(CLIENT_ASSET) == sum(CLIENT_PAYABLE+DEPOSIT_SUSPENSE)
   *   sum(FIRM_ASSET)   == sum(FIRM_OPS+FIRM_SET+FIRM_FEE+FIRM_LIQ)
   *
   * `cutoff` is intentionally NOT honored here — TB doesn't expose historical
   * snapshots without account-history reads, and Phase B treats identity as
   * the *current* ledger state. (Per-wallet balance checks below still honor
   * cutoff via account_flows.)
   */
  protected async computeInternalIdentity(_cutoff: Date): Promise<InternalIdentityResult> {
    const registry = (await (this.prisma as any).tbAccountRegistry.findMany({
      where: { status: 'ACTIVE' },
      select: { tbAccountId: true, code: true, ledger: true },
    })) as Array<{ tbAccountId: string; code: number; ledger: number }>;
    if (registry.length === 0) return { balanced: true, breaks: [] };

    const tbIds = registry.map((r) => BigInt('0x' + r.tbAccountId));
    let accounts: Array<{ id: bigint; code: number; debits_posted: bigint; credits_posted: bigint }> = [];
    try {
      accounts = (await this.tigerBeetle.lookupAccounts(tbIds)) as any;
    } catch (err) {
      this.logger.warn(`[wallet-recon] TigerBeetle lookup failed (${(err as Error).message}) — treating identity as broken`);
      return {
        balanced: false,
        breaks: [{ ledger: -1, side: 'CLIENT', asset: 'TB_UNREACHABLE', liab: 'TB_UNREACHABLE', delta: 'TB_UNREACHABLE' }],
      };
    }

    const balById = new Map<string, bigint>();
    for (const a of accounts) {
      const isAsset = ASSET_TB_CODES.has(a.code);
      const bal = isAsset ? a.debits_posted - a.credits_posted : a.credits_posted - a.debits_posted;
      balById.set(a.id.toString(), bal);
    }

    interface LedgerSums {
      clientAsset: bigint;
      clientLiab: bigint;
      firmAsset: bigint;
      firmEquity: bigint;
    }
    const sums = new Map<number, LedgerSums>();
    for (const r of registry) {
      const key = BigInt('0x' + r.tbAccountId).toString();
      const bal = balById.get(key) ?? 0n;
      const s = sums.get(r.ledger) ?? { clientAsset: 0n, clientLiab: 0n, firmAsset: 0n, firmEquity: 0n };
      if (r.code === TB_ACCOUNT_CODES.CLIENT_ASSET) s.clientAsset += bal;
      else if (r.code === TB_ACCOUNT_CODES.CLIENT_PAYABLE || r.code === TB_ACCOUNT_CODES.DEPOSIT_SUSPENSE) s.clientLiab += bal;
      else if (r.code === TB_ACCOUNT_CODES.FIRM_ASSET) s.firmAsset += bal;
      else if (
        r.code === TB_ACCOUNT_CODES.FIRM_OPS ||
        r.code === TB_ACCOUNT_CODES.FIRM_SET ||
        r.code === TB_ACCOUNT_CODES.FIRM_FEE ||
        r.code === TB_ACCOUNT_CODES.FIRM_LIQ
      ) s.firmEquity += bal;
      sums.set(r.ledger, s);
    }

    const breaks: InternalIdentityResult['breaks'] = [];
    for (const [ledger, s] of sums) {
      if (s.clientAsset !== s.clientLiab) {
        breaks.push({
          ledger,
          side: 'CLIENT',
          asset: s.clientAsset.toString(),
          liab: s.clientLiab.toString(),
          delta: (s.clientAsset - s.clientLiab).toString(),
        });
      }
      if (s.firmAsset !== s.firmEquity) {
        breaks.push({
          ledger,
          side: 'FIRM',
          asset: s.firmAsset.toString(),
          liab: s.firmEquity.toString(),
          delta: (s.firmAsset - s.firmEquity).toString(),
        });
      }
    }
    return { balanced: breaks.length === 0, breaks };
  }

  // ── External-statement-line lookup per wallet ─────────────────────────────
  /**
   * Pull external_statement_lines that belong to this wallet up to cutoff.
   * Matching key:
   *   - subAccount == walletRef   (preferred; ZAND fills VirtualAccount/HEXTRUST custody id here)
   *   - OR accountRef == accountRef from this wallet's external balance row
   *     (legacy fall-through when subAccount is null on bank lines)
   *
   * Returns only the columns the matcher needs.
   */
  protected async fetchExternalLinesForWallet(
    walletRef: string,
    accountRef: string,
    cutoff: Date,
  ): Promise<ExternalStatementLineInput[]> {
    const lines = (await (this.prisma as any).externalStatementLine.findMany({
      where: {
        OR: [{ subAccount: walletRef }, { subAccount: null, accountRef }],
        datetime: { lte: cutoff },
      },
      select: { id: true, direction: true, amount: true, externalRef: true, datetime: true },
    })) as Array<{ id: string; direction: string; amount: Prisma.Decimal; externalRef: string | null; datetime: Date }>;
    return lines.map((l) => ({
      id: l.id,
      direction: l.direction as 'IN' | 'OUT',
      amount: l.amount,
      externalRef: l.externalRef,
      datetime: l.datetime,
    }));
  }

  protected async resolveAssetId(currency: string): Promise<string | null> {
    const asset = await (this.prisma as any).asset.findFirst({
      where: { code: currency },
      select: { id: true },
    });
    return asset?.id ?? null;
  }

  // ── Case + line items (T2 wallet-keyed upsert) ────────────────────────────
  /**
   * T2: upsert one Case per (walletRef, businessDate). If a status=OPEN case
   * already exists for the wallet on this date, refresh its snapshot fields
   * (delta / amounts / lastUpdatedRunId / severity) and replace its line items
   * with the current run's findings — do NOT bump firstSeenRunId. If absent,
   * create a fresh case with firstSeenRunId=lastUpdatedRunId=runId.
   *
   * Returns `{ caseId, created }` so the caller can split create vs re-observe
   * counters for the Run summary fields.
   *
   * Line-item strategy: delete-then-insert. The lineItems describe the *current*
   * run's findings, not historical accumulation — so each rerun overwrites the
   * prior set. (Audit trail of which run found what is recoverable via
   * lineItem.foundByRunId joined back to ReconciliationRun.)
   */
  protected async upsertCaseForWallet(input: {
    runId: string;
    businessDate: string;
    assetId: string;
    assetCode: string;
    book: 'CUSTOMER' | 'FIRM';
    walletRef: string;
    coaCode: string;
    ownerNo: string | null;
    delta: bigint;
    tbAmount: bigint;
    actualExternal: bigint;
    matcherResult: Awaited<ReturnType<WalletFlowMatcherService['matchFlows']>>;
    caseReason: string;
  }): Promise<{ caseId: string; created: boolean }> {
    const deltaDecimal = new Prisma.Decimal(input.delta.toString());
    const tbDecimal = new Prisma.Decimal(input.tbAmount.toString());
    const externalDecimal = new Prisma.Decimal(input.actualExternal.toString());
    const expectedDecimal = externalDecimal.minus(deltaDecimal);
    const severity = computeSeverity(input.delta);

    // Idempotency probe: T1 composite index (walletRef, businessDate, status)
    // makes this O(log n) per wallet.
    const existing = await (this.prisma as any).reconciliationCase.findFirst({
      where: {
        walletRef: input.walletRef,
        businessDate: input.businessDate,
        status: 'OPEN',
      },
      select: { id: true },
    });

    let caseId: string;
    let created: boolean;
    if (existing) {
      await (this.prisma as any).reconciliationCase.update({
        where: { id: existing.id },
        data: {
          // Snapshot fields → reflect THIS run's measurement, not history.
          tbAmount: tbDecimal,
          inTransitAmount: new Prisma.Decimal(0),
          expectedExternal: expectedDecimal,
          actualExternal: externalDecimal,
          deltaAmount: deltaDecimal,
          severity,
          // Locator fields can drift if a wallet's owner/coa changes
          // mid-stream; keep them current for the cockpit.
          assetId: input.assetId,
          assetCode: input.assetCode,
          book: input.book,
          coaCode: input.coaCode,
          ownerNo: input.ownerNo,
          // Bookkeeping. firstSeenRunId stays as-is (pin the original observer).
          lastUpdatedRunId: input.runId,
          lastObservedRunId: input.runId,
          traceId: `WALLET_V1:${input.businessDate.replace(/-/g, '')}:${input.caseReason}`,
        },
      });
      caseId = existing.id;
      created = false;
      // Replace line items: drop prior + insert current. ON DELETE CASCADE
      // is set on the FK so this is atomic to the lineItems table.
      await (this.prisma as any).reconciliationLineItem.deleteMany({
        where: { caseId: existing.id },
      });
    } else {
      // caseNo uses asset + zero-padded sequence, scoped per businessDate +
      // assetCode for human readability. We count existing rows (any status)
      // to avoid caseNo collisions when an earlier RESOLVED case exists.
      const priorToday = await (this.prisma as any).reconciliationCase.count({
        where: { businessDate: input.businessDate, assetCode: input.assetCode },
      });
      const caseNo = `REC-${input.businessDate.replace(/-/g, '')}-${input.assetCode}-W-${String(priorToday + 1).padStart(3, '0')}`;
      const createdRow = await (this.prisma as any).reconciliationCase.create({
        data: {
          caseNo,
          businessDate: input.businessDate,
          assetId: input.assetId,
          assetCode: input.assetCode,
          layer: RUN_LAYER,
          book: input.book,
          tbAmount: tbDecimal,
          inTransitAmount: new Prisma.Decimal(0),
          expectedExternal: expectedDecimal,
          actualExternal: externalDecimal,
          deltaAmount: deltaDecimal,
          status: 'OPEN',
          openedByRunId: input.runId,
          lastObservedRunId: input.runId,
          // T1 fields: pin the first observer + last updater (initially same).
          firstSeenRunId: input.runId,
          lastUpdatedRunId: input.runId,
          severity,
          traceId: `WALLET_V1:${input.businessDate.replace(/-/g, '')}:${input.caseReason}`,
          walletRef: input.walletRef,
          coaCode: input.coaCode,
          ownerNo: input.ownerNo,
        },
      });
      caseId = createdRow.id;
      created = true;
    }

    await this.writeLineItems(caseId, input.runId, input.walletRef, input.matcherResult);
    return { caseId, created };
  }

  private async writeLineItems(
    caseId: string,
    runId: string,
    walletRef: string,
    matcherResult: Awaited<ReturnType<WalletFlowMatcherService['matchFlows']>>,
  ): Promise<void> {
    let lineNo = 0;
    for (const oi of matcherResult.orphanInternal) {
      lineNo += 1;
      await (this.prisma as any).reconciliationLineItem.create({
        data: {
          caseId,
          foundByRunId: runId,
          lineNo,
          matchStatus: 'ORPHAN_INTERNAL',
          internalSourceId: oi.internalFlowId,
          internalAmount: new Prisma.Decimal(oi.amount),
          internalDirection: oi.direction,
          walletRef,
          externalRef: oi.externalRef,
        },
      });
    }
    for (const oe of matcherResult.orphanExternal) {
      lineNo += 1;
      await (this.prisma as any).reconciliationLineItem.create({
        data: {
          caseId,
          foundByRunId: runId,
          lineNo,
          matchStatus: 'ORPHAN_EXTERNAL',
          externalTxId: oe.externalLineId,
          externalAmount: new Prisma.Decimal(oe.amount),
          externalDirection: oe.direction,
          walletRef,
          externalRef: oe.externalRef,
        },
      });
    }
    for (const m of matcherResult.mismatch) {
      lineNo += 1;
      await (this.prisma as any).reconciliationLineItem.create({
        data: {
          caseId,
          foundByRunId: runId,
          lineNo,
          matchStatus: 'AMOUNT_MISMATCH',
          internalSourceId: m.internalFlowId,
          internalAmount: new Prisma.Decimal(m.internalAmount),
          externalTxId: m.externalLineId,
          externalAmount: new Prisma.Decimal(m.externalAmount),
          walletRef,
          externalRef: m.ref,
        },
      });
    }
  }

  /**
   * T2 auto-heal: at the end of the run, any OPEN case for THIS businessDate
   * whose walletRef is NOT in `currentBreakingWallets` is presumed to have
   * recovered (no break detected this run on that wallet). Close it.
   *
   * Scoped to layer=WALLET so we never touch legacy V8_FORMULA cases that
   * sit alongside Phase B rows.
   */
  protected async autoHealCases(input: {
    runId: string;
    businessDate: string;
    currentBreakingWallets: Set<string>;
  }): Promise<number> {
    const stale = (await (this.prisma as any).reconciliationCase.findMany({
      where: {
        status: 'OPEN',
        businessDate: input.businessDate,
        layer: RUN_LAYER,
        walletRef: { notIn: Array.from(input.currentBreakingWallets) },
      },
      select: { id: true },
    })) as Array<{ id: string }>;

    if (stale.length === 0) return 0;
    const now = new Date();
    for (const c of stale) {
      await (this.prisma as any).reconciliationCase.update({
        where: { id: c.id },
        data: {
          status: 'RESOLVED',
          resolutionReason: 'AUTO_HEALED',
          resolvedAt: now,
          lastUpdatedRunId: input.runId,
          closedByRunId: input.runId,
        },
      });
    }
    return stale.length;
  }

  // ── Cross-wallet same-externalRef invariant ───────────────────────────────
  /**
   * For each externalRef shared by ≥2 matched flows across wallets (e.g. a
   * withdrawal fee posts a client OUT and a firm IN with the same ref),
   * |amount(client OUT)| must equal |amount(firm IN)|. Mismatch → open a
   * 'CROSS_REF' case (one per offending ref).
   *
   * T2: XREF cases follow the same (walletRef, businessDate) upsert idiom as
   * wallet cases. The "walletRef" for an XREF case is synthetic — `XREF:<ref>`
   * — so each distinct broken ref gets its own row and reruns are idempotent.
   * Auto-heal sees these synthetic keys in `touchedKeys` so an XREF that
   * recovered between runs gets resolved like any other.
   *
   * Returns counts split by create vs update + the touched synthetic walletRef
   * keys so the caller can feed them into the auto-heal exclusion set.
   */
  private async checkCrossWalletRefInvariant(input: {
    runId: string;
    matchedFlowIds: string[];
    businessDate: string;
  }): Promise<{ created: number; updated: number; touchedKeys: string[] }> {
    const touchedKeys: string[] = [];
    if (input.matchedFlowIds.length < 2) return { created: 0, updated: 0, touchedKeys };
    const flows = (await (this.prisma as any).accountFlow.findMany({
      where: { id: { in: input.matchedFlowIds }, externalRef: { not: null } },
      select: { id: true, walletRef: true, externalRef: true, direction: true, amount: true, assetCode: true },
    })) as Array<{
      id: string;
      walletRef: string | null;
      externalRef: string;
      direction: string;
      amount: Prisma.Decimal;
      assetCode: string;
    }>;

    const byRef = new Map<string, typeof flows>();
    for (const f of flows) {
      const arr = byRef.get(f.externalRef) ?? [];
      arr.push(f);
      byRef.set(f.externalRef, arr as any);
    }

    let created = 0;
    let updated = 0;
    for (const [ref, group] of byRef) {
      if (group.length < 2) continue;
      // Compare absolute amounts; if any pair disagrees, open a case for this ref.
      const amounts = group.map((g) => g.amount.abs());
      const allEqual = amounts.every((a) => a.equals(amounts[0]));
      if (allEqual) continue;
      const first = group[0];
      const assetId = await this.resolveAssetId(first.assetCode);
      if (!assetId) continue;

      const safeRef = ref.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 24);
      // Synthetic walletRef — namespaces XREF rows away from real-wallet rows
      // and makes per-ref upsert work via the same (walletRef, businessDate)
      // key everything else uses.
      const syntheticWalletRef = `XREF:${safeRef}`;
      touchedKeys.push(syntheticWalletRef);

      // Compute severity from the *largest pairwise gap* between matched legs.
      // A 1¢ XREF disagreement is LOW noise; a $10k disagreement is HIGH.
      const maxAmount = amounts.reduce((m, a) => (a.greaterThan(m) ? a : m), new Prisma.Decimal(0));
      const minAmount = amounts.reduce((m, a) => (a.lessThan(m) ? a : m), maxAmount);
      const gap = maxAmount.minus(minAmount);
      const gapBig = BigInt(gap.round().toString());
      const severity = computeSeverity(gapBig);

      const xrefExisting = await (this.prisma as any).reconciliationCase.findFirst({
        where: {
          walletRef: syntheticWalletRef,
          businessDate: input.businessDate,
          status: 'OPEN',
        },
        select: { id: true },
      });
      let caseId: string;
      if (xrefExisting) {
        await (this.prisma as any).reconciliationCase.update({
          where: { id: xrefExisting.id },
          data: {
            severity,
            lastUpdatedRunId: input.runId,
            lastObservedRunId: input.runId,
          },
        });
        await (this.prisma as any).reconciliationLineItem.deleteMany({
          where: { caseId: xrefExisting.id },
        });
        caseId = xrefExisting.id;
        updated += 1;
      } else {
        const priorToday = await (this.prisma as any).reconciliationCase.count({
          where: { businessDate: input.businessDate, assetCode: first.assetCode },
        });
        const caseNo = `REC-${input.businessDate.replace(/-/g, '')}-${first.assetCode}-XREF-${safeRef}-${String(priorToday + 1).padStart(3, '0')}`;
        const createdRow = await (this.prisma as any).reconciliationCase.create({
          data: {
            caseNo,
            businessDate: input.businessDate,
            assetId,
            assetCode: first.assetCode,
            layer: RUN_LAYER,
            book: 'XREF',
            tbAmount: new Prisma.Decimal(0),
            inTransitAmount: new Prisma.Decimal(0),
            expectedExternal: new Prisma.Decimal(0),
            actualExternal: new Prisma.Decimal(0),
            deltaAmount: new Prisma.Decimal(0),
            status: 'OPEN',
            openedByRunId: input.runId,
            lastObservedRunId: input.runId,
            firstSeenRunId: input.runId,
            lastUpdatedRunId: input.runId,
            severity,
            traceId: `WALLET_V1:${input.businessDate.replace(/-/g, '')}:cross_match_mismatch`,
            walletRef: syntheticWalletRef,
            coaCode: 'CROSS_REF',
            ownerNo: null,
          },
        });
        caseId = createdRow.id;
        created += 1;
      }
      // Line items: one per leg in the group so operators see the divergent amounts.
      let lineNo = 0;
      for (const leg of group) {
        lineNo += 1;
        await (this.prisma as any).reconciliationLineItem.create({
          data: {
            caseId,
            foundByRunId: input.runId,
            lineNo,
            matchStatus: 'AMOUNT_MISMATCH',
            internalSourceId: leg.id,
            internalAmount: leg.amount,
            internalDirection: leg.direction,
            walletRef: leg.walletRef,
            externalRef: ref,
          },
        });
      }
    }
    return { created, updated, touchedKeys };
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  private toBusinessDate(cutoff: Date): string {
    return cutoff.toISOString().slice(0, 10);
  }
}
