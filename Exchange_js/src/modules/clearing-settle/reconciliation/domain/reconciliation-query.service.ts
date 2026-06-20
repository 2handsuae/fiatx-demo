import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../../core/prisma/prisma.service';

@Injectable()
export class ReconciliationQueryService {
  constructor(private readonly prisma: PrismaService) {}

  listRuns(q: { businessDate?: string; layer?: string }) {
    return this.prisma.reconciliationRun.findMany({
      where: { businessDate: q.businessDate, layer: q.layer },
      orderBy: [{ businessDate: 'desc' }, { layer: 'asc' }, { seq: 'desc' }],
    });
  }
  async getRun(runNo: string) {
    const run = await this.prisma.reconciliationRun.findUnique({
      where: { runNo }, include: { invariantChecks: true },
    });
    if (!run) throw new NotFoundException(`Run ${runNo} not found`);
    return run;
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

  listStatements(q: { source?: string }) {
    return this.prisma.reconciliationExternalStatement.findMany({
      where: { source: q.source },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, statementNo: true, source: true, businessDate: true,
        currency: true, accountRef: true, closingBalance: true, fetchedAt: true, createdAt: true,
      }, // NOT rawJson (big)
    });
  }

  async getStatement(statementNo: string) {
    const row = await this.prisma.reconciliationExternalStatement.findUnique({ where: { statementNo } });
    if (!row) throw new NotFoundException(`Statement ${statementNo} not found`);
    let parsed: unknown = null;
    try {
      const raw = JSON.parse(row.rawJson);
      if (row.source === 'ZAND') {
        parsed = { kind: 'ZAND', info: raw.StatementInfo, records: raw.StatementRecords ?? [] };
      } else {
        parsed = { kind: 'HEXTRUST', txs: Array.isArray(raw) ? raw : (raw.transactions ?? raw.data ?? []) };
      }
    } catch {
      parsed = { kind: row.source, parseError: true };
    }
    return { ...row, parsed };
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
