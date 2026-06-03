import { Module, forwardRef } from '@nestjs/common';
import { PayoutsService } from './payouts.service';
import { PayoutsController } from './payouts.controller';
import { PrismaModule } from '../../../core/prisma/prisma.module';
import { TransactionComplianceModule } from '../../risk-engine/transaction-compliance/transaction-compliance.module';

@Module({
  imports: [
    PrismaModule,
    forwardRef(() => TransactionComplianceModule),
  ],
  controllers: [PayoutsController],
  providers: [PayoutsService],
  exports: [PayoutsService],
})
export class PayoutsModule {}
