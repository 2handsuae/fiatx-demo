import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ComplianceIncident,
  ComplianceIncidentAlert,
  ComplianceIncidentEvent,
  Prisma,
} from '@prisma/client';
import { generateReferenceNo } from '../../../common/utils/no-generator.util';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import {
  AuditActions,
  AuditEntityTypes,
  AuditModules,
} from '../audit-logs/constants/audit-actions.constant';
import { AuditTriggerType } from '../audit-logs/dto/audit-log.dto';
import {
  ComplianceAlertAction,
  ComplianceAlertStatus,
} from '../compliance-alerts/constants/compliance-alert-rules.constant';
import { ComplianceAlertsService } from '../compliance-alerts/compliance-alerts.service';
import {
  CLOSED_INCIDENT_STATUSES,
  ComplianceIncidentAction,
  ComplianceIncidentAlertRelationType,
  ComplianceIncidentEventType,
  ComplianceIncidentSeverity,
  ComplianceIncidentStatus,
  INCIDENT_SLA_HOURS,
} from './constants/compliance-incident-rules.constant';
import {
  ComplianceIncidentActorContext,
  ComplianceIncidentQueryDto,
  CreateIncidentFromAlertDto,
  LinkIncidentAlertDto,
  UpdateComplianceIncidentActionDto,
} from './dto/compliance-incident.dto';

type IncidentWriteClient = Prisma.TransactionClient | PrismaService;

type IncidentDetailRow = ComplianceIncident & {
  alerts: Array<
    ComplianceIncidentAlert & {
      alert: {
        id: string;
        alertNo: string;
        ruleCode: string;
        severity: string;
        status: string;
        title: string;
        sourceType: string;
        sourceId: string;
        sourceNo: string | null;
        dueAt: Date;
        lastOccurredAt: Date;
      } | null;
    }
  >;
  events: ComplianceIncidentEvent[];
};

interface ActionResolution {
  nextStatus: ComplianceIncidentStatus;
  eventType: ComplianceIncidentEventType;
  auditAction: string;
  requireReason: boolean;
  statusChanged: boolean;
}

@Injectable()
export class ComplianceIncidentsService {
  private static readonly DEFAULT_TAKE = 20;
  private readonly auditLogsService: AuditLogsService;
  private readonly complianceAlertsService: ComplianceAlertsService;

  constructor(private readonly prisma: PrismaService) {
    this.auditLogsService = new AuditLogsService(prisma);
    this.complianceAlertsService = new ComplianceAlertsService(prisma);
  }

  private getDb(client?: Prisma.TransactionClient): IncidentWriteClient {
    return client ?? this.prisma;
  }

  private normalizeTake(take?: number): number {
    if (!take || take < 1) return ComplianceIncidentsService.DEFAULT_TAKE;
    return Math.min(take, 200);
  }

  private normalizeSkip(skip?: number): number {
    if (!skip || skip < 0) return 0;
    return skip;
  }

  private normalizeOptionalString(value: unknown): string | null {
    if (value === null || value === undefined) return null;
    const normalized = String(value).trim();
    return normalized.length ? normalized : null;
  }

  private serializeJson(value: unknown): string | null {
    if (value === null || value === undefined) return null;
    try {
      return JSON.stringify(value);
    } catch {
      throw new BadRequestException('Failed to serialize JSON payload');
    }
  }

  private parseJson(value?: string | null): unknown {
    if (!value) return null;
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }

  private toRetainedUntil(base: Date): Date {
    const retainedUntil = new Date(base);
    retainedUntil.setFullYear(retainedUntil.getFullYear() + 8);
    return retainedUntil;
  }

  private toDueAt(severity: ComplianceIncidentSeverity, base: Date): Date {
    const hours = INCIDENT_SLA_HOURS[severity] ?? INCIDENT_SLA_HOURS.MEDIUM;
    return new Date(base.getTime() + hours * 60 * 60 * 1000);
  }

  private isClosedStatus(status: string): boolean {
    return CLOSED_INCIDENT_STATUSES.includes(status as ComplianceIncidentStatus);
  }

  private severityRank(severity: string): number {
    switch (severity as ComplianceIncidentSeverity) {
      case ComplianceIncidentSeverity.CRITICAL:
        return 4;
      case ComplianceIncidentSeverity.HIGH:
        return 3;
      case ComplianceIncidentSeverity.MEDIUM:
        return 2;
      default:
        return 1;
    }
  }

