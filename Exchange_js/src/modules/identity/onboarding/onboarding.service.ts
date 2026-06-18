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
    return {
      actions: this.mapActionsByStatus(customer),
      blockedReason: this.buildBlockedReason(customer),
      activeCaseId: null,
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
