import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../core/prisma/prisma.module';
import { ApprovalsModule } from '../approvals/approvals.module';
import { AuditLogsModule } from '../../audit-logging/audit-logs.module';
import { TransactionLimitsService } from './transaction-limits.service';
import { TransactionLimitChangeWorkflowService } from './transaction-limit-change-workflow.service';
import { TransactionLimitChangeApprovalService } from './transaction-limit-change-approval.service';
import { TransactionLimitCreationWorkflowService } from './transaction-limit-creation-workflow.service';
import { TransactionLimitCreationApprovalService } from './transaction-limit-creation-approval.service';
import { TransactionLimitsController } from './transaction-limits.controller';
import { TransactionLimitsCustomerController } from './transaction-limits-customer.controller';

@Module({
  imports: [PrismaModule, ApprovalsModule, AuditLogsModule],
  controllers: [TransactionLimitsController, TransactionLimitsCustomerController],
  providers: [
    TransactionLimitsService,
    TransactionLimitChangeWorkflowService,
    TransactionLimitChangeApprovalService,
    TransactionLimitCreationWorkflowService,
    TransactionLimitCreationApprovalService,
  ],
  exports: [TransactionLimitsService],
})
export class TransactionLimitsModule {}
