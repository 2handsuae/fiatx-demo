import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { generateReferenceNo } from '../../../common/utils/no-generator.util';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import {
  AuditEntityTypes,
  AuditModules,
  AuditWorkflowTypes,
} from '../../audit-logging/constants/audit-actions.constant';
import { AuditTriggerType } from '../../audit-logging/dto/audit-log.dto';
import { CustomerNextStepActionType } from '../customer-status.util';
import {
  PERIODIC_REVIEW_WORKFLOW,
  buildComplianceWorkflowTraceContext,
} from '../../risk-engine/constants/onboarding-compliance-workflow.constant';
import {
  RiskEngineService,
} from '../../risk-engine/risk-engine.service';
import {
  CreateResponseSessionDto,
  MockCompleteSessionDto,
  OnboardingMockDataType,
} from '../onboarding/dto/onboarding.dto';
import { WorkflowTransitionService } from '../onboarding/workflow-transition.service';
import {
  projectResponseRecord,
} from '../review-response-compat.util';

type CaseType = 'CDD' | 'EDD';
type MockResult = 'PASS' | 'FAIL';
type PeriodicReviewStatus =
  | 'PENDING_CDD_INPUT'
  | 'CDD_UNDER_REVIEW'
  | 'PENDING_EDD_INPUT'
  | 'EDD_UNDER_REVIEW'
  | 'CLEARED'
  | 'REJECTED';

type PeriodicReviewActionType =
  | 'START_CDD'
  | 'CREATE_CDD_SESSION'
  | 'COMPLETE_CDD'
  | 'START_EDD'
  | 'CREATE_EDD_SESSION'
  | 'COMPLETE_EDD'
  | 'WAIT_REVIEW'
  | 'NONE';

interface PeriodicReviewAction {
  type: PeriodicReviewActionType;
  payload?: Record<string, unknown>;
}

interface SessionResponse {
  sessionId: string;
  providerSessionId: string;
  responseType: CaseType;
  caseId: string;
  qrCodeUrl: string;
  expiresAt: Date;
  status: string;
}

