// admin-sumsub-simulation.controller.ts
import { Controller, Post, Body, ForbiddenException, NotFoundException, BadRequestException, UseGuards, Req, Inject } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { SumsubIngestionService } from './sumsub-ingestion.service';
import { ClientRiskAssessmentService } from '../identity/client-risk-assessment/client-risk-assessment.service';
import { TierUpgradeCaseService } from '../identity/tier-upgrade-case/tier-upgrade-case.service';
import { PrismaService } from '../../core/prisma/prisma.service';

@ApiTags('Admin - Sumsub Simulation')
@Controller('admin/sumsub/simulate')
@UseGuards(AuthGuard('jwt'))
@ApiBearerAuth()
export class AdminSumsubSimulationController {
  constructor(
    private readonly ingestionService: SumsubIngestionService,
    private readonly clientRiskAssessmentService: ClientRiskAssessmentService,
    private readonly tierUpgradeCaseService: TierUpgradeCaseService,
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
      customerId?: string;
      customerNo?: string;
      reviewAnswer: 'GREEN' | 'RED';
      rejectLabels?: string[];
      reviewRejectType?: string;
    },
  ) {
    this.ensureAdmin(req);

    // Resolve customerId from customerNo if needed
    let resolvedCustomerId = body.customerId;
    if (!resolvedCustomerId && body.customerNo) {
      const cust = await this.prisma.customerMain.findFirst({ where: { customerNo: body.customerNo } });
      if (!cust) throw new ForbiddenException(`Customer with No ${body.customerNo} not found`);
      resolvedCustomerId = cust.id;
    }
    if (!resolvedCustomerId) throw new ForbiddenException('Either customerId or customerNo is required');

    // Find the pending assessment for this customer
    const assessment = await this.prisma.clientRiskAssessment.findFirst({
      where: { customerId: resolvedCustomerId, status: 'PENDING_SUMSUB_RESULT' },
      orderBy: { triggeredAt: 'desc' },
    });
    if (!assessment) {
      throw new ForbiddenException('No pending assessment to simulate against');
    }

    const customer = await this.prisma.customerMain.findUnique({
      where: { id: resolvedCustomerId },
    });

    return this.ingestionService.ingest(
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
      },
      { isSimulated: true, simulatedByUserId: 'ADMIN_SIMULATION' },
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

    return this.ingestionService.ingest(
      {
        type: 'applicantActionReviewed',
        applicantId: customer?.sumsubApplicantId,
        actionId: cycle.sumsubActionId,
        reviewResult: {
          reviewAnswer: body.reviewAnswer,
          reviewRejectType: body.reviewRejectType,
        },
        createdAtMs: String(Date.now()),
      },
      { isSimulated: true, simulatedByUserId: 'ADMIN_SIMULATION' },
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

    const { event, dispatchResult } = await this.ingestionService.ingest(
      {
        type: 'caseDecisionSimulated',
        applicantId: customer!.sumsubApplicantId ?? '',
        externalUserId: customer!.id,
        assessmentId: assessment.id,
        customerId: customer!.id,
        decision: body.decision,
        reason: body.reason,
      },
      { isSimulated: true, simulatedByUserId: 'ADMIN_SIMULATION', context: 'CASE_DECISION' },
    );
    const dr = dispatchResult as any;
    return {
      ok: true,
      assessmentId: dr?.assessmentId,
      decision: dr?.decision,
      eventNo: event.eventNo,
    };
  }

  @Post('risk-assessment-scenario')
  @ApiOperation({ summary: 'Trigger risk assessment + simulate AML result in one call' })
  async simulateRiskAssessmentScenario(
    @Req() req: any,
    @Body() body: {
      customerNo?: string;
      customerId?: string;
      reviewAnswer: 'GREEN' | 'RED';
      rejectLabels?: string[];
    },
  ) {
    this.ensureAdmin(req);

    // Resolve customer
    let customer: any;
    if (body.customerNo) {
      customer = await this.prisma.customerMain.findFirst({ where: { customerNo: body.customerNo } });
      if (!customer) throw new ForbiddenException(`Customer with No ${body.customerNo} not found`);
    } else if (body.customerId) {
      customer = await this.prisma.customerMain.findUnique({ where: { id: body.customerId } });
      if (!customer) throw new ForbiddenException('Customer not found');
    } else {
      throw new ForbiddenException('Either customerId or customerNo is required');
    }

    // For customers with a real Sumsub applicant, go through the full ingest pipeline.
    // For demo/seed customers without sumsubApplicantId, call recordAssessmentFromKnownAmlResult
    // directly — the ingest pipeline cannot match on null applicantId / null inspectionId.
    if (!customer.sumsubApplicantId) {
      const final = await this.clientRiskAssessmentService.recordAssessmentFromKnownAmlResult({
        customerId: customer.id,
        triggerType: 'MLRO_MANUAL',
        knownAmlResult: {
          reviewAnswer: body.reviewAnswer,
          rejectLabels: body.rejectLabels || [],
        },
      });
      return {
        ok: true,
        assessmentId: final?.id,
        assessmentNo: (final as any)?.assessmentNo,
        status: final?.status,
        scenarioType: (final as any)?.recommendedAction,
      };
    }

    // Step 1: Trigger assessment (customer has real Sumsub applicant)
    const assessment = await this.clientRiskAssessmentService.startAssessment({
      customerId: customer.id,
      triggerType: 'MLRO_MANUAL',
    });

    // Step 2: Find the pending assessment and simulate AML result via ingest pipeline
    const updatedAssessment = await this.prisma.clientRiskAssessment.findFirst({
      where: { customerId: customer.id, status: 'PENDING_SUMSUB_RESULT' },
      orderBy: { createdAt: 'desc' },
    });
    if (!updatedAssessment) {
      return { ok: true, assessmentId: assessment.id, note: 'Assessment created but no pending result found (might be idempotent)' };
    }

    await this.ingestionService.ingest(
      {
        type: 'applicantReviewed',
        applicantId: customer.sumsubApplicantId,
        inspectionId: updatedAssessment.sumsubAmlCheckInspectionId,
        reviewResult: {
          reviewAnswer: body.reviewAnswer,
          rejectLabels: body.rejectLabels || [],
        },
        createdAtMs: String(Date.now()),
      },
      { isSimulated: true, simulatedByUserId: 'ADMIN_SIMULATION' },
    );

    // Reload to get current state
    const final = await this.prisma.clientRiskAssessment.findUnique({ where: { id: updatedAssessment.id } });
    return {
      ok: true,
      assessmentId: final?.id,
      assessmentNo: (final as any)?.assessmentNo,
      status: final?.status,
      scenarioType: (final as any)?.recommendedAction,
    };
  }

  @Post('level2-workflow-complete')
  @ApiOperation({ summary: 'Simulate Sumsub Level 2 workflow completion for a tier upgrade case' })
  async simulateLevel2WorkflowComplete(
    @Req() req: any,
    @Body() body: { customerNo: string },
  ) {
    this.ensureAdmin(req);

    const customer = await this.prisma.customerMain.findFirst({
      where: { customerNo: body.customerNo },
      select: { id: true, sumsubApplicantId: true },
    });
    if (!customer) {
      throw new NotFoundException(`Customer ${body.customerNo} not found`);
    }
    const pendingUpgrade = await this.prisma.tierUpgradeCase.findFirst({
      where: { customerId: customer.id, status: 'PENDING_LEVEL2' },
    });
    if (!pendingUpgrade) {
      throw new BadRequestException(`Customer ${body.customerNo} has no PENDING_LEVEL2 tier upgrade case — no upgrade in progress`);
    }

    // For demo customers without a real Sumsub applicant, call the handler directly.
    if (!customer.sumsubApplicantId) {
      await this.tierUpgradeCaseService.handleLevel2WorkflowComplete(customer.id);
      return { ok: true, note: 'Level 2 completed (direct path — no Sumsub applicant)' };
    }

    return this.ingestionService.ingest(
      {
        type: 'applicantWorkflowCompleted',
        applicantId: customer.sumsubApplicantId,
        externalUserId: customer.id,
        levelName: 'wave3-level-2',
        reviewResult: { reviewAnswer: 'GREEN' },
        createdAtMs: String(Date.now()),
      },
      { isSimulated: true, simulatedByUserId: 'ADMIN_SIMULATION' },
    );
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

    return this.ingestionService.ingest(
      {
        type: 'applicantReviewed',
        reviewMode: 'ongoingDocExpired',
        applicantId: customer.sumsubApplicantId,
        createdAtMs: String(Date.now()),
      },
      { isSimulated: true, simulatedByUserId: 'ADMIN_SIMULATION' },
    );
  }

  @Post('kyt-check')
  @ApiOperation({ summary: 'Simulate KYT (Know Your Transaction) check result' })
  async simulateKytCheck(
    @Req() req: any,
    @Body() body: { depositNo?: string; txHash?: string; result: 'PASS' | 'FAIL'; riskScore?: number },
  ) {
    this.ensureAdmin(req);

    if (!body.depositNo && !body.txHash) {
      throw new BadRequestException('depositNo or txHash is required');
    }
    if (!body.result || !['PASS', 'FAIL'].includes(body.result)) {
      throw new BadRequestException('result must be PASS or FAIL');
    }

    const where = body.depositNo
      ? { depositNo: body.depositNo }
      : { txHash: body.txHash };
    const deposit = await (this.prisma as any).depositTransaction.findFirst({ where });
    if (!deposit) {
      throw new NotFoundException(
        body.depositNo
          ? `No deposit found with depositNo: ${body.depositNo}`
          : `No deposit found with txHash: ${body.txHash}`,
      );
    }

    const { event, dispatchResult } = await this.ingestionService.ingest(
      {
        type: 'kytCheckSimulated',
        externalUserId: deposit.depositNo,
        depositId: deposit.id,
        depositNo: deposit.depositNo,
        result: body.result,
        riskScore: body.riskScore ?? null,
      },
      { isSimulated: true, simulatedByUserId: 'ADMIN_SIMULATION', context: 'KYT_CHECK' },
    );
    const dr = dispatchResult as any;
    return {
      depositId: dr?.depositId,
      depositNo: deposit.depositNo,
      kytStatus: dr?.kytStatus,
      riskScore: dr?.riskScore ?? null,
      message: `KYT check simulated: ${dr?.kytStatus}`,
      eventNo: event.eventNo,
    };
  }

  @Post('tr-check')
  @ApiOperation({ summary: 'Simulate Travel Rule (TR) check result' })
  async simulateTrCheck(
    @Req() req: any,
    @Body() body: { depositNo?: string; txHash?: string; result: 'PASS' | 'FAIL' },
  ) {
    this.ensureAdmin(req);

    if (!body.depositNo && !body.txHash) {
      throw new BadRequestException('depositNo or txHash is required');
    }
    if (!body.result || !['PASS', 'FAIL'].includes(body.result)) {
      throw new BadRequestException('result must be PASS or FAIL');
    }

    const where = body.depositNo
      ? { depositNo: body.depositNo }
      : { txHash: body.txHash };
    const deposit = await (this.prisma as any).depositTransaction.findFirst({ where });
    if (!deposit) {
      throw new NotFoundException(
        body.depositNo
          ? `No deposit found with depositNo: ${body.depositNo}`
          : `No deposit found with txHash: ${body.txHash}`,
      );
    }

    const { event, dispatchResult } = await this.ingestionService.ingest(
      {
        type: 'travelRuleCheckSimulated',
        externalUserId: deposit.depositNo,
        depositId: deposit.id,
        depositNo: deposit.depositNo,
        result: body.result,
      },
      { isSimulated: true, simulatedByUserId: 'ADMIN_SIMULATION', context: 'TRAVEL_RULE_CHECK' },
    );
    const dr = dispatchResult as any;
    return {
      depositId: dr?.depositId,
      depositNo: deposit.depositNo,
      travelRuleStatus: dr?.trStatus,
      message: `Travel Rule check simulated: ${dr?.trStatus}`,
      eventNo: event.eventNo,
    };
  }

  @Post('withdraw-kyt')
  @ApiOperation({ summary: 'Simulate KYT check result for a withdraw transaction' })
  async simulateWithdrawKytCheck(
    @Req() req: any,
    @Body() body: { withdrawNo: string; stage: 'PRE' | 'POST'; result: 'PASS' | 'FAIL'; riskScore?: number },
  ) {
    this.ensureAdmin(req);

    if (!body.withdrawNo) {
      throw new BadRequestException('withdrawNo is required');
    }
    if (!body.stage || !['PRE', 'POST'].includes(body.stage)) {
      throw new BadRequestException('stage must be PRE or POST');
    }
    if (!body.result || !['PASS', 'FAIL'].includes(body.result)) {
      throw new BadRequestException('result must be PASS or FAIL');
    }

    const withdraw = await (this.prisma as any).withdrawTransaction.findFirst({
      where: { withdrawNo: body.withdrawNo },
    });
    if (!withdraw) {
      throw new NotFoundException(`No withdraw found with withdrawNo: ${body.withdrawNo}`);
    }

    const { event, dispatchResult } = await this.ingestionService.ingest(
      {
        type: 'withdrawKytCheckSimulated',
        externalUserId: withdraw.withdrawNo,
        withdrawId: withdraw.id,
        withdrawNo: withdraw.withdrawNo,
        stage: body.stage,
        result: body.result,
        riskScore: body.riskScore ?? null,
      },
      { isSimulated: true, simulatedByUserId: 'ADMIN_SIMULATION', context: 'WITHDRAW_KYT_CHECK' },
    );
    const dr = dispatchResult as any;
    return {
      withdrawId: withdraw.id,
      withdrawNo: withdraw.withdrawNo,
      stage: body.stage,
      kytStatus: dr?.kytStatus,
      riskScore: dr?.riskScore ?? null,
      message: `Withdraw KYT check simulated (${body.stage}): ${dr?.kytStatus}`,
      eventNo: event.eventNo,
    };
  }

  @Post('withdraw-tr')
  @ApiOperation({ summary: 'Simulate Travel Rule check result for a withdraw transaction' })
  async simulateWithdrawTrCheck(
    @Req() req: any,
    @Body() body: { withdrawNo: string; result: 'PASS' | 'FAIL' },
  ) {
    this.ensureAdmin(req);

    if (!body.withdrawNo) {
      throw new BadRequestException('withdrawNo is required');
    }
    if (!body.result || !['PASS', 'FAIL'].includes(body.result)) {
      throw new BadRequestException('result must be PASS or FAIL');
    }

    const withdraw = await (this.prisma as any).withdrawTransaction.findFirst({
      where: { withdrawNo: body.withdrawNo },
    });
    if (!withdraw) {
      throw new NotFoundException(`No withdraw found with withdrawNo: ${body.withdrawNo}`);
    }

    const { event, dispatchResult } = await this.ingestionService.ingest(
      {
        type: 'withdrawTravelRuleCheckSimulated',
        externalUserId: withdraw.withdrawNo,
        withdrawId: withdraw.id,
        withdrawNo: withdraw.withdrawNo,
        result: body.result,
      },
      { isSimulated: true, simulatedByUserId: 'ADMIN_SIMULATION', context: 'WITHDRAW_TR_CHECK' },
    );
    const dr = dispatchResult as any;
    return {
      withdrawId: withdraw.id,
      withdrawNo: withdraw.withdrawNo,
      travelRuleStatus: dr?.travelRuleStatus,
      message: `Withdraw TR check simulated: ${dr?.travelRuleStatus}`,
      eventNo: event.eventNo,
    };
  }
}
