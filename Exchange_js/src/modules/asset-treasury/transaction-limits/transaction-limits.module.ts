import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../core/prisma/prisma.module';
import { ApprovalsModule } from '../../governance/approvals/approvals.module';
import { AuditLogsModule } from '../../audit-logging/audit-logs.module';
import { TransactionLimitRulesService } from './transaction-limit-rules.service';
import { TransactionLimitRuleWorkflowService } from './transaction-limit-rule-workflow.service';
import { TransactionLimitRulesController } from './transaction-limit-rules.controller';

@Module({
  imports: [PrismaModule, ApprovalsModule, AuditLogsModule],
  providers: [TransactionLimitRulesService, TransactionLimitRuleWorkflowService],
  controllers: [TransactionLimitRulesController],
  exports: [TransactionLimitRulesService],
})
export class TransactionLimitsModule {}
