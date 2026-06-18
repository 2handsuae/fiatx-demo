import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../core/prisma/prisma.service';
import { InvariantResult } from '../engine/invariant-checker.service';
import { I5Result } from '../engine/balance-recon.service';
import { LineItemDraft } from '../engine/classifier.service';

@Injectable()
export class ReconciliationRecordService {
  constructor(private readonly prisma: PrismaService) {}

  async saveInvariantCheck(runId: string, r: InvariantResult | I5Result, tx?: Prisma.TransactionClient) {
    const db = tx ?? this.prisma;
    const lhs = 'lhsValue' in r ? r.lhsValue : r.tbAmount;
    const rhs = 'rhsValue' in r ? r.rhsValue : r.expectedExternal;
    const lhsLabel = 'lhsLabel' in r ? r.lhsLabel : 'TB 客户池';
    const rhsLabel = 'rhsLabel' in r ? r.rhsLabel : '外部+in-transit';
    return db.reconciliationInvariantCheck.create({
      data: {
        runId, invariantCode: r.invariantCode, currency: r.currency,
        lhsLabel, lhsValue: lhs, rhsLabel, rhsValue: rhs,
        delta: r.delta, status: r.status, severity: r.severity,
      },
    });
  }

  async saveLineItems(caseId: string, runId: string, drafts: LineItemDraft[], tx?: Prisma.TransactionClient) {
    const db = tx ?? this.prisma;
    let lineNo = 0;
    for (const d of drafts) {
      lineNo += 1;
      await db.reconciliationLineItem.create({
        data: {
          caseId, foundByRunId: runId, lineNo, matchStatus: d.matchStatus, status: 'OPEN',
          internalSourceType: d.internalSourceType, internalSourceId: d.internalSourceId, internalSourceNo: d.internalSourceNo,
          internalAmount: d.internalAmount, internalDirection: d.internalDirection, internalTxHash: d.internalTxHash,
          externalSource: d.externalSource, externalTxId: d.externalTxId, externalTxHash: d.externalTxHash,
          externalAmount: d.externalAmount, externalDirection: d.externalDirection, externalTimestamp: d.externalTimestamp,
        },
      });
    }
  }
}
