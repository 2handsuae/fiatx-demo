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
//
// Out of scope for T7: Case SLA / resolution workflow, Reimbursement
// re-creation, evidence-side line items beyond orphan/mismatch records.

import { randomUUID } from 'node:crypto';
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
    // T2 auto-heal input: every real walletRef touched by this run as
    // "still breaking". After all wallets are processed, any OPEN case on
    // this businessDate whose walletRef is NOT in this set is assumed to
    // have recovered → auto-resolve.
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

      // 2a'. Enrich UNKNOWN — when the checker can't classify (firm wallet
      // whose flows landed only on aggregate FIRM_ASSET legs, or a fresh
      // wallet with zero activity), look up walletRole + ownerType + ownerNo
      // from the wallet table so the case row gets meaningful coaCode/book/
      // owner instead of empty strings + 'CUSTOMER' book.
      const enriched = await this.enrichIfUnknown(walletRef, balanceCheck);

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
          book: enriched.book,
          walletRef,
          coaCode: enriched.coaCode,
          ownerNo: enriched.ownerNo,
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

    // ── 3. Auto-heal: any previously OPEN case whose wallet didn't break in
    // this run is presumed recovered → mark RESOLVED + AUTO_HEALED. Scoped to
    // layer=WALLET so this never touches legacy V8 cases.
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
    // Format: RUN{YYYYMMDD}-{seq} — single engine, so no engine tag in the
    // no. Sequence scoped to layer=WALLET per day.
    const runNo = `RUN${businessDate.replace(/-/g, '')}-${seq}`;
    return (this.prisma as any).reconciliationRun.create({
      data: {
        runNo,
        businessDate,
        layer: RUN_LAYER,
        seq,
        triggerType: 'MANUAL',
        mode: 'APPLY',
        status: 'RUNNING',
        traceId: randomUUID(),
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

  /**
   * When balanceChecker returns walletKind=UNKNOWN (firm wallet whose flows
   * only landed on aggregate FIRM_ASSET legs, or a fresh wallet with no
   * activity), it can't classify the wallet — coaCode comes back '' and
   * ownerNo comes back null. Look up the wallet row and derive sensible
   * defaults from walletRole + ownerType + ownerNo so case rows aren't
   * written with empty strings.
   */
  private static readonly COA_BY_ROLE: Record<string, string> = {
    F_OPS:   'E.FIRM_OPS',
    F_SET:   'E.FIRM_SET',
    F_LIQ:   'E.FIRM_LIQ',
    F_FEE:   'E.FIRM_FEE',
    C_DEP:   'L.CLIENT_PAYABLE+L.DEPOSIT_SUSPENSE',
    C_VIBAN: 'L.CLIENT_PAYABLE+L.DEPOSIT_SUSPENSE',
    C_CMA:   'L.CLIENT_PAYABLE+L.DEPOSIT_SUSPENSE',
  };

  private async enrichIfUnknown(
    walletRef: string,
    balanceCheck: WalletBalanceCheckResult,
  ): Promise<{ book: 'CUSTOMER' | 'FIRM'; coaCode: string; ownerNo: string | null }> {
    if (balanceCheck.walletKind !== 'UNKNOWN') {
      return {
        book: balanceCheck.walletKind === 'FIRM' ? 'FIRM' : 'CUSTOMER',
        coaCode: balanceCheck.coaCode,
        ownerNo: balanceCheck.ownerNo,
      };
    }
    const wallet = (await (this.prisma as any).wallet.findUnique({
      where: { id: walletRef },
      select: { walletRole: true, ownerType: true, ownerNo: true },
    })) as { walletRole: string | null; ownerType: string | null; ownerNo: string | null } | null;
    if (!wallet) {
      // Defensive: walletRef points at no wallet row — fall back to raw
      // balanceCheck values so the case still writes (shouldn't happen in
      // normal flow now that XREF synthetic refs are gone).
      return { book: 'CUSTOMER', coaCode: balanceCheck.coaCode, ownerNo: balanceCheck.ownerNo };
    }
    const isFirm = wallet.ownerType !== 'CUSTOMER';
    const role = wallet.walletRole ?? '';
    return {
      book: isFirm ? 'FIRM' : 'CUSTOMER',
      coaCode: WalletReconRunService.COA_BY_ROLE[role] ?? balanceCheck.coaCode,
      ownerNo: wallet.ownerNo ?? balanceCheck.ownerNo,
    };
  }

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
      // Format: REC{YYYYMMDD}-{nnn}. Sequence counts ALL cases for the
      // businessDate — collision-safe. Asset/wallet info is in the detail page.
      const priorToday = await (this.prisma as any).reconciliationCase.count({
        where: { businessDate: input.businessDate },
      });
      const caseNo = `REC${input.businessDate.replace(/-/g, '')}-${String(priorToday + 1).padStart(3, '0')}`;
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
          traceId: randomUUID(),
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

  // ── Helpers ───────────────────────────────────────────────────────────────
  private toBusinessDate(cutoff: Date): string {
    return cutoff.toISOString().slice(0, 10);
  }
}
