import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { randomUUID } from 'crypto';
import { generateReferenceNo } from '../../../common/utils/no-generator.util';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { ApprovalsService } from '../approvals/approvals.service';
import {
  ApprovalActionTypes,
  ApprovalActorContext,
  ApprovalStatuses,
} from '../approvals/constants/approval.constants';
import {
  AuditActions,
  AuditEntityTypes,
  AuditBusinessWorkflowTypes,
  AuditModules,
  AuditWorkflowTypes,
} from '../../risk-engine/audit-logs/constants/audit-actions.constant';
import {
  AuditResult,
  AuditSubjectRole,
  AuditTriggerType,
} from '../../risk-engine/audit-logs/dto/audit-log.dto';
import { AuditLogsService } from '../../risk-engine/audit-logs/audit-logs.service';
import { sha256Hex } from '../../risk-engine/audit-logs/utils/audit-digest.util';
import { ChangeTicketStatuses } from './constants/change-ticket.constants';
import { ChangeTicketTypes } from './constants/change-ticket.constants';
import {
  ChangeTicketQueryDto,
  CreateChangeTicketDto,
  SubmitChangeTicketDto,
} from './dto/change-ticket.dto';
import { UsersService } from '../../identity/users/users.service';
import { AccessControlService } from '../../identity/access-control/access-control.service';

type ChangeTicketWriteClient = any;

type ChangeTicketApprovalSnapshot = {
  id: string;
  approvalNo: string;
  status: string;
  traceId: string;
} | null;

type ChangeTicketRow = {
  [key: string]: any;
  approvalCase?: ChangeTicketApprovalSnapshot;
};

type ConsumeChangeTicketInput = {
  success: boolean;
  note?: string;
  traceId?: string;
};

type AdminMemberProvisioningTicketInput = {
  email: string;
  roleCodes: string[];
  changeReason: string;
};

type AdminRoleBindingChangeTicketInput = {
  roleCodes: string[];
  changeReason: string;
};

type ChangeTicketBindingSnapshot = {
  intent?: string;
  [key: string]: any;
};

interface ApprovalProjectionResult {
  ticket: ChangeTicketRow;
  action?: string;
  reason?: string;
  result?: AuditResult;
  statusFrom?: string;
  statusTo?: string;
  approvalNo?: string | null;
}

const CHANGE_TICKET_CONSUME_FAILED_ACTION = 'CHANGE_TICKET_CONSUME_FAILED';

