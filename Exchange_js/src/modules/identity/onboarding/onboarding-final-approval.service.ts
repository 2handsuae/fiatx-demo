import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import {
  AuditEntityTypes,
  AuditModules,
  AuditWorkflowTypes,
} from '../../audit-logging/constants/audit-actions.constant';
import {
  ONBOARDING_WORKFLOW,
  buildComplianceWorkflowTraceContext,
} from '../../risk-engine/constants/onboarding-compliance-workflow.constant';
import { buildCustomerLifecyclePatch as buildCustomerLifecycleStatePatch } from '../customer-status.util';
import { FinalReviewCustomerDto, SubmitFinalApprovalDto } from './dto/onboarding.dto';
import { ApprovalsService } from '../../governance/approvals/approvals.service';
import {
  ApprovalActionTypes,
  ApprovalActorContext,
  ApprovalDecisionEvent,
  ApprovalEvents,
  ApprovalStatuses,
} from '../../governance/approvals/constants/approval.constants';

type ApprovalWriteClient = Prisma.TransactionClient | PrismaService;

interface FinalApprovalCustomerRow {
  id: string;
  customerNo?: string | null;
  onboardingStatus?: string | null;
  adminStatus?: string | null;
  complianceStatus?: string | null;
  eddRequired?: boolean | null;
  latestRiskApprovalId?: string | null;
  latestRiskApprovalStatus?: string | null;
}

interface FinalApprovalSummary {
  id: string;
  approvalNo: string;
  status: string;
}

interface PendingApprovalResolution {
  approval: FinalApprovalSummary;
  created: boolean;
  auditAction: 'FINAL_APPROVAL_SUBMITTED' | 'FINAL_APPROVAL_RESUBMITTED';
}

const FINAL_APPROVAL_CUSTOMER_SELECT = {
  id: true,
  customerNo: true,
  onboardingStatus: true,
  adminStatus: true,
  complianceStatus: true,
  eddRequired: true,
  latestRiskApprovalId: true,
  latestRiskApprovalStatus: true,
} satisfies Prisma.CustomerMainSelect;

@Injectable()
export class OnboardingFinalApprovalService {
  private readonly logger = new Logger(OnboardingFinalApprovalService.name);

  /** Property-injected to avoid circular deps — set in module onModuleInit */
  materialRefreshService?: { seedInitialHoldings: (customerId: string, levelName: string) => Promise<void> };

