import { Module, forwardRef } from '@nestjs/common';
import { SwapTransactionsService } from './swap-transactions.service';
import { SwapWorkflowService } from './swap-workflow.service';
import { SwapSettlementService } from './swap-settlement.service';
import { SwapTransactionsController } from './swap-transactions.controller';
import { SwapTransactionsCustomerController } from './swap-transactions-customer.controller';
import { PrismaModule } from '../../../core/prisma/prisma.module';
import { OnboardingModule } from '../../identity/onboarding/onboarding.module';
import { PricingCenterModule } from '../pricing-center/pricing-center.module';
import { SwapFeeLevelModule } from '../swap-fee-level/swap-fee-level.module';
import { TigerBeetleModule } from '../../accounting/tigerbeetle/tigerbeetle.module';
import { AuditLogsModule } from '../../audit-logging/audit-logs.module';
import { FundsLayerModule } from '../../funds-layer/funds-layer.module';

@Module({
  imports: [
    PrismaModule,
    forwardRef(() => OnboardingModule),
    PricingCenterModule,
    forwardRef(() => SwapFeeLevelModule),
    TigerBeetleModule,
    AuditLogsModule,
    FundsLayerModule,
  ],
  controllers: [SwapTransactionsController, SwapTransactionsCustomerController],
  providers: [SwapTransactionsService, SwapWorkflowService, SwapSettlementService],
  exports: [SwapTransactionsService, SwapWorkflowService, SwapSettlementService],
})
export class SwapTransactionsModule {}
