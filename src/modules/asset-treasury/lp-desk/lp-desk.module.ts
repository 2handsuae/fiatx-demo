import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../core/prisma/prisma.module';
import { AuditLogsModule } from '../../audit-logging/audit-logs.module';
import { TigerBeetleModule } from '../../accounting/tigerbeetle/tigerbeetle.module';
import { FundsOrdersModule } from '../../funds-orders/funds-orders.module';
import { FundsLayerModule } from '../../funds-layer/funds-layer.module';
import { ApprovalsModule } from '../../governance/approvals/approvals.module';
import { ReconciliationModule } from '../../clearing-settle/reconciliation/reconciliation.module';
import { PrudentialModule } from '../prudential/prudential.module';
import { LpProfileService } from './lp-profile.service';
import { LpProfileWorkflowService } from './lp-profile-workflow.service';
import { LpProfileApprovalService, LpProfileChangeApprovalService } from './lp-profile-approval.service';
import { LpProfileController } from './lp-profile.controller';
import { LpExchangeService } from './lp-exchange.service';
import { LpExchangeWorkflowService } from './lp-exchange-workflow.service';
import { LpExchangeApprovalService } from './lp-exchange-approval.service';
import { LpExchangeController } from './lp-exchange.controller';

/**
 * 战役乙波一 · LP 档案（LiquidityProvider）：建行 + 结算坐标变更 + 启停，建档 / 改坐标
 * 均走 ApprovalsService 正门（CFO 单步）。T5：LP 兑换单（LpExchange）——先款后货三腿
 * workflow，依赖对账域的 SimulatedCustodianStatementService（同划转单先例：腿提交/到货
 * 时写模拟托管方回单），账本/资金单/审批三家照 internal-transfers.module 的 imports 清单。
 * T6：LpExchangeController 薄层，六端点全转发 workflow/服务，不加逻辑。
 * 乙波三 T2：兑换单 initiate 按卖出边插 NLA 算术门，横向读 PrudentialModule 导出的
 * PrudentialService（铁律③放行）。
 */
@Module({
  imports: [PrismaModule, AuditLogsModule, TigerBeetleModule, FundsOrdersModule, FundsLayerModule, ApprovalsModule, ReconciliationModule, PrudentialModule],
  controllers: [LpProfileController, LpExchangeController],
  providers: [
    LpProfileService, LpProfileWorkflowService, LpProfileApprovalService, LpProfileChangeApprovalService,
    LpExchangeService, LpExchangeWorkflowService, LpExchangeApprovalService,
  ],
  exports: [LpProfileService, LpExchangeService],
})
export class LpDeskModule {}
