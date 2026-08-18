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

@Module({
  imports: [
    PrismaModule,
    AuditLogsModule,
    forwardRef(() => CustomersModule),
    forwardRef(() => OnboardingModule),
    forwardRef(() => MaterialRefreshModule),
  ],
  providers: [
    MaterialRequestsService,
    MaterialRequestIssuerService,
    MaterialRequestReviewService,
    MaterialRequestOrderCancelListener,
  ],
  controllers: [MaterialRequestsAdminController],
  exports: [MaterialRequestsService, MaterialRequestIssuerService, MaterialRequestReviewService],
})
export class MaterialRequestsModule {}
