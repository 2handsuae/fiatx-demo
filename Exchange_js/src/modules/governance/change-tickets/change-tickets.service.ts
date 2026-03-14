import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
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
  AuditModules,
  AuditWorkflowTypes,
} from '../../risk-engine/audit-logs/constants/audit-actions.constant';
import {
  AuditResult,
  AuditSubjectRole,
  AuditTriggerType,
} from '../../risk-engine/audit-logs/dto/audit-log.dto';
import { AuditLogsService } from '../../risk-engine/audit-logs/audit-logs.service';
import {
  ChangeTicketDeployStatuses,
  ChangeTicketDeployEvent,
  ChangeTicketEvents,
  ChangeTicketGateRunStatuses,
  ChangeTicketRiskLevels,
  ChangeTicketStatuses,
  ChangeTicketWorkflowTypes,
} from './constants/change-ticket.constants';
import {
  ChangeTicketQueryDto,
  CloseChangeTicketDto,
  CreateChangeTicketDto,
  ResubmitChangeTicketDto,
  SubmitChangeTicketDto,
} from './dto/change-ticket.dto';

type ChangeTicketWriteClient = any;

type ChangeTicketApprovalSnapshot = {
  id: string;
  approvalNo: string;
  status: string;
  traceId: string;
} | null;

type ChangeTicketRow = {
  [key: string]: any;
  latestApproval: ChangeTicketApprovalSnapshot;
};

type GateRunRow = Record<string, any>;

interface ApprovalProjectionResult {
  ticket: ChangeTicketRow;
  action?: string;
  reason?: string;
  result?: AuditResult;
  statusFrom?: string;
  statusTo?: string;
  approvalNo?: string | null;
}

@Injectable()
export class ChangeTicketsService {
  private static readonly DEFAULT_TAKE = 20;
  private static readonly MAX_TICKET_NO_RETRIES = 10;

  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService & Record<string, any>,
    @Inject(forwardRef(() => ApprovalsService))
    private readonly approvalsService: ApprovalsService,
    private readonly auditLogsService: AuditLogsService,
    private readonly eventEmitter: EventEmitter2,
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

  private normalizeTake(take?: number): number {
    if (!take || take < 1) return ChangeTicketsService.DEFAULT_TAKE;
    return Math.min(take, 200);
  }

  private normalizeSkip(skip?: number): number {
    if (!skip || skip < 0) return 0;
    return skip;
  }

