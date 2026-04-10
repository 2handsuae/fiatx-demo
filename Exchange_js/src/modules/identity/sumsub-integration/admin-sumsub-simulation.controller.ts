// admin-sumsub-simulation.controller.ts
import { Controller, Post, Body, ForbiddenException, UseGuards, Req, Inject } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { SumsubWebhookDispatcher } from './sumsub-webhook-dispatcher.service';
import { ClientRiskAssessmentService } from '../client-risk-assessment/client-risk-assessment.service';
import { PrismaService } from '../../../core/prisma/prisma.service';

@ApiTags('Admin - Sumsub Simulation')
@Controller('admin/sumsub/simulate')
@UseGuards(AuthGuard('jwt'))
@ApiBearerAuth()
export class AdminSumsubSimulationController {
  constructor(
    private readonly dispatcher: SumsubWebhookDispatcher,
    private readonly clientRiskAssessmentService: ClientRiskAssessmentService,
    @Inject(PrismaService)
    private readonly prisma: PrismaService & Record<string, any>,
  ) {}

  private ensureAdmin(req: any) {
    if (req.user?.type !== 'ADMIN') {
      throw new ForbiddenException('Admin token required');
    }
  }

  @Post('aml-check-result')
  @ApiOperation({ summary: 'Simulate applicantReviewed webhook for a pending ClientRiskAssessment' })
  async simulateAmlCheckResult(
    @Req() req: any,
    @Body() body: {
      customerId: string;
      reviewAnswer: 'GREEN' | 'RED';
      rejectLabels?: string[];
      reviewRejectType?: string;
    },
  ) {
    this.ensureAdmin(req);

    // Find the pending assessment for this customer
    const assessment = await this.prisma.clientRiskAssessment.findFirst({
      where: { customerId: body.customerId, status: 'PENDING_SUMSUB_RESULT' },
      orderBy: { triggeredAt: 'desc' },
    });
    if (!assessment) {
      throw new ForbiddenException('No pending assessment to simulate against');
    }

    const customer = await this.prisma.customerMain.findUnique({
      where: { id: body.customerId },
    });

    return this.dispatcher.dispatch(
      {
        type: 'applicantReviewed',
        applicantId: customer?.sumsubApplicantId,
        inspectionId: assessment.sumsubAmlCheckInspectionId,
        reviewResult: {
          reviewAnswer: body.reviewAnswer,
          rejectLabels: body.rejectLabels,
          reviewRejectType: body.reviewRejectType,
        },
        createdAtMs: String(Date.now()),
      } as any,
      { simulated: true, actorId: 'ADMIN_SIMULATION' },
    );
  }

  @Post('applicant-action-result')
  @ApiOperation({ summary: 'Simulate applicantActionReviewed webhook for a pending cycle' })
  async simulateApplicantActionResult(
    @Req() req: any,
    @Body() body: {
      cycleId?: string;
      cycleNo?: string;
      reviewAnswer: 'GREEN' | 'RED';
      reviewRejectType?: string;
    },
  ) {
    this.ensureAdmin(req);

    let cycle: any;
    if (body.cycleNo) {
      cycle = await this.prisma.materialRefreshCycle.findFirst({
        where: { cycleNo: body.cycleNo },
      });
      if (!cycle) throw new ForbiddenException(`Cycle with No ${body.cycleNo} not found`);
    } else if (body.cycleId) {
      cycle = await this.prisma.materialRefreshCycle.findUnique({
        where: { id: body.cycleId },
      });
      if (!cycle) throw new ForbiddenException('Cycle not found');
    } else {
      throw new ForbiddenException('Either cycleId or cycleNo is required');
    }
    const customer = await this.prisma.customerMain.findUnique({
      where: { id: cycle.customerId },
    });

    return this.dispatcher.dispatch(
      {
        type: 'applicantActionReviewed',
        applicantId: customer?.sumsubApplicantId,
        actionId: cycle.sumsubActionId,
        reviewResult: {
          reviewAnswer: body.reviewAnswer,
          reviewRejectType: body.reviewRejectType,
        },
        createdAtMs: String(Date.now()),
      } as any,
      { simulated: true, actorId: 'ADMIN_SIMULATION' },
    );
  }

  @Post('sumsub-case-decision')
  @ApiOperation({ summary: 'Simulate Sumsub internal case final decision (after sanctions escalation)' })
  async simulateSumsubCaseDecision(
    @Req() req: any,
    @Body() body: {
      assessmentId: string;
      decision: 'APPROVE' | 'REJECT';
      reason?: string;
    },
  ) {
    this.ensureAdmin(req);

    const assessment = await this.prisma.clientRiskAssessment.findUnique({
      where: { id: body.assessmentId },
    });
    if (!assessment) throw new ForbiddenException('Assessment not found');
    if (assessment.status !== 'ESCALATED_TO_SUMSUB') {
      throw new ForbiddenException(`Assessment is ${assessment.status}, not ESCALATED_TO_SUMSUB`);
    }

    const customer = await this.prisma.customerMain.findUnique({
      where: { id: assessment.customerId },
    });

    if (body.decision === 'APPROVE') {
      // False positive: clear freeze
      await this.prisma.customerMain.update({
        where: { id: customer!.id },
        data: { complianceHoldStatus: 'CLEAR', complianceHoldReason: null },
      });
      await this.prisma.clientRiskAssessment.update({
        where: { id: assessment.id },
        data: {
          status: 'SIGNED',
          signedBy: 'SUMSUB_MLRO',
          signedAt: new Date(),
          sumsubCaseFinalDecision: 'APPROVE',
          sumsubCaseDecidedAt: new Date(),
        },
      });
    } else {
      // True match: offboard
      await this.prisma.customerMain.update({
        where: { id: customer!.id },
        data: {
          onboardingStatus: 'REJECTED',
          operatingStatus: 'INACTIVE',
          complianceHoldStatus: 'FROZEN',
        },
      });
      await this.prisma.clientRiskAssessment.update({
        where: { id: assessment.id },
        data: {
          status: 'SIGNED',
          signedBy: 'SUMSUB_MLRO',
          signedAt: new Date(),
          sumsubCaseFinalDecision: 'REJECT',
          sumsubCaseDecidedAt: new Date(),
        },
      });
    }

    return { ok: true };
  }

  @Post('ongoing-doc-monitoring-fire')
  @ApiOperation({ summary: 'Simulate Sumsub Ongoing Document Monitoring fire' })
  async simulateOngoingDocMonitoring(
    @Req() req: any,
    @Body() body: { customerId: string },
  ) {
    this.ensureAdmin(req);

    const customer = await this.prisma.customerMain.findUnique({
      where: { id: body.customerId },
    });
    if (!customer?.sumsubApplicantId) {
      throw new ForbiddenException('Customer has no Sumsub applicant');
    }

    return this.dispatcher.dispatch(
      {
        type: 'applicantReviewed',
        reviewMode: 'ongoingDocExpired',
        applicantId: customer.sumsubApplicantId,
        createdAtMs: String(Date.now()),
      } as any,
      { simulated: true, actorId: 'ADMIN_SIMULATION' },
    );
  }
}
