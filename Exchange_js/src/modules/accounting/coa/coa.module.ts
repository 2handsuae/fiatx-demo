import { Module } from '@nestjs/common';
import { CoaService } from './coa.service';
import { CoaController } from './coa.controller';
import { PrismaModule } from '../../../core/prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [CoaController],
  providers: [CoaService],
})
export class CoaModule {}
