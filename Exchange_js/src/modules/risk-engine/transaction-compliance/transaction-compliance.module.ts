import { Module } from '@nestjs/common';
import { TransactionComplianceService } from './transaction-compliance.service';
import { TransactionComplianceAdminController } from './transaction-compliance-admin.controller';

@Module({
  providers: [TransactionComplianceService],
  controllers: [TransactionComplianceAdminController],
  exports: [TransactionComplianceService],
})
export class TransactionComplianceModule {}
