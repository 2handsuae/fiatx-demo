import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../core/prisma/prisma.module';
import { AuditLogsModule } from '../../audit-logging/audit-logs.module';
import { WithdrawalAddressService } from './withdrawal-address.service';
import { WithdrawalAddressWorkflowService } from './withdrawal-address-workflow.service';
import { WithdrawalAddressSweepService } from './withdrawal-address-sweep.service';
import { WithdrawalAddressController } from './withdrawal-address.controller';
import { WithdrawalAddressAdminController } from './withdrawal-address-admin.controller';
import { TRAVEL_RULE_ADAPTER } from './travel-rule-adapter.interface';
import { MockTravelRuleAdapter } from './mock-travel-rule.adapter';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [WithdrawalAddressController, WithdrawalAddressAdminController],
  providers: [
    WithdrawalAddressService,
    WithdrawalAddressWorkflowService,
    WithdrawalAddressSweepService,
    { provide: TRAVEL_RULE_ADAPTER, useClass: MockTravelRuleAdapter },
  ],
  exports: [WithdrawalAddressService],
})
export class WithdrawalAddressesModule {}
