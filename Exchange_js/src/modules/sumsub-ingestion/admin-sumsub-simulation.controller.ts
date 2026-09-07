// admin-sumsub-simulation.controller.ts
import { Controller, Post, Body, ForbiddenException, NotFoundException, BadRequestException, UseGuards, Req, Inject } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { SumsubIngestionService } from './sumsub-ingestion.service';
import { PrismaService } from '../../core/prisma/prisma.service';
import { MaterialRequestsService } from '../identity/material-requests/material-requests.service';
import { AdminPermissionGuard } from '../identity/access-control/admin-permission.guard';
import { RequirePermissions } from '../identity/access-control/require-permissions.decorator';
import { buildPermissionCode } from '../identity/access-control/permission-code.util';

@ApiTags('Admin - Sumsub Simulation')
@Controller('admin/sumsub/simulate')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
@ApiBearerAuth()
export class AdminSumsubSimulationController {
  constructor(
    private readonly ingestionService: SumsubIngestionService,
    @Inject(PrismaService)
    private readonly prisma: PrismaService & Record<string, any>,
    private readonly materialRequests: MaterialRequestsService,
  ) {}

  private ensureAdmin(req: any) {
    if (req.user?.type !== 'ADMIN') {
      throw new ForbiddenException('Admin token required');
    }
  }

  @Post('applicant-action-result')
  @ApiOperation({ summary: '模拟 applicantActionReviewed —— 后台三个裁决按钮打这里' })
  @RequirePermissions(buildPermissionCode('POST', '/admin/sumsub/simulate/applicant-action-result'))
  async simulateApplicantActionResult(
    @Req() req: any,
    @Body() body: {
      requestNo: string;
      reviewAnswer: 'GREEN' | 'RED';
      reviewRejectType?: 'RETRY' | 'FINAL';
    },
  ) {
    this.ensureAdmin(req);
    if (!body.requestNo) throw new BadRequestException('requestNo is required');
    if (body.reviewAnswer === 'RED' && !body.reviewRejectType) {
      // 不许默默当成 FINAL 把单关掉，也不许默默当成 RETRY 让运营永远关不了单 ——
      // 树上两条旧路各犯了其中一个，本轮统一（设计稿 §2.2）。
      throw new BadRequestException("RED must carry reviewRejectType 'RETRY' or 'FINAL'");
    }

    const request = await this.materialRequests.findByNo(body.requestNo);
    if (!request) throw new NotFoundException(`Material request not found: ${body.requestNo}`);

    const customer = await this.prisma.customerMain.findUnique({
      where: { id: request.customerId },
      select: { sumsubApplicantId: true },
    });

    return this.ingestionService.ingest(
      {
        type: 'applicantActionReviewed',
        applicantId: customer?.sumsubApplicantId,
        actionId: request.applicantActionId,
        externalActionId: request.externalActionId,
        reviewResult: {
          reviewAnswer: body.reviewAnswer,
          reviewRejectType: body.reviewRejectType,
        },
        createdAtMs: String(Date.now()),
      },
      { isSimulated: true, simulatedByUserId: 'ADMIN_SIMULATION' },
    );
  }

  @Post('onboarding-review-result')
  @ApiOperation({ summary: '模拟 applicantReviewed —— 入驻 ⚡ 三个裁决按钮打这里' })
  @RequirePermissions(buildPermissionCode('POST', '/admin/sumsub/simulate/onboarding-review-result'))
  async simulateOnboardingReviewResult(
    @Req() req: any,
    @Body() body: { customerNo: string; reviewAnswer: 'GREEN' | 'RED'; reviewRejectType?: 'RETRY' | 'FINAL' },
  ) {
    this.ensureAdmin(req);
    if (!body.customerNo) throw new BadRequestException('customerNo is required');
    if (body.reviewAnswer === 'RED' && !body.reviewRejectType) {
      // 照 applicant-action-result 判例：不许默默当 FINAL 或 RETRY
      throw new BadRequestException("RED must carry reviewRejectType 'RETRY' or 'FINAL'");
    }
    const customer = await this.prisma.customerMain.findUnique({
      where: { customerNo: body.customerNo },
      select: { sumsubApplicantId: true },
    });
    if (!customer?.sumsubApplicantId) {
      throw new NotFoundException(`Customer has no Sumsub applicant: ${body.customerNo}`);
    }
    return this.ingestionService.ingest(
      {
        type: 'applicantReviewed',
        applicantId: customer.sumsubApplicantId,
        reviewResult: { reviewAnswer: body.reviewAnswer, reviewRejectType: body.reviewRejectType },
        createdAtMs: String(Date.now()),
      },
      { isSimulated: true, simulatedByUserId: 'ADMIN_SIMULATION' },
    );
  }

  @Post('onboarding-level-change')
  @ApiOperation({ summary: '模拟 applicantLevelChanged —— CDD 提交后升 EDD' })
  @RequirePermissions(buildPermissionCode('POST', '/admin/sumsub/simulate/onboarding-level-change'))
  async simulateOnboardingLevelChange(@Req() req: any, @Body() body: { customerNo: string }) {
    this.ensureAdmin(req);
    if (!body.customerNo) throw new BadRequestException('customerNo is required');
    const customer = await this.prisma.customerMain.findUnique({
      where: { customerNo: body.customerNo },
      select: { sumsubApplicantId: true },
    });
    if (!customer?.sumsubApplicantId) {
      throw new NotFoundException(`Customer has no Sumsub applicant: ${body.customerNo}`);
    }
    return this.ingestionService.ingest(
      { type: 'applicantLevelChanged', applicantId: customer.sumsubApplicantId, levelName: 'edd-sof-sow-level', createdAtMs: String(Date.now()) },
      { isSimulated: true, simulatedByUserId: 'ADMIN_SIMULATION' },
    );
  }

  // withdraw-kyt/withdraw-tr endpoints retired with the old preKyt/travelRule mock
  // pipeline (Task 5 — real Sumsub single-txn submit + applyKytVerdict replaces it;
  // see WithdrawWorkflowService). Frontend cleanup (SumsubEventsPage kyt/travelRule
  // simulate tabs) is Task 10-11's scope.
}
