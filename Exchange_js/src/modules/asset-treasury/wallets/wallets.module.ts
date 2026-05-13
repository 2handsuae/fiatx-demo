import { Module } from '@nestjs/common';
import { WalletsService } from './wallets.service';
import { WalletQueryService } from './wallet-query.service';
import { WalletsController } from './wallets.controller';
import { CustodianWalletCreateController } from './custodian-wallet-create.controller';
import { CustodianWalletCreateWorkflowService } from './custodian-wallet-create-workflow.service';
import { CustodianWalletCreateApprovalService } from './custodian-wallet-create-approval.service';
import { MockCustodianAdapter } from './mock-custodian.adapter';
import { CUSTODIAN_ADAPTER } from './custodian-adapter.interface';
import { PrismaModule } from '../../../core/prisma/prisma.module';
import { AuditLogsModule } from '../../audit-logging/audit-logs.module';
import { GovernanceModule } from '../../governance/governance.module';

@Module({
  imports: [PrismaModule, AuditLogsModule, GovernanceModule],
  controllers: [WalletsController, CustodianWalletCreateController],
  providers: [
    WalletsService,
    WalletQueryService,
    CustodianWalletCreateWorkflowService,
    CustodianWalletCreateApprovalService,
    { provide: CUSTODIAN_ADAPTER, useClass: MockCustodianAdapter },
  ],
  exports: [WalletsService, WalletQueryService],
})
export class WalletsModule {}
