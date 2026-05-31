import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../../../core/prisma/prisma.module';
import { ApprovalsModule } from '../../governance/approvals/approvals.module';
import { AuditLogsModule } from '../../audit-logging/audit-logs.module';
import { PricingCenterModule } from '../pricing-center/pricing-center.module';
import { SwapFeeLevelService } from './swap-fee-level.service';
import { SwapFeeLevelBindingService } from './swap-fee-level-binding.service';
import { SwapFeeLevelCreationApprovalService } from './swap-fee-level-creation-approval.service';
import { SwapFeeLevelChangeApprovalService } from './swap-fee-level-change-approval.service';
import { SwapFeeLevelCreationWorkflowService } from './swap-fee-level-creation-workflow.service';
import { SwapFeeLevelChangeWorkflowService } from './swap-fee-level-change-workflow.service';
import { SwapFeeLevelBindingWorkflowService } from './swap-fee-level-binding-workflow.service';
import { SwapQuoteService } from './swap-quote.service';
import { SwapFeeLevelController } from './swap-fee-level.controller';

@Module({
  imports: [PrismaModule, ApprovalsModule, AuditLogsModule, forwardRef(() => PricingCenterModule)],
  controllers: [SwapFeeLevelController],
  providers: [
    SwapFeeLevelService,
    SwapFeeLevelBindingService,
    SwapFeeLevelCreationApprovalService,
    SwapFeeLevelChangeApprovalService,
    SwapFeeLevelCreationWorkflowService,
    SwapFeeLevelChangeWorkflowService,
    SwapFeeLevelBindingWorkflowService,
    SwapQuoteService,
  ],
  exports: [SwapFeeLevelService, SwapQuoteService, SwapFeeLevelBindingService],
})
export class SwapFeeLevelModule {}
