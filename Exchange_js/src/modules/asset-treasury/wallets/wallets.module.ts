import { Module } from '@nestjs/common';
import { WalletsService } from './wallets.service';
import { WalletQueryService } from './wallet-query.service';
import { WalletsController } from './wallets.controller';
import { SystemWalletProvisioningService } from './system-wallet-provisioning.service';
import { PrismaModule } from '../../../core/prisma/prisma.module';
import { AuditLogsModule } from '../../audit-logging/audit-logs.module';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [WalletsController],
  providers: [WalletsService, WalletQueryService, SystemWalletProvisioningService],
  exports: [WalletsService, WalletQueryService, SystemWalletProvisioningService],
})
export class WalletsModule {}
