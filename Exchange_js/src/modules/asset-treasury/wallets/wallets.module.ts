import { Module } from '@nestjs/common';
import { WalletsService } from './wallets.service';
import { WalletQueryService } from './wallet-query.service';
import { WalletBalanceService } from './wallet-balance.service';
import { WalletsController } from './wallets.controller';
import { CustodianWalletCreateController } from './custodian-wallet-create.controller';
import { CustodianWalletCreateWorkflowService } from './custodian-wallet-create-workflow.service';
import { CustodianWalletCreateApprovalService } from './custodian-wallet-create-approval.service';
import { CustomerDepositWalletController } from './customer-deposit-wallet.controller';
import { CustomerDepositWalletService } from './customer-deposit-wallet.service';
import { MockCustodianAdapter } from './mock-custodian.adapter';
import { CUSTODIAN_ADAPTER } from './custodian-adapter.interface';
import { PrismaModule } from '../../../core/prisma/prisma.module';
import { AuditLogsModule } from '../../audit-logging/audit-logs.module';
import { GovernanceModule } from '../../governance/governance.module';
import { OnboardingModule } from '../../identity/onboarding/onboarding.module';

@Module({
  // Onboarding 边曾裹 forwardRef（2026-08-14 起，防循环 require 中段拿 undefined）；
  // 站4 清扫实测环已不存在（sumsub 枢纽解包后装载链拉直），拆封并开机实证。
  imports: [PrismaModule, AuditLogsModule, GovernanceModule, OnboardingModule],
  controllers: [WalletsController, CustodianWalletCreateController, CustomerDepositWalletController],
  providers: [
    WalletsService,
    WalletQueryService,
    WalletBalanceService,
    CustodianWalletCreateWorkflowService,
    CustodianWalletCreateApprovalService,
    CustomerDepositWalletService,
    { provide: CUSTODIAN_ADAPTER, useClass: MockCustodianAdapter },
  ],
  exports: [WalletsService, WalletQueryService, WalletBalanceService],
})
export class WalletsModule {}
