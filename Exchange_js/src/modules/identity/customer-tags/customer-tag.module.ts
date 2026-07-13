import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../core/prisma/prisma.module';
import { CustomerTagService } from './customer-tag.service';
import { CustomerTagController } from './customer-tag.controller';

@Module({
  imports: [PrismaModule],
  providers: [CustomerTagService],
  controllers: [CustomerTagController],
  exports: [CustomerTagService],
})
export class CustomerTagModule {}
