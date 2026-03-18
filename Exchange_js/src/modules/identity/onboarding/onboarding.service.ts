import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { generateReferenceNo } from '../../../common/utils/no-generator.util';
import { PrismaService } from '../../../core/prisma/prisma.service';
import {
  ComplianceAlertAction,
  ComplianceAlertSeverity,
} from '../../risk-engine/compliance-alerts/constants/compliance-alert-rules.constant';
import { ComplianceIncidentsService } from '../../risk-engine/compliance-incidents/compliance-incidents.service';
import {
  ALERT_DISPOSITION_CODES,
  CASE_DISPOSITION_CODES,
} from '../../risk-engine/constants/compliance-disposition.constant';
import {
  getCanonicalOnboardingRuleForStage,
  ONBOARDING_REVIEW_STAGES,
  OnboardingReviewStage,
  ONBOARDING_WORKFLOW,
} from '../../risk-engine/constants/onboarding-compliance-workflow.constant';
import {
  RiskDecisionOrchestratorService,
  UpsertOnboardingReviewAlertInput,
} from '../../risk-engine/risk-decision-orchestrator.service';
import {
  RiskDecision,
  RiskEngineService,
  RiskRecommendedAction,
} from '../../risk-engine/risk-engine.service';
import {
  ApplyOnboardingAlertDecisionDto,
  BootstrapCasesDto,
  CreateCaseSessionDto,
  FinalReviewCustomerDto,
  MockCompleteSessionDto,
  OnboardingMockDataType,
  ReinitiateEddDto,
  ReviewCddCaseDto,
  ReviewEddCaseDto,
  UpdateInvestorClassificationDto,
  UpsertEntityDto,
} from './dto/onboarding.dto';
import { WorkflowTransitionService } from './workflow-transition.service';

type TradeAction = 'SWAP' | 'WITHDRAW' | 'DEPOSIT';
type CaseType = 'CDD' | 'EDD';
type SubjectKind = 'INDIVIDUAL_CUSTOMER' | 'CORPORATE_ENTITY' | 'UBO_PERSON';
type MockResult = 'PASS' | 'FAIL';
export type CustomerPublicStatus =
  | 'NONE'
  | 'PENDING_CDD'
  | 'REVIEW_CDD'
  | 'PENDING_EDD'
  | 'REVIEW_EDD'
  | 'FINAL_APPROVAL'
  | 'ACTIVE'
  | 'REJECTED'
  | 'WITHDRAWN';

export type OnboardingActionType =
  | 'START_CDD'
  | 'CREATE_CDD_SESSION'
  | 'COMPLETE_CDD'
  | 'START_EDD'
  | 'CREATE_EDD_SESSION'
  | 'COMPLETE_EDD'
  | 'WAIT_REVIEW'
  | 'WAIT_FINAL_APPROVAL'
  | 'REINITIATE_CDD'
  | 'NONE';

export interface OnboardingAction {
  type: OnboardingActionType;
  payload?: Record<string, unknown>;
}

export interface NextStepPayload {
  publicStatus: CustomerPublicStatus;
  actions: OnboardingAction[];
  blockedReason: string | null;
  activeCaseId: string | null;
  requiresEdd: boolean;
}

export interface SessionResponse {
  sessionId: string;
  providerSessionId: string;
  caseType: CaseType;
  caseId: string;
  qrCodeUrl: string;
  expiresAt: Date;
  status: string;
}

@Injectable()
export class OnboardingService {
  private readonly logger = new Logger(OnboardingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly riskEngineService: RiskEngineService,
    private readonly riskDecisionOrchestratorService: RiskDecisionOrchestratorService,
    private readonly workflowTransitionService: WorkflowTransitionService,
    private readonly complianceIncidentsService: ComplianceIncidentsService,
  ) {}

