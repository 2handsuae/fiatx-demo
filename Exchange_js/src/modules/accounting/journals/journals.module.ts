import { Module } from '@nestjs/common';
import { JournalsService } from './journals.service';
import { JournalsController } from './journals.controller';
import { PrismaModule } from '../../../core/prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [JournalsController],
  providers: [JournalsService],
  exports: [JournalsService],
})
export class JournalsModule {}
