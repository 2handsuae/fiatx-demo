import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../core/prisma/prisma.module';
import { ReimbursementObligationsController } from './reimbursement-obligations.controller';
import { ReimbursementObligationsService } from './reimbursement-obligations.service';

@Module({
  imports: [PrismaModule],
  controllers: [ReimbursementObligationsController],
  providers: [ReimbursementObligationsService],
  exports: [ReimbursementObligationsService],
})
export class ReimbursementObligationsModule {}
