import { Module } from '@nestjs/common';
import { PayinsService } from './payins.service';
import { PayinsController } from './payins.controller';
import { PayinsAdminController } from './payins.admin.controller';
import { PrismaModule } from '../../../core/prisma/prisma.module';
import { WalletsModule } from '../wallets/wallets.module';

@Module({
  imports: [PrismaModule, WalletsModule],
  controllers: [PayinsController, PayinsAdminController],
  providers: [PayinsService],
  exports: [PayinsService],
})
export class PayinsModule {}
