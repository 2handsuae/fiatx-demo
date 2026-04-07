import { Module } from '@nestjs/common';
import { PrismaModule } from '../../core/prisma/prisma.module';
import { OnboardingModule } from '../identity/onboarding/onboarding.module';
import { SumsubIngestionService } from './sumsub-ingestion.service';
import { SumsubIngestionController } from './sumsub-ingestion.controller';
import { SumsubIngestionAdminController } from './sumsub-ingestion-admin.controller';
import { SumsubRetryService } from './sumsub-ingestion-retry.service';
@Module({
  imports: [PrismaModule, OnboardingModule],
  providers: [SumsubIngestionService, SumsubRetryService],
  controllers: [SumsubIngestionController, SumsubIngestionAdminController],
  exports: [SumsubIngestionService],
})
export class SumsubIngestionModule {}
