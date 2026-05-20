import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  InternalServerErrorException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { randomUUID } from 'crypto';
import { generateReferenceNo } from '../../../common/utils/no-generator.util';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import {
  AuditActions,
  AuditEntityTypes,
} from '../../audit-logging/constants/audit-actions.constant';
import {
  AuditResult,
} from '../../audit-logging/dto/audit-log.dto';
import { ApprovalPolicyService } from './approval-policy.service';
import {
  ApprovalActorContext,
  ApprovalDecisionEvent,
  ApprovalEvents,
  ApprovalStatuses,
  ApprovalStepStatuses,
  isSuperAdminRoleContext,
  splitRoleCsv,
} from './constants/approval.constants';
import {
  ApprovalQueryDto,
  CancelApprovalDto,
  CreateApprovalDto,
  DecisionApprovalDto,
  SubmitApprovalDto,
} from './dto/approval.dto';

type ApprovalWriteClient = any;
type ApprovalCaseRow = {
  [key: string]: any;
  steps: Array<Record<string, any>>;
  evidencePackage: {
    id: string;
    packageNo: string;
    status: string;
  } | null;
};

interface ApprovalRequirementInput {
  actionType: string;
  entityRef: string;
  approvalCaseId?: string | null;
  actor?: ApprovalActorContext;
  traceId?: string | null;
}

@Injectable()
export class ApprovalsService {
  private static readonly DEFAULT_TAKE = 20;
  private static readonly MAX_NO_RETRIES = 10;

  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService & Record<string, any>,
    private readonly auditLogsService: AuditLogsService,
    private readonly approvalPolicyService: ApprovalPolicyService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  private getDb(client?: ApprovalWriteClient): ApprovalWriteClient {
    return client ?? this.prisma;
  }

  private normalizeOptionalString(value: unknown): string | null {
    if (value === null || value === undefined) return null;
    const normalized = String(value).trim();
    return normalized.length ? normalized : null;
  }

  private normalizeTake(take?: number): number {
    if (!take || take < 1) return ApprovalsService.DEFAULT_TAKE;
    return Math.min(take, 200);
  }

  private normalizeSkip(skip?: number): number {
    if (!skip || skip < 0) return 0;
    return skip;
  }

  private toAuditActor(actor: ApprovalActorContext) {
    return {
      actorType: actor.actorType,
      actorId: actor.userId,
      actorNo: actor.userNo,
      actorRole: actor.role || actor.roleCodes[0] || 'UNKNOWN',
    };
  }

  private systemActor(): ApprovalActorContext {
    return {
      actorType: 'ADMIN',
      userId: 'SYSTEM',
      userNo: 'SYSTEM',
      role: 'SYSTEM',
      roleCodes: ['SYSTEM'],
    };
  }

  private isSuperAdmin(actor?: ApprovalActorContext | null): boolean {
    return !!actor && isSuperAdminRoleContext(actor.roleCodes);
  }

  private async recordAudit(
    action: string,
    approval: ApprovalCaseRow,
    actor: ApprovalActorContext,
    result: AuditResult,
    reason?: string | null,
    metadata?: Record<string, unknown>,
  ) {
    await this.auditLogsService.recordByActor(
      {
        action,
        entityType: AuditEntityTypes.APPROVAL_CASE,
        entityId: approval.id,
        entityNo: approval.approvalNo,
        traceId: approval.traceId,
        result,
        reason: reason || undefined,
        metadata: {
          approvalNo: approval.approvalNo,
          actionType: approval.actionType,
          entityRef: approval.entityRef,
          ...(metadata || {}),
        },
        requestId: `APPROVAL_${approval.approvalNo}_${action}`,
        sourcePlatform: 'ADMIN_API',
      },
      this.toAuditActor(actor),
    );
  }

