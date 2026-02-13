import { Module } from '@nestjs/common';
import { JournalHeaderTemplatesService } from './journal-header-templates.service';
import { JournalHeaderTemplatesController } from './journal-header-templates.controller';
import { PrismaModule } from '../../../core/prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [JournalHeaderTemplatesController],
  providers: [JournalHeaderTemplatesService],
})
export class JournalHeaderTemplatesModule {}
