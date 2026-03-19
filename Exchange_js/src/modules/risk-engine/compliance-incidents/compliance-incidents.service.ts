import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ComplianceIncident,
  ComplianceIncidentAlert,
  ComplianceIncidentDispositionRecord,
  ComplianceIncidentEvent,
  ComplianceIncidentReport,
  Prisma,
} from '@prisma/client';
import { generateReferenceNo } from '../../../common/utils/no-generator.util';
import { PrismaService } from '../../../core/prisma/prisma.service';
import {
  CASE_DISPOSITION_CODES,
  mirrorLegacyDecisionFromDisposition,
  normalizeCaseDispositionCode,
} from '../constants/compliance-disposition.constant';
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
  ComplianceCaseType,
  ComplianceCaseFreezeStatus,
  ComplianceCaseReportStatus,
  ComplianceIncidentAction,
  ComplianceIncidentAlertRelationType,
  ComplianceIncidentEventType,
  ComplianceIncidentReportVersionStatus,
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
import {
  FinalizeCaseReportDto,
  UpsertCaseReportDraftDto,
} from './dto/compliance-incident-report.dto';
import {
  CASE_COMPLIANCE_ACTIONS,
  CASE_COMPLIANCE_ACTIONS_BY_STAGE,
  CASE_WORK_ITEM_ACTIONS,
  ONBOARDING_REVIEW_STAGES,
  ONBOARDING_SOURCE_TYPE,
  ONBOARDING_WORKFLOW,
  PERIODIC_REVIEW_SOURCE_TYPE,
  PERIODIC_REVIEW_WORKFLOW,
  getWorkflowFromSourceType,
  isSupportedReviewSourceType,
  normalizeComplianceReviewStage,
  normalizeComplianceRuleCode,
} from '../constants/onboarding-compliance-workflow.constant';

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
        decisionRecommendation: string | null;
        metadata: string | null;
        dueAt: Date;
        lastOccurredAt: Date;
      } | null;
    }
  >;
  events: ComplianceIncidentEvent[];
  dispositionRecords: ComplianceIncidentDispositionRecord[];
  reports: ComplianceIncidentReport[];
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

  private normalizeStringList(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value
      .map((item) => String(item || '').trim())
      .filter(Boolean);
  }

  private extractReasonCodes(metadata: Record<string, unknown>): string[] {
    return this.normalizeStringList(metadata.reasonCodes);
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

  private dedupeRecommendedDecisions(values: unknown[]): string[] {
    const normalized = values
      .map((item) => this.normalizeRecommendedDecision(item))
      .filter((item): item is string => !!item);
    return Array.from(new Set(normalized));
  }

  private getRecommendedDecisionsFromMetadata(
    metadata: Record<string, unknown>,
  ): string[] {
    if (!Array.isArray(metadata.recommendedDecisions)) return [];
    return this.dedupeRecommendedDecisions(metadata.recommendedDecisions as unknown[]);
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

  private deriveCaseType(input: {
    caseType?: string | null;
    sourceType?: string | null;
    ruleCode?: string | null;
  }): ComplianceCaseType {
    const stored = this.normalizeOptionalString(input.caseType);
    if (
      stored &&
      Object.values(ComplianceCaseType).includes(stored as ComplianceCaseType)
    ) {
      return stored as ComplianceCaseType;
    }

    const sourceType = this.normalizeOptionalString(input.sourceType)?.toUpperCase();
    const ruleCode = this.normalizeOptionalString(input.ruleCode)?.toUpperCase();

    if (sourceType === 'ONBOARDING_JOURNEY') {
      return ComplianceCaseType.ONBOARDING;
    }
    if (sourceType === PERIODIC_REVIEW_SOURCE_TYPE) {
      return ComplianceCaseType.PERIODIC_REVIEW;
    }
    if (
      sourceType === 'DEPOSIT' ||
      sourceType === 'WITHDRAW' ||
      (ruleCode && ruleCode.startsWith('TX_'))
    ) {
      return ComplianceCaseType.TRANSACTION;
    }
    return ComplianceCaseType.GENERIC;
  }

  private assertReviewCaseScope(input: {
    sourceType?: string | null;
    stage?: string | null;
    ruleCode?: string | null;
  }) {
    const workflow = getWorkflowFromSourceType(input.sourceType);
    if (!workflow) {
      throw new BadRequestException(
        `Unsupported compliance case sourceType: ${String(input.sourceType || '')}`,
      );
    }

    const stage = normalizeComplianceReviewStage(input.stage);
    if (!stage) {
      throw new BadRequestException(
        `Unsupported compliance case stage: ${String(input.stage || '')}`,
      );
    }

    const rule = normalizeComplianceRuleCode(input.ruleCode, stage, workflow);
    if (!rule) {
      throw new BadRequestException(
        `Unsupported compliance case ruleCode: ${String(input.ruleCode || '')}`,
      );
    }

    return { workflow, stage, rule };
  }

  private getCaseStructureSnapshot(row: {
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

  private normalizeIncidentReportVersionStatus(
    value: unknown,
  ): ComplianceIncidentReportVersionStatus {
    const normalized = String(value || '').trim().toUpperCase();
    if (normalized === ComplianceIncidentReportVersionStatus.FINALIZED) {
      return ComplianceIncidentReportVersionStatus.FINALIZED;
    }
    if (normalized === ComplianceIncidentReportVersionStatus.SUPERSEDED) {
      return ComplianceIncidentReportVersionStatus.SUPERSEDED;
    }
    return ComplianceIncidentReportVersionStatus.DRAFT;
  }

  private isReportLocked(row: {
    status?: string | null;
    reportStatus?: string | null;
  }): boolean {
    return (
      this.isClosedStatus(String(row.status || '')) ||
      this.normalizeReportStatus((row as any).reportStatus) ===
        ComplianceCaseReportStatus.REPORTED
    );
  }

  private mapIncidentReport(row: ComplianceIncidentReport) {
    return {
      ...row,
      status: this.normalizeIncidentReportVersionStatus(row.status),
      recommendedActions: this.parseJson(row.recommendedActions),
      linkedAlertSnapshot: this.parseJson(row.linkedAlertSnapshot),
      decisionRecordSnapshot: this.parseJson(row.decisionRecordSnapshot),
      providerResponseSnapshot: this.parseJson(row.providerResponseSnapshot),
    };
  }

  private getCurrentReport(
    reports: ComplianceIncidentReport[] | undefined,
  ): ComplianceIncidentReport | null {
    if (!Array.isArray(reports) || reports.length === 0) return null;
    return (
      reports.find((report) => report.isCurrent) ||
      [...reports].sort((a, b) => b.version - a.version)[0] ||
      null
    );
  }

  private getCurrentFinalizedReport(
    reports: ComplianceIncidentReport[] | undefined,
  ): ComplianceIncidentReport | null {
    const currentReport = this.getCurrentReport(reports);
    if (
      currentReport &&
      this.normalizeIncidentReportVersionStatus(currentReport.status) ===
        ComplianceIncidentReportVersionStatus.FINALIZED
    ) {
      return currentReport;
    }
    return null;
  }

  private buildReportMirrorSnapshot(report: ComplianceIncidentReport) {
    return {
      reportId: report.id,
      version: report.version,
      status: this.normalizeIncidentReportVersionStatus(report.status),
      finalizedAt: report.finalizedAt || null,
    };
  }

  private getAvailableWorkItemActions(
    row: {
      id: string;
      status?: string | null;
      ownerUserId?: string | null;
      freezeStatus?: string | null;
      restrictionStatus?: string | null;
      restrictionCaseId?: string | null;
      reports?: ComplianceIncidentReport[] | null;
    },
    actorId?: string | null,
  ): string[] {
    const status = String(row.status || '').trim().toUpperCase();
    const ownerUserId = this.normalizeOptionalString(row.ownerUserId);
    const freezeStatus = this.normalizeFreezeStatus((row as any).freezeStatus);
    const restrictionStatus = this.normalizeRestrictionStatus(
      (row as any).restrictionStatus,
    );
    const restrictionCaseId = this.normalizeOptionalString(
      (row as any).restrictionCaseId,
    );
    const hasFinalizedReport = !!this.getCurrentFinalizedReport(
      Array.isArray((row as any).reports) ? ((row as any).reports as ComplianceIncidentReport[]) : [],
    );
    const isCurrentAssignee = !!actorId && !!ownerUserId && ownerUserId === actorId;
    const isRestrictedByCurrentCase =
      restrictionStatus === 'RESTRICTED' && restrictionCaseId === row.id;

    if (status === ComplianceIncidentStatus.OPEN) {
      return [CASE_WORK_ITEM_ACTIONS.ASSIGN, CASE_WORK_ITEM_ACTIONS.LINK_ALERT];
    }
    if (status === ComplianceIncidentStatus.ASSIGNED && isCurrentAssignee) {
      const actions: string[] = [
        CASE_WORK_ITEM_ACTIONS.REASSIGN,
        CASE_WORK_ITEM_ACTIONS.LINK_ALERT,
      ];
      if (
        hasFinalizedReport &&
        freezeStatus !== ComplianceCaseFreezeStatus.FROZEN &&
        !isRestrictedByCurrentCase
      ) {
        actions.push(CASE_WORK_ITEM_ACTIONS.CLOSE);
      }
      return actions;
    }
    return [];
  }

  private getAvailableComplianceActions(
    row: {
      id: string;
      status?: string | null;
      ownerUserId?: string | null;
      customerId?: string | null;
      freezeStatus?: string | null;
      complianceHoldStatus?: string | null;
      complianceHoldCaseId?: string | null;
      restrictionStatus?: string | null;
      restrictionCaseId?: string | null;
      reportStatus?: string | null;
      stage?: string | null;
      reports?: ComplianceIncidentReport[] | null;
    },
    actorId?: string | null,
  ): string[] {
    const status = String(row.status || '').trim().toUpperCase();
    const stage = normalizeComplianceReviewStage((row as any).stage);
    const ownerUserId = this.normalizeOptionalString(row.ownerUserId);
    const customerId = this.normalizeOptionalString((row as any).customerId);
    const holdStatus = this.normalizeFreezeStatus(
      (row as any).complianceHoldStatus ?? (row as any).freezeStatus,
    );
    const holdCaseId = this.normalizeOptionalString(
      (row as any).complianceHoldCaseId,
    );
    const restrictionStatus = this.normalizeRestrictionStatus(
      (row as any).restrictionStatus,
    );
    const restrictionCaseId = this.normalizeOptionalString(
      (row as any).restrictionCaseId,
    );
    const reportStatus = this.normalizeReportStatus((row as any).reportStatus);
    const hasFinalizedReport = !!this.getCurrentFinalizedReport(
      Array.isArray((row as any).reports) ? ((row as any).reports as ComplianceIncidentReport[]) : [],
    );
    const isCurrentAssignee = !!actorId && !!ownerUserId && ownerUserId === actorId;
    const actions: string[] = [];

    if (status === ComplianceIncidentStatus.OPEN || (status === ComplianceIncidentStatus.ASSIGNED && isCurrentAssignee)) {
      if (customerId) {
        if (restrictionStatus === 'RESTRICTED') {
          if (restrictionCaseId === row.id) {
            actions.push(CASE_COMPLIANCE_ACTIONS.UNRESTRICT);
          }
        } else {
          actions.push(CASE_COMPLIANCE_ACTIONS.RESTRICT);
        }

        if (
          holdStatus === ComplianceCaseFreezeStatus.FROZEN &&
          holdCaseId === row.id
        ) {
          actions.push(CASE_COMPLIANCE_ACTIONS.UNFREEZE);
        } else if (holdStatus !== ComplianceCaseFreezeStatus.FROZEN) {
          actions.push(CASE_COMPLIANCE_ACTIONS.FREEZE);
        }
      }
      if (
        hasFinalizedReport &&
        reportStatus !== ComplianceCaseReportStatus.REPORTED
      ) {
        actions.push(CASE_COMPLIANCE_ACTIONS.REPORT);
      }
    }

    if (status === ComplianceIncidentStatus.ASSIGNED && isCurrentAssignee && stage) {
      for (const action of CASE_COMPLIANCE_ACTIONS_BY_STAGE[stage]) {
        if (!actions.includes(action)) {
          actions.push(action);
        }
      }
    }

    return actions;
  }

  private normalizeFreezeStatus(value: unknown): ComplianceCaseFreezeStatus {
    const normalized = String(value || '').trim().toUpperCase();
    if (normalized === ComplianceCaseFreezeStatus.FROZEN) {
      return ComplianceCaseFreezeStatus.FROZEN;
    }
    return ComplianceCaseFreezeStatus.ACTIVE;
  }

  private normalizeRestrictionStatus(value: unknown): 'CLEAR' | 'RESTRICTED' {
    const normalized = String(value || '').trim().toUpperCase();
    if (normalized === 'RESTRICTED') {
      return 'RESTRICTED';
    }
    return 'CLEAR';
  }

  private normalizeReportStatus(value: unknown): ComplianceCaseReportStatus {
    const normalized = String(value || '').trim().toUpperCase();
    if (normalized === ComplianceCaseReportStatus.REPORTED) {
      return ComplianceCaseReportStatus.REPORTED;
    }
    return ComplianceCaseReportStatus.NOT_REPORTED;
  }

  private resolveExplicitDispositionCode(input: {
    dispositionCode?: unknown;
    decision?: unknown;
  }) {
    const rawDispositionCode = this.normalizeOptionalString(input.dispositionCode);
    if (rawDispositionCode) {
      const normalized = normalizeCaseDispositionCode(rawDispositionCode);
      if (!normalized) {
        throw new BadRequestException(
          `Unsupported case dispositionCode: ${rawDispositionCode}`,
        );
      }
      return normalized;
    }

    const rawDecision = this.normalizeOptionalString(input.decision);
    if (rawDecision) {
      const normalized = normalizeCaseDispositionCode(rawDecision);
      if (!normalized) {
        throw new BadRequestException(`Unsupported case decision: ${rawDecision}`);
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
      normalizeCaseDispositionCode((row as any).currentDispositionCode) ||
      normalizeCaseDispositionCode(row.decision);
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
    current: ReturnType<ComplianceIncidentsService['getCurrentDispositionSnapshot']>,
  ) {
    const storedFinal =
      normalizeCaseDispositionCode((row as any).finalDispositionCode) ||
      (this.isClosedStatus(String((row as any).status || ''))
        ? normalizeCaseDispositionCode(row.decision)
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

  private mapDispositionRecord(row: ComplianceIncidentDispositionRecord) {
    const dispositionCode =
      normalizeCaseDispositionCode(row.dispositionCode) || row.dispositionCode;
    return {
      ...row,
      dispositionCode,
      legacyDecision:
        mirrorLegacyDecisionFromDisposition(dispositionCode) || dispositionCode,
    };
  }

  private async createDispositionRecord(
    db: IncidentWriteClient,
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
    return db.complianceIncidentDispositionRecord.create({
      data: {
        incidentId: current.id,
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

  private mapIncident(row: ComplianceIncident) {
    const metadata = this.parseJson(row.metadata);
    const normalizedMetadata =
      metadata && typeof metadata === 'object' && !Array.isArray(metadata)
        ? (metadata as Record<string, unknown>)
        : {};
    const structure = this.getCaseStructureSnapshot(row);
    const currentDisposition = this.getCurrentDispositionSnapshot(row);
    const finalDisposition = this.getFinalDispositionSnapshot(row, currentDisposition);
    return {
      ...row,
      caseNo: row.incidentNo,
      workflow: structure.workflow,
      stage: structure.stage,
      rule: structure.rule,
      ruleCode: structure.rule,
      caseType: this.deriveCaseType({
        caseType: (row as any).caseType,
        sourceType: row.sourceType,
        ruleCode: structure.rule,
      }),
      freezeStatus: this.normalizeFreezeStatus((row as any).freezeStatus),
      reportStatus: this.normalizeReportStatus((row as any).reportStatus),
      assigneeUserId: row.ownerUserId,
      assigneeUserNo: row.ownerUserNo,
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
      decision:
        mirrorLegacyDecisionFromDisposition(
          currentDisposition.currentDispositionCode,
        ) || this.normalizeOptionalString(row.decision),
      linkedCaseIds: this.parseJson(row.linkedCaseIds) || [],
      decisionRecordIds: this.parseJson(row.decisionRecordIds) || [],
      closureChecklist: this.parseJson(row.closureChecklist),
      metadata: metadata || {},
      reasonCodes: this.extractReasonCodes(normalizedMetadata),
      recommendedDecisions: this.getRecommendedDecisionsFromMetadata(
        normalizedMetadata,
      ),
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
        stage?: string | null;
        severity: string;
        status: string;
        title: string;
        sourceType: string;
        sourceId: string;
        sourceNo: string | null;
        decisionRecommendation: string | null;
        metadata: string | null;
        dueAt: Date;
        lastOccurredAt: Date;
      } | null;
    },
  ) {
    const alertRule =
      row.alert &&
      normalizeComplianceRuleCode(
        row.alert.ruleCode,
        (row.alert as any).stage || null,
        row.alert.sourceType,
      );
    return {
      ...row,
      alert: row.alert
        ? {
            ...row.alert,
            ruleCode: alertRule || row.alert.ruleCode,
          }
        : null,
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
            ComplianceIncidentAction.FREEZE,
            ComplianceIncidentAction.UNFREEZE,
            ComplianceIncidentAction.RESTRICT,
            ComplianceIncidentAction.UNRESTRICT,
            ComplianceIncidentAction.REPORT,
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
            ComplianceIncidentAction.CLOSE,
            ComplianceIncidentAction.LINK_ALERT,
            ComplianceIncidentAction.FREEZE,
            ComplianceIncidentAction.UNFREEZE,
            ComplianceIncidentAction.RESTRICT,
            ComplianceIncidentAction.UNRESTRICT,
            ComplianceIncidentAction.REPORT,
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
        throw new BadRequestException(`Unsupported case status: ${currentStatus}`);
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
      case ComplianceIncidentAction.CLOSE:
        return {
          nextStatus: ComplianceIncidentStatus.CLOSED,
          eventType: ComplianceIncidentEventType.CLOSED,
          auditAction: AuditActions.INCIDENT_CLOSED,
          requireReason: true,
          statusChanged: currentStatus !== ComplianceIncidentStatus.CLOSED,
        };
      case ComplianceIncidentAction.FREEZE:
        return {
          nextStatus: currentStatus,
          eventType: ComplianceIncidentEventType.FROZEN,
          auditAction: AuditActions.INCIDENT_FROZEN,
          requireReason: true,
          statusChanged: false,
        };
      case ComplianceIncidentAction.UNFREEZE:
        return {
          nextStatus: currentStatus,
          eventType: ComplianceIncidentEventType.UNFROZEN,
          auditAction: AuditActions.INCIDENT_UNFROZEN,
          requireReason: true,
          statusChanged: false,
        };
      case ComplianceIncidentAction.RESTRICT:
        return {
          nextStatus: currentStatus,
          eventType: ComplianceIncidentEventType.RESTRICTED,
          auditAction: AuditActions.INCIDENT_RESTRICTED,
          requireReason: true,
          statusChanged: false,
        };
      case ComplianceIncidentAction.UNRESTRICT:
        return {
          nextStatus: currentStatus,
          eventType: ComplianceIncidentEventType.UNRESTRICTED,
          auditAction: AuditActions.INCIDENT_UNRESTRICTED,
          requireReason: true,
          statusChanged: false,
        };
      case ComplianceIncidentAction.REPORT:
        return {
          nextStatus: currentStatus,
          eventType: ComplianceIncidentEventType.REPORTED,
          auditAction: AuditActions.INCIDENT_REPORTED,
          requireReason: true,
          statusChanged: false,
        };
      case ComplianceIncidentAction.LINK_ALERT:
        throw new BadRequestException(
          'Action LINK_ALERT must use POST /admin/compliance/cases/:id/alerts',
        );
      default:
        throw new BadRequestException(`Unsupported action: ${action}`);
    }
  }

  private async findCustomerControlSnapshot(
    customerId: string,
    db: IncidentWriteClient,
  ) {
    return db.customerMain.findUnique({
      where: { id: customerId },
      select: {
        id: true,
        customerNo: true,
        restrictionStatus: true,
        restrictionCaseId: true,
        restrictionReason: true,
        restrictionSetAt: true,
        restrictionReleasedAt: true,
        complianceHoldStatus: true,
        complianceHoldCaseId: true,
        complianceHoldReason: true,
        complianceHoldSetAt: true,
        complianceHoldReleasedAt: true,
      },
    });
  }

  private async getCustomerControlSnapshot(
    customerId: string,
    db: IncidentWriteClient,
  ) {
    const customer = await this.findCustomerControlSnapshot(customerId, db);
    if (!customer) {
      throw new NotFoundException(`Customer not found: ${customerId}`);
    }
    return customer;
  }

  private async resolveIncidentAssignee(
    userId: string,
    db: IncidentWriteClient,
  ): Promise<{ userNo: string; roleCodes: string[] }> {
    const user = await db.user.findUnique({
      where: { id: userId },
      select: {
        userNo: true,
        role: true,
        status: true,
        userRoles: {
          select: {
            role: {
              select: { code: true },
            },
          },
        },
      },
    });

    if (!user || !user.userNo) {
      throw new BadRequestException(`Assignee user not found: ${userId}`);
    }
    if (String(user.status || '').toUpperCase() !== 'ACTIVE') {
      throw new BadRequestException(`Assignee user is not ACTIVE: ${userId}`);
    }

    const roleCodes = Array.from(
      new Set(
        [
          String(user.role || '').trim().toUpperCase(),
          ...(user.userRoles || [])
            .map((item: any) => String(item?.role?.code || '').trim().toUpperCase()),
        ].filter(Boolean),
      ),
    );

    const eligible =
      roleCodes.includes('SUPER_ADMIN') ||
      roleCodes.includes('MLRO') ||
      roleCodes.includes('COMPLIANCE_LEAD');
    if (!eligible) {
      throw new BadRequestException(
        `Case assignee must have SUPER_ADMIN, COMPLIANCE_LEAD, or MLRO role: ${userId}`,
      );
    }

    return {
      userNo: user.userNo,
      roleCodes,
    };
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

  private async getIncidentForReportWrite(
    db: IncidentWriteClient,
    incidentId: string,
  ) {
    const incident = await db.complianceIncident.findUnique({
      where: { id: incidentId },
      include: {
        alerts: {
          include: {
            alert: {
              select: {
                id: true,
                alertNo: true,
                stage: true,
                ruleCode: true,
                sourceType: true,
                sourceId: true,
                sourceNo: true,
                severity: true,
                status: true,
                title: true,
              },
            },
          },
          orderBy: [{ relationType: 'asc' }, { linkedAt: 'desc' }],
        },
        reports: {
          orderBy: [{ version: 'desc' }],
        },
      },
    });

    if (!incident) {
      throw new NotFoundException(`Compliance case not found: ${incidentId}`);
    }
    if (
      !isSupportedReviewSourceType(incident.sourceType) ||
      !normalizeComplianceReviewStage((incident as any).stage)
    ) {
      throw new BadRequestException(
        `Case ${incidentId} is outside supported review scope`,
      );
    }

    return incident;
  }

  private assertReportEditable(row: {
    id: string;
    status?: string | null;
    reportStatus?: string | null;
  }) {
    if (this.isReportLocked(row)) {
      throw new ConflictException(
        `Case report is locked for case ${row.id} after REPORT or CLOSE`,
      );
    }
  }

  private buildReportPayloadSnapshots(
    incident: Awaited<
      ReturnType<ComplianceIncidentsService['getIncidentForReportWrite']>
    >,
  ) {
    const linkedAlertSnapshot = (Array.isArray((incident as any).alerts)
      ? (incident as any).alerts
      : []
    ).map((link: any) => ({
      id: link.id,
      relationType: link.relationType,
      linkedAt: link.linkedAt,
      linkedByNo: link.linkedByNo,
      note: link.note,
      alert: link.alert
        ? {
            id: link.alert.id,
            alertNo: link.alert.alertNo,
            stage: normalizeComplianceReviewStage(link.alert.stage) || link.alert.stage,
            ruleCode:
              normalizeComplianceRuleCode(
                link.alert.ruleCode,
                link.alert.stage,
                link.alert.sourceType,
              ) ||
              link.alert.ruleCode,
            sourceType: link.alert.sourceType,
            sourceId: link.alert.sourceId,
            sourceNo: link.alert.sourceNo,
            severity: link.alert.severity,
            status: link.alert.status,
            title: link.alert.title,
          }
        : null,
    }));

    const decisionRecordSnapshot = {
      decisionRecordIds: this.parseJson(incident.decisionRecordIds) || [],
    };

    const providerResponseSnapshot = {
      sourceModule: incident.sourceModule || null,
      sourceType: incident.sourceType || null,
      entityType: incident.entityType || null,
      entityId: incident.entityId || null,
      entityNo: incident.entityNo || null,
      linkedCaseIds: this.parseJson(incident.linkedCaseIds) || [],
      metadata: this.parseJson(incident.metadata),
    };

    return {
      linkedAlertSnapshot,
      decisionRecordSnapshot,
      providerResponseSnapshot,
    };
  }

  private async saveOrCreateReportDraftVersion(
    db: IncidentWriteClient,
    incident: Awaited<
      ReturnType<ComplianceIncidentsService['getIncidentForReportWrite']>
    >,
    dto: UpsertCaseReportDraftDto,
    actor: ComplianceIncidentActorContext,
    now: Date,
  ) {
    const currentReport = this.getCurrentReport(incident.reports);
    const structure = this.getCaseStructureSnapshot(incident);
    const snapshots = this.buildReportPayloadSnapshots(incident);
    const recommendedActions = this.serializeJson(dto.recommendedActions || null);
    const baseData = {
      workflow: structure.workflow || ONBOARDING_WORKFLOW,
      stage: structure.stage,
      ruleCode: structure.rule,
      factsSummary: this.normalizeOptionalString(dto.factsSummary),
      investigationScope: this.normalizeOptionalString(dto.investigationScope),
      evidenceSummary: this.normalizeOptionalString(dto.evidenceSummary),
      containmentSummary: this.normalizeOptionalString(dto.containmentSummary),
      analystConclusion: this.normalizeOptionalString(dto.analystConclusion),
      recommendedActions,
      finalDispositionCode: this.normalizeOptionalString(dto.finalDispositionCode),
      finalDispositionReason: this.normalizeOptionalString(
        dto.finalDispositionReason,
      ),
      linkedAlertSnapshot: this.serializeJson(snapshots.linkedAlertSnapshot),
      decisionRecordSnapshot: this.serializeJson(snapshots.decisionRecordSnapshot),
      providerResponseSnapshot: this.serializeJson(
        snapshots.providerResponseSnapshot,
      ),
    };

    if (!currentReport) {
      return db.complianceIncidentReport.create({
        data: {
          incidentId: incident.id,
          version: 1,
          isCurrent: true,
          status: ComplianceIncidentReportVersionStatus.DRAFT,
          createdByUserId: actor.actorId,
          createdByUserNo: actor.actorNo || null,
          ...baseData,
        },
      });
    }

    const currentStatus = this.normalizeIncidentReportVersionStatus(
      currentReport.status,
    );
    if (currentStatus === ComplianceIncidentReportVersionStatus.DRAFT) {
      return db.complianceIncidentReport.update({
        where: { id: currentReport.id },
        data: {
          ...baseData,
          updatedAt: now,
        },
      });
    }

    await db.complianceIncidentReport.update({
      where: { id: currentReport.id },
      data: {
        isCurrent: false,
        status: ComplianceIncidentReportVersionStatus.SUPERSEDED,
        supersededAt: now,
      },
    });

    return db.complianceIncidentReport.create({
      data: {
        incidentId: incident.id,
        version: currentReport.version + 1,
        isCurrent: true,
        status: ComplianceIncidentReportVersionStatus.DRAFT,
        createdByUserId: actor.actorId,
        createdByUserNo: actor.actorNo || null,
        ...baseData,
      },
    });
  }

  private async syncIncidentReportMirror(
    db: IncidentWriteClient,
    incidentId: string,
    report: ComplianceIncidentReport,
  ) {
    await db.complianceIncident.update({
      where: { id: incidentId },
      data: {
        resolutionSummary: this.normalizeOptionalString(report.analystConclusion),
        containmentSummary: this.normalizeOptionalString(
          report.containmentSummary,
        ),
        closureChecklist: this.serializeJson(
          this.buildReportMirrorSnapshot(report),
        ),
      },
    });
  }

  async findAll(query: ComplianceIncidentQueryDto) {
    const skip = this.normalizeSkip(query.skip);
    const take = this.normalizeTake(query.take);
    const where: Prisma.ComplianceIncidentWhereInput = {
      stage: { in: Object.values(ONBOARDING_REVIEW_STAGES) },
    };
    const andConditions: Prisma.ComplianceIncidentWhereInput[] = [];

    if (query.status) where.status = query.status;
    if (query.severity) where.severity = query.severity;
    if (query.customerNo) where.customerNo = query.customerNo;

    const assigneeUserId =
      this.normalizeOptionalString(query.assigneeUserId) ||
      this.normalizeOptionalString(query.ownerUserId);
    if (assigneeUserId) {
      where.ownerUserId = assigneeUserId;
    }

    if (
      query.caseType &&
      ![ComplianceCaseType.ONBOARDING, ComplianceCaseType.PERIODIC_REVIEW].includes(
        query.caseType,
      )
    ) {
      return {
        total: 0,
        skip,
        take,
        items: [],
      };
    }
    if (query.caseType) {
      where.caseType = query.caseType;
    } else {
      where.caseType = {
        in: [ComplianceCaseType.ONBOARDING, ComplianceCaseType.PERIODIC_REVIEW],
      };
    }
    where.sourceType = {
      in: [ONBOARDING_SOURCE_TYPE, PERIODIC_REVIEW_SOURCE_TYPE],
    };

    const caseNo =
      this.normalizeOptionalString(query.caseNo) ||
      this.normalizeOptionalString(query.incidentNo);
    if (caseNo) {
      where.incidentNo = { contains: caseNo };
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

  async getReport(id: string, actor?: ComplianceIncidentActorContext | null) {
    const detail = await this.findOne(id, actor);
    return {
      id: detail.id,
      caseNo: detail.caseNo,
      workflow: detail.workflow,
      stage: detail.stage,
      rule: detail.rule,
      reportLocked: (detail as any).reportLocked || false,
      currentReport: (detail as any).currentReport || null,
      reportHistory: (detail as any).reportHistory || [],
    };
  }

  async saveReportDraft(
    id: string,
    dto: UpsertCaseReportDraftDto,
    actor: ComplianceIncidentActorContext,
  ) {
    await this.prisma.$transaction(async (tx) => {
      const incident = await this.getIncidentForReportWrite(tx, id);
      this.assertReportEditable(incident);

      const now = new Date();
      const report = await this.saveOrCreateReportDraftVersion(
        tx,
        incident,
        dto,
        actor,
        now,
      );

      await this.syncIncidentReportMirror(tx, incident.id, report);

      await this.appendEvent(tx, {
        incidentId: incident.id,
        eventType: ComplianceIncidentEventType.REPORT_DRAFT_SAVED,
        eventAt: now,
        actorType: actor.actorType,
        actorId: actor.actorId,
        actorNo: actor.actorNo || null,
        actorRole: actor.actorRole || null,
        note: `Saved case report draft v${report.version}`,
        payload: {
          reportId: report.id,
          version: report.version,
          status: report.status,
        },
        sourcePlatform: actor.sourcePlatform || 'ADMIN_API',
      });

      await this.auditLogsService.recordByActor(
        {
          triggerType: AuditTriggerType.DATA_UPDATE,
          action: AuditActions.INCIDENT_REPORT_DRAFT_SAVED,
          module: AuditModules.COMPLIANCE_INCIDENTS,
          entityType: AuditEntityTypes.COMPLIANCE_INCIDENT,
          entityId: incident.id,
          entityNo: incident.incidentNo,
          reason: `Saved case report draft v${report.version}`,
          metadata: {
            reportId: report.id,
            version: report.version,
            status: report.status,
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

    return this.getReport(id, actor);
  }

  async finalizeReport(
    id: string,
    dto: FinalizeCaseReportDto,
    actor: ComplianceIncidentActorContext,
  ) {
    await this.prisma.$transaction(async (tx) => {
      const incident = await this.getIncidentForReportWrite(tx, id);
      this.assertReportEditable(incident);
      const currentReport = this.getCurrentReport(incident.reports);

      if (!currentReport) {
        throw new ConflictException(
          `Case ${incident.id} must have a draft report before finalize`,
        );
      }
      if (
        this.normalizeIncidentReportVersionStatus(currentReport.status) !==
        ComplianceIncidentReportVersionStatus.DRAFT
      ) {
        throw new ConflictException(
          `Current report version ${currentReport.version} is not a draft`,
        );
      }

      const requiredMissing = [
        ['factsSummary', currentReport.factsSummary],
        ['investigationScope', currentReport.investigationScope],
        ['evidenceSummary', currentReport.evidenceSummary],
        ['analystConclusion', currentReport.analystConclusion],
        ['recommendedActions', currentReport.recommendedActions],
        ['finalDispositionCode', currentReport.finalDispositionCode],
      ].filter(([, value]) => !this.normalizeOptionalString(value));
      if (requiredMissing.length > 0) {
        throw new BadRequestException(
          `Case report is missing required fields: ${requiredMissing
            .map(([field]) => field)
            .join(', ')}`,
        );
      }

      const finalizedDispositionCode = normalizeCaseDispositionCode(
        currentReport.finalDispositionCode,
      );
      if (!finalizedDispositionCode) {
        throw new BadRequestException(
          `Unsupported report finalDispositionCode: ${String(
            currentReport.finalDispositionCode || '',
          )}`,
        );
      }

      const now = new Date();
      const finalizedReport = await tx.complianceIncidentReport.update({
        where: { id: currentReport.id },
        data: {
          status: ComplianceIncidentReportVersionStatus.FINALIZED,
          finalizedByUserId: actor.actorId,
          finalizedByUserNo: actor.actorNo || null,
          finalizedAt: now,
        },
      });

      const dispositionRecord = await this.createDispositionRecord(tx, incident, {
        dispositionCode: finalizedDispositionCode,
        reason:
          this.normalizeOptionalString(currentReport.finalDispositionReason) ||
          this.normalizeOptionalString(dto.note) ||
          null,
        isFinal: false,
        source: 'CASE_REPORT_FINALIZED',
        sourceRefId: finalizedReport.id,
        actorType: actor.actorType,
        actorId: actor.actorId,
        actorNo: actor.actorNo || null,
        actorRole: actor.actorRole || null,
        createdAt: now,
      });

      await tx.complianceIncident.update({
        where: { id: incident.id },
        data: {
          currentDispositionCode: finalizedDispositionCode,
          currentDispositionReason:
            this.normalizeOptionalString(currentReport.finalDispositionReason) ||
            null,
          currentDispositionAt: now,
          currentDispositionById: actor.actorId,
          currentDispositionByNo: actor.actorNo || null,
          currentDispositionByRole: actor.actorRole || null,
          currentDispositionRecordId: dispositionRecord.id,
          decision:
            mirrorLegacyDecisionFromDisposition(finalizedDispositionCode) ||
            finalizedDispositionCode,
          resolutionSummary: this.normalizeOptionalString(
            finalizedReport.analystConclusion,
          ),
          containmentSummary: this.normalizeOptionalString(
            finalizedReport.containmentSummary,
          ),
          closureChecklist: this.serializeJson(
            this.buildReportMirrorSnapshot(finalizedReport),
          ),
          lastActionById: actor.actorId,
          lastActionByNo: actor.actorNo || null,
          lastActionByRole: actor.actorRole || null,
          lastActionAt: now,
        },
      });

      await this.appendEvent(tx, {
        incidentId: incident.id,
        eventType: ComplianceIncidentEventType.REPORT_FINALIZED,
        eventAt: now,
        actorType: actor.actorType,
        actorId: actor.actorId,
        actorNo: actor.actorNo || null,
        actorRole: actor.actorRole || null,
        note: `Finalized case report v${finalizedReport.version}`,
        payload: {
          reportId: finalizedReport.id,
          version: finalizedReport.version,
          finalDispositionCode: finalizedDispositionCode,
        },
        sourcePlatform: actor.sourcePlatform || 'ADMIN_API',
      });

      await this.auditLogsService.recordByActor(
        {
          triggerType: AuditTriggerType.DATA_UPDATE,
          action: AuditActions.INCIDENT_REPORT_FINALIZED,
          module: AuditModules.COMPLIANCE_INCIDENTS,
          entityType: AuditEntityTypes.COMPLIANCE_INCIDENT,
          entityId: incident.id,
          entityNo: incident.incidentNo,
          reason: `Finalized case report v${finalizedReport.version}`,
          metadata: {
            reportId: finalizedReport.id,
            version: finalizedReport.version,
            finalDispositionCode: finalizedDispositionCode,
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

    return this.getReport(id, actor);
  }

  async findOne(id: string, actor?: ComplianceIncidentActorContext | null) {
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
                stage: true,
                severity: true,
                status: true,
                title: true,
                sourceType: true,
                sourceId: true,
                sourceNo: true,
                decisionRecommendation: true,
                metadata: true,
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
        dispositionRecords: {
          orderBy: { createdAt: 'desc' },
        },
        reports: {
          orderBy: [{ version: 'desc' }],
        },
      },
    });

    if (!item) {
      throw new NotFoundException(`Compliance case not found: ${id}`);
    }
    if (
      !isSupportedReviewSourceType(item.sourceType) ||
      !normalizeComplianceReviewStage((item as any).stage)
    ) {
      throw new NotFoundException(`Compliance case not found: ${id}`);
    }

    const row = item as IncidentDetailRow;
    const customerControl =
      row.customerId
        ? await this.findCustomerControlSnapshot(row.customerId, this.prisma)
        : null;
    const actionContext = {
      ...row,
      restrictionStatus: customerControl?.restrictionStatus ?? null,
      restrictionCaseId: customerControl?.restrictionCaseId ?? null,
      complianceHoldStatus: customerControl?.complianceHoldStatus ?? null,
      complianceHoldCaseId: customerControl?.complianceHoldCaseId ?? null,
    };
    const mappedIncident = this.mapIncident(row);
    const mappedAlerts = row.alerts.map((alertLink) => this.mapIncidentAlert(alertLink));
    const reportHistory = (row.reports || []).map((report) =>
      this.mapIncidentReport(report),
    );
    const currentReport = this.getCurrentReport(row.reports || []);
    const mappedCurrentReport = currentReport
      ? this.mapIncidentReport(currentReport)
      : null;
    const primaryAlert = mappedAlerts.find((item) => item.relationType === 'PRIMARY')?.alert;
    const primaryAlertMetadata =
      primaryAlert?.metadata && typeof primaryAlert.metadata === 'string'
        ? this.parseJson(primaryAlert.metadata)
        : primaryAlert?.metadata;
    const normalizedPrimaryAlertMetadata =
      primaryAlertMetadata &&
      typeof primaryAlertMetadata === 'object' &&
      !Array.isArray(primaryAlertMetadata)
        ? (primaryAlertMetadata as Record<string, unknown>)
        : {};
    const fromPrimaryAlert = this.getRecommendedDecisionsFromMetadata(
      normalizedPrimaryAlertMetadata,
    );
    const fallbackRecommendation = this.normalizeRecommendedDecision(
      (primaryAlert as any)?.decisionRecommendation,
    );
    const fromIncidentSnapshot = (mappedIncident as any).recommendedDecisions || [];

    return {
      ...mappedIncident,
      recommendedDecisions:
        fromPrimaryAlert.length > 0
          ? fromPrimaryAlert
          : fallbackRecommendation
            ? [fallbackRecommendation]
            : fromIncidentSnapshot,
      currentReport: mappedCurrentReport,
      reportHistory,
      reportLocked: this.isReportLocked(row),
      dispositionHistory: (row.dispositionRecords || []).map((record) =>
        this.mapDispositionRecord(record),
      ),
      alerts: mappedAlerts,
      events: row.events.map((event) => this.mapIncidentEvent(event)),
      availableWorkItemActions: this.getAvailableWorkItemActions(
        actionContext,
        actor?.actorId || null,
      ),
      availableComplianceActions: this.getAvailableComplianceActions(
        actionContext,
        actor?.actorId || null,
      ),
    };
  }

  async markOverdueCases(now = new Date()) {
    const rows = await this.prisma.complianceIncident.findMany({
      where: {
        dueAt: { lt: now },
        status: { notIn: CLOSED_INCIDENT_STATUSES },
        overdueMarkedAt: null,
      },
      select: {
        id: true,
        incidentNo: true,
        status: true,
        caseType: true,
        sourceType: true,
        customerId: true,
      },
      take: 200,
      orderBy: { dueAt: 'asc' },
    });

    for (const row of rows) {
      await this.prisma.$transaction(async (tx) => {
        const current = await tx.complianceIncident.findUnique({
          where: { id: row.id },
          select: {
            id: true,
            incidentNo: true,
            status: true,
            caseType: true,
            sourceType: true,
            overdueMarkedAt: true,
            customerId: true,
          },
        });
        if (!current || current.overdueMarkedAt || this.isClosedStatus(current.status)) {
          return;
        }

        await tx.complianceIncident.update({
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
          incidentId: current.id,
          eventType: ComplianceIncidentEventType.OVERDUE_MARKED,
          eventAt: now,
          actorType: 'SYSTEM',
          actorId: 'SYSTEM',
          actorNo: 'SYSTEM',
          actorRole: 'SYSTEM',
          note: `Case ${current.incidentNo} marked overdue`,
          payload: {
            action: 'OVERDUE_MARKED',
            markedAt: now.toISOString(),
          },
          sourcePlatform: 'SYSTEM',
        });

        await this.auditLogsService.recordSystem(
          {
            triggerType: AuditTriggerType.SYSTEM_EVENT,
            action: AuditActions.INCIDENT_OVERDUE_MARKED,
            module: AuditModules.COMPLIANCE_INCIDENTS,
            entityType: AuditEntityTypes.COMPLIANCE_INCIDENT,
            entityId: current.id,
            entityNo: current.incidentNo,
            entityOwnerType: current.customerId ? 'CUSTOMER' : undefined,
            entityOwnerId: current.customerId || undefined,
            reason: `Case ${current.incidentNo} marked overdue`,
            metadata: {
              caseType: this.deriveCaseType({
                caseType: (current as any).caseType,
                sourceType: current.sourceType,
              }),
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

  async createFromAlert(
    alertId: string,
    dto: CreateIncidentFromAlertDto,
    actor: ComplianceIncidentActorContext,
  ) {
    const reason = this.normalizeOptionalString(dto.reason);
    if (!reason) {
      throw new BadRequestException('reason is required');
    }
    const decision = this.normalizeOptionalString(dto.decision);
    const linkedCaseIds =
      Array.isArray(dto.linkedCaseIds) && dto.linkedCaseIds.length > 0
        ? dto.linkedCaseIds
            .map((item) => this.normalizeOptionalString(item))
            .filter(Boolean) as string[]
        : [];
    const decisionRecordIds =
      Array.isArray(dto.decisionRecordIds) && dto.decisionRecordIds.length > 0
        ? dto.decisionRecordIds
            .map((item) => this.normalizeOptionalString(item))
            .filter(Boolean) as string[]
        : [];
    const recommendedActions =
      Array.isArray(dto.recommendedActions) && dto.recommendedActions.length > 0
        ? dto.recommendedActions
            .map((item) => this.normalizeOptionalString(item))
            .filter(Boolean) as string[]
        : [];

    const createdIncidentId = await this.prisma.$transaction(async (tx) => {
      const existingLink = await tx.complianceIncidentAlert.findUnique({
        where: { alertId },
        select: { incidentId: true },
      });
      if (existingLink) {
        throw new ConflictException(
          `Alert ${alertId} already linked to case ${existingLink.incidentId}`,
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
          `Alert ${alertId} must be ESCALATED before case creation`,
        );
      }
      const { workflow, stage, rule } = this.assertReviewCaseScope({
        sourceType: updatedAlert.sourceType,
        stage: (updatedAlert as any).stage,
        ruleCode: (updatedAlert as any).rule || (updatedAlert as any).ruleCode,
      });

      const alertMetadata =
        updatedAlert.metadata &&
        typeof updatedAlert.metadata === 'object' &&
        !Array.isArray(updatedAlert.metadata)
          ? (updatedAlert.metadata as Record<string, unknown>)
          : {};
      const inheritedRecommendedActions = Array.isArray(alertMetadata.recommendedActions)
        ? (alertMetadata.recommendedActions as unknown[])
            .map((item) => this.normalizeOptionalString(item))
            .filter(Boolean) as string[]
        : [];
      const inheritedRecommendedDecisions =
        this.getRecommendedDecisionsFromMetadata(alertMetadata);
      const effectiveRecommendedActions =
        recommendedActions.length > 0
          ? recommendedActions
          : inheritedRecommendedActions;
      const caseType =
        workflow === PERIODIC_REVIEW_WORKFLOW
          ? ComplianceCaseType.PERIODIC_REVIEW
          : ComplianceCaseType.ONBOARDING;

      const now = new Date();
      const incident = await tx.complianceIncident.create({
        data: {
          incidentNo: generateReferenceNo('CAS'),
          caseType,
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
          stage,
          ruleCode: rule,
          ownerUserId: null,
          ownerUserNo: null,
          alertCount: 1,
          firstAlertAt: updatedAlert.firstOccurredAt,
          lastAlertAt: updatedAlert.lastOccurredAt,
          dueAt:
            updatedAlert.dueAt ||
            this.toDueAt(updatedAlert.severity as ComplianceIncidentSeverity, now),
          decision,
          linkedCaseIds: this.serializeJson(linkedCaseIds.length > 0 ? linkedCaseIds : null),
          decisionRecordIds: this.serializeJson(
            decisionRecordIds.length > 0 ? decisionRecordIds : null,
          ),
          lastActionById: actor.actorId,
          lastActionByNo: actor.actorNo || null,
          lastActionByRole: actor.actorRole || null,
          lastActionAt: now,
          metadata: this.serializeJson({
            createReason: reason,
            createdFromAlertId: updatedAlert.id,
            createdFromAlertNo: updatedAlert.alertNo,
            workflow,
            stage,
            rule,
            caseType,
            sourceType: updatedAlert.sourceType,
            sourceId: updatedAlert.sourceId,
            decision,
            linkedCaseIds,
            decisionRecordIds,
            reasonCodes: this.extractReasonCodes(alertMetadata),
            engineRecommendedActions: effectiveRecommendedActions,
            recommendedDecisions: inheritedRecommendedDecisions,
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
          workflow,
          stage,
          rule,
          caseType,
          decision,
          linkedCaseIds,
          decisionRecordIds,
          recommendedActions: effectiveRecommendedActions,
          recommendedDecisions: inheritedRecommendedDecisions,
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
            workflow,
            stage,
            rule,
            caseType,
            severity: incident.severity,
            decision,
            linkedCaseIds,
            decisionRecordIds,
            recommendedActions: effectiveRecommendedActions,
            recommendedDecisions: inheritedRecommendedDecisions,
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

    return this.findOne(createdIncidentId, actor);
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
        throw new NotFoundException(`Compliance case not found: ${incidentId}`);
      }
      if (
        !isSupportedReviewSourceType(incident.sourceType) ||
        !normalizeComplianceReviewStage((incident as any).stage)
      ) {
        throw new BadRequestException(
          `Case ${incidentId} is outside supported review scope`,
        );
      }

      const status = incident.status as ComplianceIncidentStatus;
      if (
        ![
          ComplianceIncidentStatus.OPEN,
          ComplianceIncidentStatus.ASSIGNED,
        ].includes(status)
      ) {
        throw new BadRequestException(
          `Case ${incidentId} must be OPEN or ASSIGNED to link alerts`,
        );
      }

      const existingLink = await tx.complianceIncidentAlert.findUnique({
        where: { alertId },
        select: { incidentId: true },
      });
      if (existingLink) {
        throw new ConflictException(
          `Alert ${alertId} already linked to case ${existingLink.incidentId}`,
        );
      }

      const alert = await tx.complianceAlert.findUnique({
        where: { id: alertId },
        select: {
          id: true,
          alertNo: true,
          sourceType: true,
          stage: true,
          ruleCode: true,
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
      if (
        !isSupportedReviewSourceType(alert.sourceType) ||
        !normalizeComplianceReviewStage((alert as any).stage)
      ) {
        throw new BadRequestException(
          `Alert ${alertId} is outside supported review scope`,
        );
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
            caseType: this.deriveCaseType({
              caseType: (incident as any).caseType,
              sourceType: incident.sourceType,
            }),
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

    return this.findOne(incidentId, actor);
  }

  async applyAction(
    id: string,
    dto: UpdateComplianceIncidentActionDto,
    actor: ComplianceIncidentActorContext,
  ) {
    const updatedId = await this.prisma.$transaction(async (tx) => {
      const current = await tx.complianceIncident.findUnique({
        where: { id },
        include: {
          reports: {
            orderBy: [{ version: 'desc' }],
          },
        },
      });
      if (!current) {
        throw new NotFoundException(`Compliance case not found: ${id}`);
      }
      if (
        !isSupportedReviewSourceType(current.sourceType) ||
        !normalizeComplianceReviewStage((current as any).stage)
      ) {
        throw new BadRequestException(
          `Case ${id} is outside supported review scope`,
        );
      }

      const currentStatus = current.status as ComplianceIncidentStatus;
      this.assertActionAllowed(currentStatus, dto.action);
      const currentFinalizedReport = this.getCurrentFinalizedReport(
        current.reports || [],
      );
      let customerControlSnapshot:
        | Awaited<ReturnType<ComplianceIncidentsService['findCustomerControlSnapshot']>>
        | null
        | undefined;
      const loadCustomerControlSnapshot = async (): Promise<
        NonNullable<
          Awaited<
            ReturnType<ComplianceIncidentsService['findCustomerControlSnapshot']>
          >
        >
      > => {
        if (!current.customerId) {
          throw new BadRequestException(
            `Only customer-bound cases support ${dto.action}`,
          );
        }
        if (customerControlSnapshot === undefined) {
          customerControlSnapshot = await this.getCustomerControlSnapshot(
            current.customerId,
            tx,
          );
        }
        return customerControlSnapshot as NonNullable<
          Awaited<
            ReturnType<ComplianceIncidentsService['findCustomerControlSnapshot']>
          >
        >;
      };

      const resolution = this.resolveAction(dto.action, currentStatus);
      const reason = this.normalizeOptionalString(dto.reason);
      const note = this.normalizeOptionalString(dto.note);
      const decision = this.normalizeOptionalString(dto.decision);
      const dispositionReason =
        this.normalizeOptionalString(dto.dispositionReason) || reason || note;
      const explicitDispositionCode = this.resolveExplicitDispositionCode({
        dispositionCode: dto.dispositionCode,
        decision: dto.decision,
      });
      const linkedCaseIds = this.serializeJson(dto.linkedCaseIds || null);
      const decisionRecordIds = this.serializeJson(dto.decisionRecordIds || null);
      const currentOwnerUserId = this.normalizeOptionalString(current.ownerUserId);

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
      let reportRefNo: string | null = null;

      if (dto.action === ComplianceIncidentAction.ASSIGN) {
        assigneeUserId =
          this.normalizeOptionalString(dto.assigneeUserId) || actor.actorId;

        if (currentStatus === ComplianceIncidentStatus.ASSIGNED) {
          if (!currentOwnerUserId || currentOwnerUserId !== actor.actorId) {
            throw new ForbiddenException(
              `Only assignee ${currentOwnerUserId} can reassign this case`,
            );
          }
        }

        const assignee = await this.resolveIncidentAssignee(assigneeUserId, tx);
        assigneeUserNo = assignee.userNo;
        updateData.ownerUserId = assigneeUserId;
        updateData.ownerUserNo = assigneeUserNo;
        updateData.assignedAt = now;
      }

      if (
        [
          ComplianceIncidentAction.CLOSE,
          ComplianceIncidentAction.FREEZE,
          ComplianceIncidentAction.UNFREEZE,
          ComplianceIncidentAction.RESTRICT,
          ComplianceIncidentAction.UNRESTRICT,
          ComplianceIncidentAction.REPORT,
        ].includes(dto.action) &&
        currentStatus === ComplianceIncidentStatus.ASSIGNED
      ) {
        if (!currentOwnerUserId || currentOwnerUserId !== actor.actorId) {
          throw new ForbiddenException(
            `Only assignee ${currentOwnerUserId} can execute action ${dto.action}`,
          );
        }
      }

      if (dto.action === ComplianceIncidentAction.FREEZE) {
        const customer = await loadCustomerControlSnapshot();
        const currentHoldStatus = this.normalizeFreezeStatus(
          customer.complianceHoldStatus,
        );
        if (currentHoldStatus === ComplianceCaseFreezeStatus.FROZEN) {
          if (customer.complianceHoldCaseId === current.id) {
            throw new ConflictException(`Customer ${customer.id} is already frozen by this case`);
          }
          throw new ConflictException(
            `Customer ${customer.id} is already frozen by case ${customer.complianceHoldCaseId}`,
          );
        }

        updateData.freezeStatus = ComplianceCaseFreezeStatus.FROZEN;
        updateData.frozenAt = now;
        updateData.freezeReason = reason;

        await tx.customerMain.update({
          where: { id: current.customerId! },
          data: {
            complianceHoldStatus: ComplianceCaseFreezeStatus.FROZEN,
            complianceHoldCaseId: current.id,
            complianceHoldReason: reason,
            complianceHoldSetAt: now,
            complianceHoldReleasedAt: null,
          },
        });
      }

      if (dto.action === ComplianceIncidentAction.UNFREEZE) {
        const customer = await loadCustomerControlSnapshot();
        const currentHoldStatus = this.normalizeFreezeStatus(
          customer.complianceHoldStatus,
        );
        if (currentHoldStatus !== ComplianceCaseFreezeStatus.FROZEN) {
          throw new ConflictException(`Customer ${customer.id} is not currently frozen`);
        }
        if (
          customer.complianceHoldCaseId &&
          String(customer.complianceHoldCaseId).trim() !== current.id
        ) {
          throw new ConflictException(
            `Customer ${customer.id} is frozen by another case ${customer.complianceHoldCaseId}`,
          );
        }

        updateData.freezeStatus = ComplianceCaseFreezeStatus.ACTIVE;
        updateData.frozenAt = null;
        updateData.freezeReason = null;

        await tx.customerMain.update({
          where: { id: current.customerId! },
          data: {
            complianceHoldStatus: ComplianceCaseFreezeStatus.ACTIVE,
            complianceHoldCaseId: null,
            complianceHoldReason: null,
            complianceHoldReleasedAt: now,
          },
        });
      }

      if (dto.action === ComplianceIncidentAction.RESTRICT) {
        const customer = await loadCustomerControlSnapshot();
        const currentRestrictionStatus = this.normalizeRestrictionStatus(
          customer.restrictionStatus,
        );
        if (currentRestrictionStatus === 'RESTRICTED') {
          if (customer.restrictionCaseId === current.id) {
            throw new ConflictException(
              `Customer ${customer.id} is already restricted by this case`,
            );
          }
          throw new ConflictException(
            `Customer ${customer.id} is already restricted by case ${customer.restrictionCaseId}`,
          );
        }

        await tx.customerMain.update({
          where: { id: current.customerId! },
          data: {
            restrictionStatus: 'RESTRICTED',
            restrictionCaseId: current.id,
            restrictionReason: reason,
            restrictionSetAt: now,
            restrictionReleasedAt: null,
          },
        });
      }

      if (dto.action === ComplianceIncidentAction.UNRESTRICT) {
        const customer = await loadCustomerControlSnapshot();
        const currentRestrictionStatus = this.normalizeRestrictionStatus(
          customer.restrictionStatus,
        );
        if (currentRestrictionStatus !== 'RESTRICTED') {
          throw new ConflictException(`Customer ${customer.id} is not currently restricted`);
        }
        if (
          customer.restrictionCaseId &&
          String(customer.restrictionCaseId).trim() !== current.id
        ) {
          throw new ConflictException(
            `Customer ${customer.id} is restricted by another case ${customer.restrictionCaseId}`,
          );
        }

        await tx.customerMain.update({
          where: { id: current.customerId! },
          data: {
            restrictionStatus: 'CLEAR',
            restrictionCaseId: null,
            restrictionReason: null,
            restrictionReleasedAt: now,
          },
        });
      }

      if (dto.action === ComplianceIncidentAction.REPORT) {
        if (!currentFinalizedReport) {
          throw new ConflictException(
            `Case ${current.id} requires a finalized case report before REPORT`,
          );
        }
        if (
          this.normalizeReportStatus((current as any).reportStatus) ===
          ComplianceCaseReportStatus.REPORTED
        ) {
          throw new ConflictException(`Case ${current.id} has already been reported`);
        }
        reportRefNo = generateReferenceNo('RPT');
        updateData.reportStatus = ComplianceCaseReportStatus.REPORTED;
        updateData.reportRefNo = reportRefNo;
        updateData.reportedAt = now;
        updateData.reportReason = reason;
        updateData.reportedByUserId = actor.actorId;
        updateData.reportedByUserNo = actor.actorNo || null;
      }

      if (dto.action === ComplianceIncidentAction.CLOSE) {
        if (!currentFinalizedReport) {
          throw new ConflictException(
            `Case ${current.id} requires a finalized case report before CLOSE`,
          );
        }
        if (
          this.normalizeFreezeStatus((current as any).freezeStatus) ===
          ComplianceCaseFreezeStatus.FROZEN
        ) {
          throw new BadRequestException(
            `Case ${current.id} must be unfrozen before it can be closed`,
          );
        }
        if (currentStatus === ComplianceIncidentStatus.ASSIGNED) {
          if (!currentOwnerUserId || currentOwnerUserId !== actor.actorId) {
            throw new ForbiddenException(
              `Only assignee ${currentOwnerUserId} can close this case`,
            );
          }
        }
        if (current.customerId) {
          const customer = await loadCustomerControlSnapshot();
          if (
            this.normalizeRestrictionStatus(customer.restrictionStatus) ===
              'RESTRICTED' &&
            customer.restrictionCaseId === current.id
          ) {
            throw new BadRequestException(
              `Case ${current.id} must be unrestricted before it can be closed`,
            );
          }
        }
        updateData.closedAt = now;
        updateData.closeReason = reason || note || null;
      }

      let resolvedDispositionCode = explicitDispositionCode;
      let finalizeDisposition =
        dto.action === ComplianceIncidentAction.CLOSE &&
        (!!resolvedDispositionCode || !!dto.finalizeDisposition);

      if (dto.action === ComplianceIncidentAction.FREEZE) {
        resolvedDispositionCode = CASE_DISPOSITION_CODES.RESTRICT;
      }

      if (dto.action === ComplianceIncidentAction.RESTRICT) {
        resolvedDispositionCode = CASE_DISPOSITION_CODES.RESTRICT;
      }

      if (dto.action === ComplianceIncidentAction.REPORT) {
        resolvedDispositionCode = CASE_DISPOSITION_CODES.REPORT;
      }

      if (dto.action === ComplianceIncidentAction.CLOSE && currentFinalizedReport) {
        const reportDispositionCode = normalizeCaseDispositionCode(
          currentFinalizedReport.finalDispositionCode,
        );
        if (!reportDispositionCode) {
          throw new ConflictException(
            `Current finalized report for case ${current.id} does not have a valid final disposition`,
          );
        }
        if (
          resolvedDispositionCode &&
          resolvedDispositionCode !== reportDispositionCode
        ) {
          throw new ConflictException(
            `Close disposition ${resolvedDispositionCode} does not match finalized report disposition ${reportDispositionCode}`,
          );
        }
        resolvedDispositionCode = reportDispositionCode;
        finalizeDisposition = true;
      }

      if (resolvedDispositionCode) {
        const record = await this.createDispositionRecord(tx, current, {
          dispositionCode: resolvedDispositionCode,
          reason: dispositionReason,
          isFinal: finalizeDisposition,
          decisionRecordId: Array.isArray(dto.decisionRecordIds)
            ? dto.decisionRecordIds[0] || null
            : null,
          source: 'CASE_ACTION',
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
      } else if (dto.action === ComplianceIncidentAction.CLOSE) {
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

      const updated = await tx.complianceIncident.update({
        where: { id },
        data: updateData,
      });

      if (dto.action === ComplianceIncidentAction.CLOSE) {
        const linkedAlerts = await tx.complianceAlert.findMany({
          where: {
            incidentLinks: {
              some: { incidentId: updated.id },
            },
            status: {
              in: [
                ComplianceAlertStatus.OPEN,
                ComplianceAlertStatus.ASSIGNED,
                ComplianceAlertStatus.ESCALATED,
              ],
            },
          },
          select: {
            id: true,
            status: true,
          },
        });

        for (const linkedAlert of linkedAlerts) {
          await tx.complianceAlert.update({
            where: { id: linkedAlert.id },
            data: {
              status: ComplianceAlertStatus.CLOSED,
              closedAt: now,
              closeReason:
                reason || note || `Closed by case ${updated.incidentNo}`,
              lastActionById: actor.actorId,
              lastActionByNo: actor.actorNo || null,
              lastActionByRole: actor.actorRole || null,
              lastActionAt: now,
            },
          });
          await tx.complianceAlertEvent.create({
            data: {
              alertId: linkedAlert.id,
              eventType: 'CLOSED',
              eventAt: now,
              actorType: actor.actorType,
              actorId: actor.actorId,
              actorNo: actor.actorNo || null,
              actorRole: actor.actorRole || null,
              note:
                reason || note || `Closed with case ${updated.incidentNo}`,
              payload: JSON.stringify({
                action: 'CASE_CLOSE_SYNC',
                incidentId: updated.id,
                statusFrom: linkedAlert.status,
                statusTo: ComplianceAlertStatus.CLOSED,
              }),
              sourcePlatform: actor.sourcePlatform || 'ADMIN_API',
            },
          });
        }
      }

      await this.appendEvent(tx, {
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
          reportRefNo,
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
          freezeStatus: this.normalizeFreezeStatus((updated as any).freezeStatus),
          reportStatus: this.normalizeReportStatus((updated as any).reportStatus),
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
            reportRefNo,
            decision:
              mirrorLegacyDecisionFromDisposition(resolvedDispositionCode) ||
              decision,
            dispositionCode: resolvedDispositionCode,
            dispositionReason: dispositionReason || null,
            finalizeDisposition,
            linkedCaseIds: dto.linkedCaseIds || null,
            decisionRecordIds: dto.decisionRecordIds || null,
            caseType: this.deriveCaseType({
              caseType: (updated as any).caseType,
              sourceType: updated.sourceType,
            }),
            freezeStatus: this.normalizeFreezeStatus((updated as any).freezeStatus),
            reportStatus: this.normalizeReportStatus((updated as any).reportStatus),
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

      return updated.id;
    });

    return this.findOne(updatedId, actor);
  }
}
