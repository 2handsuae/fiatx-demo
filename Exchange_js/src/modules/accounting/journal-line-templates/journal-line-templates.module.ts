import { Module } from '@nestjs/common';
import { JournalLineTemplatesService } from './journal-line-templates.service';
import { JournalLineTemplatesController } from './journal-line-templates.controller';
import { PrismaModule } from '../../../core/prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [JournalLineTemplatesController],
  providers: [JournalLineTemplatesService],
})
export class JournalLineTemplatesModule {}
