// src/modules/clearing-settle/reconciliation/projector/account-flow-projector.service.ts
//
// Phase B / T3: projects each TbTransferEvidence row into 2 AccountFlow rows
// (debit→OUT, credit→IN). Lets per-wallet drill-down do a single indexed query
// instead of OR-filtering tb_transfer_evidence + computing direction at read
// time.
//
// Idempotency: `(tbTransferId, tbAccountId)` is unique. Both `persist` and the
// backfill are safe to call repeatedly — re-projection (e.g. enrichForPost
// promoting LOCK→POST) updates the existing rows to reflect new evidence
// fields.

import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export interface EvidenceLike {
  tbTransferId: string;
  sourceType: string;
  sourceNo: string;
  eventCode: string;
  debitTbAccountId: string | null;
  creditTbAccountId: string | null;
  amount: number | Prisma.Decimal | string;
  assetCode: string;
  transferType: string;
  createdAt: Date | string;
  debitWalletRef?: string | null;
  creditWalletRef?: string | null;
  externalRef?: string | null;
  isExternalCrossing?: boolean | null;
}

export interface AccountFlowRow {
  tbTransferId: string;
  tbAccountId: string;
  walletRef: string | null;
  direction: 'IN' | 'OUT';
  amount: number | Prisma.Decimal | string;
  isExternalCrossing: boolean;
  externalRef: string | null;
  eventCode: string;
  sourceType: string;
  sourceNo: string;
  transferType: string;
  assetCode: string;
  createdAt: Date;
}

// Narrow client surface — accepts both PrismaClient and Prisma.TransactionClient.
type AccountFlowClient = {
  accountFlow: {
    upsert: (args: any) => Promise<any>;
  };
};

@Injectable()
export class AccountFlowProjectorService {
  /**
   * Pure projection: evidence → 2 flow rows (debit→OUT, credit→IN).
   * If a side has no TB account id (legacy / partial rows), that side is
   * dropped — the unique index would reject `tbAccountId = null` anyway.
   */
  projectEvidence(evidence: EvidenceLike): AccountFlowRow[] {
    const createdAt = evidence.createdAt instanceof Date
      ? evidence.createdAt
      : new Date(evidence.createdAt);
    const isExternalCrossing = evidence.isExternalCrossing === true;
    const shared = {
      tbTransferId: evidence.tbTransferId,
      amount: evidence.amount,
      isExternalCrossing,
      externalRef: evidence.externalRef ?? null,
      eventCode: evidence.eventCode,
      sourceType: evidence.sourceType,
      sourceNo: evidence.sourceNo,
      transferType: evidence.transferType,
      assetCode: evidence.assetCode,
      createdAt,
    };

    const rows: AccountFlowRow[] = [];

    if (evidence.debitTbAccountId) {
      rows.push({
        ...shared,
        tbAccountId: evidence.debitTbAccountId,
        walletRef: evidence.debitWalletRef ?? null,
        direction: 'OUT',
      });
    }

    if (evidence.creditTbAccountId) {
      rows.push({
        ...shared,
        tbAccountId: evidence.creditTbAccountId,
        walletRef: evidence.creditWalletRef ?? null,
        direction: 'IN',
      });
    }

    return rows;
  }

  /**
   * Idempotent upsert of the 2 projection rows. `where` uses the
   * (tbTransferId, tbAccountId) unique constraint so re-projection updates
   * the existing rows rather than inserting duplicates.
   *
   * The caller is responsible for atomicity with the evidence write — pass
   * the same Prisma.TransactionClient so the evidence row and its 2 flow
   * rows commit together.
   */
  async persist(client: AccountFlowClient, evidence: EvidenceLike): Promise<void> {
    const rows = this.projectEvidence(evidence);
    for (const row of rows) {
      await client.accountFlow.upsert({
        where: {
          tbTransferId_tbAccountId: {
            tbTransferId: row.tbTransferId,
            tbAccountId: row.tbAccountId,
          },
        },
        create: row,
        update: {
          walletRef: row.walletRef,
          direction: row.direction,
          amount: row.amount,
          isExternalCrossing: row.isExternalCrossing,
          externalRef: row.externalRef,
          eventCode: row.eventCode,
          sourceType: row.sourceType,
          sourceNo: row.sourceNo,
          transferType: row.transferType,
          assetCode: row.assetCode,
          // createdAt intentionally NOT updated — preserves the original
          // evidence timestamp across re-projections (LOCK→POST etc.).
        },
      });
    }
  }
}
