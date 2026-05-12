import { Module } from '@nestjs/common';
import { JournalLinesService } from './journal-lines.service';
import { JournalLinesController } from './journal-lines.controller';

@Module({
  imports: [],
  controllers: [JournalLinesController],
  providers: [JournalLinesService],
})
export class JournalLinesModule {}
