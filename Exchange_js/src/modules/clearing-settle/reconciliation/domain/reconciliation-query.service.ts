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
}
