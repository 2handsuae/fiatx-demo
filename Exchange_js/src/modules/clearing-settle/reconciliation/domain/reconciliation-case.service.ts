import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../core/prisma/prisma.service';

export interface UpsertCaseInput {
  businessDate: string; assetId: string; assetCode: string; layer: string;
  tbAmount: Prisma.Decimal; inTransitAmount: Prisma.Decimal;
  expectedExternal: Prisma.Decimal; actualExternal: Prisma.Decimal; deltaAmount: Prisma.Decimal;
  openedByRunId: string;
}

@Injectable()
export class ReconciliationCaseService {
  constructor(private readonly prisma: PrismaService) {}

  /** 同 (businessDate, assetId) 唯一：无则开仓 OPEN，有则复核更新 lastObservedRunId。 */
  async upsertOpen(input: UpsertCaseInput, tx?: Prisma.TransactionClient) {
    const db = tx ?? this.prisma;
    const existing = await db.reconciliationCase.findUnique({
      where: { businessDate_assetId: { businessDate: input.businessDate, assetId: input.assetId } },
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
    const caseNo = `REC-${input.businessDate.replace(/-/g, '')}-${input.assetCode}-${String(priorToday + 1).padStart(3, '0')}`;
    const sla = new Date(Date.now() + 24 * 3600 * 1000);
    return db.reconciliationCase.create({
      data: {
        caseNo, businessDate: input.businessDate, assetId: input.assetId, assetCode: input.assetCode, layer: input.layer,
        tbAmount: input.tbAmount, inTransitAmount: input.inTransitAmount,
        expectedExternal: input.expectedExternal, actualExternal: input.actualExternal, deltaAmount: input.deltaAmount,
        status: 'OPEN', openedByRunId: input.openedByRunId, lastObservedRunId: input.openedByRunId,
        slaDeadline: sla, traceId: `V8:${input.layer}:${input.businessDate.replace(/-/g, '')}`,
      },
    });
  }
}
