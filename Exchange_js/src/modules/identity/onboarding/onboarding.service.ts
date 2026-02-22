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
import { ComplianceAlertsService } from '../../risk-engine/compliance-alerts/compliance-alerts.service';
import { RiskDecision, RiskEngineService } from '../../risk-engine/risk-engine.service';
import {
  BootstrapCasesDto,
  CreateCaseSessionDto,
  FinalReviewCustomerDto,
  MockCompleteSessionDto,
  ReinitiateEddDto,
  ReviewCddCaseDto,
  ReviewEddCaseDto,
  UpdateInvestorClassificationDto,
  UpsertEntityDto,
} from './dto/onboarding.dto';

type TradeAction = 'SWAP' | 'WITHDRAW';
type CaseType = 'CDD' | 'EDD';
type SubjectKind = 'INDIVIDUAL_CUSTOMER' | 'CORPORATE_ENTITY' | 'UBO_PERSON';

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

interface AlertUpsertInput {
  customerId: string;
  customerNo: string | null;
  journeyId: string;
  recommendation: string;
  decision?: string | null;
  severity?: ComplianceAlertSeverity;
  message: string;
  linkedCaseIds?: string[];
  decisionRecordIds?: string[];
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
    private readonly complianceAlertsService: ComplianceAlertsService,
  ) {}

  private parseJsonSafely(value?: string | null): Record<string, unknown> {
    if (!value) return {};
    try {
      return JSON.parse(value);
    } catch {
      return {};
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

  private buildMockSignals(caseType: CaseType, caseNo: string, result: 'PASS' | 'FAIL') {
    const seed = this.buildSeed(`${caseType}:${caseNo}:${result}`);
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
      caseType,
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

  private async upsertJourneyAlert(input: AlertUpsertInput): Promise<void> {
    try {
      await this.complianceAlertsService.triggerSystemAlert({
        ruleCode: 'ONB_ONBOARDING_JOURNEY_REVIEW',
        sourceModule: 'identity/onboarding',
        sourceType: 'ONBOARDING_JOURNEY',
        sourceId: `${input.customerId}:${input.journeyId}`,
        stage: 'ONBOARDING',
        journeyId: input.journeyId,
        customerId: input.customerId,
        customerNo: input.customerNo,
        ownerType: 'CUSTOMER',
        ownerId: input.customerId,
        severity: input.severity || ComplianceAlertSeverity.HIGH,
        decisionRecommendation: input.recommendation,
        decision: input.decision || null,
        linkedCaseIds: input.linkedCaseIds || [],
        decisionRecordIds: input.decisionRecordIds || [],
        message: input.message,
        metadata: {
          recommendation: input.recommendation,
          decision: input.decision || null,
          linkedCaseIds: input.linkedCaseIds || [],
          decisionRecordIds: input.decisionRecordIds || [],
        },
      });
    } catch (error) {
      this.logger.warn(
        `Failed to upsert onboarding journey alert for customer=${input.customerId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private async closeJourneyAlertIfAny(
    customerId: string,
    journeyId: string,
    reason: string,
  ): Promise<void> {
    const alert = await this.prisma.complianceAlert.findFirst({
      where: {
        sourceType: 'ONBOARDING_JOURNEY',
        sourceId: `${customerId}:${journeyId}`,
        status: {
          in: ['OPEN', 'ASSIGNED', 'ESCALATED'],
        },
      },
      orderBy: [{ lastOccurredAt: 'desc' }, { createdAt: 'desc' }],
      select: { id: true },
    });

    if (!alert) return;

    try {
      await this.complianceAlertsService.applyAction(
        alert.id,
        {
          action: ComplianceAlertAction.CLOSE,
          reason,
          note: reason,
          decision: 'APPROVE',
        },
        {
          actorType: 'SYSTEM',
          actorId: 'SYSTEM',
          actorNo: 'SYSTEM',
          actorRole: 'SYSTEM',
          sourcePlatform: 'SYSTEM',
        },
      );
    } catch (error) {
      this.logger.warn(
        `Failed to close onboarding journey alert id=${alert.id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private async createEddCaseIfNeeded(
    customerId: string,
    journeyId: string,
    cddCaseId: string,
  ): Promise<any> {
    const existing = await this.prisma.eddCase.findFirst({
      where: {
        customerId,
        journeyId,
        status: 'CREATED',
      },
      orderBy: { createdAt: 'desc' },
    });

    if (existing) return existing;

    return this.prisma.eddCase.create({
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
  }) {
    const { customer, cddCase, decision, decisionRecordId, reasonCodes } = input;
    const now = new Date();
    const journeyId = cddCase.journeyId || customer.activeJourneyId || generateReferenceNo('ONB');
    const reasonText = reasonCodes.join(',') || decision;

    let updateData: Prisma.CustomerMainUpdateInput = {
      latestDecisionRecordId: decisionRecordId,
      activeJourneyId: journeyId,
    };

    let linkedCaseIds = [cddCase.id];

    if (decision === 'APPROVE') {
      updateData = {
        ...updateData,
        publicStatus: 'ACTIVE',
        cddStatus: 'APPROVED',
        eddRequired: false,
        eddStatus: 'NOT_REQUIRED',
        complianceStatus: 'ACTIVE',
        finalApprovalStatus: 'APPROVED',
        finalApprovalReason: 'SYSTEM_AUTO_APPROVE_AFTER_CDD',
        finalApprovalReviewerId: 'SYSTEM',
        finalApprovalReviewedAt: now,
        cddDocumentExpiresAt: this.addDays(now, 365),
        nextReviewAt: this.addDays(now, 365),
        activeCaseType: null,
        activeCaseId: null,
      };
    } else if (decision === 'REQUIRE_EDD') {
      const eddCase = await this.createEddCaseIfNeeded(customer.id, journeyId, cddCase.id);
      linkedCaseIds = [cddCase.id, eddCase.id];
      updateData = {
        ...updateData,
        publicStatus: 'PENDING_EDD',
        cddStatus: 'APPROVED',
        eddRequired: true,
        eddStatus: 'REQUIRED',
        complianceStatus: 'IN_PROGRESS',
        finalApprovalStatus: 'NOT_REQUIRED',
        finalApprovalReason: null,
        finalApprovalReviewerId: null,
        finalApprovalReviewedAt: null,
        cddDocumentExpiresAt: this.addDays(now, 365),
        activeCaseType: 'EDD',
        activeCaseId: eddCase.id,
        currentEddCaseId: eddCase.id,
      };

      await this.upsertJourneyAlert({
        customerId: customer.id,
        customerNo: customer.customerNo || null,
        journeyId,
        recommendation: 'REQUIRE_EDD',
        message: 'CDD completed and risk engine requires EDD.',
        severity: ComplianceAlertSeverity.HIGH,
        linkedCaseIds,
        decisionRecordIds: [decisionRecordId],
      });
    } else if (decision === 'REJECT') {
      updateData = {
        ...updateData,
        publicStatus: 'REJECTED',
        cddStatus: 'REJECTED',
        eddRequired: false,
        eddStatus: 'NOT_REQUIRED',
        complianceStatus: 'BLOCKED',
        finalApprovalStatus: 'REJECTED',
        finalApprovalReason: reasonText,
        finalApprovalReviewerId: 'SYSTEM',
        finalApprovalReviewedAt: now,
        activeCaseType: null,
        activeCaseId: null,
      };

      await this.upsertJourneyAlert({
        customerId: customer.id,
        customerNo: customer.customerNo || null,
        journeyId,
        recommendation: 'REJECT',
        decision: 'REJECT',
        message: 'CDD decision is REJECT by risk engine.',
        severity: ComplianceAlertSeverity.CRITICAL,
        linkedCaseIds,
        decisionRecordIds: [decisionRecordId],
      });
    } else {
      updateData = {
        ...updateData,
        publicStatus: 'REVIEW_CDD',
        cddStatus: 'PENDING_REVIEW',
        eddRequired: false,
        eddStatus: 'NOT_REQUIRED',
        complianceStatus: 'IN_PROGRESS',
        finalApprovalStatus: 'NOT_REQUIRED',
        finalApprovalReason: null,
        finalApprovalReviewerId: null,
        finalApprovalReviewedAt: null,
      };

      await this.upsertJourneyAlert({
        customerId: customer.id,
        customerNo: customer.customerNo || null,
        journeyId,
        recommendation: 'REVIEW',
        message: 'CDD decision requires manual review.',
        severity: ComplianceAlertSeverity.HIGH,
        linkedCaseIds,
        decisionRecordIds: [decisionRecordId],
      });
    }

    const updated = await this.prisma.customerMain.update({
      where: { id: customer.id },
      data: updateData,
    });

    if (decision === 'APPROVE') {
      await this.closeJourneyAlertIfAny(customer.id, journeyId, 'Onboarding auto-approved after CDD.');
    }

    return updated;
  }

  private async handleEddDecision(input: {
    customer: any;
    eddCase: any;
    decision: RiskDecision;
    decisionRecordId: string;
    reasonCodes: string[];
  }) {
    const { customer, eddCase, decision, decisionRecordId, reasonCodes } = input;
    const now = new Date();
    const journeyId = eddCase.journeyId || customer.activeJourneyId || generateReferenceNo('ONB');
    const reasonText = reasonCodes.join(',') || decision;

    let updateData: Prisma.CustomerMainUpdateInput = {
      latestDecisionRecordId: decisionRecordId,
      activeJourneyId: journeyId,
      activeCaseType: null,
      activeCaseId: null,
      eddRequired: true,
      cddStatus: 'APPROVED',
    };

    if (decision === 'REJECT') {
      updateData = {
        ...updateData,
        publicStatus: 'REJECTED',
        eddStatus: 'REJECTED',
        complianceStatus: 'BLOCKED',
        finalApprovalStatus: 'REJECTED',
        finalApprovalReason: reasonText,
        finalApprovalReviewerId: 'SYSTEM',
        finalApprovalReviewedAt: now,
      };

      await this.upsertJourneyAlert({
        customerId: customer.id,
        customerNo: customer.customerNo || null,
        journeyId,
        recommendation: 'REJECT',
        decision: 'REJECT',
        message: 'EDD decision is REJECT by risk engine.',
        severity: ComplianceAlertSeverity.CRITICAL,
        linkedCaseIds: [eddCase.id],
        decisionRecordIds: [decisionRecordId],
      });
    } else {
      updateData = {
        ...updateData,
        publicStatus: 'FINAL_APPROVAL',
        eddStatus: 'APPROVED',
        complianceStatus: 'IN_PROGRESS',
        finalApprovalStatus: 'PENDING',
        finalApprovalReason: null,
        finalApprovalReviewerId: null,
        finalApprovalReviewedAt: null,
      };

      await this.upsertJourneyAlert({
        customerId: customer.id,
        customerNo: customer.customerNo || null,
        journeyId,
        recommendation: decision === 'REVIEW' ? 'REVIEW' : 'APPROVE',
        message:
          decision === 'REVIEW'
            ? 'EDD requires manual final onboarding decision.'
            : 'EDD completed. Manual final onboarding decision is required.',
        severity: ComplianceAlertSeverity.HIGH,
        linkedCaseIds: [eddCase.id],
        decisionRecordIds: [decisionRecordId],
      });
    }

    return this.prisma.customerMain.update({
      where: { id: customer.id },
      data: updateData,
    });
  }

  async getMyOnboarding(customerId: string) {
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

    const result: 'PASS' | 'FAIL' = body?.result === 'FAIL' ? 'FAIL' : 'PASS';

    await this.prisma.complianceSession.update({
      where: { id: session.id },
      data: {
        status: 'COMPLETED',
        completedAt: now,
        rawPayload: JSON.stringify({
          callback: 'MOCK',
          result,
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
      const signals = this.buildMockSignals('CDD', cddCase.caseNo, result);

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
          rawPayload: JSON.stringify({ sessionId, result, signals }),
          normalizedPayload: JSON.stringify(signals),
        },
      });

      const decision = await this.riskEngineService.evaluate({
        contextType: 'ONBOARDING_CDD',
        customerId,
        subjectId: cddCase.subjectRefId || customerId,
        signals,
        policyVersion: 'onboarding-risk-policy/v1',
      });

      await this.prisma.cddCase.update({
        where: { id: cddCase.id },
        data: {
          status: 'FINAL',
          reviewedAt: now,
          reviewerDecision: decision.decision,
          decisionReason: decision.reasonCodes.join(',') || decision.decision,
          requiresEdd: decision.decision === 'REQUIRE_EDD',
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
        detail: `CDD decision=${decision.decision} reasonCodes=${decision.reasonCodes.join(',')}`,
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
      ...this.buildMockSignals('EDD', eddCase.caseNo, result),
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
      customerId,
      subjectId: eddCase.subjectRefId || customerId,
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
      'CDD case page is evidence-only. Please handle decisions via alert/incident workflow.',
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
      'EDD case page is evidence-only. Please handle decisions via alert/incident workflow.',
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
      );
    } else {
      await this.upsertJourneyAlert({
        customerId,
        customerNo: customer.customerNo || null,
        journeyId,
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

    const updateData: Prisma.CustomerMainUpdateInput = {
      cddDocumentExpiresAt: expiredAt,
    };

    if (currentStatus === 'ACTIVE') {
      updateData.publicStatus = 'PENDING_CDD';
      updateData.cddStatus = 'EXPIRED';
      updateData.complianceStatus = 'EXPIRED';
      updateData.finalApprovalStatus = 'NOT_REQUIRED';
      updateData.finalApprovalReason = 'CDD expired';
      updateData.finalApprovalReviewerId = null;
      updateData.finalApprovalReviewedAt = null;
    }

    const updated = await this.prisma.customerMain.update({
      where: { id: customerId },
      data: updateData,
    });

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
    const customer = await this.prisma.customerMain.findUnique({
      where: { id: customerId },
      select: {
        id: true,
        customerNo: true,
        publicStatus: true,
        complianceStatus: true,
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
