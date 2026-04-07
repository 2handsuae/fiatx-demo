import { Module } from '@nestjs/common';
import { PrismaModule } from '../../core/prisma/prisma.module';
import { OnboardingModule } from '../identity/onboarding/onboarding.module';
import { SumsubIngestionService } from './sumsub-ingestion.service';
import { SumsubIngestionController } from './sumsub-ingestion.controller';
import { SumsubIngestionAdminController } from './sumsub-ingestion-admin.controller';
import { SumsubRetryService } from './sumsub-ingestion-retry.service';
import { SumsubClient } from '../identity/onboarding/providers/sumsub/sumsub.client';

@Module({
  imports: [PrismaModule, OnboardingModule],
  providers: [SumsubIngestionService, SumsubRetryService, SumsubClient],
  controllers: [SumsubIngestionController, SumsubIngestionAdminController],
  exports: [SumsubIngestionService],
})
export class SumsubIngestionModule {}