  private buildEventPayload(approval: ApprovalCaseRow): ApprovalDecisionEvent {
    const decidedStep = [...(approval.steps || [])]
      .sort((a: any, b: any) => b.stepNo - a.stepNo)
      .find((s: any) => s.status !== ApprovalStepStatuses.PENDING);

    return {
      approvalId: approval.id,
      approvalNo: approval.approvalNo,
      actionType: approval.actionType,
      entityRef: approval.entityRef,
      traceId: approval.traceId,
      status: approval.status,
      decisionByUserId: decidedStep?.decidedByUserId || null,
      decisionByUserNo: decidedStep?.decidedByUserNo || null,
      decisionByRole: decidedStep?.decidedByRole || null,
      decisionReason: decidedStep?.reason || null,
      decidedAt: decidedStep?.decidedAt ? decidedStep.decidedAt.toISOString() : null,
    };
  }

  private async emitApprovalEvent(eventName: string, payload: ApprovalDecisionEvent) {
    if (typeof this.eventEmitter.emitAsync === 'function') {
      await this.eventEmitter.emitAsync(eventName, payload);
      return;
    }

    this.eventEmitter.emit(eventName, payload);
  }

  private async projectGovernanceApprovalDecision(_approval: ApprovalCaseRow) {
    // No-op: CT removed. Future workflow projections go here.
  }

  private assertTraceConsistency(
    existingTraceId: string,
    incomingTraceId?: string | null,
  ) {
    const normalizedTraceId = this.normalizeOptionalString(incomingTraceId);
    if (normalizedTraceId && normalizedTraceId !== existingTraceId) {
      throw new BadRequestException('traceId does not match the existing approval chain');
    }
  }

  private async findCaseOrThrow(
    id: string,
    client?: ApprovalWriteClient,
  ): Promise<ApprovalCaseRow> {
    const db = this.getDb(client);
    const found = await db.approvalCase.findUnique({
      where: { id },
      include: {
        steps: {
          orderBy: { stepNo: 'asc' },
        },
        evidencePackage: {
          select: {
            id: true,
            packageNo: true,
            status: true,
          },
        },
      },
    });

    if (!found) {
      throw new NotFoundException(`Approval case not found: ${id}`);
    }

    return found as ApprovalCaseRow;
  }

  private isUniqueConflict(error: unknown, field: string): boolean {
    const maybe = error as {
      code?: string;
      meta?: { target?: string[] | string };
    };
    if (maybe?.code !== 'P2002') return false;

    const target = maybe.meta?.target;
    if (Array.isArray(target)) return target.includes(field);
    if (typeof target === 'string') return target.includes(field);
    return false;
  }

  private approvalInclude() {
    return {
      steps: {
        orderBy: { stepNo: 'asc' as const },
      },
      evidencePackage: {
        select: {
          id: true,
          packageNo: true,
          status: true,
        },
      },
    };
  }

  private async createCaseWithUniqueNo(
    data: Record<string, any>,
    client?: ApprovalWriteClient,
  ): Promise<ApprovalCaseRow> {
    const db = this.getDb(client);
    for (let i = 0; i < ApprovalsService.MAX_NO_RETRIES; i += 1) {
      try {
        const approvalNo = generateReferenceNo('APR');
        const stepsPayload = data.steps;
        return (await db.approvalCase.create({
          data: {
            ...data,
            approvalNo,
            steps: stepsPayload,
          },
          include: this.approvalInclude(),
        })) as ApprovalCaseRow;
      } catch (error) {
        if (this.isUniqueConflict(error, 'approvalNo')) continue;
        throw error;
      }
    }

    throw new InternalServerErrorException(
      `Failed to generate unique approvalNo after ${ApprovalsService.MAX_NO_RETRIES} attempts`,
    );
  }

