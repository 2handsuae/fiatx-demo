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
// 波三 T6：flowComparison 的四段查询/匹配挪出 query service，独立成 builder。
import { FlowComparisonBuilder } from './domain/flow-comparison.builder';
// 第六幕波三：Case 主体服务——全仓唯一的 reconciliationCase 表写点（判据 4 本体）。
import { ReconciliationCaseService } from './domain/reconciliation-case.service';
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
// 平账一期半 T4: 定性落库（record/linkAdjustment/改记候选）+ RECON_DISPOSITION_RECORDED 审计。
import { DispositionService } from './disposition/disposition.service';
import { DispositionController } from './disposition/disposition.controller';
// 平账 B 批 Task 4：补单证据守卫 + 候选原单读接口（只读，Task 5/6/7 的守卫入口）。
import { SupplementEvidenceService } from './disposition/supplement-evidence.service';
// 平账 A 批：案件账龄候选扫描（置标记 / ⚡拨钟已于波三 T4 搬进 ReconciliationCaseService）+ 每分钟扫描。
import { CaseAgingService } from './workflow/case-aging.service';
import { CaseAgingSweepService } from './sweep/case-aging-sweep.service';
// 平账二期：模拟托管方回单——划转工作流在腿提交时调用。
import { SimulatedCustodianStatementService } from './simulation/simulated-custodian-statement.service';

@Module({
  imports: [PrismaModule, AuditLogsModule, TigerBeetleModule, FundsOrdersModule, ApprovalsModule],
  controllers: [ReconciliationAdminController, PushOrderController, AdjustmentController, DispositionController],
  providers: [
    ReconciliationQueryService,
    // 波三 T6：getCase 的 flowComparison 构建器——query service 唯一消费者。
    FlowComparisonBuilder,
    ReconciliationCaseService,
    ReconciliationSweepService,
    // Phase B / T7 — per-wallet engine (sole live recon path; V8 chain removed in Phase C/A.1).
    WalletBalanceCheckerService, WalletFlowMatcherService, WalletReconRunService,
    // Recon disposition: push-order orchestration + receipt lookup.
    ReceiptLookupService, PushOrderService,
    // Recon disposition: 调账单（Task 3 服务 + Task 4 审批中心 handler）。
    AdjustmentService, AdjustmentApprovalService,
    // ④「这条差异已被哪张调账单解释」——对账引擎（算桶）与案件页（展示）共用。
    ExplainedDifferenceService,
    // 平账一期半 T4: 定性落库服务。
    DispositionService,
    // 平账 A 批：案件账龄主体 + 每分钟扫描。
    CaseAgingService, CaseAgingSweepService,
    // 平账 B 批 Task 4：补单证据守卫 + 候选原单（只读）。
    SupplementEvidenceService,
    SimulatedCustodianStatementService,
  ],
  exports: [WalletReconRunService, CaseAgingService, DispositionService, SupplementEvidenceService, SimulatedCustodianStatementService],
})
export class ReconciliationModule {}
