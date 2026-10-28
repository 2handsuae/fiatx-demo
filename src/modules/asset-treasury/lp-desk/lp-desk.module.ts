import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../core/prisma/prisma.module';
import { DocumentsModule } from '../../../core/documents/documents.module';
import { AuditLogsModule } from '../../audit-logging/audit-logs.module';
import { TigerBeetleModule } from '../../accounting/tigerbeetle/tigerbeetle.module';
import { FundsOrdersModule } from '../../funds-orders/funds-orders.module';
import { FundsLayerModule } from '../../funds-layer/funds-layer.module';
import { ApprovalsModule } from '../../governance/approvals/approvals.module';
import { ComplianceOfficeModule } from '../../governance/compliance-office/compliance-office.module';
import { ReconciliationModule } from '../../clearing-settle/reconciliation/reconciliation.module';
import { PrudentialModule } from '../prudential/prudential.module';
import { LpProfileService } from './lp-profile.service';
import { LpProfileWorkflowService } from './lp-profile-workflow.service';
import { LpProfileApprovalService } from './lp-profile-approval.service';
import { LpProfileHighRiskApprovalService } from './lp-profile-high-risk-approval.service';
import { LpProfileController } from './lp-profile.controller';
import { LpExchangeService } from './lp-exchange.service';
import { LpExchangeWorkflowService } from './lp-exchange-workflow.service';
import { LpExchangeApprovalService } from './lp-exchange-approval.service';
import { LpExchangeController } from './lp-exchange.controller';
import { LpPayoutAddressService } from './lp-payout-address.service';
import { LpPayoutAddressWorkflowService } from './lp-payout-address-workflow.service';
import { LpPayoutAddressApprovalService } from './lp-payout-address-approval.service';
import { LpPayoutAddressController } from './lp-payout-address.controller';
import { TRAVEL_RULE_ADAPTER } from '../../sumsub-shared/travel-rule/travel-rule-adapter.interface';
import { MockTravelRuleAdapter } from '../../sumsub-shared/travel-rule/mock-travel-rule.adapter';

/**
 * 战役乙波一 · LP 档案（LiquidityProvider）：建行 + 启停，准入走 ApprovalsService 正门。
 * 甲波六 T4：准入改成先评估后审批——导入 ComplianceOfficeModule（尽调评估 DueDiligenceService）与 DocumentsModule
 * （申请文件），送审时按风险档分流审批（低 / 中 CFO 单步 LpProfileApprovalService；高 CFO→高管 LpProfileHighRiskApprovalService）。
 * LP 两步准入 Task 9：结算坐标变更退役，收款坐标改由打款地址簿承载。T5：LP 兑换单（LpExchange）——先款后货三腿
 * workflow，依赖对账域的 SimulatedCustodianStatementService（同划转单先例：腿提交/到货
 * 时写模拟托管方回单），账本/资金单/审批三家照 internal-transfers.module 的 imports 清单。
 * T6：LpExchangeController 薄层，六端点全转发 workflow/服务，不加逻辑。
 * 乙波三 T2：兑换单 initiate 按卖出边插 NLA 算术门，横向读 PrudentialModule 导出的
 * PrudentialService（铁律③放行）。
 */
@Module({
  imports: [PrismaModule, AuditLogsModule, TigerBeetleModule, FundsOrdersModule, FundsLayerModule, ApprovalsModule, ReconciliationModule, PrudentialModule, ComplianceOfficeModule, DocumentsModule],
  controllers: [LpProfileController, LpExchangeController, LpPayoutAddressController],
  providers: [
    LpProfileService, LpProfileWorkflowService, LpProfileApprovalService, LpProfileHighRiskApprovalService,
    LpExchangeService, LpExchangeWorkflowService, LpExchangeApprovalService,
    // LP 两步准入 Task 3：地址簿登记即筛——复用对手方套件，同一 DI token 自行 provide（第四个 provide 点）
    // Task 4：地址登记审批（CFO 单步）+ workflow（审批裁决 / 撤回 / 启停退 / ⚡筛查覆写）+ 端点
    LpPayoutAddressService, LpPayoutAddressWorkflowService, LpPayoutAddressApprovalService,
    { provide: TRAVEL_RULE_ADAPTER, useClass: MockTravelRuleAdapter },
  ],
  exports: [LpProfileService, LpExchangeService],
})
export class LpDeskModule {}
