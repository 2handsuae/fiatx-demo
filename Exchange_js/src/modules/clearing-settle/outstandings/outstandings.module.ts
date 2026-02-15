import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../core/prisma/prisma.module';
import { OutstandingsController } from './outstandings.controller';
import { OutstandingsService } from './outstandings.service';

@Module({
  imports: [PrismaModule],
  controllers: [OutstandingsController],
  providers: [OutstandingsService],
  exports: [OutstandingsService],
})
export class OutstandingsModule {}
