import {
  BadRequestException,
  ForbiddenException,
  forwardRef,
  Inject,
  InternalServerErrorException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { randomUUID } from 'crypto';
import { generateReferenceNo } from '../../../common/utils/no-generator.util';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AuditLogsService } from '../../risk-engine/audit-logs/audit-logs.service';
import {
  AuditActions,
  AuditEntityTypes,
  AuditModules,
} from '../../risk-engine/audit-logs/constants/audit-actions.constant';
import {
  AuditResult,
  AuditTriggerType,
} from '../../risk-engine/audit-logs/dto/audit-log.dto';
import { ApprovalPolicyService } from './approval-policy.service';
import { ChangeTicketsService } from '../change-tickets/change-tickets.service';
import {
  ApprovalActionTypes,
  ApprovalActorContext,
  ApprovalDecisionEvent,
  ApprovalEvents,
  ApprovalExecutionStatuses,
  ApprovalStatuses,
  ApprovalStepStatuses,
  isSuperAdminRoleContext,
  joinRoleCsv,
  splitRoleCsv,
} from './constants/approval.constants';
import { DeleteRequestsService } from '../delete-requests/delete-requests.service';
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
  caseEvidencePackage: {
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
  workflowType?: string | null;
  workflowId?: string | null;
  workflowNo?: string | null;
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
    @Optional()
    @Inject(forwardRef(() => ChangeTicketsService))
    private readonly changeTicketsService?: ChangeTicketsService,
    @Optional()
    @Inject(forwardRef(() => DeleteRequestsService))
    private readonly deleteRequestsService?: DeleteRequestsService,
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

  private serializeMetadata(value: unknown): string {
    if (value === null || value === undefined) return '{}';
    try {
      return JSON.stringify(value);
    } catch {
      throw new BadRequestException('Failed to serialize approval metadata');
    }
  }

  private parseMetadata(value: string | null | undefined): Record<string, unknown> {
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

  private normalizeWorkflowContext(input: {
    workflowType?: unknown;
    workflowId?: unknown;
    workflowNo?: unknown;
  }): { workflowType: string | null; workflowId: string | null; workflowNo: string | null } {
    const workflowType = this.normalizeOptionalString(input.workflowType)?.toUpperCase() || null;
    const workflowId = this.normalizeOptionalString(input.workflowId);
    const workflowNo = this.normalizeOptionalString(input.workflowNo);
    const providedCount = [workflowType, workflowId, workflowNo].filter(Boolean).length;

    if (providedCount > 0 && providedCount < 3) {
      throw new BadRequestException(
        'workflowType, workflowId, and workflowNo must be provided together for workflow-bound approvals',
      );
    }

    return {
      workflowType,
      workflowId,
      workflowNo,
    };
  }

  private assertWorkflowContextConsistency(
    approval: ApprovalCaseRow | { workflowType?: string | null; workflowId?: string | null; workflowNo?: string | null },
    input: { workflowType?: unknown; workflowId?: unknown; workflowNo?: unknown },
  ) {
    const existing = this.normalizeWorkflowContext({
      workflowType: approval.workflowType,
      workflowId: approval.workflowId,
      workflowNo: approval.workflowNo,
    });
    const incoming = this.normalizeWorkflowContext(input);
    const hasExisting =
      !!existing.workflowType || !!existing.workflowId || !!existing.workflowNo;
    const hasIncoming =
      !!incoming.workflowType || !!incoming.workflowId || !!incoming.workflowNo;

    if (!hasIncoming) {
      return;
    }

    if (!hasExisting) {
      throw new BadRequestException(
        'workflowType/workflowId/workflowNo do not match the existing approval chain',
      );
    }

    if (
      existing.workflowType !== incoming.workflowType ||
      existing.workflowId !== incoming.workflowId ||
      existing.workflowNo !== incoming.workflowNo
    ) {
      throw new BadRequestException(
        'workflowType/workflowId/workflowNo do not match the existing approval chain',
      );
    }
  }

  private async recordAudit(
    action: string,
    approval: ApprovalCaseRow,
    actor: ApprovalActorContext,
    result: AuditResult,
    reason?: string | null,
    statusFrom?: string | null,
    statusTo?: string | null,
    metadata?: Record<string, unknown>,
  ) {
    await this.auditLogsService.recordByActor(
      {
        triggerType: AuditTriggerType.DATA_UPDATE,
        action,
        module: AuditModules.GOVERNANCE_APPROVALS,
        entityType: AuditEntityTypes.APPROVAL_CASE,
        entityId: approval.id,
        entityNo: approval.approvalNo,
        traceId: approval.traceId,
        workflowType: approval.workflowType || undefined,
        workflowId: approval.workflowId || undefined,
        workflowNo: approval.workflowNo || undefined,
        result,
        reason: reason || undefined,
        statusFrom: statusFrom || undefined,
        statusTo: statusTo || undefined,
        metadata: {
          approvalNo: approval.approvalNo,
          actionType: approval.actionType,
          entityRef: approval.entityRef,
          executionStatus: approval.executionStatus,
          ...(metadata || {}),
        },
        requestId: `APPROVAL_${approval.approvalNo}_${action}`,
        sourcePlatform: 'ADMIN_API',
      },
      this.toAuditActor(actor),
    );
  }

  private buildEventPayload(approval: ApprovalCaseRow): ApprovalDecisionEvent {
    return {
      approvalId: approval.id,
      approvalNo: approval.approvalNo,
      actionType: approval.actionType,
      entityRef: approval.entityRef,
      traceId: approval.traceId,
      workflowType: approval.workflowType,
      workflowId: approval.workflowId,
      workflowNo: approval.workflowNo,
      status: approval.status,
      decisionByUserId: approval.decisionByUserId,
      decisionByRole: approval.decisionByRole,
      decisionReason: approval.decisionReason,
      decidedAt: approval.decidedAt ? approval.decidedAt.toISOString() : null,
    };
  }

  private async emitApprovalEvent(eventName: string, payload: ApprovalDecisionEvent) {
    if (typeof this.eventEmitter.emitAsync === 'function') {
      await this.eventEmitter.emitAsync(eventName, payload);
      return;
    }

    this.eventEmitter.emit(eventName, payload);
  }

  private async projectGovernanceApprovalDecision(approval: ApprovalCaseRow) {
    const event = this.buildEventPayload(approval);
    if (
      approval.actionType === ApprovalActionTypes.CHANGE_TICKET_APPROVAL &&
      this.changeTicketsService
    ) {
      await this.changeTicketsService.syncApprovalProjectionByEvent(event);
      return;
    }

    if (
      approval.actionType === ApprovalActionTypes.DELETE_REQUEST_APPROVAL &&
      this.deleteRequestsService
    ) {
      await this.deleteRequestsService.syncApprovalProjectionByEvent(event);
    }
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
        caseEvidencePackage: {
          select: {
            id: true,
            packageNo: true,
            status: true,
          },
        },
      },
    });

    if (!found || found.deletedAt) {
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
      caseEvidencePackage: {
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
        return (await db.approvalCase.create({
          data: {
            ...data,
            approvalNo: generateReferenceNo('APR'),
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
    const checkerRoles = splitRoleCsv(approval.checkerRoles);
    const availableDecisionRoles = actor
      ? this.isSuperAdmin(actor)
        ? checkerRoles
        : checkerRoles.filter((role) => actor.roleCodes.includes(role))
      : [];
    const makerCheckerConflict = actor
      ? !this.isSuperAdmin(actor) &&
        actor.userId === approval.makerUserId &&
        availableDecisionRoles.length > 0
      : false;
    const canDecide =
      approval.status === ApprovalStatuses.PENDING &&
      availableDecisionRoles.length > 0 &&
      !makerCheckerConflict;

    return {
      id: approval.id,
      approvalNo: approval.approvalNo,
      actionType: approval.actionType,
      entityRef: approval.entityRef,
      makerUserId: approval.makerUserId,
      status: approval.status,
      executionStatus: approval.executionStatus,
      riskLevel: approval.riskLevel,
      checkerRoles,
      docRef: approval.docRef,
      metadata: this.parseMetadata(approval.metadataJson),
      traceId: approval.traceId,
      workflowType: approval.workflowType,
      workflowId: approval.workflowId,
      workflowNo: approval.workflowNo,
      submittedAt: approval.submittedAt,
      timeoutAt: approval.timeoutAt,
      decidedAt: approval.decidedAt,
      executedAt: approval.executedAt,
      createdAt: approval.createdAt,
      updatedAt: approval.updatedAt,
      availableDecisionRoles,
      canApprove: canDecide,
      canReject: canDecide,
      canCancel:
        !!actor &&
        approval.allowCancel &&
        (actor.userId === approval.makerUserId || this.isSuperAdmin(actor)) &&
        cancellableStatuses.has(approval.status),
    };
  }

  private async resolveUserNoMap(userIds: Array<string | null | undefined>) {
    const normalizedIds = Array.from(
      new Set(
        userIds
          .filter((value): value is string => typeof value === 'string')
          .map((value) => value.trim())
          .filter((value) => value.length > 0),
      ),
    );

    if (!normalizedIds.length || typeof this.prisma.user?.findMany !== 'function') {
      return new Map<string, string>();
    }

    const users = await this.prisma.user.findMany({
      where: {
        id: {
          in: normalizedIds,
        },
      },
      select: {
        id: true,
        userNo: true,
      },
    });

    return new Map<string, string>(
      users
        .filter(
          (item: { id?: unknown; userNo?: unknown }) =>
            typeof item.id === 'string' && typeof item.userNo === 'string',
        )
        .map((item: { id: string; userNo: string }) => [item.id, item.userNo]),
    );
  }

  private async mapApprovalsForReadModel(
    approvals: ApprovalCaseRow[],
    actor?: ApprovalActorContext,
  ) {
    const userNoMap = await this.resolveUserNoMap(
      approvals.flatMap((approval) => [
        approval.makerUserId,
        approval.decisionByUserId,
        approval.steps?.[0]?.decidedByUserId,
      ]),
    );

    return approvals.map((approval) => {
      const currentStep = approval.steps?.[0] || null;

      return {
        ...this.mapApproval(approval, actor),
        makerUserNo: userNoMap.get(approval.makerUserId) || null,
        selectedCheckerRole: approval.selectedCheckerRole,
        allowCancel: approval.allowCancel,
        allowRetry: approval.allowRetry,
        decisionReason: approval.decisionReason,
        step: currentStep
          ? {
              id: currentStep.id,
              stepNo: currentStep.stepNo,
              status: currentStep.status,
              checkerRoleCandidates: splitRoleCsv(currentStep.checkerRoleCandidates),
              decidedByUserId: currentStep.decidedByUserId,
              decidedByUserNo: currentStep.decidedByUserId
                ? userNoMap.get(currentStep.decidedByUserId) || null
                : null,
              decidedByRole: currentStep.decidedByRole,
              reason: currentStep.reason,
              decidedAt: currentStep.decidedAt,
              createdAt: currentStep.createdAt,
              updatedAt: currentStep.updatedAt,
            }
          : null,
        evidencePackage: approval.evidencePackage,
        caseEvidencePackage: approval.caseEvidencePackage,
      };
    });
  }

  private async resolveDecisionRole(
    approval: ApprovalCaseRow,
    actor: ApprovalActorContext,
    requestedRole?: string,
  ): Promise<string> {
    const normalizedRequestedRole = this.normalizeOptionalString(requestedRole);
    const allowedRoles = splitRoleCsv(approval.checkerRoles);
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
      actor.userId === approval.makerUserId &&
      (await this.approvalPolicyService.isSameUserMakerCheckerDenied())
    ) {
      throw new ForbiddenException('Maker and checker must be different users');
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

    const workflowContext = this.normalizeWorkflowContext(dto);

    const existingPending = await db.approvalCase.findFirst({
      where: {
        actionType,
        entityRef,
        status: ApprovalStatuses.PENDING,
        deletedAt: null,
      },
      include: this.approvalInclude(),
      orderBy: { createdAt: 'desc' },
    });

    if (existingPending) {
      this.assertTraceConsistency(existingPending.traceId, dto.traceId);
      this.assertWorkflowContextConsistency(existingPending, dto);
      return existingPending as ApprovalCaseRow;
    }

    const policy = await this.approvalPolicyService.getPolicy(actionType);
    if (!policy.checkerRoles.length) {
      throw new BadRequestException(`No checker roles configured for actionType ${actionType}`);
    }

    const selectedCheckerRole =
      this.normalizeOptionalString(dto.checkerRole) || policy.checkerRoles[0];
    if (!policy.checkerRoles.includes(selectedCheckerRole)) {
      throw new BadRequestException(
        `checkerRole ${selectedCheckerRole} is not allowed by policy ${actionType}`,
      );
    }

    return this.createCaseWithUniqueNo(
      {
        actionType,
        entityRef,
        makerUserId: actor.userId,
        status: ApprovalStatuses.DRAFT,
        executionStatus: ApprovalExecutionStatuses.NOT_EXECUTED,
        riskLevel: policy.riskLevel,
        checkerRoles: joinRoleCsv(policy.checkerRoles),
        selectedCheckerRole,
        allowCancel: policy.allowCancel,
        allowRetry: policy.allowRetry,
        docRef: this.normalizeOptionalString(dto.docRef),
        metadataJson: this.serializeMetadata(dto.metadata || {}),
        traceId: this.normalizeOptionalString(dto.traceId) || randomUUID(),
        workflowType: workflowContext.workflowType,
        workflowId: workflowContext.workflowId,
        workflowNo: workflowContext.workflowNo,
        steps: {
          create: {
            stepNo: 1,
            status: ApprovalStepStatuses.PENDING,
            checkerRoleCandidates: joinRoleCsv(policy.checkerRoles),
          },
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
    if (approval.makerUserId !== actor.userId) {
      throw new ForbiddenException('Only the maker can submit this approval');
    }
    if (approval.status !== ApprovalStatuses.DRAFT) {
      throw new BadRequestException('Only DRAFT approvals can be submitted');
    }

    this.assertTraceConsistency(approval.traceId, dto.traceId);
    this.assertWorkflowContextConsistency(approval, dto);

    const policy = await this.approvalPolicyService.getPolicy(approval.actionType);
    const now = new Date();
    const timeoutAt = new Date(now.getTime() + policy.timeoutHours * 60 * 60 * 1000);

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
        decisionReason: this.normalizeOptionalString(dto.reason),
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
      ApprovalStatuses.DRAFT,
      ApprovalStatuses.PENDING,
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
        ApprovalStatuses.DRAFT,
        ApprovalStatuses.PENDING,
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
      this.assertWorkflowContextConsistency(approval, dto);
      const decisionRole = await this.resolveDecisionRole(approval, actor, dto.checkerRole);
      const now = new Date();

      await tx.approvalStep.update({
        where: {
          approvalCaseId_stepNo: {
            approvalCaseId: approval.id,
            stepNo: 1,
          },
        },
        data: {
          status: ApprovalStepStatuses.APPROVED,
          decidedByUserId: actor.userId,
          decidedByRole: decisionRole,
          reason: this.normalizeOptionalString(dto.reason),
          decidedAt: now,
        },
      });

      const next = await tx.approvalCase.update({
        where: { id: approval.id },
        data: {
          status: ApprovalStatuses.APPROVED,
          selectedCheckerRole: decisionRole,
          decisionByUserId: actor.userId,
          decisionByRole: decisionRole,
          decisionReason: this.normalizeOptionalString(dto.reason),
          decidedAt: now,
        },
        include: this.approvalInclude(),
      });

      return next as ApprovalCaseRow;
    });

    await this.recordAudit(
      AuditActions.APPROVAL_APPROVED,
      updated,
      actor,
      AuditResult.SUCCESS,
      dto.reason || 'Approval approved',
      ApprovalStatuses.PENDING,
      ApprovalStatuses.APPROVED,
      this.isSuperAdmin(actor) && actor.userId === updated.makerUserId
        ? { superAdminBypass: true }
        : undefined,
    );
    await this.projectGovernanceApprovalDecision(updated);
    await this.emitApprovalEvent(ApprovalEvents.APPROVED, this.buildEventPayload(updated));
    return this.mapApproval(updated, actor);
  }

  async reject(id: string, dto: DecisionApprovalDto, actor: ApprovalActorContext) {
    const updated = await this.prisma.$transaction(async (tx: any) => {
      const approval = await this.findCaseOrThrow(id, tx);
      if (approval.status !== ApprovalStatuses.PENDING) {
        throw new BadRequestException('Only PENDING approvals can be rejected');
      }

      this.assertTraceConsistency(approval.traceId, dto.traceId);
      this.assertWorkflowContextConsistency(approval, dto);
      const decisionRole = await this.resolveDecisionRole(approval, actor, dto.checkerRole);
      const now = new Date();

      await tx.approvalStep.update({
        where: {
          approvalCaseId_stepNo: {
            approvalCaseId: approval.id,
            stepNo: 1,
          },
        },
        data: {
          status: ApprovalStepStatuses.REJECTED,
          decidedByUserId: actor.userId,
          decidedByRole: decisionRole,
          reason: this.normalizeOptionalString(dto.reason),
          decidedAt: now,
        },
      });

      const next = await tx.approvalCase.update({
        where: { id: approval.id },
        data: {
          status: ApprovalStatuses.REJECTED,
          selectedCheckerRole: decisionRole,
          decisionByUserId: actor.userId,
          decisionByRole: decisionRole,
          decisionReason: this.normalizeOptionalString(dto.reason),
          decidedAt: now,
        },
        include: this.approvalInclude(),
      });

      return next as ApprovalCaseRow;
    });

    await this.recordAudit(
      AuditActions.APPROVAL_REJECTED,
      updated,
      actor,
      AuditResult.REJECTED,
      dto.reason || 'Approval rejected',
      ApprovalStatuses.PENDING,
      ApprovalStatuses.REJECTED,
      this.isSuperAdmin(actor) && actor.userId === updated.makerUserId
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
      if (approval.makerUserId !== actor.userId && !this.isSuperAdmin(actor)) {
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
      this.assertWorkflowContextConsistency(approval, dto);
      previousStatus = approval.status;
      const now = new Date();

      await tx.approvalStep.update({
        where: {
          approvalCaseId_stepNo: {
            approvalCaseId: approval.id,
            stepNo: 1,
          },
        },
        data: {
          status: ApprovalStepStatuses.CANCELLED,
          reason: this.normalizeOptionalString(dto.reason),
          decidedAt: now,
        },
      });

      const next = await tx.approvalCase.update({
        where: { id: approval.id },
        data: {
          status: ApprovalStatuses.CANCELLED,
          decisionByUserId: actor.userId,
          decisionByRole: actor.role || actor.roleCodes[0] || null,
          decisionReason: this.normalizeOptionalString(dto.reason),
          decidedAt: now,
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
      previousStatus,
      ApprovalStatuses.CANCELLED,
      this.isSuperAdmin(actor) && actor.userId !== updated.makerUserId
        ? { superAdminBypass: true }
        : undefined,
    );
    await this.projectGovernanceApprovalDecision(updated);
    await this.emitApprovalEvent(ApprovalEvents.CANCELLED, this.buildEventPayload(updated));
    return this.mapApproval(updated, actor);
  }

  async markExecutionResult(
    approvalCaseId: string,
    success: boolean,
    actor: ApprovalActorContext,
    reason?: string | null,
  ) {
    let previousExecutionStatus: string = ApprovalExecutionStatuses.NOT_EXECUTED;
    const updated = await this.prisma.$transaction(async (tx: any) => {
      const approval = await this.findCaseOrThrow(approvalCaseId, tx);
      if (approval.status !== ApprovalStatuses.APPROVED) {
        throw new BadRequestException('Only APPROVED approvals can record execution results');
      }
      previousExecutionStatus = approval.executionStatus;

      const next = await tx.approvalCase.update({
        where: { id: approval.id },
        data: {
          executionStatus: success
            ? ApprovalExecutionStatuses.EXECUTED
            : ApprovalExecutionStatuses.EXECUTION_FAILED,
          executedAt: new Date(),
        },
        include: this.approvalInclude(),
      });

      return next as ApprovalCaseRow;
    });

    await this.recordAudit(
      success
        ? AuditActions.APPROVAL_EXECUTED
        : AuditActions.APPROVAL_EXECUTION_FAILED,
      updated,
      actor,
      success ? AuditResult.SUCCESS : AuditResult.FAILED,
      reason || (success ? 'Approval execution succeeded' : 'Approval execution failed'),
      previousExecutionStatus,
      updated.executionStatus,
    );
    return this.mapApproval(updated, actor);
  }

  async requireApproved(input: ApprovalRequirementInput) {
    const approval = input.approvalCaseId
      ? await this.findCaseOrThrow(input.approvalCaseId)
      : ((await this.prisma.approvalCase.findFirst({
          where: {
            actionType: input.actionType,
            entityRef: input.entityRef,
            deletedAt: null,
          },
          include: this.approvalInclude(),
          orderBy: { createdAt: 'desc' },
        })) as ApprovalCaseRow | null);

    if (!approval) {
      if (input.actor) {
        await this.auditLogsService.recordByActor(
          {
            triggerType: AuditTriggerType.DATA_UPDATE,
            action: AuditActions.APPROVAL_REQUIRED_MISSING,
            module: AuditModules.GOVERNANCE_APPROVALS,
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
    this.assertWorkflowContextConsistency(approval, input);
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
    const where: Record<string, any> = {
      deletedAt: null,
    };

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
        { makerUserId: { contains: keyword } },
        { decisionByUserId: { contains: keyword } },
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
      await tx.approvalStep.update({
        where: {
          approvalCaseId_stepNo: {
            approvalCaseId: approval.id,
            stepNo: 1,
          },
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
          decisionReason: 'Approval expired after timeout',
          decidedAt,
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
      ApprovalStatuses.PENDING,
      ApprovalStatuses.EXPIRED,
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
        deletedAt: null,
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
