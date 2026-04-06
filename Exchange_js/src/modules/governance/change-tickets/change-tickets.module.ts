import { forwardRef, Module } from '@nestjs/common';
import { PrismaModule } from '../../../core/prisma/prisma.module';
import { ApprovalsModule } from '../approvals/approvals.module';
import { ChangeTicketsController } from './change-tickets.controller';
import { ChangeTicketsService } from './change-tickets.service';

@Module({
  imports: [
    PrismaModule,
    forwardRef(() => ApprovalsModule),
  ],
  controllers: [ChangeTicketsController],
  providers: [ChangeTicketsService],
  exports: [ChangeTicketsService],
})
export class ChangeTicketsModule {}
