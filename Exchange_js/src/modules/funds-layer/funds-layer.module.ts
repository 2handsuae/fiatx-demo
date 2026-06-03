import { Module } from '@nestjs/common';
import { PrismaModule } from '../../core/prisma/prisma.module';
import { FundsFlowAggregatorPort } from './domain/funds-flow-aggregator.port';
import { FundsFlowService } from './domain/funds-flow.service';
import { InternalTransferService } from './domain/internal-transfer.service';
import { WhitelistGuard } from './guards/whitelist.guard';
import { FundsAccountingService } from './accounting/funds-accounting.service';
import { MockCustodianExecutionAdapter } from './adapters/mock-custodian-execution.adapter';
import { InternalTransferWorkflowService } from './workflow/internal-transfer-workflow.service';
import { InternalTransferAdminController } from './controllers/internal-transfer-admin.controller';
import { FundsSimulateController } from './controllers/funds-simulate.controller';

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
  imports: [PrismaModule],
  controllers: [InternalTransferAdminController, FundsSimulateController],
  providers: [
    FundsFlowService,
    InternalTransferService,
    WhitelistGuard,
    FundsAccountingService,
    MockCustodianExecutionAdapter,
    InternalTransferWorkflowService,
    { provide: FundsFlowAggregatorPort, useExisting: InternalTransferService },
  ],
  exports: [InternalTransferWorkflowService],
})
export class FundsLayerModule {}