  private mapApproval(approval: ApprovalCaseRow, actor?: ApprovalActorContext) {
    const cancellableStatuses = new Set<string>([
      ApprovalStatuses.DRAFT,
      ApprovalStatuses.PENDING,
    ]);
    const pendingStep = (approval.steps || []).find(
      (s: any) => s.status === ApprovalStepStatuses.PENDING,
    );
    const stepRoles = pendingStep
      ? splitRoleCsv(pendingStep.checkerRoleCandidates)
      : [];
    const availableDecisionRoles = actor
      ? this.isSuperAdmin(actor)
        ? stepRoles
        : stepRoles.filter((role) => actor.roleCodes.includes(role))
      : [];
    const makerCheckerConflict = actor
      ? !this.isSuperAdmin(actor) &&
        actor.userId === approval.createdByUserId &&
        availableDecisionRoles.length > 0
      : false;
    const crossStepConflict = actor
      ? this.hasActorApprovedAnyStep(approval.steps || [], actor.userId)
      : false;
    const canDecide =
      approval.status === ApprovalStatuses.PENDING &&
      !!pendingStep &&
      availableDecisionRoles.length > 0 &&
      !makerCheckerConflict &&
      !crossStepConflict;

    return {
      id: approval.id,
      approvalNo: approval.approvalNo,
      actionType: approval.actionType,
      entityRef: approval.entityRef,
      createdByUserId: approval.createdByUserId,
      createdByUserNo: approval.createdByUserNo || null,
      status: approval.status,
      objectSnapshot: approval.objectSnapshot ? JSON.parse(approval.objectSnapshot as string) : null,
      traceId: approval.traceId,
      submittedAt: approval.submittedAt,
      timeoutAt: approval.timeoutAt,
      createdAt: approval.createdAt,
      updatedAt: approval.updatedAt,
      availableDecisionRoles,
      canApprove: canDecide,
      canReject: canDecide,
      canCancel:
        !!actor &&
        approval.allowCancel &&
        (actor.userId === approval.createdByUserId || this.isSuperAdmin(actor)) &&
        cancellableStatuses.has(approval.status),
    };
  }

  private async mapApprovalsForReadModel(
    approvals: ApprovalCaseRow[],
    actor?: ApprovalActorContext,
  ) {
    return approvals.map((approval) => {
      const allSteps = (approval.steps || [])
        .sort((a: any, b: any) => a.stepNo - b.stepNo)
        .map((s: any) => ({
          id: s.id,
          stepNo: s.stepNo,
          status: s.status,
          checkerRoleCandidates: splitRoleCsv(s.checkerRoleCandidates),
          decidedByUserNo: s.decidedByUserNo || null,
          decidedByRole: s.decidedByRole,
          reason: s.reason,
          decidedAt: s.decidedAt,
          createdAt: s.createdAt,
          updatedAt: s.updatedAt,
        }));
      const currentStep = allSteps.find((s: any) => s.status === 'PENDING') || allSteps[0] || null;

      return {
        ...this.mapApproval(approval, actor),
        allowCancel: approval.allowCancel,
        step: currentStep,
        steps: allSteps,
        evidencePackage: approval.evidencePackage,
      };
    });
  }

  private hasActorApprovedAnyStep(steps: any[], userId: string): boolean {
    return steps.some(
      (s) => s.status === ApprovalStepStatuses.APPROVED && s.decidedByUserId === userId,
    );
  }

  private async resolveDecisionRole(
    approval: ApprovalCaseRow,
    actor: ApprovalActorContext,
    requestedRole?: string,
    stepCandidateRoles?: string[],
  ): Promise<string> {
    const normalizedRequestedRole = this.normalizeOptionalString(requestedRole);
    const allowedRoles = stepCandidateRoles || [];
    const actorRoles = Array.from(new Set(actor.roleCodes.map((item) => String(item).trim())));
    const superAdminBypass = this.isSuperAdmin(actor);
    const intersection = superAdminBypass
      ? allowedRoles
      : allowedRoles.filter((role) => actorRoles.includes(role));

    if (!intersection.length) {
      throw new ForbiddenException('Current admin roles are not allowed to decide this approval');
    }

    if (
      !superAdminBypass &&
      actor.userId === approval.createdByUserId &&
      (await this.approvalPolicyService.isSameUserMakerCheckerDenied())
    ) {
      throw new ForbiddenException('Maker and checker must be different users');
    }

    if (approval.steps && this.hasActorApprovedAnyStep(approval.steps, actor.userId)) {
      throw new ConflictException('Same user cannot approve multiple steps of the same case');
    }

    if (normalizedRequestedRole) {
      if (!intersection.includes(normalizedRequestedRole)) {
        throw new ForbiddenException(
          `checkerRole ${normalizedRequestedRole} is not available for the current admin`,
        );
      }
      return normalizedRequestedRole;
    }

    if (intersection.length === 1) {
      return intersection[0];
    }

    const currentPrimaryRole = this.normalizeOptionalString(actor.role);
    if (currentPrimaryRole && intersection.includes(currentPrimaryRole)) {
      return currentPrimaryRole;
    }

    throw new BadRequestException(
      `Multiple checker roles are available (${intersection.join(', ')}). Provide checkerRole explicitly.`,
    );
  }