  private toDate(value?: string | null): Date | null {
    const normalized = this.normalizeOptionalString(value);
    if (!normalized) return null;
    const date = new Date(normalized);
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException(`Invalid date value: ${value}`);
    }
    return date;
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
      latestApproval: {
        select: {
          id: true,
          approvalNo: true,
          status: true,
          traceId: true,
        },
      },
    };
  }

  private mapTicket(ticket: ChangeTicketRow) {
    return {
      id: ticket.id,
      ticketNo: ticket.ticketNo,
      status: ticket.status,
      changeType: ticket.changeType,
      scopeSummary: ticket.scopeSummary,
      riskLevel: ticket.riskLevel,
      testEvidenceRef: ticket.testEvidenceRef,
      rollbackPlanRef: ticket.rollbackPlanRef,
      latestApprovalId: ticket.latestApprovalId,
      latestApprovalNo: ticket.latestApproval?.approvalNo || null,
      latestApprovalStatus: ticket.latestApprovalStatus,
      traceId: ticket.traceId,
      emergency: ticket.emergency,
      emergencyReason: ticket.emergencyReason,
      postApprovalDueAt: ticket.postApprovalDueAt,
      postApprovalCompletedAt: ticket.postApprovalCompletedAt,
      createdByUserId: ticket.createdByUserId,
      submittedByUserId: ticket.submittedByUserId,
      closedByUserId: ticket.closedByUserId,
      submittedAt: ticket.submittedAt,
      deployedAt: ticket.deployedAt,
      closedAt: ticket.closedAt,
      createdAt: ticket.createdAt,
      updatedAt: ticket.updatedAt,
    };
  }

  mapGateRun(run: GateRunRow) {
    return {
      id: run.id,
      ticketId: run.ticketId,
      targetEnv: run.targetEnv,
      releaseVersion: run.releaseVersion,
      status: run.status,
      reason: run.reason,
      failureReason: run.failureReason,
      operatorUserId: run.operatorUserId,
      traceId: run.traceId,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      createdAt: run.createdAt,
    };
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

  private ticketSubjectNos(ticket: ChangeTicketRow, approvalNo?: string | null) {
    const subjectNos: Array<{
      subjectRole: AuditSubjectRole;
      subjectType: string;
      subjectId?: string;
      subjectNo: string;
    }> = [
      {
        subjectRole: AuditSubjectRole.ENTITY,
        subjectType: AuditWorkflowTypes.CHANGE_TICKET,
        subjectId: ticket.id,
        subjectNo: ticket.ticketNo,
      },
    ];

    const resolvedApprovalNo = this.normalizeOptionalString(
      approvalNo || ticket.latestApproval?.approvalNo,
    );
    if (resolvedApprovalNo) {
      subjectNos.push({
        subjectRole: AuditSubjectRole.RELATED,
        subjectType: AuditEntityTypes.APPROVAL_CASE,
        subjectId: ticket.latestApprovalId || undefined,
        subjectNo: resolvedApprovalNo,
      });
    }

    return subjectNos;
  }

  private gateRunEntityNo(ticket: ChangeTicketRow, run: GateRunRow) {
    return `${ticket.ticketNo}:${run.targetEnv}:${run.releaseVersion}`;
  }

  private async emitChangeTicketEvent(eventName: string, payload: ChangeTicketDeployEvent) {
    if (typeof this.eventEmitter.emitAsync === 'function') {
      await this.eventEmitter.emitAsync(eventName, payload);
      return;
    }

    this.eventEmitter.emit(eventName, payload);
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
        workflowType: ChangeTicketWorkflowTypes.CHANGE_TICKET,
        workflowId: ticket.id,
        workflowNo: ticket.ticketNo,
        traceId: ticket.traceId,
        statusFrom: statusFrom || undefined,
        statusTo: statusTo || undefined,
        result,
        reason: reason || undefined,
        metadata: {
          latestApprovalId: ticket.latestApprovalId,
          latestApprovalNo: approvalNo || ticket.latestApproval?.approvalNo || null,
          latestApprovalStatus: ticket.latestApprovalStatus,
          changeType: ticket.changeType,
          emergency: ticket.emergency,
          ...(metadata || {}),
        },
        subjectNos: this.ticketSubjectNos(ticket, approvalNo),
        requestId: `CHANGE_TICKET_${ticket.ticketNo}_${action}`,
        sourcePlatform: 'ADMIN_API',
      },
      this.toAuditActor(actor),
    );
  }

  private async recordGateAudit(
    action: string,
    ticket: ChangeTicketRow,
    run: GateRunRow,
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
        module: AuditModules.GOVERNANCE_CHANGE_TICKETS,
        entityType: AuditEntityTypes.CHANGE_TICKET_GATE_RUN,
        entityId: run.id,
        entityNo: this.gateRunEntityNo(ticket, run),
        workflowType: ChangeTicketWorkflowTypes.CHANGE_TICKET,
        workflowId: ticket.id,
        workflowNo: ticket.ticketNo,
        traceId: run.traceId,
        statusFrom: statusFrom || undefined,
        statusTo: statusTo || undefined,
        result,
        reason: reason || undefined,
        metadata: {
          gateRunId: run.id,
          targetEnv: run.targetEnv,
          releaseVersion: run.releaseVersion,
          failureReason: run.failureReason,
          ...(metadata || {}),
        },
        subjectNos: this.ticketSubjectNos(ticket),
        requestId: `CHANGE_TICKET_GATE_${ticket.ticketNo}_${action}_${run.targetEnv}_${run.releaseVersion}`,
        sourcePlatform: 'ADMIN_API',
      },
      this.toAuditActor(actor),
    );
  }

  private buildActiveKey(ticketId: string, targetEnv: string, releaseVersion: string) {
    return `${ticketId}|${targetEnv}|${releaseVersion}`;
  }

  private ensureGateEvidenceComplete(ticket: ChangeTicketRow) {
    const complete =
      this.normalizeOptionalString(ticket.changeType) &&
      this.normalizeOptionalString(ticket.scopeSummary) &&
      ticket.riskLevel === ChangeTicketRiskLevels.HIGH &&
      this.normalizeOptionalString(ticket.testEvidenceRef) &&
      this.normalizeOptionalString(ticket.rollbackPlanRef) &&
      ticket.latestApprovalStatus === ApprovalStatuses.APPROVED;

    if (!complete) {
      throw new BadRequestException(
        'Gate evidence is incomplete or the latest approval is not approved',
      );
    }
  }

  private async applyApprovalProjection(
    ticket: ChangeTicketRow,
    approvalStatus: string,
    approvalNo: string | null,
    actor: ApprovalActorContext,
  ): Promise<ApprovalProjectionResult> {
    const currentApprovalStatus = this.normalizeOptionalString(ticket.latestApprovalStatus);
    const normalizedApprovalStatus = this.normalizeOptionalString(approvalStatus);
    if (!normalizedApprovalStatus) {
      return { ticket };
    }

    let nextStatus = ticket.status;
    let action: string | undefined;
    let reason: string | undefined;
    let result: AuditResult | undefined;

    if (
      normalizedApprovalStatus === ApprovalStatuses.APPROVED &&
      ([ChangeTicketStatuses.SUBMITTED, ChangeTicketStatuses.APPROVAL_PENDING] as string[]).includes(
        ticket.status,
      )
    ) {
      nextStatus = ChangeTicketStatuses.READY_FOR_DEPLOY;
      action = AuditActions.CHANGE_TICKET_APPROVED;
      reason = `Approval ${approvalNo || ticket.latestApprovalId || ''} approved`;
      result = AuditResult.SUCCESS;
    } else if (
      ([
        ApprovalStatuses.REJECTED,
        ApprovalStatuses.EXPIRED,
        ApprovalStatuses.CANCELLED,
      ] as string[]).includes(normalizedApprovalStatus) &&
      ([ChangeTicketStatuses.SUBMITTED, ChangeTicketStatuses.APPROVAL_PENDING] as string[]).includes(
        ticket.status,
      )
    ) {
      nextStatus = ChangeTicketStatuses.REJECTED;
      action = AuditActions.CHANGE_TICKET_REJECTED;
      reason = `Approval ${approvalNo || ticket.latestApprovalId || ''} ${normalizedApprovalStatus.toLowerCase()}`;
      result = AuditResult.REJECTED;
    } else if (
      normalizedApprovalStatus === ApprovalStatuses.PENDING &&
      ticket.status === ChangeTicketStatuses.SUBMITTED
    ) {
      nextStatus = ChangeTicketStatuses.APPROVAL_PENDING;
    }

    if (nextStatus === ticket.status && normalizedApprovalStatus === currentApprovalStatus) {
      return { ticket };
    }

    const updated = (await this.prisma.changeTicket.update({
      where: { id: ticket.id },
      data: {
        status: nextStatus,
        latestApprovalStatus: normalizedApprovalStatus,
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
    if (row.latestApprovalId && row.latestApprovalId !== event.approvalId) {
      return this.mapTicket(row);
    }

    const projection = await this.applyApprovalProjection(
      row,
      event.status,
      event.approvalNo,
      this.systemActor(),
    );

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
    const emergency = dto.emergency === true;
    if (emergency && !this.normalizeOptionalString(dto.emergencyReason)) {
      throw new BadRequestException('emergencyReason is required when emergency is true');
    }

    const created = await this.createTicketWithUniqueNo({
      status: ChangeTicketStatuses.DRAFT,
      changeType: dto.changeType,
      scopeSummary: dto.scopeSummary.trim(),
      riskLevel: ChangeTicketRiskLevels.HIGH,
      testEvidenceRef: dto.testEvidenceRef.trim(),
      rollbackPlanRef: dto.rollbackPlanRef.trim(),
      traceId: this.normalizeOptionalString(dto.traceId) || randomUUID(),
      emergency,
      emergencyReason: this.normalizeOptionalString(dto.emergencyReason),
      postApprovalDueAt: this.toDate(dto.postApprovalDueAt),
      createdByUserId: actor.userId,
    });

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

  async submit(id: string, dto: SubmitChangeTicketDto, actor: ApprovalActorContext) {
    const existing = await this.findTicketOrThrow(id);
    if (existing.status !== ChangeTicketStatuses.DRAFT) {
      throw new BadRequestException('Only DRAFT change tickets can be submitted');
    }
    this.assertTraceConsistency(existing.traceId, dto.traceId);

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

      const submittedAt = new Date();
      await tx.changeTicket.update({
        where: { id: ticket.id },
        data: {
          status: ChangeTicketStatuses.SUBMITTED,
          submittedByUserId: actor.userId,
          submittedAt,
        },
      });

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
          status: ChangeTicketStatuses.APPROVAL_PENDING,
          latestApprovalId: approval.id,
          latestApprovalStatus: approval.status,
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
      ChangeTicketStatuses.SUBMITTED,
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
        ChangeTicketStatuses.SUBMITTED,
        ChangeTicketStatuses.APPROVAL_PENDING,
        {
          approvalId: approval.id,
        },
        approval.approvalNo,
      );
    }

    return this.mapTicket(updated);
  }

  async resubmit(id: string, dto: ResubmitChangeTicketDto, actor: ApprovalActorContext) {
    const current = await this.findTicketOrThrow(id);
    if (current.status !== ChangeTicketStatuses.REJECTED) {
      throw new BadRequestException('Only REJECTED change tickets can be resubmitted');
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
      if (ticket.status !== ChangeTicketStatuses.REJECTED) {
        throw new BadRequestException('Only REJECTED change tickets can be resubmitted');
      }

      const submittedAt = new Date();
      await tx.changeTicket.update({
        where: { id: ticket.id },
        data: {
          status: ChangeTicketStatuses.SUBMITTED,
          submittedByUserId: actor.userId,
          submittedAt,
        },
      });

      approval = await this.approvalsService.createAndSubmit(
        {
          actionType: ApprovalActionTypes.CHANGE_TICKET_APPROVAL,
          entityRef: ticket.id,
          metadata: {
            source: 'WF06',
            ticketNo: ticket.ticketNo,
            resubmit: true,
          },
          traceId: ticket.traceId,
        },
        {
          reason:
            this.normalizeOptionalString(dto.reason) ||
            `Change ticket ${ticket.ticketNo} resubmitted`,
          traceId: ticket.traceId,
        },
        actor,
        tx,
        { emitSideEffects: false },
      );

      return (await tx.changeTicket.update({
        where: { id: ticket.id },
        data: {
          status: ChangeTicketStatuses.APPROVAL_PENDING,
          latestApprovalId: approval.id,
          latestApprovalStatus: approval.status,
        },
        include: this.ticketInclude(),
      })) as ChangeTicketRow;
    });

    await this.recordTicketAudit(
      AuditActions.CHANGE_TICKET_SUBMITTED,
      updated,
      actor,
      AuditResult.SUCCESS,
      this.normalizeOptionalString(dto.reason) || 'Change ticket resubmitted',
      ChangeTicketStatuses.REJECTED,
      ChangeTicketStatuses.SUBMITTED,
      { resubmit: true },
    );
    if (approval) {
      await this.approvalsService.emitSubmittedSideEffects(
        approval.id,
        actor,
        this.normalizeOptionalString(dto.reason) || `Change ticket ${updated.ticketNo} resubmitted`,
      );
      await this.recordTicketAudit(
        AuditActions.CHANGE_TICKET_APPROVAL_LINKED,
        updated,
        actor,
        AuditResult.SUCCESS,
        `Approval ${approval.approvalNo} linked`,
        ChangeTicketStatuses.SUBMITTED,
        ChangeTicketStatuses.APPROVAL_PENDING,
        {
          approvalId: approval.id,
          resubmit: true,
        },
        approval.approvalNo,
      );
    }

    return this.mapTicket(updated);
  }

  async close(id: string, dto: CloseChangeTicketDto, actor: ApprovalActorContext) {
    const current = await this.findTicketOrThrow(id);
    if (
      !([ChangeTicketStatuses.DEPLOYED, ChangeTicketStatuses.DEPLOY_FAILED] as string[]).includes(
        current.status,
      )
    ) {
      throw new BadRequestException('Only DEPLOYED or DEPLOY_FAILED tickets can be closed');
    }
    this.assertTraceConsistency(current.traceId, dto.traceId);

    const updated = (await this.prisma.changeTicket.update({
      where: { id: current.id },
      data: {
        status: ChangeTicketStatuses.CLOSED,
        closedByUserId: actor.userId,
        closedAt: new Date(),
      },
      include: this.ticketInclude(),
    })) as ChangeTicketRow;

    await this.recordTicketAudit(
      AuditActions.CHANGE_TICKET_CLOSED,
      updated,
      actor,
      AuditResult.SUCCESS,
      this.normalizeOptionalString(dto.reason) || 'Change ticket closed',
      current.status,
      ChangeTicketStatuses.CLOSED,
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
    if (query.latestApprovalStatus) {
      where.latestApprovalStatus = query.latestApprovalStatus.trim().toUpperCase();
    }
    if (query.traceId) {
      where.traceId = query.traceId.trim();
    }
    if (query.releaseVersion) {
      where.gateRuns = {
        some: {
          releaseVersion: query.releaseVersion.trim(),
        },
      };
    }
    if (query.keyword) {
      const keyword = query.keyword.trim();
      where.OR = [
        { ticketNo: { contains: keyword } },
        { traceId: { contains: keyword } },
        { scopeSummary: { contains: keyword } },
        { changeType: { contains: keyword } },
        { latestApprovalStatus: { contains: keyword } },
        {
          latestApproval: {
            approvalNo: { contains: keyword },
          },
        },
        {
          gateRuns: {
            some: {
              releaseVersion: { contains: keyword },
            },
          },
        },
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
      items: rows.map((row) => this.mapTicket(row as ChangeTicketRow)),
    };
  }

  async listGateRuns(ticketId: string) {
    await this.findTicketOrThrow(ticketId);
    const rows = await this.prisma.changeTicketGateRun.findMany({
      where: { ticketId },
      orderBy: [{ createdAt: 'desc' }],
    });

    return rows.map((row) => this.mapGateRun(row as GateRunRow));
  }

  async runGateCheck(
    id: string,
    input: {
      targetEnv: string;
      releaseVersion: string;
      reason?: string;
      traceId?: string;
    },
    actor: ApprovalActorContext,
  ) {
    let ticket = await this.findTicketOrThrow(id);
    this.assertTraceConsistency(ticket.traceId, input.traceId);

    if (ticket.status === ChangeTicketStatuses.DEPLOY_FAILED) {
      ticket = (await this.prisma.changeTicket.update({
        where: { id: ticket.id },
        data: { status: ChangeTicketStatuses.READY_FOR_DEPLOY },
        include: this.ticketInclude(),
      })) as ChangeTicketRow;
    }

    if (ticket.status !== ChangeTicketStatuses.READY_FOR_DEPLOY) {
      throw new BadRequestException('Change ticket is not ready for gate check');
    }
    this.ensureGateEvidenceComplete(ticket);

    const releaseVersion = input.releaseVersion.trim();
    const activeKey = this.buildActiveKey(ticket.id, input.targetEnv, releaseVersion);
    let run: GateRunRow;
    try {
      run = (await this.prisma.changeTicketGateRun.create({
        data: {
          ticketId: ticket.id,
          targetEnv: input.targetEnv,
          releaseVersion,
          status: ChangeTicketGateRunStatuses.PENDING,
          reason: this.normalizeOptionalString(input.reason),
          operatorUserId: actor.userId,
          traceId: ticket.traceId,
          activeKey,
        },
      })) as GateRunRow;
    } catch (error) {
      const maybe = error as { code?: string; meta?: { target?: string[] | string } };
      const target = maybe?.meta?.target;
      const activeConflict =
        maybe?.code === 'P2002' &&
        ((Array.isArray(target) && target.includes('activeKey')) ||
          (typeof target === 'string' && target.includes('activeKey')));
      if (activeConflict) {
        throw new ConflictException(
          'Gate check already running for this ticket, environment, and release version',
        );
      }
      throw error;
    }

    await this.recordGateAudit(
      AuditActions.RELEASE_GATE_CHECKED,
      ticket,
      run,
      actor,
      AuditResult.SUCCESS,
      this.normalizeOptionalString(input.reason) || 'Release gate check started',
      null,
      ChangeTicketGateRunStatuses.PENDING,
    );

    run = (await this.prisma.changeTicketGateRun.update({
      where: { id: run.id },
      data: {
        status: ChangeTicketGateRunStatuses.RUNNING,
        startedAt: new Date(),
      },
    })) as GateRunRow;

    const passed = (await this.prisma.changeTicketGateRun.update({
      where: { id: run.id },
      data: {
        status: ChangeTicketGateRunStatuses.PASSED,
        finishedAt: new Date(),
        activeKey: null,
      },
    })) as GateRunRow;

    await this.recordGateAudit(
      AuditActions.RELEASE_GATE_PASSED,
      ticket,
      passed,
      actor,
      AuditResult.SUCCESS,
      this.normalizeOptionalString(input.reason) || 'Release gate passed',
      ChangeTicketGateRunStatuses.RUNNING,
      ChangeTicketGateRunStatuses.PASSED,
    );

    return this.mapGateRun(passed);
  }

  async markDeployStatus(
    id: string,
    input: {
      targetEnv: string;
      releaseVersion: string;
      deployStatus: string;
      reason?: string;
      traceId?: string;
    },
    actor: ApprovalActorContext,
  ) {
    const ticket = await this.findTicketOrThrow(id);
    this.assertTraceConsistency(ticket.traceId, input.traceId);

    if (
      !([
        ChangeTicketStatuses.READY_FOR_DEPLOY,
        ChangeTicketStatuses.DEPLOY_FAILED,
      ] as string[]).includes(ticket.status)
    ) {
      throw new BadRequestException('Change ticket status does not allow deploy mark');
    }

    this.ensureGateEvidenceComplete(ticket);

    const releaseVersion = input.releaseVersion.trim();
    const passed = await this.prisma.changeTicketGateRun.findFirst({
      where: {
        ticketId: ticket.id,
        targetEnv: input.targetEnv,
        releaseVersion,
        status: ChangeTicketGateRunStatuses.PASSED,
      },
      orderBy: [{ createdAt: 'desc' }],
    });
    if (!passed) {
      throw new BadRequestException(
        'No PASSED gate run found for the selected environment and release version',
      );
    }

    if (
      input.deployStatus === ChangeTicketDeployStatuses.DEPLOY_FAILED &&
      !this.normalizeOptionalString(input.reason)
    ) {
      throw new BadRequestException('reason is required when marking deploy failed');
    }

    const nextStatus =
      input.deployStatus === ChangeTicketDeployStatuses.DEPLOYED
        ? ChangeTicketStatuses.DEPLOYED
        : ChangeTicketStatuses.DEPLOY_FAILED;

    const updated = (await this.prisma.changeTicket.update({
      where: { id: ticket.id },
      data: {
        status: nextStatus,
        deployedAt: new Date(),
      },
      include: this.ticketInclude(),
    })) as ChangeTicketRow;

    await this.recordTicketAudit(
      nextStatus === ChangeTicketStatuses.DEPLOYED
        ? AuditActions.CHANGE_TICKET_DEPLOYED
        : AuditActions.CHANGE_TICKET_DEPLOY_FAILED,
      updated,
      actor,
      nextStatus === ChangeTicketStatuses.DEPLOYED ? AuditResult.SUCCESS : AuditResult.FAILED,
      this.normalizeOptionalString(input.reason) ||
        (nextStatus === ChangeTicketStatuses.DEPLOYED
          ? 'Deploy marked as deployed'
          : 'Deploy marked as failed'),
      ticket.status,
      nextStatus,
      {
        targetEnv: input.targetEnv,
        releaseVersion,
      },
    );

    await this.emitChangeTicketEvent(ChangeTicketEvents.DEPLOY_MARKED, {
      ticketId: updated.id,
      ticketNo: updated.ticketNo,
      traceId: updated.traceId,
      status: updated.status,
    });

    return this.mapTicket(updated);
  }
}
