import { Module } from '@nestjs/common';
import { AcctEventsService } from './acct-events.service';
import { AcctEventsController } from './acct-events.controller';
import { PrismaModule } from '../../../core/prisma/prisma.module';
import { AcctConfigService } from './acct-config.service';

@Module({
  imports: [PrismaModule],
  controllers: [AcctEventsController],
  providers: [AcctEventsService, AcctConfigService],
  exports: [AcctEventsService, AcctConfigService],
})
export class AcctEventsModule {}
