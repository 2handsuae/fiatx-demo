import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../core/prisma/prisma.module';
import { InternalTransactionsService } from './internal-transactions.service';
import { InternalTransactionsController } from './internal-transactions.controller';

@Module({
  imports: [
    PrismaModule,
  ],
  controllers: [
    InternalTransactionsController,
  ],
  providers: [InternalTransactionsService],
  exports: [InternalTransactionsService],
})
export class InternalTransactionsModule {}
