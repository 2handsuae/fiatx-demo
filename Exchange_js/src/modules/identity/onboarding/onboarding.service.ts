import { randomUUID } from 'node:crypto';
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
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import {
  AuditEntityTypes,
  AuditModules,
  AuditWorkflowTypes,
} from '../../audit-logging/constants/audit-actions.constant';
import {
  buildCustomerLifecyclePatch as buildCustomerLifecycleStatePatch,
  canReinitiateCdd,
  canReinitiateEdd,
  canStartCdd,
  canStartEdd,
  CustomerNextStepActionType,
  CustomerOnboardingStatus,
  CustomerAdminStatus,
  CustomerReviewStage,
  getCustomerBlockedReason,
  getCustomerNextStepActionTypes,
  getExpectedReviewStageFromCustomerState,
  isCustomerApprovedAndActive,
  resolveCustomerCanonicalState,
} from '../customer-status.util';
import {
  buildComplianceWorkflowTraceContext,
  ONBOARDING_REVIEW_STAGES,
  ONBOARDING_WORKFLOW,
} from '../../risk-engine/constants/onboarding-compliance-workflow.constant';
import {
  RiskDecision,
  RiskEngineService,
  RiskRecommendedAction,
} from '../../risk-engine/risk-engine.service';
import { SumsubClient } from './providers/sumsub/sumsub.client';
import {
  BootstrapResponsesDto,
  CreateResponseSessionDto,
  MockCompleteSessionDto,
  OnboardingMockDataType,
  ReinitiateEddDto,
  StartVerificationCustomerSnapshotDto,
  StartVerificationSnapshotDto,
  UpdateInvestorTierDto,
  UpsertEntityDto,
} from './dto/onboarding.dto';
import { WorkflowTransitionService } from './workflow-transition.service';
import { OnboardingFinalApprovalService } from './onboarding-final-approval.service';
import {
  projectResponseRecord,
} from '../review-response-compat.util';

type TradeAction = 'SWAP' | 'WITHDRAW' | 'DEPOSIT';
type CaseType = 'CDD' | 'EDD';
type SubjectKind = 'INDIVIDUAL_CUSTOMER' | 'CORPORATE_ENTITY' | 'UBO_PERSON';
type MockResult = 'PASS' | 'FAIL';
type LegacyCompatibleOnboardingStatus =
  | CustomerOnboardingStatus
  | 'PENDING_CDD_INPUT'
  | 'CDD_UNDER_REVIEW'
  | 'PENDING_EDD_INPUT'
  | 'EDD_UNDER_REVIEW';
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
  verification: VerificationProjection;
}

export interface VerificationProjection {
  provider: string | null;
  applicantId: string | null;
  currentLevelName: string | null;
  latestReviewId: string | null;
  latestAttemptId: string | null;
  substatus: string | null;
  customerActionRequired: boolean;
  canContinue: boolean;
  latestEventType: string | null;
  latestEventAt: Date | string | null;
  experiencedLevel2: boolean;
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
  adminStatus: true,
  complianceStatus: true,
  cddDocumentExpiresAt: true,
} satisfies Prisma.CustomerMainSelect;

const tradingEligibilitySelect = {
  id: true,
  customerNo: true,
  onboardingStatus: true,
  adminStatus: true,
  complianceStatus: true,
  complianceFreezeCaseId: true,
} satisfies Prisma.CustomerMainSelect;

const SUMSUB_EVENT_ACTION_MAP: Record<string, string> = {
  applicantPending: 'SUMSUB_APPLICANT_PENDING',
  applicantOnHold: 'SUMSUB_APPLICANT_ON_HOLD',
  applicantReviewed: 'SUMSUB_APPLICANT_REVIEWED',
  applicantLevelChanged: 'SUMSUB_APPLICANT_LEVEL_CHANGED',
  applicantWorkflowCompleted: 'SUMSUB_APPLICANT_WORKFLOW_COMPLETED',
  applicantWorkflowFailed: 'SUMSUB_APPLICANT_WORKFLOW_FAILED',
};

const SUMSUB_DEFAULT_ACTION = 'SUMSUB_APPLICANT_EVENT';

@Injectable()
export class OnboardingService {
  private readonly logger = new Logger(OnboardingService.name);
  private readonly recognizedRawOnboardingStatuses = new Set([
    'NONE',
    'PENDING_VERIFICATION',
    'FINAL_APPROVAL',
    'APPROVED',
    'REJECTED',
    'WITHDRAWN',
    'PENDING_CDD_INPUT',
    'CDD_UNDER_REVIEW',
    'PENDING_EDD_INPUT',
    'EDD_UNDER_REVIEW',
  ]);
  private readonly legacyRawVerificationStatuses = new Set([
    'PENDING_CDD_INPUT',
    'CDD_UNDER_REVIEW',
    'PENDING_EDD_INPUT',
    'EDD_UNDER_REVIEW',
  ]);

