import { forwardRef, Module } from '@nestjs/common';
import { PrismaModule } from '../../../core/prisma/prisma.module';
import { ApprovalsModule } from '../approvals/approvals.module';
import { ChangeTicketsController } from './change-tickets.controller';
import { ChangeTicketsService } from './change-tickets.service';
import { ReleaseGatesService } from './release-gates.service';

@Module({
  imports: [PrismaModule, forwardRef(() => ApprovalsModule)],
  controllers: [ChangeTicketsController],
  providers: [ChangeTicketsService, ReleaseGatesService],
  exports: [ChangeTicketsService, ReleaseGatesService],
})
export class ChangeTicketsModule {}
