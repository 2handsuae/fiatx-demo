import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../core/prisma/prisma.module';
import { AuditLogsModule } from '../../audit-logging/audit-logs.module';
import { TigerBeetleModule } from '../../accounting/tigerbeetle/tigerbeetle.module';
import { FundsOrdersModule } from '../../funds-orders/funds-orders.module';
import { FundsLayerModule } from '../../funds-layer/funds-layer.module';
import { ApprovalsModule } from '../../governance/approvals/approvals.module';
import { ReconciliationModule } from '../../clearing-settle/reconciliation/reconciliation.module';
import { InternalTransferService } from './internal-transfer.service';
import { InternalTransferWorkflowService } from './internal-transfer-workflow.service';
import { InternalTransferApprovalService } from './internal-transfer-approval.service';
import { InternalTransferController } from './internal-transfer.controller';

/**
 * 平账二期 · 内部划转单（第四类订单）：公司 → 客户的补款 / 垫款。
 * 依赖对账域两样东西：SupplementEvidenceService（垫款查账单行）、SimulatedCustodianStatementService（腿提交时写回单）；
 * 对账读面反过来查本表时直接走 Prisma（同 resolveSupplementRef 读业务域表的先例），不引本模块，避免环。
 */
@Module({
  imports: [PrismaModule, AuditLogsModule, TigerBeetleModule, FundsOrdersModule, FundsLayerModule, ApprovalsModule, ReconciliationModule],
  controllers: [InternalTransferController],
  providers: [InternalTransferService, InternalTransferWorkflowService, InternalTransferApprovalService],
  exports: [InternalTransferService],
})
export class InternalTransfersModule {}