  private parseJsonSafely(value?: string | null): Record<string, unknown> {
    if (!value) return {};
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
      return {};
    } catch {
      return {};
    }
  }

  private parseJsonArraySafely<T = unknown>(value?: string | null): T[] {
    if (!value) return [];
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? (parsed as T[]) : [];
    } catch {
      return [];
    }
  }

  private normalizePublicStatus(value?: string | null): CustomerPublicStatus {
    const current = String(value || 'NONE').trim().toUpperCase();
    const all: CustomerPublicStatus[] = [
      'NONE',
      'PENDING_CDD',
      'REVIEW_CDD',
      'PENDING_EDD',
      'REVIEW_EDD',
      'FINAL_APPROVAL',
      'ACTIVE',
      'REJECTED',
      'WITHDRAWN',
    ];
    if (all.includes(current as CustomerPublicStatus)) {
      return current as CustomerPublicStatus;
    }
    return 'NONE';
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

  private buildEddMockSignals(caseNo: string, result: MockResult) {
    const seed = this.buildSeed(`EDD:${caseNo}:${result}`);
    const failMode = result === 'FAIL';
    const riskScore = failMode
      ? 75 + (seed % 21)
      : 25 + (seed % 35);
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

  private buildCddMockSignals(caseNo: string, mockDataType: OnboardingMockDataType) {
    const seed = this.buildSeed(`CDD:${caseNo}:${mockDataType}`);
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

  private addDays(base: Date, days: number): Date {
    return new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
  }

  private mapActionsByStatus(status: CustomerPublicStatus): OnboardingAction[] {
    switch (status) {
      case 'NONE':
        return [{ type: 'START_CDD' }];
      case 'PENDING_CDD':
        return [{ type: 'COMPLETE_CDD' }];
      case 'REVIEW_CDD':
      case 'REVIEW_EDD':
        return [{ type: 'WAIT_REVIEW' }];
      case 'PENDING_EDD':
        return [{ type: 'COMPLETE_EDD' }];
      case 'FINAL_APPROVAL':
        return [{ type: 'WAIT_FINAL_APPROVAL' }];
      case 'ACTIVE':
        return [{ type: 'NONE' }];
      case 'REJECTED':
      case 'WITHDRAWN':
        return [{ type: 'REINITIATE_CDD' }];
      default:
        return [{ type: 'START_CDD' }];
    }
  }

  private buildBlockedReason(status: CustomerPublicStatus): string | null {
    switch (status) {
      case 'REVIEW_CDD':
        return 'CDD evidence received and waiting compliance handling.';
      case 'REVIEW_EDD':
        return 'EDD evidence received and waiting compliance handling.';
      case 'FINAL_APPROVAL':
        return 'Waiting final onboarding decision.';
      case 'REJECTED':
        return 'Onboarding is rejected. Re-initiate required.';
      case 'WITHDRAWN':
        return 'Onboarding is withdrawn.';
      case 'ACTIVE':
        return 'Onboarding completed.';
      default:
        return null;
    }
  }

  private buildNextStep(customer: any): NextStepPayload {
    const publicStatus = this.normalizePublicStatus(customer.publicStatus);
    return {
      publicStatus,
      actions: this.mapActionsByStatus(publicStatus),
      blockedReason: this.buildBlockedReason(publicStatus),
      activeCaseId: customer.activeCaseId || null,
      requiresEdd: !!customer.eddRequired,
    };
  }

  private async writeAudit(input: {
    customerId: string;
    action: string;
    actorId: string;
    actorRole: string;
    fromStage?: string | null;
    toStage?: string | null;
    caseType?: string;
    caseId?: string;
    detail?: string | null;
  }) {
    await (this.prisma as any).onboardingAuditLog.create({
      data: {
        customerId: input.customerId,
        caseType: input.caseType || null,
        caseId: input.caseId || null,
        action: input.action,
        actorId: input.actorId,
        actorRole: input.actorRole,
        fromStage: input.fromStage || null,
        toStage: input.toStage || null,
        detail: input.detail || null,
      },
    });
  }

  private async getCustomerOrThrow(customerId: string, includeEntity = false): Promise<any> {
    const customer = await this.prisma.customerMain.findUnique({
      where: { id: customerId },
      include: includeEntity
        ? {
            corporateProfile: true,
            uboProfiles: {
              orderBy: { createdAt: 'asc' },
            },
          }
        : undefined,
    });

    if (!customer) {
      throw new NotFoundException(`Customer not found: ${customerId}`);
    }

    return customer;
  }

  private async autoExpireIfNeeded(customerId: string): Promise<void> {
    const customer = await this.prisma.customerMain.findUnique({
      where: { id: customerId },
      select: {
        id: true,
        publicStatus: true,
        cddDocumentExpiresAt: true,
      },
    });

    if (!customer) {
      throw new NotFoundException(`Customer not found: ${customerId}`);
    }

    const currentStatus = this.normalizePublicStatus(customer.publicStatus);
    const expired =
      customer.cddDocumentExpiresAt &&
      customer.cddDocumentExpiresAt.getTime() <= Date.now();

    if (currentStatus !== 'ACTIVE' || !expired) {
      return;
    }

    await this.prisma.customerMain.update({
      where: { id: customerId },
      data: {
        publicStatus: 'PENDING_CDD',
        cddStatus: 'EXPIRED',
        complianceStatus: 'EXPIRED',
        finalApprovalStatus: 'NOT_REQUIRED',
        finalApprovalReason: 'CDD expired',
        finalApprovalReviewerId: null,
        finalApprovalReviewedAt: null,
      },
    });
  }

  private ensureIndividualOnly(customer: any) {
    if (customer.customerType === 'CORPORATE') {
      throw new BadRequestException(
        'Corporate onboarding is disabled in current onboarding flow.',
      );
    }
  }

  private normalizeTake(take?: number): number {
    if (!take || take < 1) return 20;
    return Math.min(take, 200);
  }

  private normalizeSkip(skip?: number): number {
    if (!skip || skip < 0) return 0;
    return skip;
  }

  private buildSessionResponse(session: any): SessionResponse {
    return {
      sessionId: session.id,
      providerSessionId: session.providerSessionId,
      caseType: session.caseType,
      caseId: session.caseId,
      qrCodeUrl: session.qrCodeUrl,
      expiresAt: session.expiresAt,
      status: session.status,
    };
  }

  private async upsertJourneyAlert(
    input: UpsertOnboardingReviewAlertInput,
  ): Promise<any | null> {
    return this.riskDecisionOrchestratorService.upsertOnboardingReviewAlert(input);
  }

  private async closeJourneyAlertIfAny(
    customerId: string,
    journeyId: string,
    reason: string,
    stage?: OnboardingReviewStage,
  ): Promise<void> {
    await this.riskDecisionOrchestratorService.closeLatestJourneyAlertIfAny({
      customerId,
      journeyId,
      reason,
      stage,
    });
  }

  private async createEddCaseIfNeeded(
    customerId: string,
    journeyId: string,
    cddCaseId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<any> {
    const db = tx || this.prisma;
    const existing = await db.eddCase.findFirst({
      where: {
        customerId,
        journeyId,
        status: 'CREATED',
      },
      orderBy: { createdAt: 'desc' },
    });

    if (existing) return existing;

    return db.eddCase.create({
      data: {
        caseNo: generateReferenceNo('EDD'),
        customerId,
        cddCaseId,
        subjectKind: 'INDIVIDUAL_CUSTOMER',
        subjectRefId: customerId,
        journeyId,
        status: 'CREATED',
      },
    });
  }

  private async handleCddDecision(input: {
    customer: any;
    cddCase: any;
    decision: RiskDecision;
    decisionRecordId: string;
    reasonCodes: string[];
    recommendedActions: RiskRecommendedAction[];
    mockDataType: OnboardingMockDataType;
  }) {
    const {
      customer,
      cddCase,
      decisionRecordId,
      reasonCodes,
      recommendedActions,
    } = input;
    const isLowRiskAutoPass = input.mockDataType === 'LOW_RISK';
    const now = new Date();
    const journeyId = cddCase.journeyId || customer.activeJourneyId || generateReferenceNo('ONB');

    const updateData: Prisma.CustomerMainUpdateInput = isLowRiskAutoPass
      ? {
          latestDecisionRecordId: decisionRecordId,
          activeJourneyId: journeyId,
          publicStatus: 'ACTIVE',
          cddStatus: 'APPROVED',
          eddRequired: false,
          eddStatus: 'NOT_REQUIRED',
          complianceStatus: 'ACTIVE',
          finalApprovalStatus: 'APPROVED',
          finalApprovalReason: 'AUTO_LOW_RISK_PASS',
          finalApprovalReviewerId: 'SYSTEM',
          finalApprovalReviewedAt: now,
          activeCaseType: null,
          activeCaseId: null,
          currentCddCaseId: cddCase.id,
          currentEddCaseId: null,
          cddDocumentExpiresAt: this.addDays(now, 365),
          nextReviewAt: this.addDays(now, 365),
        }
      : {
          latestDecisionRecordId: decisionRecordId,
          activeJourneyId: journeyId,
          publicStatus: 'REVIEW_CDD',
          cddStatus: 'PENDING_REVIEW',
          eddRequired: false,
          eddStatus: 'NOT_REQUIRED',
          complianceStatus: 'IN_PROGRESS',
          finalApprovalStatus: 'NOT_REQUIRED',
          finalApprovalReason: null,
          finalApprovalReviewerId: null,
          finalApprovalReviewedAt: null,
          activeCaseType: 'CDD',
          activeCaseId: cddCase.id,
          currentCddCaseId: cddCase.id,
          currentEddCaseId: null,
        };
    const linkedCaseIds = [cddCase.id];

    const updated = await this.prisma.customerMain.update({
      where: { id: customer.id },
      data: updateData,
    });

    await this.riskDecisionOrchestratorService.orchestrate({
      workflow: ONBOARDING_WORKFLOW,
      stage: ONBOARDING_REVIEW_STAGES.REVIEW_CDD,
      customerId: customer.id,
      customerNo: customer.customerNo || null,
      journeyId,
      linkedCaseIds,
      decisionRecordId,
      decision: input.decision,
      reasonCodes,
      recommendedActions,
      contextType: 'ONBOARDING_CDD',
    });

    return updated;
  }

  private async handleEddDecision(input: {
    customer: any;
    eddCase: any;
    decision: RiskDecision;
    decisionRecordId: string;
    reasonCodes: string[];
    recommendedActions: RiskRecommendedAction[];
  }) {
    const { customer, eddCase, decisionRecordId, reasonCodes, recommendedActions } = input;
    const journeyId = eddCase.journeyId || customer.activeJourneyId || generateReferenceNo('ONB');

    const updateData: Prisma.CustomerMainUpdateInput = {
      latestDecisionRecordId: decisionRecordId,
      activeJourneyId: journeyId,
      publicStatus: 'REVIEW_EDD',
      activeCaseType: 'EDD',
      activeCaseId: eddCase.id,
      currentEddCaseId: eddCase.id,
      eddRequired: true,
      cddStatus: 'APPROVED',
      eddStatus: 'PENDING_MLRO',
      complianceStatus: 'IN_PROGRESS',
      finalApprovalStatus: 'NOT_REQUIRED',
      finalApprovalReason: null,
      finalApprovalReviewerId: null,
      finalApprovalReviewedAt: null,
    };

    const updated = await this.prisma.customerMain.update({
      where: { id: customer.id },
      data: updateData,
    });

    await this.riskDecisionOrchestratorService.orchestrate({
      workflow: ONBOARDING_WORKFLOW,
      stage: ONBOARDING_REVIEW_STAGES.REVIEW_EDD,
      customerId: customer.id,
      customerNo: customer.customerNo || null,
      journeyId,
      linkedCaseIds: [eddCase.id],
      decisionRecordId,
      decision: input.decision,
      reasonCodes,
      recommendedActions,
      contextType: 'ONBOARDING_EDD',
    });

    return updated;
  }

  async getMyOnboarding(customerId: string) {
    await this.autoExpireIfNeeded(customerId);
    const customer = await this.getCustomerOrThrow(customerId, true);
    const nextStep = this.buildNextStep(customer);

    return {
      ...customer,
      publicStatus: this.normalizePublicStatus(customer.publicStatus),
      actions: nextStep.actions,
      blockedReason: nextStep.blockedReason,
    };
  }

  async listMyCases(customerId: string) {
    await this.getCustomerOrThrow(customerId);

    const [cddCases, eddCases] = await Promise.all([
      this.prisma.cddCase.findMany({
        where: { customerId },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.eddCase.findMany({
        where: { customerId },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const cddIds = cddCases.map((item) => item.id);
    const eddIds = eddCases.map((item) => item.id);

    const sessions =
      cddIds.length + eddIds.length > 0
        ? await this.prisma.complianceSession.findMany({
            where: {
              customerId,
              OR: [
                ...(cddIds.length > 0
                  ? [
                      {
                        caseType: 'CDD',
                        caseId: { in: cddIds },
                      },
                    ]
                  : []),
                ...(eddIds.length > 0
                  ? [
                      {
                        caseType: 'EDD',
                        caseId: { in: eddIds },
                      },
                    ]
                  : []),
              ],
            },
            orderBy: { createdAt: 'desc' },
          })
        : [];

    const latestSessionMap = new Map<string, any>();
    sessions.forEach((session: any) => {
      const key = `${session.caseType}:${session.caseId}`;
      if (!latestSessionMap.has(key)) {
        latestSessionMap.set(key, session);
      }
    });

    const items = [
      ...cddCases.map((item) => ({
        ...item,
        caseType: 'CDD' as const,
        inputData: this.parseJsonSafely(item.inputData),
        latestSession: latestSessionMap.get(`CDD:${item.id}`)
          ? this.buildSessionResponse(latestSessionMap.get(`CDD:${item.id}`))
          : null,
      })),
      ...eddCases.map((item) => ({
        ...item,
        caseType: 'EDD' as const,
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

  async getNextStep(customerId: string) {
    await this.autoExpireIfNeeded(customerId);
    const customer = await this.getCustomerOrThrow(customerId);
    return this.buildNextStep(customer);
  }

  async upsertEntity(customerId: string, actorId: string, dto: UpsertEntityDto) {
    const customer = await this.getCustomerOrThrow(customerId, true);

    if (dto.customerType !== 'INDIVIDUAL') {
      throw new BadRequestException('Corporate onboarding is disabled in current flow.');
    }

    const updated = await this.prisma.customerMain.update({
      where: { id: customerId },
      data: {
        customerType: 'INDIVIDUAL',
        companyName: null,
      },
    });

    if (customer.corporateProfile) {
      await this.prisma.corporateProfile.deleteMany({
        where: { customerId },
      });
    }

    if (Array.isArray(customer.uboProfiles) && customer.uboProfiles.length > 0) {
      await this.prisma.uboProfile.deleteMany({
        where: { customerId },
      });
    }

    await this.writeAudit({
      customerId,
      action: 'ENTITY_UPSERT',
      actorId,
      actorRole: 'CUSTOMER',
      fromStage: this.normalizePublicStatus(customer.publicStatus),
      toStage: this.normalizePublicStatus(updated.publicStatus),
      detail: 'Customer entity profile normalized to INDIVIDUAL only.',
    });

    return {
      ...updated,
      publicStatus: this.normalizePublicStatus(updated.publicStatus),
      actions: this.mapActionsByStatus(this.normalizePublicStatus(updated.publicStatus)),
    };
  }

  async startCddCases(customerId: string, actorId: string, dto: BootstrapCasesDto) {
    const customer = await this.getCustomerOrThrow(customerId);
    this.ensureIndividualOnly(customer);

    const currentStatus = this.normalizePublicStatus(customer.publicStatus);
    if (['REVIEW_CDD', 'REVIEW_EDD', 'FINAL_APPROVAL', 'ACTIVE'].includes(currentStatus)) {
      throw new BadRequestException(
        `Current status ${currentStatus} does not allow starting new CDD case.`,
      );
    }

    const journeyId = dto?.journeyId || customer.activeJourneyId || generateReferenceNo('ONB');

    let cddCase: any = null;
    if (customer.currentCddCaseId) {
      cddCase = await this.prisma.cddCase.findUnique({
        where: { id: customer.currentCddCaseId },
      });
      if (cddCase && cddCase.customerId !== customerId) {
        cddCase = null;
      }
    }

    if (!cddCase || cddCase.status !== 'CREATED') {
      cddCase = await this.prisma.cddCase.create({
        data: {
          caseNo: generateReferenceNo('CDD'),
          customerId,
          customerType: 'INDIVIDUAL',
          subjectKind: 'INDIVIDUAL_CUSTOMER',
          subjectRefId: customerId,
          journeyId,
          status: 'CREATED',
        },
      });
    }

    const updated = await this.prisma.customerMain.update({
      where: { id: customerId },
      data: {
        publicStatus: 'PENDING_CDD',
        cddStatus: 'IN_PROGRESS',
        eddRequired: false,
        eddStatus: 'NOT_REQUIRED',
        complianceStatus: 'IN_PROGRESS',
        finalApprovalStatus: 'NOT_REQUIRED',
        finalApprovalReason: null,
        finalApprovalReviewerId: null,
        finalApprovalReviewedAt: null,
        activeJourneyId: journeyId,
        activeCaseType: 'CDD',
        activeCaseId: cddCase.id,
        currentCddCaseId: cddCase.id,
        currentEddCaseId: null,
      },
    });

    const session = await this.createCaseSession(customerId, actorId, cddCase.id, {
      caseType: 'CDD',
      provider: 'MOCK',
    });

    await this.writeAudit({
      customerId,
      action: 'CDD_BOOTSTRAP',
      actorId,
      actorRole: 'CUSTOMER',
      caseType: 'CDD',
      caseId: cddCase.id,
      fromStage: currentStatus,
      toStage: 'PENDING_CDD',
      detail: 'CDD case initialized for onboarding journey.',
    });

    return {
      journeyId,
      currentCddCaseId: cddCase.id,
      session,
      publicStatus: this.normalizePublicStatus(updated.publicStatus),
      actions: this.mapActionsByStatus(this.normalizePublicStatus(updated.publicStatus)),
    };
  }

  async reinitiateCddCases(customerId: string, actorId: string) {
    const customer = await this.getCustomerOrThrow(customerId);
    const status = this.normalizePublicStatus(customer.publicStatus);

    if (!['REJECTED', 'WITHDRAWN'].includes(status) && customer.cddStatus !== 'EXPIRED') {
      throw new BadRequestException('CDD re-initiation is only allowed after rejection/withdraw/expiry.');
    }

    await this.prisma.customerMain.update({
      where: { id: customerId },
      data: {
        cddDocumentExpiresAt: null,
        finalApprovalReason: null,
        finalApprovalReviewerId: null,
        finalApprovalReviewedAt: null,
      },
    });

    return this.startCddCases(customerId, actorId, {
      journeyId: generateReferenceNo('ONB'),
    });
  }

  async startEddCases(customerId: string, actorId: string) {
    const customer = await this.getCustomerOrThrow(customerId);
    this.ensureIndividualOnly(customer);

    if (this.normalizePublicStatus(customer.publicStatus) !== 'PENDING_EDD') {
      throw new BadRequestException('EDD can only be started when customer is in PENDING_EDD status.');
    }

    if (!customer.currentEddCaseId) {
      throw new BadRequestException('No active EDD case is available for session start.');
    }

    const session = await this.createCaseSession(customerId, actorId, customer.currentEddCaseId, {
      caseType: 'EDD',
      provider: 'MOCK',
    });

    await this.writeAudit({
      customerId,
      action: 'EDD_START',
      actorId,
      actorRole: 'CUSTOMER',
      caseType: 'EDD',
      caseId: customer.currentEddCaseId,
      fromStage: 'PENDING_EDD',
      toStage: 'PENDING_EDD',
      detail: 'EDD session started by customer.',
    });

    return {
      currentEddCaseId: customer.currentEddCaseId,
      session,
      publicStatus: 'PENDING_EDD',
      actions: this.mapActionsByStatus('PENDING_EDD'),
    };
  }

  async reinitiateEddCases(customerId: string, actorId: string, body: ReinitiateEddDto) {
    const customer = await this.getCustomerOrThrow(customerId);
    this.ensureIndividualOnly(customer);

    if (!customer.eddRequired) {
      throw new BadRequestException('EDD is not required for current onboarding journey.');
    }

    const journeyId = body?.journeyId || customer.activeJourneyId || generateReferenceNo('ONB');
    const eddCase = await this.prisma.eddCase.create({
      data: {
        caseNo: generateReferenceNo('EDD'),
        customerId,
        cddCaseId: customer.currentCddCaseId || null,
        subjectKind: 'INDIVIDUAL_CUSTOMER',
        subjectRefId: customerId,
        journeyId,
        status: 'CREATED',
      },
    });

    const updated = await this.prisma.customerMain.update({
      where: { id: customerId },
      data: {
        publicStatus: 'PENDING_EDD',
        cddStatus: 'APPROVED',
        eddRequired: true,
        eddStatus: 'REQUIRED',
        complianceStatus: 'IN_PROGRESS',
        finalApprovalStatus: 'NOT_REQUIRED',
        finalApprovalReason: null,
        finalApprovalReviewerId: null,
        finalApprovalReviewedAt: null,
        activeJourneyId: journeyId,
        activeCaseType: 'EDD',
        activeCaseId: eddCase.id,
        currentEddCaseId: eddCase.id,
      },
    });

    const session = await this.createCaseSession(customerId, actorId, eddCase.id, {
      caseType: 'EDD',
      provider: 'MOCK',
    });

    await this.writeAudit({
      customerId,
      action: 'EDD_REINITIATE',
      actorId,
      actorRole: 'CUSTOMER',
      caseType: 'EDD',
      caseId: eddCase.id,
      fromStage: this.normalizePublicStatus(customer.publicStatus),
      toStage: 'PENDING_EDD',
      detail: 'EDD case re-initiated.',
    });

    return {
      journeyId,
      currentEddCaseId: eddCase.id,
      session,
      publicStatus: this.normalizePublicStatus(updated.publicStatus),
      actions: this.mapActionsByStatus(this.normalizePublicStatus(updated.publicStatus)),
    };
  }

  private async getCaseByType(customerId: string, caseId: string, caseType: CaseType): Promise<any> {
    if (caseType === 'CDD') {
      const row = await this.prisma.cddCase.findUnique({ where: { id: caseId } });
      if (!row || row.customerId !== customerId) {
        throw new NotFoundException(`CDD case not found: ${caseId}`);
      }
      return row;
    }

    const row = await this.prisma.eddCase.findUnique({ where: { id: caseId } });
    if (!row || row.customerId !== customerId) {
      throw new NotFoundException(`EDD case not found: ${caseId}`);
    }
    return row;
  }

  async createCaseSession(
    customerId: string,
    actorId: string,
    caseId: string,
    dto: CreateCaseSessionDto,
  ) {
    await this.getCustomerOrThrow(customerId);

    let caseType: CaseType | null = dto.caseType || null;

    if (!caseType) {
      const [cddCase, eddCase] = await Promise.all([
        this.prisma.cddCase.findUnique({ where: { id: caseId } }),
        this.prisma.eddCase.findUnique({ where: { id: caseId } }),
      ]);
      if (cddCase?.customerId === customerId) {
        caseType = 'CDD';
      } else if (eddCase?.customerId === customerId) {
        caseType = 'EDD';
      }
    }

    if (!caseType) {
      throw new NotFoundException(`Case not found: ${caseId}`);
    }

    const targetCase = await this.getCaseByType(customerId, caseId, caseType);
    if (targetCase.status !== 'CREATED') {
      throw new BadRequestException(
        `${caseType} case must be in CREATED status before creating session.`,
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
      action: `${caseType}_SESSION_CREATED`,
      actorId,
      actorRole: 'CUSTOMER',
      caseType,
      caseId,
      detail: `Session ${created.id} created for case ${caseId}.`,
    });

    return this.buildSessionResponse(created);
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
        data: {
          status: 'EXPIRED',
        },
      });
      throw new BadRequestException(`Session ${sessionId} is expired.`);
    }

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
      const cddCase = await this.prisma.cddCase.findUnique({
        where: { id: session.caseId },
      });

      if (!cddCase || cddCase.customerId !== customerId) {
        throw new NotFoundException(`CDD case not found: ${session.caseId}`);
      }

      const customer = await this.getCustomerOrThrow(customerId);
      const signals = this.buildCddMockSignals(cddCase.caseNo, mockDataType || 'LOW_RISK');

      await this.prisma.cddCase.update({
        where: { id: cddCase.id },
        data: {
          status: 'RECEIVED',
          submittedAt: now,
          inputData: JSON.stringify(signals),
          riskScore: Number(signals.riskScore),
          riskLevel: String(signals.riskLevel),
          pepHit: !!signals.pepHit,
          sanctionsHit: !!signals.sanctionsHit,
        },
      });

      await this.prisma.cddCaseReport.create({
        data: {
          customerId,
          cddCaseId: cddCase.id,
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

      const decision = await this.riskEngineService.evaluate({
        contextType: 'ONBOARDING_CDD',
        subjectType: cddCase.subjectKind || 'UNKNOWN',
        subjectId: cddCase.subjectRefId || customerId,
        ownerType: 'CUSTOMER',
        ownerId: customerId,
        signals,
        policyVersion: 'onboarding-risk-policy/v1',
      });
      const effectiveMockDataType = mockDataType || 'LOW_RISK';
      const isLowRiskAutoPass = effectiveMockDataType === 'LOW_RISK';

      await this.prisma.cddCase.update({
        where: { id: cddCase.id },
        data: {
          status: 'FINAL',
          reviewedAt: now,
          reviewerDecision: isLowRiskAutoPass ? 'APPROVE' : decision.decision,
          decisionReason: isLowRiskAutoPass
            ? 'AUTO_LOW_RISK_PASS'
            : decision.reasonCodes.join(',') || decision.decision,
          requiresEdd: isLowRiskAutoPass ? false : decision.decision === 'REQUIRE_EDD',
          riskScore: Number(signals.riskScore),
          riskLevel: String(signals.riskLevel),
        },
      });

      const updatedCustomer = await this.handleCddDecision({
        customer,
        cddCase,
        decision: decision.decision,
        decisionRecordId: decision.decisionRecordId,
        reasonCodes: decision.reasonCodes,
        recommendedActions: decision.recommendedActions,
        mockDataType: effectiveMockDataType,
      });

      await this.writeAudit({
        customerId,
        action: 'CDD_SESSION_COMPLETED',
        actorId,
        actorRole: 'CUSTOMER',
        caseType: 'CDD',
        caseId: cddCase.id,
        fromStage: this.normalizePublicStatus(customer.publicStatus),
        toStage: this.normalizePublicStatus(updatedCustomer.publicStatus),
        detail: `CDD decision=${isLowRiskAutoPass ? 'AUTO_APPROVE' : decision.decision} mockDataType=${effectiveMockDataType} reasonCodes=${decision.reasonCodes.join(',')}`,
      });

      return {
        ...this.buildSessionResponse({ ...session, status: 'COMPLETED' }),
        decision,
        publicStatus: this.normalizePublicStatus(updatedCustomer.publicStatus),
        actions: this.mapActionsByStatus(this.normalizePublicStatus(updatedCustomer.publicStatus)),
      };
    }

    const eddCase = await this.prisma.eddCase.findUnique({
      where: { id: session.caseId },
    });
    if (!eddCase || eddCase.customerId !== customerId) {
      throw new NotFoundException(`EDD case not found: ${session.caseId}`);
    }

    const customer = await this.getCustomerOrThrow(customerId);
    const signals = {
      ...this.buildEddMockSignals(eddCase.caseNo, result),
      eddSubmitted: true,
    };

    await this.prisma.eddCase.update({
      where: { id: eddCase.id },
      data: {
        status: 'RECEIVED',
        submittedAt: now,
        inputData: JSON.stringify(signals),
      },
    });

    await this.prisma.eddCaseReport.create({
      data: {
        customerId,
        eddCaseId: eddCase.id,
        provider: session.provider,
        providerSessionId: session.providerSessionId,
        rawPayload: JSON.stringify({ sessionId, result, signals }),
        normalizedPayload: JSON.stringify(signals),
      },
    });

    const decision = await this.riskEngineService.evaluate({
      contextType: 'ONBOARDING_EDD',
      subjectType: eddCase.subjectKind || 'UNKNOWN',
      subjectId: eddCase.subjectRefId || customerId,
      ownerType: 'CUSTOMER',
      ownerId: customerId,
      signals,
      policyVersion: 'onboarding-risk-policy/v1',
    });

    await this.prisma.eddCase.update({
      where: { id: eddCase.id },
      data: {
        status: 'FINAL',
        mlroReviewedAt: now,
        mlroDecision: decision.decision,
        decisionReason: decision.reasonCodes.join(',') || decision.decision,
      },
    });

    const updatedCustomer = await this.handleEddDecision({
      customer,
      eddCase,
      decision: decision.decision,
      decisionRecordId: decision.decisionRecordId,
      reasonCodes: decision.reasonCodes,
      recommendedActions: decision.recommendedActions,
    });

    await this.writeAudit({
      customerId,
      action: 'EDD_SESSION_COMPLETED',
      actorId,
      actorRole: 'CUSTOMER',
      caseType: 'EDD',
      caseId: eddCase.id,
      fromStage: this.normalizePublicStatus(customer.publicStatus),
      toStage: this.normalizePublicStatus(updatedCustomer.publicStatus),
      detail: `EDD decision=${decision.decision} reasonCodes=${decision.reasonCodes.join(',')}`,
    });

    return {
      ...this.buildSessionResponse({ ...session, status: 'COMPLETED' }),
      decision,
      publicStatus: this.normalizePublicStatus(updatedCustomer.publicStatus),
      actions: this.mapActionsByStatus(this.normalizePublicStatus(updatedCustomer.publicStatus)),
    };
  }

  async listCddCases(query: {
    status?: string;
    customerType?: string;
    customerIds?: string[];
    skip?: number;
    take?: number;
  }) {
    const skip = this.normalizeSkip(query.skip);
    const take = this.normalizeTake(query.take);

    const where: Prisma.CddCaseWhereInput = {};
    if (query.status) where.status = query.status;
    if (Array.isArray(query.customerIds) && query.customerIds.length > 0) {
      where.customerId = { in: query.customerIds };
    }
    if (query.customerType) {
      where.customerType = query.customerType;
    }

    const [total, items] = await Promise.all([
      this.prisma.cddCase.count({ where }),
      this.prisma.cddCase.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        include: {
          customer: {
            select: {
              id: true,
              customerNo: true,
              email: true,
              firstName: true,
              lastName: true,
              customerType: true,
              companyName: true,
              publicStatus: true,
            },
          },
        },
      }),
    ]);

    return {
      total,
      skip,
      take,
      items,
    };
  }

  async reviewCddCase(
    _caseId: string,
    _actorId: string,
    _actorRole: string,
    _dto: ReviewCddCaseDto,
  ) {
    throw new BadRequestException(
      'CDD case page is evidence-only. Please handle decisions via alert/case workflow.',
    );
  }

  async getCddCaseDetail(id: string) {
    const row = await this.prisma.cddCase.findUnique({
      where: { id },
      include: {
        customer: {
          select: {
            id: true,
            customerNo: true,
            email: true,
            firstName: true,
            lastName: true,
            companyName: true,
            customerType: true,
            publicStatus: true,
            cddStatus: true,
            eddStatus: true,
            complianceStatus: true,
          },
        },
        reports: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });

    if (!row) {
      throw new NotFoundException(`CDD case not found: ${id}`);
    }

    const latestReport = row.reports[0] || null;

    return {
      ...row,
      inputData: this.parseJsonSafely(row.inputData),
      customerSnapshot: row.customer,
      latestReport: latestReport
        ? {
            ...latestReport,
            rawPayload: this.parseJsonSafely(latestReport.rawPayload),
            normalizedPayload: this.parseJsonSafely(latestReport.normalizedPayload),
          }
        : null,
      mockDetail: this.parseJsonSafely(row.inputData),
    };
  }

  async listEddCases(query: {
    status?: string;
    customerIds?: string[];
    skip?: number;
    take?: number;
  }) {
    const skip = this.normalizeSkip(query.skip);
    const take = this.normalizeTake(query.take);

    const where: Prisma.EddCaseWhereInput = {};
    if (query.status) where.status = query.status;
    if (Array.isArray(query.customerIds) && query.customerIds.length > 0) {
      where.customerId = { in: query.customerIds };
    }

    const [total, items] = await Promise.all([
      this.prisma.eddCase.count({ where }),
      this.prisma.eddCase.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        include: {
          customer: {
            select: {
              id: true,
              customerNo: true,
              email: true,
              firstName: true,
              lastName: true,
              customerType: true,
              companyName: true,
              publicStatus: true,
            },
          },
        },
      }),
    ]);

    return {
      total,
      skip,
      take,
      items,
    };
  }

  async mlroReviewEddCase(
    _caseId: string,
    _actorId: string,
    _actorRole: string,
    _dto: ReviewEddCaseDto,
  ) {
    throw new BadRequestException(
      'EDD case page is evidence-only. Please handle decisions via alert/case workflow.',
    );
  }

  async getEddCaseDetail(id: string) {
    const row = await this.prisma.eddCase.findUnique({
      where: { id },
      include: {
        customer: {
          select: {
            id: true,
            customerNo: true,
            email: true,
            firstName: true,
            lastName: true,
            companyName: true,
            customerType: true,
            publicStatus: true,
            cddStatus: true,
            eddStatus: true,
            complianceStatus: true,
          },
        },
        reports: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });

    if (!row) {
      throw new NotFoundException(`EDD case not found: ${id}`);
    }

    const latestReport = row.reports[0] || null;

    return {
      ...row,
      inputData: this.parseJsonSafely(row.inputData),
      customerSnapshot: row.customer,
      latestReport: latestReport
        ? {
            ...latestReport,
            rawPayload: this.parseJsonSafely(latestReport.rawPayload),
            normalizedPayload: this.parseJsonSafely(latestReport.normalizedPayload),
          }
        : null,
      mockDetail: this.parseJsonSafely(row.inputData),
    };
  }

  private resolveAlertBinding(alert: any): { customerId: string; journeyId: string } {
    let customerId = String(alert.customerId || '').trim();
    let journeyId = String(alert.journeyId || '').trim();
    if ((!customerId || !journeyId) && String(alert.sourceId || '').includes(':')) {
      const [sourceCustomerId, sourceJourneyId] = String(alert.sourceId).split(':');
      customerId = customerId || String(sourceCustomerId || '').trim();
      journeyId = journeyId || String(sourceJourneyId || '').trim();
    }
    return { customerId, journeyId };
  }

  private normalizeOnboardingAlertStage(
    value?: string | null,
  ): OnboardingReviewStage | null {
    const current = String(value || '').trim().toUpperCase();
    if (current === 'REVIEW_CDD' || current === 'REVIEW_EDD') {
      return current as OnboardingReviewStage;
    }
    return null;
  }

  private getExpectedReviewStage(
    status: CustomerPublicStatus,
  ): OnboardingReviewStage | null {
    if (status === 'REVIEW_CDD') return 'REVIEW_CDD';
    if (status === 'REVIEW_EDD') return 'REVIEW_EDD';
    return null;
  }

  private mapOnboardingAlertDisposition(decision: string) {
    switch (String(decision || '').trim().toUpperCase()) {
      case 'APPROVE':
        return ALERT_DISPOSITION_CODES.APPROVE_STAGE;
      case 'REJECT':
        return ALERT_DISPOSITION_CODES.REJECT_STAGE;
      case 'REQUIRE_EDD':
        return ALERT_DISPOSITION_CODES.REQUIRE_EDD;
      default:
        throw new BadRequestException(`Unsupported onboarding alert decision: ${decision}`);
    }
  }

  private mapOnboardingCaseDisposition(decision: string) {
    switch (String(decision || '').trim().toUpperCase()) {
      case 'APPROVE':
        return CASE_DISPOSITION_CODES.APPROVE_STAGE;
      case 'REJECT':
        return CASE_DISPOSITION_CODES.REJECT_STAGE;
      case 'REQUIRE_EDD':
        return CASE_DISPOSITION_CODES.REQUIRE_EDD;
      default:
        throw new BadRequestException(`Unsupported onboarding case decision: ${decision}`);
    }
  }

  private mapOnboardingWorkflowDisposition(decision: string) {
    return this.mapOnboardingAlertDisposition(decision);
  }

  private dedupeStringList(values: Array<string | null | undefined>): string[] {
    return Array.from(
      new Set(values.map((item) => String(item || '').trim()).filter(Boolean)),
    );
  }

  private mergeDecisionMetadata(
    currentMetadata: Record<string, unknown>,
    payload: {
      decision: string;
      reason: string;
      linkedCaseIds: string[];
      decisionRecordIds: string[];
      source: 'ALERT' | 'INCIDENT';
      sourceRefId: string;
    },
    options?: {
      appendHistory?: boolean;
    },
  ): Record<string, unknown> {
    const nowIso = new Date().toISOString();
    const historyRaw = Array.isArray(currentMetadata.decisionHistory)
      ? (currentMetadata.decisionHistory as unknown[])
      : [];
    const history = historyRaw
      .filter((item) => item && typeof item === 'object')
      .slice(-19);
    const nextHistory =
      options?.appendHistory === false
        ? historyRaw.filter((item) => item && typeof item === 'object')
        : [
            ...history,
            {
              decision: payload.decision,
              reason: payload.reason || null,
              source: payload.source,
              sourceRefId: payload.sourceRefId,
              at: nowIso,
            },
          ];
    return {
      ...currentMetadata,
      decision: payload.decision,
      recommendation: payload.decision,
      linkedCaseIds: payload.linkedCaseIds,
      decisionRecordIds: payload.decisionRecordIds,
      decisionHistory: nextHistory,
    };
  }

  private async recordDecisionOnAlert(
    tx: Prisma.TransactionClient,
    alert: any,
    input: {
      actorId: string;
      actorRole: string;
      decision: string;
      reason: string;
      linkedCaseIds: string[];
      decisionRecordIds: string[];
      source: 'ALERT' | 'INCIDENT';
      sourceRefId: string;
      closeAlert?: boolean;
    },
  ) {
    const now = new Date();
    const metadata = this.parseJsonSafely(alert.metadata);
    const dispositionCode = this.mapOnboardingAlertDisposition(input.decision);
    const mergedMetadata = this.mergeDecisionMetadata(metadata, {
      decision: input.decision,
      reason: input.reason,
      linkedCaseIds: input.linkedCaseIds,
      decisionRecordIds: input.decisionRecordIds,
      source: input.source,
      sourceRefId: input.sourceRefId,
    });

    const dispositionRecord = await tx.complianceAlertDispositionRecord.create({
      data: {
        alertId: alert.id,
        dispositionCode,
        reason: input.reason || null,
        isFinal: input.closeAlert !== false,
        supersedesRecordId: String(alert.currentDispositionRecordId || '').trim() || null,
        decisionRecordId: input.decisionRecordIds[0] || null,
        source: `${input.source}_ONBOARDING_DECISION`,
        sourceRefId: input.sourceRefId,
        actorType: 'ADMIN',
        actorId: input.actorId,
        actorNo: null,
        actorRole: input.actorRole,
        createdAt: now,
      },
    });

    const updated = await tx.complianceAlert.update({
      where: { id: alert.id },
      data: {
        status: input.closeAlert === false ? alert.status : 'CLOSED',
        closedAt: input.closeAlert === false ? alert.closedAt : now,
        closeReason:
          input.closeAlert === false
            ? alert.closeReason
            : input.reason || `Onboarding decision ${input.decision}.`,
        decisionRecommendation: input.decision,
        decision: input.decision,
        linkedCaseIds: JSON.stringify(input.linkedCaseIds),
        decisionRecordIds: JSON.stringify(input.decisionRecordIds),
        metadata: JSON.stringify(mergedMetadata),
        currentDispositionCode: dispositionCode,
        currentDispositionReason: input.reason || null,
        currentDispositionAt: now,
        currentDispositionById: input.actorId,
        currentDispositionByNo: null,
        currentDispositionByRole: input.actorRole,
        currentDispositionRecordId: dispositionRecord.id,
        finalDispositionCode:
          input.closeAlert === false ? alert.finalDispositionCode : dispositionCode,
        finalDispositionReason:
          input.closeAlert === false ? alert.finalDispositionReason : input.reason || null,
        finalDispositionAt: input.closeAlert === false ? alert.finalDispositionAt : now,
        finalDispositionRecordId:
          input.closeAlert === false ? alert.finalDispositionRecordId : dispositionRecord.id,
        lastActionById: input.actorId,
        lastActionByRole: input.actorRole,
        lastActionAt: now,
      },
    });

    await tx.complianceAlertEvent.create({
      data: {
        alertId: alert.id,
        eventType: input.closeAlert === false ? 'UPDATED' : 'CLOSED',
        eventAt: now,
        actorType: 'ADMIN',
        actorId: input.actorId,
        actorRole: input.actorRole,
        note:
          input.reason || `Onboarding decision ${input.decision} from ${input.source}.`,
        payload: JSON.stringify({
          action: 'ONBOARDING_DECISION',
          source: input.source,
          sourceRefId: input.sourceRefId,
          decision: input.decision,
          dispositionCode,
          linkedCaseIds: input.linkedCaseIds,
          decisionRecordIds: input.decisionRecordIds,
        }),
        sourcePlatform: 'ADMIN_API',
      },
    });

    return updated;
  }

  private async syncDecisionLinksOnAlert(
    tx: Prisma.TransactionClient,
    alert: any,
    input: {
      decision: string;
      reason: string;
      linkedCaseIds: string[];
      decisionRecordIds: string[];
      source: 'ALERT' | 'INCIDENT';
      sourceRefId: string;
    },
  ) {
    const metadata = this.parseJsonSafely(alert.metadata);
    const mergedMetadata = this.mergeDecisionMetadata(
      metadata,
      {
        decision: input.decision,
        reason: input.reason,
        linkedCaseIds: input.linkedCaseIds,
        decisionRecordIds: input.decisionRecordIds,
        source: input.source,
        sourceRefId: input.sourceRefId,
      },
      {
        appendHistory: false,
      },
    );

    return tx.complianceAlert.update({
      where: { id: alert.id },
      data: {
        linkedCaseIds: JSON.stringify(input.linkedCaseIds),
        decisionRecordIds: JSON.stringify(input.decisionRecordIds),
        metadata: JSON.stringify(mergedMetadata),
      },
    });
  }

  private async syncDecisionLinksOnIncident(
    tx: Prisma.TransactionClient,
    incident: any,
    input: {
      decision: string;
      reason: string;
      linkedCaseIds: string[];
      decisionRecordIds: string[];
      sourceRefId: string;
    },
  ) {
    const metadata = this.parseJsonSafely(incident.metadata);
    const mergedMetadata = this.mergeDecisionMetadata(
      metadata,
      {
        decision: input.decision,
        reason: input.reason,
        linkedCaseIds: input.linkedCaseIds,
        decisionRecordIds: input.decisionRecordIds,
        source: 'INCIDENT',
        sourceRefId: input.sourceRefId,
      },
      {
        appendHistory: false,
      },
    );

    return tx.complianceIncident.update({
      where: { id: incident.id },
      data: {
        metadata: JSON.stringify(mergedMetadata),
      },
    });
  }

  private async applyOnboardingDecisionByAlert(
    tx: Prisma.TransactionClient,
    input: {
      alert: any;
      actorId: string;
      actorRole: string;
      dto: ApplyOnboardingAlertDecisionDto;
      source: 'ALERT' | 'INCIDENT';
      sourceRefId: string;
    },
  ) {
    const { alert, actorId, actorRole, dto } = input;
    const reason = String(dto.reason || '').trim();
    const { customerId, journeyId: alertJourneyId } = this.resolveAlertBinding(alert);
    if (!customerId) {
      throw new BadRequestException('Onboarding alert is missing customer binding.');
    }

    const customer = await tx.customerMain.findUnique({
      where: { id: customerId },
    });
    if (!customer) {
      throw new NotFoundException(`Customer not found: ${customerId}`);
    }

    const fromStatus = this.normalizePublicStatus(customer.publicStatus);
    const expectedStage = this.getExpectedReviewStage(fromStatus);
    const alertStage = this.normalizeOnboardingAlertStage(alert.stage) || expectedStage;
    if (!expectedStage) {
      throw new BadRequestException(
        `Onboarding decision is only allowed in REVIEW_CDD/REVIEW_EDD, current=${fromStatus}`,
      );
    }
    if (alertStage && expectedStage !== alertStage) {
      throw new BadRequestException(
        `Onboarding alert stage mismatch, expected=${expectedStage}, actual=${alertStage}`,
      );
    }
    const journeyId =
      alertJourneyId || String(customer.activeJourneyId || '').trim() || generateReferenceNo('ONB');
    const alertLinkedCaseIds = this.parseJsonArraySafely<string>(alert.linkedCaseIds);
    const alertDecisionRecordIds = this.parseJsonArraySafely<string>(alert.decisionRecordIds);
    const latestDecisionRecordId =
      alertDecisionRecordIds[0] || customer.latestDecisionRecordId || null;

    if (expectedStage === 'REVIEW_EDD' && dto.decision === 'REQUIRE_EDD') {
      throw new BadRequestException(
        'REQUIRE_EDD is not valid while customer is in REVIEW_EDD.',
      );
    }

    const recordedAlert = await this.recordDecisionOnAlert(tx, alert, {
      actorId,
      actorRole,
      decision: dto.decision,
      reason,
      linkedCaseIds: alertLinkedCaseIds,
      decisionRecordIds: alertDecisionRecordIds,
      source: input.source,
      sourceRefId: input.sourceRefId,
      closeAlert: true,
    });

    const transition = await this.workflowTransitionService.transition(tx, {
      workflow: ONBOARDING_WORKFLOW,
      stage: expectedStage,
      producerType: input.source === 'INCIDENT' ? 'CASE' : 'ALERT',
      producerId: input.sourceRefId,
      customerId: customer.id,
      journeyId,
      dispositionCode: this.mapOnboardingWorkflowDisposition(dto.decision),
      reason,
      actorId,
      actorRole,
      latestDecisionRecordId,
      linkedCaseIds: alertLinkedCaseIds,
    });

    const linkedCaseIds = this.dedupeStringList([
      ...alertLinkedCaseIds,
      transition.eddCase?.id || null,
      transition.activeCaseId || null,
    ]);
    if (JSON.stringify(linkedCaseIds) !== JSON.stringify(alertLinkedCaseIds)) {
      await this.syncDecisionLinksOnAlert(tx, recordedAlert, {
        decision: dto.decision,
        reason,
        linkedCaseIds,
        decisionRecordIds: alertDecisionRecordIds,
        source: input.source,
        sourceRefId: input.sourceRefId,
      });
    }

    return {
      alertId: alert.id,
      updatedCustomer: transition.updatedCustomer,
      eddCase: transition.eddCase || null,
      linkedCaseIds,
      decisionRecordIds: alertDecisionRecordIds,
      transition,
    };
  }

  async applyOnboardingDecisionFromAlert(
    alertId: string,
    actorId: string,
    actorRole: string,
    dto: ApplyOnboardingAlertDecisionDto,
  ) {
    const txResult = await this.prisma.$transaction(async (tx) => {
      const alert = await tx.complianceAlert.findUnique({
        where: { id: alertId },
      });
      if (!alert) {
        throw new NotFoundException(`Compliance alert not found: ${alertId}`);
      }
      if (alert.sourceType !== 'ONBOARDING_JOURNEY') {
        throw new BadRequestException(
          'Only onboarding journey alerts support onboarding decision action.',
        );
      }
      if (alert.status !== 'ASSIGNED') {
        throw new BadRequestException(
          `Onboarding decision is only allowed when alert is ASSIGNED, current=${alert.status}`,
        );
      }
      const currentAssigneeId = String(alert.assigneeUserId || '').trim();
      if (!currentAssigneeId || currentAssigneeId !== actorId) {
        throw new ForbiddenException('Only current assignee can apply onboarding decision.');
      }

      return this.applyOnboardingDecisionByAlert(tx, {
        alert,
        actorId,
        actorRole,
        dto,
        source: 'ALERT',
        sourceRefId: alert.id,
      });
    });

    const alertDetail = await this.riskDecisionOrchestratorService.findAlertDetail(
      txResult.alertId,
    );
    const toStatus = this.normalizePublicStatus(txResult.updatedCustomer.publicStatus);

    return {
      alert: alertDetail,
      customer: {
        ...txResult.updatedCustomer,
        publicStatus: toStatus,
        actions: this.mapActionsByStatus(toStatus),
        blockedReason: this.buildBlockedReason(toStatus),
        activeCaseId: txResult.updatedCustomer.activeCaseId || null,
        requiresEdd: !!txResult.updatedCustomer.eddRequired,
      },
      eddCase: txResult.eddCase,
      transition: txResult.transition,
    };
  }

  async applyOnboardingDecisionFromIncident(
    incidentId: string,
    actorId: string,
    actorRole: string,
    dto: ApplyOnboardingAlertDecisionDto,
  ) {
    const txResult = await this.prisma.$transaction(async (tx) => {
      const incident = await tx.complianceIncident.findUnique({
        where: { id: incidentId },
      });
      if (!incident) {
        throw new NotFoundException(`Compliance case not found: ${incidentId}`);
      }
      if (incident.status !== 'ASSIGNED') {
        throw new BadRequestException(
          `Onboarding decision from case is only allowed when case is ASSIGNED, current=${incident.status}`,
        );
      }
      if (String(incident.ownerUserId || '').trim() !== actorId) {
        throw new ForbiddenException('Only case assignee can apply onboarding decision.');
      }
      if (!incident.primaryAlertId) {
        throw new BadRequestException(
          'Case has no primary onboarding alert binding.',
        );
      }

      const alert = await tx.complianceAlert.findUnique({
        where: { id: incident.primaryAlertId },
      });
      if (!alert) {
        throw new NotFoundException(
          `Compliance alert not found: ${incident.primaryAlertId}`,
        );
      }
      if (alert.sourceType !== 'ONBOARDING_JOURNEY') {
        throw new BadRequestException(
          'Case onboarding decision requires onboarding journey alert.',
        );
      }

      const decisionResult = await this.applyOnboardingDecisionByAlert(tx, {
        alert,
        actorId,
        actorRole,
        dto,
        source: 'INCIDENT',
        sourceRefId: incident.id,
      });

      const incidentMetadata = this.parseJsonSafely(incident.metadata);
      const incidentDispositionCode = this.mapOnboardingCaseDisposition(dto.decision);
      const mergedIncidentMetadata = this.mergeDecisionMetadata(incidentMetadata, {
        decision: dto.decision,
        reason: String(dto.reason || '').trim(),
        linkedCaseIds: decisionResult.linkedCaseIds,
        decisionRecordIds: decisionResult.decisionRecordIds,
        source: 'INCIDENT',
        sourceRefId: incident.id,
      });

      const now = new Date();
      const incidentDispositionRecord =
        await tx.complianceIncidentDispositionRecord.create({
          data: {
            incidentId: incident.id,
            dispositionCode: incidentDispositionCode,
            reason: String(dto.reason || '').trim() || null,
            isFinal: false,
            supersedesRecordId:
              String(incident.currentDispositionRecordId || '').trim() || null,
            decisionRecordId: decisionResult.decisionRecordIds[0] || null,
            source: 'INCIDENT_ONBOARDING_DECISION',
            sourceRefId: incident.id,
            actorType: 'ADMIN',
            actorId,
            actorNo: null,
            actorRole,
            createdAt: now,
          },
        });
      await tx.complianceIncident.update({
        where: { id: incident.id },
        data: {
          decision: dto.decision,
          metadata: JSON.stringify(mergedIncidentMetadata),
          currentDispositionCode: incidentDispositionCode,
          currentDispositionReason: String(dto.reason || '').trim() || null,
          currentDispositionAt: now,
          currentDispositionById: actorId,
          currentDispositionByNo: null,
          currentDispositionByRole: actorRole,
          currentDispositionRecordId: incidentDispositionRecord.id,
          lastActionById: actorId,
          lastActionByRole: actorRole,
          lastActionAt: now,
        },
      });
      await tx.complianceIncidentEvent.create({
        data: {
          incidentId: incident.id,
          eventType: 'UPDATED',
          eventAt: now,
          actorType: 'ADMIN',
          actorId,
          actorRole,
          note:
            String(dto.reason || '').trim() ||
            `Onboarding decision ${dto.decision} from case.`,
          payload: JSON.stringify({
            action: 'ONBOARDING_DECISION',
            decision: dto.decision,
            dispositionCode: incidentDispositionCode,
            alertId: alert.id,
          }),
          sourcePlatform: 'ADMIN_API',
        },
      });

      await this.syncDecisionLinksOnIncident(tx, incident, {
        decision: dto.decision,
        reason: String(dto.reason || '').trim(),
        linkedCaseIds: decisionResult.linkedCaseIds,
        decisionRecordIds: decisionResult.decisionRecordIds,
        sourceRefId: incident.id,
      });

      return {
        ...decisionResult,
        incidentId: incident.id,
      };
    });

    const [alertDetail, incidentDetail] = await Promise.all([
      this.riskDecisionOrchestratorService.findAlertDetail(txResult.alertId),
      this.complianceIncidentsService.findOne(txResult.incidentId),
    ]);
    const toStatus = this.normalizePublicStatus(txResult.updatedCustomer.publicStatus);

    return {
      alert: alertDetail,
      incident: incidentDetail,
      customer: {
        ...txResult.updatedCustomer,
        publicStatus: toStatus,
        actions: this.mapActionsByStatus(toStatus),
        blockedReason: this.buildBlockedReason(toStatus),
        activeCaseId: txResult.updatedCustomer.activeCaseId || null,
        requiresEdd: !!txResult.updatedCustomer.eddRequired,
      },
      eddCase: txResult.eddCase,
      transition: txResult.transition,
    };
  }

  async reviewCustomerFinalDecision(
    customerId: string,
    actorId: string,
    actorRole: string,
    dto: FinalReviewCustomerDto,
  ) {
    const customer = await this.getCustomerOrThrow(customerId);
    const currentStatus = this.normalizePublicStatus(customer.publicStatus);

    if (currentStatus !== 'FINAL_APPROVAL') {
      throw new BadRequestException('Final review is only allowed in FINAL_APPROVAL status.');
    }

    const now = new Date();
    const decision = dto.decision;

    const updated = await this.prisma.customerMain.update({
      where: { id: customerId },
      data: {
        publicStatus: decision === 'APPROVE' ? 'ACTIVE' : 'REJECTED',
        complianceStatus: decision === 'APPROVE' ? 'ACTIVE' : 'BLOCKED',
        finalApprovalStatus: decision === 'APPROVE' ? 'APPROVED' : 'REJECTED',
        finalApprovalReason: dto.reason || null,
        finalApprovalReviewerId: actorId,
        finalApprovalReviewedAt: now,
        activeCaseType: null,
        activeCaseId: null,
      },
    });

    const journeyId = customer.activeJourneyId || generateReferenceNo('ONB');

    if (decision === 'APPROVE') {
      await this.closeJourneyAlertIfAny(
        customerId,
        journeyId,
        'Final onboarding approval completed.',
        ONBOARDING_REVIEW_STAGES.REVIEW_EDD,
      );
    } else {
      await this.upsertJourneyAlert({
        customerId,
        customerNo: customer.customerNo || null,
        journeyId,
        stage: ONBOARDING_REVIEW_STAGES.REVIEW_EDD,
        recommendation: 'REJECT',
        decision: 'REJECT',
        message: dto.reason || 'Final onboarding decision is REJECT.',
        severity: ComplianceAlertSeverity.CRITICAL,
        linkedCaseIds: [customer.currentCddCaseId, customer.currentEddCaseId].filter(
          Boolean,
        ) as string[],
      });
    }

    await this.writeAudit({
      customerId,
      action: `FINAL_${decision}`,
      actorId,
      actorRole,
      fromStage: currentStatus,
      toStage: this.normalizePublicStatus(updated.publicStatus),
      detail: dto.reason || null,
    });

    return {
      ...updated,
      publicStatus: this.normalizePublicStatus(updated.publicStatus),
      actions: this.mapActionsByStatus(this.normalizePublicStatus(updated.publicStatus)),
    };
  }

  async simulateCustomerExpired(customerId: string, actorId: string, actorRole: string) {
    const customer = await this.getCustomerOrThrow(customerId);
    const expiredAt = new Date(Date.now() - 60 * 60 * 1000);
    const currentStatus = this.normalizePublicStatus(customer.publicStatus);

    await this.prisma.customerMain.update({
      where: { id: customerId },
      data: {
        cddDocumentExpiresAt: expiredAt,
      },
    });
    await this.autoExpireIfNeeded(customerId);
    const updated = await this.getCustomerOrThrow(customerId);

    await this.writeAudit({
      customerId,
      action: 'SIMULATE_EXPIRED',
      actorId,
      actorRole,
      fromStage: currentStatus,
      toStage: this.normalizePublicStatus(updated.publicStatus),
      detail: 'CDD document expiry simulated.',
    });

    return {
      ...updated,
      publicStatus: this.normalizePublicStatus(updated.publicStatus),
      actions: this.mapActionsByStatus(this.normalizePublicStatus(updated.publicStatus)),
    };
  }

  async updateInvestorClassification(
    customerId: string,
    actorId: string,
    actorRole: string,
    dto: UpdateInvestorClassificationDto,
  ) {
    await this.getCustomerOrThrow(customerId);

    const updated = await this.prisma.customerMain.update({
      where: { id: customerId },
      data: {
        investorClassification: dto.classification,
        investorClassificationSource: 'ADMIN_OVERRIDE',
        investorClassificationUpdatedAt: new Date(),
      },
    });

    await this.writeAudit({
      customerId,
      action: 'INVESTOR_CLASSIFICATION_UPDATED',
      actorId,
      actorRole,
      detail: dto.reason,
    });

    return {
      customerId: updated.id,
      investorClassification: updated.investorClassification,
      investorClassificationSource: updated.investorClassificationSource,
      investorClassificationUpdatedAt: updated.investorClassificationUpdatedAt,
    };
  }

  async assertTradingEligibility(customerId: string, action: TradeAction) {
    await this.autoExpireIfNeeded(customerId);
    const customer = await this.prisma.customerMain.findUnique({
      where: { id: customerId },
      select: {
        id: true,
        customerNo: true,
        publicStatus: true,
        complianceStatus: true,
        complianceHoldStatus: true,
        complianceHoldCaseId: true,
        cddStatus: true,
        eddStatus: true,
        finalApprovalStatus: true,
      },
    });

    if (!customer) {
      throw new NotFoundException(`Customer not found: ${customerId}`);
    }

    if (this.normalizePublicStatus(customer.publicStatus) !== 'ACTIVE') {
      throw new ForbiddenException({
        message: `${action} is blocked by onboarding gate`,
        customerId,
        customerNo: customer.customerNo,
        publicStatus: customer.publicStatus,
        complianceStatus: customer.complianceStatus,
        cddStatus: customer.cddStatus,
        eddStatus: customer.eddStatus,
        finalApprovalStatus: customer.finalApprovalStatus,
      });
    }

    if (String(customer.complianceHoldStatus || 'ACTIVE').toUpperCase() === 'FROZEN') {
      throw new ForbiddenException({
        message: `${action} is blocked by compliance hold`,
        customerId,
        customerNo: customer.customerNo,
        publicStatus: customer.publicStatus,
        complianceStatus: customer.complianceStatus,
        complianceHoldStatus: customer.complianceHoldStatus,
        complianceHoldCaseId: customer.complianceHoldCaseId,
        cddStatus: customer.cddStatus,
        eddStatus: customer.eddStatus,
        finalApprovalStatus: customer.finalApprovalStatus,
      });
    }
  }

  async recomputeComplianceSnapshot(customerId: string, _journeyId?: string) {
    const customer = await this.getCustomerOrThrow(customerId);
    const publicStatus = this.normalizePublicStatus(customer.publicStatus);

    let patch: Prisma.CustomerMainUpdateInput = {
      publicStatus,
    };

    if (publicStatus === 'NONE') {
      patch = {
        ...patch,
        cddStatus: 'NOT_STARTED',
        eddRequired: false,
        eddStatus: 'NOT_REQUIRED',
        complianceStatus: 'NONE',
        finalApprovalStatus: 'NOT_REQUIRED',
      };
    }

    if (publicStatus === 'PENDING_CDD') {
      patch = {
        ...patch,
        cddStatus: 'IN_PROGRESS',
        eddRequired: false,
        eddStatus: 'NOT_REQUIRED',
        complianceStatus: 'IN_PROGRESS',
      };
    }

    if (publicStatus === 'REVIEW_CDD') {
      patch = {
        ...patch,
        cddStatus: 'PENDING_REVIEW',
        eddRequired: false,
        eddStatus: 'NOT_REQUIRED',
        complianceStatus: 'IN_PROGRESS',
      };
    }

    if (publicStatus === 'PENDING_EDD') {
      patch = {
        ...patch,
        cddStatus: 'APPROVED',
        eddRequired: true,
        eddStatus: 'REQUIRED',
        complianceStatus: 'IN_PROGRESS',
      };
    }

    if (publicStatus === 'REVIEW_EDD') {
      patch = {
        ...patch,
        cddStatus: 'APPROVED',
        eddRequired: true,
        eddStatus: 'PENDING_MLRO',
        complianceStatus: 'IN_PROGRESS',
      };
    }

    if (publicStatus === 'FINAL_APPROVAL') {
      patch = {
        ...patch,
        cddStatus: 'APPROVED',
        eddRequired: true,
        eddStatus: 'APPROVED',
        complianceStatus: 'IN_PROGRESS',
        finalApprovalStatus: 'PENDING',
      };
    }

    if (publicStatus === 'ACTIVE') {
      patch = {
        ...patch,
        cddStatus: 'APPROVED',
        eddStatus: customer.eddRequired ? 'APPROVED' : 'NOT_REQUIRED',
        complianceStatus: 'ACTIVE',
        finalApprovalStatus: 'APPROVED',
      };
    }

    if (['REJECTED', 'WITHDRAWN'].includes(publicStatus)) {
      patch = {
        ...patch,
        cddStatus: customer.cddStatus === 'APPROVED' ? 'APPROVED' : 'REJECTED',
        eddStatus: customer.eddRequired ? 'REJECTED' : 'NOT_REQUIRED',
        complianceStatus: 'BLOCKED',
        finalApprovalStatus: 'REJECTED',
      };
    }

    const updated = await this.prisma.customerMain.update({
      where: { id: customerId },
      data: patch,
    });

    return updated;
  }
}
