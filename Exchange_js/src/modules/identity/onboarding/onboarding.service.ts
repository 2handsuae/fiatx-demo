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
import { AuditLogsService } from '../../risk-engine/audit-logs/audit-logs.service';
import {
  AuditEntityTypes,
  AuditModules,
  AuditWorkflowTypes,
} from '../../risk-engine/audit-logs/constants/audit-actions.constant';
import { AuditTriggerType } from '../../risk-engine/audit-logs/dto/audit-log.dto';
import {
  buildCustomerLifecyclePatch as buildCustomerLifecycleStatePatch,
  canReinitiateCdd,
  canReinitiateEdd,
  canStartCdd,
  canStartEdd,
  CustomerNextStepActionType,
  CustomerOnboardingStatus,
  CustomerOperatingStatus,
  CustomerReviewStage,
  CustomerRestrictionStatus,
  getCustomerBlockedReason,
  getCustomerNextStepActionTypes,
  getExpectedReviewStageFromCustomerState,
  isCustomerApprovedAndActive,
  normalizeCustomerOnboardingStatus,
  resolveCustomerCanonicalState,
} from '../customer-status.util';
import { ComplianceAlertAction } from '../../risk-engine/compliance-alerts/constants/compliance-alert-rules.constant';
import { ComplianceIncidentsService } from '../../risk-engine/compliance-incidents/compliance-incidents.service';
import {
  ALERT_DISPOSITION_CODES,
  CASE_DISPOSITION_CODES,
  normalizeWorkflowDecision,
} from '../../risk-engine/constants/compliance-disposition.constant';
import {
  buildComplianceWorkflowTraceContext,
  getCanonicalOnboardingRuleForStage,
  ONBOARDING_REVIEW_STAGES,
  OnboardingReviewStage,
  ONBOARDING_SOURCE_TYPE,
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
  BootstrapResponsesDto,
  CreateResponseSessionDto,
  MockCompleteSessionDto,
  OnboardingMockDataType,
  ReinitiateEddDto,
  SubmitFinalApprovalDto,
  UpdateInvestorClassificationDto,
  UpsertEntityDto,
} from './dto/onboarding.dto';
import { WorkflowTransitionService } from './workflow-transition.service';
import { OnboardingFinalApprovalService } from './onboarding-final-approval.service';
import {
  projectResponseRecord,
  resolveLegacyIncidentAssigneeUserId,
} from '../review-response-compat.util';

type TradeAction = 'SWAP' | 'WITHDRAW' | 'DEPOSIT';
type CaseType = 'CDD' | 'EDD';
type SubjectKind = 'INDIVIDUAL_CUSTOMER' | 'CORPORATE_ENTITY' | 'UBO_PERSON';
type MockResult = 'PASS' | 'FAIL';
export type OnboardingActionType = CustomerNextStepActionType;

export interface OnboardingAction {
  type: OnboardingActionType;
  payload?: Record<string, unknown>;
}

export interface NextStepPayload {
  actions: OnboardingAction[];
  blockedReason: string | null;
  activeCaseId: string | null;
  requiresEdd: boolean;
}

export interface SessionResponse {
  sessionId: string;
  providerSessionId: string;
  responseType: CaseType;
  caseId: string;
  qrCodeUrl: string;
  expiresAt: Date;
  status: string;
}

const customerAutoExpireSelect = {
  id: true,
  onboardingStatus: true,
  operatingStatus: true,
  restrictionStatus: true,
  cddDocumentExpiresAt: true,
} satisfies Prisma.CustomerMainSelect;

const tradingEligibilitySelect = {
  id: true,
  customerNo: true,
  onboardingStatus: true,
  operatingStatus: true,
  restrictionStatus: true,
  complianceHoldStatus: true,
  complianceHoldCaseId: true,
} satisfies Prisma.CustomerMainSelect;

@Injectable()
export class OnboardingService {
  private readonly logger = new Logger(OnboardingService.name);
  private readonly auditLogsService: AuditLogsService;

  constructor(
    private readonly prisma: PrismaService,
    private readonly riskEngineService: RiskEngineService,
    private readonly riskDecisionOrchestratorService: RiskDecisionOrchestratorService,
    private readonly workflowTransitionService: WorkflowTransitionService,
    private readonly complianceIncidentsService: ComplianceIncidentsService,
    private readonly onboardingFinalApprovalService: OnboardingFinalApprovalService,
  ) {
    this.auditLogsService = new AuditLogsService(prisma);
  }

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

  private getCanonicalState(customer: {
    onboardingStatus?: string | null;
    operatingStatus?: string | null;
    restrictionStatus?: string | null;
  }) {
    return resolveCustomerCanonicalState(customer);
  }

  private getCustomerOnboardingStatus(customer: {
    onboardingStatus?: string | null;
    operatingStatus?: string | null;
    restrictionStatus?: string | null;
  }): CustomerOnboardingStatus {
    return this.getCanonicalState(customer).onboardingStatus;
  }

  private resolveEddRequiredForState(
    customer: {
      eddRequired?: boolean | null;
    },
    onboardingStatus: CustomerOnboardingStatus,
  ): boolean {
    switch (onboardingStatus) {
      case 'NONE':
      case 'PENDING_CDD_INPUT':
      case 'CDD_UNDER_REVIEW':
        return false;
      case 'PENDING_EDD_INPUT':
      case 'EDD_UNDER_REVIEW':
      case 'FINAL_APPROVAL':
        return true;
      case 'APPROVED':
      case 'REJECTED':
      case 'WITHDRAWN':
      default:
        return !!customer.eddRequired;
    }
  }

  private buildCustomerLifecyclePatch(
    customer: {
      onboardingStatus?: string | null;
      operatingStatus?: string | null;
      restrictionStatus?: string | null;
      eddRequired?: boolean | null;
      cddDocumentExpiresAt?: Date | string | null;
    },
    next: {
      onboardingStatus: CustomerOnboardingStatus;
      operatingStatus?: CustomerOperatingStatus;
      restrictionStatus?: CustomerRestrictionStatus;
      eddRequired?: boolean;
    },
  ): Prisma.CustomerMainUpdateInput {
    return buildCustomerLifecycleStatePatch(customer, next);
  }

