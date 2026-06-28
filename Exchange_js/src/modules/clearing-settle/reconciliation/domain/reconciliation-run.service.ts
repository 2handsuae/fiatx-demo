import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../core/prisma/prisma.service';

export interface CreateRunInput {
  businessDate: string; layer: string; triggerType: string; mode: 'DRY_RUN' | 'APPLY';
  demoManifest?: string | null;
}

@Injectable()
export class ReconciliationRunService {
  constructor(private readonly prisma: PrismaService) {}

  async createRun(input: CreateRunInput, tx?: Prisma.TransactionClient) {
    const db = tx ?? this.prisma;
    const prior = await db.reconciliationRun.count({
      where: { businessDate: input.businessDate, layer: input.layer },
    });
    const seq = prior + 1;
    const runNo = `RUN-${input.businessDate.replace(/-/g, '')}-${input.layer}-${seq}`;
    return db.reconciliationRun.create({
      data: {
        runNo, businessDate: input.businessDate, layer: input.layer, seq,
        triggerType: input.triggerType, mode: input.mode, status: 'RUNNING',
        traceId: randomUUID(),
        demoManifest: input.demoManifest ?? null,
      },
    });
  }

  async finish(
    runId: string,
    data: { status: string; invariantStatus: string; openedCount: number; reObservedCount: number; closedCount: number },
    tx?: Prisma.TransactionClient,
  ) {
    const db = tx ?? this.prisma;
    return db.reconciliationRun.update({
      where: { id: runId },
      data: { ...data, completedAt: new Date() },
    });
  }
}