  private async createDraftCase(
    dto: CreateApprovalDto,
    actor: ApprovalActorContext,
    client?: ApprovalWriteClient,
  ): Promise<ApprovalCaseRow> {
    const db = this.getDb(client);
    const actionType = String(dto.actionType || '').trim().toUpperCase();
    const entityRef = String(dto.entityRef || '').trim();

    if (!actionType) {
      throw new BadRequestException('actionType is required');
    }
    if (!entityRef) {
      throw new BadRequestException('entityRef is required');
    }

    const existingPending = await db.approvalCase.findFirst({
      where: {
        actionType,
        entityRef,
        status: ApprovalStatuses.PENDING,
      },
      include: this.approvalInclude(),
      orderBy: { createdAt: 'desc' },
    });

    if (existingPending) {
      this.assertTraceConsistency(existingPending.traceId, dto.traceId);
      return existingPending as ApprovalCaseRow;
    }

    const policy = await this.approvalPolicyService.getPolicy(actionType);
    if (!policy.steps.length) {
      throw new BadRequestException(`No steps configured for actionType ${actionType}`);
    }

    return this.createCaseWithUniqueNo(
      {
        actionType,
        entityRef,
        createdByUserId: actor.userId,
        createdByUserNo: this.normalizeOptionalString(actor.userNo),
        status: ApprovalStatuses.DRAFT,
        allowCancel: policy.allowCancel,
        objectSnapshot: dto.objectSnapshot ? JSON.stringify(dto.objectSnapshot) : null,
        traceId: this.normalizeOptionalString(dto.traceId) || randomUUID(),
        steps: {
          create: policy.steps.map((step) => ({
            stepNo: step.stepNo,
            status: ApprovalStepStatuses.PENDING,
            checkerRoleCandidates: step.roles.join(','),
          })),
        },
      },
      client,
    );
  }

  private async submitCase(
    id: string,
    dto: SubmitApprovalDto,
    actor: ApprovalActorContext,
    client?: ApprovalWriteClient,
  ): Promise<ApprovalCaseRow> {
    const db = this.getDb(client);
    const approval = await this.findCaseOrThrow(id, client);
    if (approval.createdByUserId !== actor.userId) {
      throw new ForbiddenException('Only the maker can submit this approval');
    }
    if (approval.status !== ApprovalStatuses.DRAFT) {
      throw new BadRequestException('Only DRAFT approvals can be submitted');
    }

    this.assertTraceConsistency(approval.traceId, dto.traceId);

    const policy = await this.approvalPolicyService.getPolicy(approval.actionType);
    const now = new Date();
    const timeoutAt = new Date(now.getTime() + policy.timeoutHours * 60 * 60 * 1000);

    // NOTE: stepNo: 1 is intentional — submit always activates the first step.
    // Do not change to dynamic lookup.
    await db.approvalStep.update({
      where: {
        approvalCaseId_stepNo: {
          approvalCaseId: approval.id,
          stepNo: 1,
        },
      },
      data: {
        status: ApprovalStepStatuses.PENDING,
      },
    });

    const next = await db.approvalCase.update({
      where: { id: approval.id },
      data: {
        status: ApprovalStatuses.PENDING,
        submittedAt: now,
        timeoutAt,
      },
      include: this.approvalInclude(),
    });

    return next as ApprovalCaseRow;
  }

