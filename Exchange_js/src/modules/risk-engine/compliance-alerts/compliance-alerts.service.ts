import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ComplianceAlert,
  ComplianceAlertDispositionRecord,
  ComplianceAlertEvent,
  Prisma,
} from '@prisma/client';
import { generateReferenceNo } from '../../../common/utils/no-generator.util';
import { PrismaService } from '../../../core/prisma/prisma.service';
import {
  ALERT_DISPOSITION_CODES,
  mirrorLegacyDecisionFromDisposition,
  normalizeAlertDispositionCode,
} from '../constants/compliance-disposition.constant';
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
import {
  ALERT_COMPLIANCE_ACTIONS,
  ALERT_COMPLIANCE_ACTIONS_BY_STAGE,
  ALERT_WORK_ITEM_ACTIONS,
  LEGACY_ONBOARDING_REVIEW_RULE,
  ONBOARDING_REVIEW_STAGES,
  ONBOARDING_SOURCE_TYPE,
  PERIODIC_REVIEW_WORKFLOW,
  getCanonicalOnboardingRuleForStage,
  getCanonicalReviewRuleForStage,
  getWorkflowFromSourceType,
  isSupportedReviewSourceType,
  normalizeComplianceReviewStage,
  normalizeComplianceRuleCode,
  normalizeOnboardingReviewStage,
} from '../constants/onboarding-compliance-workflow.constant';

