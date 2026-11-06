import { Module } from '@nestjs/common';
import { WalletsService } from './wallets.service';
import { WalletQueryService } from './wallet-query.service';
import { WalletsController } from './wallets.controller';
import { CustomerDepositWalletController } from './customer-deposit-wallet.controller';
import { CustomerDepositWalletService } from './customer-deposit-wallet.service';
import { MockCustodianAdapter } from './mock-custodian.adapter';
import { CUSTODIAN_ADAPTER } from './custodian-adapter.interface';
import { PrismaModule } from '../../../core/prisma/prisma.module';
import { AuditLogsModule } from '../../audit-logging/audit-logs.module';
import { CustomersModule } from '../../identity/customers/customers.module';
import { TigerBeetleModule } from '../../accounting/tigerbeetle/tigerbeetle.module';

@Module({
  // 站6：一期拆除后交易前置门迁 CustomerAccessService——本模块改引 CustomersModule。
  // 戊波一：开客户收款地址的流程（CustomerDepositWalletService）在钱包 ACTIVE 时开现金户，需要 WalletCashAccountService；
  // 它住 TigerBeetleModule，后者只依赖 PrismaModule，无环。WalletsService 本身不碰记账。
  imports: [PrismaModule, AuditLogsModule, CustomersModule, TigerBeetleModule],
  controllers: [WalletsController, CustomerDepositWalletController],
  providers: [
    WalletsService,
    WalletQueryService,
    CustomerDepositWalletService,
    { provide: CUSTODIAN_ADAPTER, useClass: MockCustodianAdapter },
  ],
  exports: [WalletsService, WalletQueryService],
})
export class WalletsModule {}