  async emitSubmittedSideEffects(
    approvalId: string,
    actor: ApprovalActorContext,
    reason?: string | null,
  ) {
    const approval = await this.findCaseOrThrow(approvalId);
    await this.recordAudit(
      AuditActions.APPROVAL_SUBMITTED,
      approval,
      actor,
      AuditResult.SUCCESS,
      reason || 'Approval submitted',
      {
        timeoutAt: approval.timeoutAt?.toISOString(),
      },
    );
    await this.emitApprovalEvent(ApprovalEvents.SUBMITTED, this.buildEventPayload(approval));
    return this.mapApproval(approval, actor);
  }

  async createAndSubmit(
    createDto: CreateApprovalDto,
    submitDto: SubmitApprovalDto,
    actor: ApprovalActorContext,
    client?: ApprovalWriteClient,
    options?: { emitSideEffects?: boolean },
  ) {
    const created = await this.createDraftCase(createDto, actor, client);
    const submitted =
      created.status === ApprovalStatuses.PENDING
        ? created
        : await this.submitCase(created.id, submitDto, actor, client);

    if (options?.emitSideEffects !== false && submitted.status === ApprovalStatuses.PENDING) {
      await this.recordAudit(
        AuditActions.APPROVAL_SUBMITTED,
        submitted,
        actor,
        AuditResult.SUCCESS,
        submitDto.reason || 'Approval submitted',
        {
          timeoutAt: submitted.timeoutAt?.toISOString(),
        },
      );
      await this.emitApprovalEvent(ApprovalEvents.SUBMITTED, this.buildEventPayload(submitted));
    }

    return this.mapApproval(submitted, actor);
  }

  async create(dto: CreateApprovalDto, actor: ApprovalActorContext) {
    const created = await this.createDraftCase(dto, actor);
    return this.mapApproval(created as ApprovalCaseRow, actor);
  }

  async submit(id: string, dto: SubmitApprovalDto, actor: ApprovalActorContext) {
    const updated = await this.prisma.$transaction((tx: any) =>
      this.submitCase(id, dto, actor, tx),
    );
    await this.emitSubmittedSideEffects(updated.id, actor, dto.reason);
    return this.mapApproval(updated, actor);
  }

  async approve(id: string, dto: DecisionApprovalDto, actor: ApprovalActorContext) {
    const updated = await this.prisma.$transaction(async (tx: any) => {
      const approval = await this.findCaseOrThrow(id, tx);
      if (approval.status !== ApprovalStatuses.PENDING) {
        throw new BadRequestException('Only PENDING approvals can be approved');
      }
      this.assertTraceConsistency(approval.traceId, dto.traceId);

      // Find the FIRST pending step (enforce sequential ordering — no step skipping)
      const firstPendingStep = (approval.steps || []).find(
        (s: any) => s.status === ApprovalStepStatuses.PENDING,
      );
      if (!firstPendingStep) {
        throw new ForbiddenException('No pending steps available');
      }
      const canAct =
        splitRoleCsv(firstPendingStep.checkerRoleCandidates).some((candidate: string) =>
          (actor.roleCodes || []).includes(candidate),
        ) || this.isSuperAdmin(actor);
      if (!canAct) {
        throw new ForbiddenException(
          `Actor role ${(actor.roleCodes || []).join(',')} cannot sign the current pending step (step ${firstPendingStep.stepNo})`,
        );
      }
      const currentStep = firstPendingStep;

      const stepCandidateRoles = splitRoleCsv(currentStep.checkerRoleCandidates);
      const decisionRole = await this.resolveDecisionRole(approval, actor, dto.checkerRole, stepCandidateRoles);
      const now = new Date();

      await tx.approvalStep.update({
        where: {
          approvalCaseId_stepNo: {
            approvalCaseId: approval.id,
            stepNo: currentStep.stepNo,
          },
        },
        data: {
          status: ApprovalStepStatuses.APPROVED,
          decidedByUserId: actor.userId,
          decidedByUserNo: this.normalizeOptionalString(actor.userNo),
          decidedByRole: decisionRole,
          reason: this.normalizeOptionalString(dto.reason),
          decidedAt: now,
        },
      });

      // Check for any remaining pending steps with higher stepNo
      const hasNextPending = (approval.steps || []).some(
        (s: any) =>
          s.stepNo > currentStep.stepNo &&
          s.status === ApprovalStepStatuses.PENDING,
      );

      if (hasNextPending) {
        // Mid-flow: case stays PENDING, reload to get updated steps
        return tx.approvalCase.findUnique({
          where: { id: approval.id },
          include: this.approvalInclude(),
        }) as Promise<ApprovalCaseRow>;
      }

      // Last step: case APPROVED
      return tx.approvalCase.update({
        where: { id: approval.id },
        data: {
          status: ApprovalStatuses.APPROVED,
        },
        include: this.approvalInclude(),
      }) as Promise<ApprovalCaseRow>;
    });

    await this.recordAudit(
      AuditActions.APPROVAL_APPROVED,
      updated,
      actor,
      AuditResult.SUCCESS,
      dto.reason || 'Approval approved',
      this.isSuperAdmin(actor) && actor.userId === updated.createdByUserId
        ? { superAdminBypass: true }
        : undefined,
    );
    if (updated.status === ApprovalStatuses.APPROVED) {
      await this.projectGovernanceApprovalDecision(updated);
      await this.emitApprovalEvent(ApprovalEvents.APPROVED, this.buildEventPayload(updated));
    }
    return this.mapApproval(updated, actor);
  }

