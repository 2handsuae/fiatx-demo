import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../../core/prisma/prisma.service';

// ── Types used by pairManifest ────────────────────────────────────────────────

export interface ManifestBreak {
  currency: string;
  book: string;
  bucket: string;       // ORPHAN_INTERNAL | ORPHAN_EXTERNAL | AMOUNT_MISMATCH
  targetType: string;
  targetRef: string;
  internalAmount: string | null;
  externalAmount: string | null;
  signedDelta: string;
  note: string;
}

/** Line-item annotated with its parent case's assetCode and book. */
export interface AnnotatedLineItem {
  id: string;
  matchStatus: string;
  internalSourceNo: string | null;
  internalTxHash: string | null;
  externalTxId: string | null;    // external booking/tx id (legacy "externalRef" in task doc)
  externalTxHash: string | null;
  internalAmount: unknown;
  externalAmount: unknown;
  _currency: string;
  _book: string;
  [key: string]: unknown;
}

export interface PairResult {
  matched: Array<{ break: ManifestBreak; item: AnnotatedLineItem }>;
  missed: ManifestBreak[];
  extra: AnnotatedLineItem[];
}

/**
 * Primary amount for pairing: prefer internalAmount (present for ORPHAN_INTERNAL and
 * AMOUNT_MISMATCH); fall back to externalAmount (present for ORPHAN_EXTERNAL).
 * Returns null when neither is available (treated as non-matchable).
 */
function primaryAmount(internalAmount: unknown, externalAmount: unknown): string | null {
  if (internalAmount != null) return String(internalAmount);
  if (externalAmount != null) return String(externalAmount);
  return null;
}

const AMOUNT_TOLERANCE = 1e-6;

function amountsEqual(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return false;
  return Math.abs(parseFloat(a) - parseFloat(b)) < AMOUNT_TOLERANCE;
}

/**
 * Pure function — no DB access.
 * Key = (currency, book, bucket, primaryAmount).
 * A manifest break matches a line-item when:
 *   - same currency  (_currency === break.currency)
 *   - same book      (_book ?? '' === break.book ?? '')
 *   - same bucket    (matchStatus === break.bucket)
 *   - primaryAmount(break) ≈ primaryAmount(item)  (within 1e-6)
 *
 * primaryAmount = internalAmount if present, else externalAmount.
 * This is rail-agnostic: CRYPTO can ref-match coincidentally, but FIAT cannot
 * (the engine assigns payinNo/UUIDs the manifest never knows).
 *
 * targetRef and line-item ref fields are preserved in returned data for DISPLAY,
 * but are NOT used as the match key.
 *
 * Each item may be claimed by at most one break (first-come, first-served).
 */
export function pairManifest(
  breaks: ManifestBreak[],
  items: AnnotatedLineItem[],
): PairResult {
  const unclaimedItems = new Set(items.map((_, i) => i));
  const matched: PairResult['matched'] = [];
  const missed: ManifestBreak[] = [];

  for (const brk of breaks) {
    const brkAmount = primaryAmount(brk.internalAmount, brk.externalAmount);
    let found = -1;
    for (const idx of unclaimedItems) {
      const item = items[idx];
      const itemAmount = primaryAmount(item.internalAmount, item.externalAmount);
      if (
        item._currency === brk.currency &&
        (item._book ?? '') === (brk.book ?? '') &&
        item.matchStatus === brk.bucket &&
        amountsEqual(brkAmount, itemAmount)
      ) {
        found = idx;
        break;
      }
    }
    if (found >= 0) {
      matched.push({ break: brk, item: items[found] });
      unclaimedItems.delete(found);
    } else {
      missed.push(brk);
    }
  }

  const extra = [...unclaimedItems].map((i) => items[i]);
  return { matched, missed, extra };
}

@Injectable()
export class ReconciliationQueryService {
  constructor(private readonly prisma: PrismaService) {}

  listRuns(q: { businessDate?: string; layer?: string; engineVersion?: string }) {
    return this.prisma.reconciliationRun.findMany({
      where: {
        businessDate: q.businessDate,
        layer: q.layer,
        // engineVersion: omit when undefined → all engines; pass-through when supplied.
        engineVersion: q.engineVersion,
      },
      orderBy: [{ businessDate: 'desc' }, { layer: 'asc' }, { seq: 'desc' }],
    });
  }
  async getRun(runNo: string) {
    const run = await this.prisma.reconciliationRun.findUnique({
      where: { runNo }, include: { invariantChecks: true },
    });
    if (!run) throw new NotFoundException(`Run ${runNo} not found`);
    // Cases this run last touched — lets the run-detail scorecard link a failing
    // (currency, book) cell straight to its case. Same join as getLatestRedesignRun;
    // no lineItems (the link only needs caseNo). Harmless for legacy I1–I5 runs.
    const cases = await this.prisma.reconciliationCase.findMany({
      where: { lastObservedRunId: run.id },
      orderBy: [{ assetCode: 'asc' }, { book: 'asc' }],
      select: { caseNo: true, assetCode: true, book: true, status: true, deltaAmount: true },
    });
    return { ...run, hasDemoManifest: run.demoManifest !== null, cases };
  }
  listCases(q: { status?: string; assetCode?: string }) {
    return this.prisma.reconciliationCase.findMany({
      where: { status: q.status, assetCode: q.assetCode },
      orderBy: { createdAt: 'desc' },
    });
  }
  async getCase(caseNo: string) {
    const kase = await this.prisma.reconciliationCase.findUnique({
      where: { caseNo }, include: { lineItems: true },
    });
    if (!kase) throw new NotFoundException(`Case ${caseNo} not found`);
    return kase;
  }

