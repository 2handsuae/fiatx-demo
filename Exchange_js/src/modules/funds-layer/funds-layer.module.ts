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
import { EodSettlementSweepService } from './sweep/eod-settlement-sweep.service';
import { FeeCollectionSweepService } from './sweep/fee-collection-sweep.service';
import { SystemWalletResolver } from './domain/system-wallet-resolver.service';
import { SettlementBatchService } from './domain/settlement-batch.service';
import { OutstandingConsumerService } from './domain/outstanding-consumer.service';
import { DepositAggregationSourceService } from './domain/deposit-aggregation-source.service';
import { FeeAccrualService } from './domain/fee-accrual.service';
import { EodSettlementWorkflowService } from './workflow/eod-settlement-workflow.service';
import { FeeCollectionWorkflowService } from './workflow/fee-collection-workflow.service';
import { FiatSettlementWorkflowService } from './workflow/fiat-settlement-workflow.service';
import { FiatFeeCollectionWorkflowService } from './workflow/fiat-fee-collection-workflow.service';
import { FeeAccrualListenerService } from './workflow/fee-accrual-listener.service';
import { InternalTransferAdminController } from './controllers/internal-transfer-admin.controller';
import { FundsSimulateController } from './controllers/funds-simulate.controller';
import { FundReturnRepairController } from './controllers/fund-return-repair.controller';
import { SettlementAdminController } from './controllers/settlement-admin.controller';
import { FundsAdminController } from './controllers/funds-admin.controller';
import { TigerBeetleModule } from '../accounting/tigerbeetle/tigerbeetle.module';
import { PricingCenterModule } from '../trading/pricing-center/pricing-center.module';
import { FxEodService } from './accounting/fx-eod.service';
import { WalletsModule } from '../asset-treasury/wallets/wallets.module';

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
  imports: [PrismaModule, TigerBeetleModule, PricingCenterModule, WalletsModule],
  controllers: [
    InternalTransferAdminController,
    FundsSimulateController,
    FundReturnRepairController,
    SettlementAdminController,
    FundsAdminController,
  ],
  providers: [
    FundsFlowService,
    InternalTransferService,
    WhitelistGuard,
    FundsAccountingService,
    FxEodService,
    MockCustodianExecutionAdapter,
    InternalTransferWorkflowService,
    FundTransferWorkflowService,
    SystemWalletResolver,
    DepositAggregationWorkflowService,
    DepositAggregationSweepService,
    SettlementBatchService,
    OutstandingConsumerService,
    DepositAggregationSourceService,
    FeeAccrualService,
    EodSettlementWorkflowService,
    EodSettlementSweepService,
    FeeCollectionWorkflowService,
    FeeCollectionSweepService,
    FiatSettlementWorkflowService,
    FiatFeeCollectionWorkflowService,
    FeeAccrualListenerService,
    { provide: FundsFlowAggregatorPort, useExisting: InternalTransferService },
  ],
  exports: [
    InternalTransferWorkflowService,
    FundTransferWorkflowService,
    EodSettlementWorkflowService,
  ],
})
export class FundsLayerModule {}
