import { Module} from '@nestjs/common';
import { PrismaModule } from '../../../core/prisma/prisma.module';
import { ApprovalsModule } from '../../governance/approvals/approvals.module';
import { AuditLogsModule } from '../../audit-logging/audit-logs.module';
import { PricingCenterModule } from '../pricing-center/pricing-center.module';
import { SwapFeeLevelService } from './swap-fee-level.service';
import { SwapFeeLevelCreationApprovalService } from './swap-fee-level-creation-approval.service';
import { SwapFeeLevelChangeApprovalService } from './swap-fee-level-change-approval.service';
import { SwapFeeLevelCreationWorkflowService } from './swap-fee-level-creation-workflow.service';
import { SwapFeeLevelChangeWorkflowService } from './swap-fee-level-change-workflow.service';
import { SwapQuoteService } from './swap-quote.service';
import { SwapFeeLevelController } from './swap-fee-level.controller';
import { CustomerTagModule } from '../../identity/customer-tags/customer-tag.module';

@Module({
  imports: [PrismaModule, ApprovalsModule, AuditLogsModule, PricingCenterModule, CustomerTagModule],
  controllers: [SwapFeeLevelController],
  providers: [
    SwapFeeLevelService,
    SwapFeeLevelCreationApprovalService,
    SwapFeeLevelChangeApprovalService,
    SwapFeeLevelCreationWorkflowService,
    SwapFeeLevelChangeWorkflowService,
    SwapQuoteService,
  ],
  exports: [SwapFeeLevelService, SwapQuoteService],
})
export class SwapFeeLevelModule {}