  private pickHigherSeverity(a: string, b: string): ComplianceIncidentSeverity {
    return this.severityRank(a) >= this.severityRank(b)
      ? (a as ComplianceIncidentSeverity)
      : (b as ComplianceIncidentSeverity);
  }

  private mapIncident(row: ComplianceIncident) {
    return {
      ...row,
      closureChecklist: this.parseJson(row.closureChecklist),
      metadata: this.parseJson(row.metadata),
    };
  }

  private mapIncidentEvent(row: ComplianceIncidentEvent) {
    return {
      ...row,
      payload: this.parseJson(row.payload),
    };
  }

  private mapIncidentAlert(
    row: ComplianceIncidentAlert & {
      alert?: {
        id: string;
        alertNo: string;
        ruleCode: string;
        severity: string;
        status: string;
        title: string;
        sourceType: string;
        sourceId: string;
        sourceNo: string | null;
        dueAt: Date;
        lastOccurredAt: Date;
      } | null;
    },
  ) {
    return {
      ...row,
      alert: row.alert || null,
    };
  }

  private assertActionAllowed(
    currentStatus: ComplianceIncidentStatus,
    action: ComplianceIncidentAction,
  ) {
    switch (currentStatus) {
      case ComplianceIncidentStatus.OPEN:
        if (
          ![
            ComplianceIncidentAction.ASSIGN,
            ComplianceIncidentAction.LINK_ALERT,
          ].includes(action)
        ) {
          throw new BadRequestException(
            `Action ${action} is not allowed from status ${currentStatus}`,
          );
        }
        return;
      case ComplianceIncidentStatus.ASSIGNED:
        if (
          ![
            ComplianceIncidentAction.ASSIGN,
            ComplianceIncidentAction.RESOLVE,
            ComplianceIncidentAction.LINK_ALERT,
          ].includes(action)
        ) {
          throw new BadRequestException(
            `Action ${action} is not allowed from status ${currentStatus}`,
          );
        }
        return;
      case ComplianceIncidentStatus.RESOLVED:
        if (action !== ComplianceIncidentAction.CLOSE) {
          throw new BadRequestException(
            `Action ${action} is not allowed from status ${currentStatus}`,
          );
        }
        return;
      case ComplianceIncidentStatus.CLOSED:
        throw new BadRequestException(
          `Action ${action} is not allowed from terminal status ${currentStatus}`,
        );
      default:
        throw new BadRequestException(`Unsupported incident status: ${currentStatus}`);
    }
  }

  private resolveAction(
    action: ComplianceIncidentAction,
    currentStatus: ComplianceIncidentStatus,
  ): ActionResolution {
    switch (action) {
      case ComplianceIncidentAction.ASSIGN:
        return {
          nextStatus: ComplianceIncidentStatus.ASSIGNED,
          eventType: ComplianceIncidentEventType.ASSIGNED,
          auditAction: AuditActions.INCIDENT_ASSIGNED,
          requireReason: false,
          statusChanged: currentStatus !== ComplianceIncidentStatus.ASSIGNED,
        };
      case ComplianceIncidentAction.RESOLVE:
        return {
          nextStatus: ComplianceIncidentStatus.RESOLVED,
          eventType: ComplianceIncidentEventType.RESOLVED,
          auditAction: AuditActions.INCIDENT_RESOLVED,
          requireReason: true,
          statusChanged: currentStatus !== ComplianceIncidentStatus.RESOLVED,
        };
      case ComplianceIncidentAction.CLOSE:
        return {
          nextStatus: ComplianceIncidentStatus.CLOSED,
          eventType: ComplianceIncidentEventType.CLOSED,
          auditAction: AuditActions.INCIDENT_CLOSED,
          requireReason: true,
          statusChanged: currentStatus !== ComplianceIncidentStatus.CLOSED,
        };
      case ComplianceIncidentAction.LINK_ALERT:
        throw new BadRequestException(
          'Action LINK_ALERT must use POST /admin/compliance/incidents/:id/alerts',
        );
      default:
        throw new BadRequestException(`Unsupported action: ${action}`);
    }
  }

