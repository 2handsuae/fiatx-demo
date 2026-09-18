import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../../../core/prisma/prisma.module';
import { AuditLogsModule } from '../../audit-logging/audit-logs.module';
import { CustomersModule } from '../customers/customers.module';
import { SumsubApplicantClientModule } from '../../sumsub-applicant-client/sumsub-applicant-client.module';
import { MaterialPolicyLoader } from './material-policy';
import { MaterialRequestsService } from './material-requests.service';
import { MaterialRequestIssuerService } from './material-request-issuer.service';
import { MaterialRequestReviewService } from './material-request-review.service';
import { MaterialRequestOrderCancelListener } from './material-request-order-cancel.listener';
import { MaterialRequestsAdminController } from './material-requests.admin.controller';
import { MaterialRequestsClientController } from './material-requests.client.controller';

@Module({
  imports: [
    PrismaModule,
    AuditLogsModule,
    forwardRef(() => CustomersModule),
    SumsubApplicantClientModule,
  ],
  providers: [
    MaterialRequestsService,
    MaterialRequestIssuerService,
    MaterialRequestReviewService,
    MaterialRequestOrderCancelListener,
    MaterialPolicyLoader,
  ],
  controllers: [MaterialRequestsAdminController, MaterialRequestsClientController],
  exports: [MaterialRequestsService, MaterialRequestIssuerService, MaterialRequestReviewService],
})
export class MaterialRequestsModule {}