  async reject(id: string, dto: DecisionApprovalDto, actor: ApprovalActorContext) {
    const updated = await this.prisma.$transaction(async (tx: any) => {
      const approval = await this.findCaseOrThrow(id, tx);
      if (approval.status !== ApprovalStatuses.PENDING) {
        throw new BadRequestException('Only PENDING approvals can be rejected');
      }
      this.assertTraceConsistency(approval.traceId, dto.traceId);

      // Find the FIRST pending step (enforce sequential ordering)
      const firstPendingStep = (approval.steps || []).find(
        (s: any) => s.status === ApprovalStepStatuses.PENDING,
      );
      if (!firstPendingStep) {
        throw new ForbiddenException('No pending steps available');
      }
      const canAct =
        splitRoleCsv(firstPendingStep.checkerRoleCandidates).some((candidate: string) =>
          (actor.roleCodes || []).includes(candidate),
        ) || this.isSuperAdmin(actor);
      if (!canAct) {
        throw new ForbiddenException(
          `Actor role ${(actor.roleCodes || []).join(',')} cannot reject the current pending step (step ${firstPendingStep.stepNo})`,
        );
      }
      const currentStep = firstPendingStep;

      const stepCandidateRoles = splitRoleCsv(currentStep.checkerRoleCandidates);
      const decisionRole = await this.resolveDecisionRole(approval, actor, dto.checkerRole, stepCandidateRoles);
      const now = new Date();

      // Reject the current step
      await tx.approvalStep.update({
        where: {
          approvalCaseId_stepNo: {
            approvalCaseId: approval.id,
            stepNo: currentStep.stepNo,
          },
        },
        data: {
          status: ApprovalStepStatuses.REJECTED,
          decidedByUserId: actor.userId,
          decidedByUserNo: this.normalizeOptionalString(actor.userNo),
          decidedByRole: decisionRole,
          reason: this.normalizeOptionalString(dto.reason),
          decidedAt: now,
        },
      });

      // Cancel any remaining pending steps
      await tx.approvalStep.updateMany({
        where: {
          approvalCaseId: approval.id,
          status: ApprovalStepStatuses.PENDING,
        },
        data: { status: ApprovalStepStatuses.CANCELLED },
      });

      // Case REJECTED immediately
      return tx.approvalCase.update({
        where: { id: approval.id },
        data: {
          status: ApprovalStatuses.REJECTED,
        },
        include: this.approvalInclude(),
      }) as Promise<ApprovalCaseRow>;
    });

    await this.recordAudit(
      AuditActions.APPROVAL_REJECTED,
      updated,
      actor,
      AuditResult.SUCCESS,
      dto.reason || 'Approval rejected',
      this.isSuperAdmin(actor) && actor.userId === updated.createdByUserId
        ? { superAdminBypass: true }
        : undefined,
    );
    await this.projectGovernanceApprovalDecision(updated);
    await this.emitApprovalEvent(ApprovalEvents.REJECTED, this.buildEventPayload(updated));
    return this.mapApproval(updated, actor);
  }

