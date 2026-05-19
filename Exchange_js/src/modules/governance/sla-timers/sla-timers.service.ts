import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { generateReferenceNo } from '../../../common/utils/no-generator.util';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import {
  AuditActions,
  AuditBusinessWorkflowTypes,
  AuditEntityTypes,
  AuditModules,
  AuditWorkflowTypes,
} from '../../audit-logging/constants/audit-actions.constant';
import {
  AuditResult,
  AuditSubjectRole,
} from '../../audit-logging/dto/audit-log.dto';
import { ApprovalsService } from '../approvals/approvals.service';
import {
  ApprovalActorContext,
  ApprovalStatuses,
} from '../approvals/constants/approval.constants';
import {
  DEFAULT_SLA_DEMO_DUE_IN_SECONDS,
  DEFAULT_SLA_TIMER_GRACE_SECONDS,
  SlaNotificationStatuses,
  SlaNotificationTypes,
  SLA_TIMER_STATUS_VALUES,
  SlaTimerStatuses,
  SlaTimerSubjectTypes,
  SlaTimerTypes,
  SlaTimerWorkflowTypes,
} from './constants/sla-timer.constants';
import {
  CloseSlaTimerDto,
  RecalcSlaTimerDto,
  SlaTimerQueryDto,
} from './dto/sla-timer.dto';

type SlaTimerWriteClient = any;
type SlaNotificationRow = Record<string, any>;
type SlaTimerRow = {
  [key: string]: any;
  notifications?: SlaNotificationRow[];
};