@Injectable()
export class PeriodicReviewService {
  private readonly logger = new Logger(PeriodicReviewService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly riskEngineService: RiskEngineService,
    private readonly workflowTransitionService: WorkflowTransitionService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  private parseJsonSafely(value?: string | null): Record<string, unknown> {
    if (!value) return {};
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }

  private dedupeStringList(values: Array<string | null | undefined>): string[] {
    return Array.from(
      new Set(values.map((item) => String(item || '').trim()).filter(Boolean)),
    );
  }

  private buildSeed(input: string): number {
    let hash = 0;
    for (let i = 0; i < input.length; i += 1) {
      hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
    }
    return hash || 1;
  }

  private pickFrom<T>(seed: number, values: T[]): T {
    return values[seed % values.length];
  }

  private addDays(base: Date, days: number): Date {
    return new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
  }

  private normalizeResponseType(value?: string | null): CaseType | null {
    const normalized = String(value || '')
      .trim()
      .toUpperCase();
    if (normalized === 'CDD' || normalized === 'EDD') {
      return normalized;
    }
    return null;
  }

  private projectResponseRecord<T extends { caseNo?: string | null }>(
    row: T,
    responseType: CaseType,
  ): Omit<T, 'caseNo'> & {
    responseNo: string | null;
    responseType: CaseType;
  } {
    return projectResponseRecord(row, responseType);
  }

  private buildSessionResponse(session: any): SessionResponse {
    return {
      sessionId: session.id,
      providerSessionId: session.providerSessionId,
      responseType: session.caseType,
      caseId: session.caseId,
      qrCodeUrl: session.qrCodeUrl,
      expiresAt: session.expiresAt,
      status: session.status,
    };
  }

  private buildCustomerActiveCyclePatch(
    cycleId?: string | null,
  ): Prisma.CustomerMainUpdateInput {
    if (cycleId) {
      return {
        activePeriodicReviewCycle: {
          connect: { id: cycleId },
        },
      };
    }

    return {
      activePeriodicReviewCycle: {
        disconnect: true,
      },
    };
  }

  private getCycleActionTypes(cycle?: {
    status?: string | null;
    currentCddResponseId?: string | null;
    currentEddResponseId?: string | null;
  } | null): PeriodicReviewActionType[] {
    const status = String(cycle?.status || '').trim().toUpperCase();
    if (status === 'PENDING_CDD_INPUT') {
      return cycle?.currentCddResponseId
        ? ['CREATE_CDD_SESSION', 'COMPLETE_CDD']
        : ['START_CDD'];
    }
    if (status === 'CDD_UNDER_REVIEW') {
      return ['WAIT_REVIEW'];
    }
    if (status === 'PENDING_EDD_INPUT') {
      return cycle?.currentEddResponseId
        ? ['CREATE_EDD_SESSION', 'COMPLETE_EDD']
        : ['START_EDD'];
    }
    if (status === 'EDD_UNDER_REVIEW') {
      return ['WAIT_REVIEW'];
    }
    return ['NONE'];
  }

  private buildCycleBlockedReason(cycle?: { status?: string | null } | null): string | null {
    const status = String(cycle?.status || '').trim().toUpperCase();
    if (status === 'CDD_UNDER_REVIEW' || status === 'EDD_UNDER_REVIEW') {
      return 'WAIT_COMPLIANCE_REVIEW';
    }
    if (status === 'REJECTED') {
      return 'PERIODIC_REVIEW_REJECTED';
    }
    return null;
  }

  private buildNextStep(cycle?: any | null) {
    const actions = this.getCycleActionTypes(cycle).map((type) => ({ type }));
    return {
      status: (String(cycle?.status || '').trim().toUpperCase() || null) as
        | PeriodicReviewStatus
        | null,
      actions,
      blockedReason: this.buildCycleBlockedReason(cycle),
      activeCaseId: cycle?.currentEddResponseId || cycle?.currentCddResponseId || null,
      requiresEdd: ['PENDING_EDD_INPUT', 'EDD_UNDER_REVIEW'].includes(
        String(cycle?.status || '').trim().toUpperCase(),
      ),
    };
  }

  private async writeAudit(input: {
    customerId: string;
    action: string;
    actorId: string;
    actorRole: string;
    fromStage?: string | null;
    toStage?: string | null;
    caseType?: string | null;
    caseId?: string | null;
    detail?: string | null;
    workflowId?: string | null;
    workflowNo?: string | null;
  }) {
    const actorType =
      String(input.actorRole || '').trim().toUpperCase() === 'CUSTOMER'
        ? 'CUSTOMER'
        : 'ADMIN';
    const customer = await this.prisma.customerMain.findUnique({
      where: { id: input.customerId },
      select: {
        id: true,
        customerNo: true,
      },
    });
    const workflowContext = buildComplianceWorkflowTraceContext({
      workflow: PERIODIC_REVIEW_WORKFLOW,
    });
    const triggerType = String(input.action || '').trim().toUpperCase().endsWith('_CREATED')
      ? AuditTriggerType.DATA_CREATE
      : AuditTriggerType.DATA_UPDATE;

    await this.auditLogsService.recordByActor(
      {
        triggerType,
        action: input.action,
        entityType: AuditEntityTypes.ONBOARDING,
        entityId: input.customerId,
        entityNo: customer?.customerNo || undefined,
        traceId: workflowContext?.traceId || undefined,
        workflowType:
          workflowContext?.workflowType || AuditWorkflowTypes.PERIODIC_REVIEW,
        entityOwnerType: 'CUSTOMER',
        entityOwnerId: input.customerId,
        entityOwnerNo: customer?.customerNo || undefined,
        reason: input.detail || undefined,
        metadata: {
          caseType: input.caseType || null,
          caseId: input.caseId || null,
          detail: input.detail || null,
          source: 'ONBOARDING_AUDIT_MIRROR',
        },
        sourcePlatform: 'APPLICATION',
      },
      {
        actorType,
        actorId: input.actorId,
        actorRole: input.actorRole,
      },
    );

  }

  private buildCddMockSignals(caseNo: string, mockDataType: OnboardingMockDataType) {
    const seed = this.buildSeed(`PRR:CDD:${caseNo}:${mockDataType}`);
    const base = {
      provider: 'MOCK',
      caseType: 'CDD' as const,
      referenceId: `MOCK-${seed.toString(16).toUpperCase()}`,
      reviewedAt: new Date().toISOString(),
      mockDataType,
    };

    if (mockDataType === 'LOW_RISK') {
      return {
        ...base,
        outcome: 'PASS',
        riskScore: 18 + (seed % 20),
        riskLevel: 'LOW',
        pepHit: false,
        sanctionsHit: false,
        adverseMediaHit: false,
      };
    }

    if (mockDataType === 'MEDIUM_RISK') {
      return {
        ...base,
        outcome: 'FLAGGED',
        riskScore: 50 + (seed % 15),
        riskLevel: 'MEDIUM',
        pepHit: false,
        sanctionsHit: false,
        adverseMediaHit: this.pickFrom(seed + 5, [false, true, false]),
      };
    }

    if (mockDataType === 'HIGH_RISK_OR_PEP') {
      return {
        ...base,
        outcome: 'FLAGGED',
        riskScore: 82 + (seed % 12),
        riskLevel: 'HIGH',
        pepHit: true,
        sanctionsHit: false,
        adverseMediaHit: true,
      };
    }

    return {
      ...base,
      outcome: 'FLAGGED',
      riskScore: 92 + (seed % 8),
      riskLevel: 'CRITICAL',
      pepHit: this.pickFrom(seed + 17, [false, true, false]),
      sanctionsHit: true,
      adverseMediaHit: true,
    };
  }

  private buildEddMockSignals(caseNo: string, result: MockResult) {
    const seed = this.buildSeed(`PRR:EDD:${caseNo}:${result}`);
    const failMode = result === 'FAIL';
    const riskScore = failMode ? 75 + (seed % 21) : 25 + (seed % 35);
    const riskLevel = riskScore >= 75 ? 'HIGH' : riskScore >= 50 ? 'MEDIUM' : 'LOW';
    const pepHit = failMode ? true : this.pickFrom(seed + 3, [false, false, false, true]);
    const sanctionsHit = failMode ? this.pickFrom(seed + 7, [false, true, false]) : false;
    const adverseMediaHit = failMode
      ? this.pickFrom(seed + 11, [true, false, true])
      : this.pickFrom(seed + 13, [false, false, true, false]);

    return {
      provider: 'MOCK',
      caseType: 'EDD' as const,
      outcome: failMode ? 'FLAGGED' : 'PASS',
      referenceId: `MOCK-${seed.toString(16).toUpperCase()}`,
      riskScore,
      riskLevel,
      pepHit,
      sanctionsHit,
      adverseMediaHit,
      reviewedAt: new Date().toISOString(),
    };
  }

  private buildPendingCddSignals(input: {
    caseNo: string;
    cddResponseId: string;
    cycleNo: string;
  }) {
    const seed = this.buildSeed(`PRR:CDD:PENDING:${input.caseNo}`);
    return {
      provider: 'MOCK',
      caseType: 'CDD' as const,
      referenceId: `MOCK-${seed.toString(16).toUpperCase()}`,
      reviewedAt: new Date().toISOString(),
      cddResponseId: input.cddResponseId,
      cycleNo: input.cycleNo,
      outcome: 'RECEIVED',
      riskScore: null,
      riskLevel: null,
      pepHit: false,
      sanctionsHit: false,
      adverseMediaHit: false,
      simulationMode: 'MANUAL_PENDING',
    };
  }

  private buildManualCddSignals(input: {
    caseNo: string;
    cddResponseId: string;
    cycleNo: string;
    riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
    reasonCode: string;
  }) {
    const seed = this.buildSeed(`PRR:CDD:MANUAL:${input.caseNo}:${input.riskLevel}:${input.reasonCode}`);
    const base = {
      provider: 'MOCK',
      caseType: 'CDD' as const,
      referenceId: `MOCK-${seed.toString(16).toUpperCase()}`,
      reviewedAt: new Date().toISOString(),
      cddResponseId: input.cddResponseId,
      cycleNo: input.cycleNo,
      simulationMode: 'MANUAL',
      simulationRiskLevel: input.riskLevel,
      simulationRiskReason: input.reasonCode,
    };

    if (input.riskLevel === 'LOW') {
      return {
        ...base,
        outcome: 'PASS',
        mockDataType: 'LOW_RISK' as const,
        riskScore: 20 + (seed % 10),
        riskLevel: 'LOW',
        pepHit: false,
        sanctionsHit: false,
        adverseMediaHit: false,
      };
    }

    if (input.riskLevel === 'MEDIUM') {
      return {
        ...base,
        outcome: 'FLAGGED',
        mockDataType: 'MEDIUM_RISK' as const,
        riskScore: 54 + (seed % 10),
        riskLevel: 'MEDIUM',
        pepHit: false,
        sanctionsHit: false,
        adverseMediaHit: false,
      };
    }

    return {
      ...base,
      outcome: 'FLAGGED',
      mockDataType:
        input.reasonCode === 'SANCTIONS_HIT'
          ? ('SANCTION_AND_OTHER' as const)
          : ('HIGH_RISK_OR_PEP' as const),
      riskScore: 85 + (seed % 10),
      riskLevel: 'HIGH',
      pepHit: input.reasonCode === 'CDD_HIGH_RISK_OR_PEP',
      sanctionsHit: input.reasonCode === 'SANCTIONS_HIT',
      adverseMediaHit: input.reasonCode !== 'SANCTIONS_HIT',
    };
  }

  private buildPendingEddSignals(input: {
    caseNo: string;
    eddResponseId: string;
    cycleNo: string;
  }) {
    const seed = this.buildSeed(`PRR:EDD:PENDING:${input.caseNo}`);
    return {
      provider: 'MOCK',
      caseType: 'EDD' as const,
      referenceId: `MOCK-${seed.toString(16).toUpperCase()}`,
      reviewedAt: new Date().toISOString(),
      eddResponseId: input.eddResponseId,
      cycleNo: input.cycleNo,
      outcome: 'RECEIVED',
      riskScore: null,
      riskLevel: null,
      pepHit: false,
      sanctionsHit: false,
      adverseMediaHit: false,
      eddSubmitted: true,
      simulationMode: 'MANUAL_PENDING',
    };
  }

  private buildManualEddSignals(input: {
    caseNo: string;
    eddResponseId: string;
    cycleNo: string;
    riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
    reasonCode: string;
  }) {
    const seed = this.buildSeed(`PRR:EDD:MANUAL:${input.caseNo}:${input.riskLevel}:${input.reasonCode}`);
    const base = {
      provider: 'MOCK',
      caseType: 'EDD' as const,
      referenceId: `MOCK-${seed.toString(16).toUpperCase()}`,
      reviewedAt: new Date().toISOString(),
      eddResponseId: input.eddResponseId,
      cycleNo: input.cycleNo,
      eddSubmitted: true,
      simulationMode: 'MANUAL',
      simulationRiskLevel: input.riskLevel,
      simulationRiskReason: input.reasonCode,
    };

    if (input.riskLevel === 'LOW') {
      return {
        ...base,
        outcome: 'PASS',
        riskScore: 26 + (seed % 8),
        riskLevel: 'LOW',
        pepHit: false,
        sanctionsHit: false,
        adverseMediaHit: false,
      };
    }

    if (input.riskLevel === 'MEDIUM') {
      return {
        ...base,
        outcome: 'FLAGGED',
        riskScore: 58 + (seed % 8),
        riskLevel: 'MEDIUM',
        pepHit: false,
        sanctionsHit: false,
        adverseMediaHit: true,
      };
    }

    return {
      ...base,
      outcome: 'FLAGGED',
      riskScore:
        input.reasonCode === 'SANCTIONS_HIT'
          ? 95 + (seed % 4)
          : input.reasonCode === 'PEP_HIT'
            ? 84 + (seed % 8)
            : 79 + (seed % 10),
      riskLevel: 'HIGH',
      pepHit: input.reasonCode === 'PEP_HIT',
      sanctionsHit: input.reasonCode === 'SANCTIONS_HIT',
      adverseMediaHit: input.reasonCode !== 'HIGH_RISK_SCORE',
    };
  }

  private resolveMockDataType(body: MockCompleteSessionDto): {
    result: MockResult;
    mockDataType: OnboardingMockDataType;
  } {
    const result: MockResult = body?.result === 'FAIL' ? 'FAIL' : 'PASS';
    if (body?.mockDataType) {
      return {
        result,
        mockDataType: body.mockDataType,
      };
    }

    return {
      result,
      mockDataType: result === 'FAIL' ? 'SANCTION_AND_OTHER' : 'LOW_RISK',
    };
  }

  private getSystemActor() {
    return {
      actorType: 'SYSTEM',
      actorId: 'SYSTEM',
      actorNo: 'SYSTEM',
      actorRole: 'SYSTEM',
      sourcePlatform: 'SYSTEM',
    } as const;
  }

  private async getCustomerOrThrow(customerId: string) {
    const customer = await this.prisma.customerMain.findUnique({
      where: { id: customerId },
      include: {
        activePeriodicReviewCycle: true,
      },
    });
    if (!customer) {
      throw new NotFoundException(`Customer not found: ${customerId}`);
    }
    return customer;
  }

  private async getActiveCycleOrThrow(customerId: string) {
    const customer = await this.getCustomerOrThrow(customerId);
    if (!customer.activePeriodicReviewCycleId || !customer.activePeriodicReviewCycle) {
      throw new NotFoundException(`Active periodic review cycle not found for ${customerId}`);
    }
    return {
      customer,
      cycle: customer.activePeriodicReviewCycle,
    };
  }

  async getMyPeriodicReview(customerId: string) {
    const customer = await this.getCustomerOrThrow(customerId);
    const cycle = customer.activePeriodicReviewCycle || null;
    const nextStep = this.buildNextStep(cycle);
    return {
      customerId: customer.id,
      customerNo: customer.customerNo,
      activePeriodicReviewCycleId: customer.activePeriodicReviewCycleId || null,
      periodicReviewOverdueAt: customer.periodicReviewOverdueAt || null,
      periodicReviewOverdueReason: customer.periodicReviewOverdueReason || null,
      nextReviewAt: customer.nextReviewAt || null,
      restrictionStatus: customer.restrictionStatus,
      complianceHoldStatus: customer.complianceHoldStatus,
      cycle,
      ...nextStep,
    };
  }

  async getNextStep(customerId: string) {
    const customer = await this.getCustomerOrThrow(customerId);
    return this.buildNextStep(customer.activePeriodicReviewCycle || null);
  }

  async listMyResponses(customerId: string) {
    await this.getCustomerOrThrow(customerId);

    const [cddResponses, eddResponses] = await Promise.all([
      this.prisma.cddResponse.findMany({
        where: { customerId, workflow: PERIODIC_REVIEW_WORKFLOW },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.eddResponse.findMany({
        where: { customerId, workflow: PERIODIC_REVIEW_WORKFLOW },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const cddIds = cddResponses.map((item) => item.id);
    const eddIds = eddResponses.map((item) => item.id);
    const sessions =
      cddIds.length + eddIds.length > 0
        ? await this.prisma.complianceSession.findMany({
            where: {
              customerId,
              OR: [
                ...(cddIds.length > 0
                  ? [{ caseType: 'CDD', caseId: { in: cddIds } }]
                  : []),
                ...(eddIds.length > 0
                  ? [{ caseType: 'EDD', caseId: { in: eddIds } }]
                  : []),
              ],
            },
            orderBy: { createdAt: 'desc' },
          })
        : [];

    const latestSessionMap = new Map<string, any>();
    sessions.forEach((session) => {
      const key = `${session.caseType}:${session.caseId}`;
      if (!latestSessionMap.has(key)) {
        latestSessionMap.set(key, session);
      }
    });

    const items = [
      ...cddResponses.map((item) => ({
        ...this.projectResponseRecord(item, 'CDD'),
        inputData: this.parseJsonSafely(item.inputData),
        latestSession: latestSessionMap.get(`CDD:${item.id}`)
          ? this.buildSessionResponse(latestSessionMap.get(`CDD:${item.id}`))
          : null,
      })),
      ...eddResponses.map((item) => ({
        ...this.projectResponseRecord(item, 'EDD'),
        inputData: this.parseJsonSafely(item.inputData),
        latestSession: latestSessionMap.get(`EDD:${item.id}`)
          ? this.buildSessionResponse(latestSessionMap.get(`EDD:${item.id}`))
          : null,
      })),
    ].sort(
      (a: any, b: any) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );

    return {
      total: items.length,
      items,
    };
  }

  async listMyCases(customerId: string) {
    return this.listMyResponses(customerId);
  }

  async createResponseSession(
    customerId: string,
    actorId: string,
    caseId: string,
    dto: CreateResponseSessionDto,
  ) {
    await this.getCustomerOrThrow(customerId);

    let caseType: CaseType | null = this.normalizeResponseType(dto.responseType);
    if (!caseType) {
      const [cddResponse, eddResponse] = await Promise.all([
        this.prisma.cddResponse.findUnique({ where: { id: caseId } }),
        this.prisma.eddResponse.findUnique({ where: { id: caseId } }),
      ]);
      if (cddResponse?.customerId === customerId && cddResponse.workflow === PERIODIC_REVIEW_WORKFLOW) {
        caseType = 'CDD';
      } else if (
        eddResponse?.customerId === customerId &&
        eddResponse.workflow === PERIODIC_REVIEW_WORKFLOW
      ) {
        caseType = 'EDD';
      }
    }

    if (!caseType) {
      throw new NotFoundException(`Periodic review response not found: ${caseId}`);
    }

    const targetCase =
      caseType === 'CDD'
        ? await this.prisma.cddResponse.findUnique({ where: { id: caseId } })
        : await this.prisma.eddResponse.findUnique({ where: { id: caseId } });
    if (
      !targetCase ||
      targetCase.customerId !== customerId ||
      targetCase.workflow !== PERIODIC_REVIEW_WORKFLOW
    ) {
      throw new NotFoundException(`Periodic review response not found: ${caseId}`);
    }
    if (targetCase.status !== 'CREATED') {
      throw new BadRequestException(
        `${caseType} response must be in CREATED status before creating session.`,
      );
    }

    const now = new Date();
    const existing = await this.prisma.complianceSession.findFirst({
      where: {
        customerId,
        caseType,
        caseId,
        status: 'PENDING',
        expiresAt: { gt: now },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (existing) {
      return this.buildSessionResponse(existing);
    }

    await this.prisma.complianceSession.updateMany({
      where: {
        customerId,
        caseType,
        caseId,
        status: 'PENDING',
        expiresAt: { lt: now },
      },
      data: {
        status: 'EXPIRED',
      },
    });

    const provider = dto.provider || 'MOCK';
    const providerSessionId = generateReferenceNo('SES');
    const created = await this.prisma.complianceSession.create({
      data: {
        customerId,
        caseType,
        caseId,
        provider,
        providerSessionId,
        qrCodeUrl: `mock://compliance/${providerSessionId}`,
        status: 'PENDING',
        expiresAt: this.addDays(now, 1),
      },
    });

    await this.writeAudit({
      customerId,
      caseType,
      caseId,
      action: `${caseType}_PERIODIC_REVIEW_SESSION_CREATED`,
      actorId,
      actorRole: 'CUSTOMER',
      detail: `Session ${created.id} created for periodic review response ${caseId}.`,
    });

    return this.buildSessionResponse(created);
  }

  async createCaseSession(
    customerId: string,
    actorId: string,
    caseId: string,
    dto: CreateResponseSessionDto,
  ) {
    return this.createResponseSession(customerId, actorId, caseId, dto);
  }

  async startCddResponses(customerId: string, actorId: string) {
    const { cycle } = await this.getActiveCycleOrThrow(customerId);
    if (String(cycle.status || '').trim().toUpperCase() !== 'PENDING_CDD_INPUT') {
      throw new BadRequestException('Periodic review CDD is not awaiting customer input.');
    }
    if (!cycle.currentCddResponseId) {
      throw new BadRequestException('No active periodic review CDD response is available.');
    }

    const session = await this.createCaseSession(customerId, actorId, cycle.currentCddResponseId, {
      responseType: 'CDD',
      provider: 'MOCK',
    });

    return {
      currentCddResponseId: cycle.currentCddResponseId,
      session,
      ...this.buildNextStep(cycle),
    };
  }

  async startEddResponses(customerId: string, actorId: string) {
    const { cycle } = await this.getActiveCycleOrThrow(customerId);
    if (String(cycle.status || '').trim().toUpperCase() !== 'PENDING_EDD_INPUT') {
      throw new BadRequestException('Periodic review EDD is not awaiting customer input.');
    }
    if (!cycle.currentEddResponseId) {
      throw new BadRequestException('No active periodic review EDD response is available.');
    }

    const session = await this.createCaseSession(customerId, actorId, cycle.currentEddResponseId, {
      responseType: 'EDD',
      provider: 'MOCK',
    });

    return {
      currentEddResponseId: cycle.currentEddResponseId,
      session,
      ...this.buildNextStep(cycle),
    };
  }

  private async handleCddSubmission(input: {
    customer: any;
    cycle: any;
    cddResponse: any;
    decisionRecordId: string;
    reasonCodes: string[];
    recommendedActions: any[];
  }, options: { skipAudit?: boolean } = {}) {
    const now = new Date();
    await (this.prisma as any).periodicReviewCycle.update({
      where: { id: input.cycle.id },
      data: {
        status: 'CDD_UNDER_REVIEW',
        latestDecisionRecordId: input.decisionRecordId,
        currentCddResponseId: input.cddResponse.id,
      },
    });

    if (!options.skipAudit) {
      await this.writeAudit({
        customerId: input.customer.id,
        caseType: 'CDD',
        caseId: input.cddResponse.id,
        action: 'PERIODIC_REVIEW_CDD_SUBMITTED',
        actorId: input.customer.id,
        actorRole: 'CUSTOMER',
        fromStage: 'PENDING_CDD_INPUT',
        toStage: 'CDD_UNDER_REVIEW',
        detail: `Periodic review CDD submitted at ${now.toISOString()}.`,
      });
    }
  }

  private async handleEddSubmission(input: {
    customer: any;
    cycle: any;
    eddResponse: any;
    decisionRecordId: string;
    reasonCodes: string[];
    recommendedActions: any[];
  }, options: { skipAudit?: boolean } = {}) {
    const now = new Date();
    await (this.prisma as any).periodicReviewCycle.update({
      where: { id: input.cycle.id },
      data: {
        status: 'EDD_UNDER_REVIEW',
        latestDecisionRecordId: input.decisionRecordId,
        currentEddResponseId: input.eddResponse.id,
      },
    });

    if (!options.skipAudit) {
      await this.writeAudit({
        customerId: input.customer.id,
        caseType: 'EDD',
        caseId: input.eddResponse.id,
        action: 'PERIODIC_REVIEW_EDD_SUBMITTED',
        actorId: input.customer.id,
        actorRole: 'CUSTOMER',
        fromStage: 'PENDING_EDD_INPUT',
        toStage: 'EDD_UNDER_REVIEW',
        detail: `Periodic review EDD submitted at ${now.toISOString()}.`,
      });
    }
  }

  async completeManualCddDecision(input: {
    decisionRecordId: string;
    riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
    reasonCode: string;
  }) {
    const decisionRecord = await (this.prisma as any).workflowDecisionRecord.findUnique({
      where: { id: input.decisionRecordId },
      select: {
        id: true,
        status: true,
        contextType: true,
        inputPayload: true,
      },
    });

    if (!decisionRecord) {
      throw new NotFoundException(
        `Risk decision record not found: ${input.decisionRecordId}`,
      );
    }
    if (
      String(decisionRecord.contextType || '').trim().toUpperCase() !==
      'PERIODIC_REVIEW_CDD'
    ) {
      throw new BadRequestException(
        `Decision record ${input.decisionRecordId} is not bound to PERIODIC_REVIEW_CDD`,
      );
    }
    if (String(decisionRecord.status || '').trim().toUpperCase() !== 'CREATED') {
      throw new BadRequestException(
        `Decision record ${input.decisionRecordId} is not pending simulation`,
      );
    }

    const storedInput = this.parseJsonSafely(decisionRecord.inputPayload);
    const storedSignals = this.parseJsonSafely(
      typeof storedInput.signals === 'object' && !Array.isArray(storedInput.signals)
        ? JSON.stringify(storedInput.signals)
        : undefined,
    );
    const cddResponseId = String(storedSignals.cddResponseId || '').trim();
    if (!cddResponseId) {
      throw new BadRequestException(
        `Decision record ${input.decisionRecordId} missing cddResponseId`,
      );
    }

    const cddResponse = await this.prisma.cddResponse.findUnique({
      where: { id: cddResponseId },
    });
    if (!cddResponse) {
      throw new NotFoundException(`Periodic review CDD response not found: ${cddResponseId}`);
    }
    const customer = await this.getCustomerOrThrow(cddResponse.customerId);
    const cycle =
      customer.activePeriodicReviewCycle &&
      customer.activePeriodicReviewCycle.id === cddResponse.periodicReviewCycleId
        ? customer.activePeriodicReviewCycle
        : await (this.prisma as any).periodicReviewCycle.findUnique({
            where: { id: cddResponse.periodicReviewCycleId },
          });
    if (!cycle) {
      throw new NotFoundException(
        `Periodic review cycle not found: ${cddResponse.periodicReviewCycleId}`,
      );
    }

    const signals = this.buildManualCddSignals({
      caseNo: cddResponse.caseNo,
      cddResponseId: cddResponse.id,
      cycleNo: cycle.cycleNo,
      riskLevel: input.riskLevel,
      reasonCode: input.reasonCode,
    });

    const decision = await this.riskEngineService.completeDecisionRecord(
      input.decisionRecordId,
      {
        contextType: 'PERIODIC_REVIEW_CDD',
        subjectType: cddResponse.subjectKind || 'UNKNOWN',
        subjectId: cddResponse.subjectRefId || cddResponse.customerId,
        ownerType: 'CUSTOMER',
        ownerId: cddResponse.customerId,
        signals,
        policyVersion: 'periodic-review-risk-policy/v1',
      },
    );

    await this.prisma.cddResponse.update({
      where: { id: cddResponse.id },
      data: {
        status: 'FINAL',
        reviewedAt: new Date(),
        reviewerDecision: decision.decision,
        decisionReason: decision.reasonCodes.join(',') || decision.decision,
        requiresEdd: decision.reasonCodes.includes('CDD_MEDIUM_RISK_REVIEW')
          ? false
          : decision.decision === 'REQUIRE_EDD',
        inputData: JSON.stringify(signals),
        riskScore: Number(signals.riskScore),
        riskLevel: String(signals.riskLevel),
        pepHit: !!signals.pepHit,
        sanctionsHit: !!signals.sanctionsHit,
      },
    });

    await this.handleCddSubmission(
      {
        customer,
        cycle,
        cddResponse,
        decisionRecordId: decision.decisionRecordId,
        reasonCodes: decision.reasonCodes,
        recommendedActions: decision.recommendedActions,
      },
      { skipAudit: true },
    );

    return {
      decisionRecordId: decision.decisionRecordId,
      decision: decision.decision,
    };
  }

  async completeManualEddDecision(input: {
    decisionRecordId: string;
    riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
    reasonCode: string;
  }) {
    const decisionRecord = await (this.prisma as any).workflowDecisionRecord.findUnique({
      where: { id: input.decisionRecordId },
      select: {
        id: true,
        status: true,
        contextType: true,
        inputPayload: true,
      },
    });

    if (!decisionRecord) {
      throw new NotFoundException(
        `Risk decision record not found: ${input.decisionRecordId}`,
      );
    }
    if (
      String(decisionRecord.contextType || '').trim().toUpperCase() !==
      'PERIODIC_REVIEW_EDD'
    ) {
      throw new BadRequestException(
        `Decision record ${input.decisionRecordId} is not bound to PERIODIC_REVIEW_EDD`,
      );
    }
    if (String(decisionRecord.status || '').trim().toUpperCase() !== 'CREATED') {
      throw new BadRequestException(
        `Decision record ${input.decisionRecordId} is not pending simulation`,
      );
    }

    const storedInput = this.parseJsonSafely(decisionRecord.inputPayload);
    const storedSignals = this.parseJsonSafely(
      typeof storedInput.signals === 'object' && !Array.isArray(storedInput.signals)
        ? JSON.stringify(storedInput.signals)
        : undefined,
    );
    const eddResponseId = String(storedSignals.eddResponseId || '').trim();
    if (!eddResponseId) {
      throw new BadRequestException(
        `Decision record ${input.decisionRecordId} missing eddResponseId`,
      );
    }

    const eddResponse = await this.prisma.eddResponse.findUnique({
      where: { id: eddResponseId },
    });
    if (!eddResponse) {
      throw new NotFoundException(`Periodic review EDD response not found: ${eddResponseId}`);
    }
    const customer = await this.getCustomerOrThrow(eddResponse.customerId);
    const cycle =
      customer.activePeriodicReviewCycle &&
      customer.activePeriodicReviewCycle.id === eddResponse.periodicReviewCycleId
        ? customer.activePeriodicReviewCycle
        : await (this.prisma as any).periodicReviewCycle.findUnique({
            where: { id: eddResponse.periodicReviewCycleId },
          });
    if (!cycle) {
      throw new NotFoundException(
        `Periodic review cycle not found: ${eddResponse.periodicReviewCycleId}`,
      );
    }

    const signals = this.buildManualEddSignals({
      caseNo: eddResponse.caseNo,
      eddResponseId: eddResponse.id,
      cycleNo: cycle.cycleNo,
      riskLevel: input.riskLevel,
      reasonCode: input.reasonCode,
    });

    const decision = await this.riskEngineService.completeDecisionRecord(
      input.decisionRecordId,
      {
        contextType: 'PERIODIC_REVIEW_EDD',
        subjectType: eddResponse.subjectKind || 'UNKNOWN',
        subjectId: eddResponse.subjectRefId || eddResponse.customerId,
        ownerType: 'CUSTOMER',
        ownerId: eddResponse.customerId,
        signals,
        policyVersion: 'periodic-review-risk-policy/v1',
      },
    );

    await this.prisma.eddResponse.update({
      where: { id: eddResponse.id },
      data: {
        status: 'FINAL',
        mlroReviewedAt: new Date(),
        mlroDecision: decision.decision,
        decisionReason: decision.reasonCodes.join(',') || decision.decision,
        inputData: JSON.stringify(signals),
      },
    });

    await this.handleEddSubmission(
      {
        customer,
        cycle,
        eddResponse,
        decisionRecordId: decision.decisionRecordId,
        reasonCodes: decision.reasonCodes,
        recommendedActions: decision.recommendedActions,
      },
      { skipAudit: true },
    );

    return {
      decisionRecordId: decision.decisionRecordId,
      decision: decision.decision,
    };
  }

  async mockCompleteSession(
    customerId: string,
    actorId: string,
    sessionId: string,
    body: MockCompleteSessionDto = {},
  ) {
    const session = await this.prisma.complianceSession.findFirst({
      where: {
        id: sessionId,
        customerId,
      },
    });
    if (!session) {
      throw new NotFoundException(`Compliance session not found: ${sessionId}`);
    }
    if (session.status !== 'PENDING') {
      throw new BadRequestException(`Session ${sessionId} is not pending.`);
    }

    const now = new Date();
    if (session.expiresAt.getTime() < now.getTime()) {
      await this.prisma.complianceSession.update({
        where: { id: session.id },
        data: { status: 'EXPIRED' },
      });
      throw new BadRequestException(`Session ${sessionId} is expired.`);
    }

    const customer = await this.getCustomerOrThrow(customerId);
    if (!customer.activePeriodicReviewCycleId || !customer.activePeriodicReviewCycle) {
      throw new NotFoundException(`Active periodic review cycle not found for ${customerId}`);
    }
    const cycle = customer.activePeriodicReviewCycle;

    const resolvedMock = this.resolveMockDataType(body);
    const result = resolvedMock.result;
    const mockDataType = session.caseType === 'CDD' ? resolvedMock.mockDataType : null;

    await this.prisma.complianceSession.update({
      where: { id: session.id },
      data: {
        status: 'COMPLETED',
        completedAt: now,
        rawPayload: JSON.stringify({
          callback: 'MOCK',
          result,
          mockDataType: mockDataType || null,
          completedAt: now.toISOString(),
        }),
      },
    });

    if (session.caseType === 'CDD') {
      const cddResponse = await this.prisma.cddResponse.findUnique({
        where: { id: session.caseId },
      });
      if (
        !cddResponse ||
        cddResponse.customerId !== customerId ||
        cddResponse.workflow !== PERIODIC_REVIEW_WORKFLOW
      ) {
        throw new NotFoundException(`Periodic review CDD response not found: ${session.caseId}`);
      }

      const signals = this.buildPendingCddSignals({
        caseNo: cddResponse.caseNo,
        cddResponseId: cddResponse.id,
        cycleNo: cycle.cycleNo,
      });
      await this.prisma.cddResponse.update({
        where: { id: cddResponse.id },
        data: {
          status: 'RECEIVED',
          submittedAt: now,
          inputData: JSON.stringify(signals),
          riskScore: null,
          riskLevel: null,
          pepHit: !!signals.pepHit,
          sanctionsHit: !!signals.sanctionsHit,
        },
      });
      await this.prisma.cddResponseReport.create({
        data: {
          customerId,
          cddResponseId: cddResponse.id,
          provider: session.provider,
          providerSessionId: session.providerSessionId,
          rawPayload: JSON.stringify({
            sessionId,
            result,
            mockDataType: mockDataType || 'LOW_RISK',
            signals,
          }),
          normalizedPayload: JSON.stringify(signals),
        },
      });

      const pendingDecision = await this.riskEngineService.createPendingDecisionRecord({
        contextType: 'PERIODIC_REVIEW_CDD',
        subjectType: cddResponse.subjectKind || 'UNKNOWN',
        subjectId: cddResponse.subjectRefId || customerId,
        ownerType: 'CUSTOMER',
        ownerId: customerId,
        signals,
        policyVersion: 'periodic-review-risk-policy/v1',
      });
      const updatedCycle = await (this.prisma as any).periodicReviewCycle.update({
        where: { id: cycle.id },
        data: {
          status: 'CDD_UNDER_REVIEW',
          latestDecisionRecordId: pendingDecision.decisionRecordId,
          currentCddResponseId: cddResponse.id,
        },
      });

      await this.writeAudit({
        customerId: customer.id,
        caseType: 'CDD',
        caseId: cddResponse.id,
        action: 'PERIODIC_REVIEW_CDD_SUBMITTED',
        actorId,
        actorRole: 'CUSTOMER',
        fromStage: 'PENDING_CDD_INPUT',
        toStage: 'CDD_UNDER_REVIEW',
        detail: `Periodic review CDD queued for manual risk simulation decisionRecordId=${pendingDecision.decisionRecordId}.`,
      });

      return {
        ...this.buildSessionResponse({ ...session, status: 'COMPLETED' }),
        decision: {
          decisionRecordId: pendingDecision.decisionRecordId,
          status: 'CREATED',
          decision: null,
        },
        ...this.buildNextStep(updatedCycle),
      };
    }

    const eddResponse = await this.prisma.eddResponse.findUnique({
      where: { id: session.caseId },
    });
    if (
      !eddResponse ||
      eddResponse.customerId !== customerId ||
      eddResponse.workflow !== PERIODIC_REVIEW_WORKFLOW
    ) {
      throw new NotFoundException(`Periodic review EDD response not found: ${session.caseId}`);
    }

    const signals = this.buildPendingEddSignals({
      caseNo: eddResponse.caseNo,
      eddResponseId: eddResponse.id,
      cycleNo: cycle.cycleNo,
    });
    await this.prisma.eddResponse.update({
      where: { id: eddResponse.id },
      data: {
        status: 'RECEIVED',
        submittedAt: now,
        inputData: JSON.stringify(signals),
      },
    });
    await this.prisma.eddResponseReport.create({
      data: {
        customerId,
        eddResponseId: eddResponse.id,
        provider: session.provider,
        providerSessionId: session.providerSessionId,
        rawPayload: JSON.stringify({ sessionId, result, signals }),
        normalizedPayload: JSON.stringify(signals),
      },
    });

    const pendingDecision = await this.riskEngineService.createPendingDecisionRecord({
      contextType: 'PERIODIC_REVIEW_EDD',
      subjectType: eddResponse.subjectKind || 'UNKNOWN',
      subjectId: eddResponse.subjectRefId || customerId,
      ownerType: 'CUSTOMER',
      ownerId: customerId,
      signals,
      policyVersion: 'periodic-review-risk-policy/v1',
    });
    const updatedCycle = await (this.prisma as any).periodicReviewCycle.update({
      where: { id: cycle.id },
      data: {
        status: 'EDD_UNDER_REVIEW',
        latestDecisionRecordId: pendingDecision.decisionRecordId,
        currentEddResponseId: eddResponse.id,
      },
    });

    await this.writeAudit({
      customerId: customer.id,
      caseType: 'EDD',
      caseId: eddResponse.id,
      action: 'PERIODIC_REVIEW_EDD_SUBMITTED',
      actorId,
      actorRole: 'CUSTOMER',
      fromStage: 'PENDING_EDD_INPUT',
      toStage: 'EDD_UNDER_REVIEW',
      detail: `Periodic review EDD queued for manual risk simulation decisionRecordId=${pendingDecision.decisionRecordId}.`,
    });

    return {
      ...this.buildSessionResponse({ ...session, status: 'COMPLETED' }),
      decision: {
        decisionRecordId: pendingDecision.decisionRecordId,
        status: 'CREATED',
        decision: null,
      },
      ...this.buildNextStep(updatedCycle),
    };
  }

  private async createPeriodicReviewCycle(
    customerId: string,
    actor: {
      actorId: string;
      actorRole: string;
      actorType?: string;
      actorNo?: string | null;
      sourcePlatform?: string;
    },
    reason?: string | null,
    forceDueAt?: Date | null,
  ) {
    const customer = await this.prisma.customerMain.findUnique({
      where: { id: customerId },
      select: {
        id: true,
        customerNo: true,
        onboardingStatus: true,
        operatingStatus: true,
        restrictionStatus: true,
        complianceHoldStatus: true,
        activePeriodicReviewCycleId: true,
        nextReviewAt: true,
        periodicReviewOverdueAt: true,
        periodicReviewOverdueReason: true,
      },
    });
    if (!customer) {
      throw new NotFoundException(`Customer not found: ${customerId}`);
    }
    if (
      String(customer.onboardingStatus || '').trim().toUpperCase() !== 'APPROVED' ||
      String(customer.operatingStatus || '').trim().toUpperCase() !== 'ACTIVE'
    ) {
      throw new ConflictException('Periodic review trigger requires customer APPROVED + ACTIVE.');
    }
    if (customer.activePeriodicReviewCycleId) {
      const existing = await (this.prisma as any).periodicReviewCycle.findUnique({
        where: { id: customer.activePeriodicReviewCycleId },
      });
      return {
        blocked: false,
        created: false,
        customer,
        cycle: existing,
      };
    }

    const now = new Date();
    if (String(customer.restrictionStatus || '').trim().toUpperCase() === 'RESTRICTED') {
      await this.prisma.customerMain.update({
        where: { id: customerId },
        data: {
          periodicReviewOverdueAt: customer.periodicReviewOverdueAt || now,
          periodicReviewOverdueReason: 'EXISTING_RESTRICTION',
        },
      });
      return { blocked: true, reason: 'EXISTING_RESTRICTION' as const, customer };
    }
    if (String(customer.complianceHoldStatus || '').trim().toUpperCase() === 'FROZEN') {
      await this.prisma.customerMain.update({
        where: { id: customerId },
        data: {
          periodicReviewOverdueAt: customer.periodicReviewOverdueAt || now,
          periodicReviewOverdueReason: 'EXISTING_FREEZE',
        },
      });
      return { blocked: true, reason: 'EXISTING_FREEZE' as const, customer };
    }

    const dueAt = forceDueAt || customer.nextReviewAt || now;
    const created = await this.prisma.$transaction(async (tx) => {
      const cycle = await (tx as any).periodicReviewCycle.create({
        data: {
          cycleNo: generateReferenceNo('PRR'),
          customerId: customer.id,
          status: 'PENDING_CDD_INPUT',
          dueAt,
          triggeredAt: now,
          resolutionReason: null,
        },
      });

      const cddResponse = await tx.cddResponse.create({
        data: {
          caseNo: generateReferenceNo('CDD'),
          customerId: customer.id,
          customerType: 'INDIVIDUAL',
          subjectKind: 'INDIVIDUAL_CUSTOMER',
          subjectRefId: customer.id,
          journeyId: cycle.cycleNo,
          workflow: PERIODIC_REVIEW_WORKFLOW,
          periodicReviewCycleId: cycle.id,
          status: 'CREATED',
        },
      });

      await (tx as any).periodicReviewCycle.update({
        where: { id: cycle.id },
        data: {
          currentCddResponseId: cddResponse.id,
        },
      });

      await tx.customerMain.update({
        where: { id: customer.id },
        data: {
          ...this.buildCustomerActiveCyclePatch(cycle.id),
          periodicReviewOverdueAt: null,
          periodicReviewOverdueReason: null,
        },
      });

      return {
        cycleId: cycle.id,
      };
    });

    const cycle = await (this.prisma as any).periodicReviewCycle.findUnique({
      where: { id: created.cycleId },
    });
    if (cycle) {
      await this.writeAudit({
        customerId: customer.id,
        action: 'PERIODIC_REVIEW_CYCLE_CREATED',
        actorId: actor.actorId,
        actorRole: actor.actorRole,
        fromStage: null,
        toStage: String(cycle.status || '').trim().toUpperCase() || null,
        detail: reason || `Periodic review cycle ${cycle.cycleNo} created.`,
      });
    }
    return {
      blocked: false,
      created: true,
      customer,
      cycle,
    };
  }

  async triggerPeriodicReview(customerId: string, actorId: string, actorRole: string, reason?: string) {
    return this.createPeriodicReviewCycle(
      customerId,
      {
        actorId,
        actorRole,
        actorType: 'ADMIN',
        sourcePlatform: 'ADMIN_API',
      },
      reason || null,
    );
  }

  async sweepDueCustomers(now = new Date()) {
    const customers = await this.prisma.customerMain.findMany({
      where: {
        onboardingStatus: 'APPROVED',
        operatingStatus: 'ACTIVE',
        activePeriodicReviewCycleId: null,
        nextReviewAt: {
          lte: now,
        },
      },
      select: {
        id: true,
      },
      take: 100,
      orderBy: { nextReviewAt: 'asc' },
    });

    let createdCount = 0;
    let blockedCount = 0;
    for (const customer of customers) {
      const result = await this.createPeriodicReviewCycle(
        customer.id,
        {
          actorId: 'SYSTEM',
          actorRole: 'SYSTEM',
          actorType: 'SYSTEM',
          sourcePlatform: 'SYSTEM',
        },
        'Periodic review due',
        now,
      );
      if (result.blocked) blockedCount += 1;
      if (result.created) createdCount += 1;
    }

    if (createdCount || blockedCount) {
      this.logger.log(
        `Periodic review sweep created=${createdCount} blocked=${blockedCount}`,
      );
    }

    return { createdCount, blockedCount };
  }

}
