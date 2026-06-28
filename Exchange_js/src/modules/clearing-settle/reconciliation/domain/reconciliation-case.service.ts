import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../core/prisma/prisma.service';

export interface UpsertCaseInput {
  businessDate: string; assetId: string; assetCode: string; layer: string;
  /** CLIENT | FIRM（redesign per-book case）；null/undefined = legacy I1–I5 case。 */
  book?: 'CLIENT' | 'FIRM' | null;
  tbAmount: Prisma.Decimal; inTransitAmount: Prisma.Decimal;
  expectedExternal: Prisma.Decimal; actualExternal: Prisma.Decimal; deltaAmount: Prisma.Decimal;
  openedByRunId: string;
}

@Injectable()
export class ReconciliationCaseService {
  constructor(private readonly prisma: PrismaService) {}

  /** 同 (businessDate, assetId, book) 唯一：无则开仓 OPEN，有则复核更新 lastObservedRunId。 */
  async upsertOpen(input: UpsertCaseInput, tx?: Prisma.TransactionClient) {
    const db = tx ?? this.prisma;
    const book = input.book ?? null;
    // findFirst（非 findUnique）：复合唯一键含 nullable book，Prisma 生成的 compound input 把 book 收紧成
    // string（无法表达 null），且 SQL 下 `book = NULL` 永不命中；用 findFirst 才能正确匹配 legacy 的 book=null 行。
    const existing = await db.reconciliationCase.findFirst({
      where: { businessDate: input.businessDate, assetId: input.assetId, book },
    });
    if (existing) {
      return db.reconciliationCase.update({
        where: { id: existing.id },
        data: {
          tbAmount: input.tbAmount, inTransitAmount: input.inTransitAmount,
          expectedExternal: input.expectedExternal, actualExternal: input.actualExternal,
          deltaAmount: input.deltaAmount, lastObservedRunId: input.openedByRunId,
        },
      });
    }
    const priorToday = await db.reconciliationCase.count({ where: { businessDate: input.businessDate, assetCode: input.assetCode } });
    // caseNo 含 book 标记：CLIENT→C / FIRM→F / legacy→无后缀（REC-{date}-{ccy}-{C|F}-{nnn}）。
    const bookTag = book === 'CLIENT' ? '-C' : book === 'FIRM' ? '-F' : '';
    const caseNo = `REC-${input.businessDate.replace(/-/g, '')}-${input.assetCode}${bookTag}-${String(priorToday + 1).padStart(3, '0')}`;
    const sla = new Date(Date.now() + 24 * 3600 * 1000);
    return db.reconciliationCase.create({
      data: {
        caseNo, businessDate: input.businessDate, assetId: input.assetId, assetCode: input.assetCode, layer: input.layer, book,
        tbAmount: input.tbAmount, inTransitAmount: input.inTransitAmount,
        expectedExternal: input.expectedExternal, actualExternal: input.actualExternal, deltaAmount: input.deltaAmount,
        status: 'OPEN', openedByRunId: input.openedByRunId, lastObservedRunId: input.openedByRunId,
        slaDeadline: sla, traceId: randomUUID(),
      },
    });
  }
}