@Injectable()
export class SlaTimersService {
  private static readonly DEFAULT_TAKE = 20;
  private static readonly MAX_TIMER_NO_RETRIES = 10;

  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService & Record<string, any>,
    private readonly auditLogsService: AuditLogsService,
    private readonly approvalsService: ApprovalsService,
  ) {}

  private getDb(client?: SlaTimerWriteClient): SlaTimerWriteClient {
    return client ?? this.prisma;
  }

  private normalizeOptionalString(value: unknown): string | null {
    if (value === null || value === undefined) return null;
    const normalized = String(value).trim();
    return normalized.length ? normalized : null;
  }

  private normalizeSkip(skip?: number): number {
    if (!skip || skip < 0) return 0;
    return skip;
  }

  private normalizeTake(take?: number): number {
    if (!take || take < 1) return SlaTimersService.DEFAULT_TAKE;
    return Math.min(take, 200);
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

  private defaultGraceSeconds() {
    const value = Number(
      this.normalizeOptionalString(process.env.SLA_TIMER_GRACE_SECONDS) ||
        DEFAULT_SLA_TIMER_GRACE_SECONDS,
    );
    if (!Number.isFinite(value) || value < 0) {
      return DEFAULT_SLA_TIMER_GRACE_SECONDS;
    }
    return Math.floor(value);
  }

  private defaultDemoDueSeconds() {
    return DEFAULT_SLA_DEMO_DUE_IN_SECONDS;
  }

  private timerInclude(withNotifications = false) {
    if (!withNotifications) {
      return undefined;
    }

    return {
      notifications: {
        orderBy: [{ scheduledAt: 'desc' as const }, { createdAt: 'desc' as const }],
      },
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

  private toAuditActor(actor: ApprovalActorContext) {
    return {
      actorType: actor.actorType,
      actorId: actor.userId,
      actorNo: actor.userNo,
      actorRole: actor.role || actor.roleCodes[0] || 'UNKNOWN',
    };
  }

  private buildActiveKey(
    workflowType: string,
    subjectType: string,
    subjectId: string,
    timerType: string,
  ) {
    return `${workflowType}|${subjectType}|${subjectId}|${timerType}`;
  }

  private timerSubjectNos(timer: SlaTimerRow) {
    const subjectNos: Array<{
      subjectRole: AuditSubjectRole;
      subjectType: string;
      subjectId?: string;
      subjectNo: string;
    }> = [
      {
        subjectRole: AuditSubjectRole.ENTITY,
        subjectType: AuditEntityTypes.SLA_TIMER,
        subjectId: timer.id,
        subjectNo: timer.timerNo,
      },
      {
        subjectRole: AuditSubjectRole.RELATED,
        subjectType: timer.workflowType,
        subjectId: timer.workflowId,
        subjectNo: timer.workflowNo,
      },
    ];

    if (timer.subjectNo !== timer.workflowNo) {
      subjectNos.push({
        subjectRole: AuditSubjectRole.RELATED,
        subjectType: timer.subjectType,
        subjectId: timer.subjectId,
        subjectNo: timer.subjectNo,
      });
    }

    return subjectNos;
  }

  private mapNotification(notification: SlaNotificationRow) {
    return {
      id: notification.id,
      notificationType: notification.notificationType,
      status: notification.status,
      scheduledAt: notification.scheduledAt,
      triggeredAt: notification.triggeredAt,
      reasonCode: notification.reasonCode,
      message: notification.message,
      metadataJson:
        this.parseJson<Record<string, unknown>>(notification.metadataJson) || {},
      createdAt: notification.createdAt,
      updatedAt: notification.updatedAt,
    };
  }

  private buildNotificationSummary(notifications: SlaNotificationRow[]) {
    const sorted = [...notifications].sort((left, right) => {
      const rightTs =
        right.triggeredAt?.getTime() || right.scheduledAt.getTime() || right.createdAt.getTime();
      const leftTs =
        left.triggeredAt?.getTime() || left.scheduledAt.getTime() || left.createdAt.getTime();
      return rightTs - leftTs;
    });
    const latest = sorted[0];

    return {
      total: notifications.length,
      scheduledCount: notifications.filter(
        (item) => item.status === SlaNotificationStatuses.SCHEDULED,
      ).length,
      triggeredCount: notifications.filter(
        (item) => item.status === SlaNotificationStatuses.TRIGGERED,
      ).length,
      skippedCount: notifications.filter(
        (item) => item.status === SlaNotificationStatuses.SKIPPED,
      ).length,
      latestType: latest?.notificationType || null,
      latestStatus: latest?.status || null,
      latestAt:
        latest?.triggeredAt?.toISOString() ||
        latest?.scheduledAt?.toISOString() ||
        latest?.createdAt?.toISOString() ||
        null,
    };
  }

  private async recordNotificationAudit(
    action: string,
    timer: SlaTimerRow,
    notification: SlaNotificationRow,
    actor: ApprovalActorContext,
    result: AuditResult,
    reason?: string | null,
    metadata?: Record<string, unknown>,
  ) {
    await this.recordTimerAudit(action, timer, actor, result, reason, {
      notificationId: notification.id,
      notificationType: notification.notificationType,
      notificationStatus: notification.status,
      scheduledAt: notification.scheduledAt.toISOString(),
      triggeredAt: notification.triggeredAt?.toISOString() || null,
      reasonCode: notification.reasonCode,
      ...(metadata || {}),
    });
  }

  private async findNotifications(
    timerId: string,
    client?: SlaTimerWriteClient,
  ): Promise<SlaNotificationRow[]> {
    const db = this.getDb(client);
    return (await db.slaNotification.findMany({
      where: { timerId },
      orderBy: [{ scheduledAt: 'desc' }, { createdAt: 'desc' }],
    })) as SlaNotificationRow[];
  }

  private async upsertScheduledNotification(
    timer: SlaTimerRow,
    input: {
      notificationType: string;
      scheduledAt: Date;
      reasonCode: string;
      message: string;
      metadata?: Record<string, unknown>;
      resetTriggered?: boolean;
    },
    actor: ApprovalActorContext,
    client?: SlaTimerWriteClient,
  ) {
    const db = this.getDb(client);
    const existing = await db.slaNotification.findFirst({
      where: {
        timerId: timer.id,
        notificationType: input.notificationType,
      },
      orderBy: { createdAt: 'desc' },
    });

    if (existing) {
      const nextStatus =
        input.resetTriggered || existing.status === SlaNotificationStatuses.SKIPPED
          ? SlaNotificationStatuses.SCHEDULED
          : existing.status;
      const updated = (await db.slaNotification.update({
        where: { id: existing.id },
        data: {
          status: nextStatus,
          scheduledAt: input.scheduledAt,
          triggeredAt:
            nextStatus === SlaNotificationStatuses.SCHEDULED ? null : existing.triggeredAt,
          reasonCode: input.reasonCode,
          message: input.message,
          metadataJson: this.serializeJson(input.metadata || {}),
        },
      })) as SlaNotificationRow;

      if (nextStatus === SlaNotificationStatuses.SCHEDULED) {
        await this.recordNotificationAudit(
          AuditActions.SLA_NOTIFICATION_SCHEDULED,
          timer,
          updated,
          actor,
          AuditResult.SUCCESS,
          input.message,
        );
      }
      return updated;
    }

    const created = (await db.slaNotification.create({
      data: {
        timerId: timer.id,
        notificationType: input.notificationType,
        status: SlaNotificationStatuses.SCHEDULED,
        scheduledAt: input.scheduledAt,
        reasonCode: input.reasonCode,
        message: input.message,
        metadataJson: this.serializeJson(input.metadata || {}),
      },
    })) as SlaNotificationRow;

    await this.recordNotificationAudit(
      AuditActions.SLA_NOTIFICATION_SCHEDULED,
      timer,
      created,
      actor,
      AuditResult.SUCCESS,
      input.message,
    );
    return created;
  }

  private async triggerNotification(
    timer: SlaTimerRow,
    notificationType: string,
    input: {
      reasonCode: string;
      message: string;
      metadata?: Record<string, unknown>;
      scheduledAt?: Date;
    },
    actor: ApprovalActorContext,
    client?: SlaTimerWriteClient,
  ) {
    const db = this.getDb(client);
    const existing = await db.slaNotification.findFirst({
      where: {
        timerId: timer.id,
        notificationType,
      },
      orderBy: { createdAt: 'desc' },
    });

    const now = new Date();
    const scheduledAt = input.scheduledAt || existing?.scheduledAt || timer.dueAt;

    if (existing) {
      if (existing.status === SlaNotificationStatuses.TRIGGERED) {
        return existing as SlaNotificationRow;
      }
      const updated = (await db.slaNotification.update({
        where: { id: existing.id },
        data: {
          status: SlaNotificationStatuses.TRIGGERED,
          scheduledAt,
          triggeredAt: now,
          reasonCode: input.reasonCode,
          message: input.message,
          metadataJson: this.serializeJson(input.metadata || {}),
        },
      })) as SlaNotificationRow;
      await this.recordNotificationAudit(
        AuditActions.SLA_NOTIFICATION_TRIGGERED,
        timer,
        updated,
        actor,
        AuditResult.SUCCESS,
        input.message,
      );
      return updated;
    }

    const created = (await db.slaNotification.create({
      data: {
        timerId: timer.id,
        notificationType,
        status: SlaNotificationStatuses.TRIGGERED,
        scheduledAt,
        triggeredAt: now,
        reasonCode: input.reasonCode,
        message: input.message,
        metadataJson: this.serializeJson(input.metadata || {}),
      },
    })) as SlaNotificationRow;

    await this.recordNotificationAudit(
      AuditActions.SLA_NOTIFICATION_TRIGGERED,
      timer,
      created,
      actor,
      AuditResult.SUCCESS,
      input.message,
    );
    return created;
  }

  private async skipScheduledNotifications(
    timer: SlaTimerRow,
    input: {
      reasonCode: string;
      message: string;
      metadata?: Record<string, unknown>;
    },
    actor: ApprovalActorContext,
    client?: SlaTimerWriteClient,
  ) {
    const db = this.getDb(client);
    const notifications = (await db.slaNotification.findMany({
      where: {
        timerId: timer.id,
        status: SlaNotificationStatuses.SCHEDULED,
      },
      orderBy: { createdAt: 'asc' },
    })) as SlaNotificationRow[];

    const now = new Date();
    const skipped: SlaNotificationRow[] = [];
    for (const notification of notifications) {
      const updated = (await db.slaNotification.update({
        where: { id: notification.id },
        data: {
          status: SlaNotificationStatuses.SKIPPED,
          triggeredAt: now,
          reasonCode: input.reasonCode,
          message: input.message,
          metadataJson: this.serializeJson(input.metadata || {}),
        },
      })) as SlaNotificationRow;
      skipped.push(updated);
      await this.recordNotificationAudit(
        AuditActions.SLA_NOTIFICATION_SKIPPED,
        timer,
        updated,
        actor,
        AuditResult.SUCCESS,
        input.message,
      );
    }

    return skipped;
  }

  private static readonly WORKFLOW_OWNS_AUDIT: string[] = [
    AuditBusinessWorkflowTypes.AUDIT_EVIDENCE_EXPORT,
    AuditBusinessWorkflowTypes.ADMIN_INVITE,
  ];

  private async recordTimerAudit(
    action: string,
    timer: SlaTimerRow,
    actor: ApprovalActorContext,
    result: AuditResult,
    reason?: string | null,
    metadata?: Record<string, unknown>,
  ) {
    if (timer.workflowType && SlaTimersService.WORKFLOW_OWNS_AUDIT.includes(timer.workflowType)) {
      return;
    }
    await this.auditLogsService.recordByActor(
      {
        action,
        entityType: AuditEntityTypes.SLA_TIMER,
        entityId: timer.id,
        entityNo: timer.timerNo,
        workflowType: timer.workflowType,
        traceId: timer.traceId,
        result,
        reason: reason || undefined,
        metadata: {
          timerType: timer.timerType,
          subjectType: timer.subjectType,
          subjectId: timer.subjectId,
          subjectNo: timer.subjectNo,
          ownerUserId: timer.ownerUserId,
          dueAt: timer.dueAt.toISOString(),
          graceSeconds: timer.graceSeconds,
          ...(metadata || {}),
        },
        subjectNos: this.timerSubjectNos(timer),
        requestId: `SLA_TIMER_${timer.timerNo}_${action}`,
        sourcePlatform: 'ADMIN_API',
      },
      this.toAuditActor(actor),
    );
  }

  private mapTimer(timer: SlaTimerRow) {
    const notifications = Array.isArray(timer.notifications)
      ? timer.notifications.map((item) => this.mapNotification(item))
      : [];

    return {
      id: timer.id,
      timerNo: timer.timerNo,
      timerType: timer.timerType,
      status: timer.status,
      workflowType: timer.workflowType,
      workflowId: timer.workflowId,
      workflowNo: timer.workflowNo,
      subjectType: timer.subjectType,
      subjectId: timer.subjectId,
      subjectNo: timer.subjectNo,
      ownerUserId: timer.ownerUserId,
      dueAt: timer.dueAt,
      graceSeconds: timer.graceSeconds,
      traceId: timer.traceId,
      contextJson: this.parseJson<Record<string, unknown>>(timer.contextJson) || {},
      notificationSummary: this.buildNotificationSummary(timer.notifications || []),
      notifications,
      closedAt: timer.closedAt,
      expiredAt: timer.expiredAt,
      createdAt: timer.createdAt,
      updatedAt: timer.updatedAt,
    };
  }

  private async findTimerOrThrow(
    id: string,
    withNotifications = false,
    client?: SlaTimerWriteClient,
  ): Promise<SlaTimerRow> {
    const db = this.getDb(client);
    const found = await db.slaTimer.findUnique({
      where: { id },
      include: this.timerInclude(withNotifications),
    });

    if (!found) {
      throw new NotFoundException(`SLA timer not found: ${id}`);
    }

    return found as SlaTimerRow;
  }

  private isUniqueConflict(error: unknown, field: string): boolean {
    const maybe = error as { code?: string; meta?: { target?: string[] | string } };
    if (maybe?.code !== 'P2002') return false;
    const target = maybe.meta?.target;
    if (Array.isArray(target)) return target.includes(field);
    if (typeof target === 'string') return target.includes(field);
    return false;
  }

  private async createTimerWithUniqueNo(
    data: Record<string, any>,
    client?: SlaTimerWriteClient,
  ): Promise<SlaTimerRow> {
    const db = this.getDb(client);
    for (let i = 0; i < SlaTimersService.MAX_TIMER_NO_RETRIES; i += 1) {
      try {
        return (await db.slaTimer.create({
          data: {
            ...data,
            timerNo: generateReferenceNo('TM'),
          },
        })) as SlaTimerRow;
      } catch (error) {
        if (this.isUniqueConflict(error, 'timerNo')) {
          continue;
        }
        throw error;
      }
    }

    throw new ConflictException('Failed to generate unique timerNo');
  }

  private async closeTimerRow(
    timer: SlaTimerRow,
    actor: ApprovalActorContext,
    reason: string,
    metadata?: Record<string, unknown>,
    client?: SlaTimerWriteClient,
  ) {
    const db = this.getDb(client);
    if (timer.status !== SlaTimerStatuses.ACTIVE) {
      return timer;
    }

    await this.skipScheduledNotifications(
      timer,
      {
        reasonCode: 'TIMER_CLOSED',
        message: reason,
        metadata,
      },
      actor,
      client,
    );

    const updated = (await db.slaTimer.update({
      where: { id: timer.id },
      data: {
        status: SlaTimerStatuses.CLOSED,
        closedAt: new Date(),
        activeKey: null,
      },
    })) as SlaTimerRow;

    await this.recordTimerAudit(
      AuditActions.SLA_TIMER_CLOSED,
      updated,
      actor,
      AuditResult.SUCCESS,
      reason,
      metadata,
    );

    updated.notifications = await this.findNotifications(updated.id, client);

    return updated;
  }

  private async expireTimerRow(
    timer: SlaTimerRow,
    actor: ApprovalActorContext,
    reason: string,
    metadata?: Record<string, unknown>,
    client?: SlaTimerWriteClient,
  ) {
    const db = this.getDb(client);
    if (timer.status !== SlaTimerStatuses.ACTIVE) {
      return timer;
    }

    await this.triggerNotification(
      timer,
      SlaNotificationTypes.DUE_REMINDER,
      {
        reasonCode: 'DUE_REMINDER_TRIGGERED',
        message: 'SLA due reminder triggered',
        metadata,
      },
      actor,
      client,
    );

    const updated = (await db.slaTimer.update({
      where: { id: timer.id },
      data: {
        status: SlaTimerStatuses.EXPIRED,
        expiredAt: new Date(),
        activeKey: null,
      },
    })) as SlaTimerRow;

    await this.triggerNotification(
      updated,
      SlaNotificationTypes.EXPIRE_MARK,
      {
        reasonCode: 'TIMER_EXPIRED',
        message: reason,
        metadata,
      },
      actor,
      client,
    );

    await this.recordTimerAudit(
      AuditActions.SLA_TIMER_EXPIRED,
      updated,
      actor,
      AuditResult.REJECTED,
      reason,
      metadata,
    );

    updated.notifications = await this.findNotifications(updated.id, client);

    return updated;
  }

  private async createOrReuseActiveTimer(input: {
    workflowType: string;
    workflowId: string;
    workflowNo: string;
    subjectType: string;
    subjectId: string;
    subjectNo: string;
    timerType: string;
    ownerUserId: string;
    dueAt: Date;
    traceId: string;
    contextJson?: Record<string, unknown>;
  }) {
    const activeKey = this.buildActiveKey(
      input.workflowType,
      input.subjectType,
      input.subjectId,
      input.timerType,
    );
    const contextJson = this.serializeJson(input.contextJson || {});
    const graceSeconds = this.defaultGraceSeconds();

    const existing = await this.prisma.slaTimer.findFirst({
      where: {
        activeKey,
        status: SlaTimerStatuses.ACTIVE,
      },
      orderBy: { createdAt: 'desc' },
    });
    if (existing) {
      const shouldRefresh =
        existing.workflowNo !== input.workflowNo ||
        existing.subjectNo !== input.subjectNo ||
        existing.ownerUserId !== input.ownerUserId ||
        existing.traceId !== input.traceId ||
        existing.graceSeconds !== graceSeconds ||
        existing.contextJson !== contextJson ||
        existing.dueAt.getTime() !== input.dueAt.getTime();
      if (shouldRefresh) {
        const refreshed = (await this.prisma.slaTimer.update({
          where: { id: existing.id },
          data: {
            workflowNo: input.workflowNo,
            subjectNo: input.subjectNo,
            ownerUserId: input.ownerUserId,
            dueAt: input.dueAt,
            graceSeconds,
            traceId: input.traceId,
            contextJson,
          },
        })) as SlaTimerRow;
        await this.upsertScheduledNotification(
          refreshed,
          {
            notificationType: SlaNotificationTypes.DUE_REMINDER,
            scheduledAt: input.dueAt,
            reasonCode: 'DUE_REMINDER_REGISTERED',
            message: 'SLA due reminder scheduled',
            metadata: {
              timerType: refreshed.timerType,
              workflowNo: refreshed.workflowNo,
            },
            resetTriggered: true,
          },
          this.systemActor(),
        );
        refreshed.notifications = await this.findNotifications(refreshed.id);
        return this.mapTimer(refreshed);
      }
      (existing as SlaTimerRow).notifications = await this.findNotifications(existing.id);
      return this.mapTimer(existing as SlaTimerRow);
    }

    try {
      const created = await this.createTimerWithUniqueNo({
        workflowType: input.workflowType,
        workflowId: input.workflowId,
        workflowNo: input.workflowNo,
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        subjectNo: input.subjectNo,
        timerType: input.timerType,
        ownerUserId: input.ownerUserId,
        status: SlaTimerStatuses.ACTIVE,
        dueAt: input.dueAt,
        graceSeconds,
        traceId: input.traceId,
        contextJson,
        activeKey,
      });

      await this.recordTimerAudit(
        AuditActions.SLA_TIMER_CREATED,
        created,
        this.systemActor(),
        AuditResult.SUCCESS,
        'SLA timer created',
      );
      await this.upsertScheduledNotification(
        created,
        {
          notificationType: SlaNotificationTypes.DUE_REMINDER,
          scheduledAt: input.dueAt,
          reasonCode: 'DUE_REMINDER_REGISTERED',
          message: 'SLA due reminder scheduled',
          metadata: {
            timerType: created.timerType,
            workflowNo: created.workflowNo,
          },
        },
        this.systemActor(),
      );
      created.notifications = await this.findNotifications(created.id);

      return this.mapTimer(created);
    } catch (error) {
      if (this.isUniqueConflict(error, 'activeKey')) {
        const collided = await this.prisma.slaTimer.findFirst({
          where: {
            activeKey,
            status: SlaTimerStatuses.ACTIVE,
          },
          orderBy: { createdAt: 'desc' },
        });
        if (collided) {
          (collided as SlaTimerRow).notifications = await this.findNotifications(collided.id);
          return this.mapTimer(collided as SlaTimerRow);
        }
      }
      throw error;
    }
  }

  async ensureApprovalTimeoutTimer(approvalId: string) {
    const approval = await this.prisma.approvalCase.findUnique({
      where: { id: approvalId },
      select: {
        id: true,
        approvalNo: true,
        actionType: true,
        entityRef: true,
        createdByUserId: true,
        status: true,
        timeoutAt: true,
        traceId: true,
      },
    });

    if (!approval || approval.status !== ApprovalStatuses.PENDING) {
      return null;
    }
    if (!approval.timeoutAt) {
      return null;
    }

    return this.createOrReuseActiveTimer({
      workflowType: AuditWorkflowTypes.APPROVAL,
      workflowId: approval.id,
      workflowNo: approval.approvalNo,
      subjectType: AuditEntityTypes.APPROVAL_CASE,
      subjectId: approval.id,
      subjectNo: approval.approvalNo,
      timerType: SlaTimerTypes.APPROVAL_TIMEOUT,
      ownerUserId: approval.createdByUserId,
      dueAt: approval.timeoutAt,
      traceId: approval.traceId,
      contextJson: {
        approvalNo: approval.approvalNo,
        actionType: approval.actionType,
        entityRef: approval.entityRef,
        timeoutAt: approval.timeoutAt.toISOString(),
      },
    });
  }

  async closeApprovalTimeoutTimer(approvalId: string, reason?: string) {
    const timer = await this.prisma.slaTimer.findFirst({
      where: {
        subjectId: approvalId,
        timerType: SlaTimerTypes.APPROVAL_TIMEOUT,
        status: SlaTimerStatuses.ACTIVE,
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!timer) {
      return null;
    }

    return this.mapTimer(
      await this.closeTimerRow(
        timer as SlaTimerRow,
        this.systemActor(),
        reason || 'Approval resolved; timeout timer closed',
      ),
    );
  }

  async ensureChangePostApprovalFollowUpTimer(ticketId: string) {
    void ticketId;
    return null;
  }

  async ensureGovernanceRegistryTimer(input: {
    subjectType: string;
    subjectId: string;
    subjectNo: string;
    timerType: string;
    ownerUserId: string;
    dueAt: Date;
    traceId: string;
    contextJson?: Record<string, unknown>;
  }) {
    return this.createOrReuseActiveTimer({
      workflowType: SlaTimerWorkflowTypes.GOVERNANCE_REGISTRY,
      workflowId: input.subjectId,
      workflowNo: input.subjectNo,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      subjectNo: input.subjectNo,
      timerType: input.timerType,
      ownerUserId: input.ownerUserId,
      dueAt: input.dueAt,
      traceId: input.traceId,
      contextJson: input.contextJson || {},
    });
  }

  async closeGovernanceRegistryTimer(input: {
    subjectType: string;
    subjectId: string;
    timerType: string;
    reason?: string;
  }) {
    const timer = await this.prisma.slaTimer.findFirst({
      where: {
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        timerType: input.timerType,
        status: SlaTimerStatuses.ACTIVE,
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!timer) {
      return null;
    }

    return this.mapTimer(
      await this.closeTimerRow(
        timer as SlaTimerRow,
        this.systemActor(),
        input.reason || 'Governance registry SLA timer closed',
      ),
    );
  }

  async getById(id: string) {
    return this.mapTimer(await this.findTimerOrThrow(id, true));
  }

  async list(query: SlaTimerQueryDto) {
    const skip = this.normalizeSkip(query.skip);
    const take = this.normalizeTake(query.take);
    const where: Record<string, any> = {};

    if (query.timerNo) where.timerNo = query.timerNo.trim();
    if (query.timerType) where.timerType = query.timerType.trim().toUpperCase();
    const normalizedStatus = query.status?.trim().toUpperCase();
    if (normalizedStatus && (SLA_TIMER_STATUS_VALUES as string[]).includes(normalizedStatus)) {
      where.status = normalizedStatus;
    }
    if (query.workflowType) where.workflowType = query.workflowType.trim().toUpperCase();
    if (query.workflowNo) where.workflowNo = query.workflowNo.trim();
    if (query.subjectType) where.subjectType = query.subjectType.trim().toUpperCase();
    if (query.subjectNo) where.subjectNo = query.subjectNo.trim();
    if (query.ownerUserId) where.ownerUserId = query.ownerUserId.trim();
    if (query.traceId) where.traceId = query.traceId.trim();
    if (query.keyword) {
      const keyword = query.keyword.trim();
      where.OR = [
        { timerNo: { contains: keyword } },
        { workflowNo: { contains: keyword } },
        { subjectNo: { contains: keyword } },
        { traceId: { contains: keyword } },
      ];
    }

    const [total, rows] = await Promise.all([
      this.prisma.slaTimer.count({ where }),
      this.prisma.slaTimer.findMany({
        where,
        skip,
        take,
        include: this.timerInclude(true),
        orderBy: [{ createdAt: 'desc' }],
      }),
    ]);

    return {
      total,
      skip,
      take,
      items: rows.map((row) => this.mapTimer(row as SlaTimerRow)),
    };
  }

  private resolveDueAtFromRecalc(
    dto: RecalcSlaTimerDto,
    fallbackDueAt: Date,
  ): Date {
    if (dto.dueAt) {
      const parsed = new Date(dto.dueAt);
      if (Number.isNaN(parsed.getTime())) {
        throw new BadRequestException('Invalid dueAt');
      }
      return parsed;
    }

    if (typeof dto.dueInSeconds === 'number') {
      return new Date(Date.now() + dto.dueInSeconds * 1000);
    }

    return fallbackDueAt;
  }

  async recalc(id: string, dto: RecalcSlaTimerDto, actor: ApprovalActorContext) {
    const current = await this.findTimerOrThrow(id, true);
    if (current.status !== SlaTimerStatuses.ACTIVE) {
      throw new BadRequestException('Only ACTIVE timers can be recalculated');
    }

    const traceId = this.normalizeOptionalString(dto.traceId);
    if (traceId && traceId !== current.traceId) {
      throw new BadRequestException('traceId does not match the timer chain');
    }

    const reason =
      this.normalizeOptionalString(dto.reason) || 'SLA timer recalculated';

    if (current.timerType === SlaTimerTypes.APPROVAL_TIMEOUT) {
      const approval = await this.prisma.approvalCase.findUnique({
        where: { id: current.subjectId },
        select: {
          id: true,
          approvalNo: true,
          timeoutAt: true,
        },
      });

      if (!approval) {
        throw new NotFoundException(`Approval case not found: ${current.subjectId}`);
      }

      const dueAt = this.resolveDueAtFromRecalc(
        dto,
        approval.timeoutAt || current.dueAt,
      );
      const graceSeconds =
        typeof dto.graceSeconds === 'number' ? dto.graceSeconds : current.graceSeconds;
      const contextJson = {
        ...(this.parseJson<Record<string, unknown>>(current.contextJson) || {}),
        approvalNo: approval.approvalNo,
        timeoutAt: dueAt.toISOString(),
        recalculatedAt: new Date().toISOString(),
      };

      const updated = await this.prisma.$transaction(async (tx: any) => {
        await tx.approvalCase.update({
          where: { id: approval.id },
          data: {
            timeoutAt: dueAt,
          },
        });

        const next = (await tx.slaTimer.update({
          where: { id: current.id },
          data: {
            dueAt,
            graceSeconds,
            contextJson: this.serializeJson(contextJson),
          },
        })) as SlaTimerRow;

        return next;
      });

      await this.upsertScheduledNotification(
        updated,
        {
          notificationType: SlaNotificationTypes.DUE_REMINDER,
          scheduledAt: dueAt,
          reasonCode: 'DUE_REMINDER_RECALCULATED',
          message: 'SLA due reminder rescheduled after recalc',
          metadata: {
            recalculatedBy: actor.userId,
          },
          resetTriggered: true,
        },
        actor,
      );

      updated.notifications = await this.findNotifications(updated.id);
      await this.recordTimerAudit(
        AuditActions.SLA_TIMER_RECALCULATED,
        updated,
        actor,
        AuditResult.SUCCESS,
        reason,
        {
          previousDueAt: current.dueAt.toISOString(),
          nextDueAt: dueAt.toISOString(),
          previousGraceSeconds: current.graceSeconds,
          nextGraceSeconds: graceSeconds,
        },
      );

      return this.mapTimer(updated);
    }

    if (current.timerType === SlaTimerTypes.CHANGE_POST_APPROVAL_FOLLOWUP) {
      const dueAt = this.resolveDueAtFromRecalc(dto, current.dueAt);
      const graceSeconds =
        typeof dto.graceSeconds === 'number' ? dto.graceSeconds : current.graceSeconds;
      const contextJson = {
        ...(this.parseJson<Record<string, unknown>>(current.contextJson) || {}),
        recalculatedAt: new Date().toISOString(),
      };

      const updated = await this.prisma.$transaction(async (tx: any) => {
        const next = (await tx.slaTimer.update({
          where: { id: current.id },
          data: {
            dueAt,
            graceSeconds,
            contextJson: this.serializeJson(contextJson),
          },
        })) as SlaTimerRow;

        return next;
      });

      await this.upsertScheduledNotification(
        updated,
        {
          notificationType: SlaNotificationTypes.DUE_REMINDER,
          scheduledAt: dueAt,
          reasonCode: 'DUE_REMINDER_RECALCULATED',
          message: 'SLA due reminder rescheduled after recalc',
          metadata: {
            recalculatedBy: actor.userId,
          },
          resetTriggered: true,
        },
        actor,
      );

      updated.notifications = await this.findNotifications(updated.id);
      await this.recordTimerAudit(
        AuditActions.SLA_TIMER_RECALCULATED,
        updated,
        actor,
        AuditResult.SUCCESS,
        reason,
        {
          previousDueAt: current.dueAt.toISOString(),
          nextDueAt: dueAt.toISOString(),
          previousGraceSeconds: current.graceSeconds,
          nextGraceSeconds: graceSeconds,
        },
      );

      return this.mapTimer(updated);
    }

    throw new BadRequestException(`Unsupported timerType: ${current.timerType}`);
  }

  async close(id: string, dto: CloseSlaTimerDto, actor: ApprovalActorContext) {
    const current = await this.findTimerOrThrow(id);
    if (current.timerType !== SlaTimerTypes.CHANGE_POST_APPROVAL_FOLLOWUP) {
      throw new BadRequestException(
        'Only CHANGE_POST_APPROVAL_FOLLOWUP timers can be closed manually',
      );
    }
    if (current.status !== SlaTimerStatuses.ACTIVE) {
      throw new BadRequestException('Only ACTIVE timers can be closed');
    }
    const traceId = this.normalizeOptionalString(dto.traceId);
    if (traceId && traceId !== current.traceId) {
      throw new BadRequestException('traceId does not match the timer chain');
    }

    const reason =
      this.normalizeOptionalString(dto.reason) || 'Emergency change follow-up completed';
    const now = new Date();
    const updated = await this.prisma.$transaction(async (tx: any) => {
      const timer = await this.findTimerOrThrow(id, false, tx);
      if (timer.timerType !== SlaTimerTypes.CHANGE_POST_APPROVAL_FOLLOWUP) {
        throw new BadRequestException(
          'Only CHANGE_POST_APPROVAL_FOLLOWUP timers can be closed manually',
        );
      }
      if (timer.status !== SlaTimerStatuses.ACTIVE) {
        throw new BadRequestException('Only ACTIVE timers can be closed');
      }

      return (await tx.slaTimer.update({
        where: { id: timer.id },
        data: {
          status: SlaTimerStatuses.CLOSED,
          closedAt: now,
          activeKey: null,
        },
      })) as SlaTimerRow;
    });

    await this.recordTimerAudit(
      AuditActions.SLA_TIMER_CLOSED,
      updated,
      actor,
      AuditResult.SUCCESS,
      reason,
    );

    await this.skipScheduledNotifications(
      updated,
      {
        reasonCode: 'TIMER_CLOSED',
        message: reason,
      },
      actor,
    );

    updated.notifications = await this.findNotifications(updated.id);

    return this.mapTimer(updated);
  }

  async expireDueTimers() {
    const now = new Date();
    const rows = await this.prisma.slaTimer.findMany({
      where: {
        status: SlaTimerStatuses.ACTIVE,
        dueAt: {
          lte: now,
        },
      },
      orderBy: { dueAt: 'asc' },
      take: 200,
    });

    const expiredIds: string[] = [];
    const closedIds: string[] = [];
    for (const row of rows as SlaTimerRow[]) {
      const deadline =
        row.dueAt.getTime() + (row.graceSeconds ?? this.defaultGraceSeconds()) * 1000;
      if (row.dueAt.getTime() <= now.getTime()) {
        await this.triggerNotification(
          row,
          SlaNotificationTypes.DUE_REMINDER,
          {
            reasonCode: 'DUE_REMINDER_TRIGGERED',
            message: 'SLA due reminder triggered',
          },
          this.systemActor(),
        );
      }
      if (deadline > now.getTime()) {
        continue;
      }

      if (row.timerType === SlaTimerTypes.APPROVAL_TIMEOUT) {
        const approval = await this.prisma.approvalCase.findUnique({
          where: { id: row.subjectId },
          select: {
            id: true,
            status: true,
          },
        });

        if (!approval || approval.status !== ApprovalStatuses.PENDING) {
          const closed = await this.closeTimerRow(
            row,
            this.systemActor(),
            'Approval no longer pending; timeout timer closed',
          );
          closedIds.push(closed.id);
          continue;
        }

        const expired = await this.expireTimerRow(
          row,
          this.systemActor(),
          'Approval timed out after SLA grace window',
        );
        expiredIds.push(expired.id);
        await this.approvalsService.expirePendingApprovalCase(row.subjectId);
        continue;
      }

      if (row.timerType === SlaTimerTypes.CHANGE_POST_APPROVAL_FOLLOWUP) {
        const expired = await this.expireTimerRow(
          row,
          this.systemActor(),
          'Emergency change post-approval follow-up overdue',
        );
        expiredIds.push(expired.id);
      }
    }

    return {
      expiredCount: expiredIds.length,
      expiredIds,
      closedCount: closedIds.length,
      closedIds,
    };
  }
}
