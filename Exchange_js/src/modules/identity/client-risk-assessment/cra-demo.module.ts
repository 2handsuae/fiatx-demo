import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../core/prisma/prisma.module';
import { SumsubIngestionModule } from '../../sumsub-ingestion/sumsub-ingestion.module';
import { CraDemoController } from './cra-demo.controller';

// 站3-α2（2026-08-27）：CRA 的演示端点独立挂载（镜像三域 DemoModule 模式）。
// 挂载点在 AppModule——不能由 ClientRiskAssessmentModule 引入（否则
// identity→ingestion 的链又画回去）。
@Module({
  imports: [PrismaModule, SumsubIngestionModule],
  controllers: [CraDemoController],
})
export class CraDemoModule {}
