import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../core/prisma/prisma.module';
import { AuditLogsModule } from '../../audit-logging/audit-logs.module';
import { BalanceSnapshotService } from './engine/balance-snapshot.service';
import { InvariantCheckerService } from './engine/invariant-checker.service';
import { CreditNetService } from './engine/credit-net.service';
import { FormulaCheckerService } from './engine/formula-checker.service';
import { SubledgerInputsService } from './engine/subledger-inputs.service';
import { InTransitService } from './engine/in-transit.service';
import { BalanceReconService } from './engine/balance-recon.service';
import { MatchEngineService } from './engine/match-engine.service';
import { ClassifierService } from './engine/classifier.service';
import { InternalActionsService } from './engine/internal-actions.service';
import { MockExternalAdapter } from './adapters/mock-external.adapter';
import { EXTERNAL_BALANCE_PROVIDER, EXTERNAL_TX_PROVIDER } from './adapters/external-data.provider';
import { ReconciliationRunService } from './domain/reconciliation-run.service';
import { ReconciliationCaseService } from './domain/reconciliation-case.service';
import { ReconciliationRecordService } from './domain/reconciliation-record.service';
import { ReconciliationQueryService } from './domain/reconciliation-query.service';
import { ReconciliationRunWorkflowService } from './workflow/reconciliation-run-workflow.service';
import { FormulaReconService } from './workflow/formula-recon.service';
import { ReconciliationSweepService } from './sweep/reconciliation-sweep.service';
import { ReconciliationAdminController } from './controllers/reconciliation-admin.controller';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [ReconciliationAdminController],
  providers: [
    BalanceSnapshotService, InvariantCheckerService, InTransitService, BalanceReconService,
    CreditNetService, FormulaCheckerService, SubledgerInputsService, FormulaReconService,
    MatchEngineService, ClassifierService, InternalActionsService,
    MockExternalAdapter,
    { provide: EXTERNAL_BALANCE_PROVIDER, useExisting: MockExternalAdapter },
    { provide: EXTERNAL_TX_PROVIDER, useExisting: MockExternalAdapter },
    ReconciliationRunService, ReconciliationCaseService, ReconciliationRecordService, ReconciliationQueryService,
    ReconciliationRunWorkflowService, ReconciliationSweepService,
  ],
  exports: [ReconciliationRunWorkflowService],
})
export class ReconciliationModule {}