  constructor(
    private readonly prisma: PrismaService,
    private readonly riskEngineService: RiskEngineService,
    private readonly workflowTransitionService: WorkflowTransitionService,
    private readonly onboardingFinalApprovalService: OnboardingFinalApprovalService,
    private readonly sumsubClient: SumsubClient,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  async handleSumsubVerificationEvent(
    payload: Record<string, unknown> = {},
    context: Record<string, unknown> = {},
  ): Promise<{
    customer: {
      onboardingStatus: string | null;
      adminStatus: string | null;
      complianceStatus: string | null;
    };
    verification: VerificationProjection;
  }> {
    const eventType = this.normalizeOptionalString(payload.type) || 'unknown';
    const actorId =
      this.normalizeOptionalString(context.actorId) ||
      (context.simulated === true ? null : 'SUMSUB');
    const actorRole = context.simulated === true ? 'CUSTOMER' : 'SYSTEM';

    if (!actorId) {
      throw new BadRequestException('actorId is required for Sumsub verification events');
    }

    type TxAuditCapture = {
      updatedCustomer: any;
      beforeOnboardingStatus: string | null;
      beforeSubstatus: string | null;
      resolvedLevelName: string | null;
      resolvedReviewAnswer: string | null;
      resolvedReviewRejectType: string | null;
      resolvedReviewId: string | null;
      resolvedAttemptId: string | null;
    };
    // Use a container array so TypeScript doesn't narrow out the closure-assigned value.
    const txAuditCapture: TxAuditCapture[] = [];

    const result = await this.prisma.$transaction(async (tx) => {
      const customer = await this.findCustomerForSumsubVerificationEvent(tx, payload, context);
      if (!customer) {
        throw new NotFoundException(
          `Customer not found for Sumsub verification event ${eventType}.`,
        );
      }

      const currentCanonical = this.getCanonicalState(customer);
      if (
        currentCanonical.onboardingStatus === 'APPROVED' ||
        currentCanonical.onboardingStatus === 'FINAL_APPROVAL' ||
        currentCanonical.onboardingStatus === 'REJECTED' ||
        currentCanonical.onboardingStatus === 'WITHDRAWN'
      ) {
        this.logger.warn(
          `Ignoring Sumsub verification event ${eventType} for terminal onboarding state ${currentCanonical.onboardingStatus}.`,
        );
        return {
          customer: {
            onboardingStatus: customer.onboardingStatus ?? null,
            adminStatus: customer.adminStatus ?? null,
            complianceStatus: customer.complianceStatus ?? null,
          },
          verification: this.buildVerificationProjection(customer),
        };
      }

      const now = new Date();
      const nextLevelName =
        this.resolveSumsubLevelName(payload, context) || customer.sumsubCurrentLevelName || null;
      const reviewResult = this.resolveSumsubReviewResult(payload, context);
      const reviewId = this.resolveSumsubReviewId(payload, context);
      const attemptId = this.resolveSumsubAttemptId(payload, context);
      const experiencedLevel2 =
        customer.sumsubExperiencedLevel2 === true || this.isSumsubLevel2Level(nextLevelName);

      let updateData: Prisma.CustomerMainUpdateInput = {
        verificationProvider: 'SUMSUB',
        verificationLatestEventType: eventType,
        verificationLatestEventAt: now,
      };

      if (nextLevelName) {
        updateData.sumsubCurrentLevelName = nextLevelName;
      }
      if (reviewId) {
        updateData.sumsubLatestReviewId = reviewId;
      }
      if (attemptId) {
        updateData.sumsubLatestAttemptId = attemptId;
      }

      switch (eventType) {
        case 'applicantPending':
          updateData = {
            ...updateData,
            ...this.buildCustomerLifecyclePatch(customer, {
              onboardingStatus: 'PENDING_VERIFICATION',
              adminStatus: 'INACTIVE',
            }),
            verificationSubstatus: 'SUBMITTED',
            verificationCustomerActionRequired: false,
            verificationCanContinue: false,
          };
          break;
        case 'applicantOnHold':
          updateData = {
            ...updateData,
            ...this.buildCustomerLifecyclePatch(customer, {
              onboardingStatus: 'PENDING_VERIFICATION',
              adminStatus: 'INACTIVE',
            }),
            verificationSubstatus: 'UNDER_REVIEW',
            verificationCustomerActionRequired: false,
            verificationCanContinue: false,
          };
          break;
        case 'applicantLevelChanged':
          updateData = {
            ...updateData,
            ...this.buildCustomerLifecyclePatch(customer, {
              onboardingStatus: 'PENDING_VERIFICATION',
              adminStatus: 'INACTIVE',
            }),
            verificationSubstatus: 'NEXT_LEVEL_REQUIRED',
            verificationCustomerActionRequired: false,
            verificationCanContinue: true,
            sumsubExperiencedLevel2: experiencedLevel2,
          };
          break;
        case 'applicantReviewed':
          if (reviewResult.reviewAnswer === 'RED' && reviewResult.reviewRejectType === 'RETRY') {
            updateData = {
              ...updateData,
              ...this.buildCustomerLifecyclePatch(customer, {
                onboardingStatus: 'PENDING_VERIFICATION',
                adminStatus: 'INACTIVE',
              }),
              verificationSubstatus: 'RESUBMIT_REQUIRED',
              verificationCustomerActionRequired: true,
              verificationCanContinue: true,
              sumsubExperiencedLevel2: experiencedLevel2,
            };
          } else {
            updateData = {
              ...updateData,
              ...this.buildCustomerLifecyclePatch(customer, {
                onboardingStatus: 'PENDING_VERIFICATION',
                adminStatus: 'INACTIVE',
              }),
              verificationSubstatus: 'UNDER_REVIEW',
              verificationCustomerActionRequired: false,
              verificationCanContinue: false,
              sumsubExperiencedLevel2: experiencedLevel2,
            };
          }
          break;
        case 'applicantWorkflowCompleted':
          if (experiencedLevel2) {
            const pendingApproval =
              await this.onboardingFinalApprovalService.ensurePendingApprovalInTransaction(tx, {
                customer: {
                  ...customer,
                  onboardingStatus: 'FINAL_APPROVAL',
                  adminStatus: 'INACTIVE',
                },
                actorId,
                actorRole,
                reason: `Sumsub workflow completed via ${eventType}`,
              });
            updateData = {
              ...updateData,
              ...this.buildCustomerLifecyclePatch(customer, {
                onboardingStatus: 'FINAL_APPROVAL',
                adminStatus: 'INACTIVE',
              }),
              ...this.buildLatestRiskApprovalBindingPatch(pendingApproval.approval.id),
              latestRiskApprovalStatus: pendingApproval.approval.status || 'PENDING',
              verificationSubstatus: 'COMPLETED',
              verificationCustomerActionRequired: false,
              verificationCanContinue: false,
              sumsubExperiencedLevel2: true,
            };
          } else {
            updateData = {
              ...updateData,
              ...this.buildCustomerLifecyclePatch(customer, {
                onboardingStatus: 'APPROVED',
                adminStatus: 'ACTIVE',
              }),
              ...this.buildLatestRiskApprovalBindingPatch(null),
              latestRiskApprovalStatus: null,
              verificationSubstatus: 'COMPLETED',
              verificationCustomerActionRequired: false,
              verificationCanContinue: false,
              sumsubExperiencedLevel2: false,
            };
          }
          break;
        case 'applicantWorkflowFailed':
          updateData = {
            ...updateData,
            ...this.buildCustomerLifecyclePatch(customer, {
              onboardingStatus: 'REJECTED',
              adminStatus: 'INACTIVE',
            }),
            ...this.buildLatestRiskApprovalBindingPatch(null),
            latestRiskApprovalStatus: null,
            verificationSubstatus: 'FAILED',
            verificationCustomerActionRequired: false,
            verificationCanContinue: false,
            sumsubExperiencedLevel2: experiencedLevel2,
          };
          break;
        default:
          updateData = {
            ...updateData,
            ...this.buildCustomerLifecyclePatch(customer, {
              onboardingStatus: 'PENDING_VERIFICATION',
              adminStatus: 'INACTIVE',
            }),
            verificationSubstatus: 'PROCESSING',
            verificationCustomerActionRequired: false,
            verificationCanContinue: false,
            sumsubExperiencedLevel2: experiencedLevel2,
          };
          this.logger.warn(`Unhandled Sumsub verification event ${eventType}; marking as PROCESSING.`);
          break;
      }

      const updatedCustomer = await tx.customerMain.update({
        where: { id: customer.id },
        data: updateData,
      });

      // Populate txAuditCapture BEFORE returning — captures post-update state for audit write.
      // Using an array container avoids TypeScript narrowing the closure-captured value to never.
      txAuditCapture.push({
        updatedCustomer,
        beforeOnboardingStatus: this.normalizeOptionalString(customer.onboardingStatus),
        beforeSubstatus: this.normalizeOptionalString(customer.verificationSubstatus),
        resolvedLevelName: nextLevelName,
        resolvedReviewAnswer: reviewResult.reviewAnswer || null,
        resolvedReviewRejectType: reviewResult.reviewRejectType || null,
        resolvedReviewId: reviewId,
        resolvedAttemptId: attemptId,
      });

      return {
        customer: {
          onboardingStatus: updatedCustomer.onboardingStatus ?? null,
          adminStatus: updatedCustomer.adminStatus ?? null,
          complianceStatus: updatedCustomer.complianceStatus ?? null,
        },
        verification: this.buildVerificationProjection(updatedCustomer),
      };
    });

    // Audit write OUTSIDE the transaction (matches the 84 other non-atomic sites).
    // txAuditCapture is empty on the terminal-state early-return path → no audit write (correct).
    // txAuditCapture is empty if the transaction throws → audit write skipped (correct).
    const auditCapture = txAuditCapture[0];
    if (auditCapture) {
      await this.writeSumsubAudit({
        customerId: auditCapture.updatedCustomer.id,
        customerNo: auditCapture.updatedCustomer.customerNo || null,
        onboardingTraceId: auditCapture.updatedCustomer.onboardingTraceId || null,
        eventType,
        simulated: context.simulated === true,
        simulatedByUserId:
          context.simulated === true
            ? this.normalizeOptionalString(context.simulatedByUserId) ||
              this.normalizeOptionalString(context.actorId)
            : null,
        onboardingStatusFrom: auditCapture.beforeOnboardingStatus,
        onboardingStatusTo: this.normalizeOptionalString(
          auditCapture.updatedCustomer.onboardingStatus,
        ),
        substatusFrom: auditCapture.beforeSubstatus,
        substatusTo: this.normalizeOptionalString(
          auditCapture.updatedCustomer.verificationSubstatus,
        ),
        levelName: auditCapture.resolvedLevelName,
        reviewAnswer: auditCapture.resolvedReviewAnswer,
        reviewRejectType: auditCapture.resolvedReviewRejectType,
        applicantId: this.resolveSumsubApplicantId(payload, context),
        reviewId: auditCapture.resolvedReviewId,
        attemptId: auditCapture.resolvedAttemptId,
      });
    }

    return result;
  }

  private normalizeOptionalString(value: unknown): string | null {
    if (value === null || value === undefined) return null;
    const normalized = String(value).trim();
    return normalized.length > 0 ? normalized : null;
  }

  private getRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  private async findCustomerForSumsubVerificationEvent(
    tx: Prisma.TransactionClient,
    payload: Record<string, unknown>,
    context: Record<string, unknown>,
  ) {
    const customerId =
      (context.simulated === true ? this.normalizeOptionalString(context.actorId) : null) ||
      this.normalizeOptionalString(payload.externalUserId) ||
      this.normalizeOptionalString(this.getRecord(payload.applicant).externalUserId);
    const applicantId = this.resolveSumsubApplicantId(payload, context);
    if (applicantId) {
      const byApplicantId = await tx.customerMain.findUnique({
        where: { sumsubApplicantId: applicantId },
      });
      if (byApplicantId) {
        if (customerId && customerId !== byApplicantId.id) {
          throw new BadRequestException(
            'Sumsub verification event identity mismatch between applicantId and customer identity.',
          );
        }
        return byApplicantId;
      }

      throw new BadRequestException(
        'Sumsub verification event applicantId does not match any customer.',
      );
    }

    if (!customerId) {
      throw new BadRequestException(
        'Sumsub verification event requires applicantId or customer identity.',
      );
    }

    return tx.customerMain.findUnique({
      where: { id: customerId },
    });
  }

  private resolveSumsubApplicantId(
    payload: Record<string, unknown>,
    context: Record<string, unknown>,
  ): string | null {
    return (
      this.normalizeOptionalString(payload.applicantId) ||
      this.normalizeOptionalString(this.getRecord(payload.applicant).id) ||
      this.normalizeOptionalString(context.applicantId)
    );
  }

  private resolveSumsubLevelName(
    payload: Record<string, unknown>,
    context: Record<string, unknown>,
  ): string | null {
    return (
      this.normalizeOptionalString(payload.levelName) ||
      this.normalizeOptionalString(this.getRecord(payload.level).name) ||
      this.normalizeOptionalString(context.levelName)
    );
  }

  private resolveSumsubReviewResult(
    payload: Record<string, unknown>,
    context: Record<string, unknown>,
  ): {
    reviewAnswer: string | null;
    reviewRejectType: string | null;
  } {
    const reviewResult = this.getRecord(payload.reviewResult);
    return {
      reviewAnswer: (
        this.normalizeOptionalString(reviewResult.reviewAnswer) ||
        this.normalizeOptionalString(payload.reviewAnswer) ||
        this.normalizeOptionalString(context.reviewAnswer)
      )?.toUpperCase() || null,
      reviewRejectType: (
        this.normalizeOptionalString(reviewResult.reviewRejectType) ||
        this.normalizeOptionalString(payload.reviewRejectType) ||
        this.normalizeOptionalString(context.reviewRejectType)
      )?.toUpperCase() || null,
    };
  }

  private resolveSumsubReviewId(
    payload: Record<string, unknown>,
    context: Record<string, unknown>,
  ): string | null {
    const reviewResult = this.getRecord(payload.reviewResult);
    return (
      this.normalizeOptionalString(reviewResult.reviewId) ||
      this.normalizeOptionalString(payload.reviewId) ||
      this.normalizeOptionalString(context.reviewId)
    );
  }

  private resolveSumsubAttemptId(
    payload: Record<string, unknown>,
    context: Record<string, unknown>,
  ): string | null {
    return (
      this.normalizeOptionalString(payload.attemptId) ||
      this.normalizeOptionalString(this.getRecord(payload.inspection).id) ||
      this.normalizeOptionalString(context.attemptId)
    );
  }

  private isSumsubLevel2Level(levelName?: string | null): boolean {
    const normalized = String(levelName || '').trim().toLowerCase();
    if (!normalized) {
      return false;
    }

    return normalized.includes('level-2') || normalized.includes('level2');
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
    adminStatus?: string | null;
    complianceStatus?: string | null;
  }) {
    return resolveCustomerCanonicalState(customer);
  }

