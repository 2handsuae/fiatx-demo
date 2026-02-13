import { Module } from '@nestjs/common';
import { PayinsService } from './payins.service';
import { PayinsController } from './payins.controller';
import { PrismaModule } from '../../../core/prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [PayinsController],
  providers: [PayinsService],
  exports: [PayinsService],
})
export class PayinsModule {}
