import { Module } from '@nestjs/common';
import { JournalLinesService } from './journal-lines.service';
import { JournalLinesController } from './journal-lines.controller';
import { PrismaModule } from '../../../core/prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [JournalLinesController],
  providers: [JournalLinesService],
})
export class JournalLinesModule {}