@Injectable()
export class ChangeTicketsService {
  private static readonly DEFAULT_TAKE = 20;
  private static readonly MAX_TICKET_NO_RETRIES = 10;
  private static readonly BUSINESS_PAGE_PROPOSAL_REF = 'BUSINESS_PAGE_PROPOSAL';

  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService & Record<string, any>,
    @Inject(forwardRef(() => ApprovalsService))
    private readonly approvalsService: ApprovalsService,
    private readonly auditLogsService: AuditLogsService,
    private readonly eventEmitter: EventEmitter2,
    private readonly usersService: UsersService,
    private readonly accessControlService: AccessControlService,
  ) {}

  private getDb(client?: ChangeTicketWriteClient): ChangeTicketWriteClient {
    return client ?? this.prisma;
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

  private normalizeOptionalString(value: unknown): string | null {
    if (value === null || value === undefined) return null;
    const normalized = String(value).trim();
    return normalized.length ? normalized : null;
  }

  private parseJson<T>(value?: string | null): T | null {
    if (!value) return null;
    try {
      return JSON.parse(value) as T;
    } catch {
      return null;
    }
  }

  private serializeJson(value: unknown): string {
    return JSON.stringify(value ?? {});
  }

  private normalizeSkip(skip?: number): number {
    if (!skip || skip < 0) return 0;
    return skip;
  }

  private normalizeTake(take?: number): number {
    if (!take || take < 1) return ChangeTicketsService.DEFAULT_TAKE;
    return Math.min(take, 200);
  }

  private toAuditActor(actor: ApprovalActorContext) {
    return {
      actorType: actor.actorType,
      actorId: actor.userId,
      actorNo: actor.userNo,
      actorRole: actor.role || actor.roleCodes[0] || 'UNKNOWN',
    };
  }

  private assertTraceConsistency(existingTraceId: string, incomingTraceId?: string | null) {
    const normalized = this.normalizeOptionalString(incomingTraceId);
    if (normalized && normalized !== existingTraceId) {
      throw new BadRequestException('traceId does not match the existing change ticket chain');
    }
  }

  private ticketInclude() {
    return {
      approvalCase: {
        select: {
          id: true,
          approvalNo: true,
          status: true,
          traceId: true,
        },
      },
    };
  }

  private buildBindingSnapshot(ticket: ChangeTicketRow) {
    return {
      ticketNo: ticket.ticketNo,
      changeType: ticket.changeType,
      changeReason: ticket.changeReason,
      scopeSummary: ticket.scopeSummary,
      testEvidenceRef: ticket.testEvidenceRef,
      rollbackPlanRef: ticket.rollbackPlanRef,
      traceId: ticket.traceId,
      createdByUserNo: ticket.createdByUserNo,
    };
  }

  private normalizeProposalEmail(email: string) {
    return String(email || '').trim().toLowerCase();
  }

  private normalizeProposalRoleCodes(roleCodes: string[]) {
    const seen = new Set<string>();
    const normalized: string[] = [];

    for (const rawCode of roleCodes || []) {
      const code = String(rawCode || '').trim().toUpperCase();
      if (!code || seen.has(code)) {
        continue;
      }
      seen.add(code);
      normalized.push(code);
    }

    return normalized;
  }

  private buildBusinessPageProposalRefs() {
    return {
      testEvidenceRef: ChangeTicketsService.BUSINESS_PAGE_PROPOSAL_REF,
      rollbackPlanRef: ChangeTicketsService.BUSINESS_PAGE_PROPOSAL_REF,
    };
  }

  private resolveBusinessWorkflowType(changeType: string) {
    switch (changeType) {
      case ChangeTicketTypes.ADMIN_ACCESS_CHANGE:
        return AuditBusinessWorkflowTypes.ADMIN_MEMBER_PROVISIONING;
      case ChangeTicketTypes.RBAC_CATALOG_CHANGE:
        return AuditBusinessWorkflowTypes.ADMIN_ROLE_BINDING_CHANGE;
      default:
        return AuditWorkflowTypes.CHANGE_TICKET;
    }
  }

  private requireNonBlankString(value: unknown, fieldName: string): string {
    const normalized = this.normalizeOptionalString(value);
    if (!normalized) {
      throw new BadRequestException(`${fieldName} is required`);
    }
    return normalized;
  }

  private async createTicketWithFrozenSnapshot(
    dto: CreateChangeTicketDto,
    actor: ApprovalActorContext,
    buildBindingSnapshot: (draft: ChangeTicketRow) => Record<string, unknown>,
  ) {
    const created = (await this.prisma.$transaction(async (tx: ChangeTicketWriteClient) => {
      const draft = await this.createTicketWithUniqueNo(
        {
          status: ChangeTicketStatuses.DRAFT,
          changeType: dto.changeType,
          changeReason: this.requireNonBlankString(dto.changeReason, 'changeReason'),
          scopeSummary: dto.scopeSummary.trim(),
          testEvidenceRef: dto.testEvidenceRef.trim(),
          rollbackPlanRef: dto.rollbackPlanRef.trim(),
          traceId: this.normalizeOptionalString(dto.traceId) || randomUUID(),
          createdByUserId: actor.userId,
          createdByUserNo: actor.userNo || actor.userId,
        },
        tx,
      );

      const bindingSnapshot = buildBindingSnapshot(draft);
      return (await tx.changeTicket.update({
        where: { id: draft.id },
        data: {
          bindingSnapshotJson: this.serializeJson(bindingSnapshot),
          bindingDigest: sha256Hex(bindingSnapshot),
        },
        include: this.ticketInclude(),
      })) as ChangeTicketRow;
    })) as ChangeTicketRow;

    await this.recordTicketAudit(
      AuditActions.CHANGE_TICKET_CREATED,
      created,
      actor,
      AuditResult.SUCCESS,
      'Change ticket created',
      null,
      ChangeTicketStatuses.DRAFT,
    );

    return this.mapTicket(created);
  }

  private mapTicket(ticket: ChangeTicketRow) {
    return {
      id: ticket.id,
      ticketNo: ticket.ticketNo,
      status: ticket.status,
      changeType: ticket.changeType,
      changeReason: ticket.changeReason,
      scopeSummary: ticket.scopeSummary,
      testEvidenceRef: ticket.testEvidenceRef,
      rollbackPlanRef: ticket.rollbackPlanRef,
      bindingSnapshotJson: this.parseJson<Record<string, unknown>>(ticket.bindingSnapshotJson) || {},
      bindingDigest: ticket.bindingDigest || null,
      approvalCaseId: ticket.approvalCaseId,
      approvalNo: ticket.approvalNo || ticket.approvalCase?.approvalNo || null,
      traceId: ticket.traceId,
      createdByUserId: ticket.createdByUserId,
      createdByUserNo: ticket.createdByUserNo,
      submittedByUserId: ticket.submittedByUserId,
      submittedByUserNo: ticket.submittedByUserNo,
      consumedByUserId: ticket.consumedByUserId,
      consumedByUserNo: ticket.consumedByUserNo,
      submittedAt: ticket.submittedAt,
      consumedAt: ticket.consumedAt,
      resultNote: ticket.resultNote,
      deletedAt: ticket.deletedAt || null,
      deletedBy: ticket.deletedBy || null,
      deleteRequestId: ticket.deleteRequestId || null,
      deleteRequestNo: ticket.deleteRequestNo || null,
      deleteReason: ticket.deleteReason || null,
      createdAt: ticket.createdAt,
      updatedAt: ticket.updatedAt,
    };
  }

  private async dispatchFormalExecution(
    ticket: ChangeTicketRow,
    actor: ApprovalActorContext,
  ): Promise<unknown> {
    const bindingSnapshot = this.parseJson<ChangeTicketBindingSnapshot>(ticket.bindingSnapshotJson) || {};

    switch (bindingSnapshot.intent) {
      case 'ADMIN_MEMBER_PROVISIONING':
        return this.usersService.executeAdminMemberProvisioning(bindingSnapshot as any, actor);
      case 'ADMIN_ROLE_BINDING_CHANGE':
        return this.accessControlService.executeGovernedRoleBindingChange(
          bindingSnapshot as any,
          actor,
        );
      default:
        return null;
    }
  }

  private ticketSubjectNos(ticket: ChangeTicketRow, approvalNo?: string | null) {
    const bindingSnapshot = this.parseJson<ChangeTicketBindingSnapshot>(ticket.bindingSnapshotJson) || {};
    const subjectNos: Array<{
      subjectRole: AuditSubjectRole;
      subjectType: string;
      subjectId?: string;
      subjectNo: string;
    }> = [
      {
        subjectRole: AuditSubjectRole.ENTITY,
        subjectType: AuditEntityTypes.CHANGE_TICKET,
        subjectId: ticket.id,
        subjectNo: ticket.ticketNo,
      },
    ];

    const resolvedApprovalNo = this.normalizeOptionalString(
      approvalNo || ticket.approvalNo || ticket.approvalCase?.approvalNo,
    );
    if (resolvedApprovalNo) {
      subjectNos.push({
        subjectRole: AuditSubjectRole.RELATED,
        subjectType: AuditEntityTypes.APPROVAL_CASE,
        subjectId: ticket.approvalCaseId || undefined,
        subjectNo: resolvedApprovalNo,
      });
    }

    const targetUserNo = this.normalizeOptionalString(
      bindingSnapshot.targetUserNo || bindingSnapshot.userNo,
    );
    if (targetUserNo) {
      subjectNos.push({
        subjectRole: AuditSubjectRole.RELATED,
        subjectType: 'ADMIN_USER',
        subjectId:
          this.normalizeOptionalString(bindingSnapshot.targetUserId || bindingSnapshot.userId) ||
          undefined,
        subjectNo: targetUserNo,
      });
    }

    return subjectNos;
  }

  private async recordTicketAudit(
    action: string,
    ticket: ChangeTicketRow,
    actor: ApprovalActorContext,
    result: AuditResult,
    reason?: string | null,
    statusFrom?: string | null,
    statusTo?: string | null,
    metadata?: Record<string, unknown>,
    approvalNo?: string | null,
  ) {
    await this.auditLogsService.recordByActor(
      {
        triggerType: AuditTriggerType.DATA_UPDATE,
        action,
        module: AuditModules.GOVERNANCE_CHANGE_TICKETS,
        entityType: AuditEntityTypes.CHANGE_TICKET,
        entityId: ticket.id,
        entityNo: ticket.ticketNo,
        workflowType: this.resolveBusinessWorkflowType(ticket.changeType),
        workflowId: ticket.id,
        workflowNo: ticket.ticketNo,
        traceId: ticket.traceId,
        statusFrom: statusFrom || undefined,
        statusTo: statusTo || undefined,
        result,
        reason: reason || undefined,
        metadata: {
          approvalCaseId: ticket.approvalCaseId,
          approvalNo: approvalNo || ticket.approvalNo || ticket.approvalCase?.approvalNo || null,
          approvalStatus: ticket.approvalCase?.status || null,
          changeType: ticket.changeType,
          ...(metadata || {}),
        },
        subjectNos: this.ticketSubjectNos(ticket, approvalNo),
        requestId: `CHANGE_TICKET_${ticket.ticketNo}_${action}`,
        sourcePlatform: 'ADMIN_API',
      },
      this.toAuditActor(actor),
    );
  }

  private async findTicketOrThrow(
    id: string,
    client?: ChangeTicketWriteClient,
  ): Promise<ChangeTicketRow> {
    const db = this.getDb(client);
    const found = await db.changeTicket.findUnique({
      where: { id },
      include: this.ticketInclude(),
    });

    if (!found || found.deletedAt) {
      throw new NotFoundException(`Change ticket not found: ${id}`);
    }

    return found as ChangeTicketRow;
  }

  private async createTicketWithUniqueNo(
    data: Record<string, any>,
    client?: ChangeTicketWriteClient,
  ): Promise<ChangeTicketRow> {
    const db = this.getDb(client);

    for (let i = 0; i < ChangeTicketsService.MAX_TICKET_NO_RETRIES; i += 1) {
      try {
        return (await db.changeTicket.create({
          data: {
            ...data,
            ticketNo: generateReferenceNo('CT'),
          },
          include: this.ticketInclude(),
        })) as ChangeTicketRow;
      } catch (error) {
        const maybe = error as { code?: string; meta?: { target?: string[] | string } };
        const target = maybe?.meta?.target;
        const hasTicketNoConflict =
          maybe?.code === 'P2002' &&
          ((Array.isArray(target) && target.includes('ticketNo')) ||
            (typeof target === 'string' && target.includes('ticketNo')));
        if (hasTicketNoConflict) {
          continue;
        }
        throw error;
      }
    }

    throw new ConflictException('Failed to generate unique ticketNo');
  }

  private async applyApprovalProjection(
    ticket: ChangeTicketRow,
    approvalStatus: string,
    approvalNo: string | null,
  ): Promise<ApprovalProjectionResult> {
    const normalizedApprovalStatus = this.normalizeOptionalString(approvalStatus);
    const currentApprovalStatus = this.normalizeOptionalString(ticket.approvalCase?.status);

    if (!normalizedApprovalStatus) {
      return { ticket };
    }

    let nextStatus = ticket.status;
    let action: string | undefined;
    let reason: string | undefined;
    let result: AuditResult | undefined;

    if (
      normalizedApprovalStatus === ApprovalStatuses.APPROVED &&
      ticket.status === ChangeTicketStatuses.PENDING_APPROVAL
    ) {
      nextStatus = ChangeTicketStatuses.READY;
      action = AuditActions.CHANGE_TICKET_APPROVED;
      reason = `Approval ${approvalNo || ticket.approvalCaseId || ''} approved`;
      result = AuditResult.SUCCESS;
    } else if (
      ([
        ApprovalStatuses.REJECTED,
        ApprovalStatuses.EXPIRED,
        ApprovalStatuses.CANCELLED,
      ] as string[]).includes(normalizedApprovalStatus) &&
      ticket.status === ChangeTicketStatuses.PENDING_APPROVAL
    ) {
      nextStatus = ChangeTicketStatuses.REJECTED;
      action = AuditActions.CHANGE_TICKET_REJECTED;
      reason = `Approval ${approvalNo || ticket.approvalCaseId || ''} ${normalizedApprovalStatus.toLowerCase()}`;
      result = AuditResult.REJECTED;
    }

    if (nextStatus === ticket.status && normalizedApprovalStatus === currentApprovalStatus) {
      return { ticket };
    }

    const updated = (await this.prisma.changeTicket.update({
      where: { id: ticket.id },
      data: {
        status: nextStatus,
      },
      include: this.ticketInclude(),
    })) as ChangeTicketRow;

    return {
      ticket: updated,
      action,
      reason,
      result,
      statusFrom: ticket.status,
      statusTo: nextStatus,
      approvalNo,
    };
  }

  async syncApprovalProjectionByEvent(event: {
    approvalId: string;
    approvalNo: string;
    entityRef: string;
    actionType: string;
    status: string;
  }) {
    if (event.actionType !== ApprovalActionTypes.CHANGE_TICKET_APPROVAL) {
      return null;
    }

    const ticket = await this.prisma.changeTicket.findUnique({
      where: { id: event.entityRef },
      include: this.ticketInclude(),
    });
    if (!ticket || ticket.deletedAt) {
      return null;
    }

    const row = ticket as ChangeTicketRow;
    if (row.approvalCaseId && row.approvalCaseId !== event.approvalId) {
      return this.mapTicket(row);
    }

    const projection = await this.applyApprovalProjection(row, event.status, event.approvalNo);

    if (projection.action) {
      await this.recordTicketAudit(
        projection.action,
        projection.ticket,
        this.systemActor(),
        projection.result || AuditResult.SUCCESS,
        projection.reason,
        projection.statusFrom,
        projection.statusTo,
        undefined,
        projection.approvalNo,
      );
    }

    return this.mapTicket(projection.ticket);
  }

  async create(dto: CreateChangeTicketDto, actor: ApprovalActorContext) {
    return this.createTicketWithFrozenSnapshot(dto, actor, (draft) => this.buildBindingSnapshot(draft));
  }

  async createAdminMemberProvisioningTicket(
    input: AdminMemberProvisioningTicketInput,
    actor: ApprovalActorContext,
  ) {
    const email = this.normalizeProposalEmail(input.email);
    if (!email) {
      throw new BadRequestException('email is required');
    }

    const roleCodes = this.normalizeProposalRoleCodes(input.roleCodes);
    if (roleCodes.length === 0) {
      throw new BadRequestException('At least one role code is required');
    }

    const changeReason = this.requireNonBlankString(input.changeReason, 'changeReason');
    const scopeSummary = `Provision admin member ${email} with roles ${roleCodes.join(', ')}`;

    return this.createTicketWithFrozenSnapshot(
      {
        changeType: ChangeTicketTypes.ADMIN_ACCESS_CHANGE,
        changeReason,
        scopeSummary,
        ...this.buildBusinessPageProposalRefs(),
      },
      actor,
      (draft) => ({
        ticketNo: draft.ticketNo,
        changeType: draft.changeType,
        traceId: draft.traceId,
        intent: 'ADMIN_MEMBER_PROVISIONING',
        email,
        roleCodes,
        requestedByUserId: actor.userId,
        requestedByUserNo: actor.userNo || actor.userId,
        changeReason,
        scopeSummary,
        testEvidenceRef: draft.testEvidenceRef,
        rollbackPlanRef: draft.rollbackPlanRef,
      }),
    );
  }

  async createAdminRoleBindingChangeTicket(
    userId: string,
    input: AdminRoleBindingChangeTicketInput,
    actor: ApprovalActorContext,
  ) {
    const normalizedUserId = String(userId || '').trim();
    if (!normalizedUserId) {
      throw new BadRequestException('userId is required');
    }

    const roleCodes = this.normalizeProposalRoleCodes(input.roleCodes);
    if (roleCodes.length === 0) {
      throw new BadRequestException('At least one role code is required');
    }

    const targetUser = await this.prisma.user.findFirst({
      where: {
        id: normalizedUserId,
        deletedAt: null,
      },
      select: {
        id: true,
        userNo: true,
        email: true,
      },
    });

    if (!targetUser) {
      throw new NotFoundException('User not found');
    }

    const changeReason = this.requireNonBlankString(input.changeReason, 'changeReason');
    const scopeSummary = `Replace admin role bindings for user ${normalizedUserId} with roles ${roleCodes.join(', ')}`;

    return this.createTicketWithFrozenSnapshot(
      {
        changeType: ChangeTicketTypes.RBAC_CATALOG_CHANGE,
        changeReason,
        scopeSummary,
        ...this.buildBusinessPageProposalRefs(),
      },
      actor,
      (draft) => ({
        ticketNo: draft.ticketNo,
        changeType: draft.changeType,
        traceId: draft.traceId,
        intent: 'ADMIN_ROLE_BINDING_CHANGE',
        targetUserId: targetUser.id,
        targetUserNo: targetUser.userNo,
        targetEmail: targetUser.email,
        roleCodes,
        requestedByUserId: actor.userId,
        requestedByUserNo: actor.userNo || actor.userId,
        changeReason,
        scopeSummary,
        testEvidenceRef: draft.testEvidenceRef,
        rollbackPlanRef: draft.rollbackPlanRef,
      }),
    );
  }

  async submit(id: string, dto: SubmitChangeTicketDto, actor: ApprovalActorContext) {
    const current = await this.findTicketOrThrow(id);
    if (current.status !== ChangeTicketStatuses.DRAFT) {
      throw new BadRequestException('Only DRAFT change tickets can be submitted');
    }
    this.assertTraceConsistency(current.traceId, dto.traceId);

    let approval:
      | {
          id: string;
          approvalNo: string;
          status: string;
        }
      | undefined;

    const updated = await this.prisma.$transaction(async (tx: any) => {
      const ticket = await this.findTicketOrThrow(id, tx);
      if (ticket.status !== ChangeTicketStatuses.DRAFT) {
        throw new BadRequestException('Only DRAFT change tickets can be submitted');
      }

      approval = await this.approvalsService.createAndSubmit(
        {
          actionType: ApprovalActionTypes.CHANGE_TICKET_APPROVAL,
          entityRef: ticket.id,
          metadata: {
            source: 'WF06',
            ticketNo: ticket.ticketNo,
          },
          traceId: ticket.traceId,
        },
        {
          reason:
            this.normalizeOptionalString(dto.reason) ||
            `Change ticket ${ticket.ticketNo} submitted`,
          traceId: ticket.traceId,
        },
        actor,
        tx,
        { emitSideEffects: false },
      );

      return (await tx.changeTicket.update({
        where: { id: ticket.id },
        data: {
          status: ChangeTicketStatuses.PENDING_APPROVAL,
          approvalCaseId: approval.id,
          approvalNo: approval.approvalNo,
          submittedByUserId: actor.userId,
          submittedByUserNo: actor.userNo || actor.userId,
          submittedAt: new Date(),
        },
        include: this.ticketInclude(),
      })) as ChangeTicketRow;
    });

    await this.recordTicketAudit(
      AuditActions.CHANGE_TICKET_SUBMITTED,
      updated,
      actor,
      AuditResult.SUCCESS,
      this.normalizeOptionalString(dto.reason) || 'Change ticket submitted',
      ChangeTicketStatuses.DRAFT,
      ChangeTicketStatuses.PENDING_APPROVAL,
      {
        approvalCaseId: approval?.id || null,
      },
      approval?.approvalNo || null,
    );

    if (approval) {
      await this.approvalsService.emitSubmittedSideEffects(
        approval.id,
        actor,
        this.normalizeOptionalString(dto.reason) || `Change ticket ${updated.ticketNo} submitted`,
      );
      await this.recordTicketAudit(
        AuditActions.CHANGE_TICKET_APPROVAL_LINKED,
        updated,
        actor,
        AuditResult.SUCCESS,
        `Approval ${approval.approvalNo} linked`,
        ChangeTicketStatuses.PENDING_APPROVAL,
        ChangeTicketStatuses.PENDING_APPROVAL,
        {
          approvalCaseId: approval.id,
        },
        approval.approvalNo,
      );
    }

    return this.mapTicket(updated);
  }

  async consume(id: string, dto: ConsumeChangeTicketInput, actor: ApprovalActorContext) {
    const current = await this.findTicketOrThrow(id);
    this.assertTraceConsistency(current.traceId, dto.traceId);

    if (current.status === ChangeTicketStatuses.FAILED) {
      throw new BadRequestException('FAILED change tickets cannot be consumed again');
    }
    if (current.status !== ChangeTicketStatuses.READY) {
      throw new BadRequestException('Only READY change tickets can be consumed');
    }

    const nextStatus = dto.success ? ChangeTicketStatuses.DONE : ChangeTicketStatuses.FAILED;
    const note = this.normalizeOptionalString(dto.note);

    if (dto.success) {
      await this.dispatchFormalExecution(current, actor);
    }

    const updated = (await this.prisma.changeTicket.update({
      where: { id: current.id },
      data: {
        status: nextStatus,
        consumedByUserId: actor.userId,
        consumedByUserNo: actor.userNo || actor.userId,
        consumedAt: new Date(),
        resultNote: note,
      },
      include: this.ticketInclude(),
    })) as ChangeTicketRow;

    await this.recordTicketAudit(
      dto.success ? AuditActions.CHANGE_TICKET_CONSUMED : CHANGE_TICKET_CONSUME_FAILED_ACTION,
      updated,
      actor,
      dto.success ? AuditResult.SUCCESS : AuditResult.FAILED,
      note || (dto.success ? 'Change ticket consumed successfully' : 'Change ticket consume failed'),
      ChangeTicketStatuses.READY,
      nextStatus,
      {
        consumed: true,
      },
      updated.approvalNo || updated.approvalCase?.approvalNo || null,
    );

    return this.mapTicket(updated);
  }

  async getById(id: string, actor?: ApprovalActorContext) {
    return this.mapTicket(await this.findTicketOrThrow(id));
  }

  async list(query: ChangeTicketQueryDto, actor?: ApprovalActorContext) {
    const skip = this.normalizeSkip(query.skip);
    const take = this.normalizeTake(query.take);
    const where: Record<string, any> = {
      deletedAt: null,
    };

    if (query.ticketNo) {
      where.ticketNo = query.ticketNo.trim();
    }
    if (query.status) {
      where.status = query.status.trim().toUpperCase();
    }
    if (query.changeType) {
      where.changeType = query.changeType.trim().toUpperCase();
    }
    if (query.traceId) {
      where.traceId = query.traceId.trim();
    }
    if (query.keyword) {
      const keyword = query.keyword.trim();
      where.OR = [
        { ticketNo: { contains: keyword } },
        { traceId: { contains: keyword } },
        { scopeSummary: { contains: keyword } },
        { changeType: { contains: keyword } },
        { approvalNo: { contains: keyword } },
      ];
    }

    const [total, rows] = await Promise.all([
      this.prisma.changeTicket.count({ where }),
      this.prisma.changeTicket.findMany({
        where,
        skip,
        take,
        include: this.ticketInclude(),
        orderBy: [{ createdAt: 'desc' }],
      }),
    ]);

    return {
      total,
      skip,
      take,
      items: rows.map((row: ChangeTicketRow) => this.mapTicket(row)),
    };
  }
}
