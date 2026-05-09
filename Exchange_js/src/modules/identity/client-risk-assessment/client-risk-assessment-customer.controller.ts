import { Controller, Get, Post, Req, UseGuards, BadRequestException, Inject } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { SumsubIngestionService } from '../../sumsub-ingestion/sumsub-ingestion.service';

@ApiTags('Customer - Compliance')
@Controller('compliance')
@UseGuards(AuthGuard('jwt'))
@ApiBearerAuth()
export class ClientRiskAssessmentCustomerController {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService & Record<string, any>,
    private readonly ingestionService: SumsubIngestionService,
  ) {}

  @Get('me')
  async getMyComplianceStatus(@Req() req: any) {
    const customerId = req.user?.sub;
    const customer = await this.prisma.customerMain.findUnique({
      where: { id: customerId },
      select: {
        customerNo: true,
        riskRating: true,
        adminStatus: true,
        complianceStatus: true,
        sumsubCurrentLevelName: true,
        sumsubApplicantId: true,
      },
    });
    if (!customer) return { status: 'NOT_FOUND' };

    const activeCra = await this.prisma.clientRiskAssessment.findFirst({
      where: {
        customerId,
        status: { in: ['PENDING_SUMSUB_RESULT', 'PENDING_MLRO_REVIEW'] },
      },
      orderBy: { createdAt: 'desc' },
      select: { assessmentNo: true, status: true },
    });

    const tierUpgradeCase = await this.prisma.tierUpgradeCase.findFirst({
      where: { customerId, status: { in: ['PENDING_LEVEL2', 'PENDING_PHASE2_APPROVAL'] } },
      orderBy: { createdAt: 'desc' },
      select: { caseNo: true, status: true },
    });

    return {
      riskRating: customer.riskRating,
      adminStatus: customer.adminStatus,
      complianceStatus: customer.complianceStatus,
      sumsubLevel: customer.sumsubCurrentLevelName,
      activeCra: activeCra ?? null,
      tierUpgradeCase: tierUpgradeCase ?? null,
      requiresLevel2:
        tierUpgradeCase?.status === 'PENDING_LEVEL2',
    };
  }

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
