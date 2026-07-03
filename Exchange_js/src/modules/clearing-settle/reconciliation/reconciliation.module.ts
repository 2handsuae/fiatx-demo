import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../core/prisma/prisma.module';
import { AuditLogsModule } from '../../audit-logging/audit-logs.module';
// Phase B / T7: WalletReconRunService needs TigerBeetleService for the
// internal-identity pre-gate (mirrors scripts/verify-realtime-coa.ts).
import { TigerBeetleModule } from '../../accounting/tigerbeetle/tigerbeetle.module';
// Phase B / Round 3: WalletFlowMatcherService needs FundsOrderService for
// the in-transit third pass (orphan external line ↔ non-terminal funds order).
import { FundsOrdersModule } from '../../funds-orders/funds-orders.module';
import { ReconciliationQueryService } from './domain/reconciliation-query.service';
import { WalletReconRunService } from './workflow/wallet-recon-run.service';
import { WalletBalanceCheckerService } from './engine/v2/wallet-balance-checker.service';
import { WalletFlowMatcherService } from './engine/v2/wallet-flow-matcher.service';
import { ReconciliationSweepService } from './sweep/reconciliation-sweep.service';
import { ReconciliationAdminController } from './controllers/reconciliation-admin.controller';

@Module({
  imports: [PrismaModule, AuditLogsModule, TigerBeetleModule, FundsOrdersModule],
  controllers: [ReconciliationAdminController],
  providers: [
    ReconciliationQueryService,
    ReconciliationSweepService,
    // Phase B / T7 — per-wallet engine (sole live recon path; V8 chain removed in Phase C/A.1).
    WalletBalanceCheckerService, WalletFlowMatcherService, WalletReconRunService,
  ],
  exports: [WalletReconRunService],
})
export class ReconciliationModule {}
