import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../core/prisma/prisma.module';
import { ReimbursementObligationsModule } from '../reimbursement-obligations/reimbursement-obligations.module';
import { FeeOccurrencesController } from './fee-occurrences.controller';
import { FeeOccurrencesService } from './fee-occurrences.service';

@Module({
  imports: [PrismaModule, ReimbursementObligationsModule],
  controllers: [FeeOccurrencesController],
  providers: [FeeOccurrencesService],
  exports: [FeeOccurrencesService],
})
export class FeeOccurrencesModule {}