  constructor(
    private readonly prisma: PrismaService,
    private readonly approvalsService: ApprovalsService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  private normalizeOptionalString(value: unknown): string | null {
    if (value === null || value === undefined) return null;
    const normalized = String(value).trim();
    return normalized.length > 0 ? normalized : null;
  }

  private toActorContext(actorId: string, actorRole: string): ApprovalActorContext {
    const normalizedRole = String(actorRole || '').trim() || 'ADMIN';
    return {
      actorType: 'ADMIN',
      userId: actorId,
      role: normalizedRole,
      roleCodes: [normalizedRole],
    };
  }

  private toProjectionActor(event: ApprovalDecisionEvent): ApprovalActorContext {
    const role = this.normalizeOptionalString(event.decisionByRole) || 'SYSTEM';
    return {
      actorType: 'ADMIN',
      userId: this.normalizeOptionalString(event.decisionByUserId) || 'SYSTEM',
      role,
      roleCodes: [role],
    };
  }

  private toApprovalSummary(approval: {
    id: string;
    approvalNo: string;
    status: string;
  }): FinalApprovalSummary {
    return {
      id: approval.id,
      approvalNo: approval.approvalNo,
      status: approval.status,
    };
  }

  private isRetryableApprovalStatus(status?: string | null): boolean {
    const normalized = String(status || '').trim().toUpperCase();
    return normalized === ApprovalStatuses.CANCELLED || normalized === ApprovalStatuses.EXPIRED;
  }

  private isPendingApprovalStatus(status?: string | null): boolean {
    return String(status || '').trim().toUpperCase() === ApprovalStatuses.PENDING;
  }

  private assertCustomerInFinalApproval(customer: FinalApprovalCustomerRow) {
    if (String(customer.onboardingStatus || '').trim().toUpperCase() !== 'FINAL_APPROVAL') {
      throw new BadRequestException(
        'Final approval is only available while customer is in FINAL_APPROVAL.',
      );
    }
  }

  private async getCustomerOrThrow(
    customerId: string,
    client: ApprovalWriteClient = this.prisma,
  ): Promise<FinalApprovalCustomerRow> {
    const customer = await client.customerMain.findUnique({
      where: { id: customerId },
      select: FINAL_APPROVAL_CUSTOMER_SELECT,
    });
    if (!customer) {
      throw new NotFoundException(`Customer not found: ${customerId}`);
    }
    return customer as FinalApprovalCustomerRow;
  }

  private async findLinkedApproval(
    client: ApprovalWriteClient,
    customer: FinalApprovalCustomerRow,
  ) {
    if (!customer.latestRiskApprovalId) {
      return null;
    }

    return client.approvalCase.findUnique({
      where: { id: customer.latestRiskApprovalId },
      select: {
        id: true,
        approvalNo: true,
        actionType: true,
        entityRef: true,
        status: true,
      },
    });
  }

  private async findPendingApprovalByEntity(
    client: ApprovalWriteClient,
    customerId: string,
  ) {
    return client.approvalCase.findFirst({
      where: {
        actionType: ApprovalActionTypes.ONBOARDING_FINAL_APPROVAL,
        entityRef: customerId,
        status: ApprovalStatuses.PENDING,
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        approvalNo: true,
        actionType: true,
        entityRef: true,
        status: true,
      },
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

  private buildTraceContext(journeyId?: string | null) {
    return buildComplianceWorkflowTraceContext({
      workflow: ONBOARDING_WORKFLOW,
      journeyId,
    });
  }

  private async writeCanonicalAudit(input: {
    customerId: string;
    customerNo?: string | null;
    action: string;
    actorId: string;
    actorRole: string;
    detail: Record<string, unknown>;
    reason?: string | null;
    fromStage?: string | null;
    toStage?: string | null;
    journeyId?: string | null;
  }) {
    const traceContext = this.buildTraceContext(input.journeyId);
    await this.auditLogsService.recordByActor(
      {
        action: input.action,
        entityType: AuditEntityTypes.ONBOARDING,
        entityId: input.customerId,
        entityNo: input.customerNo || undefined,
        traceId: traceContext?.traceId || undefined,
        workflowType: traceContext?.workflowType || AuditWorkflowTypes.ONBOARDING,
        entityOwnerType: 'CUSTOMER',
        entityOwnerId: input.customerId,
        entityOwnerNo: input.customerNo || undefined,
        reason: input.reason || undefined,
        metadata: input.detail,
        sourcePlatform: 'APPLICATION',
      },
      {
        actorType:
          String(input.actorRole || '').trim().toUpperCase() === 'CUSTOMER'
            ? 'CUSTOMER'
            : 'ADMIN',
        actorId: input.actorId,
        actorRole: input.actorRole,
      },
    );
  }

  private async ensurePendingApproval(
    client: ApprovalWriteClient,
    customer: FinalApprovalCustomerRow,
    actor: ApprovalActorContext,
    reason?: string | null,
  ): Promise<PendingApprovalResolution> {
    const linked = await this.findLinkedApproval(client, customer);
    if (
      linked &&
      linked.actionType === ApprovalActionTypes.ONBOARDING_FINAL_APPROVAL &&
      linked.entityRef === customer.id
    ) {
      if (linked.status === ApprovalStatuses.PENDING) {
        return {
          approval: this.toApprovalSummary(linked),
          created: false,
          auditAction: 'FINAL_APPROVAL_SUBMITTED',
        };
      }

      if (!this.isRetryableApprovalStatus(linked.status)) {
        throw new ConflictException(
          `Final approval is already ${linked.status} for customer ${customer.customerNo || customer.id}.`,
        );
      }
    }

    const existingPending = await this.findPendingApprovalByEntity(client, customer.id);
    if (existingPending) {
      return {
        approval: this.toApprovalSummary(existingPending),
        created: false,
        auditAction:
          linked && this.isRetryableApprovalStatus(linked.status)
            ? 'FINAL_APPROVAL_RESUBMITTED'
            : 'FINAL_APPROVAL_SUBMITTED',
      };
    }

    const traceCtx = this.buildTraceContext(customer.id);
    const created = await this.approvalsService.createAndSubmit(
      {
        actionType: ApprovalActionTypes.ONBOARDING_FINAL_APPROVAL,
        entityRef: customer.id,
        traceId: traceCtx?.traceId || undefined,
        objectSnapshot: {
          source: 'WAVE3_PHASE4_ONBOARDING',
          customerId: customer.id,
          customerNo: customer.customerNo || null,
          journeyId: customer.id,
        },
      },
      {
        reason:
          this.normalizeOptionalString(reason) ||
          `Final approval submitted for customer ${customer.customerNo || customer.id}`,
      },
      actor,
      client,
      { emitSideEffects: false },
    );

    return {
      approval: this.toApprovalSummary(created),
      created: true,
      auditAction:
        linked && this.isRetryableApprovalStatus(linked.status)
          ? 'FINAL_APPROVAL_RESUBMITTED'
          : 'FINAL_APPROVAL_SUBMITTED',
    };
  }

  async ensurePendingApprovalInTransaction(
    tx: Prisma.TransactionClient,
    input: {
      customer: FinalApprovalCustomerRow;
      actorId: string;
      actorRole: string;
      reason?: string | null;
    },
  ): Promise<PendingApprovalResolution> {
    return this.ensurePendingApproval(
      tx,
      input.customer,
      this.toActorContext(input.actorId, input.actorRole),
      input.reason,
    );
  }

  async submitFinalApproval(
    customerId: string,
    actorId: string,
    actorRole: string,
    dto?: SubmitFinalApprovalDto,
  ) {
    const actor = this.toActorContext(actorId, actorRole);
    const reason = this.normalizeOptionalString(dto?.reason);

    const result = await this.prisma.$transaction(async (tx) => {
      const customer = await this.getCustomerOrThrow(customerId, tx);
      this.assertCustomerInFinalApproval(customer);

      const resolved = await this.ensurePendingApproval(tx, customer, actor, reason);

      await tx.customerMain.update({
        where: { id: customer.id },
        data: {
          ...this.buildLatestRiskApprovalBindingPatch(resolved.approval.id),
          latestRiskApprovalStatus: resolved.approval.status,
        },
      });

      await this.writeCanonicalAudit({
        customerId: customer.id,
        customerNo: customer.customerNo || null,
        action: resolved.auditAction,
        actorId,
        actorRole,
        reason,
        fromStage: 'FINAL_APPROVAL',
        toStage: 'FINAL_APPROVAL',
        journeyId: customer.id,
        detail: {
          approvalId: resolved.approval.id,
          approvalNo: resolved.approval.approvalNo,
          status: resolved.approval.status,
          reason,
        },
      });

      return resolved;
    });

    if (result.created) {
      await this.approvalsService.emitSubmittedSideEffects(
        result.approval.id,
        actor,
        reason || `Final approval submitted for customer ${customerId}`,
      );
    }

    return this.approvalsService.getById(result.approval.id, actor);
  }

  async emitSubmittedSideEffects(
    approvalId: string,
    actorId: string,
    actorRole: string,
    reason?: string | null,
  ) {
    await this.approvalsService.emitSubmittedSideEffects(
      approvalId,
      this.toActorContext(actorId, actorRole),
      this.normalizeOptionalString(reason),
    );
  }

  async proxyFinalDecision(
    customerId: string,
    actorId: string,
    actorRole: string,
    dto: FinalReviewCustomerDto,
  ) {
    const customer = await this.getCustomerOrThrow(customerId);
    this.assertCustomerInFinalApproval(customer);

    const linked = await this.findLinkedApproval(this.prisma, customer);
    const pending =
      linked &&
      linked.actionType === ApprovalActionTypes.ONBOARDING_FINAL_APPROVAL &&
      linked.entityRef === customer.id &&
      linked.status === ApprovalStatuses.PENDING
        ? linked
        : await this.findPendingApprovalByEntity(this.prisma, customer.id);

    if (!pending) {
      throw new BadRequestException(
        'No pending final approval found. Submit final approval before making a decision.',
      );
    }

    const actor = this.toActorContext(actorId, actorRole);
    if (dto.decision === 'APPROVE') {
      return this.approvalsService.approve(
        pending.id,
        {
          reason: this.normalizeOptionalString(dto.reason) || undefined,
        },
        actor,
      );
    }

    return this.approvalsService.reject(
      pending.id,
      {
        reason: this.normalizeOptionalString(dto.reason) || undefined,
      },
      actor,
    );
  }

  private buildLifecycleProjection(
    customer: FinalApprovalCustomerRow,
    event: ApprovalDecisionEvent,
  ): Prisma.CustomerMainUpdateInput {
    const status = String(event.status || '').trim().toUpperCase();
    if (status === ApprovalStatuses.APPROVED) {
      return {
        ...buildCustomerLifecycleStatePatch(customer, {
          onboardingStatus: 'APPROVED',
          adminStatus: 'ACTIVE',
          eddRequired: true,
        }),
        ...this.buildLatestRiskApprovalBindingPatch(event.approvalId),
        latestRiskApprovalStatus: ApprovalStatuses.APPROVED,
      };
    }

    if (status === ApprovalStatuses.REJECTED) {
      return {
        ...buildCustomerLifecycleStatePatch(customer, {
          onboardingStatus: 'REJECTED',
          adminStatus: 'INACTIVE',
          eddRequired: true,
        }),
        ...this.buildLatestRiskApprovalBindingPatch(event.approvalId),
        latestRiskApprovalStatus: ApprovalStatuses.REJECTED,
      };
    }

    return {
      ...this.buildLatestRiskApprovalBindingPatch(event.approvalId),
      latestRiskApprovalStatus: status,
    };
  }

  private async writeProjectionAudit(
    customerId: string,
    customerNo: string | null | undefined,
    journeyId: string | null | undefined,
    action: string,
    actorId: string,
    actorRole: string,
    detail: Record<string, unknown>,
  ) {
    const traceContext = this.buildTraceContext(journeyId);
    await this.writeCanonicalAudit({
      customerId,
      customerNo,
      action,
      actorId,
      actorRole,
      journeyId,
      reason: this.normalizeOptionalString(detail.decisionReason),
      fromStage: 'FINAL_APPROVAL',
      toStage:
        action === 'FINAL_APPROVAL_APPROVED'
          ? 'APPROVED'
          : action === 'FINAL_APPROVAL_REJECTED'
            ? 'REJECTED'
            : 'FINAL_APPROVAL',
      detail,
    });
  }

  private async syncApprovalProjectionByEvent(event: ApprovalDecisionEvent) {
    if (event.actionType !== ApprovalActionTypes.ONBOARDING_FINAL_APPROVAL) {
      return null;
    }

    const customer = await this.getCustomerOrThrow(event.entityRef).catch(() => null);
    if (!customer) {
      return null;
    }

    if (
      customer.latestRiskApprovalId &&
      customer.latestRiskApprovalId !== event.approvalId
    ) {
      return customer;
    }

    const normalizedStatus = String(event.status || '').trim().toUpperCase();
    const actor = this.toProjectionActor(event);

    try {
      const updated = await this.prisma.customerMain.update({
        where: { id: customer.id },
        data: this.buildLifecycleProjection(customer, event),
      });

      const auditAction =
        normalizedStatus === ApprovalStatuses.APPROVED
          ? 'FINAL_APPROVAL_APPROVED'
          : normalizedStatus === ApprovalStatuses.REJECTED
            ? 'FINAL_APPROVAL_REJECTED'
            : normalizedStatus === ApprovalStatuses.CANCELLED
              ? 'FINAL_APPROVAL_CANCELLED'
              : 'FINAL_APPROVAL_EXPIRED';

      await this.writeProjectionAudit(
        customer.id,
        customer.customerNo || null,
        customer.id,
        auditAction,
        actor.userId,
        actor.role || 'SYSTEM',
        {
          approvalId: event.approvalId,
          approvalNo: event.approvalNo,
          status: normalizedStatus,
          decisionReason: this.normalizeOptionalString(event.decisionReason),
        },
      );

      if (normalizedStatus === ApprovalStatuses.APPROVED) {
        // Set riskRating based on level: level2 → HIGH, else → LOW
        const level = updated.sumsubCurrentLevelName || 'wave3-level-1';
        const defaultTier = level.includes('level-2') || level.includes('level2') ? 'HIGH' : 'LOW';
        await this.prisma.customerMain.update({
          where: { id: updated.id },
          data: { riskRating: defaultTier, riskRatingUpdatedAt: new Date() },
        });

        // Seed initial material holdings
        if (this.materialRefreshService) {
          try {
            await this.materialRefreshService.seedInitialHoldings(updated.id, level);
          } catch (err) {
            this.logger.error(`Failed to seed holdings for ${updated.id}:`, err);
          }
        }
      }

      return updated;
    } catch (error) {
      this.logger.error(
        `Failed to project onboarding final approval ${event.approvalNo} to customer ${event.entityRef}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw error;
    }
  }

  @OnEvent(ApprovalEvents.APPROVED, { async: true })
  async onApprovalApproved(event: ApprovalDecisionEvent) {
    return this.syncApprovalProjectionByEvent(event);
  }

  @OnEvent(ApprovalEvents.REJECTED, { async: true })
  async onApprovalRejected(event: ApprovalDecisionEvent) {
    return this.syncApprovalProjectionByEvent(event);
  }

  @OnEvent(ApprovalEvents.CANCELLED, { async: true })
  async onApprovalCancelled(event: ApprovalDecisionEvent) {
    return this.syncApprovalProjectionByEvent(event);
  }

  @OnEvent(ApprovalEvents.EXPIRED, { async: true })
  async onApprovalExpired(event: ApprovalDecisionEvent) {
    return this.syncApprovalProjectionByEvent(event);
  }
}
