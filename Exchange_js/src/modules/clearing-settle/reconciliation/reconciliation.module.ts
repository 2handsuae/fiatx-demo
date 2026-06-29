import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../core/prisma/prisma.module';
import { AuditLogsModule } from '../../audit-logging/audit-logs.module';
// Phase B / T7: WalletReconRunService needs TigerBeetleService for the
// internal-identity pre-gate (mirrors scripts/verify-realtime-coa.ts).
import { TigerBeetleModule } from '../../accounting/tigerbeetle/tigerbeetle.module';
import { BalanceSnapshotService } from './engine/balance-snapshot.service';
import { SubledgerInputsService } from './engine/subledger-inputs.service';
import { InTransitService } from './engine/in-transit.service';
import { BalanceReconService } from './engine/balance-recon.service';
import { MatchEngineService } from './engine/match-engine.service';
import { ClassifierService } from './engine/classifier.service';
import { InternalActionsService } from './engine/internal-actions.service';
import { LegProjectionService } from './engine/leg-projection.service';
import { MatchEngineV2Service } from './engine/match-engine-v2.service';
import { AnomalyClassifierService } from './engine/anomaly-classifier.service';
import { DrilldownMatchService } from './engine/drilldown-match.service';
import { MockExternalAdapter } from './adapters/mock-external.adapter';
import { EXTERNAL_BALANCE_PROVIDER, EXTERNAL_TX_PROVIDER } from './adapters/external-data.provider';
import { ReconciliationQueryService } from './domain/reconciliation-query.service';
import { WalletReconRunService } from './workflow/wallet-recon-run.service';
import { WalletBalanceCheckerService } from './engine/v2/wallet-balance-checker.service';
import { WalletFlowMatcherService } from './engine/v2/wallet-flow-matcher.service';
import { ReconciliationSweepService } from './sweep/reconciliation-sweep.service';
import { ReconciliationAdminController } from './controllers/reconciliation-admin.controller';

@Module({
  imports: [PrismaModule, AuditLogsModule, TigerBeetleModule],
  controllers: [ReconciliationAdminController],
  providers: [
    BalanceSnapshotService, InTransitService, BalanceReconService,
    SubledgerInputsService,
    MatchEngineService, ClassifierService, InternalActionsService,
    LegProjectionService, MatchEngineV2Service, AnomalyClassifierService, DrilldownMatchService,
    MockExternalAdapter,
    { provide: EXTERNAL_BALANCE_PROVIDER, useExisting: MockExternalAdapter },
    { provide: EXTERNAL_TX_PROVIDER, useExisting: MockExternalAdapter },
    ReconciliationQueryService,
    ReconciliationSweepService,
    // Phase B / T7 — per-wallet engine (sole live recon path; V8 chain removed in Phase C/A.1).
    WalletBalanceCheckerService, WalletFlowMatcherService, WalletReconRunService,
  ],
  exports: [WalletReconRunService],
})
export class ReconciliationModule {}