  async cancel(id: string, dto: CancelApprovalDto, actor: ApprovalActorContext) {
    let previousStatus: string = ApprovalStatuses.DRAFT;
    const updated = await this.prisma.$transaction(async (tx: any) => {
      const approval = await this.findCaseOrThrow(id, tx);
      if (approval.createdByUserId !== actor.userId && !this.isSuperAdmin(actor)) {
        throw new ForbiddenException('Only the maker can cancel this approval');
      }
      if (!approval.allowCancel) {
        throw new ForbiddenException('This approval policy does not allow cancellation');
      }
      if (
        !new Set<string>([ApprovalStatuses.DRAFT, ApprovalStatuses.PENDING]).has(
          approval.status,
        )
      ) {
        throw new BadRequestException('Only DRAFT or PENDING approvals can be cancelled');
      }

      this.assertTraceConsistency(approval.traceId, dto.traceId);
      previousStatus = approval.status;
      const now = new Date();

      // Cancel ALL remaining PENDING steps (preserves already-APPROVED steps)
      await tx.approvalStep.updateMany({
        where: {
          approvalCaseId: approval.id,
          status: ApprovalStepStatuses.PENDING,
        },
        data: {
          status: ApprovalStepStatuses.CANCELLED,
          decidedByUserId: actor.userId,
          decidedByUserNo: this.normalizeOptionalString(actor.userNo),
          reason: this.normalizeOptionalString(dto.reason),
          decidedAt: now,
        },
      });

      const next = await tx.approvalCase.update({
        where: { id: approval.id },
        data: {
          status: ApprovalStatuses.CANCELLED,
        },
        include: this.approvalInclude(),
      });

      return next as ApprovalCaseRow;
    });

    await this.recordAudit(
      AuditActions.APPROVAL_CANCELLED,
      updated,
      actor,
      AuditResult.SUCCESS,
      dto.reason || 'Approval cancelled',
      this.isSuperAdmin(actor) && actor.userId !== updated.createdByUserId
        ? { superAdminBypass: true }
        : undefined,
    );
    await this.projectGovernanceApprovalDecision(updated);
    await this.emitApprovalEvent(ApprovalEvents.CANCELLED, this.buildEventPayload(updated));
    return this.mapApproval(updated, actor);
  }

  async requireApproved(input: ApprovalRequirementInput) {
    const approval = input.approvalCaseId
      ? await this.findCaseOrThrow(input.approvalCaseId)
      : ((await this.prisma.approvalCase.findFirst({
          where: {
            actionType: input.actionType,
            entityRef: input.entityRef,
          },
          include: this.approvalInclude(),
          orderBy: { createdAt: 'desc' },
        })) as ApprovalCaseRow | null);

    if (!approval) {
      if (input.actor) {
        await this.auditLogsService.recordByActor(
          {
            action: AuditActions.APPROVAL_REQUIRED_MISSING,
            entityType: AuditEntityTypes.APPROVAL_CASE,
            entityId: input.entityRef,
            entityNo: input.entityRef,
            result: AuditResult.REJECTED,
            reason: `Approval is required for ${input.actionType}:${input.entityRef}`,
            requestId: `APPROVAL_REQUIRED_${input.actionType}_${input.entityRef}`,
            sourcePlatform: 'ADMIN_API',
          },
          this.toAuditActor(input.actor),
        );
      }
      throw new ForbiddenException('Approval is required before this action can continue');
    }

    if (approval.actionType !== input.actionType || approval.entityRef !== input.entityRef) {
      throw new BadRequestException('Approval case does not match the requested action/entity');
    }
    if (input.traceId) {
      this.assertTraceConsistency(approval.traceId, input.traceId);
    }
    if (approval.status !== ApprovalStatuses.APPROVED) {
      throw new ForbiddenException(
        `Approval case ${approval.approvalNo} is ${approval.status} and cannot authorize this action`,
      );
    }

    return this.mapApproval(approval, input.actor);
  }

