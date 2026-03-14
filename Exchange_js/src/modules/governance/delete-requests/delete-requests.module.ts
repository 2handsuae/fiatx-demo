import { forwardRef, Module } from '@nestjs/common';
import { PrismaModule } from '../../../core/prisma/prisma.module';
import { ApprovalsModule } from '../approvals/approvals.module';
import { DeleteRequestsController } from './delete-requests.controller';
import { DeleteRequestsService } from './delete-requests.service';

@Module({
  imports: [PrismaModule, forwardRef(() => ApprovalsModule)],
  controllers: [DeleteRequestsController],
  providers: [DeleteRequestsService],
  exports: [DeleteRequestsService],
})
export class DeleteRequestsModule {}