type AlertWriteClient = Prisma.TransactionClient | PrismaService;
type AlertWithEvents = ComplianceAlert & {
  events: ComplianceAlertEvent[];
  dispositionRecords: ComplianceAlertDispositionRecord[];
};

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

  private normalizeStringList(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value
      .map((item) => String(item || '').trim())
      .filter(Boolean);
  }

  private extractReasonCodes(metadata: Record<string, unknown>): string[] {
    return this.normalizeStringList(metadata.reasonCodes);
  }

  private assertReviewAlertInput(
    input: Pick<TriggerComplianceAlertInput, 'sourceType' | 'stage' | 'ruleCode'>,
  ) {
    const workflow = getWorkflowFromSourceType(input.sourceType);
    if (!workflow) {
      throw new BadRequestException(
        `Unsupported compliance alert sourceType: ${String(input.sourceType || '')}`,
      );
    }

    const stage = normalizeComplianceReviewStage(input.stage);
    if (!stage) {
      throw new BadRequestException(
        `Unsupported compliance alert stage: ${String(input.stage || '')}`,
      );
    }

    const canonicalRule = normalizeComplianceRuleCode(input.ruleCode, stage, workflow);
    if (!canonicalRule) {
      throw new BadRequestException(
        `Unsupported compliance alert ruleCode: ${String(input.ruleCode || '')}`,
      );
    }

    return { workflow, stage, canonicalRule };
  }

  private getRuleSnapshot(row: {
    sourceType?: string | null;
    stage?: string | null;
    ruleCode?: string | null;
  }) {
    const rawStage = this.normalizeOptionalString((row as any).stage);
    const workflow = getWorkflowFromSourceType((row as any).sourceType);
    const stage = normalizeComplianceReviewStage(rawStage);
    const rule =
      normalizeComplianceRuleCode((row as any).ruleCode, stage, workflow) ||
      this.normalizeOptionalString((row as any).ruleCode);

    return {
      workflow,
      stage: stage || rawStage,
      rule,
    };
  }

  private getAvailableWorkItemActions(
    row: {
      status?: string | null;
      assigneeUserId?: string | null;
    },
    actorId?: string | null,
  ): string[] {
    const status = String(row.status || '').trim().toUpperCase();
    const assigneeUserId = this.normalizeOptionalString(row.assigneeUserId);
    const isCurrentAssignee = !!actorId && !!assigneeUserId && assigneeUserId === actorId;

    if (status === ComplianceAlertStatus.OPEN) {
      return [ALERT_WORK_ITEM_ACTIONS.ASSIGN];
    }
    if (status === ComplianceAlertStatus.ASSIGNED && isCurrentAssignee) {
      return [ALERT_WORK_ITEM_ACTIONS.REASSIGN, ALERT_WORK_ITEM_ACTIONS.CLOSE];
    }
    if (status === ComplianceAlertStatus.ESCALATED && isCurrentAssignee) {
      return [ALERT_WORK_ITEM_ACTIONS.CLOSE];
    }
    return [];
  }

  private getAvailableComplianceActions(
    row: {
      status?: string | null;
      assigneeUserId?: string | null;
      stage?: string | null;
    },
    actorId?: string | null,
  ): string[] {
    const status = String(row.status || '').trim().toUpperCase();
    const stage = normalizeComplianceReviewStage((row as any).stage);
    const assigneeUserId = this.normalizeOptionalString(row.assigneeUserId);
    const isCurrentAssignee = !!actorId && !!assigneeUserId && assigneeUserId === actorId;

    if (!stage || status !== ComplianceAlertStatus.ASSIGNED || !isCurrentAssignee) {
      return [];
    }

    return [...ALERT_COMPLIANCE_ACTIONS_BY_STAGE[stage]];
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

  private resolveExplicitDispositionCode(input: {
    dispositionCode?: unknown;
    decision?: unknown;
  }) {
    const rawDispositionCode = this.normalizeOptionalString(input.dispositionCode);
    if (rawDispositionCode) {
      const normalized = normalizeAlertDispositionCode(rawDispositionCode);
      if (!normalized) {
        throw new BadRequestException(
          `Unsupported alert dispositionCode: ${rawDispositionCode}`,
        );
      }
      return normalized;
    }

    const rawDecision = this.normalizeOptionalString(input.decision);
    if (rawDecision) {
      const normalized = normalizeAlertDispositionCode(rawDecision);
      if (!normalized) {
        throw new BadRequestException(`Unsupported alert decision: ${rawDecision}`);
      }
      return normalized;
    }

    return null;
  }

  private getCurrentDispositionSnapshot(row: {
    currentDispositionCode?: string | null;
    currentDispositionReason?: string | null;
    currentDispositionAt?: Date | null;
    currentDispositionById?: string | null;
    currentDispositionByNo?: string | null;
    currentDispositionByRole?: string | null;
    currentDispositionRecordId?: string | null;
    decision?: string | null;
  }) {
    const currentDispositionCode =
      normalizeAlertDispositionCode((row as any).currentDispositionCode) ||
      normalizeAlertDispositionCode(row.decision);
    return {
      currentDispositionCode,
      currentDispositionReason: this.normalizeOptionalString(
        (row as any).currentDispositionReason,
      ),
      currentDispositionAt: (row as any).currentDispositionAt || null,
      currentDispositionById: this.normalizeOptionalString(
        (row as any).currentDispositionById,
      ),
      currentDispositionByNo: this.normalizeOptionalString(
        (row as any).currentDispositionByNo,
      ),
      currentDispositionByRole: this.normalizeOptionalString(
        (row as any).currentDispositionByRole,
      ),
      currentDispositionRecordId: this.normalizeOptionalString(
        (row as any).currentDispositionRecordId,
      ),
    };
  }

  private getFinalDispositionSnapshot(
    row: {
      finalDispositionCode?: string | null;
      finalDispositionReason?: string | null;
      finalDispositionAt?: Date | null;
      finalDispositionRecordId?: string | null;
      decision?: string | null;
      status?: string | null;
    },
    current: ReturnType<ComplianceAlertsService['getCurrentDispositionSnapshot']>,
  ) {
    const storedFinal =
      normalizeAlertDispositionCode((row as any).finalDispositionCode) ||
      (this.isClosedStatus(String((row as any).status || ''))
        ? normalizeAlertDispositionCode(row.decision)
        : null);

    return {
      finalDispositionCode: storedFinal,
      finalDispositionReason:
        this.normalizeOptionalString((row as any).finalDispositionReason) || null,
      finalDispositionAt: (row as any).finalDispositionAt || null,
      finalDispositionRecordId:
        this.normalizeOptionalString((row as any).finalDispositionRecordId) ||
        (storedFinal && current.currentDispositionCode === storedFinal
          ? current.currentDispositionRecordId
          : null),
    };
  }

  private mapDispositionRecord(row: ComplianceAlertDispositionRecord) {
    const dispositionCode =
      normalizeAlertDispositionCode(row.dispositionCode) || row.dispositionCode;
    return {
      ...row,
      dispositionCode,
      legacyDecision:
        mirrorLegacyDecisionFromDisposition(dispositionCode) || dispositionCode,
    };
  }

  private buildAlertDetailResponse(
    item: AlertWithEvents,
    actor?: ComplianceAlertActorContext | null,
  ) {
    const mapped = this.mapAlert(item);
    const events = Array.isArray(item.events) ? item.events : [];
    const dispositionRecords = Array.isArray(item.dispositionRecords)
      ? item.dispositionRecords
      : [];

    return {
      ...mapped,
      events: events.map((event) => this.mapAlertEvent(event)),
      dispositionHistory: dispositionRecords.map((record) =>
        this.mapDispositionRecord(record),
      ),
      availableWorkItemActions: this.getAvailableWorkItemActions(
        item,
        actor?.actorId || null,
      ),
      availableComplianceActions: this.getAvailableComplianceActions(
        item,
        actor?.actorId || null,
      ),
    };
  }

  private async createDispositionRecord(
    db: AlertWriteClient,
    current: {
      id: string;
      currentDispositionRecordId?: string | null;
    },
    input: {
      dispositionCode: string;
      reason?: string | null;
      isFinal: boolean;
      decisionRecordId?: string | null;
      source?: string | null;
      sourceRefId?: string | null;
      actorType: string;
      actorId: string;
      actorNo?: string | null;
      actorRole?: string | null;
      createdAt: Date;
    },
  ) {
    return db.complianceAlertDispositionRecord.create({
      data: {
        alertId: current.id,
        dispositionCode: input.dispositionCode,
        reason: input.reason || null,
        isFinal: input.isFinal,
        supersedesRecordId:
          this.normalizeOptionalString(current.currentDispositionRecordId) || null,
        decisionRecordId: this.normalizeOptionalString(input.decisionRecordId) || null,
        source: this.normalizeOptionalString(input.source) || null,
        sourceRefId: this.normalizeOptionalString(input.sourceRefId) || null,
        actorType: input.actorType,
        actorId: input.actorId,
        actorNo: input.actorNo || null,
        actorRole: input.actorRole || null,
        createdAt: input.createdAt,
      },
    });
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
    if (contextType === 'ONBOARDING_CDD' || contextType === 'PERIODIC_REVIEW_CDD') {
      return ['APPROVE', 'REJECT', 'REQUIRE_EDD'];
    }
    if (contextType === 'ONBOARDING_EDD' || contextType === 'PERIODIC_REVIEW_EDD') {
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
    const ruleSnapshot = this.getRuleSnapshot(row);
    const currentDisposition = this.getCurrentDispositionSnapshot(row);
    const finalDisposition = this.getFinalDispositionSnapshot(row, currentDisposition);
    const mirroredDecision =
      mirrorLegacyDecisionFromDisposition(currentDisposition.currentDispositionCode) ||
      this.normalizeOptionalString(row.decision);

    return {
      ...row,
      workflow: ruleSnapshot.workflow,
      stage: ruleSnapshot.stage,
      rule: ruleSnapshot.rule,
      ruleCode: ruleSnapshot.rule,
      metadata: metadata || {},
      reasonCodes: this.extractReasonCodes(normalizedMetadata),
      currentDispositionCode: currentDisposition.currentDispositionCode,
      currentDispositionReason: currentDisposition.currentDispositionReason,
      currentDispositionAt: currentDisposition.currentDispositionAt,
      currentDispositionById: currentDisposition.currentDispositionById,
      currentDispositionByNo: currentDisposition.currentDispositionByNo,
      currentDispositionByRole: currentDisposition.currentDispositionByRole,
      currentDispositionRecordId: currentDisposition.currentDispositionRecordId,
      finalDispositionCode: finalDisposition.finalDispositionCode,
      finalDispositionReason: finalDisposition.finalDispositionReason,
      finalDispositionAt: finalDisposition.finalDispositionAt,
      finalDispositionRecordId: finalDisposition.finalDispositionRecordId,
      decision: mirroredDecision,
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
    const availableRuleCodes = Object.keys(COMPLIANCE_ALERT_RULES).filter((ruleCode) =>
      ruleCode !== 'ONB_ONBOARDING_JOURNEY_REVIEW',
    );
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

  private buildSimulatedAlertInput(
    ruleCode: string,
    batchId: string,
  index: number,
  ): TriggerComplianceAlertInput {
    const sequence = String(index + 1).padStart(2, '0');
    const randomSegment = Math.floor(Math.random() * 1_000_000)
      .toString(36)
      .padStart(4, '0');
    const customerId = `sim-customer-${batchId}-${sequence}`;
    const journeyId = `sim-journey-${batchId}-${sequence}`;
    const sourceId = `${customerId}:${journeyId}`;
    const customerNo = `SIMCU-${batchId.slice(-6).toUpperCase()}-${sequence}`;
    const entityId = `sim-entity-${batchId}-${sequence}-${randomSegment}`;
    const entityNo = `SIM-ENT-${batchId.slice(-6).toUpperCase()}-${sequence}`;
    const sourceNo = `SIM-SRC-${batchId.slice(-6).toUpperCase()}-${sequence}`;
    const stage =
      normalizeOnboardingReviewStage(
        ruleCode === 'ONB_EDD_REVIEW_REQUIRED'
          ? ONBOARDING_REVIEW_STAGES.REVIEW_EDD
          : ONBOARDING_REVIEW_STAGES.REVIEW_CDD,
      ) || ONBOARDING_REVIEW_STAGES.REVIEW_CDD;

    return {
      ruleCode,
      sourceModule: AuditModules.ONBOARDING,
      sourceType: ONBOARDING_SOURCE_TYPE,
      sourceId,
      sourceNo,
      stage,
      journeyId,
      entityType: AuditEntityTypes.CUSTOMER,
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
        reasonCodes: ruleCode === 'ONB_EDD_REVIEW_REQUIRED' ? ['EDD_REQUIRED'] : ['CDD_REQUIRED'],
      },
      sourcePlatform: 'ADMIN_SIMULATOR',
    };
  }

  async triggerSystemAlert(
    input: TriggerComplianceAlertInput,
    tx?: Prisma.TransactionClient,
  ) {
    const db = this.getDb(tx);
    const { stage, canonicalRule } = this.assertReviewAlertInput(input);
    const rule = this.ensureRule(canonicalRule);
    const occurredAt = input.occurredAt || new Date();
    const severity = input.severity || rule.severity;
    const dedupeKey = this.buildDedupeKey({
      ...input,
      ruleCode: canonicalRule,
      stage,
    });
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
    const explicitDispositionCode = this.resolveExplicitDispositionCode({
      decision: input.decision,
    });

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
          ruleCode: canonicalRule,
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
          stage,
          decisionRecommendation,
          decision,
          linkedCaseIds,
          decisionRecordIds,
          overdueMarkedAt: null,
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
          ruleCode: canonicalRule,
          dedupeKey,
          sourceType: input.sourceType,
          sourceId: input.sourceId,
          stage,
          metadata: input.metadata || null,
        },
        sourcePlatform,
      });

      if (explicitDispositionCode) {
        const record = await this.createDispositionRecord(db, created, {
          dispositionCode: explicitDispositionCode,
          reason: null,
          isFinal: false,
          decisionRecordId: Array.isArray(input.decisionRecordIds)
            ? input.decisionRecordIds[0] || null
            : null,
          source: 'SYSTEM_TRIGGER',
          sourceRefId: created.id,
          actorType: 'SYSTEM',
          actorId: 'SYSTEM',
          actorNo: 'SYSTEM',
          actorRole: 'SYSTEM',
          createdAt: occurredAt,
        });

        await db.complianceAlert.update({
          where: { id: created.id },
          data: {
            currentDispositionCode: explicitDispositionCode,
            currentDispositionReason: null,
            currentDispositionAt: occurredAt,
            currentDispositionById: 'SYSTEM',
            currentDispositionByNo: 'SYSTEM',
            currentDispositionByRole: 'SYSTEM',
            currentDispositionRecordId: record.id,
          },
        });
      }

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
            ruleCode: canonicalRule,
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
          ruleCode: canonicalRule,
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
          stage,
          decisionRecommendation,
          decision,
          linkedCaseIds,
          decisionRecordIds,
          overdueMarkedAt: null,
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
        note: `Alert triggered after terminal state: ${canonicalRule}`,
        payload: {
          ruleCode: canonicalRule,
          dedupeKey,
          previousAlertId: existing.id,
          sourceType: input.sourceType,
          sourceId: input.sourceId,
          stage,
          metadata: input.metadata || null,
        },
        sourcePlatform,
      });

      if (explicitDispositionCode) {
        const record = await this.createDispositionRecord(db, createdAfterClosed, {
          dispositionCode: explicitDispositionCode,
          reason: null,
          isFinal: false,
          decisionRecordId: Array.isArray(input.decisionRecordIds)
            ? input.decisionRecordIds[0] || null
            : null,
          source: 'SYSTEM_TRIGGER',
          sourceRefId: createdAfterClosed.id,
          actorType: 'SYSTEM',
          actorId: 'SYSTEM',
          actorNo: 'SYSTEM',
          actorRole: 'SYSTEM',
          createdAt: occurredAt,
        });

        await db.complianceAlert.update({
          where: { id: createdAfterClosed.id },
          data: {
            currentDispositionCode: explicitDispositionCode,
            currentDispositionReason: null,
            currentDispositionAt: occurredAt,
            currentDispositionById: 'SYSTEM',
            currentDispositionByNo: 'SYSTEM',
            currentDispositionByRole: 'SYSTEM',
            currentDispositionRecordId: record.id,
          },
        });
      }

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
          reason: `Alert triggered after terminal state: ${canonicalRule}`,
          metadata: {
            ruleCode: canonicalRule,
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
        stage,
        decisionRecommendation,
        decision,
        linkedCaseIds,
        decisionRecordIds,
        overdueMarkedAt: null,
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

    if (explicitDispositionCode) {
      const record = await this.createDispositionRecord(db, updated, {
        dispositionCode: explicitDispositionCode,
        reason: null,
        isFinal: false,
        decisionRecordId: Array.isArray(input.decisionRecordIds)
          ? input.decisionRecordIds[0] || null
          : null,
        source: 'SYSTEM_TRIGGER',
        sourceRefId: updated.id,
        actorType: 'SYSTEM',
        actorId: 'SYSTEM',
        actorNo: 'SYSTEM',
        actorRole: 'SYSTEM',
        createdAt: occurredAt,
      });

      await db.complianceAlert.update({
        where: { id: updated.id },
        data: {
          currentDispositionCode: explicitDispositionCode,
          currentDispositionReason: null,
          currentDispositionAt: occurredAt,
          currentDispositionById: 'SYSTEM',
          currentDispositionByNo: 'SYSTEM',
          currentDispositionByRole: 'SYSTEM',
          currentDispositionRecordId: record.id,
        },
      });
    }

    await this.appendEvent(db, {
      alertId: updated.id,
      eventType: ComplianceAlertEventType.TRIGGERED,
      eventAt: occurredAt,
      actorType: 'SYSTEM',
      actorId: 'SYSTEM',
      actorNo: 'SYSTEM',
      actorRole: 'SYSTEM',
      note: `Alert triggered again: ${canonicalRule}`,
      payload: {
        ruleCode: canonicalRule,
        dedupeKey,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        stage,
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
        reason: `Alert re-triggered: ${canonicalRule}`,
        metadata: {
          ruleCode: canonicalRule,
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
        ruleCode: created.ruleCode || selectedRuleCodes[i],
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
    const normalizedStage = normalizeComplianceReviewStage(query.stage);
    const rawRuleCode = this.normalizeOptionalString(query.ruleCode)?.toUpperCase() || null;

    if (query.status) where.status = query.status;
    if (query.severity) where.severity = query.severity;
    if (query.sourceType && !isSupportedReviewSourceType(query.sourceType)) {
      return {
        total: 0,
        skip,
        take,
        items: [],
      };
    }
    if (query.sourceType) {
      where.sourceType = query.sourceType;
    } else {
      where.sourceType = {
        in: [ONBOARDING_SOURCE_TYPE, 'PERIODIC_REVIEW_CYCLE'],
      };
    }
    if (query.sourceId) where.sourceId = query.sourceId;
    if (query.customerNo) where.customerNo = query.customerNo;
    if (query.assigneeUserId) where.assigneeUserId = query.assigneeUserId;
    if (normalizedStage) {
      where.stage = normalizedStage;
    } else {
      where.stage = {
        in: Object.values(ONBOARDING_REVIEW_STAGES),
      };
    }

    if (rawRuleCode) {
      const normalizedRule =
        normalizeComplianceRuleCode(
          rawRuleCode,
          normalizedStage || undefined,
          query.sourceType,
        ) ||
        (rawRuleCode === LEGACY_ONBOARDING_REVIEW_RULE ? rawRuleCode : null);

      if (!normalizedRule) {
        return {
          total: 0,
          skip,
          take,
          items: [],
        };
      }

      if (normalizedRule === LEGACY_ONBOARDING_REVIEW_RULE) {
        andConditions.push({
          OR: [
            {
              ruleCode: LEGACY_ONBOARDING_REVIEW_RULE,
            },
            {
              ruleCode: {
                in: [
                  getCanonicalOnboardingRuleForStage(ONBOARDING_REVIEW_STAGES.REVIEW_CDD) ||
                    'ONB_CDD_REVIEW_REQUIRED',
                  getCanonicalOnboardingRuleForStage(ONBOARDING_REVIEW_STAGES.REVIEW_EDD) ||
                    'ONB_EDD_REVIEW_REQUIRED',
                  getCanonicalReviewRuleForStage(
                    ONBOARDING_REVIEW_STAGES.REVIEW_CDD,
                    PERIODIC_REVIEW_WORKFLOW,
                  ) || 'PRR_CDD_REVIEW_REQUIRED',
                  getCanonicalReviewRuleForStage(
                    ONBOARDING_REVIEW_STAGES.REVIEW_EDD,
                    PERIODIC_REVIEW_WORKFLOW,
                  ) || 'PRR_EDD_REVIEW_REQUIRED',
                ],
              },
            },
          ],
        });
      } else {
        const legacyCompatibleStage =
          normalizedStage ||
          (String(normalizedRule).includes('_EDD_')
            ? ONBOARDING_REVIEW_STAGES.REVIEW_EDD
            : ONBOARDING_REVIEW_STAGES.REVIEW_CDD);
        andConditions.push({
          OR: [
            { ruleCode: normalizedRule },
            {
              ruleCode: LEGACY_ONBOARDING_REVIEW_RULE,
              stage: legacyCompatibleStage,
            },
          ],
        });
      }
    }

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

  async findOne(id: string, actor?: ComplianceAlertActorContext | null) {
    const item = await this.prisma.complianceAlert.findUnique({
      where: { id },
      include: {
        events: {
          orderBy: { eventAt: 'desc' },
        },
        dispositionRecords: {
          orderBy: [{ createdAt: 'desc' }],
        },
      },
    });

    if (!item) {
      throw new NotFoundException(`Compliance alert not found: ${id}`);
    }

    if (
      !isSupportedReviewSourceType(item.sourceType) ||
      !normalizeComplianceReviewStage((item as any).stage)
    ) {
      throw new NotFoundException(`Compliance alert not found: ${id}`);
    }

    return this.buildAlertDetailResponse(item as AlertWithEvents, actor);
  }

  async markOverdueAlerts(now = new Date()) {
    const rows = await this.prisma.complianceAlert.findMany({
      where: {
        dueAt: { lt: now },
        status: { notIn: CLOSED_ALERT_STATUSES },
        overdueMarkedAt: null,
      },
      select: {
        id: true,
        alertNo: true,
        status: true,
        ownerType: true,
        ownerId: true,
      },
      take: 200,
      orderBy: { dueAt: 'asc' },
    });

    for (const row of rows) {
      await this.prisma.$transaction(async (tx) => {
        const current = await tx.complianceAlert.findUnique({
          where: { id: row.id },
          select: {
            id: true,
            alertNo: true,
            status: true,
            ownerType: true,
            ownerId: true,
            overdueMarkedAt: true,
          },
        });
        if (!current || current.overdueMarkedAt || this.isClosedStatus(current.status)) {
          return;
        }

        await tx.complianceAlert.update({
          where: { id: current.id },
          data: {
            overdueMarkedAt: now,
            lastActionById: 'SYSTEM',
            lastActionByNo: 'SYSTEM',
            lastActionByRole: 'SYSTEM',
            lastActionAt: now,
          },
        });

        await this.appendEvent(tx, {
          alertId: current.id,
          eventType: ComplianceAlertEventType.OVERDUE_MARKED,
          eventAt: now,
          actorType: 'SYSTEM',
          actorId: 'SYSTEM',
          actorNo: 'SYSTEM',
          actorRole: 'SYSTEM',
          note: `Alert ${current.alertNo} marked overdue`,
          payload: {
            action: 'OVERDUE_MARKED',
            markedAt: now.toISOString(),
          },
          sourcePlatform: 'SYSTEM',
        });

        await this.auditLogsService.recordSystem(
          {
            triggerType: AuditTriggerType.SYSTEM_EVENT,
            action: AuditActions.ALERT_OVERDUE_MARKED,
            module: AuditModules.COMPLIANCE_ALERTS,
            entityType: AuditEntityTypes.COMPLIANCE_ALERT,
            entityId: current.id,
            entityNo: current.alertNo,
            entityOwnerType: current.ownerType || undefined,
            entityOwnerId: current.ownerId || undefined,
            reason: `Alert ${current.alertNo} marked overdue`,
            metadata: {
              markedAt: now.toISOString(),
            },
            sourcePlatform: 'SYSTEM',
          },
          tx,
        );
      });
    }

    return { markedCount: rows.length };
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
    if (
      !isSupportedReviewSourceType(current.sourceType) ||
      !normalizeComplianceReviewStage((current as any).stage)
    ) {
      throw new BadRequestException(
        `Alert ${id} is outside supported review scope`,
      );
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
    const dispositionReason =
      this.normalizeOptionalString(dto.dispositionReason) || reason || note;
    const explicitDispositionCode = this.resolveExplicitDispositionCode({
      dispositionCode: dto.dispositionCode,
      decision: dto.decision,
    });
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

    let resolvedDispositionCode = explicitDispositionCode;
    let finalizeDisposition =
      dto.action === ComplianceAlertAction.CLOSE &&
      (!!resolvedDispositionCode || !!dto.finalizeDisposition);

    if (dto.action === ComplianceAlertAction.ESCALATE) {
      resolvedDispositionCode = ALERT_DISPOSITION_CODES.ESCALATE_TO_CASE;
      finalizeDisposition = true;
    }

    if (resolvedDispositionCode) {
      const record = await this.createDispositionRecord(db, current, {
        dispositionCode: resolvedDispositionCode,
        reason: dispositionReason,
        isFinal: finalizeDisposition,
        decisionRecordId: Array.isArray(dto.decisionRecordIds)
          ? dto.decisionRecordIds[0] || null
          : null,
        source: 'ALERT_ACTION',
        sourceRefId: id,
        actorType: actor.actorType,
        actorId: actor.actorId,
        actorNo: actor.actorNo || null,
        actorRole: actor.actorRole || null,
        createdAt: now,
      });

      updateData.currentDispositionCode = resolvedDispositionCode;
      updateData.currentDispositionReason = dispositionReason || null;
      updateData.currentDispositionAt = now;
      updateData.currentDispositionById = actor.actorId;
      updateData.currentDispositionByNo = actor.actorNo || null;
      updateData.currentDispositionByRole = actor.actorRole || null;
      updateData.currentDispositionRecordId = record.id;
      updateData.decision =
        mirrorLegacyDecisionFromDisposition(resolvedDispositionCode) ||
        resolvedDispositionCode;

      if (finalizeDisposition) {
        updateData.finalDispositionCode = resolvedDispositionCode;
        updateData.finalDispositionReason = dispositionReason || null;
        updateData.finalDispositionAt = now;
        updateData.finalDispositionRecordId = record.id;
      }
    } else if (resolution.isCloseAction) {
      const currentDisposition = this.getCurrentDispositionSnapshot(current);
      if (currentDisposition.currentDispositionCode) {
        updateData.finalDispositionCode = currentDisposition.currentDispositionCode;
        updateData.finalDispositionReason =
          currentDisposition.currentDispositionReason || null;
        updateData.finalDispositionAt = now;
        updateData.finalDispositionRecordId =
          currentDisposition.currentDispositionRecordId || null;
        if (!decision) {
          updateData.decision =
            mirrorLegacyDecisionFromDisposition(
              currentDisposition.currentDispositionCode,
            ) || currentDisposition.currentDispositionCode;
        }
      }
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
        decision:
          mirrorLegacyDecisionFromDisposition(resolvedDispositionCode) ||
          decision,
        dispositionCode: resolvedDispositionCode,
        dispositionReason: dispositionReason || null,
        finalizeDisposition,
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
          decision:
            mirrorLegacyDecisionFromDisposition(resolvedDispositionCode) ||
            decision,
          dispositionCode: resolvedDispositionCode,
          dispositionReason: dispositionReason || null,
          finalizeDisposition,
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
        dispositionRecords: {
          orderBy: [{ createdAt: 'desc' }],
        },
      },
    });

    if (!detail) {
      throw new NotFoundException(`Compliance alert not found: ${updated.id}`);
    }

    return this.buildAlertDetailResponse(detail as AlertWithEvents, actor);
  }
}
