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
// R2 invariant guard reads wallet + tbAccountRegistry, so both lookups are part
// of the client contract.
type AccountFlowClient = {
  accountFlow: {
    upsert: (args: any) => Promise<any>;
  };
  wallet: {
    findUnique: (args: any) => Promise<any>;
  };
  tbAccountRegistry: {
    findUnique: (args: any) => Promise<any>;
  };
};

/**
 * R2 invariant violation: AccountFlow row would be written with a walletRef
 * that either dangles (no wallets row) or whose owner doesn't match the
 * tbAccountRegistry entry for the row's tbAccountId.
 *
 * Throwing this stops persistence — the projection row never lands in
 * account_flows, so downstream wallet-balance / reconciliation read paths
 * never see the corrupt link. Caller must surface this to the upstream
 * service (withdraw / swap workflow etc.) so the writer's bug, not the
 * projector, is fixed.
 *
 * Aggregate accounts (CLIENT_ASSET code=1, FIRM_ASSET code=50) carry no
 * owner — the assertion skips them.
 */
export class WalletRefMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WalletRefMismatchError';
  }
}

// TB account codes that represent firm-wide aggregate ledgers (no per-customer
// owner attached). Per-row owner check is meaningless for these — skip.
const AGGREGATE_TB_CODES = new Set<number>([
  1,  // CLIENT_ASSET aggregate
  50, // FIRM_ASSET aggregate
]);

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
   *
   * R2 guard: each row's (walletRef, tbAccountId) pair is validated before
   * write. Mismatch → `WalletRefMismatchError`, no row persists.
   */
  async persist(client: AccountFlowClient, evidence: EvidenceLike): Promise<void> {
    const rows = this.projectEvidence(evidence);
    for (const row of rows) {
      // R2 guard runs BEFORE upsert so corrupt projections never land in
      // account_flows (which would then poison wallet-balance + reconciliation
      // reads downstream).
      await this.assertWalletRefMatchesTbAccount(client, row.walletRef, row.tbAccountId);

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

  /**
   * R2 invariant: walletRef in account_flows must (a) resolve to a real
   * wallets row, and (b) for per-customer/per-firm accounts, the wallet's
   * owner must equal the tbAccountRegistry owner for the row's tbAccountId.
   *
   * Skipped cases (intentional, mirrors verify-demo-data scanner):
   *   - walletRef is null → not an R2 violation; null walletRef is its own
   *     class of bookkeeping flaw handled elsewhere.
   *   - tbAccountId not in registry → can't disprove ownership, let it pass.
   *   - Registry row is an aggregate ledger (code 1 / 50) → no owner attached.
   *
   * Thrown:
   *   - wallets has no row for walletRef (dangling pointer).
   *   - per-owner account but wallet.(ownerType, ownerNo) doesn't match
   *     registry.(ownerType, ownerNo).
   */
  private async assertWalletRefMatchesTbAccount(
    client: AccountFlowClient,
    walletRef: string | null,
    tbAccountId: string,
  ): Promise<void> {
    if (!walletRef) return;

    const wallet = await client.wallet.findUnique({
      where: { id: walletRef },
      select: { id: true, ownerType: true, ownerNo: true },
    });
    if (!wallet) {
      throw new WalletRefMismatchError(
        `R2: walletRef=${walletRef} (for tbAccountId=${tbAccountId}) ` +
          `does not exist in wallets table — dangling reference would corrupt ` +
          `wallet-statement and reconciliation reads.`,
      );
    }

    const registry = await client.tbAccountRegistry.findUnique({
      where: { tbAccountId },
      select: { code: true, ownerType: true, ownerNo: true },
    });
    if (!registry) return; // no registry entry → cannot enforce ownership

    if (AGGREGATE_TB_CODES.has(registry.code)) return; // aggregate ledger, owner-free

    const walletOwnerType = wallet.ownerType ?? null;
    const walletOwnerNo = wallet.ownerNo ?? null;
    const regOwnerType = registry.ownerType ?? null;
    const regOwnerNo = registry.ownerNo ?? null;

    // Firm-side owner口径不统一：wallets 表把 firm wallet 标 'PLATFORM'，
    // tb_account_registry 把 firm-side 账户标 'SYSTEM'。两者业务上是同一回事
    // (都是 firm 内部账户，不属于客户)。统一对待，避免在合法的 firm-leg 上
    // 误抛 R2。客户腿仍严卡 (ownerType=CUSTOMER + ownerNo 必须一致)。
    const FIRM_SIDE = new Set(['PLATFORM', 'SYSTEM']);
    const bothFirmSide =
      FIRM_SIDE.has(walletOwnerType ?? '') && FIRM_SIDE.has(regOwnerType ?? '');
    if (bothFirmSide) return;

    if (walletOwnerType !== regOwnerType || walletOwnerNo !== regOwnerNo) {
      throw new WalletRefMismatchError(
        `R2: walletRef=${walletRef} (owner=${walletOwnerType}/${walletOwnerNo ?? 'NULL'}) ` +
          `does not match tbAccountId=${tbAccountId} ` +
          `(registry owner=${regOwnerType}/${regOwnerNo ?? 'NULL'}, code=${registry.code}). ` +
          `This would mis-attribute a flow to the wrong account in account_flows.`,
      );
    }
  }
}
