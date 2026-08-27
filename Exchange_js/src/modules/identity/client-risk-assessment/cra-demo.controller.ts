import { Controller, Post, Req, UseGuards, BadRequestException, Inject } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { SumsubIngestionService } from '../../sumsub-ingestion/sumsub-ingestion.service';

// 站3-α2：从 ClientRiskAssessmentCustomerController 摘出的演示端点（路由/守卫逐字
// 一致）。它注入 SumsubIngestionService——这正是 CRA 模块此前引 ingestion 的唯一
// 原因；单独成模块挂 AppModule 后，identity 侧不再触达 ingestion 枢纽。
@ApiTags('Customer - Compliance')
@Controller('compliance')
@UseGuards(AuthGuard('jwt'))
@ApiBearerAuth()
export class CraDemoController {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService & Record<string, any>,
    private readonly ingestionService: SumsubIngestionService,
  ) {}

  /** Mock-mode only: simulate customer completing Level 2 workflow */
  @Post('verification/mock-complete-level2')
  async mockCompleteLevel2(@Req() req: any) {
    const customerId = req.user?.sub;
    const customer = await this.prisma.customerMain.findUnique({
      where: { id: customerId },
      select: { sumsubApplicantId: true },
    });

    if (!customer) {
      throw new BadRequestException('Customer not found');
    }
    if (!customer?.sumsubApplicantId) {
      throw new BadRequestException('No Sumsub applicant ID');
    }

    return this.ingestionService.ingest(
      {
        type: 'applicantWorkflowCompleted',
        applicantId: customer.sumsubApplicantId,
        externalUserId: customerId,
        levelName: 'wave3-level-2',
        reviewResult: { reviewAnswer: 'GREEN' },
        createdAtMs: String(Date.now()),
      },
      { isSimulated: true, simulatedByUserId: customerId },
    );
  }
}
