import { Module } from '@nestjs/common';
import { PrismaModule } from '../../core/prisma/prisma.module';
import { SystemWalletResolver } from './domain/system-wallet-resolver.service';
import { FirmWalletPickerService } from './domain/firm-wallet-picker.service';

/**
 * Funds-layer module (Round 2).
 *
 * The V7/V8 delayed-settlement machinery (settlement/fee-collection/transfer
 * workflows, InternalTransfer/SettlementBatch/FeeAccrual/Outstanding domain
 * services + their admin surfaces) was removed in C5b. The funds_orders admin
 * read surface moved to FundsOrdersModule in C6. What remains is
 * SystemWalletResolver, which live swap (SwapLegAccounting) and withdraw
 * (WithdrawWorkflowService) still resolve platform/customer wallets through.
 *
 * 戊波二 T3: FirmWalletPickerService — the shared "is the chosen from wallet allowed" guard that the
 * asset-treasury orders (vendor payment / house transfer / shortfall top-up) inject.
 */
@Module({
  imports: [PrismaModule],
  providers: [SystemWalletResolver, FirmWalletPickerService],
  exports: [SystemWalletResolver, FirmWalletPickerService],
})
export class FundsLayerModule {}