  listExternalBalances(q: { cutoffDate?: string; book?: string; source?: string; currency?: string }) {
    return this.prisma.externalBalance.findMany({
      where: { cutoffDate: q.cutoffDate, book: q.book, source: q.source, currency: q.currency },
      orderBy: [{ book: 'asc' }, { source: 'asc' }, { currency: 'asc' }, { accountRef: 'asc' }],
    });
  }

  async getExternalBalance(statementId: string) {
    // Keyed by statementId (business key STMT-{date}-{source}-{accountSlug}); the UUID id is not URL-exposed.
    const balance = await this.prisma.externalBalance.findFirst({ where: { statementId } });
    if (!balance) throw new NotFoundException(`External balance ${statementId} not found`);
    // Lines carry no FK to the balance; join on the same dimensions (source + account + currency)
    // AND scope to the balance's business day (cutoffDate) — otherwise multi-day history bleeds
    // into one statement and the roll-forward self-check (opening + Σnet = closing) is wrong.
    const dayLo = new Date(`${balance.cutoffDate}T00:00:00.000Z`);
    const dayHi = new Date(`${balance.cutoffDate}T23:59:59.999Z`);
    const lines = await this.prisma.externalStatementLine.findMany({
      where: {
        source: balance.source,
        accountRef: balance.accountRef,
        currency: balance.currency,
        datetime: { gte: dayLo, lte: dayHi },
      },
      orderBy: { datetime: 'asc' },
    });
    return { ...balance, lines };
  }

  /**
   * Demo compare: pairs the injected break manifest stored on a run against
   * the engine-detected case line-items.  Returns the run summary, the raw
   * manifest breaks, the detected line-items (annotated with currency/book),
   * and the pairing result { matched, missed, extra }.
   */
  async getDemoCompare(runNo: string) {
    const run = await this.prisma.reconciliationRun.findUnique({ where: { runNo } });
    if (!run) throw new NotFoundException(`Run ${runNo} not found`);

    const breaks: ManifestBreak[] = run.demoManifest
      ? (JSON.parse(run.demoManifest) as { breaks: ManifestBreak[] }).breaks ?? []
      : [];

    const cases = await this.prisma.reconciliationCase.findMany({
      where: { lastObservedRunId: run.id },
      include: { lineItems: { where: { foundByRunId: run.id }, orderBy: { lineNo: 'asc' } } },
    });

    // Flatten line-items annotated with their parent case's currency and book.
    const detected: AnnotatedLineItem[] = [];
    for (const kase of cases) {
      for (const item of kase.lineItems) {
        detected.push({ ...item, _currency: kase.assetCode, _book: kase.book ?? '' });
      }
    }

    const reconciliation = pairManifest(breaks, detected);

    return {
      run: {
        runNo: run.runNo,
        businessDate: run.businessDate,
        status: run.status,
        invariantStatus: run.invariantStatus,
      },
      manifest: breaks,
      detected,
      reconciliation,
    };
  }

  /**
   * 对账重构（redesign，layer=REDESIGN）最新一次 run 的完整结果（G6）：
   *   run 行 + 五公式 checks（按币种分组 式1..式5）+ cases（含 bucketed line items）。
   * 给 admin Run detail 展示五公式 checklist + 四桶下钻。无 redesign run 时返回 null（前端显示空态）。
   * @param businessDate 可选，限定业务日；不传取全局最新。
   */
  async getLatestRedesignRun(businessDate?: string) {
    const run = await this.prisma.reconciliationRun.findFirst({
      where: { layer: 'REDESIGN', businessDate },
      orderBy: [{ businessDate: 'desc' }, { seq: 'desc' }],
      include: { invariantChecks: true },
    });
    if (!run) return null;

    // 用 lastObservedRunId（本 run 最近触达的 case），不用 openedByRunId：
    // ReconciliationCase 按 (businessDate, assetId, book) 唯一，跨旧 I1-I5 路径与本 redesign 路径共享，
    // 老 case 的 openedByRunId 指向旧 run；upsertOpen 把 lastObservedRunId 刷成当前 run。
    // 现按 book 拆 case：一个币种可同时有 CLIENT case 与 FIRM case，各持本 book 的账外式 + 桶 line items。
    const cases = await this.prisma.reconciliationCase.findMany({
      where: { lastObservedRunId: run.id },
      orderBy: [{ assetCode: 'asc' }, { book: 'asc' }],
      include: { lineItems: { where: { foundByRunId: run.id }, orderBy: { lineNo: 'asc' } } },
    });

    // 五公式按币种分组（式1..式5），便于前端逐币种渲染 checklist。
    const formulasByCurrency: Record<string, typeof run.invariantChecks> = {};
    for (const chk of run.invariantChecks) {
      (formulasByCurrency[chk.currency] ??= []).push(chk);
    }

    return { run, formulasByCurrency, cases };
  }
}