  private async findLatestOnboardingCddResponse(
    customerId: string,
    journeyId?: string | null,
  ) {
    return this.prisma.cddResponse.findFirst({
      where: {
        customerId,
        workflow: ONBOARDING_WORKFLOW,
        ...(journeyId ? { journeyId } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  private async findLatestOnboardingEddResponse(
    customerId: string,
    journeyId?: string | null,
  ) {
    return this.prisma.eddResponse.findFirst({
      where: {
        customerId,
        workflow: ONBOARDING_WORKFLOW,
        ...(journeyId ? { journeyId } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  private async resolveActiveOnboardingResponseId(customer: {
    id: string;
    activeJourneyId?: string | null;
    onboardingStatus?: string | null;
  }): Promise<string | null> {
    const onboardingStatus = normalizeCustomerOnboardingStatus(customer.onboardingStatus);
    if (!onboardingStatus) {
      return null;
    }

    if (onboardingStatus === 'PENDING_EDD_INPUT' || onboardingStatus === 'EDD_UNDER_REVIEW') {
      const eddResponse = await this.findLatestOnboardingEddResponse(
        customer.id,
        customer.activeJourneyId,
      );
      return eddResponse?.id || null;
    }

    if (onboardingStatus === 'PENDING_CDD_INPUT' || onboardingStatus === 'CDD_UNDER_REVIEW') {
      const cddResponse = await this.findLatestOnboardingCddResponse(
        customer.id,
        customer.activeJourneyId,
      );
      return cddResponse?.id || null;
    }

    return null;
  }

  private buildLatestFinalApprovalBindingPatch(
    approvalId?: string | null,
  ): Prisma.CustomerMainUpdateInput {
    if (approvalId) {
      return {
        latestFinalApproval: {
          connect: { id: approvalId },
        },
      };
    }

    return {
      latestFinalApproval: {
        disconnect: true,
      },
    };
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

  private buildPendingCddSignals(input: {
    caseNo: string;
    cddResponseId: string;
    journeyId: string;
  }) {
    const seed = this.buildSeed(`CDD:PENDING:${input.caseNo}`);
    return {
      provider: 'MOCK',
      caseType: 'CDD' as const,
      referenceId: `MOCK-${seed.toString(16).toUpperCase()}`,
      reviewedAt: new Date().toISOString(),
      cddResponseId: input.cddResponseId,
      journeyId: input.journeyId,
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
    journeyId: string;
    riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
    reasonCode: string;
  }) {
    const seed = this.buildSeed(`CDD:MANUAL:${input.caseNo}:${input.riskLevel}:${input.reasonCode}`);
    const base = {
      provider: 'MOCK',
      caseType: 'CDD' as const,
      referenceId: `MOCK-${seed.toString(16).toUpperCase()}`,
      reviewedAt: new Date().toISOString(),
      cddResponseId: input.cddResponseId,
      journeyId: input.journeyId,
      simulationMode: 'MANUAL',
      simulationRiskLevel: input.riskLevel,
      simulationRiskReason: input.reasonCode,
    };

    if (input.riskLevel === 'LOW') {
      return {
        ...base,
        outcome: 'PASS',
        mockDataType: 'LOW_RISK' as const,
        riskScore: 18 + (seed % 12),
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
        riskScore: 55 + (seed % 10),
        riskLevel: 'MEDIUM',
        pepHit: false,
        sanctionsHit: false,
        adverseMediaHit: input.reasonCode === 'CDD_ADVERSE_MEDIA_REVIEW',
      };
    }

    return {
      ...base,
      outcome: 'FLAGGED',
      mockDataType:
        input.reasonCode === 'CDD_SANCTIONS_HIT'
          ? ('SANCTION_AND_OTHER' as const)
          : ('HIGH_RISK_OR_PEP' as const),
      riskScore: 85 + (seed % 10),
      riskLevel: 'HIGH',
      pepHit: input.reasonCode === 'CDD_PEP_MATCH',
      sanctionsHit: input.reasonCode === 'CDD_SANCTIONS_HIT',
      adverseMediaHit: true,
    };
  }

  private addDays(base: Date, days: number): Date {
    return new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
  }

  private mapActionsByStatus(status: {
    onboardingStatus?: string | null;
    operatingStatus?: string | null;
    restrictionStatus?: string | null;
  }): OnboardingAction[] {
    const actionTypes = getCustomerNextStepActionTypes(status);
    return actionTypes.map((type) => ({ type }));
  }

  private buildBlockedReason(status: {
    onboardingStatus?: string | null;
    operatingStatus?: string | null;
    restrictionStatus?: string | null;
  }): string | null {
    return getCustomerBlockedReason(status);
  }

  private async buildNextStep(customer: any): Promise<NextStepPayload> {
    const canonical = this.getCanonicalState(customer);
    const activeCaseId = await this.resolveActiveOnboardingResponseId(customer);
    return {
      actions: this.mapActionsByStatus(customer),
      blockedReason: this.buildBlockedReason(customer),
      activeCaseId,
      requiresEdd: this.resolveEddRequiredForState(customer, canonical.onboardingStatus),
    };
  }

  private async emitTransitionApprovalSideEffects(
    transition: { createdFinalApprovalId?: string | null } | null | undefined,
    actorId: string,
    actorRole: string,
    reason?: string | null,
  ) {
    const approvalId = String(transition?.createdFinalApprovalId || '').trim();
    if (!approvalId) {
      return;
    }

    await this.onboardingFinalApprovalService.emitSubmittedSideEffects(
      approvalId,
      actorId,
      actorRole,
      reason,
    );
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
    journeyId?: string | null;
  }) {
    const actorType = String(input.actorRole || '').trim().toUpperCase() === 'CUSTOMER'
      ? 'CUSTOMER'
      : 'ADMIN';
    const customer = await this.prisma.customerMain.findUnique({
      where: { id: input.customerId },
      select: {
        id: true,
        customerNo: true,
        activeJourneyId: true,
      },
    });

    const workflowContext = buildComplianceWorkflowTraceContext({
      workflow: ONBOARDING_WORKFLOW,
      journeyId: input.journeyId || customer?.activeJourneyId || null,
    });
    const triggerType = String(input.action || '').trim().toUpperCase().endsWith('_CREATED')
      ? AuditTriggerType.DATA_CREATE
      : AuditTriggerType.DATA_UPDATE;

    await this.auditLogsService.recordByActor(
      {
        triggerType,
        action: input.action,
        module: AuditModules.ONBOARDING,
        entityType: AuditEntityTypes.ONBOARDING,
        entityId: input.customerId,
        entityNo: customer?.customerNo || undefined,
        traceId: workflowContext?.traceId || undefined,
        workflowType: workflowContext?.workflowType || AuditWorkflowTypes.ONBOARDING,
        workflowId: workflowContext?.workflowId || undefined,
        workflowNo: workflowContext?.workflowNo || undefined,
        entityOwnerType: 'CUSTOMER',
        entityOwnerId: input.customerId,
        entityOwnerNo: customer?.customerNo || undefined,
        statusFrom: input.fromStage || undefined,
        statusTo: input.toStage || undefined,
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
      select: customerAutoExpireSelect,
    });

    if (!customer) {
      throw new NotFoundException(`Customer not found: ${customerId}`);
    }

    const expired =
      customer.cddDocumentExpiresAt &&
      customer.cddDocumentExpiresAt.getTime() <= Date.now();

    if (!isCustomerApprovedAndActive(customer) || !expired) {
      return;
    }

    await this.prisma.customerMain.update({
      where: { id: customerId },
      data: {
        ...this.buildCustomerLifecyclePatch(customer, {
          onboardingStatus: 'PENDING_CDD_INPUT',
          operatingStatus: 'INACTIVE',
        }),
        ...this.buildLatestFinalApprovalBindingPatch(null),
        latestFinalApprovalStatus: null,
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

  private getIncidentAssigneeUserId(incident: {
    assigneeUserId?: string | null;
    ownerUserId?: string | null;
  }): string | null {
    return resolveLegacyIncidentAssigneeUserId(incident);
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
      sourceType: ONBOARDING_SOURCE_TYPE,
      sourceId: `${customerId}:${journeyId}`,
      reason,
      stage,
    });
  }

  private async createEddResponseIfNeeded(
    customerId: string,
    journeyId: string,
    cddResponseId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<any> {
    const db = tx || this.prisma;
    const existing = await db.eddResponse.findFirst({
      where: {
        customerId,
        journeyId,
        workflow: ONBOARDING_WORKFLOW,
        status: 'CREATED',
      },
      orderBy: { createdAt: 'desc' },
    });

    if (existing) return existing;

    return db.eddResponse.create({
      data: {
        caseNo: generateReferenceNo('EDD'),
        customerId,
        cddResponseId,
        subjectKind: 'INDIVIDUAL_CUSTOMER',
        subjectRefId: customerId,
        journeyId,
        workflow: ONBOARDING_WORKFLOW,
        status: 'CREATED',
      },
    });
  }

  private async handleCddDecision(input: {
    customer: any;
    cddResponse: any;
    decision: RiskDecision;
    decisionRecordId: string;
    reasonCodes: string[];
    recommendedActions: RiskRecommendedAction[];
    mockDataType: OnboardingMockDataType;
  }) {
    const {
      customer,
      cddResponse,
      decisionRecordId,
      reasonCodes,
      recommendedActions,
    } = input;
    const isLowRiskAutoPass = input.mockDataType === 'LOW_RISK';
    const now = new Date();
    const journeyId = cddResponse.journeyId || customer.activeJourneyId || generateReferenceNo('ONB');

    const updateData: Prisma.CustomerMainUpdateInput = isLowRiskAutoPass
      ? {
          ...this.buildCustomerLifecyclePatch(customer, {
            onboardingStatus: 'APPROVED',
            operatingStatus: 'ACTIVE',
            eddRequired: false,
          }),
          latestDecisionRecordId: decisionRecordId,
          activeJourneyId: journeyId,
          ...this.buildLatestFinalApprovalBindingPatch(null),
          latestFinalApprovalStatus: null,
          cddDocumentExpiresAt: this.addDays(now, 365),
          nextReviewAt: this.addDays(now, 365),
        }
      : {
          ...this.buildCustomerLifecyclePatch(customer, {
            onboardingStatus: 'CDD_UNDER_REVIEW',
            operatingStatus: 'INACTIVE',
            eddRequired: false,
          }),
          latestDecisionRecordId: decisionRecordId,
          activeJourneyId: journeyId,
          ...this.buildLatestFinalApprovalBindingPatch(null),
          latestFinalApprovalStatus: null,
        };
    const linkedCaseIds = [cddResponse.id];

    const updated = await this.prisma.customerMain.update({
      where: { id: customer.id },
      data: updateData,
    });

    await this.riskDecisionOrchestratorService.orchestrate({
      workflow: ONBOARDING_WORKFLOW,
      stage: ONBOARDING_REVIEW_STAGES.REVIEW_CDD,
      customerId: customer.id,
      customerNo: customer.customerNo || null,
      sourceId: `${customer.id}:${journeyId}`,
      sourceNo: journeyId,
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
    eddResponse: any;
    decision: RiskDecision;
    decisionRecordId: string;
    reasonCodes: string[];
    recommendedActions: RiskRecommendedAction[];
  }) {
    const { customer, eddResponse, decisionRecordId, reasonCodes, recommendedActions } = input;
    const journeyId = eddResponse.journeyId || customer.activeJourneyId || generateReferenceNo('ONB');

    const updateData: Prisma.CustomerMainUpdateInput = {
      ...this.buildCustomerLifecyclePatch(customer, {
        onboardingStatus: 'EDD_UNDER_REVIEW',
        operatingStatus: 'INACTIVE',
        eddRequired: true,
      }),
      latestDecisionRecordId: decisionRecordId,
      activeJourneyId: journeyId,
      ...this.buildLatestFinalApprovalBindingPatch(null),
      latestFinalApprovalStatus: null,
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
      sourceId: `${customer.id}:${journeyId}`,
      sourceNo: journeyId,
      linkedCaseIds: [eddResponse.id],
      decisionRecordId,
      decision: input.decision,
      reasonCodes,
      recommendedActions,
      contextType: 'ONBOARDING_EDD',
    });

    return updated;
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
        customerId: true,
        subjectId: true,
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
      'ONBOARDING_CDD'
    ) {
      throw new BadRequestException(
        `Decision record ${input.decisionRecordId} is not bound to ONBOARDING_CDD`,
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
      throw new NotFoundException(`CDD response not found: ${cddResponseId}`);
    }
    const customer = await this.prisma.customerMain.findUnique({
      where: { id: cddResponse.customerId },
    });
    if (!customer) {
      throw new NotFoundException(`Customer not found: ${cddResponse.customerId}`);
    }

    const journeyId =
      cddResponse.journeyId || customer.activeJourneyId || generateReferenceNo('ONB');
    const signals = this.buildManualCddSignals({
      caseNo: cddResponse.caseNo,
      cddResponseId: cddResponse.id,
      journeyId,
      riskLevel: input.riskLevel,
      reasonCode: input.reasonCode,
    });

    const decision = await this.riskEngineService.completeDecisionRecord(
      input.decisionRecordId,
      {
        contextType: 'ONBOARDING_CDD',
        subjectType: cddResponse.subjectKind || 'UNKNOWN',
        subjectId: cddResponse.subjectRefId || cddResponse.customerId,
        ownerType: 'CUSTOMER',
        ownerId: cddResponse.customerId,
        signals,
        policyVersion: 'onboarding-risk-policy/v1',
      },
    );

    await this.prisma.cddResponse.update({
      where: { id: cddResponse.id },
      data: {
        status: 'FINAL',
        reviewedAt: new Date(),
        inputData: JSON.stringify(signals),
        reviewerDecision:
          input.riskLevel === 'LOW' ? 'APPROVE' : decision.decision,
        decisionReason:
          input.riskLevel === 'LOW'
            ? 'AUTO_LOW_RISK_PASS'
            : decision.reasonCodes.join(',') || decision.decision,
        requiresEdd: input.riskLevel === 'LOW' ? false : decision.decision === 'REQUIRE_EDD',
        riskScore: Number(signals.riskScore),
        riskLevel: String(signals.riskLevel),
        pepHit: !!signals.pepHit,
        sanctionsHit: !!signals.sanctionsHit,
      },
    });

    const updatedCustomer = await this.handleCddDecision({
      customer,
      cddResponse,
      decision: decision.decision,
      decisionRecordId: decision.decisionRecordId,
      reasonCodes: decision.reasonCodes,
      recommendedActions: decision.recommendedActions,
      mockDataType:
        input.riskLevel === 'LOW'
          ? 'LOW_RISK'
          : input.riskLevel === 'MEDIUM'
            ? 'MEDIUM_RISK'
            : input.reasonCode === 'CDD_SANCTIONS_HIT'
              ? 'SANCTION_AND_OTHER'
              : 'HIGH_RISK_OR_PEP',
    });

    if (input.riskLevel === 'HIGH') {
      const refreshedDecisionRecord = await (this.prisma as any).workflowDecisionRecord.findUnique({
        where: { id: input.decisionRecordId },
        select: {
          outputs: true,
        },
      });
      const outputs = this.parseJsonSafely(refreshedDecisionRecord?.outputs);
      const orchestration =
        outputs.orchestration &&
        typeof outputs.orchestration === 'object' &&
        !Array.isArray(outputs.orchestration)
          ? (outputs.orchestration as Record<string, unknown>)
          : {};
      const alertId = String(orchestration.alertId || '').trim();
      if (alertId) {
        await this.complianceIncidentsService.createFromAlert(
          alertId,
          {
            reason: `Auto-escalated onboarding CDD case for ${cddResponse.caseNo}`,
            decision: 'REVIEW',
            decisionRecordIds: [input.decisionRecordId],
            recommendedActions: ['UPSERT_ALERT', 'AUTO_ESCALATE_CASE'],
          },
          {
            actorType: 'SYSTEM',
            actorId: 'SYSTEM',
            actorNo: 'SYSTEM',
            actorRole: 'SYSTEM',
            sourcePlatform: 'SYSTEM',
          },
        );
      }
    }

    return {
      customer: updatedCustomer,
      decisionRecordId: decision.decisionRecordId,
      decision: decision.decision,
    };
  }

  async getMyOnboarding(customerId: string) {
    await this.autoExpireIfNeeded(customerId);
    const customer = await this.getCustomerOrThrow(customerId, true);
    const nextStep = await this.buildNextStep(customer);
    const canonical = this.getCanonicalState(customer);

    return {
      ...customer,
      onboardingStatus: canonical.onboardingStatus,
      operatingStatus: canonical.operatingStatus,
      restrictionStatus: canonical.restrictionStatus,
      actions: nextStep.actions,
      blockedReason: nextStep.blockedReason,
      activeCaseId: nextStep.activeCaseId,
      requiresEdd: nextStep.requiresEdd,
    };
  }

  async listMyResponses(customerId: string) {
    await this.getCustomerOrThrow(customerId);

    const [cddResponses, eddResponses] = await Promise.all([
      this.prisma.cddResponse.findMany({
        where: { customerId, workflow: ONBOARDING_WORKFLOW },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.eddResponse.findMany({
        where: { customerId, workflow: ONBOARDING_WORKFLOW },
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
        ...this.buildCustomerLifecyclePatch(customer, {
          onboardingStatus: this.getCanonicalState(customer).onboardingStatus,
          operatingStatus: this.getCanonicalState(customer).operatingStatus,
          restrictionStatus: this.getCanonicalState(customer).restrictionStatus,
          eddRequired: !!customer.eddRequired,
        }),
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
      fromStage: this.getCustomerOnboardingStatus(customer),
      toStage: this.getCustomerOnboardingStatus(updated),
      detail: 'Customer entity profile normalized to INDIVIDUAL only.',
    });

    return {
      ...updated,
      actions: this.mapActionsByStatus(updated),
    };
  }

  async startCddResponses(customerId: string, actorId: string, dto: BootstrapResponsesDto) {
    const customer = await this.getCustomerOrThrow(customerId);
    this.ensureIndividualOnly(customer);

    const currentStatus = this.getCustomerOnboardingStatus(customer);
    if (!canStartCdd(customer)) {
      throw new BadRequestException(
        `Current status ${currentStatus} does not allow starting new CDD response.`,
      );
    }

    const journeyId = dto?.journeyId || customer.activeJourneyId || generateReferenceNo('ONB');

    let cddResponse: any = await this.findLatestOnboardingCddResponse(customerId, journeyId);

    if (!cddResponse || cddResponse.status !== 'CREATED') {
      cddResponse = await this.prisma.cddResponse.create({
        data: {
          caseNo: generateReferenceNo('CDD'),
          customerId,
          customerType: 'INDIVIDUAL',
          subjectKind: 'INDIVIDUAL_CUSTOMER',
          subjectRefId: customerId,
          journeyId,
          workflow: ONBOARDING_WORKFLOW,
          status: 'CREATED',
        },
      });
    }

    const updated = await this.prisma.customerMain.update({
      where: { id: customerId },
      data: {
        ...this.buildCustomerLifecyclePatch(customer, {
          onboardingStatus: 'PENDING_CDD_INPUT',
          operatingStatus: 'INACTIVE',
          eddRequired: false,
        }),
        ...this.buildLatestFinalApprovalBindingPatch(null),
        latestFinalApprovalStatus: null,
        activeJourneyId: journeyId,
      },
    });

    const session = await this.createCaseSession(customerId, actorId, cddResponse.id, {
      responseType: 'CDD',
      provider: 'MOCK',
    });

    await this.writeAudit({
      customerId,
      action: 'CDD_BOOTSTRAP',
      actorId,
      actorRole: 'CUSTOMER',
      caseType: 'CDD',
      caseId: cddResponse.id,
      fromStage: currentStatus,
      toStage: 'PENDING_CDD',
      detail: 'CDD response initialized for onboarding journey.',
    });

    return {
      journeyId,
      currentCddResponseId: cddResponse.id,
      session,
      actions: this.mapActionsByStatus(updated),
    };
  }

  async reinitiateCddResponses(customerId: string, actorId: string) {
    const customer = await this.getCustomerOrThrow(customerId);
    const status = this.getCustomerOnboardingStatus(customer);

    if (!canReinitiateCdd(customer)) {
      throw new BadRequestException('CDD re-initiation is only allowed after rejection/withdraw/expiry.');
    }

    await this.prisma.customerMain.update({
      where: { id: customerId },
      data: {
        cddDocumentExpiresAt: null,
        ...this.buildLatestFinalApprovalBindingPatch(null),
        latestFinalApprovalStatus: null,
      },
    });

    return this.startCddResponses(customerId, actorId, {
      journeyId: generateReferenceNo('ONB'),
    });
  }

  async startEddResponses(customerId: string, actorId: string) {
    const customer = await this.getCustomerOrThrow(customerId);
    this.ensureIndividualOnly(customer);

    if (!canStartEdd(customer)) {
      throw new BadRequestException('EDD can only be started when customer is in PENDING_EDD status.');
    }

    const eddResponse = await this.findLatestOnboardingEddResponse(customerId, customer.activeJourneyId);
    if (!eddResponse) {
      throw new BadRequestException('No active EDD response is available for session start.');
    }

    const session = await this.createCaseSession(customerId, actorId, eddResponse.id, {
      responseType: 'EDD',
      provider: 'MOCK',
    });

    await this.writeAudit({
      customerId,
      action: 'EDD_START',
      actorId,
      actorRole: 'CUSTOMER',
      caseType: 'EDD',
      caseId: eddResponse.id,
      fromStage: 'PENDING_EDD',
      toStage: 'PENDING_EDD',
      detail: 'EDD session started by customer.',
    });

    return {
      currentEddResponseId: eddResponse.id,
      session,
      actions: this.mapActionsByStatus(customer),
    };
  }

  async reinitiateEddResponses(customerId: string, actorId: string, body: ReinitiateEddDto) {
    const customer = await this.getCustomerOrThrow(customerId);
    this.ensureIndividualOnly(customer);

    if (!customer.eddRequired) {
      throw new BadRequestException('EDD is not required for current onboarding journey.');
    }
    if (!canReinitiateEdd(customer)) {
      throw new BadRequestException(
        'EDD re-initiation is only allowed while customer is in an active EDD onboarding stage.',
      );
    }

    const journeyId = body?.journeyId || customer.activeJourneyId || generateReferenceNo('ONB');
    const latestCddResponse = await this.findLatestOnboardingCddResponse(customerId, journeyId);
    const eddResponse = await this.prisma.eddResponse.create({
      data: {
        caseNo: generateReferenceNo('EDD'),
        customerId,
        cddResponseId: latestCddResponse?.id || null,
        subjectKind: 'INDIVIDUAL_CUSTOMER',
        subjectRefId: customerId,
        journeyId,
        workflow: ONBOARDING_WORKFLOW,
        status: 'CREATED',
      },
    });

    const updated = await this.prisma.customerMain.update({
      where: { id: customerId },
      data: {
        ...this.buildCustomerLifecyclePatch(customer, {
          onboardingStatus: 'PENDING_EDD_INPUT',
          operatingStatus: 'INACTIVE',
          eddRequired: true,
        }),
        ...this.buildLatestFinalApprovalBindingPatch(null),
        latestFinalApprovalStatus: null,
        activeJourneyId: journeyId,
      },
    });

    const session = await this.createCaseSession(customerId, actorId, eddResponse.id, {
      responseType: 'EDD',
      provider: 'MOCK',
    });

    await this.writeAudit({
      customerId,
      action: 'EDD_REINITIATE',
      actorId,
      actorRole: 'CUSTOMER',
      caseType: 'EDD',
      caseId: eddResponse.id,
      fromStage: this.getCustomerOnboardingStatus(customer),
      toStage: 'PENDING_EDD',
      detail: 'EDD response re-initiated.',
    });

    return {
      journeyId,
      currentEddResponseId: eddResponse.id,
      session,
      actions: this.mapActionsByStatus(updated),
    };
  }

  private async getCaseByType(customerId: string, caseId: string, caseType: CaseType): Promise<any> {
    if (caseType === 'CDD') {
      const row = await this.prisma.cddResponse.findUnique({ where: { id: caseId } });
      if (!row || row.customerId !== customerId || row.workflow !== ONBOARDING_WORKFLOW) {
        throw new NotFoundException(`CDD response not found: ${caseId}`);
      }
      return row;
    }

    const row = await this.prisma.eddResponse.findUnique({ where: { id: caseId } });
    if (!row || row.customerId !== customerId || row.workflow !== ONBOARDING_WORKFLOW) {
      throw new NotFoundException(`EDD response not found: ${caseId}`);
    }
    return row;
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
      if (cddResponse?.customerId === customerId && cddResponse.workflow === ONBOARDING_WORKFLOW) {
        caseType = 'CDD';
      } else if (eddResponse?.customerId === customerId && eddResponse.workflow === ONBOARDING_WORKFLOW) {
        caseType = 'EDD';
      }
    }

    if (!caseType) {
      throw new NotFoundException(`Response not found: ${caseId}`);
    }

    const targetCase = await this.getCaseByType(customerId, caseId, caseType);
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
      action: `${caseType}_SESSION_CREATED`,
      actorId,
      actorRole: 'CUSTOMER',
      caseType,
      caseId,
      detail: `Session ${created.id} created for response ${caseId}.`,
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
    const mockDataType = session.caseType === 'CDD' ? null : resolvedMock.mockDataType;

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

      if (!cddResponse || cddResponse.customerId !== customerId) {
        throw new NotFoundException(`CDD response not found: ${session.caseId}`);
      }

      const customer = await this.getCustomerOrThrow(customerId);
      const journeyId =
        cddResponse.journeyId || customer.activeJourneyId || generateReferenceNo('ONB');
      const signals = this.buildPendingCddSignals({
        caseNo: cddResponse.caseNo,
        cddResponseId: cddResponse.id,
        journeyId,
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
            mockDataType: null,
            signals,
          }),
          normalizedPayload: JSON.stringify(signals),
        },
      });

      const pendingDecision =
        await this.riskEngineService.createPendingDecisionRecord({
        contextType: 'ONBOARDING_CDD',
        subjectType: cddResponse.subjectKind || 'UNKNOWN',
        subjectId: cddResponse.subjectRefId || customerId,
        ownerType: 'CUSTOMER',
        ownerId: customerId,
        signals,
        policyVersion: 'onboarding-risk-policy/v1',
      });
      const updatedCustomer = await this.prisma.customerMain.update({
        where: { id: customer.id },
        data: {
          ...this.buildCustomerLifecyclePatch(customer, {
            onboardingStatus: 'CDD_UNDER_REVIEW',
            operatingStatus: 'INACTIVE',
            eddRequired: false,
          }),
          latestDecisionRecordId: pendingDecision.decisionRecordId,
          activeJourneyId: journeyId,
          ...this.buildLatestFinalApprovalBindingPatch(null),
          latestFinalApprovalStatus: null,
        },
      });

      await this.writeAudit({
        customerId,
        action: 'CDD_SESSION_COMPLETED',
        actorId,
        actorRole: 'CUSTOMER',
        caseType: 'CDD',
        caseId: cddResponse.id,
        fromStage: this.getCustomerOnboardingStatus(customer),
        toStage: this.getCustomerOnboardingStatus(updatedCustomer),
        detail: `CDD response received and queued for manual risk simulation decisionRecordId=${pendingDecision.decisionRecordId}`,
      });

      return {
        ...this.buildSessionResponse({ ...session, status: 'COMPLETED' }),
        decision: {
          decisionRecordId: pendingDecision.decisionRecordId,
          status: 'CREATED',
          decision: null,
        },
        actions: this.mapActionsByStatus(updatedCustomer),
      };
    }

    const eddResponse = await this.prisma.eddResponse.findUnique({
      where: { id: session.caseId },
    });
    if (!eddResponse || eddResponse.customerId !== customerId) {
      throw new NotFoundException(`EDD response not found: ${session.caseId}`);
    }

    const customer = await this.getCustomerOrThrow(customerId);
    const signals = {
      ...this.buildEddMockSignals(eddResponse.caseNo, result),
      eddSubmitted: true,
    };

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

    const decision = await this.riskEngineService.evaluate({
      contextType: 'ONBOARDING_EDD',
      subjectType: eddResponse.subjectKind || 'UNKNOWN',
      subjectId: eddResponse.subjectRefId || customerId,
      ownerType: 'CUSTOMER',
      ownerId: customerId,
      signals,
      policyVersion: 'onboarding-risk-policy/v1',
    });

    await this.prisma.eddResponse.update({
      where: { id: eddResponse.id },
      data: {
        status: 'FINAL',
        mlroReviewedAt: now,
        mlroDecision: decision.decision,
        decisionReason: decision.reasonCodes.join(',') || decision.decision,
      },
    });

    const updatedCustomer = await this.handleEddDecision({
      customer,
      eddResponse,
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
      caseId: eddResponse.id,
      fromStage: this.getCustomerOnboardingStatus(customer),
      toStage: this.getCustomerOnboardingStatus(updatedCustomer),
      detail: `EDD decision=${decision.decision} reasonCodes=${decision.reasonCodes.join(',')}`,
    });

    return {
      ...this.buildSessionResponse({ ...session, status: 'COMPLETED' }),
      decision,
      actions: this.mapActionsByStatus(updatedCustomer),
    };
  }

  async listCddResponses(query: {
    status?: string;
    customerType?: string;
    workflow?: string;
    customerIds?: string[];
    skip?: number;
    take?: number;
  }) {
    const skip = this.normalizeSkip(query.skip);
    const take = this.normalizeTake(query.take);

    const where: Prisma.CddResponseWhereInput = {};
    if (query.status) where.status = query.status;
    const workflow = String(query.workflow || '')
      .trim()
      .toUpperCase();
    if (workflow && workflow !== 'ALL') {
      where.workflow = workflow;
    }
    if (Array.isArray(query.customerIds) && query.customerIds.length > 0) {
      where.customerId = { in: query.customerIds };
    }
    if (query.customerType) {
      where.customerType = query.customerType;
    }

    const [total, items] = await Promise.all([
      this.prisma.cddResponse.count({ where }),
      this.prisma.cddResponse.findMany({
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
              onboardingStatus: true,
              operatingStatus: true,
              restrictionStatus: true,
            },
          },
          reports: {
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
      }),
    ]);

    return {
      total,
      skip,
      take,
      items: items.map((item) => this.projectResponseRecord(item, 'CDD')),
    };
  }

  async getCddResponseDetail(id: string) {
    const row = await this.prisma.cddResponse.findUnique({
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
            onboardingStatus: true,
            operatingStatus: true,
            restrictionStatus: true,
            complianceHoldStatus: true,
          },
        },
        reports: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });

    if (!row) {
      throw new NotFoundException(`CDD response not found: ${id}`);
    }

    const latestReport = row.reports[0] || null;

    return this.projectResponseRecord({
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
    }, 'CDD');
  }

  async listEddResponses(query: {
    status?: string;
    workflow?: string;
    customerIds?: string[];
    skip?: number;
    take?: number;
  }) {
    const skip = this.normalizeSkip(query.skip);
    const take = this.normalizeTake(query.take);

    const where: Prisma.EddResponseWhereInput = {};
    if (query.status) where.status = query.status;
    const workflow = String(query.workflow || '')
      .trim()
      .toUpperCase();
    if (workflow && workflow !== 'ALL') {
      where.workflow = workflow;
    }
    if (Array.isArray(query.customerIds) && query.customerIds.length > 0) {
      where.customerId = { in: query.customerIds };
    }

    const [total, items] = await Promise.all([
      this.prisma.eddResponse.count({ where }),
      this.prisma.eddResponse.findMany({
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
              onboardingStatus: true,
              operatingStatus: true,
              restrictionStatus: true,
            },
          },
          reports: {
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
      }),
    ]);

    return {
      total,
      skip,
      take,
      items: items.map((item) => this.projectResponseRecord(item, 'EDD')),
    };
  }

  async getEddResponseDetail(id: string) {
    const row = await this.prisma.eddResponse.findUnique({
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
            onboardingStatus: true,
            operatingStatus: true,
            restrictionStatus: true,
            complianceHoldStatus: true,
          },
        },
        reports: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });

    if (!row) {
      throw new NotFoundException(`EDD response not found: ${id}`);
    }

    const latestReport = row.reports[0] || null;

    return this.projectResponseRecord({
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
    }, 'EDD');
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

  private getExpectedReviewStage(customer: {
    onboardingStatus?: string | null;
    operatingStatus?: string | null;
    restrictionStatus?: string | null;
  }): CustomerReviewStage | null {
    return getExpectedReviewStageFromCustomerState(customer);
  }

  private mapOnboardingAlertDisposition(decision: string) {
    const normalized = normalizeWorkflowDecision(decision);
    if (normalized === 'CLEAR') {
      return ALERT_DISPOSITION_CODES.RESOLVED_BY_WORKFLOW;
    }
    if (normalized === 'REJECT') {
      return ALERT_DISPOSITION_CODES.RESOLVED_BY_WORKFLOW;
    }
    if (normalized === 'REQUIRE_EDD') {
      return ALERT_DISPOSITION_CODES.RESOLVED_BY_WORKFLOW;
    }
    throw new BadRequestException(`Unsupported onboarding alert decision: ${decision}`);
  }

  private mapOnboardingAlertOutcome(outcome?: string | null) {
    const normalized = String(outcome || '').trim().toUpperCase();
    if (!normalized) return null;
    if (normalized === ALERT_DISPOSITION_CODES.FALSE_POSITIVE) {
      return ALERT_DISPOSITION_CODES.FALSE_POSITIVE;
    }
    throw new BadRequestException(`Unsupported onboarding alert outcome: ${outcome}`);
  }

  private mapOnboardingWorkflowDecision(decision: string) {
    const normalized = normalizeWorkflowDecision(decision);
    if (normalized === 'CLEAR' || normalized === 'REJECT' || normalized === 'REQUIRE_EDD') {
      return normalized;
    }
    throw new BadRequestException(`Unsupported onboarding workflow decision: ${decision}`);
  }

  private mapOnboardingWorkflowDisposition(decision: string) {
    const normalized = this.mapOnboardingWorkflowDecision(decision);
    switch (normalized) {
      case 'CLEAR':
        return 'CLEAR';
      case 'REJECT':
        return 'REJECT';
      case 'REQUIRE_EDD':
        return 'REQUIRE_EDD';
      default:
        throw new BadRequestException(`Unsupported onboarding workflow decision: ${decision}`);
    }
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
      alertOutcome?: 'FALSE_POSITIVE' | null;
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
    const workflowDecision = this.mapOnboardingWorkflowDecision(input.decision);
    const outcomeDispositionCode =
      this.mapOnboardingAlertOutcome(input.alertOutcome) ||
      this.mapOnboardingAlertDisposition(workflowDecision);
    const mergedMetadata = this.mergeDecisionMetadata(metadata, {
      decision: workflowDecision,
      reason: input.reason,
      linkedCaseIds: input.linkedCaseIds,
      decisionRecordIds: input.decisionRecordIds,
      source: input.source,
      sourceRefId: input.sourceRefId,
    });

    const dispositionRecord = await tx.complianceAlertDispositionRecord.create({
      data: {
        alertId: alert.id,
        dispositionCode: outcomeDispositionCode,
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
            : input.reason || `Onboarding decision ${workflowDecision}.`,
        decisionRecommendation: workflowDecision,
        decision: workflowDecision,
        linkedCaseIds: JSON.stringify(input.linkedCaseIds),
        decisionRecordIds: JSON.stringify(input.decisionRecordIds),
        metadata: JSON.stringify(mergedMetadata),
        currentDispositionCode: outcomeDispositionCode,
        currentDispositionReason: input.reason || null,
        currentDispositionAt: now,
        currentDispositionById: input.actorId,
        currentDispositionByNo: null,
        currentDispositionByRole: input.actorRole,
        currentDispositionRecordId: dispositionRecord.id,
        finalDispositionCode:
          input.closeAlert === false ? alert.finalDispositionCode : outcomeDispositionCode,
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
          input.reason || `Onboarding decision ${workflowDecision} from ${input.source}.`,
        payload: JSON.stringify({
          action: 'ONBOARDING_DECISION',
          source: input.source,
          sourceRefId: input.sourceRefId,
          decision: workflowDecision,
          alertOutcome: input.alertOutcome || null,
          dispositionCode: outcomeDispositionCode,
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
    const workflowDecision = this.mapOnboardingWorkflowDecision(dto.decision);
    const alertOutcome = dto.alertOutcome || null;
    if (alertOutcome === 'FALSE_POSITIVE' && workflowDecision !== 'CLEAR') {
      throw new BadRequestException('FALSE_POSITIVE can only be paired with CLEAR.');
    }
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

    const fromStatus = this.getCustomerOnboardingStatus(customer);
    const expectedStage = this.getExpectedReviewStage(customer);
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

    if (expectedStage === 'REVIEW_EDD' && workflowDecision === 'REQUIRE_EDD') {
      throw new BadRequestException(
        'REQUIRE_EDD is not valid while customer is in REVIEW_EDD.',
      );
    }

    const recordedAlert = await this.recordDecisionOnAlert(tx, alert, {
      actorId,
      actorRole,
      decision: workflowDecision,
      alertOutcome,
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
      dispositionCode: this.mapOnboardingWorkflowDisposition(workflowDecision),
      reason,
      actorId,
      actorRole,
      latestDecisionRecordId,
      linkedCaseIds: alertLinkedCaseIds,
    });

    const linkedCaseIds = this.dedupeStringList([
      ...alertLinkedCaseIds,
      transition.eddResponse?.id || null,
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
      eddResponse: transition.eddResponse || null,
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
    await this.emitTransitionApprovalSideEffects(
      txResult.transition,
      actorId,
      actorRole,
      dto.reason,
    );
    const nextStep = await this.buildNextStep(txResult.updatedCustomer);

    return {
      alert: alertDetail,
      customer: {
        ...txResult.updatedCustomer,
        actions: nextStep.actions,
        blockedReason: nextStep.blockedReason,
        activeCaseId: nextStep.activeCaseId,
        requiresEdd: nextStep.requiresEdd,
      },
      eddResponse: txResult.eddResponse
        ? this.projectResponseRecord(txResult.eddResponse, 'EDD')
        : null,
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
      if (incident.status !== 'ASSIGNED' && incident.status !== 'INVESTIGATING') {
        throw new BadRequestException(
          `Onboarding decision from case is only allowed when case is ASSIGNED or INVESTIGATING, current=${incident.status}`,
        );
      }
      if (this.getIncidentAssigneeUserId(incident) !== actorId) {
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
      if (dto.alertOutcome) {
        throw new BadRequestException(
          'Case onboarding proposal does not support alertOutcome. Use report proposal + MLRO review for FALSE_POSITIVE.',
        );
      }

      const incidentMetadata = this.parseJsonSafely(incident.metadata);
      const linkedCaseIds = this.parseJsonArraySafely<string>(incident.linkedCaseIds);
      const decisionRecordIds = this.parseJsonArraySafely<string>(
        alert.decisionRecordIds,
      );
      const mergedIncidentMetadata = this.mergeDecisionMetadata(incidentMetadata, {
        decision: dto.decision,
        reason: String(dto.reason || '').trim(),
        linkedCaseIds,
        decisionRecordIds,
        source: 'INCIDENT',
        sourceRefId: incident.id,
      });

      const now = new Date();
      await tx.complianceIncident.update({
        where: { id: incident.id },
        data: {
          status: 'INVESTIGATING',
          proposedWorkflowDecision: dto.decision,
          proposedWorkflowReason: String(dto.reason || '').trim() || null,
          metadata: JSON.stringify(mergedIncidentMetadata),
          decisionRecordIds: JSON.stringify(decisionRecordIds),
          linkedCaseIds: JSON.stringify(linkedCaseIds),
          submittedForMlroAt: null,
          submittedForMlroById: null,
          submittedForMlroByNo: null,
          submittedForMlroByRole: null,
          mlroReviewOutcome: null,
          mlroReviewNote: null,
          mlroReviewedAt: null,
          mlroReviewedById: null,
          mlroReviewedByNo: null,
          mlroReviewedByRole: null,
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
            `Onboarding workflow proposal ${dto.decision} from case.`,
          payload: JSON.stringify({
            action: 'ONBOARDING_WORKFLOW_PROPOSAL',
            proposedWorkflowDecision: dto.decision,
            alertId: alert.id,
          }),
          sourcePlatform: 'ADMIN_API',
        },
      });

      await this.syncDecisionLinksOnIncident(tx, incident, {
        decision: dto.decision,
        reason: String(dto.reason || '').trim(),
        linkedCaseIds,
        decisionRecordIds,
        sourceRefId: incident.id,
      });

      return {
        alertId: alert.id,
        incidentId: incident.id,
        proposedWorkflowDecision: dto.decision,
      };
    });

    const [alertDetail, caseDetail] = await Promise.all([
      this.riskDecisionOrchestratorService.findAlertDetail(txResult.alertId),
      this.complianceIncidentsService.findOne(txResult.incidentId),
    ]);

    return {
      alert: alertDetail,
      case: caseDetail,
      customer: null,
      eddResponse: null,
      transition: null,
      proposal: {
        workflowDecision: txResult.proposedWorkflowDecision,
        finalDispositionCode: caseDetail?.proposedFinalDispositionCode ?? null,
      },
    };
  }

  async submitCustomerFinalApproval(
    customerId: string,
    actorId: string,
    actorRole: string,
    dto?: SubmitFinalApprovalDto,
  ) {
    return this.onboardingFinalApprovalService.submitFinalApproval(
      customerId,
      actorId,
      actorRole,
      dto,
    );
  }

  async simulateCustomerExpired(customerId: string, actorId: string, actorRole: string) {
    const customer = await this.getCustomerOrThrow(customerId);
    const expiredAt = new Date(Date.now() - 60 * 60 * 1000);
    const currentStatus = this.getCustomerOnboardingStatus(customer);

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
      toStage: this.getCustomerOnboardingStatus(updated),
      detail: 'CDD document expiry simulated.',
    });

    return {
      ...updated,
      actions: this.mapActionsByStatus(updated),
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
      select: tradingEligibilitySelect,
    });

    if (!customer) {
      throw new NotFoundException(`Customer not found: ${customerId}`);
    }

    const canonical = this.getCanonicalState(customer);

    if (
      canonical.onboardingStatus !== 'APPROVED' ||
      canonical.operatingStatus !== 'ACTIVE' ||
      canonical.restrictionStatus === 'RESTRICTED'
    ) {
      throw new ForbiddenException({
        message: `${action} is blocked by onboarding gate`,
        customerId,
        customerNo: customer.customerNo,
        onboardingStatus: canonical.onboardingStatus,
        operatingStatus: canonical.operatingStatus,
        restrictionStatus: canonical.restrictionStatus,
        complianceHoldStatus: customer.complianceHoldStatus,
        complianceHoldCaseId: customer.complianceHoldCaseId,
      });
    }

    if (String(customer.complianceHoldStatus || 'ACTIVE').toUpperCase() === 'FROZEN') {
      throw new ForbiddenException({
        message: `${action} is blocked by compliance hold`,
        customerId,
        customerNo: customer.customerNo,
        onboardingStatus: canonical.onboardingStatus,
        operatingStatus: canonical.operatingStatus,
        restrictionStatus: canonical.restrictionStatus,
        complianceHoldStatus: customer.complianceHoldStatus,
        complianceHoldCaseId: customer.complianceHoldCaseId,
      });
    }
  }

  async recomputeComplianceSnapshot(customerId: string, _journeyId?: string) {
    const customer = await this.getCustomerOrThrow(customerId);
    const canonical = this.getCanonicalState(customer);
    const eddRequired = this.resolveEddRequiredForState(customer, canonical.onboardingStatus);
    const patch: Prisma.CustomerMainUpdateInput = this.buildCustomerLifecyclePatch(customer, {
      onboardingStatus: canonical.onboardingStatus,
      operatingStatus: canonical.operatingStatus,
      restrictionStatus: canonical.restrictionStatus,
      eddRequired,
    });

    const updated = await this.prisma.customerMain.update({
      where: { id: customerId },
      data: patch,
    });

    return updated;
  }
}
