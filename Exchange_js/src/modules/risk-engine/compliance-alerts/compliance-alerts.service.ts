import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ComplianceAlert, ComplianceAlertEvent, Prisma } from '@prisma/client';
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
  ALERT_SLA_HOURS,
  COMPLIANCE_ALERT_RULES,
  CLOSED_ALERT_STATUSES,
  ComplianceAlertAction,
  ComplianceAlertEventType,
  ComplianceAlertSeverity,
  ComplianceAlertStatus,
  getComplianceAlertRule,
} from './constants/compliance-alert-rules.constant';
import {
  ComplianceAlertActorContext,
  ComplianceAlertQueryDto,
  UpdateComplianceAlertActionDto,
} from './dto/compliance-alert.dto';

type AlertWriteClient = Prisma.TransactionClient | PrismaService;
type AlertWithEvents = ComplianceAlert & { events: ComplianceAlertEvent[] };

export interface TriggerComplianceAlertInput {
  ruleCode: string;
  sourceModule: string;
  sourceType: string;
  sourceId: string;
  sourceNo?: string | null;
  stage?: string | null;
  journeyId?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  entityNo?: string | null;
  ownerType?: string | null;
  ownerId?: string | null;
  ownerNo?: string | null;
  customerId?: string | null;
  customerNo?: string | null;
  decisionRecommendation?: string | null;
  decision?: string | null;
  linkedCaseIds?: string[] | null;
  decisionRecordIds?: string[] | null;
  title?: string;
  message?: string;
  severity?: ComplianceAlertSeverity;
  capCode?: string | null;
  metadata?: Record<string, unknown> | null;
  occurredAt?: Date;
  sourcePlatform?: string;
}

interface ActionResolution {
  nextStatus: ComplianceAlertStatus;
  eventType: ComplianceAlertEventType;
  auditAction: string;
  requireReason: boolean;
  statusChanged: boolean;
  isCloseAction: boolean;
}

export interface SimulatedAlertItem {
  id: string;
  alertNo: string;
  ruleCode: string;
  severity: ComplianceAlertSeverity;
  status: ComplianceAlertStatus;
  sourceType: string;
  sourceId: string;
  lastOccurredAt: Date;
}

@Injectable()
export class ComplianceAlertsService {
  private static readonly DEFAULT_TAKE = 20;
  private readonly auditLogsService: AuditLogsService;

  constructor(private readonly prisma: PrismaService) {
    this.auditLogsService = new AuditLogsService(prisma);
  }

  private getDb(client?: Prisma.TransactionClient): AlertWriteClient {
    return client ?? this.prisma;
  }