  async getById(id: string, actor?: ApprovalActorContext) {
    const approval = await this.findCaseOrThrow(id);
    const [mapped] = await this.mapApprovalsForReadModel([approval], actor);
    return mapped;
  }

  async list(query: ApprovalQueryDto, actor?: ApprovalActorContext) {
    const skip = this.normalizeSkip(query.skip);
    const take = this.normalizeTake(query.take);
    const where: Record<string, any> = {};

    if (query.actionType) where.actionType = String(query.actionType).trim().toUpperCase();
    if (query.status) where.status = String(query.status).trim().toUpperCase();
    if (query.approvalNo) where.approvalNo = query.approvalNo.trim();
    if (query.entityRef) where.entityRef = query.entityRef.trim();
    if (query.traceId) where.traceId = query.traceId.trim();
    if (query.keyword) {
      const keyword = query.keyword.trim();
      where.OR = [
        { approvalNo: { contains: keyword } },
        { id: { contains: keyword } },
        { actionType: { contains: keyword } },
        { entityRef: { contains: keyword } },
        { createdByUserNo: { contains: keyword } },
        { createdByUserId: { contains: keyword } },
      ];
    }

    const [total, rows] = await Promise.all([
      this.prisma.approvalCase.count({ where }),
      this.prisma.approvalCase.findMany({
        where,
        skip,
        take,
        include: this.approvalInclude(),
        orderBy: [{ createdAt: 'desc' }],
      }),
    ]);

    return {
      total,
      skip,
      take,
      items: await this.mapApprovalsForReadModel(rows as ApprovalCaseRow[], actor),
    };
  }

  async expirePendingApprovalCase(id: string) {
    const updated = await this.prisma.$transaction(async (tx: any) => {
      const approval = await this.findCaseOrThrow(id, tx);
      if (approval.status !== ApprovalStatuses.PENDING) {
        return null;
      }

      const decidedAt = new Date();
      // Expire ALL remaining PENDING steps (preserves already-APPROVED steps)
      await tx.approvalStep.updateMany({
        where: {
          approvalCaseId: approval.id,
          status: ApprovalStepStatuses.PENDING,
        },
        data: {
          status: ApprovalStepStatuses.EXPIRED,
          reason: 'Approval expired after timeout',
          decidedAt,
        },
      });

      const next = await tx.approvalCase.update({
        where: { id: approval.id },
        data: {
          status: ApprovalStatuses.EXPIRED,
        },
        include: this.approvalInclude(),
      });

      return next as ApprovalCaseRow;
    });

    if (!updated) {
      return null;
    }

    await this.recordAudit(
      AuditActions.APPROVAL_EXPIRED,
      updated,
      this.systemActor(),
      AuditResult.REJECTED,
      'Approval expired after timeout',
    );
    await this.projectGovernanceApprovalDecision(updated);
    await this.emitApprovalEvent(ApprovalEvents.EXPIRED, this.buildEventPayload(updated));
    return this.mapApproval(updated, this.systemActor());
  }

  async expirePendingApprovals() {
    const now = new Date();
    const rows = await this.prisma.approvalCase.findMany({
      where: {
        status: ApprovalStatuses.PENDING,
        timeoutAt: {
          lt: now,
        },
      },
      select: { id: true },
      take: 200,
      orderBy: { timeoutAt: 'asc' },
    });

    const expiredIds: string[] = [];
    for (const row of rows) {
      const updated = await this.expirePendingApprovalCase(row.id);
      if (updated) {
        expiredIds.push(updated.id);
      }
    }

    return {
      expiredCount: expiredIds.length,
      expiredIds,
    };
  }
}
