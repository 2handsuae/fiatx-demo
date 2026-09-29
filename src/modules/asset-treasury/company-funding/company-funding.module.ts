import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../core/prisma/prisma.module';
import { AuditLogsModule } from '../../audit-logging/audit-logs.module';
import { TigerBeetleModule } from '../../accounting/tigerbeetle/tigerbeetle.module';
import { FundsOrdersModule } from '../../funds-orders/funds-orders.module';
import { FundsLayerModule } from '../../funds-layer/funds-layer.module';
import { ApprovalsModule } from '../../governance/approvals/approvals.module';
import { ReconciliationModule } from '../../clearing-settle/reconciliation/reconciliation.module';
import { ComplianceOfficeModule } from '../../governance/compliance-office/compliance-office.module';
import { CapitalInjectionService } from './capital-injection.service';
import { CapitalInjectionWorkflowService } from './capital-injection-workflow.service';
import { CapitalInjectionApprovalService } from './capital-injection-approval.service';
import { CapitalInjectionController } from './capital-injection.controller';
import { VendorPaymentService } from './vendor-payment.service';

/**
 * 战役乙波二 · 公司资金（Company Funding）：T1/T2 注资单主体（CapitalInjection）——
 * 单腿进项，批准即等到款，⚡到款落 RECEIVED（不落账），确认入账落 SUCCESS（码 70，
 * 先账后状态）。T3：workflow/审批/端点全套，账本/资金单/审批三家照 lp-desk.module 的
 * imports 清单（同 LpExchangeService 先例：依赖对账域的
 * SimulatedCustodianStatementService 写模拟托管方回单）。T4：付款单主体
 * （VendorPayment）——收款方=在册外包商，横向读走 ComplianceOfficeModule 导出的
 * OutsourcingVendorsService（铁律③，照 incidents.module.ts 横向拿服务同款先例，
 * 不重复声明该服务）。
 */
@Module({
  imports: [PrismaModule, AuditLogsModule, TigerBeetleModule, FundsOrdersModule, FundsLayerModule, ApprovalsModule, ReconciliationModule, ComplianceOfficeModule],
  controllers: [CapitalInjectionController],
  providers: [CapitalInjectionService, CapitalInjectionWorkflowService, CapitalInjectionApprovalService, VendorPaymentService],
  exports: [CapitalInjectionService, VendorPaymentService],
})
export class CompanyFundingModule {}
