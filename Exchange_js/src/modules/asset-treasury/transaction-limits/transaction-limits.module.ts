import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../core/prisma/prisma.module';
import { ApprovalsModule } from '../../governance/approvals/approvals.module';
import { AuditLogsModule } from '../../audit-logging/audit-logs.module';
import { PricingCenterModule } from '../../trading/pricing-center/pricing-center.module';
import { TransactionLimitRulesService } from './transaction-limit-rules.service';
import { TransactionLimitRuleWorkflowService } from './transaction-limit-rule-workflow.service';
import { TransactionLimitRulesController } from './transaction-limit-rules.controller';
import { TransactionLimitGateService } from './transaction-limit-gate.service';

@Module({
  imports: [PrismaModule, ApprovalsModule, AuditLogsModule, PricingCenterModule],
  providers: [TransactionLimitRulesService, TransactionLimitRuleWorkflowService, TransactionLimitGateService],
  controllers: [TransactionLimitRulesController],
  exports: [TransactionLimitRulesService, TransactionLimitGateService],
})
export class TransactionLimitsModule {}
