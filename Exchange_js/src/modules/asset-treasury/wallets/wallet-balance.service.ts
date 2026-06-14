import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';

/**
 * Mock wallet-balance ledger.
 *
 * Adjusts `Wallet.mockBalance` by a signed delta. Intentionally a pure ledger:
 * NO balance validation and negative results are allowed (no overdraft guard,
 * no retry/rollback). Callers invoke this inside their own state-machine
 * transaction at the terminal (CLEAR/CLEARED) transition so the mutation is
 * atomic and applied exactly once per transition.
 */
@Injectable()
export class WalletBalanceService {
  constructor(private readonly prisma: PrismaService) {}

  async adjust(
    walletId: string | null | undefined,
    delta: Prisma.Decimal,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    if (!walletId) return;
    if (delta.isZero()) return;
    await (tx as any).wallet.update({
      where: { id: walletId },
      data: { mockBalance: { increment: delta } },
    });
  }
}
