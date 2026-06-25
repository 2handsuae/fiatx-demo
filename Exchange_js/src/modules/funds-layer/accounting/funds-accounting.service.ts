// DEAD (real-time 1:1 model) — neutered in Phase A, delete in Phase C
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

type ApplyResult =
  | { tbApplied: false }
  | { tbApplied: true; tbTransferId: bigint };

@Injectable()
export class FundsAccountingService {
  /**
   * DEPRECATED: legacy two-book physical mirror (SETTLE_POOL_TO_FIRM /
   * FEE_DECOMMINGLE). Replaced by the real-time 1:1 model in Phase A; the
   * deposit/withdraw/swap flows now book TB directly. Slated for removal in
   * Phase C along with this service and its module wiring.
   */
  async mirrorPhysicalTransfer(_input: {
    internalTransferId: string;
    tx?: Prisma.TransactionClient;
  }): Promise<ApplyResult> {
    throw new Error(
      'deprecated: replaced by real-time 1:1 model (Phase A); slated for removal in Phase C',
    );
  }
}
