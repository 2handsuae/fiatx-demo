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

export interface WalletReconRunInput {
  cutoff: Date;
  manifest?: unknown;
}

export interface WalletReconRunResult {
  runId: string;
  status: 'PASS' | 'BREAK' | 'INTERNAL_BREAK';
  walletsChecked: number;
  casesOpened: number;
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
      });
      return {
        runId: run.id,
        status: 'INTERNAL_BREAK',
        walletsChecked: 0,
        casesOpened: 0,
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
    let casesOpened = 0;
    let orphanInternal = 0;
    let orphanExternal = 0;
    let mismatch = 0;
    // For cross-wallet ref invariant: track matched (walletRef, internalFlowId)
    // pairs across all wallets so step 4 can group by externalRef.
    const matchedFlowIds: string[] = [];

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

      let caseId: string | null = null;
      if (!balanceCheck.pass) {
        caseId = await this.openCase({
          businessDate,
          assetId,
          assetCode: currency,
          book: balanceCheck.walletKind === 'FIRM' ? 'FIRM' : 'CUSTOMER',
          walletRef,
          coaCode: balanceCheck.coaCode,
          ownerNo: balanceCheck.ownerNo,
          deltaAmount: new Prisma.Decimal(balanceCheck.delta.toString()),
          tbAmount: new Prisma.Decimal(balanceCheck.internal.total.toString()),
          actualExternal: new Prisma.Decimal(balanceCheck.external.toString()),
          openedByRunId: run.id,
          caseReason: 'wallet_balance_mismatch',
        });
        if (caseId) casesOpened += 1;
      }

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
      if (flowHasBreak) {
        // Reuse the balance case if one was opened; otherwise open a new case
        // for this wallet to host the line items.
        if (!caseId) {
          caseId = await this.openCase({
            businessDate,
            assetId,
            assetCode: currency,
            book: balanceCheck.walletKind === 'FIRM' ? 'FIRM' : 'CUSTOMER',
            walletRef,
            coaCode: balanceCheck.coaCode,
            ownerNo: balanceCheck.ownerNo,
            deltaAmount: new Prisma.Decimal(0),
            tbAmount: new Prisma.Decimal(balanceCheck.internal.total.toString()),
            actualExternal: new Prisma.Decimal(balanceCheck.external.toString()),
            openedByRunId: run.id,
            caseReason: 'wallet_flow_break',
          });
          if (caseId) casesOpened += 1;
        }
        if (caseId) await this.writeLineItems(caseId, run.id, walletRef, matcherResult);
      }
    }

    // ── 3. Cross-wallet same-ref invariant ──────────────────────────────────
    const crossMismatchOpened = await this.checkCrossWalletRefInvariant({
      runId: run.id,
      matchedFlowIds,
      businessDate,
    });
    casesOpened += crossMismatchOpened;

    // ── 4. Summarize ────────────────────────────────────────────────────────
    const status: WalletReconRunResult['status'] = casesOpened > 0 ? 'BREAK' : 'PASS';
    await this.finishRun(run.id, {
      status,
      walletsChecked: walletRefs.length,
      casesOpened,
    });

    return {
      runId: run.id,
      status,
      walletsChecked: walletRefs.length,
      casesOpened,
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
    data: { status: WalletReconRunResult['status']; walletsChecked: number; casesOpened: number },
  ): Promise<void> {
    await (this.prisma as any).reconciliationRun.update({
      where: { id: runId },
      data: {
        status: 'COMPLETED',
        invariantStatus: data.status === 'PASS' ? 'PASS' : 'FAIL',
        openedCount: data.casesOpened,
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

  // ── Case + line items ─────────────────────────────────────────────────────
  private async openCase(input: {
    businessDate: string;
    assetId: string;
    assetCode: string;
    book: 'CUSTOMER' | 'FIRM';
    walletRef: string;
    coaCode: string;
    ownerNo: string | null;
    deltaAmount: Prisma.Decimal;
    tbAmount: Prisma.Decimal;
    actualExternal: Prisma.Decimal;
    openedByRunId: string;
    caseReason: string;
  }): Promise<string | null> {
    // Schema unique [businessDate, assetId, book] enforces one Case per
    // (day, asset, book). When multiple wallets in the same book break on
    // the same day they share the same Case row; per-wallet identity lives
    // on the LineItem (walletRef stamped there). The Case's walletRef holds
    // the first-observed wallet, lastObservedRunId bumps on re-observation,
    // and deltaAmount accumulates the net break.
    const existing = await (this.prisma as any).reconciliationCase.findFirst({
      where: { businessDate: input.businessDate, assetId: input.assetId, book: input.book },
    });
    if (existing) {
      const accumulated = new Prisma.Decimal(existing.deltaAmount ?? 0).plus(input.deltaAmount);
      await (this.prisma as any).reconciliationCase.update({
        where: { id: existing.id },
        data: {
          lastObservedRunId: input.openedByRunId,
          deltaAmount: accumulated,
        },
      });
      return existing.id;
    }
    const priorToday = await (this.prisma as any).reconciliationCase.count({
      where: { businessDate: input.businessDate, assetCode: input.assetCode },
    });
    const caseNo = `REC-${input.businessDate.replace(/-/g, '')}-${input.assetCode}-W-${String(priorToday + 1).padStart(3, '0')}`;
    const created = await (this.prisma as any).reconciliationCase.create({
      data: {
        caseNo,
        businessDate: input.businessDate,
        assetId: input.assetId,
        assetCode: input.assetCode,
        layer: RUN_LAYER,
        book: input.book,
        tbAmount: input.tbAmount,
        inTransitAmount: new Prisma.Decimal(0),
        expectedExternal: input.actualExternal.minus(input.deltaAmount),
        actualExternal: input.actualExternal,
        deltaAmount: input.deltaAmount,
        status: 'OPEN',
        openedByRunId: input.openedByRunId,
        lastObservedRunId: input.openedByRunId,
        traceId: `WALLET_V1:${input.businessDate.replace(/-/g, '')}:${input.caseReason}`,
        walletRef: input.walletRef,
        coaCode: input.coaCode,
        ownerNo: input.ownerNo,
      },
    });
    return created.id;
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

  // ── Cross-wallet same-externalRef invariant ───────────────────────────────
  /**
   * For each externalRef shared by ≥2 matched flows across wallets (e.g. a
   * withdrawal fee posts a client OUT and a firm IN with the same ref),
   * |amount(client OUT)| must equal |amount(firm IN)|. Mismatch → open a
   * 'CROSS_REF' case (one per offending ref).
   */
  private async checkCrossWalletRefInvariant(input: {
    runId: string;
    matchedFlowIds: string[];
    businessDate: string;
  }): Promise<number> {
    if (input.matchedFlowIds.length < 2) return 0;
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

    let opened = 0;
    for (const [ref, group] of byRef) {
      if (group.length < 2) continue;
      // Compare absolute amounts; if any pair disagrees, open a case for this ref.
      const amounts = group.map((g) => g.amount.abs());
      const allEqual = amounts.every((a) => a.equals(amounts[0]));
      if (allEqual) continue;
      // Open one cross-ref case; we attach to the first wallet's asset for
      // book-keeping but mark coaCode='CROSS_REF' to make it discoverable.
      const first = group[0];
      const assetId = await this.resolveAssetId(first.assetCode);
      if (!assetId) continue;

      // Cross-ref cases live under book='XREF' (distinct from CUSTOMER/FIRM
      // so a customer-side break and a cross-ref break can coexist for the
      // same asset). One XREF case per ref via unique [date, asset, book]; we
      // include the ref in caseNo for human disambiguation across refs.
      const safeRef = ref.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 24);
      const priorToday = await (this.prisma as any).reconciliationCase.count({
        where: { businessDate: input.businessDate, assetCode: first.assetCode },
      });
      const caseNo = `REC-${input.businessDate.replace(/-/g, '')}-${first.assetCode}-XREF-${safeRef}-${String(priorToday + 1).padStart(3, '0')}`;
      // findFirst guard so re-runs against the same ref don't blow up the unique
      // constraint — XREF book holds only one case per asset/day in this run.
      const xrefExisting = await (this.prisma as any).reconciliationCase.findFirst({
        where: { businessDate: input.businessDate, assetId, book: 'XREF' },
      });
      if (xrefExisting) {
        await (this.prisma as any).reconciliationCase.update({
          where: { id: xrefExisting.id },
          data: { lastObservedRunId: input.runId },
        });
        // still write line items for new divergences
        let lineNoExist = 0;
        for (const leg of group) {
          lineNoExist += 1;
          await (this.prisma as any).reconciliationLineItem.create({
            data: {
              caseId: xrefExisting.id,
              foundByRunId: input.runId,
              lineNo: lineNoExist,
              matchStatus: 'AMOUNT_MISMATCH',
              internalSourceId: leg.id,
              internalAmount: leg.amount,
              internalDirection: leg.direction,
              walletRef: leg.walletRef,
              externalRef: ref,
            },
          });
        }
        opened += 1;
        continue;
      }
      await (this.prisma as any).reconciliationCase.create({
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
          traceId: `WALLET_V1:${input.businessDate.replace(/-/g, '')}:cross_match_mismatch`,
          walletRef: first.walletRef,
          coaCode: 'CROSS_REF',
          ownerNo: null,
        },
      });
      // Line items: one per leg in the group so operators see the divergent amounts.
      let lineNo = 0;
      const createdCase = await (this.prisma as any).reconciliationCase.findFirst({
        where: { caseNo },
        select: { id: true },
      });
      if (createdCase) {
        for (const leg of group) {
          lineNo += 1;
          await (this.prisma as any).reconciliationLineItem.create({
            data: {
              caseId: createdCase.id,
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
      opened += 1;
    }
    return opened;
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  private toBusinessDate(cutoff: Date): string {
    return cutoff.toISOString().slice(0, 10);
  }
}
