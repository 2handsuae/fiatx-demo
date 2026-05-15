import { forwardRef, Module } from '@nestjs/common';
import { PrismaModule } from '../../../core/prisma/prisma.module';
import { WorkflowsModule } from '../../../orchestrators/workflows.module';
import { InternalCollectionWalletsController } from '../internal-transaction-workflow/internal-collection-wallets.controller';
import { InternalTransactionsService } from './internal-transactions.service';
import { InternalTransactionsController } from './internal-transactions.controller';

@Module({
  imports: [
    PrismaModule,
    forwardRef(() => WorkflowsModule),
  ],
  controllers: [
    InternalCollectionWalletsController,
    InternalTransactionsController,
  ],
  providers: [InternalTransactionsService],
  exports: [InternalTransactionsService],
})
export class InternalTransactionsModule {}
