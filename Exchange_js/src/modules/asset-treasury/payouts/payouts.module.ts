import { Module, forwardRef } from '@nestjs/common';
import { PayoutsService } from './payouts.service';
import { PayoutsController } from './payouts.controller';
import { PrismaModule } from '../../../core/prisma/prisma.module';
import { TransactionComplianceModule } from '../../risk-engine/transaction-compliance/transaction-compliance.module';
import { FeeOccurrencesModule } from '../fee-occurrences/fee-occurrences.module';

@Module({
  imports: [
    PrismaModule,
    forwardRef(() => TransactionComplianceModule),
    FeeOccurrencesModule,
  ],
  controllers: [PayoutsController],
  providers: [PayoutsService],
  exports: [PayoutsService],
})
export class PayoutsModule {}