  private normalizeTake(take?: number): number {
    if (!take || take < 1) return ComplianceAlertsService.DEFAULT_TAKE;
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

  private toRetainedUntil(occurredAt: Date): Date {
    const retainedUntil = new Date(occurredAt);
    retainedUntil.setFullYear(retainedUntil.getFullYear() + 8);
    return retainedUntil;
  }

  private toDueAt(
    severity: ComplianceAlertSeverity,
    base: Date,
  ): Date {
    const hours = ALERT_SLA_HOURS[severity] ?? ALERT_SLA_HOURS.MEDIUM;
    return new Date(base.getTime() + hours * 60 * 60 * 1000);
  }

  private isClosedStatus(status: string): boolean {
    return CLOSED_ALERT_STATUSES.includes(status as ComplianceAlertStatus);
  }

  private buildDedupeKey(input: TriggerComplianceAlertInput): string {
    const stageSegment = this.normalizeOptionalString(input.stage);
    if (stageSegment) {
      return `${input.ruleCode}:${input.sourceType}:${input.sourceId}:${stageSegment}`;
    }
    return `${input.ruleCode}:${input.sourceType}:${input.sourceId}`;
  }

  private buildArchivedDedupeKey(baseDedupeKey: string, alertId: string): string {
    const suffix = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
    return `${baseDedupeKey}#closed#${alertId}#${suffix}`;
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

  private normalizeRecommendedDecision(value: unknown): string | null {
    const normalized = String(value || '').trim().toUpperCase();
    if (!normalized) return null;
    if (normalized === 'APPROVE') return 'APPROVE';
    if (normalized === 'REJECT') return 'REJECT';
    if (normalized === 'REQUIRE_EDD') return 'REQUIRE_EDD';
    return null;
  }

  private dedupeRecommendedDecisions(decisions: unknown[]): string[] {
    const normalized = decisions
      .map((item) => this.normalizeRecommendedDecision(item))
      .filter((item): item is string => !!item);
    return Array.from(new Set(normalized));
  }

  private mapRecommendedDecisions(
    row: ComplianceAlert,
    metadata: Record<string, unknown>,
  ): string[] {
    const fromMetadata = Array.isArray(metadata.recommendedDecisions)
      ? this.dedupeRecommendedDecisions(metadata.recommendedDecisions as unknown[])
      : [];
    if (fromMetadata.length > 0) return fromMetadata;

    const contextType = String(metadata.contextType || '').toUpperCase();
    if (contextType === 'ONBOARDING_CDD') {
      return ['APPROVE', 'REJECT', 'REQUIRE_EDD'];
    }
    if (contextType === 'ONBOARDING_EDD') {
      return ['APPROVE', 'REJECT'];
    }

    const recommendation = this.normalizeRecommendedDecision(row.decisionRecommendation);
    return recommendation ? [recommendation] : [];
  }

  private mapAlert(row: ComplianceAlert) {
    const metadata = this.parseJson(row.metadata);
    const normalizedMetadata =
      metadata && typeof metadata === 'object' && !Array.isArray(metadata)
        ? (metadata as Record<string, unknown>)
        : {};

    return {
      ...row,
      metadata: metadata || {},
      linkedCaseIds: this.parseJson(row.linkedCaseIds),
      decisionRecordIds: this.parseJson(row.decisionRecordIds),
      recommendedDecisions: this.mapRecommendedDecisions(row, normalizedMetadata),
    };
  }

  private mapAlertEvent(row: ComplianceAlertEvent) {
    return {
      ...row,
      payload: this.parseJson(row.payload),
    };
  }

  private ensureRule(ruleCode: string) {
    const rule = getComplianceAlertRule(ruleCode);
    if (!rule) {
      throw new BadRequestException(`Unsupported alert ruleCode: ${ruleCode}`);
    }
    return rule;
  }

  private assertActionAllowed(
    currentStatus: ComplianceAlertStatus,
    action: ComplianceAlertAction,
  ) {
    switch (action) {
      case ComplianceAlertAction.ASSIGN:
        if (![ComplianceAlertStatus.OPEN, ComplianceAlertStatus.ASSIGNED].includes(currentStatus)) {
          throw new BadRequestException(
            `Action ASSIGN is not allowed from status ${currentStatus}`,
          );
        }
        return;
      case ComplianceAlertAction.UNASSIGN:
        if (currentStatus !== ComplianceAlertStatus.ASSIGNED) {
          throw new BadRequestException(
            `Action UNASSIGN is not allowed from status ${currentStatus}`,
          );
        }
        return;
      case ComplianceAlertAction.ESCALATE:
        if (
          ![
            ComplianceAlertStatus.OPEN,
            ComplianceAlertStatus.ASSIGNED,
            ComplianceAlertStatus.ESCALATED,
          ].includes(currentStatus)
        ) {
          throw new BadRequestException(
            `Action ${action} is not allowed from status ${currentStatus}`,
          );
        }
        return;
      case ComplianceAlertAction.CLOSE:
        if (
          ![
            ComplianceAlertStatus.OPEN,
            ComplianceAlertStatus.ASSIGNED,
            ComplianceAlertStatus.ESCALATED,
          ].includes(currentStatus)
        ) {
          throw new BadRequestException(
            `Action CLOSE is not allowed from status ${currentStatus}`,
          );
        }
        return;
      default:
        throw new BadRequestException(`Unsupported action: ${action}`);
    }
  }

  private resolveAction(
    action: ComplianceAlertAction,
    currentStatus: ComplianceAlertStatus,
  ): ActionResolution {
    switch (action) {
      case ComplianceAlertAction.ASSIGN:
        return {
          nextStatus: ComplianceAlertStatus.ASSIGNED,
          eventType: ComplianceAlertEventType.ASSIGNED,
          auditAction: AuditActions.ALERT_ASSIGNED,
          requireReason: false,
          statusChanged: currentStatus !== ComplianceAlertStatus.ASSIGNED,
          isCloseAction: false,
        };
      case ComplianceAlertAction.UNASSIGN:
        return {
          nextStatus: ComplianceAlertStatus.OPEN,
          eventType: ComplianceAlertEventType.UNASSIGNED,
          auditAction: AuditActions.ALERT_ASSIGNED,
          requireReason: false,
          statusChanged: currentStatus !== ComplianceAlertStatus.OPEN,
          isCloseAction: false,
        };
      case ComplianceAlertAction.ESCALATE:
        return {
          nextStatus: ComplianceAlertStatus.ESCALATED,
          eventType: ComplianceAlertEventType.ESCALATED,
          auditAction: AuditActions.ALERT_ESCALATED,
          requireReason: true,
          statusChanged: currentStatus !== ComplianceAlertStatus.ESCALATED,
          isCloseAction: false,
        };
      case ComplianceAlertAction.CLOSE:
        return {
          nextStatus: ComplianceAlertStatus.CLOSED,
          eventType: ComplianceAlertEventType.CLOSED,
          auditAction: AuditActions.ALERT_RESOLVED,
          requireReason: true,
          statusChanged: currentStatus !== ComplianceAlertStatus.CLOSED,
          isCloseAction: true,
        };
      default:
        throw new BadRequestException(`Unsupported action: ${action}`);
    }
  }

  private async resolveCustomerNo(
    customerId: string,
    db: AlertWriteClient,
  ): Promise<string | null> {
    const customer = await db.customerMain.findUnique({
      where: { id: customerId },
      select: { customerNo: true },
    });
    return customer?.customerNo || null;
  }

  private async resolveUserNo(
    userId: string,
    db: AlertWriteClient,
  ): Promise<string | null> {
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { userNo: true },
    });
    return user?.userNo || null;
  }

