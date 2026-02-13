import { Module } from '@nestjs/common';
import { ClearingTemplatesService } from './clearing-templates.service';
import { ClearingTemplatesController } from './clearing-templates.controller';
import { ClearingsService } from './clearings.service';
import { ClearingsController } from './clearings.controller';
import { PrismaModule } from '../../../core/prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [ClearingTemplatesController, ClearingsController],
  providers: [ClearingTemplatesService, ClearingsService],
  exports: [ClearingTemplatesService, ClearingsService],
})
export class ClearingModule {}
