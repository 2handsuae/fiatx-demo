import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../core/prisma/prisma.module';
import { AuditLogsModule } from '../../audit-logging/audit-logs.module';
// Phase B / T7: WalletReconRunService needs TigerBeetleService for the
// internal-identity pre-gate (mirrors scripts/verify-realtime-coa.ts).
import { TigerBeetleModule } from '../../accounting/tigerbeetle/tigerbeetle.module';
// Phase B / Round 3: WalletFlowMatcherService needs FundsOrderService for
// the in-transit third pass (orphan external line ↔ non-terminal funds order).
import { FundsOrdersModule } from '../../funds-orders/funds-orders.module';
// Task 4: 调账单接审批中心 — needs ApprovalsService for submit()/createAndSubmit().
import { ApprovalsModule } from '../../governance/approvals/approvals.module';
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
// Task 4: 调账单开单/提审服务 + 接审批中心 handler（onApproved 桩，Task 5 落账）。
import { AdjustmentService } from './disposition/adjustment.service';
import { ExplainedDifferenceService } from './disposition/explained-difference.service';
import { AdjustmentApprovalService } from './disposition/adjustment-approval.service';
// Task 6: 调账单 admin 端点（开单/提审/详情）+ RBAC 登记。
import { AdjustmentController } from './disposition/adjustment.controller';

@Module({
  imports: [PrismaModule, AuditLogsModule, TigerBeetleModule, FundsOrdersModule, ApprovalsModule],
  controllers: [ReconciliationAdminController, PushOrderController, AdjustmentController],
  providers: [
    ReconciliationQueryService,
    ReconciliationSweepService,
    // Phase B / T7 — per-wallet engine (sole live recon path; V8 chain removed in Phase C/A.1).
    WalletBalanceCheckerService, WalletFlowMatcherService, WalletReconRunService,
    // Recon disposition: push-order orchestration + receipt lookup.
    ReceiptLookupService, PushOrderService,
    // Recon disposition: 调账单（Task 3 服务 + Task 4 审批中心 handler）。
    AdjustmentService, AdjustmentApprovalService,
    // ④「这条差异已被哪张调账单解释」——对账引擎（算桶）与案件页（展示）共用。
    ExplainedDifferenceService,
  ],
  exports: [WalletReconRunService],
})
export class ReconciliationModule {}
