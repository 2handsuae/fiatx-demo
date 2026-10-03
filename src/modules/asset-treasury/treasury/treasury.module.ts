import { Module } from '@nestjs/common';
import { CustomerPortfolioController } from './customer-portfolio.controller';
import { CustomerPortfolioService } from './customer-portfolio.service';
import { CustomerStatementService } from './customer-statement.service';
import { MonthlyStatementService } from './monthly-statement.service';
import { MonthlyStatementSweepService } from './monthly-statement-sweep.service';
import { PrismaModule } from '../../../core/prisma/prisma.module';
import { TigerBeetleModule } from '../../accounting/tigerbeetle/tigerbeetle.module';
import { NotificationsModule } from '../../../core/notifications/notifications.module';

@Module({
  imports: [PrismaModule, TigerBeetleModule, NotificationsModule],
  controllers: [CustomerPortfolioController],
  providers: [
    CustomerPortfolioService,
    CustomerStatementService,
    MonthlyStatementService,
    MonthlyStatementSweepService,
  ],
  // 管理台客户详情节（identity 模块的 CustomersController）读月结单列表——读口只经本主体的服务，不直查表。
  exports: [MonthlyStatementService],
})
export class TreasuryModule {}
