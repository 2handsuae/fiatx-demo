import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../../../core/prisma/prisma.module';
import { AuditLogsModule } from '../../audit-logging/audit-logs.module';
import { CustomersModule } from '../customers/customers.module';
import { OnboardingModule } from '../onboarding/onboarding.module';
import { MaterialRefreshModule } from '../material-refresh/material-refresh.module';
import { MaterialRequestsService } from './material-requests.service';
import { MaterialRequestIssuerService } from './material-request-issuer.service';
import { MaterialRequestReviewService } from './material-request-review.service';
import { MaterialRequestOrderCancelListener } from './material-request-order-cancel.listener';
import { MaterialRequestsAdminController } from './material-requests.admin.controller';
import { MaterialRequestsClientController } from './material-requests.client.controller';
import { SwapSumsubModule } from '../../swap-sumsub/swap-sumsub.module';

@Module({
  imports: [
    PrismaModule,
    AuditLogsModule,
    forwardRef(() => CustomersModule),
    forwardRef(() => OnboardingModule),
    forwardRef(() => MaterialRefreshModule),
    // Task 10: MaterialRequestReviewService's GREEN path calls back into
    // SwapApplicantActionHandler.noteHardLineHeld (the one piece of
    // disposition logic that stays domain-specific — the sticky hard-line
    // check). forwardRef: SwapSumsubModule imports this module right back for
    // the handler's own MaterialRequestsService dependency.
    forwardRef(() => SwapSumsubModule),
  ],
  providers: [
    MaterialRequestsService,
    MaterialRequestIssuerService,
    MaterialRequestReviewService,
    MaterialRequestOrderCancelListener,
  ],
  controllers: [MaterialRequestsAdminController, MaterialRequestsClientController],
  exports: [MaterialRequestsService, MaterialRequestIssuerService, MaterialRequestReviewService],
})
export class MaterialRequestsModule {}