  private async appendEvent(
    db: AlertWriteClient,
    input: {
      alertId: string;
      eventType: ComplianceAlertEventType;
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
    await db.complianceAlertEvent.create({
      data: {
        alertId: input.alertId,
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

  private shuffleArray<T>(items: T[]): T[] {
    const copied = [...items];
    for (let i = copied.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [copied[i], copied[j]] = [copied[j], copied[i]];
    }
    return copied;
  }

  private buildSimulationRuleCodes(count: number): string[] {
    const availableRuleCodes = Object.keys(COMPLIANCE_ALERT_RULES);
    if (availableRuleCodes.length === 0) {
      throw new BadRequestException('No compliance alert rules configured');
    }

    const picked: string[] = [];
    while (picked.length < count) {
      const shuffled = this.shuffleArray(availableRuleCodes);
      for (const ruleCode of shuffled) {
        picked.push(ruleCode);
        if (picked.length >= count) {
          break;
        }
      }
    }
    return picked;
  }

  private randomTxSourceType(): 'DEPOSIT' | 'WITHDRAW' {
    return Math.random() < 0.5 ? 'DEPOSIT' : 'WITHDRAW';
  }

  private buildSimulatedAlertInput(
    ruleCode: string,
    batchId: string,
    index: number,
  ): TriggerComplianceAlertInput {
    const sequence = String(index + 1).padStart(2, '0');
    const randomSegment = Math.floor(Math.random() * 1_000_000)
      .toString(36)
      .padStart(4, '0');
    const sourceId = `sim-${batchId}-${sequence}-${randomSegment}`;
    const customerId = `sim-customer-${batchId}-${sequence}`;
    const customerNo = `SIMCU-${batchId.slice(-6).toUpperCase()}-${sequence}`;
    const entityId = `sim-entity-${batchId}-${sequence}-${randomSegment}`;
    const entityNo = `SIM-ENT-${batchId.slice(-6).toUpperCase()}-${sequence}`;
    const sourceNo = `SIM-SRC-${batchId.slice(-6).toUpperCase()}-${sequence}`;

    let sourceModule: string = AuditModules.TRANSACTION_COMPLIANCE;
    let sourceType: string = this.randomTxSourceType();
    let entityType: string = AuditEntityTypes.KYT_CASE;

    if (ruleCode.startsWith('ONB_')) {
      sourceModule = AuditModules.ONBOARDING;
      sourceType = 'CUSTOMER';
      entityType = AuditEntityTypes.CUSTOMER;
    } else if (ruleCode.startsWith('TX_TRAVEL_RULE_')) {
      sourceModule = AuditModules.TRANSACTION_COMPLIANCE;
      sourceType = this.randomTxSourceType();
      entityType = AuditEntityTypes.TRAVEL_RULE_CASE;
    } else if (ruleCode === 'TX_COMPLIANCE_GATE_BLOCKED') {
      sourceType = this.randomTxSourceType();
      sourceModule =
        sourceType === 'DEPOSIT'
          ? AuditModules.DEPOSIT_TRANSACTIONS
          : AuditModules.WITHDRAW_TRANSACTIONS;
      entityType =
        sourceType === 'DEPOSIT'
          ? AuditEntityTypes.DEPOSIT_TRANSACTION
          : AuditEntityTypes.WITHDRAW_TRANSACTION;
    } else if (ruleCode.startsWith('TX_KYT_')) {
      sourceModule = AuditModules.TRANSACTION_COMPLIANCE;
      sourceType = this.randomTxSourceType();
      entityType = AuditEntityTypes.KYT_CASE;
    }

    return {
      ruleCode,
      sourceModule,
      sourceType,
      sourceId,
      sourceNo,
      entityType,
      entityId,
      entityNo,
      ownerType: 'CUSTOMER',
      ownerId: customerId,
      ownerNo: customerNo,
      customerId,
      customerNo,
      message: `Simulated alert ${sequence} for ${ruleCode}`,
      metadata: {
        simulated: true,
        batchId,
        sequence: index + 1,
      },
      sourcePlatform: 'ADMIN_SIMULATOR',
    };
  }

  async triggerSystemAlert(
    input: TriggerComplianceAlertInput,
    tx?: Prisma.TransactionClient,
  ) {
    const db = this.getDb(tx);
    const rule = this.ensureRule(input.ruleCode);
    const occurredAt = input.occurredAt || new Date();
    const severity = input.severity || rule.severity;
    const dedupeKey = this.buildDedupeKey(input);
    const dueAt = this.toDueAt(severity, occurredAt);
    const retainedUntil = this.toRetainedUntil(occurredAt);
    const capCode = this.normalizeOptionalString(input.capCode) || rule.capCode || null;
    const title = this.normalizeOptionalString(input.title) || rule.title;
    const message =
      this.normalizeOptionalString(input.message) || rule.defaultMessage;
    const journeyId = this.normalizeOptionalString(input.journeyId);
    const decisionRecommendation = this.normalizeOptionalString(input.decisionRecommendation);
    const decision = this.normalizeOptionalString(input.decision);
    const linkedCaseIds = this.serializeJson(input.linkedCaseIds || null);
    const decisionRecordIds = this.serializeJson(input.decisionRecordIds || null);

    let ownerNo = this.normalizeOptionalString(input.ownerNo);
    let customerId = this.normalizeOptionalString(input.customerId);
    let customerNo = this.normalizeOptionalString(input.customerNo);

    if (!customerId && input.ownerType === 'CUSTOMER') {
      customerId = this.normalizeOptionalString(input.ownerId);
    }

    if (!ownerNo && input.ownerType === 'CUSTOMER' && input.ownerId) {
      ownerNo = await this.resolveCustomerNo(input.ownerId, db);
    }

    if (!customerNo && customerId) {
      customerNo = await this.resolveCustomerNo(customerId, db);
    }

    if (!customerNo && ownerNo && input.ownerType === 'CUSTOMER') {
      customerNo = ownerNo;
    }

    const existing = await db.complianceAlert.findUnique({
      where: { dedupeKey },
      select: {
        id: true,
        status: true,
        hitCount: true,
        alertNo: true,
      },
    });

    const metadataJson = this.serializeJson(input.metadata);
    const sourcePlatform = input.sourcePlatform || 'SYSTEM';

    if (!existing) {
      const created = await db.complianceAlert.create({
        data: {
          alertNo: generateReferenceNo('ALT'),
          dedupeKey,
          ruleCode: rule.ruleCode,
          capCode,
          severity,
          status: ComplianceAlertStatus.OPEN,
          title,
          message,
          sourceModule: input.sourceModule,
          sourceType: input.sourceType,
          sourceId: input.sourceId,
          sourceNo: this.normalizeOptionalString(input.sourceNo),
          entityType: this.normalizeOptionalString(input.entityType),
          entityId: this.normalizeOptionalString(input.entityId),
          entityNo: this.normalizeOptionalString(input.entityNo),
          ownerType: this.normalizeOptionalString(input.ownerType),
          ownerId: this.normalizeOptionalString(input.ownerId),
          ownerNo,
          customerId,
          customerNo,
          journeyId,
          decisionRecommendation,
          decision,
          linkedCaseIds,
          decisionRecordIds,
          firstOccurredAt: occurredAt,
          lastOccurredAt: occurredAt,
          dueAt,
          hitCount: 1,
          metadata: metadataJson,
          retainedUntil,
          lastActionById: 'SYSTEM',
          lastActionByNo: 'SYSTEM',
          lastActionByRole: 'SYSTEM',
          lastActionAt: occurredAt,
        },
      });

      await this.appendEvent(db, {
        alertId: created.id,
        eventType: ComplianceAlertEventType.TRIGGERED,
        eventAt: occurredAt,
        actorType: 'SYSTEM',
        actorId: 'SYSTEM',
        actorNo: 'SYSTEM',
        actorRole: 'SYSTEM',
        note: message,
        payload: {
          ruleCode: rule.ruleCode,
          dedupeKey,
          sourceType: input.sourceType,
          sourceId: input.sourceId,
          stage: this.normalizeOptionalString(input.stage),
          metadata: input.metadata || null,
        },
        sourcePlatform,
      });

      await this.auditLogsService.recordSystem(
        {
          triggerType: AuditTriggerType.DATA_UPDATE,
          action: AuditActions.ALERT_TRIGGERED,
          module: AuditModules.COMPLIANCE_ALERTS,
          entityType: AuditEntityTypes.COMPLIANCE_ALERT,
          entityId: created.id,
          entityNo: created.alertNo,
          entityOwnerType: created.ownerType || undefined,
          entityOwnerId: created.ownerId || undefined,
          reason: `Alert triggered: ${rule.ruleCode}`,
          metadata: {
            ruleCode: rule.ruleCode,
            severity: created.severity,
            sourceType: created.sourceType,
            sourceId: created.sourceId,
            dedupeKey: created.dedupeKey,
          },
          sourcePlatform,
        },
        tx,
      );

      return this.mapAlert(created);
    }

    if (this.isClosedStatus(existing.status)) {
      const archivedDedupeKey = this.buildArchivedDedupeKey(
        dedupeKey,
        existing.id,
      );

      await db.complianceAlert.update({
        where: { id: existing.id },
        data: {
          dedupeKey: archivedDedupeKey,
        },
      });

      const createdAfterClosed = await db.complianceAlert.create({
        data: {
          alertNo: generateReferenceNo('ALT'),
          dedupeKey,
          ruleCode: rule.ruleCode,
          capCode,
          severity,
          status: ComplianceAlertStatus.OPEN,
          title,
          message,
          sourceModule: input.sourceModule,
          sourceType: input.sourceType,
          sourceId: input.sourceId,
          sourceNo: this.normalizeOptionalString(input.sourceNo),
          entityType: this.normalizeOptionalString(input.entityType),
          entityId: this.normalizeOptionalString(input.entityId),
          entityNo: this.normalizeOptionalString(input.entityNo),
          ownerType: this.normalizeOptionalString(input.ownerType),
          ownerId: this.normalizeOptionalString(input.ownerId),
          ownerNo,
          customerId,
          customerNo,
          journeyId,
          decisionRecommendation,
          decision,
          linkedCaseIds,
          decisionRecordIds,
          firstOccurredAt: occurredAt,
          lastOccurredAt: occurredAt,
          dueAt,
          hitCount: 1,
          metadata: metadataJson,
          retainedUntil,
          lastActionById: 'SYSTEM',
          lastActionByNo: 'SYSTEM',
          lastActionByRole: 'SYSTEM',
          lastActionAt: occurredAt,
        },
      });

      await this.appendEvent(db, {
        alertId: createdAfterClosed.id,
        eventType: ComplianceAlertEventType.TRIGGERED,
        eventAt: occurredAt,
        actorType: 'SYSTEM',
        actorId: 'SYSTEM',
        actorNo: 'SYSTEM',
        actorRole: 'SYSTEM',
        note: `Alert triggered after terminal state: ${rule.ruleCode}`,
        payload: {
          ruleCode: rule.ruleCode,
          dedupeKey,
          previousAlertId: existing.id,
          sourceType: input.sourceType,
          sourceId: input.sourceId,
          stage: this.normalizeOptionalString(input.stage),
          metadata: input.metadata || null,
        },
        sourcePlatform,
      });

      await this.auditLogsService.recordSystem(
        {
          triggerType: AuditTriggerType.DATA_UPDATE,
          action: AuditActions.ALERT_TRIGGERED,
          module: AuditModules.COMPLIANCE_ALERTS,
          entityType: AuditEntityTypes.COMPLIANCE_ALERT,
          entityId: createdAfterClosed.id,
          entityNo: createdAfterClosed.alertNo,
          entityOwnerType: createdAfterClosed.ownerType || undefined,
          entityOwnerId: createdAfterClosed.ownerId || undefined,
          reason: `Alert triggered after terminal state: ${rule.ruleCode}`,
          metadata: {
            ruleCode: rule.ruleCode,
            severity: createdAfterClosed.severity,
            sourceType: createdAfterClosed.sourceType,
            sourceId: createdAfterClosed.sourceId,
            dedupeKey: createdAfterClosed.dedupeKey,
            previousAlertId: existing.id,
            archivedDedupeKey,
          },
          sourcePlatform,
        },
        tx,
      );

      return this.mapAlert(createdAfterClosed);
    }

    const updated = await db.complianceAlert.update({
      where: { id: existing.id },
      data: {
        severity,
        capCode,
        title,
        message,
        sourceModule: input.sourceModule,
        sourceNo: this.normalizeOptionalString(input.sourceNo),
        entityType: this.normalizeOptionalString(input.entityType),
        entityId: this.normalizeOptionalString(input.entityId),
        entityNo: this.normalizeOptionalString(input.entityNo),
        ownerType: this.normalizeOptionalString(input.ownerType),
        ownerId: this.normalizeOptionalString(input.ownerId),
        ownerNo,
        customerId,
        customerNo,
        journeyId,
        decisionRecommendation,
        decision,
        linkedCaseIds,
        decisionRecordIds,
        lastOccurredAt: occurredAt,
        dueAt,
        hitCount: existing.hitCount + 1,
        metadata: metadataJson,
        retainedUntil,
        lastActionById: 'SYSTEM',
        lastActionByNo: 'SYSTEM',
        lastActionByRole: 'SYSTEM',
        lastActionAt: occurredAt,
      },
    });

    await this.appendEvent(db, {
      alertId: updated.id,
      eventType: ComplianceAlertEventType.TRIGGERED,
      eventAt: occurredAt,
      actorType: 'SYSTEM',
      actorId: 'SYSTEM',
      actorNo: 'SYSTEM',
      actorRole: 'SYSTEM',
      note: `Alert triggered again: ${rule.ruleCode}`,
      payload: {
        ruleCode: rule.ruleCode,
        dedupeKey,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        stage: this.normalizeOptionalString(input.stage),
        metadata: input.metadata || null,
      },
      sourcePlatform,
    });

    await this.auditLogsService.recordSystem(
      {
        triggerType: AuditTriggerType.DATA_UPDATE,
        action: AuditActions.ALERT_TRIGGERED,
        module: AuditModules.COMPLIANCE_ALERTS,
        entityType: AuditEntityTypes.COMPLIANCE_ALERT,
        entityId: updated.id,
        entityNo: updated.alertNo,
        entityOwnerType: updated.ownerType || undefined,
        entityOwnerId: updated.ownerId || undefined,
        reason: `Alert re-triggered: ${rule.ruleCode}`,
        metadata: {
          ruleCode: rule.ruleCode,
          severity: updated.severity,
          sourceType: updated.sourceType,
          sourceId: updated.sourceId,
          dedupeKey: updated.dedupeKey,
        },
        sourcePlatform,
      },
      tx,
    );

    return this.mapAlert(updated);
  }

  async simulateRandomAlerts(count = 10) {
    const targetCount = Number.isFinite(count)
      ? Math.max(1, Math.floor(count))
      : 10;
    const batchId = `${Date.now().toString(36)}${Math.floor(
      Math.random() * 1_000_000,
    ).toString(36)}`;
    const selectedRuleCodes = this.buildSimulationRuleCodes(targetCount);
    const createdItems: SimulatedAlertItem[] = [];

    for (let i = 0; i < selectedRuleCodes.length; i += 1) {
      const created = await this.triggerSystemAlert(
        this.buildSimulatedAlertInput(selectedRuleCodes[i], batchId, i),
      );

      createdItems.push({
        id: created.id,
        alertNo: created.alertNo,
        ruleCode: created.ruleCode,
        severity: created.severity as ComplianceAlertSeverity,
        status: created.status as ComplianceAlertStatus,
        sourceType: created.sourceType,
        sourceId: created.sourceId,
        lastOccurredAt: created.lastOccurredAt,
      });
    }

    return {
      createdCount: createdItems.length,
      items: createdItems,
    };
  }

  async findAll(query: ComplianceAlertQueryDto) {
    const skip = this.normalizeSkip(query.skip);
    const take = this.normalizeTake(query.take);
    const where: Prisma.ComplianceAlertWhereInput = {};
    const andConditions: Prisma.ComplianceAlertWhereInput[] = [];

    if (query.status) where.status = query.status;
    if (query.severity) where.severity = query.severity;
    if (query.ruleCode) where.ruleCode = query.ruleCode;
    if (query.sourceType) where.sourceType = query.sourceType;
    if (query.sourceId) where.sourceId = query.sourceId;
    if (query.customerNo) where.customerNo = query.customerNo;
    if (query.assigneeUserId) where.assigneeUserId = query.assigneeUserId;

    const keyword = this.normalizeOptionalString(query.keyword);
    if (keyword) {
      andConditions.push({
        OR: [
          { alertNo: { contains: keyword } },
          { title: { contains: keyword } },
          { message: { contains: keyword } },
          { sourceNo: { contains: keyword } },
          { entityNo: { contains: keyword } },
          { ownerNo: { contains: keyword } },
          { customerNo: { contains: keyword } },
        ],
      });
    }

    if (query.overdueOnly) {
      andConditions.push({
        dueAt: { lt: new Date() },
      });
      andConditions.push({
        status: { notIn: CLOSED_ALERT_STATUSES },
      });
    }

    if (andConditions.length > 0) {
      where.AND = andConditions;
    }

    const [total, items] = await Promise.all([
      this.prisma.complianceAlert.count({ where }),
      this.prisma.complianceAlert.findMany({
        where,
        skip,
        take,
        orderBy: [{ lastOccurredAt: 'desc' }, { createdAt: 'desc' }],
      }),
    ]);

    return {
      total,
      skip,
      take,
      items: items.map((item) => this.mapAlert(item)),
    };
  }

  async findOne(id: string) {
    const item = await this.prisma.complianceAlert.findUnique({
      where: { id },
      include: {
        events: {
          orderBy: { eventAt: 'desc' },
        },
      },
    });

    if (!item) {
      throw new NotFoundException(`Compliance alert not found: ${id}`);
    }

    return {
      ...this.mapAlert(item),
      events: (item as AlertWithEvents).events.map((event) =>
        this.mapAlertEvent(event),
      ),
    };
  }

  async applyAction(
    id: string,
    dto: UpdateComplianceAlertActionDto,
    actor: ComplianceAlertActorContext,
    tx?: Prisma.TransactionClient,
  ) {
    const db = this.getDb(tx);
    const current = await db.complianceAlert.findUnique({
      where: { id },
    });
    if (!current) {
      throw new NotFoundException(`Compliance alert not found: ${id}`);
    }

    const currentStatus = current.status as ComplianceAlertStatus;
    this.assertActionAllowed(currentStatus, dto.action);

    if (
      currentStatus === ComplianceAlertStatus.ASSIGNED &&
      dto.action === ComplianceAlertAction.ASSIGN
    ) {
      const currentAssigneeUserId = this.normalizeOptionalString(current.assigneeUserId);
      const targetAssigneeUserId = this.normalizeOptionalString(dto.assigneeUserId) || actor.actorId;
      if (
        currentAssigneeUserId &&
        targetAssigneeUserId !== currentAssigneeUserId &&
        actor.actorId !== currentAssigneeUserId
      ) {
        throw new ForbiddenException(
          `Only assignee ${currentAssigneeUserId} can reassign this alert`,
        );
      }
    }

    if (
      [ComplianceAlertStatus.ASSIGNED, ComplianceAlertStatus.ESCALATED].includes(currentStatus) &&
      [ComplianceAlertAction.ESCALATE, ComplianceAlertAction.CLOSE].includes(dto.action)
    ) {
      const currentAssigneeUserId = this.normalizeOptionalString(current.assigneeUserId);
      if (!currentAssigneeUserId) {
        throw new ForbiddenException(
          `Action ${dto.action} requires an assigned owner on status ${currentStatus}`,
        );
      }
      if (currentAssigneeUserId !== actor.actorId) {
        throw new ForbiddenException(
          `Only assignee ${currentAssigneeUserId} can execute action ${dto.action}`,
        );
      }
    }

    const resolution = this.resolveAction(dto.action, currentStatus);
    const reason = this.normalizeOptionalString(dto.reason);
    const note = this.normalizeOptionalString(dto.note);
    const recommendation = this.normalizeOptionalString(dto.recommendation);
    const decision = this.normalizeOptionalString(dto.decision);
    const linkedCaseIds = this.serializeJson(dto.linkedCaseIds || null);
    const decisionRecordIds = this.serializeJson(dto.decisionRecordIds || null);

    if (resolution.requireReason && !reason) {
      throw new BadRequestException(
        `Action ${dto.action} requires a reason`,
      );
    }

    const now = new Date();
    const updateData: Prisma.ComplianceAlertUpdateInput = {
      status: resolution.nextStatus,
      lastActionById: actor.actorId,
      lastActionByNo: actor.actorNo || null,
      lastActionByRole: actor.actorRole || null,
      lastActionAt: now,
      decisionRecommendation: recommendation || undefined,
      decision: decision || undefined,
      linkedCaseIds: linkedCaseIds || undefined,
      decisionRecordIds: decisionRecordIds || undefined,
    };

    let assigneeUserId: string | null = null;
    let assigneeUserNo: string | null = null;

    if (dto.action === ComplianceAlertAction.ASSIGN) {
      assigneeUserId = this.normalizeOptionalString(dto.assigneeUserId) || actor.actorId;
      assigneeUserNo = await this.resolveUserNo(assigneeUserId, db);
      if (!assigneeUserNo) {
        throw new BadRequestException(`Assignee user not found: ${assigneeUserId}`);
      }
      updateData.assigneeUserId = assigneeUserId;
      updateData.assigneeUserNo = assigneeUserNo;
      updateData.assignedAt = now;
    }

    if (dto.action === ComplianceAlertAction.UNASSIGN) {
      updateData.assigneeUserId = null;
      updateData.assigneeUserNo = null;
      updateData.assignedAt = null;
    }

    if (resolution.isCloseAction) {
      updateData.closedAt = now;
      updateData.closeReason = reason || note || null;
      updateData.assigneeUserId = current.assigneeUserId || null;
      updateData.assigneeUserNo = current.assigneeUserNo || null;
    } else {
      updateData.closedAt = null;
      updateData.closeReason = null;
    }

    const updated = await db.complianceAlert.update({
      where: { id },
      data: updateData,
    });

    await this.appendEvent(db, {
      alertId: updated.id,
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
        recommendation,
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
        module: AuditModules.COMPLIANCE_ALERTS,
        entityType: AuditEntityTypes.COMPLIANCE_ALERT,
        entityId: updated.id,
        entityNo: updated.alertNo,
        entityOwnerType: updated.ownerType || undefined,
        entityOwnerId: updated.ownerId || undefined,
        statusFrom: resolution.statusChanged ? currentStatus : undefined,
        statusTo: resolution.statusChanged ? updated.status : undefined,
        reason: reason || note || `${dto.action} executed`,
        metadata: {
          action: dto.action,
          note: note || null,
          assigneeUserId,
          assigneeUserNo,
          recommendation,
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
      tx,
    );

    const detail = await db.complianceAlert.findUnique({
      where: { id: updated.id },
      include: {
        events: {
          orderBy: { eventAt: 'desc' },
        },
      },
    });

    if (!detail) {
      throw new NotFoundException(`Compliance alert not found: ${updated.id}`);
    }

    return {
      ...this.mapAlert(detail),
      events: (detail as AlertWithEvents).events.map((event) =>
        this.mapAlertEvent(event),
      ),
    };
  }
}
