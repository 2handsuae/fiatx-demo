import { Module } from '@nestjs/common';
import { PrismaModule } from '../../core/prisma/prisma.module';
import { FundsFlowAggregatorPort } from './domain/funds-flow-aggregator.port';
import { FundsFlowService } from './domain/funds-flow.service';
import { InternalTransferService } from './domain/internal-transfer.service';
import { WhitelistGuard } from './guards/whitelist.guard';
import { FundsAccountingService } from './accounting/funds-accounting.service';
import { MockCustodianExecutionAdapter } from './adapters/mock-custodian-execution.adapter';
import { InternalTransferWorkflowService } from './workflow/internal-transfer-workflow.service';
import { FundTransferWorkflowService } from './workflow/fund-transfer-workflow.service';
import { DepositAggregationWorkflowService } from './workflow/deposit-aggregation-workflow.service';
import { DepositAggregationSweepService } from './sweep/deposit-aggregation-sweep.service';
import { SystemWalletResolver } from './domain/system-wallet-resolver.service';
import { InternalTransferAdminController } from './controllers/internal-transfer-admin.controller';
import { FundsSimulateController } from './controllers/funds-simulate.controller';
import { DepositTransactionsModule } from '../trading/deposit-transactions/deposit-transactions.module';

/**
 * V7 funds-layer module.
 *
 * AuditLogsService (AuditLogsModule) and EventEmitter2 (EventEmitterModule) are
 * both registered globally in app.module, so they resolve without explicit
 * imports here — only PrismaModule needs importing.
 *
 * Port binding: FundsFlowService injects the abstract FundsFlowAggregatorPort.
 * It is bound via `useExisting` to the concrete InternalTransferService (which
 * implements the port and does NOT inject FundsFlowService) — no circular DI.
 */
@Module({
  imports: [PrismaModule, DepositTransactionsModule],
  controllers: [InternalTransferAdminController, FundsSimulateController],
  providers: [
    FundsFlowService,
    InternalTransferService,
    WhitelistGuard,
    FundsAccountingService,
    MockCustodianExecutionAdapter,
    InternalTransferWorkflowService,
    FundTransferWorkflowService,
    SystemWalletResolver,
    DepositAggregationWorkflowService,
    DepositAggregationSweepService,
    { provide: FundsFlowAggregatorPort, useExisting: InternalTransferService },
  ],
  exports: [InternalTransferWorkflowService, FundTransferWorkflowService],
})
export class FundsLayerModule {}
