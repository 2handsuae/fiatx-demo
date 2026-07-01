import { Module } from '@nestjs/common';
import { PrismaModule } from '../../core/prisma/prisma.module';
import { FundsFlowService } from './domain/funds-flow.service';
import { SystemWalletResolver } from './domain/system-wallet-resolver.service';
import { FundsAdminController } from './controllers/funds-admin.controller';

/**
 * Funds-layer module (Round 2).
 *
 * The V7/V8 delayed-settlement machinery (settlement/fee-collection/transfer
 * workflows, InternalTransfer/SettlementBatch/FeeAccrual/Outstanding domain
 * services + their admin surfaces) was removed in C5b. What remains is the
 * funds_orders admin read surface plus SystemWalletResolver, which live swap
 * (SwapLegAccounting) and withdraw (WithdrawWorkflowService) still resolve
 * platform/customer wallets through.
 */
@Module({
  imports: [PrismaModule],
  controllers: [FundsAdminController],
  providers: [FundsFlowService, SystemWalletResolver],
  exports: [SystemWalletResolver],
})
export class FundsLayerModule {}