  private async resolveUserNo(
    userId: string,
    db: IncidentWriteClient,
  ): Promise<string | null> {
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { userNo: true },
    });
    return user?.userNo || null;
  }

  private async appendEvent(
    db: IncidentWriteClient,
    input: {
      incidentId: string;
      eventType: ComplianceIncidentEventType;
      eventAt: Date;
      actorType: string;
      actorId: string;
      actorNo?: string | null;
      actorRole?: string | null;
      note?: string | null;
      payload?: Record<string, unknown> | null;
      sourcePlatform?: string | null;
    },
  ) {
    await db.complianceIncidentEvent.create({
      data: {
        incidentId: input.incidentId,
        eventType: input.eventType,
        eventAt: input.eventAt,
        actorType: input.actorType,
        actorId: input.actorId,
        actorNo: input.actorNo || null,
        actorRole: input.actorRole || null,
        note: input.note || null,
        payload: this.serializeJson(input.payload),
        sourcePlatform: input.sourcePlatform || null,
      },
    });
  }

  async findAll(query: ComplianceIncidentQueryDto) {
    const skip = this.normalizeSkip(query.skip);
    const take = this.normalizeTake(query.take);
    const where: Prisma.ComplianceIncidentWhereInput = {};
    const andConditions: Prisma.ComplianceIncidentWhereInput[] = [];

    if (query.status) where.status = query.status;
    if (query.severity) where.severity = query.severity;
    if (query.customerNo) where.customerNo = query.customerNo;
    if (query.ownerUserId) where.ownerUserId = query.ownerUserId;

    const incidentNo = this.normalizeOptionalString(query.incidentNo);
    if (incidentNo) {
      where.incidentNo = { contains: incidentNo };
    }

    const alertNo = this.normalizeOptionalString(query.alertNo);
    if (alertNo) {
      andConditions.push({
        alerts: {
          some: {
            alertNo: {
              contains: alertNo,
            },
          },
        },
      });
    }

    const keyword = this.normalizeOptionalString(query.keyword);
    if (keyword) {
      andConditions.push({
        OR: [
          { incidentNo: { contains: keyword } },
          { title: { contains: keyword } },
          { summary: { contains: keyword } },
          { customerNo: { contains: keyword } },
          { primaryAlertNo: { contains: keyword } },
        ],
      });
    }

    if (query.overdueOnly) {
      andConditions.push({
        dueAt: { lt: new Date() },
      });
      andConditions.push({
        status: { notIn: CLOSED_INCIDENT_STATUSES },
      });
    }

    if (andConditions.length > 0) {
      where.AND = andConditions;
    }

    const [total, items] = await Promise.all([
      this.prisma.complianceIncident.count({ where }),
      this.prisma.complianceIncident.findMany({
        where,
        skip,
        take,
        orderBy: [{ lastActionAt: 'desc' }, { createdAt: 'desc' }],
      }),
    ]);

    return {
      total,
      skip,
      take,
      items: items.map((item) => this.mapIncident(item)),
    };
  }

  async findOne(id: string) {
    const item = await this.prisma.complianceIncident.findUnique({
      where: { id },
      include: {
        alerts: {
          include: {
            alert: {
              select: {
                id: true,
                alertNo: true,
                ruleCode: true,
                severity: true,
                status: true,
                title: true,
                sourceType: true,
                sourceId: true,
                sourceNo: true,
                dueAt: true,
                lastOccurredAt: true,
              },
            },
          },
          orderBy: [{ relationType: 'asc' }, { linkedAt: 'desc' }],
        },
        events: {
          orderBy: { eventAt: 'desc' },
        },
      },
    });

    if (!item) {
      throw new NotFoundException(`Compliance incident not found: ${id}`);
    }

    const row = item as IncidentDetailRow;

    return {
      ...this.mapIncident(row),
      alerts: row.alerts.map((alertLink) => this.mapIncidentAlert(alertLink)),
      events: row.events.map((event) => this.mapIncidentEvent(event)),
    };
  }

  async createFromAlert(
    alertId: string,
    dto: CreateIncidentFromAlertDto,
    actor: ComplianceIncidentActorContext,
  ) {
    const reason = this.normalizeOptionalString(dto.reason);
    if (!reason) {
      throw new BadRequestException('reason is required');
    }

    const createdIncidentId = await this.prisma.$transaction(async (tx) => {
      const existingLink = await tx.complianceIncidentAlert.findUnique({
        where: { alertId },
        select: { incidentId: true },
      });
      if (existingLink) {
        throw new ConflictException(
          `Alert ${alertId} already linked to incident ${existingLink.incidentId}`,
        );
      }

      const updatedAlert = await this.complianceAlertsService.applyAction(
        alertId,
        {
          action: ComplianceAlertAction.ESCALATE,
          reason,
          note: reason,
        },
        actor,
        tx,
      );

      if (updatedAlert.status !== ComplianceAlertStatus.ESCALATED) {
        throw new BadRequestException(
          `Alert ${alertId} must be ESCALATED before incident creation`,
        );
      }

      const now = new Date();
      const incident = await tx.complianceIncident.create({
        data: {
          incidentNo: generateReferenceNo('INC'),
          status: ComplianceIncidentStatus.OPEN,
          severity: updatedAlert.severity,
          title: updatedAlert.title,
          summary: reason,
          primaryAlertId: updatedAlert.id,
          primaryAlertNo: updatedAlert.alertNo,
          customerId: updatedAlert.customerId,
          customerNo: updatedAlert.customerNo,
          entityType: updatedAlert.entityType,
          entityId: updatedAlert.entityId,
          entityNo: updatedAlert.entityNo,
          sourceModule: updatedAlert.sourceModule,
          sourceType: updatedAlert.sourceType,
          ownerUserId: null,
          ownerUserNo: null,
          alertCount: 1,
          firstAlertAt: updatedAlert.firstOccurredAt,
          lastAlertAt: updatedAlert.lastOccurredAt,
          dueAt:
            updatedAlert.dueAt ||
            this.toDueAt(updatedAlert.severity as ComplianceIncidentSeverity, now),
          lastActionById: actor.actorId,
          lastActionByNo: actor.actorNo || null,
          lastActionByRole: actor.actorRole || null,
          lastActionAt: now,
          metadata: this.serializeJson({
            createReason: reason,
            createdFromAlertId: updatedAlert.id,
            createdFromAlertNo: updatedAlert.alertNo,
            sourceType: updatedAlert.sourceType,
            sourceId: updatedAlert.sourceId,
          }),
          retainedUntil: updatedAlert.retainedUntil || this.toRetainedUntil(now),
        },
      });

      await tx.complianceIncidentAlert.create({
        data: {
          incidentId: incident.id,
          alertId: updatedAlert.id,
          alertNo: updatedAlert.alertNo,
          relationType: ComplianceIncidentAlertRelationType.PRIMARY,
          linkedAt: now,
          linkedByType: actor.actorType,
          linkedById: actor.actorId,
          linkedByNo: actor.actorNo || null,
          linkedByRole: actor.actorRole || null,
          note: reason,
        },
      });

      await this.appendEvent(tx, {
        incidentId: incident.id,
        eventType: ComplianceIncidentEventType.CREATED,
        eventAt: now,
        actorType: actor.actorType,
        actorId: actor.actorId,
        actorNo: actor.actorNo || null,
        actorRole: actor.actorRole || null,
        note: reason,
        payload: {
          primaryAlertId: updatedAlert.id,
          primaryAlertNo: updatedAlert.alertNo,
          action: 'ESCALATE_FROM_ALERT',
        },
        sourcePlatform: actor.sourcePlatform || 'ADMIN_API',
      });

      await this.auditLogsService.recordByActor(
        {
          triggerType: AuditTriggerType.DATA_CREATE,
          action: AuditActions.INCIDENT_CREATED,
          module: AuditModules.COMPLIANCE_INCIDENTS,
          entityType: AuditEntityTypes.COMPLIANCE_INCIDENT,
          entityId: incident.id,
          entityNo: incident.incidentNo,
          entityOwnerType: updatedAlert.ownerType || undefined,
          entityOwnerId: updatedAlert.ownerId || undefined,
          reason,
          metadata: {
            primaryAlertId: updatedAlert.id,
            primaryAlertNo: updatedAlert.alertNo,
            severity: incident.severity,
          },
          sourcePlatform: actor.sourcePlatform || 'ADMIN_API',
        },
        {
          actorType: actor.actorType,
          actorId: actor.actorId,
          actorNo: actor.actorNo,
          actorRole: actor.actorRole,
        },
        tx,
      );

      return incident.id;
    });

    return this.findOne(createdIncidentId);
  }

  async linkAlert(
    incidentId: string,
    dto: LinkIncidentAlertDto,
    actor: ComplianceIncidentActorContext,
  ) {
    const alertId = this.normalizeOptionalString(dto.alertId);
    if (!alertId) {
      throw new BadRequestException('alertId is required');
    }

    const note = this.normalizeOptionalString(dto.note);

    await this.prisma.$transaction(async (tx) => {
      const incident = await tx.complianceIncident.findUnique({
        where: { id: incidentId },
      });
      if (!incident) {
        throw new NotFoundException(`Compliance incident not found: ${incidentId}`);
      }

      const status = incident.status as ComplianceIncidentStatus;
      if (
        ![
          ComplianceIncidentStatus.OPEN,
          ComplianceIncidentStatus.ASSIGNED,
        ].includes(status)
      ) {
        throw new BadRequestException(
          `Incident ${incidentId} must be OPEN or ASSIGNED to link alerts`,
        );
      }

      const existingLink = await tx.complianceIncidentAlert.findUnique({
        where: { alertId },
        select: { incidentId: true },
      });
      if (existingLink) {
        throw new ConflictException(
          `Alert ${alertId} already linked to incident ${existingLink.incidentId}`,
        );
      }

      const alert = await tx.complianceAlert.findUnique({
        where: { id: alertId },
        select: {
          id: true,
          alertNo: true,
          severity: true,
          customerId: true,
          customerNo: true,
          lastOccurredAt: true,
          dueAt: true,
        },
      });
      if (!alert) {
        throw new NotFoundException(`Compliance alert not found: ${alertId}`);
      }

      const now = new Date();
      await tx.complianceIncidentAlert.create({
        data: {
          incidentId,
          alertId: alert.id,
          alertNo: alert.alertNo,
          relationType: ComplianceIncidentAlertRelationType.RELATED,
          linkedAt: now,
          linkedByType: actor.actorType,
          linkedById: actor.actorId,
          linkedByNo: actor.actorNo || null,
          linkedByRole: actor.actorRole || null,
          note,
        },
      });

      const higherSeverity = this.pickHigherSeverity(
        incident.severity,
        alert.severity,
      );
      const nextDueAt =
        incident.dueAt.getTime() <= alert.dueAt.getTime()
          ? incident.dueAt
          : alert.dueAt;
      const nextLastAlertAt =
        incident.lastAlertAt.getTime() >= alert.lastOccurredAt.getTime()
          ? incident.lastAlertAt
          : alert.lastOccurredAt;

      await tx.complianceIncident.update({
        where: { id: incidentId },
        data: {
          severity: higherSeverity,
          dueAt: nextDueAt,
          lastAlertAt: nextLastAlertAt,
          alertCount: incident.alertCount + 1,
          customerId: incident.customerId || alert.customerId,
          customerNo: incident.customerNo || alert.customerNo,
          lastActionById: actor.actorId,
          lastActionByNo: actor.actorNo || null,
          lastActionByRole: actor.actorRole || null,
          lastActionAt: now,
        },
      });

      await this.appendEvent(tx, {
        incidentId,
        eventType: ComplianceIncidentEventType.ALERT_LINKED,
        eventAt: now,
        actorType: actor.actorType,
        actorId: actor.actorId,
        actorNo: actor.actorNo || null,
        actorRole: actor.actorRole || null,
        note: note || `Linked alert ${alert.alertNo}`,
        payload: {
          alertId: alert.id,
          alertNo: alert.alertNo,
          relationType: ComplianceIncidentAlertRelationType.RELATED,
        },
        sourcePlatform: actor.sourcePlatform || 'ADMIN_API',
      });

      await this.auditLogsService.recordByActor(
        {
          triggerType: AuditTriggerType.DATA_UPDATE,
          action: AuditActions.INCIDENT_ALERT_LINKED,
          module: AuditModules.COMPLIANCE_INCIDENTS,
          entityType: AuditEntityTypes.COMPLIANCE_INCIDENT,
          entityId: incidentId,
          entityNo: incident.incidentNo,
          reason: note || `Linked alert ${alert.alertNo}`,
          metadata: {
            linkedAlertId: alert.id,
            linkedAlertNo: alert.alertNo,
          },
          sourcePlatform: actor.sourcePlatform || 'ADMIN_API',
        },
        {
          actorType: actor.actorType,
          actorId: actor.actorId,
          actorNo: actor.actorNo,
          actorRole: actor.actorRole,
        },
        tx,
      );
    });

    return this.findOne(incidentId);
  }

  async applyAction(
    id: string,
    dto: UpdateComplianceIncidentActionDto,
    actor: ComplianceIncidentActorContext,
  ) {
    const current = await this.prisma.complianceIncident.findUnique({
      where: { id },
    });

    if (!current) {
      throw new NotFoundException(`Compliance incident not found: ${id}`);
    }

    const currentStatus = current.status as ComplianceIncidentStatus;
    this.assertActionAllowed(currentStatus, dto.action);

    const resolution = this.resolveAction(dto.action, currentStatus);
    const reason = this.normalizeOptionalString(dto.reason);
    const note = this.normalizeOptionalString(dto.note);
    const decision = this.normalizeOptionalString(dto.decision);
    const linkedCaseIds = this.serializeJson(dto.linkedCaseIds || null);
    const decisionRecordIds = this.serializeJson(dto.decisionRecordIds || null);

    if (resolution.requireReason && !reason) {
      throw new BadRequestException(`Action ${dto.action} requires a reason`);
    }

    const now = new Date();
    const updateData: Prisma.ComplianceIncidentUpdateInput = {
      status: resolution.nextStatus,
      lastActionById: actor.actorId,
      lastActionByNo: actor.actorNo || null,
      lastActionByRole: actor.actorRole || null,
      lastActionAt: now,
      decision: decision || undefined,
      linkedCaseIds: linkedCaseIds || undefined,
      decisionRecordIds: decisionRecordIds || undefined,
    };

    let assigneeUserId: string | null = null;
    let assigneeUserNo: string | null = null;

    if (dto.action === ComplianceIncidentAction.ASSIGN) {
      assigneeUserId = this.normalizeOptionalString(dto.assigneeUserId) || actor.actorId;
      assigneeUserNo = await this.resolveUserNo(assigneeUserId, this.prisma);
      if (!assigneeUserNo) {
        throw new BadRequestException(`Assignee user not found: ${assigneeUserId}`);
      }

      updateData.ownerUserId = assigneeUserId;
      updateData.ownerUserNo = assigneeUserNo;
      updateData.assignedAt = now;
    }

    if (dto.action === ComplianceIncidentAction.RESOLVE) {
      updateData.resolvedAt = now;
      updateData.closeReason = reason || note || null;
    }

    if (dto.action === ComplianceIncidentAction.CLOSE) {
      updateData.closedAt = now;
      updateData.closeReason = reason || note || null;
    }

    const updated = await this.prisma.complianceIncident.update({
      where: { id },
      data: updateData,
    });

    await this.appendEvent(this.prisma, {
      incidentId: updated.id,
      eventType: resolution.eventType,
      eventAt: now,
      actorType: actor.actorType,
      actorId: actor.actorId,
      actorNo: actor.actorNo || null,
      actorRole: actor.actorRole || null,
      note: note || reason || `${dto.action} executed`,
      payload: {
        action: dto.action,
        reason: reason || null,
        note: note || null,
        assigneeUserId,
        assigneeUserNo,
        decision,
        linkedCaseIds: dto.linkedCaseIds || null,
        decisionRecordIds: dto.decisionRecordIds || null,
        statusFrom: currentStatus,
        statusTo: updated.status,
      },
      sourcePlatform: actor.sourcePlatform || 'ADMIN_API',
    });

    await this.auditLogsService.recordByActor(
      {
        triggerType: AuditTriggerType.DATA_UPDATE,
        action: resolution.auditAction,
        module: AuditModules.COMPLIANCE_INCIDENTS,
        entityType: AuditEntityTypes.COMPLIANCE_INCIDENT,
        entityId: updated.id,
        entityNo: updated.incidentNo,
        statusFrom: resolution.statusChanged ? currentStatus : undefined,
        statusTo: resolution.statusChanged ? updated.status : undefined,
        reason: reason || note || `${dto.action} executed`,
        metadata: {
          action: dto.action,
          assigneeUserId,
          assigneeUserNo,
          decision,
          linkedCaseIds: dto.linkedCaseIds || null,
          decisionRecordIds: dto.decisionRecordIds || null,
        },
        sourcePlatform: actor.sourcePlatform || 'ADMIN_API',
      },
      {
        actorType: actor.actorType,
        actorId: actor.actorId,
        actorNo: actor.actorNo,
        actorRole: actor.actorRole,
      },
    );

    return this.findOne(updated.id);
  }
}
