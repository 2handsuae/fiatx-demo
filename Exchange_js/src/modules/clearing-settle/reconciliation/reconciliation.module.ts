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
// Recon disposition (平账·推单) — orchestrates funds-order advance() with a back-value.
// Deps (FundsOrdersModule + AuditLogsModule) are already imported above.
import { ReceiptLookupService } from './disposition/receipt-lookup.service';
import { PushOrderService } from './disposition/push-order.service';
import { PushOrderController } from './disposition/push-order.controller';

@Module({
  imports: [PrismaModule, AuditLogsModule, TigerBeetleModule, FundsOrdersModule],
  controllers: [ReconciliationAdminController, PushOrderController],
  providers: [
    ReconciliationQueryService,
    ReconciliationSweepService,
    // Phase B / T7 — per-wallet engine (sole live recon path; V8 chain removed in Phase C/A.1).
    WalletBalanceCheckerService, WalletFlowMatcherService, WalletReconRunService,
    // Recon disposition: push-order orchestration + receipt lookup.
    ReceiptLookupService, PushOrderService,
  ],
  exports: [WalletReconRunService],
})
export class ReconciliationModule {}
