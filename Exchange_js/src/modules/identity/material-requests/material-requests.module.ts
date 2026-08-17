import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../../../core/prisma/prisma.module';
import { AuditLogsModule } from '../../audit-logging/audit-logs.module';
import { CustomersModule } from '../customers/customers.module';
import { OnboardingModule } from '../onboarding/onboarding.module';
import { MaterialRefreshModule } from '../material-refresh/material-refresh.module';
import { MaterialRequestsService } from './material-requests.service';
import { MaterialRequestIssuerService } from './material-request-issuer.service';

@Module({
  imports: [
    PrismaModule,
    AuditLogsModule,
    forwardRef(() => CustomersModule),
    forwardRef(() => OnboardingModule),
    forwardRef(() => MaterialRefreshModule),
  ],
  providers: [MaterialRequestsService, MaterialRequestIssuerService],
  exports: [MaterialRequestsService, MaterialRequestIssuerService],
})
export class MaterialRequestsModule {}
