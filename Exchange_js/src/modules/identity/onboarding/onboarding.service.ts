import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  forwardRef,
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
  CustomerNextStepActionType,
  CustomerLifecycleSource,
  getCustomerBlockedReason,
  getCustomerNextStepActionTypes,
  readLifecycle,
  resolveLifecycleTransition,
} from '../customer-lifecycle.util';
import type {
  CustomerLifecycle,
  CustomerLifecycleAction,
} from '../constants/customer-lifecycle.constant';
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
import { CustomerAccessService } from '../customers/customer-access.service';
import {
  projectResponseRecord,
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly onboardingFinalApprovalService: OnboardingFinalApprovalService,
    private readonly sumsubClient: SumsubClient,
    private readonly auditLogsService: AuditLogsService,
    // forwardRef：CustomersModule 已 forwardRef 回 OnboardingModule（取 SumsubClient），
    // 本段让 Onboarding 反向依赖 Customers，两侧模块与此处三点同时 forwardRef 才断得掉环。
    @Inject(forwardRef(() => CustomerAccessService))
    private readonly customerAccessService: CustomerAccessService,
  ) {}

  async handleSumsubVerificationEvent(
    payload: Record<string, unknown> = {},
    context: Record<string, unknown> = {},
  ): Promise<{
    customer: {
      lifecycle: string;
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
      beforeLifecycle: string;
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

      const currentLifecycle = readLifecycle(customer);
      if (currentLifecycle !== 'PROSPECT' && currentLifecycle !== 'IN_VERIFICATION') {
        this.logger.warn(
          `Ignoring Sumsub verification event ${eventType} for terminal lifecycle ${currentLifecycle}.`,
        );
        return {
          customer: { lifecycle: currentLifecycle },
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

      let lifecycleAction: CustomerLifecycleAction;
      // 九边表没有 IN_VERIFICATION → ACTIVE 的直达边。未经 level2 的
      // applicantWorkflowCompleted 今天是「自动批准」，按表拆成两跳
      // （VERIFICATION_PASSED → FINAL_APPROVED），落地结果与今天一致。
      let autoApproveWithoutFinalReview = false;

      switch (eventType) {
        case 'applicantPending':
          lifecycleAction = 'START_VERIFICATION';
          updateData = {
            ...updateData,
            verificationSubstatus: 'SUBMITTED',
            verificationCustomerActionRequired: false,
            verificationCanContinue: false,
          };
          break;
        case 'applicantOnHold':
          lifecycleAction = 'START_VERIFICATION';
          updateData = {
            ...updateData,
            verificationSubstatus: 'UNDER_REVIEW',
            verificationCustomerActionRequired: false,
            verificationCanContinue: false,
          };
          break;
        case 'applicantLevelChanged':
          lifecycleAction = 'START_VERIFICATION';
          updateData = {
            ...updateData,
            verificationSubstatus: 'NEXT_LEVEL_REQUIRED',
            verificationCustomerActionRequired: false,
            verificationCanContinue: true,
            sumsubExperiencedLevel2: experiencedLevel2,
          };
          break;
        case 'applicantReviewed':
          lifecycleAction = 'START_VERIFICATION';
          if (reviewResult.reviewAnswer === 'RED' && reviewResult.reviewRejectType === 'RETRY') {
            updateData = {
              ...updateData,
              verificationSubstatus: 'RESUBMIT_REQUIRED',
              verificationCustomerActionRequired: true,
              verificationCanContinue: true,
              sumsubExperiencedLevel2: experiencedLevel2,
            };
          } else {
            updateData = {
              ...updateData,
              verificationSubstatus: 'UNDER_REVIEW',
              verificationCustomerActionRequired: false,
              verificationCanContinue: false,
              sumsubExperiencedLevel2: experiencedLevel2,
            };
          }
          break;
        case 'applicantWorkflowCompleted':
          if (experiencedLevel2) {
            lifecycleAction = 'VERIFICATION_PASSED';
            const pendingApproval =
              await this.onboardingFinalApprovalService.ensurePendingApprovalInTransaction(tx, {
                customer: {
                  ...customer,
                  lifecycle: 'PENDING_APPROVAL',
                },
                actorId,
                actorRole,
                reason: `Sumsub workflow completed via ${eventType}`,
              });
            updateData = {
              ...updateData,
              ...this.buildLatestRiskApprovalBindingPatch(pendingApproval.approval.id),
              latestRiskApprovalStatus: pendingApproval.approval.status || 'PENDING',
              verificationSubstatus: 'COMPLETED',
              verificationCustomerActionRequired: false,
              verificationCanContinue: false,
              sumsubExperiencedLevel2: true,
            };
          } else {
            lifecycleAction = 'FINAL_APPROVED';
            autoApproveWithoutFinalReview = true;
            updateData = {
              ...updateData,
              ...this.buildLatestRiskApprovalBindingPatch(null),
              latestRiskApprovalStatus: null,
              verificationSubstatus: 'COMPLETED',
              verificationCustomerActionRequired: false,
              verificationCanContinue: false,
              sumsubExperiencedLevel2: false,
              // Write-once: lock the NEW_CUSTOMER window start on first ACTIVE;
              // a later re-approval must not reset it.
              onboardingApprovedAt: customer.onboardingApprovedAt ?? now,
            };
          }
          break;
        case 'applicantWorkflowFailed':
          lifecycleAction = 'VERIFICATION_REJECTED';
          updateData = {
            ...updateData,
            ...this.buildLatestRiskApprovalBindingPatch(null),
            latestRiskApprovalStatus: null,
            verificationSubstatus: 'FAILED',
            verificationCustomerActionRequired: false,
            verificationCanContinue: false,
            sumsubExperiencedLevel2: experiencedLevel2,
          };
          break;
        default:
          lifecycleAction = 'START_VERIFICATION';
          updateData = {
            ...updateData,
            verificationSubstatus: 'PROCESSING',
            verificationCustomerActionRequired: false,
            verificationCanContinue: false,
            sumsubExperiencedLevel2: experiencedLevel2,
          };
          this.logger.warn(`Unhandled Sumsub verification event ${eventType}; marking as PROCESSING.`);
          break;
      }

      if (autoApproveWithoutFinalReview) {
        await this.advanceLifecycle(customer.id, 'VERIFICATION_PASSED', tx);
      }

      const updatedCustomer = await this.advanceLifecycle(
        customer.id,
        lifecycleAction,
        tx,
        updateData,
      );

      // Populate txAuditCapture BEFORE returning — captures post-update state for audit write.
      // Using an array container avoids TypeScript narrowing the closure-captured value to never.
      txAuditCapture.push({
        updatedCustomer,
        beforeLifecycle: currentLifecycle,
        beforeSubstatus: this.normalizeOptionalString(customer.verificationSubstatus),
        resolvedLevelName: nextLevelName,
        resolvedReviewAnswer: reviewResult.reviewAnswer || null,
        resolvedReviewRejectType: reviewResult.reviewRejectType || null,
        resolvedReviewId: reviewId,
        resolvedAttemptId: attemptId,
      });

      return {
        customer: { lifecycle: readLifecycle(updatedCustomer) },
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
        lifecycleFrom: auditCapture.beforeLifecycle,
        lifecycleTo: this.normalizeOptionalString(auditCapture.updatedCustomer.lifecycle),
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

  private resolveEddRequiredForState(
    customer: {
      eddRequired?: boolean | null;
    },
    lifecycle: CustomerLifecycle,
  ): boolean {
    switch (lifecycle) {
      case 'PROSPECT':
        return false;
      case 'PENDING_APPROVAL':
        return true;
      case 'IN_VERIFICATION':
      case 'ACTIVE':
      case 'REJECTED':
      case 'WITHDRAWN':
      case 'OFFBOARDED':
        return !!customer.eddRequired;
    }
  }

  /**
   * lifecycle 唯一落库口。任何写 lifecycle 的地方都必须经过这里，九边迁移表
   * 才真正生效（裸写字符串等于没有状态机）。
   * - 动作目标态 == 当前态 → 幂等重放，只写 extra，不动 lifecycle
   * - 非法边 → resolveLifecycleTransition 抛 BadRequestException，事务回滚
   * 这里不写审计：调用方（writeAudit / writeSumsubAudit / 上层 workflow）已各自
   * 记录 fromStage/toStage，在此再写一条会产生重复审计行。
   */
  private async advanceLifecycle(
    customerId: string,
    action: CustomerLifecycleAction,
    tx?: Prisma.TransactionClient,
    extra: Prisma.CustomerMainUpdateInput = {},
  ) {
    const client = tx ?? this.prisma;
    const current = await client.customerMain.findUnique({
      where: { id: customerId },
      select: { lifecycle: true },
    });
    if (!current) {
      throw new NotFoundException(`Customer not found: ${customerId}`);
    }

    const to = resolveLifecycleTransition(readLifecycle(current), action);

    return client.customerMain.update({
      where: { id: customerId },
      data: to ? { ...extra, lifecycle: to } : extra,
    });
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

  private mapActionsByStatus(customer: CustomerLifecycleSource): OnboardingAction[] {
    return getCustomerNextStepActionTypes(customer).map((type) => ({ type }));
  }

  private async buildNextStep(customer: any): Promise<NextStepPayload> {
    return {
      actions: this.mapActionsByStatus(customer),
      blockedReason: getCustomerBlockedReason(customer),
      activeCaseId: null,
      requiresEdd: this.resolveEddRequiredForState(customer, readLifecycle(customer)),
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
    lifecycleFrom: string | null;
    lifecycleTo: string | null;
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

  /**
   * Review Fix（终审 Finding 1，tipping-off 泄漏）：customer-facing 读端点
   * （getMyOnboarding / upsertEntity）历史上直接 `...customer` 把 CustomerMain
   * 整行 spread 进响应体。两个字段绝不能这样流出去：
   *   - passwordHash：认证凭据，任何业务响应都不该带它（顺手一并堵上，同一处
   *     spread 就是泄漏点）。
   *   - hardLineDispositionedAt：swap KYT 硬线处置的 sticky 标记，只在客户被
   *     永久沉默（含制裁调查）时非 null —— 把这个事实原样回显给被沉默的本人
   *     就是 tipping-off。
   * 集中在这一处剔除，而不是让每个客户端读接口各自记一遍"这个字段不能给客户
   * 看"——hardLineDispositionedAt 本身就是后一种写法漏挡的例子。新增的内部
   * 专用列如果同样不能面向客户，加进这里的剔除表。
   */
  private omitCustomerInternalOnlyFields<T extends Record<string, any>>(
    customer: T,
  ): Omit<T, 'passwordHash' | 'hardLineDispositionedAt'> {
    const { passwordHash, hardLineDispositionedAt, ...safe } = customer;
    return safe;
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
    const customer = await this.getCustomerOrThrow(customerId, true);
    const nextStep = await this.buildNextStep(customer);

    return {
      ...this.omitCustomerInternalOnlyFields(customer),
      actions: nextStep.actions,
      blockedReason: nextStep.blockedReason,
      activeCaseId: nextStep.activeCaseId,
      requiresEdd: nextStep.requiresEdd,
      verification: nextStep.verification,
    };
  }

  private buildCustomerSnapshot(customer: {
    lifecycle?: string | null;
  }): StartVerificationCustomerSnapshotDto {
    return { lifecycle: readLifecycle(customer) };
  }

  async startVerification(customerId: string): Promise<StartVerificationSnapshotDto> {
    const customer = await this.getCustomerOrThrow(customerId, true);
    this.ensureIndividualOnly(customer);

    const currentLifecycle = readLifecycle(customer);

    if (
      currentLifecycle !== 'PROSPECT' &&
      currentLifecycle !== 'IN_VERIFICATION' &&
      currentLifecycle !== 'REJECTED' &&
      currentLifecycle !== 'WITHDRAWN'
    ) {
      throw new BadRequestException(
        `Current status ${currentLifecycle} does not allow starting verification.`,
      );
    }

    if (currentLifecycle === 'IN_VERIFICATION' && customer.verificationCanContinue !== true) {
      throw new BadRequestException(
        'Current status IN_VERIFICATION does not allow starting verification.',
      );
    }

    if (
      currentLifecycle === 'IN_VERIFICATION' &&
      customer.verificationProvider &&
      customer.verificationProvider !== 'SUMSUB'
    ) {
      throw new BadRequestException(
        'Current status IN_VERIFICATION does not allow starting verification.',
      );
    }

    const isReinitiating = currentLifecycle === 'REJECTED' || currentLifecycle === 'WITHDRAWN';
    const lifecycleAction: CustomerLifecycleAction = isReinitiating
      ? 'REAPPLY'
      : 'START_VERIFICATION';
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
      ...(customer.onboardingTraceId ? {} : { onboardingTraceId: randomUUID() }),
      ...(currentLifecycle === 'IN_VERIFICATION' && !customer.verificationProvider
        ? { verificationProvider: 'SUMSUB' }
        : {}),
      ...(currentLifecycle === 'IN_VERIFICATION' && !customer.sumsubCurrentLevelName
        ? { sumsubCurrentLevelName: levelName }
        : {}),
      ...(currentLifecycle === 'IN_VERIFICATION' && !customer.sumsubApplicantId
        ? { sumsubApplicantId: applicantId }
        : {}),
    };

    if (currentLifecycle !== 'IN_VERIFICATION') {
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

    const updated = await this.advanceLifecycle(
      customerId,
      lifecycleAction,
      undefined,
      updateData,
    );

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
    if (readLifecycle(customer) !== 'IN_VERIFICATION') {
      throw new BadRequestException(
        'mock-submit requires customer to be in IN_VERIFICATION state.',
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
      fromStage: readLifecycle(customer),
      toStage: readLifecycle(updated),
      detail: 'Customer entity profile normalized to INDIVIDUAL only.',
    });

    return {
      ...this.omitCustomerInternalOnlyFields(updated),
      actions: this.mapActionsByStatus(updated),
    };
  }

  async simulateCustomerExpired(customerId: string, actorId: string, actorRole: string) {
    const customer = await this.getCustomerOrThrow(customerId);
    const expiredAt = new Date(Date.now() - 60 * 60 * 1000);
    const currentLifecycle = readLifecycle(customer);

    await this.prisma.customerMain.update({
      where: { id: customerId },
      data: {
        cddDocumentExpiresAt: expiredAt,
      },
    });
    const updated = await this.getCustomerOrThrow(customerId);

    await this.writeAudit({
      customerId,
      action: 'SIMULATE_EXPIRED',
      actorId,
      actorRole,
      fromStage: currentLifecycle,
      toStage: readLifecycle(updated),
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

  /**
   * 交易资格门。
   *
   * Task 5：唯一执法依据是 CustomerAccessService（lifecycle 轴 + 限制账）。
   * 这里既不自己读状态列、也不自己解析限制行，更不许把 cause / visibility 拌进
   * 错误体 —— SILENT 限制的存在本身就是 tipping-off 信号。
   */
  async assertTradingEligibility(customerId: string, action: TradeAction) {
    await this.customerAccessService.assertCapability(customerId, action);

    if (action !== 'DEPOSIT') {
      await this.assertTradingReady(customerId);
    }
  }

  async assertTradingReady(customerId: string): Promise<void> {
    const n = await this.prisma.withdrawalAddress.count({
      where: { customerId, status: 'ACTIVE', addressType: 'BANK' },
    });
    const ok = n > 0;
    if (!ok) {
      throw new ForbiddenException({
        code: 'NO_ACTIVE_FIAT_WITHDRAWAL_ADDRESS',
        message: '需要先创建并激活一个法币提现地址才能开展业务',
        customerId,
      });
    }
  }

  async recomputeComplianceSnapshot(customerId: string, _journeyId?: string) {
    const customer = await this.getCustomerOrThrow(customerId);
    const eddRequired = this.resolveEddRequiredForState(customer, readLifecycle(customer));

    const updated = await this.prisma.customerMain.update({
      where: { id: customerId },
      data: { eddRequired },
    });

    return updated;
  }
}