  private normalizeRawOnboardingStatus(value?: string | null): string {
    return String(value || '').trim().toUpperCase();
  }

  private resolveInvalidRawOnboardingStatus(customer: {
    onboardingStatus?: string | null;
  }): string | null {
    const rawOnboardingStatus = this.normalizeRawOnboardingStatus(customer.onboardingStatus);
    if (!rawOnboardingStatus) {
      return null;
    }

    return this.recognizedRawOnboardingStatuses.has(rawOnboardingStatus)
      ? null
      : rawOnboardingStatus;
  }

  private getCustomerOnboardingStatus(customer: {
    onboardingStatus?: string | null;
    adminStatus?: string | null;
    complianceStatus?: string | null;
  }): LegacyCompatibleOnboardingStatus {
    return this.getCanonicalState(customer).onboardingStatus;
  }

  private resolveEddRequiredForState(
    customer: {
      eddRequired?: boolean | null;
    },
    onboardingStatus: LegacyCompatibleOnboardingStatus,
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
      adminStatus?: string | null;
      complianceStatus?: string | null;
      eddRequired?: boolean | null;
      cddDocumentExpiresAt?: Date | string | null;
    },
    next: {
      onboardingStatus: LegacyCompatibleOnboardingStatus;
      adminStatus?: CustomerAdminStatus;
      complianceStatus?: string;
      eddRequired?: boolean;
    },
  ): Prisma.CustomerMainUpdateInput {
    return buildCustomerLifecycleStatePatch(
      customer,
      next as Parameters<typeof buildCustomerLifecycleStatePatch>[1],
    );
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
    onboardingStatus?: string | null;
  }): Promise<string | null> {
    const rawOnboardingStatus = String(customer.onboardingStatus || '').trim().toUpperCase();
    if (!rawOnboardingStatus) {
      return null;
    }

    if (rawOnboardingStatus === 'PENDING_EDD_INPUT' || rawOnboardingStatus === 'EDD_UNDER_REVIEW') {
      const eddResponse = await this.findLatestOnboardingEddResponse(
        customer.id,
        customer.id,
      );
      return eddResponse?.id || null;
    }

    if (rawOnboardingStatus === 'PENDING_CDD_INPUT' || rawOnboardingStatus === 'CDD_UNDER_REVIEW') {
      const cddResponse = await this.findLatestOnboardingCddResponse(
        customer.id,
        customer.id,
      );
      return cddResponse?.id || null;
    }

    return null;
  }

  private buildLatestRiskApprovalBindingPatch(
    approvalId?: string | null,
  ): Prisma.CustomerMainUpdateInput {
    if (approvalId) {
      return {
        latestRiskApproval: {
          connect: { id: approvalId },
        },
      };
    }

    return {
      latestRiskApproval: {
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

  private buildPendingEddSignals(input: {
    caseNo: string;
    eddResponseId: string;
    journeyId: string;
  }) {
    const seed = this.buildSeed(`EDD:PENDING:${input.caseNo}`);
    return {
      provider: 'MOCK',
      caseType: 'EDD' as const,
      referenceId: `MOCK-${seed.toString(16).toUpperCase()}`,
      reviewedAt: new Date().toISOString(),
      eddResponseId: input.eddResponseId,
      journeyId: input.journeyId,
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
    journeyId: string;
    riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
    reasonCode: string;
  }) {
    const seed = this.buildSeed(`EDD:MANUAL:${input.caseNo}:${input.riskLevel}:${input.reasonCode}`);
    const base = {
      provider: 'MOCK',
      caseType: 'EDD' as const,
      referenceId: `MOCK-${seed.toString(16).toUpperCase()}`,
      reviewedAt: new Date().toISOString(),
      eddResponseId: input.eddResponseId,
      journeyId: input.journeyId,
      eddSubmitted: true,
      simulationMode: 'MANUAL',
      simulationRiskLevel: input.riskLevel,
      simulationRiskReason: input.reasonCode,
    };

    if (input.riskLevel === 'LOW') {
      return {
        ...base,
        outcome: 'PASS',
        riskScore: 24 + (seed % 10),
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
        riskScore: 56 + (seed % 10),
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

  private addDays(base: Date, days: number): Date {
    return new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
  }

  private mapActionsByStatus(status: {
    onboardingStatus?: string | null;
    adminStatus?: string | null;
    complianceStatus?: string | null;
  }): OnboardingAction[] {
    const actionTypes = getCustomerNextStepActionTypes(status);
    return actionTypes.map((type) => ({ type }));
  }

  private buildBlockedReason(status: {
    onboardingStatus?: string | null;
    adminStatus?: string | null;
    complianceStatus?: string | null;
  }): string | null {
    return getCustomerBlockedReason(status);
  }

  private async buildNextStep(customer: any): Promise<NextStepPayload> {
    const invalidRawOnboardingStatus = this.resolveInvalidRawOnboardingStatus(customer);
    if (invalidRawOnboardingStatus) {
      return {
        actions: [{ type: 'NONE' }],
        blockedReason: `Onboarding status ${invalidRawOnboardingStatus} is invalid. Contact support.`,
        activeCaseId: null,
        requiresEdd: false,
        verification: this.buildVerificationProjection(customer),
      };
    }

    const canonical = this.getCanonicalState(customer);
    const activeCaseId = await this.resolveActiveOnboardingResponseId(customer);
    return {
      actions: this.mapActionsByStatus(customer),
      blockedReason: this.buildBlockedReason(customer),
      activeCaseId,
      requiresEdd: this.resolveEddRequiredForState(customer, canonical.onboardingStatus),
      verification: this.buildVerificationProjection(customer),
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
      },
    });

    const workflowContext = buildComplianceWorkflowTraceContext({
      workflow: ONBOARDING_WORKFLOW,
      journeyId: input.journeyId || customer?.id || null,
    });
    await this.auditLogsService.recordByActor(
      {
        action: input.action,
        entityType: AuditEntityTypes.ONBOARDING,
        entityId: input.customerId,
        entityNo: customer?.customerNo || undefined,
        traceId: workflowContext?.traceId || undefined,
        workflowType: workflowContext?.workflowType || AuditWorkflowTypes.ONBOARDING,
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

  /**
   * Writes one audit_log_events row for a sumsub webhook step.
   * Called from handleSumsubVerificationEvent, AFTER the prisma.$transaction
   * has committed (matching the 84 other non-atomic audit-write sites in the
   * codebase). Uses workflowType + traceId only — no workflowId/workflowNo,
   * per docs/constraints/audit-trace-context-constraints.md.
   */
  private async writeSumsubAudit(input: {
    customerId: string;
    customerNo: string | null;
    onboardingTraceId: string | null;
    eventType: string;
    simulated: boolean;
    simulatedByUserId: string | null;
    onboardingStatusFrom: string | null;
    onboardingStatusTo: string | null;
    substatusFrom: string | null;
    substatusTo: string | null;
    levelName: string | null;
    reviewAnswer: string | null;
    reviewRejectType: string | null;
    applicantId: string | null;
    reviewId: string | null;
    attemptId: string | null;
  }) {
    const action = SUMSUB_EVENT_ACTION_MAP[input.eventType] || SUMSUB_DEFAULT_ACTION;
    const reason = input.simulated
      ? `Simulated sumsub event ${input.eventType} (substatus ${input.substatusFrom || '∅'} → ${input.substatusTo || '∅'})`
      : `Sumsub webhook ${input.eventType} (substatus ${input.substatusFrom || '∅'} → ${input.substatusTo || '∅'})`;

    try {
      await this.auditLogsService.recordByActor(
        {
          action,
          entityType: AuditEntityTypes.ONBOARDING,
          entityId: input.customerId,
          entityNo: input.customerNo || undefined,
          entityOwnerType: 'CUSTOMER',
          entityOwnerId: input.customerId,
          entityOwnerNo: input.customerNo || undefined,
          traceId: input.onboardingTraceId || undefined,
          workflowType: AuditWorkflowTypes.ONBOARDING,
          reason,
          metadata: {
            eventType: input.eventType,
            substatusFrom: input.substatusFrom,
            substatusTo: input.substatusTo,
            levelName: input.levelName,
            reviewAnswer: input.reviewAnswer,
            reviewRejectType: input.reviewRejectType,
            applicantId: input.applicantId,
            reviewId: input.reviewId,
            attemptId: input.attemptId,
            isSimulated: input.simulated,
            simulatedByUserId: input.simulatedByUserId,
            source: 'SUMSUB_INGESTION',
          },
          sourcePlatform: 'APPLICATION',
        },
        {
          actorType: input.simulated ? 'ADMIN' : 'SYSTEM',
          actorId: input.simulated
            ? input.simulatedByUserId || 'ADMIN_SIM'
            : 'SUMSUB',
          actorRole: input.simulated ? 'ADMIN' : 'SYSTEM',
        },
      );
    } catch (err) {
      // Match the existing pattern in approvals/payouts/customer-auth: audit
      // write failures don't fail the business operation. Log and continue.
      this.logger.error(
        `Failed to write sumsub audit for customer ${input.customerId} event ${input.eventType}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
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
          adminStatus: 'INACTIVE',
        }),
        ...this.buildLatestRiskApprovalBindingPatch(null),
        latestRiskApprovalStatus: null,
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

  private buildVerificationProjection(customer: {
    verificationProvider?: string | null;
    sumsubApplicantId?: string | null;
    sumsubCurrentLevelName?: string | null;
    sumsubLatestReviewId?: string | null;
    sumsubLatestAttemptId?: string | null;
    verificationSubstatus?: string | null;
    verificationCustomerActionRequired?: boolean | null;
    verificationCanContinue?: boolean | null;
    verificationLatestEventType?: string | null;
    verificationLatestEventAt?: Date | string | null;
    sumsubExperiencedLevel2?: boolean | null;
  }): VerificationProjection {
    return {
      provider: customer.verificationProvider ?? null,
      applicantId: customer.sumsubApplicantId ?? null,
      currentLevelName: customer.sumsubCurrentLevelName ?? null,
      latestReviewId: customer.sumsubLatestReviewId ?? null,
      latestAttemptId: customer.sumsubLatestAttemptId ?? null,
      substatus: customer.verificationSubstatus ?? null,
      customerActionRequired: !!customer.verificationCustomerActionRequired,
      canContinue: !!customer.verificationCanContinue,
      latestEventType: customer.verificationLatestEventType ?? null,
      latestEventAt: customer.verificationLatestEventAt ?? null,
      experiencedLevel2: !!customer.sumsubExperiencedLevel2,
    };
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
    const journeyId = cddResponse.journeyId || customer.id;

    const updateData: Prisma.CustomerMainUpdateInput = isLowRiskAutoPass
      ? {
          ...this.buildCustomerLifecyclePatch(customer, {
            onboardingStatus: 'APPROVED',
            adminStatus: 'ACTIVE',
            eddRequired: false,
          }),
          latestDecisionRecordId: decisionRecordId,
          ...this.buildLatestRiskApprovalBindingPatch(null),
          latestRiskApprovalStatus: null,
          cddDocumentExpiresAt: this.addDays(now, 365),
          nextReviewAt: this.addDays(now, 365),
        }
      : {
          ...this.buildCustomerLifecyclePatch(customer, {
            onboardingStatus: 'CDD_UNDER_REVIEW',
            adminStatus: 'INACTIVE',
            eddRequired: false,
          }),
          latestDecisionRecordId: decisionRecordId,
          ...this.buildLatestRiskApprovalBindingPatch(null),
          latestRiskApprovalStatus: null,
        };
    const linkedCaseIds = [cddResponse.id];

    const updated = await this.prisma.customerMain.update({
      where: { id: customer.id },
      data: updateData,
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
    const journeyId = eddResponse.journeyId || customer.id;

    const updateData: Prisma.CustomerMainUpdateInput = {
      ...this.buildCustomerLifecyclePatch(customer, {
        onboardingStatus: 'EDD_UNDER_REVIEW',
        adminStatus: 'INACTIVE',
        eddRequired: true,
      }),
      latestDecisionRecordId: decisionRecordId,
      ...this.buildLatestRiskApprovalBindingPatch(null),
      latestRiskApprovalStatus: null,
    };

    const updated = await this.prisma.customerMain.update({
      where: { id: customer.id },
      data: updateData,
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
      cddResponse.journeyId || customer.id;
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

    return {
      customer: updatedCustomer,
      decisionRecordId: decision.decisionRecordId,
      decision: decision.decision,
    };
  }

  async completeManualEddDecision(input: {
    decisionRecordId: string;
    riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
    reasonCode: string;
    actorId: string;
    actorRole: string;
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
      'ONBOARDING_EDD'
    ) {
      throw new BadRequestException(
        `Decision record ${input.decisionRecordId} is not bound to ONBOARDING_EDD`,
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
      throw new NotFoundException(`EDD response not found: ${eddResponseId}`);
    }
    const customer = await this.prisma.customerMain.findUnique({
      where: { id: eddResponse.customerId },
    });
    if (!customer) {
      throw new NotFoundException(`Customer not found: ${eddResponse.customerId}`);
    }

    const journeyId =
      eddResponse.journeyId || customer.id;
    const signals = this.buildManualEddSignals({
      caseNo: eddResponse.caseNo,
      eddResponseId: eddResponse.id,
      journeyId,
      riskLevel: input.riskLevel,
      reasonCode: input.reasonCode,
    });

    if (input.riskLevel === 'LOW' && input.reasonCode === 'EDD_CLEAR') {
      const txResult = await this.prisma.$transaction(async (tx) => {
        const decision = await this.riskEngineService.completeDecisionRecord(
          input.decisionRecordId,
          {
            contextType: 'ONBOARDING_EDD',
            subjectType: eddResponse.subjectKind || 'UNKNOWN',
            subjectId: eddResponse.subjectRefId || eddResponse.customerId,
            ownerType: 'CUSTOMER',
            ownerId: eddResponse.customerId,
            signals,
            policyVersion: 'onboarding-risk-policy/v1',
          },
          tx,
        );

        await tx.eddResponse.update({
          where: { id: eddResponse.id },
          data: {
            status: 'FINAL',
            mlroReviewedAt: new Date(),
            mlroDecision: decision.decision,
            decisionReason: decision.reasonCodes.join(',') || decision.decision,
            inputData: JSON.stringify(signals),
          },
        });

        const transition = await this.workflowTransitionService.transition(tx, {
          workflow: ONBOARDING_WORKFLOW,
          stage: ONBOARDING_REVIEW_STAGES.REVIEW_EDD,
          producerType: 'DECISION_RECORD',
          producerId: input.decisionRecordId,
          customerId: customer.id,
          journeyId,
          dispositionCode: 'CLEAR',
          reason: input.reasonCode,
          actorId: input.actorId,
          actorRole: input.actorRole,
          latestDecisionRecordId: input.decisionRecordId,
          linkedCaseIds: [eddResponse.id],
        });

        return {
          decision,
          transition,
        };
      });

      await this.emitTransitionApprovalSideEffects(
        txResult.transition,
        input.actorId,
        input.actorRole,
        input.reasonCode,
      );

      return {
        customer: txResult.transition.updatedCustomer,
        decisionRecordId: txResult.decision.decisionRecordId,
        decision: txResult.decision.decision,
        transition: txResult.transition,
      };
    }

    const decision = await this.riskEngineService.completeDecisionRecord(
      input.decisionRecordId,
      {
        contextType: 'ONBOARDING_EDD',
        subjectType: eddResponse.subjectKind || 'UNKNOWN',
        subjectId: eddResponse.subjectRefId || eddResponse.customerId,
        ownerType: 'CUSTOMER',
        ownerId: eddResponse.customerId,
        signals,
        policyVersion: 'onboarding-risk-policy/v1',
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

    const updatedCustomer = await this.handleEddDecision({
      customer,
      eddResponse,
      decision: decision.decision,
      decisionRecordId: decision.decisionRecordId,
      reasonCodes: decision.reasonCodes,
      recommendedActions: decision.recommendedActions,
    });

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
      adminStatus: canonical.adminStatus,
      complianceStatus: canonical.complianceStatus,
      actions: nextStep.actions,
      blockedReason: nextStep.blockedReason,
      activeCaseId: nextStep.activeCaseId,
      requiresEdd: nextStep.requiresEdd,
      verification: nextStep.verification,
    };
  }

  private buildCustomerSnapshot(customer: {
    onboardingStatus?: string | null;
    adminStatus?: string | null;
    complianceStatus?: string | null;
  }): StartVerificationCustomerSnapshotDto {
    const canonical = this.getCanonicalState(customer);
    return {
      onboardingStatus: canonical.onboardingStatus,
      adminStatus: canonical.adminStatus,
      complianceStatus: canonical.complianceStatus,
    };
  }

  async startVerification(customerId: string): Promise<StartVerificationSnapshotDto> {
    const customer = await this.getCustomerOrThrow(customerId, true);
    this.ensureIndividualOnly(customer);

    const rawOnboardingStatus = this.normalizeRawOnboardingStatus(customer.onboardingStatus);
    const currentStatus = this.getCustomerOnboardingStatus(customer);
    if (this.resolveInvalidRawOnboardingStatus(customer)) {
      throw new BadRequestException(
        `Current status ${rawOnboardingStatus} does not allow starting verification.`,
      );
    }

    if (this.legacyRawVerificationStatuses.has(rawOnboardingStatus)) {
      throw new BadRequestException(
        `Current status ${rawOnboardingStatus} does not allow starting verification.`,
      );
    }

    if (currentStatus === 'APPROVED' || currentStatus === 'FINAL_APPROVAL') {
      throw new BadRequestException(
        `Current status ${currentStatus} does not allow starting verification.`,
      );
    }

    if (currentStatus === 'PENDING_VERIFICATION' && customer.verificationCanContinue !== true) {
      throw new BadRequestException(
        'Current status PENDING_VERIFICATION does not allow starting verification.',
      );
    }

    if (
      currentStatus === 'PENDING_VERIFICATION' &&
      customer.verificationProvider &&
      customer.verificationProvider !== 'SUMSUB'
    ) {
      throw new BadRequestException(
        'Current status PENDING_VERIFICATION does not allow starting verification.',
      );
    }

    if (!['NONE', 'PENDING_VERIFICATION', 'REJECTED', 'WITHDRAWN'].includes(currentStatus)) {
      throw new BadRequestException(
        `Current status ${currentStatus} does not allow starting verification.`,
      );
    }

    const isReinitiating = currentStatus === 'REJECTED' || currentStatus === 'WITHDRAWN';
    const levelName = String(customer.sumsubCurrentLevelName || '').trim() || 'wave3-level-1';

    let applicantId = customer.sumsubApplicantId ? String(customer.sumsubApplicantId) : null;
    if (!applicantId) {
      const existingApplicant = await this.sumsubClient.getApplicantByExternalUserId(customerId);
      applicantId = existingApplicant?.id || null;
    }
    if (!applicantId) {
      applicantId = (
        await this.sumsubClient.createApplicant({
          externalUserId: customerId,
          levelName,
        })
      ).id;
    }

    const sdkToken = await this.sumsubClient.createSdkToken({
      externalUserId: customerId,
      levelName,
    });

    const updateData: Prisma.CustomerMainUpdateInput = {
      ...this.buildCustomerLifecyclePatch(customer, {
        onboardingStatus: 'PENDING_VERIFICATION',
        adminStatus: 'INACTIVE',
      }),
      ...(customer.onboardingTraceId ? {} : { onboardingTraceId: randomUUID() }),
      ...(currentStatus === 'PENDING_VERIFICATION' && !customer.verificationProvider
        ? { verificationProvider: 'SUMSUB' }
        : {}),
      ...(currentStatus === 'PENDING_VERIFICATION' && !customer.sumsubCurrentLevelName
        ? { sumsubCurrentLevelName: levelName }
        : {}),
      ...(currentStatus === 'PENDING_VERIFICATION' && !customer.sumsubApplicantId
        ? { sumsubApplicantId: applicantId }
        : {}),
    };

    if (currentStatus !== 'PENDING_VERIFICATION') {
      Object.assign(updateData, {
        verificationProvider: 'SUMSUB',
        verificationSubstatus: 'CREATED',
        verificationCustomerActionRequired: true,
        verificationCanContinue: true,
        sumsubApplicantId: applicantId,
        sumsubCurrentLevelName: levelName,
      });
    }

    if (isReinitiating) {
      Object.assign(updateData, this.buildLatestRiskApprovalBindingPatch(null), {
        latestRiskApprovalStatus: null,
        verificationLatestEventType: null,
        verificationLatestEventAt: null,
      });
      updateData.sumsubExperiencedLevel2 = false;
      updateData.sumsubLatestReviewId = null;
      updateData.sumsubLatestAttemptId = null;
    }

    const updated = await this.prisma.customerMain.update({
      where: { id: customerId },
      data: updateData,
    });

    const nextStep = await this.buildNextStep(updated);
    const verification = {
      ...this.buildVerificationProjection(updated),
      sdkToken: sdkToken.token,
    };

    return {
      customer: this.buildCustomerSnapshot(updated),
      nextStep,
      verification,
    };
  }

  /**
   * Mock-mode only: simulate the customer finishing the mobile KYC form by
   * dispatching an `applicantPending` event for the current customer. This
   * transitions the customer from PENDING_VERIFICATION/CREATED to
   * PENDING_VERIFICATION/SUBMITTED so the UI can show the "under review" page.
   * In production (with real Sumsub credentials), Sumsub itself sends the
   * webhook so this endpoint is a no-op gated check.
   */
  async mockSubmitVerification(customerId: string): Promise<StartVerificationSnapshotDto> {
    if (process.env.SUMSUB_APP_TOKEN && process.env.SUMSUB_SECRET_KEY) {
      throw new BadRequestException(
        'mock-submit is only available when Sumsub credentials are not configured.',
      );
    }

    const customer = await this.getCustomerOrThrow(customerId, true);
    if (this.getCustomerOnboardingStatus(customer) !== 'PENDING_VERIFICATION') {
      throw new BadRequestException(
        'mock-submit requires customer to be in PENDING_VERIFICATION state.',
      );
    }

    const payload: Record<string, unknown> = {
      type: 'applicantPending',
      externalUserId: customerId,
      ...(customer.sumsubApplicantId ? { applicantId: customer.sumsubApplicantId } : {}),
    };

    await this.handleSumsubVerificationEvent(payload, {
      simulated: true,
      actorId: customerId,
      rawBody: Buffer.from(JSON.stringify(payload)),
    });

    const refreshed = await this.getCustomerOrThrow(customerId, true);
    const nextStep = await this.buildNextStep(refreshed);
    return {
      customer: this.buildCustomerSnapshot(refreshed),
      nextStep,
      verification: {
        ...this.buildVerificationProjection(refreshed),
        sdkToken: '',
      },
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
          adminStatus: this.getCanonicalState(customer).adminStatus,
          complianceStatus: this.getCanonicalState(customer).complianceStatus,
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

    const journeyId = dto?.journeyId || customer.id;

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
          adminStatus: 'INACTIVE',
          eddRequired: false,
        }),
        ...this.buildLatestRiskApprovalBindingPatch(null),
        latestRiskApprovalStatus: null,
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
        ...this.buildLatestRiskApprovalBindingPatch(null),
        latestRiskApprovalStatus: null,
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

    const eddResponse = await this.findLatestOnboardingEddResponse(customerId, customer.id);
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

    const journeyId = body?.journeyId || customer.id;
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
          adminStatus: 'INACTIVE',
          eddRequired: true,
        }),
        ...this.buildLatestRiskApprovalBindingPatch(null),
        latestRiskApprovalStatus: null,
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
        cddResponse.journeyId || customer.id;
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
            adminStatus: 'INACTIVE',
            eddRequired: false,
          }),
          latestDecisionRecordId: pendingDecision.decisionRecordId,
          ...this.buildLatestRiskApprovalBindingPatch(null),
          latestRiskApprovalStatus: null,
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
    const journeyId =
      eddResponse.journeyId || customer.id;
    const signals = this.buildPendingEddSignals({
      caseNo: eddResponse.caseNo,
      eddResponseId: eddResponse.id,
      journeyId,
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
      contextType: 'ONBOARDING_EDD',
      subjectType: eddResponse.subjectKind || 'UNKNOWN',
      subjectId: eddResponse.subjectRefId || customerId,
      ownerType: 'CUSTOMER',
      ownerId: customerId,
      signals,
      policyVersion: 'onboarding-risk-policy/v1',
    });
    const updatedCustomer = await this.prisma.customerMain.update({
      where: { id: customer.id },
      data: {
        ...this.buildCustomerLifecyclePatch(customer, {
          onboardingStatus: 'EDD_UNDER_REVIEW',
          adminStatus: 'INACTIVE',
          eddRequired: true,
        }),
        latestDecisionRecordId: pendingDecision.decisionRecordId,
        ...this.buildLatestRiskApprovalBindingPatch(null),
        latestRiskApprovalStatus: null,
      },
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
      detail: `EDD response received and queued for manual risk simulation decisionRecordId=${pendingDecision.decisionRecordId}`,
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
              adminStatus: true,
              complianceStatus: true,
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
            adminStatus: true,
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
              adminStatus: true,
              complianceStatus: true,
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
            adminStatus: true,
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

  async updateInvestorTier(
    customerId: string,
    actorId: string,
    actorRole: string,
    dto: UpdateInvestorTierDto,
  ) {
    await this.getCustomerOrThrow(customerId);

    const updated = await this.prisma.customerMain.update({
      where: { id: customerId },
      data: {
        investorTier: dto.classification,
        investorTierSource: 'ADMIN_OVERRIDE',
        investorTierUpdatedAt: new Date(),
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
      investorTier: updated.investorTier,
      investorTierSource: updated.investorTierSource,
      investorTierUpdatedAt: updated.investorTierUpdatedAt,
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
      canonical.adminStatus !== 'ACTIVE' ||
      canonical.complianceStatus === 'FROZEN'
    ) {
      throw new ForbiddenException({
        message: `${action} is blocked by onboarding gate`,
        customerId,
        customerNo: customer.customerNo,
        onboardingStatus: canonical.onboardingStatus,
        adminStatus: canonical.adminStatus,
        complianceStatus: customer.complianceStatus,
        complianceFreezeCaseId: customer.complianceFreezeCaseId,
      });
    }

    if (String(customer.complianceStatus || 'CLEAR').toUpperCase() === 'FROZEN') {
      throw new ForbiddenException({
        message: `${action} is blocked by compliance hold`,
        customerId,
        customerNo: customer.customerNo,
        onboardingStatus: canonical.onboardingStatus,
        adminStatus: canonical.adminStatus,
        complianceStatus: customer.complianceStatus,
        complianceFreezeCaseId: customer.complianceFreezeCaseId,
      });
    }
  }

  async recomputeComplianceSnapshot(customerId: string, _journeyId?: string) {
    const customer = await this.getCustomerOrThrow(customerId);
    const canonical = this.getCanonicalState(customer);
    const eddRequired = this.resolveEddRequiredForState(customer, canonical.onboardingStatus);
    const patch: Prisma.CustomerMainUpdateInput = this.buildCustomerLifecyclePatch(customer, {
      onboardingStatus: canonical.onboardingStatus,
      adminStatus: canonical.adminStatus,
      complianceStatus: canonical.complianceStatus,
      eddRequired,
    });

    const updated = await this.prisma.customerMain.update({
      where: { id: customerId },
      data: patch,
    });

    return updated;
  }
}
