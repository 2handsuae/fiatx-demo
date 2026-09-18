import { Module } from '@nestjs/common';
import { PrismaModule } from '../../core/prisma/prisma.module';
import { SystemWalletResolver } from './domain/system-wallet-resolver.service';

/**
 * Funds-layer module (Round 2).
 *
 * The V7/V8 delayed-settlement machinery (settlement/fee-collection/transfer
 * workflows, InternalTransfer/SettlementBatch/FeeAccrual/Outstanding domain
 * services + their admin surfaces) was removed in C5b. The funds_orders admin
 * read surface moved to FundsOrdersModule in C6. What remains is
 * SystemWalletResolver, which live swap (SwapLegAccounting) and withdraw
 * (WithdrawWorkflowService) still resolve platform/customer wallets through.
 */
@Module({
  imports: [PrismaModule],
  providers: [SystemWalletResolver],
  exports: [SystemWalletResolver],
})
export class FundsLayerModule {}
