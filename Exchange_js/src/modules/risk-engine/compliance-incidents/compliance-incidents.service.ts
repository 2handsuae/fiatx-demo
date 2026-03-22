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
  ComplianceIncidentExternalFiling,
  ComplianceIncidentExternalFilingEvent,
  ComplianceIncidentReport,
  Prisma,
} from '@prisma/client';
import { generateReferenceNo } from '../../../common/utils/no-generator.util';
import { PrismaService } from '../../../core/prisma/prisma.service';
import {
  CASE_DISPOSITION_CODES,
  mirrorLegacyDecisionFromDisposition,
  normalizeCaseDispositionCode,
  normalizeWorkflowDecision,
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
  ComplianceCaseFilingStatus,
  ComplianceCaseReportStatus,
  ComplianceIncidentAction,
  ComplianceIncidentAlertRelationType,
  ComplianceIncidentExternalFilingAction,
  ComplianceIncidentEventType,
  ComplianceIncidentMlroAction,
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
  CloseCaseExternalFilingDto,
  FinalizeCaseReportDto,
  RecordCaseExternalFilingFeedbackDto,
  ReviewCaseByMlroDto,
  SubmitCaseExternalFilingDto,
  SubmitCaseToMlroDto,
  UpsertCaseReportDraftDto,
} from './dto/compliance-incident-report.dto';
import {
  CASE_ACTIONS,
  CASE_WORKFLOW_ACTIONS_BY_STAGE,
  INTERIM_MEASURES,
  ONBOARDING_WORKFLOW,
  PERIODIC_REVIEW_SOURCE_TYPE,
  PERIODIC_REVIEW_WORKFLOW,
  buildComplianceWorkflowTraceContext,
  getWorkflowFromSourceType,
  isSupportedReviewSourceType,
  normalizeComplianceReviewStage,
  normalizeComplianceRuleCode,
} from '../constants/onboarding-compliance-workflow.constant';
import { WorkflowTransitionService } from '../../identity/onboarding/workflow-transition.service';
import { OnboardingFinalApprovalService } from '../../identity/onboarding/onboarding-final-approval.service';

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
  filings: Array<
    ComplianceIncidentExternalFiling & {
      events: ComplianceIncidentExternalFilingEvent[];
    }
  >;
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

  constructor(
    private readonly prisma: PrismaService,
    private readonly workflowTransitionService: WorkflowTransitionService,
    private readonly onboardingFinalApprovalService: OnboardingFinalApprovalService,
  ) {
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

  private getIncidentAssigneeUserId(row: {
    assigneeUserId?: string | null;
    ownerUserId?: string | null;
  }): string | null {
    return (
      this.normalizeOptionalString((row as any).assigneeUserId) ||
      this.normalizeOptionalString((row as any).ownerUserId)
    );
  }

  private getIncidentAssigneeUserNo(row: {
    assigneeUserNo?: string | null;
    ownerUserNo?: string | null;
  }): string | null {
    return (
      this.normalizeOptionalString((row as any).assigneeUserNo) ||
      this.normalizeOptionalString((row as any).ownerUserNo)
    );
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

  private async getAuditWorkflowContext(
    db: IncidentWriteClient,
    row: {
    sourceType?: string | null;
    sourceNo?: string | null;
    journeyId?: string | null;
    metadata?: string | null;
  }) {
    const sourceType = this.normalizeOptionalString(row.sourceType);
    const metadata =
      row.metadata && typeof row.metadata === 'string'
        ? ((this.parseJson(row.metadata) as Record<string, unknown>) || {})
        : {};
    const sourceId =
      this.normalizeOptionalString((metadata as any).sourceId) || null;
    const sourceNo =
      this.normalizeOptionalString(row.sourceNo) ||
      this.normalizeOptionalString(row.journeyId) ||
      this.normalizeOptionalString((metadata as any).sourceNo) ||
      this.normalizeOptionalString((metadata as any).cycleNo);

    if (sourceType === PERIODIC_REVIEW_SOURCE_TYPE && sourceId) {
      let workflowNo = sourceNo;
      if (!workflowNo && (db as any).periodicReviewCycle) {
        const cycle = await (db as any).periodicReviewCycle.findUnique({
          where: { id: sourceId },
          select: { cycleNo: true },
        });
        workflowNo = this.normalizeOptionalString(cycle?.cycleNo);
      }
      return buildComplianceWorkflowTraceContext({
        sourceType,
        sourceId,
        sourceNo: workflowNo,
      });
    }

    return buildComplianceWorkflowTraceContext({
      sourceType,
      sourceId,
      sourceNo,
      journeyId: row.journeyId,
    });
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
    if (normalized === 'APPROVE' || normalized === 'APPROVE_STAGE' || normalized === 'CLEAR') {
      return 'CLEAR';
    }
    if (normalized === 'REJECT' || normalized === 'REJECT_STAGE') return 'REJECT';
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

  private normalizeBoolean(value: unknown): boolean | null {
    if (value === null || value === undefined) return null;
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    const normalized = String(value).trim().toLowerCase();
    if (!normalized) return null;
    if (['true', '1', 'yes'].includes(normalized)) return true;
    if (['false', '0', 'no'].includes(normalized)) return false;
    return null;
  }

  private normalizeDateInput(value: unknown): Date | null {
    const normalized = this.normalizeOptionalString(value);
    if (!normalized) return null;
    const parsed = new Date(normalized);
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException(`Invalid datetime input: ${normalized}`);
    }
    return parsed;
  }

  private isReportLocked(row: {
    status?: string | null;
    reportStatus?: string | null;
  }): boolean {
    return (
      this.isClosedStatus(String(row.status || '')) ||
      String(row.status || '').trim().toUpperCase() ===
        ComplianceIncidentStatus.PENDING_MLRO_REVIEW ||
      this.normalizeReportStatus((row as any).reportStatus) ===
        ComplianceCaseReportStatus.REPORTED
    );
  }

  private mapIncidentReport(row: ComplianceIncidentReport) {
    return {
      ...row,
      status: this.normalizeIncidentReportVersionStatus(row.status),
      filingRequired: this.normalizeBoolean((row as any).filingRequired),
      filingType: this.normalizeOptionalString((row as any).filingType),
      filingAuthority: this.normalizeOptionalString((row as any).filingAuthority),
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

  private normalizeCaseFilingStatus(
    value: unknown,
  ): ComplianceCaseFilingStatus | null {
    const normalized = String(value || '').trim().toUpperCase();
    if (
      normalized === ComplianceCaseFilingStatus.REQUIRED ||
      normalized === ComplianceCaseFilingStatus.SUBMITTED ||
      normalized === ComplianceCaseFilingStatus.ACKNOWLEDGED ||
      normalized === ComplianceCaseFilingStatus.RETURNED ||
      normalized === ComplianceCaseFilingStatus.CLOSED
    ) {
      return normalized as ComplianceCaseFilingStatus;
    }
    return null;
  }

  private getCurrentFiling(
    filings:
      | Array<
          ComplianceIncidentExternalFiling & {
            events?: ComplianceIncidentExternalFilingEvent[];
          }
        >
      | undefined,
  ) {
    const canonicalFilings = this.getCanonicalExternalFilings(filings);
    if (canonicalFilings.length === 0) return null;
    return canonicalFilings[0] || null;
  }

  private getCanonicalExternalFilings(
    filings:
      | Array<
          ComplianceIncidentExternalFiling & {
            events?: ComplianceIncidentExternalFilingEvent[];
          }
        >
      | undefined,
  ) {
    if (!Array.isArray(filings) || filings.length === 0) return [];
    return filings.filter((filing) => this.isCanonicalExternalFiling(filing));
  }

  private parseFilingMetadata(
    filing:
      | (ComplianceIncidentExternalFiling & {
          events?: ComplianceIncidentExternalFilingEvent[];
        })
      | null
      | undefined,
  ): Record<string, unknown> {
    if (!filing) return {};
    const metadata = this.parseJson(filing.metadata);
    if (metadata && typeof metadata === 'object' && !Array.isArray(metadata)) {
      return metadata as Record<string, unknown>;
    }
    return {};
  }

  private isCompatibilityOnlyExternalFiling(
    filing:
      | (ComplianceIncidentExternalFiling & {
          events?: ComplianceIncidentExternalFilingEvent[];
        })
      | null
      | undefined,
  ) {
    const metadata = this.parseFilingMetadata(filing);
    return this.normalizeBoolean(metadata.compatibilityOnly) === true;
  }

  private isCanonicalExternalFiling(
    filing:
      | (ComplianceIncidentExternalFiling & {
          events?: ComplianceIncidentExternalFilingEvent[];
        })
      | null
      | undefined,
  ) {
    return Boolean(filing) && !this.isCompatibilityOnlyExternalFiling(filing);
  }

  private mapExternalFilingEvent(row: ComplianceIncidentExternalFilingEvent) {
    return {
      ...row,
      statusFrom: this.normalizeOptionalString(row.statusFrom),
      statusTo: this.normalizeOptionalString(row.statusTo),
      externalRefNo: this.normalizeOptionalString(row.externalRefNo),
      feedback: this.normalizeOptionalString(row.feedback),
    };
  }

  private mapExternalFiling(
    row: ComplianceIncidentExternalFiling & {
      events?: ComplianceIncidentExternalFilingEvent[];
    },
  ) {
    return {
      ...row,
      status:
        this.normalizeCaseFilingStatus(row.status) ||
        this.normalizeOptionalString(row.status),
      metadata: this.parseJson(row.metadata),
      events: (row.events || []).map((event) => this.mapExternalFilingEvent(event)),
    };
  }

  private getAvailableFilingActions(row: {
    status?: string | null;
    filings?: Array<
      ComplianceIncidentExternalFiling & {
        events?: ComplianceIncidentExternalFilingEvent[];
      }
    >;
  }): string[] {
    const currentFiling = this.getCurrentFiling((row as any).filings);
    if (!currentFiling) return [];
    const status = this.normalizeCaseFilingStatus(currentFiling.status);
    if (status === ComplianceCaseFilingStatus.REQUIRED) {
      return [ComplianceIncidentExternalFilingAction.SUBMIT];
    }
    if (status === ComplianceCaseFilingStatus.RETURNED) {
      return [ComplianceIncidentExternalFilingAction.SUBMIT];
    }
    if (status === ComplianceCaseFilingStatus.SUBMITTED) {
      return [
        ComplianceIncidentExternalFilingAction.ACKNOWLEDGE,
        ComplianceIncidentExternalFilingAction.RETURN,
      ];
    }
    if (status === ComplianceCaseFilingStatus.ACKNOWLEDGED) {
      return [ComplianceIncidentExternalFilingAction.CLOSE];
    }
    return [];
  }

  private isFinalDispositionCode(value: unknown) {
    const normalized = normalizeCaseDispositionCode(value);
    return (
      normalized === CASE_DISPOSITION_CODES.CLEAR ||
      normalized === CASE_DISPOSITION_CODES.FALSE_POSITIVE ||
      normalized === CASE_DISPOSITION_CODES.RISK_CONFIRMED
    );
  }

  private validateWorkflowAndDispositionPair(input: {
    workflowDecision?: unknown;
    finalDispositionCode?: unknown;
    filingRequired?: unknown;
  }) {
    const workflowDecision = this.normalizeWorkflowProposal(input.workflowDecision);
    const finalDispositionCode = normalizeCaseDispositionCode(
      input.finalDispositionCode,
    );
    const filingRequired = this.normalizeBoolean(input.filingRequired) === true;

    if (!finalDispositionCode) {
      throw new ConflictException('Case requires a valid final disposition.');
    }

    if (!workflowDecision) {
      if (filingRequired && finalDispositionCode !== CASE_DISPOSITION_CODES.RISK_CONFIRMED) {
        throw new ConflictException(
          'External filing can only be required when final disposition is RISK_CONFIRMED.',
        );
      }
      return finalDispositionCode;
    }

    if (workflowDecision === 'CLEAR') {
      if (
        !([
          CASE_DISPOSITION_CODES.CLEAR,
          CASE_DISPOSITION_CODES.FALSE_POSITIVE,
        ] as string[]).includes(finalDispositionCode)
      ) {
        throw new ConflictException(
          'Workflow proposal CLEAR requires final disposition CLEAR or FALSE_POSITIVE.',
        );
      }
    } else if (finalDispositionCode !== CASE_DISPOSITION_CODES.RISK_CONFIRMED) {
      throw new ConflictException(
        `Workflow proposal ${workflowDecision} requires final disposition RISK_CONFIRMED.`,
      );
    }

    if (filingRequired && finalDispositionCode !== CASE_DISPOSITION_CODES.RISK_CONFIRMED) {
      throw new ConflictException(
        'External filing can only be required when final disposition is RISK_CONFIRMED.',
      );
    }

    return finalDispositionCode;
  }

  private normalizeWorkflowProposal(
    value: unknown,
  ): 'CLEAR' | 'REJECT' | 'REQUIRE_EDD' | null {
    const normalized = normalizeWorkflowDecision(value);
    if (
      normalized === 'CLEAR' ||
      normalized === 'REJECT' ||
      normalized === 'REQUIRE_EDD'
    ) {
      return normalized;
    }
    return null;
  }

  private deriveProposedFinalDisposition(input: {
    workflowDecision?: unknown;
    reportDispositionCode?: unknown;
  }): string | null {
    return normalizeCaseDispositionCode(input.reportDispositionCode);
  }

  private normalizeMlroReviewOutcome(value: unknown): string | null {
    const normalized = String(value || '').trim().toUpperCase();
    if (
      normalized === ComplianceIncidentMlroAction.RETURN_FOR_INVESTIGATION ||
      normalized === ComplianceIncidentMlroAction.APPROVE_FINAL_DISPOSITION
    ) {
      return normalized;
    }
    return null;
  }

  private isMlroActor(actor?: ComplianceIncidentActorContext | null) {
    const actorRole = String(actor?.actorRole || '').trim().toUpperCase();
    const roleCodes = Array.isArray(actor?.roleCodes)
      ? actor!.roleCodes!.map((item) => String(item || '').trim().toUpperCase())
      : [];
    return (
      actorRole === 'MLRO' ||
      actorRole === 'SUPER_ADMIN' ||
      roleCodes.includes('MLRO') ||
      roleCodes.includes('SUPER_ADMIN')
    );
  }

  private getAvailableWorkItemActions(
    row: {
      id: string;
      status?: string | null;
      caseType?: string | null;
    },
  ): string[] {
    const status = String(row.status || '').trim().toUpperCase();
    if (status === ComplianceIncidentStatus.OPEN) {
      return [CASE_ACTIONS.ASSIGN, CASE_ACTIONS.LINK_ALERT];
    }
    if (
      status === ComplianceIncidentStatus.ASSIGNED ||
      status === ComplianceIncidentStatus.INVESTIGATING
    ) {
      return [CASE_ACTIONS.REASSIGN, CASE_ACTIONS.LINK_ALERT];
    }
    return [];
  }

  private getAvailableInterimMeasures(
    row: {
      id: string;
      status?: string | null;
      caseType?: string | null;
      customerId?: string | null;
      freezeStatus?: string | null;
      complianceHoldStatus?: string | null;
      complianceHoldCaseId?: string | null;
      restrictionStatus?: string | null;
      restrictionCaseId?: string | null;
    },
  ): string[] {
    const status = String(row.status || '').trim().toUpperCase();
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
    const actions: string[] = [];

    if (
      ![
        ComplianceIncidentStatus.OPEN,
        ComplianceIncidentStatus.ASSIGNED,
        ComplianceIncidentStatus.INVESTIGATING,
      ].includes(status as ComplianceIncidentStatus)
    ) {
      return actions;
    }

    if (customerId) {
      if (restrictionStatus === 'RESTRICTED') {
        if (restrictionCaseId === row.id) {
          actions.push(INTERIM_MEASURES.UNRESTRICT);
        }
      } else {
        actions.push(INTERIM_MEASURES.RESTRICT);
      }

      if (
        holdStatus === ComplianceCaseFreezeStatus.FROZEN &&
        holdCaseId === row.id
      ) {
        actions.push(INTERIM_MEASURES.UNFREEZE);
      } else if (holdStatus !== ComplianceCaseFreezeStatus.FROZEN) {
        actions.push(INTERIM_MEASURES.FREEZE);
      }
    }

    return actions;
  }

  private getAvailableWorkflowActions(row: {
    stage?: string | null;
    sourceType?: string | null;
    status?: string | null;
  }): string[] {
    const status = String(row.status || '').trim().toUpperCase();
    if (
      ![
        ComplianceIncidentStatus.OPEN,
        ComplianceIncidentStatus.ASSIGNED,
        ComplianceIncidentStatus.INVESTIGATING,
      ].includes(status as ComplianceIncidentStatus)
    ) {
      return [];
    }

    if (!isSupportedReviewSourceType(row.sourceType)) {
      return [];
    }

    const stage = normalizeComplianceReviewStage(row.stage);
    if (!stage) {
      return [];
    }

    return [...CASE_WORKFLOW_ACTIONS_BY_STAGE[stage]];
  }

  private isWorkflowBoundCase(row: {
    sourceType?: string | null;
    stage?: string | null;
  }) {
    return (
      isSupportedReviewSourceType(row.sourceType) &&
      !!normalizeComplianceReviewStage(row.stage)
    );
  }

  private getAvailableComplianceActions(
    row: {
      id: string;
      status?: string | null;
      customerId?: string | null;
      freezeStatus?: string | null;
      complianceHoldStatus?: string | null;
      complianceHoldCaseId?: string | null;
      restrictionStatus?: string | null;
      restrictionCaseId?: string | null;
      reportStatus?: string | null;
      sourceType?: string | null;
      stage?: string | null;
      reports?: ComplianceIncidentReport[] | null;
    },
  ): string[] {
    return [
      ...this.getAvailableInterimMeasures(row),
      ...this.getAvailableWorkflowActions(row),
    ];
  }

  private getAvailableMlroActions(
    row: {
      status?: string | null;
    },
    actor?: ComplianceIncidentActorContext | null,
  ): string[] {
    const status = String(row.status || '').trim().toUpperCase();
    const isMlro = this.isMlroActor(actor);
    if (
      status !== ComplianceIncidentStatus.PENDING_MLRO_REVIEW ||
      !isMlro
    ) {
      return [];
    }
    return [
      ComplianceIncidentMlroAction.APPROVE_FINAL_DISPOSITION,
      ComplianceIncidentMlroAction.RETURN_FOR_INVESTIGATION,
    ];
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
    const {
      incidentNo,
      ownerUserId,
      ownerUserNo,
      ...rest
    } = row as any;
    const metadata = this.parseJson(row.metadata);
    const normalizedMetadata =
      metadata && typeof metadata === 'object' && !Array.isArray(metadata)
        ? (metadata as Record<string, unknown>)
        : {};
    const structure = this.getCaseStructureSnapshot(row);
    const currentDisposition = this.getCurrentDispositionSnapshot(row);
    const finalDisposition = this.getFinalDispositionSnapshot(row, currentDisposition);
    const canonicalFilings = this.getCanonicalExternalFilings((row as any).filings);
    const currentFiling = this.getCurrentFiling(canonicalFilings);
    const mappedCurrentFiling = currentFiling
      ? this.mapExternalFiling(currentFiling)
      : null;
    return {
      ...rest,
      caseNo: incidentNo,
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
      filingStatus: mappedCurrentFiling?.status || 'NOT_REQUIRED',
      assigneeUserId: this.getIncidentAssigneeUserId({
        assigneeUserId: (row as any).assigneeUserId,
        ownerUserId,
      }),
      assigneeUserNo: this.getIncidentAssigneeUserNo({
        assigneeUserNo: (row as any).assigneeUserNo,
        ownerUserNo,
      }),
      proposedWorkflowDecision:
        normalizeWorkflowDecision((row as any).proposedWorkflowDecision) ||
        this.normalizeOptionalString((row as any).proposedWorkflowDecision),
      proposedWorkflowReason: this.normalizeOptionalString(
        (row as any).proposedWorkflowReason,
      ),
      proposedFinalDispositionCode:
        normalizeCaseDispositionCode((row as any).proposedFinalDispositionCode) ||
        this.normalizeOptionalString((row as any).proposedFinalDispositionCode),
      proposedFinalDispositionReason: this.normalizeOptionalString(
        (row as any).proposedFinalDispositionReason,
      ),
      proposedFilingRequired: this.normalizeBoolean(
        (row as any).proposedFilingRequired,
      ),
      proposedFilingType: this.normalizeOptionalString(
        (row as any).proposedFilingType,
      ),
      proposedFilingAuthority: this.normalizeOptionalString(
        (row as any).proposedFilingAuthority,
      ),
      submittedForMlroAt: (row as any).submittedForMlroAt || null,
      submittedForMlroById: this.normalizeOptionalString(
        (row as any).submittedForMlroById,
      ),
      submittedForMlroByNo: this.normalizeOptionalString(
        (row as any).submittedForMlroByNo,
      ),
      submittedForMlroByRole: this.normalizeOptionalString(
        (row as any).submittedForMlroByRole,
      ),
      mlroReviewOutcome: this.normalizeOptionalString((row as any).mlroReviewOutcome),
      mlroReviewNote: this.normalizeOptionalString((row as any).mlroReviewNote),
      mlroReviewedAt: (row as any).mlroReviewedAt || null,
      mlroReviewedById: this.normalizeOptionalString((row as any).mlroReviewedById),
      mlroReviewedByNo: this.normalizeOptionalString((row as any).mlroReviewedByNo),
      mlroReviewedByRole: this.normalizeOptionalString(
        (row as any).mlroReviewedByRole,
      ),
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
      currentFiling: mappedCurrentFiling,
      filingHistory: mappedCurrentFiling?.events || [],
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
      case ComplianceIncidentStatus.ASSIGNED:
      case ComplianceIncidentStatus.INVESTIGATING:
        if (
          ![
            ComplianceIncidentAction.ASSIGN,
            ComplianceIncidentAction.LINK_ALERT,
            ComplianceIncidentAction.FREEZE,
            ComplianceIncidentAction.UNFREEZE,
            ComplianceIncidentAction.RESTRICT,
            ComplianceIncidentAction.UNRESTRICT,
          ].includes(action)
        ) {
          throw new BadRequestException(
            `Action ${action} is not allowed from status ${currentStatus}`,
          );
        }
        return;
      case ComplianceIncidentStatus.PENDING_MLRO_REVIEW:
        throw new BadRequestException(
          `Action ${action} is not allowed from status ${currentStatus}`,
        );
      case ComplianceIncidentStatus.RESOLVED:
        throw new BadRequestException(
          `Action ${action} is not allowed from legacy status ${currentStatus}`,
        );
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
      case ComplianceIncidentAction.FREEZE:
        return {
          nextStatus: ComplianceIncidentStatus.INVESTIGATING,
          eventType: ComplianceIncidentEventType.FROZEN,
          auditAction: AuditActions.INCIDENT_FROZEN,
          requireReason: true,
          statusChanged:
            currentStatus !== ComplianceIncidentStatus.INVESTIGATING,
        };
      case ComplianceIncidentAction.UNFREEZE:
        return {
          nextStatus: ComplianceIncidentStatus.INVESTIGATING,
          eventType: ComplianceIncidentEventType.UNFROZEN,
          auditAction: AuditActions.INCIDENT_UNFROZEN,
          requireReason: true,
          statusChanged:
            currentStatus !== ComplianceIncidentStatus.INVESTIGATING,
        };
      case ComplianceIncidentAction.RESTRICT:
        return {
          nextStatus: ComplianceIncidentStatus.INVESTIGATING,
          eventType: ComplianceIncidentEventType.RESTRICTED,
          auditAction: AuditActions.INCIDENT_RESTRICTED,
          requireReason: true,
          statusChanged:
            currentStatus !== ComplianceIncidentStatus.INVESTIGATING,
        };
      case ComplianceIncidentAction.UNRESTRICT:
        return {
          nextStatus: ComplianceIncidentStatus.INVESTIGATING,
          eventType: ComplianceIncidentEventType.UNRESTRICTED,
          auditAction: AuditActions.INCIDENT_UNRESTRICTED,
          requireReason: true,
          statusChanged:
            currentStatus !== ComplianceIncidentStatus.INVESTIGATING,
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

    return incident;
  }

  private assertReportEditable(row: {
    id: string;
    status?: string | null;
    reportStatus?: string | null;
  }) {
    if (this.isReportLocked(row)) {
      throw new ConflictException(
        `Case report is locked for case ${row.id} after final reporting, close, or MLRO submission`,
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
      filingRequired: this.normalizeBoolean(dto.filingRequired),
      filingType: this.normalizeOptionalString(dto.filingType),
      filingAuthority: this.normalizeOptionalString(dto.filingAuthority),
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
        proposedFinalDispositionCode:
          normalizeCaseDispositionCode(report.finalDispositionCode) ||
          this.normalizeOptionalString(report.finalDispositionCode),
        proposedFinalDispositionReason: this.normalizeOptionalString(
          report.finalDispositionReason,
        ),
        proposedFilingRequired: this.normalizeBoolean((report as any).filingRequired),
        proposedFilingType: this.normalizeOptionalString((report as any).filingType),
        proposedFilingAuthority: this.normalizeOptionalString(
          (report as any).filingAuthority,
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
    const where: Prisma.ComplianceIncidentWhereInput = {};
    const andConditions: Prisma.ComplianceIncidentWhereInput[] = [];

    if (query.status) where.status = query.status;
    if (query.severity) where.severity = query.severity;
    if (query.customerNo) where.customerNo = query.customerNo;

    const assigneeUserId = this.normalizeOptionalString(query.assigneeUserId);
    if (assigneeUserId) {
      where.ownerUserId = assigneeUserId;
    }

    if (query.caseType) {
      where.caseType = query.caseType;
    }

    const caseNo = this.normalizeOptionalString(query.caseNo);
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
        include: {
          filings: {
            orderBy: [{ createdAt: 'desc' }],
            include: {
              events: {
                orderBy: { eventAt: 'desc' },
              },
            },
          },
        },
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

      const workflowContext = await this.getAuditWorkflowContext(tx, incident as any);
      await this.auditLogsService.recordByActor(
        {
          triggerType: AuditTriggerType.DATA_UPDATE,
          action: AuditActions.INCIDENT_REPORT_DRAFT_SAVED,
          module: AuditModules.COMPLIANCE_INCIDENTS,
          entityType: AuditEntityTypes.COMPLIANCE_INCIDENT,
          entityId: incident.id,
          entityNo: incident.incidentNo,
          traceId: workflowContext?.traceId || undefined,
          workflowType: workflowContext?.workflowType || undefined,
          workflowId: workflowContext?.workflowId || undefined,
          workflowNo: workflowContext?.workflowNo || undefined,
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
      const filingRequired = this.normalizeBoolean((currentReport as any).filingRequired);
      if (
        filingRequired === true &&
        finalizedDispositionCode !== CASE_DISPOSITION_CODES.RISK_CONFIRMED
      ) {
        throw new BadRequestException(
          'filingRequired is only valid when finalDispositionCode is RISK_CONFIRMED.',
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

      await tx.complianceIncident.update({
        where: { id: incident.id },
        data: {
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

      const workflowContext = await this.getAuditWorkflowContext(tx, incident as any);
      await this.auditLogsService.recordByActor(
        {
          triggerType: AuditTriggerType.DATA_UPDATE,
          action: AuditActions.INCIDENT_REPORT_FINALIZED,
          module: AuditModules.COMPLIANCE_INCIDENTS,
          entityType: AuditEntityTypes.COMPLIANCE_INCIDENT,
          entityId: incident.id,
          entityNo: incident.incidentNo,
          traceId: workflowContext?.traceId || undefined,
          workflowType: workflowContext?.workflowType || undefined,
          workflowId: workflowContext?.workflowId || undefined,
          workflowNo: workflowContext?.workflowNo || undefined,
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

  private async closeLinkedAlertsForCase(
    tx: Prisma.TransactionClient,
    incident: { id: string; incidentNo: string },
    actor: ComplianceIncidentActorContext,
    now: Date,
    reason?: string | null,
  ) {
    const linkedAlerts = await tx.complianceAlert.findMany({
      where: {
        incidentLinks: {
          some: { incidentId: incident.id },
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
            reason || `Closed with approved case ${incident.incidentNo}`,
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
          note: reason || `Closed with approved case ${incident.incidentNo}`,
          payload: JSON.stringify({
            action: 'CASE_CLOSE_SYNC',
            incidentId: incident.id,
            statusFrom: linkedAlert.status,
            statusTo: ComplianceAlertStatus.CLOSED,
          }),
          sourcePlatform: actor.sourcePlatform || 'ADMIN_API',
        },
      });
    }
  }

  private async appendFilingEvent(
    tx: Prisma.TransactionClient,
    input: {
      filingId: string;
      eventType: ComplianceIncidentEventType;
      eventAt: Date;
      actor: ComplianceIncidentActorContext;
      note?: string | null;
      statusFrom?: string | null;
      statusTo?: string | null;
      externalRefNo?: string | null;
      feedback?: string | null;
    },
  ) {
    await tx.complianceIncidentExternalFilingEvent.create({
      data: {
        filingId: input.filingId,
        eventType: input.eventType,
        eventAt: input.eventAt,
        actorType: input.actor.actorType,
        actorId: input.actor.actorId,
        actorNo: input.actor.actorNo || null,
        actorRole: input.actor.actorRole || null,
        note: this.normalizeOptionalString(input.note) || null,
        statusFrom: this.normalizeOptionalString(input.statusFrom) || null,
        statusTo: this.normalizeOptionalString(input.statusTo) || null,
        externalRefNo: this.normalizeOptionalString(input.externalRefNo) || null,
        feedback: this.normalizeOptionalString(input.feedback) || null,
        sourcePlatform: input.actor.sourcePlatform || 'ADMIN_API',
      },
    });
  }

  private async syncLegacyReportMirrorFromFiling(
    tx: Prisma.TransactionClient,
    incidentId: string,
    filing:
      | (ComplianceIncidentExternalFiling & {
          status: string;
        })
      | null,
    input?: {
      reportReason?: string | null;
      reportedAt?: Date | null;
    },
  ) {
    // Stage 5 cleanup keeps report* as compatibility-only mirrors.
    // Canonical filing status and actions must come from external filing rows only.
    const filingStatus = filing
      ? this.normalizeCaseFilingStatus(filing.status)
      : null;
    const isReported =
      filingStatus === ComplianceCaseFilingStatus.SUBMITTED ||
      filingStatus === ComplianceCaseFilingStatus.ACKNOWLEDGED ||
      filingStatus === ComplianceCaseFilingStatus.CLOSED;
    await tx.complianceIncident.update({
      where: { id: incidentId },
      data: {
        reportStatus: isReported
          ? ComplianceCaseReportStatus.REPORTED
          : ComplianceCaseReportStatus.NOT_REPORTED,
        reportRefNo: filing ? filing.filingNo : null,
        reportedAt: isReported ? input?.reportedAt || filing?.submittedAt || null : null,
        reportReason: this.normalizeOptionalString(input?.reportReason) || null,
        reportedByUserId: isReported ? filing?.submittedById || null : null,
        reportedByUserNo: isReported ? filing?.submittedByNo || null : null,
      },
    });
  }

  private async createRequiredExternalFiling(
    tx: Prisma.TransactionClient,
    incident: ComplianceIncident,
    actor: ComplianceIncidentActorContext,
    now: Date,
  ) {
    const filing = await tx.complianceIncidentExternalFiling.create({
      data: {
        incidentId: incident.id,
        filingNo:
          this.normalizeOptionalString((incident as any).reportRefNo) ||
          generateReferenceNo('FIL'),
        filingType:
          this.normalizeOptionalString((incident as any).proposedFilingType) || null,
        filingAuthority:
          this.normalizeOptionalString((incident as any).proposedFilingAuthority) || null,
        status: ComplianceCaseFilingStatus.REQUIRED,
        requiredAt: now,
        requiredById: actor.actorId,
        requiredByNo: actor.actorNo || null,
        requiredByRole: actor.actorRole || null,
        metadata: this.serializeJson({
          source: 'MLRO_APPROVAL',
          proposedFinalDispositionCode: (incident as any).proposedFinalDispositionCode,
        }),
      },
    });

    await this.appendFilingEvent(tx, {
      filingId: filing.id,
      eventType: ComplianceIncidentEventType.FILING_REQUIRED,
      eventAt: now,
      actor,
      note: 'External filing follow-up created after MLRO approval.',
      statusTo: ComplianceCaseFilingStatus.REQUIRED,
    });

    await this.syncLegacyReportMirrorFromFiling(tx, incident.id, filing, {
      reportReason:
        this.normalizeOptionalString(
          (incident as any).proposedFinalDispositionReason,
        ) || null,
    });

    return filing;
  }

  private async getCurrentFilingForWrite(
    tx: Prisma.TransactionClient,
    incidentId: string,
  ) {
    const filing = await tx.complianceIncidentExternalFiling.findUnique({
      where: { incidentId },
      include: {
        events: {
          orderBy: { eventAt: 'desc' },
        },
      },
    });
    if (!filing) {
      throw new NotFoundException(
        `External filing follow-up not found for case ${incidentId}`,
      );
    }
    return filing;
  }

  private async applyApprovedWorkflowTransition(
    tx: Prisma.TransactionClient,
    incident: ComplianceIncident,
    actor: ComplianceIncidentActorContext,
    now: Date,
  ) {
    const workflowDecision = this.normalizeWorkflowProposal(
      (incident as any).proposedWorkflowDecision,
    );
    if (!workflowDecision) {
      throw new ConflictException(
        `Case ${incident.id} is missing proposed workflow decision.`,
      );
    }

    const stage = normalizeComplianceReviewStage(incident.stage);
    if (!stage || !incident.customerId) {
      throw new ConflictException(
        `Case ${incident.id} is missing workflow-bound stage or customer binding.`,
      );
    }

    const primaryAlert = incident.primaryAlertId
      ? await tx.complianceAlert.findUnique({
          where: { id: incident.primaryAlertId },
        })
      : null;
    const workflow = getWorkflowFromSourceType(incident.sourceType);
    if (!workflow) {
      throw new ConflictException(
        `Case ${incident.id} is not bound to supported workflow source type.`,
      );
    }

    const linkedCaseIds = this.normalizeStringList(
      this.parseJson((incident as any).linkedCaseIds),
    );
    const decisionRecordIds = this.normalizeStringList(
      this.parseJson((incident as any).decisionRecordIds),
    );
    const transition = await this.workflowTransitionService.transition(tx, {
      workflow,
      stage,
      producerType: 'CASE',
      producerId: incident.id,
      customerId: incident.customerId,
      journeyId:
        workflow === ONBOARDING_WORKFLOW
          ? String(primaryAlert?.sourceId || '').split(':')[1] || undefined
          : undefined,
      sourceId:
        workflow === PERIODIC_REVIEW_WORKFLOW
          ? this.normalizeOptionalString(primaryAlert?.sourceId || incident.entityId) ||
            undefined
          : undefined,
      dispositionCode: this.deriveProposedFinalDisposition({
        workflowDecision,
      }) || workflowDecision,
      reason:
        this.normalizeOptionalString((incident as any).proposedWorkflowReason) ||
        this.normalizeOptionalString((incident as any).proposedFinalDispositionReason) ||
        null,
      actorId: actor.actorId,
      actorRole: actor.actorRole || 'ADMIN',
      latestDecisionRecordId: decisionRecordIds[0] || null,
      linkedCaseIds,
    });

    return transition;
  }

  private shouldCreateOnboardingFinalApprovalAfterCaseMlro(
    incident: {
      sourceType?: string | null;
      stage?: string | null;
      proposedWorkflowDecision?: string | null;
      proposedFinalDispositionCode?: string | null;
    },
  ) {
    if (getWorkflowFromSourceType(incident.sourceType) !== ONBOARDING_WORKFLOW) {
      return false;
    }

    if (normalizeComplianceReviewStage(incident.stage) !== 'REVIEW_EDD') {
      return false;
    }

    return (
      this.normalizeWorkflowProposal((incident as any).proposedWorkflowDecision) ===
        'CLEAR' &&
      normalizeCaseDispositionCode((incident as any).proposedFinalDispositionCode) ===
        CASE_DISPOSITION_CODES.CLEAR
    );
  }

  async submitToMlro(
    id: string,
    dto: SubmitCaseToMlroDto,
    actor: ComplianceIncidentActorContext,
  ) {
    await this.prisma.$transaction(async (tx) => {
      const incident = await this.getIncidentForReportWrite(tx, id);
      const status = String(incident.status || '').trim().toUpperCase();
      if (
        status !== ComplianceIncidentStatus.ASSIGNED &&
        status !== ComplianceIncidentStatus.INVESTIGATING
      ) {
        throw new BadRequestException(
          `Case ${incident.id} can only be submitted to MLRO while ASSIGNED or INVESTIGATING, current=${incident.status}`,
        );
      }
      if (this.getIncidentAssigneeUserId(incident) !== actor.actorId) {
        throw new ForbiddenException(
          'Only current case assignee can submit case to MLRO.',
        );
      }

      const currentFinalizedReport = this.getCurrentFinalizedReport(incident.reports);
      if (!currentFinalizedReport) {
        throw new ConflictException(
          `Case ${incident.id} requires a finalized report before MLRO submission.`,
        );
      }

      const proposedWorkflowDecision = this.normalizeWorkflowProposal(
        (incident as any).proposedWorkflowDecision,
      );
      if (this.isWorkflowBoundCase(incident) && !proposedWorkflowDecision) {
        throw new ConflictException(
          `Workflow-bound case ${incident.id} requires a workflow proposal before MLRO submission.`,
        );
      }

      const proposedFinalDispositionCode = this.validateWorkflowAndDispositionPair({
        workflowDecision: proposedWorkflowDecision,
        finalDispositionCode: currentFinalizedReport.finalDispositionCode,
        filingRequired: (currentFinalizedReport as any).filingRequired,
      });
      const filingRequired =
        this.normalizeBoolean((currentFinalizedReport as any).filingRequired) === true;
      const filingType = this.normalizeOptionalString(
        (currentFinalizedReport as any).filingType,
      );
      const filingAuthority = this.normalizeOptionalString(
        (currentFinalizedReport as any).filingAuthority,
      );
      if (filingRequired && (!filingType || !filingAuthority)) {
        throw new ConflictException(
          `Case ${incident.id} requires filingType and filingAuthority before MLRO submission.`,
        );
      }

      const now = new Date();
      await tx.complianceIncident.update({
        where: { id: incident.id },
        data: {
          status: ComplianceIncidentStatus.PENDING_MLRO_REVIEW,
          proposedFinalDispositionCode,
          proposedFinalDispositionReason:
            this.normalizeOptionalString(currentFinalizedReport.finalDispositionReason) ||
            this.normalizeOptionalString((incident as any).proposedFinalDispositionReason) ||
            null,
          proposedFilingRequired: filingRequired,
          proposedFilingType: filingType,
          proposedFilingAuthority: filingAuthority,
          submittedForMlroAt: now,
          submittedForMlroById: actor.actorId,
          submittedForMlroByNo: actor.actorNo || null,
          submittedForMlroByRole: actor.actorRole || null,
          mlroReviewOutcome: null,
          mlroReviewNote: null,
          mlroReviewedAt: null,
          mlroReviewedById: null,
          mlroReviewedByNo: null,
          mlroReviewedByRole: null,
          lastActionById: actor.actorId,
          lastActionByNo: actor.actorNo || null,
          lastActionByRole: actor.actorRole || null,
          lastActionAt: now,
        },
      });

      await this.appendEvent(tx, {
        incidentId: incident.id,
        eventType: ComplianceIncidentEventType.MLRO_SUBMITTED,
        eventAt: now,
        actorType: actor.actorType,
        actorId: actor.actorId,
        actorNo: actor.actorNo || null,
        actorRole: actor.actorRole || null,
        note:
          this.normalizeOptionalString(dto.note) ||
          `Submitted case ${incident.incidentNo} to MLRO review.`,
          payload: {
            statusFrom: incident.status,
            statusTo: ComplianceIncidentStatus.PENDING_MLRO_REVIEW,
            proposedWorkflowDecision,
            proposedFinalDispositionCode,
            proposedFilingRequired: filingRequired,
            proposedFilingType: filingType,
            proposedFilingAuthority: filingAuthority,
            reportVersion: currentFinalizedReport.version,
          },
          sourcePlatform: actor.sourcePlatform || 'ADMIN_API',
      });

      const workflowContext = await this.getAuditWorkflowContext(tx, incident as any);
      await this.auditLogsService.recordByActor(
        {
          triggerType: AuditTriggerType.DATA_UPDATE,
          action: AuditActions.INCIDENT_SUBMITTED_TO_MLRO,
          module: AuditModules.COMPLIANCE_INCIDENTS,
          entityType: AuditEntityTypes.COMPLIANCE_INCIDENT,
          entityId: incident.id,
          entityNo: incident.incidentNo,
          traceId: workflowContext?.traceId || undefined,
          workflowType: workflowContext?.workflowType || undefined,
          workflowId: workflowContext?.workflowId || undefined,
          workflowNo: workflowContext?.workflowNo || undefined,
          statusFrom: incident.status,
          statusTo: ComplianceIncidentStatus.PENDING_MLRO_REVIEW,
          reason:
            this.normalizeOptionalString(dto.note) ||
            `Submitted case ${incident.incidentNo} to MLRO review.`,
          metadata: {
            proposedWorkflowDecision,
            proposedFinalDispositionCode,
            proposedFilingRequired: filingRequired,
            proposedFilingType: filingType,
            proposedFilingAuthority: filingAuthority,
            reportVersion: currentFinalizedReport.version,
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

    return this.findOne(id, actor);
  }

  async reviewByMlro(
    id: string,
    dto: ReviewCaseByMlroDto,
    actor: ComplianceIncidentActorContext,
  ) {
    if (!this.isMlroActor(actor)) {
      throw new ForbiddenException('MLRO role is required for case review.');
    }

    const postCommit: { approvalIdToEmit: string | null } =
      await this.prisma.$transaction(async (tx) => {
        let approvalIdToEmit: string | null = null;
        const incident = await tx.complianceIncident.findUnique({
          where: { id },
          include: {
            reports: {
              orderBy: [{ version: 'desc' }],
          },
        },
      });
      if (!incident) {
        throw new NotFoundException(`Compliance case not found: ${id}`);
      }
      if (
        String(incident.status || '').trim().toUpperCase() !==
        ComplianceIncidentStatus.PENDING_MLRO_REVIEW
      ) {
        throw new BadRequestException(
          `Case ${incident.id} is not pending MLRO review, current=${incident.status}`,
        );
      }

      const currentFinalizedReport = this.getCurrentFinalizedReport(incident.reports);
      if (!currentFinalizedReport) {
        throw new ConflictException(
          `Case ${incident.id} requires a finalized report for MLRO review.`,
        );
      }

      const now = new Date();
      if (
        dto.decision === ComplianceIncidentMlroAction.RETURN_FOR_INVESTIGATION
      ) {
        await tx.complianceIncident.update({
          where: { id: incident.id },
          data: {
            status: ComplianceIncidentStatus.INVESTIGATING,
            submittedForMlroAt: null,
            submittedForMlroById: null,
            submittedForMlroByNo: null,
            submittedForMlroByRole: null,
            mlroReviewOutcome: null,
            mlroReviewNote: null,
            mlroReviewedAt: null,
            mlroReviewedById: null,
            mlroReviewedByNo: null,
            mlroReviewedByRole: null,
            lastActionById: actor.actorId,
            lastActionByNo: actor.actorNo || null,
            lastActionByRole: actor.actorRole || null,
            lastActionAt: now,
          },
        });

        await this.appendEvent(tx, {
          incidentId: incident.id,
          eventType: ComplianceIncidentEventType.MLRO_RETURNED,
          eventAt: now,
          actorType: actor.actorType,
          actorId: actor.actorId,
          actorNo: actor.actorNo || null,
          actorRole: actor.actorRole || null,
          note:
            this.normalizeOptionalString(dto.note) ||
            `MLRO returned case ${incident.incidentNo} for investigation.`,
          payload: {
            statusFrom: incident.status,
            statusTo: ComplianceIncidentStatus.INVESTIGATING,
          },
          sourcePlatform: actor.sourcePlatform || 'ADMIN_API',
        });

        const workflowContext = await this.getAuditWorkflowContext(tx, incident as any);
        await this.auditLogsService.recordByActor(
          {
            triggerType: AuditTriggerType.DATA_UPDATE,
            action: AuditActions.INCIDENT_RETURNED_FOR_INVESTIGATION,
            module: AuditModules.COMPLIANCE_INCIDENTS,
            entityType: AuditEntityTypes.COMPLIANCE_INCIDENT,
            entityId: incident.id,
            entityNo: incident.incidentNo,
            traceId: workflowContext?.traceId || undefined,
            workflowType: workflowContext?.workflowType || undefined,
            workflowId: workflowContext?.workflowId || undefined,
            workflowNo: workflowContext?.workflowNo || undefined,
            statusFrom: incident.status,
            statusTo: ComplianceIncidentStatus.INVESTIGATING,
            reason:
              this.normalizeOptionalString(dto.note) ||
              `MLRO returned case ${incident.incidentNo} for investigation.`,
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
        return { approvalIdToEmit };
      }

      const proposedFinalDispositionCode = normalizeCaseDispositionCode(
        (incident as any).proposedFinalDispositionCode,
      );
      if (!proposedFinalDispositionCode) {
        throw new ConflictException(
          `Case ${incident.id} is missing proposed final disposition.`,
        );
      }

      let transition: Awaited<
        ReturnType<ComplianceIncidentsService['applyApprovedWorkflowTransition']>
      > | null = null;
      if (this.isWorkflowBoundCase(incident)) {
        transition = await this.applyApprovedWorkflowTransition(tx, incident, actor, now);
      }

      if (this.shouldCreateOnboardingFinalApprovalAfterCaseMlro(incident)) {
        if (!incident.customerId) {
          throw new ConflictException(
            `Onboarding final approval requires customerId for case ${incident.id}.`,
          );
        }

        const customer = await tx.customerMain.findUnique({
          where: { id: incident.customerId },
          select: {
            id: true,
            customerNo: true,
            onboardingStatus: true,
            operatingStatus: true,
            restrictionStatus: true,
            eddRequired: true,
            activeJourneyId: true,
            latestFinalApprovalId: true,
            latestFinalApprovalStatus: true,
          },
        });

        if (!customer) {
          throw new NotFoundException(
            `Customer not found for onboarding final approval: ${incident.customerId}`,
          );
        }

        const finalApproval =
          await this.onboardingFinalApprovalService.ensurePendingApprovalInTransaction(tx, {
            customer,
            actorId: actor.actorId,
            actorRole: actor.actorRole || 'ADMIN',
            reason:
              this.normalizeOptionalString(
                (incident as any).proposedFinalDispositionReason,
              ) || this.normalizeOptionalString(dto.note),
          });
        approvalIdToEmit = finalApproval.approval.id;
      }

      const dispositionRecord = await this.createDispositionRecord(tx, incident, {
        dispositionCode: proposedFinalDispositionCode,
        reason:
          this.normalizeOptionalString(
            (incident as any).proposedFinalDispositionReason,
          ) || this.normalizeOptionalString(dto.note),
        isFinal: true,
        decisionRecordId:
          this.normalizeStringList(
            this.parseJson((incident as any).decisionRecordIds),
          )[0] || null,
        source: 'MLRO_APPROVAL',
        sourceRefId: incident.id,
        actorType: actor.actorType,
        actorId: actor.actorId,
        actorNo: actor.actorNo || null,
        actorRole: actor.actorRole || null,
        createdAt: now,
      });

      const updateData: Prisma.ComplianceIncidentUpdateInput = {
        status: ComplianceIncidentStatus.CLOSED,
        decision:
          mirrorLegacyDecisionFromDisposition(proposedFinalDispositionCode) ||
          proposedFinalDispositionCode,
        currentDispositionCode: proposedFinalDispositionCode,
        currentDispositionReason:
          this.normalizeOptionalString(
            (incident as any).proposedFinalDispositionReason,
          ) || null,
        currentDispositionAt: now,
        currentDispositionById: actor.actorId,
        currentDispositionByNo: actor.actorNo || null,
        currentDispositionByRole: actor.actorRole || null,
        currentDispositionRecordId: dispositionRecord.id,
        finalDispositionCode: proposedFinalDispositionCode,
        finalDispositionReason:
          this.normalizeOptionalString(
            (incident as any).proposedFinalDispositionReason,
          ) || null,
        finalDispositionAt: now,
        finalDispositionRecordId: dispositionRecord.id,
        mlroReviewOutcome: ComplianceIncidentMlroAction.APPROVE_FINAL_DISPOSITION,
        mlroReviewNote: this.normalizeOptionalString(dto.note),
        mlroReviewedAt: now,
        mlroReviewedById: actor.actorId,
        mlroReviewedByNo: actor.actorNo || null,
        mlroReviewedByRole: actor.actorRole || null,
        closedAt: now,
        closeReason:
          this.normalizeOptionalString(dto.note) ||
          this.normalizeOptionalString((incident as any).proposedFinalDispositionReason) ||
          null,
        reportStatus: ComplianceCaseReportStatus.NOT_REPORTED,
        reportReason:
          this.normalizeOptionalString(
            (incident as any).proposedFinalDispositionReason,
          ) || null,
        reportedAt: null,
        reportedByUserId: null,
        reportedByUserNo: null,
        lastActionById: actor.actorId,
        lastActionByNo: actor.actorNo || null,
        lastActionByRole: actor.actorRole || null,
        lastActionAt: now,
      };

      await tx.complianceIncident.update({
        where: { id: incident.id },
        data: updateData,
      });

      const filingRequired = this.normalizeBoolean(
        (incident as any).proposedFilingRequired,
      ) === true;
      if (filingRequired) {
        await this.createRequiredExternalFiling(tx, incident, actor, now);
      } else {
        await this.syncLegacyReportMirrorFromFiling(tx, incident.id, null, {
          reportReason:
            this.normalizeOptionalString(
              (incident as any).proposedFinalDispositionReason,
            ) || null,
        });
      }

      await this.closeLinkedAlertsForCase(
        tx,
        { id: incident.id, incidentNo: incident.incidentNo },
        actor,
        now,
        this.normalizeOptionalString(dto.note) ||
          `Closed with MLRO-approved disposition ${proposedFinalDispositionCode}`,
      );

      await this.appendEvent(tx, {
        incidentId: incident.id,
        eventType: ComplianceIncidentEventType.FINAL_DISPOSITION_APPROVED,
        eventAt: now,
        actorType: actor.actorType,
        actorId: actor.actorId,
        actorNo: actor.actorNo || null,
        actorRole: actor.actorRole || null,
        note:
          this.normalizeOptionalString(dto.note) ||
          `MLRO approved final disposition ${proposedFinalDispositionCode}.`,
        payload: {
          statusFrom: incident.status,
          statusTo: ComplianceIncidentStatus.CLOSED,
          proposedWorkflowDecision: this.normalizeWorkflowProposal(
            (incident as any).proposedWorkflowDecision,
          ),
          proposedFinalDispositionCode,
          proposedFilingRequired: filingRequired,
          transitionCode: transition?.transitionCode || null,
          reportVersion: currentFinalizedReport.version,
        },
        sourcePlatform: actor.sourcePlatform || 'ADMIN_API',
      });

      const workflowContext = await this.getAuditWorkflowContext(tx, incident as any);
      await this.auditLogsService.recordByActor(
        {
          triggerType: AuditTriggerType.DATA_UPDATE,
          action: AuditActions.INCIDENT_FINAL_DISPOSITION_APPROVED,
          module: AuditModules.COMPLIANCE_INCIDENTS,
          entityType: AuditEntityTypes.COMPLIANCE_INCIDENT,
          entityId: incident.id,
          entityNo: incident.incidentNo,
          traceId: workflowContext?.traceId || undefined,
          workflowType: workflowContext?.workflowType || undefined,
          workflowId: workflowContext?.workflowId || undefined,
          workflowNo: workflowContext?.workflowNo || undefined,
          statusFrom: incident.status,
          statusTo: ComplianceIncidentStatus.CLOSED,
          reason:
            this.normalizeOptionalString(dto.note) ||
            `MLRO approved final disposition ${proposedFinalDispositionCode}.`,
          metadata: {
            proposedWorkflowDecision: this.normalizeWorkflowProposal(
              (incident as any).proposedWorkflowDecision,
            ),
            proposedFinalDispositionCode,
            transitionCode: transition?.transitionCode || null,
            reportVersion: currentFinalizedReport.version,
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

      return { approvalIdToEmit };
    });

    if (postCommit.approvalIdToEmit) {
      await this.onboardingFinalApprovalService.emitSubmittedSideEffects(
        postCommit.approvalIdToEmit,
        actor.actorId,
        actor.actorRole || 'ADMIN',
        this.normalizeOptionalString(dto.note) || null,
      );
    }

    return this.findOne(id, actor);
  }

  async submitExternalFiling(
    id: string,
    dto: SubmitCaseExternalFilingDto,
    actor: ComplianceIncidentActorContext,
  ) {
    await this.prisma.$transaction(async (tx) => {
      const incident = await tx.complianceIncident.findUnique({
        where: { id },
      });
      if (!incident) {
        throw new NotFoundException(`Compliance case not found: ${id}`);
      }
      const filing = await this.getCurrentFilingForWrite(tx, id);
      const currentStatus = this.normalizeCaseFilingStatus(filing.status);
      if (
        currentStatus !== ComplianceCaseFilingStatus.REQUIRED &&
        currentStatus !== ComplianceCaseFilingStatus.RETURNED
      ) {
        throw new BadRequestException(
          `External filing for case ${id} can only be submitted from REQUIRED or RETURNED.`,
        );
      }

      const now = this.normalizeDateInput(dto.submittedAt) || new Date();
      const nextExternalRefNo =
        this.normalizeOptionalString(dto.externalRefNo) ||
        this.normalizeOptionalString(filing.externalRefNo) ||
        null;
      await tx.complianceIncidentExternalFiling.update({
        where: { incidentId: id },
        data: {
          status: ComplianceCaseFilingStatus.SUBMITTED,
          submittedAt: now,
          submittedById: actor.actorId,
          submittedByNo: actor.actorNo || null,
          submittedByRole: actor.actorRole || null,
          externalRefNo: nextExternalRefNo,
          latestFeedback: null,
          latestFeedbackAt: null,
          latestFeedbackById: null,
          latestFeedbackByNo: null,
          latestFeedbackByRole: null,
        },
      });

      await this.appendFilingEvent(tx, {
        filingId: filing.id,
        eventType: ComplianceIncidentEventType.FILING_SUBMITTED,
        eventAt: now,
        actor,
        note: this.normalizeOptionalString(dto.note) || 'External filing submitted.',
        statusFrom: currentStatus,
        statusTo: ComplianceCaseFilingStatus.SUBMITTED,
        externalRefNo: nextExternalRefNo,
      });

      await this.syncLegacyReportMirrorFromFiling(
        tx,
        id,
        {
          ...filing,
          status: ComplianceCaseFilingStatus.SUBMITTED,
          submittedAt: now,
          submittedById: actor.actorId,
          submittedByNo: actor.actorNo || null,
          filingNo: filing.filingNo,
        } as any,
        {
          reportReason:
            this.normalizeOptionalString(dto.note) ||
            this.normalizeOptionalString((incident as any).finalDispositionReason) ||
            null,
          reportedAt: now,
        },
      );

      const workflowContext = await this.getAuditWorkflowContext(tx, incident as any);
      await this.auditLogsService.recordByActor(
        {
          triggerType: AuditTriggerType.DATA_UPDATE,
          action: AuditActions.INCIDENT_FILING_SUBMITTED,
          module: AuditModules.COMPLIANCE_INCIDENTS,
          entityType: AuditEntityTypes.COMPLIANCE_INCIDENT,
          entityId: incident.id,
          entityNo: incident.incidentNo,
          traceId: workflowContext?.traceId || undefined,
          workflowType: workflowContext?.workflowType || undefined,
          workflowId: workflowContext?.workflowId || undefined,
          workflowNo: workflowContext?.workflowNo || undefined,
          reason:
            this.normalizeOptionalString(dto.note) || 'External filing submitted.',
          metadata: {
            filingId: filing.id,
            filingNo: filing.filingNo,
            statusFrom: currentStatus,
            statusTo: ComplianceCaseFilingStatus.SUBMITTED,
            externalRefNo: nextExternalRefNo,
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

    return this.findOne(id, actor);
  }

  async recordExternalFilingFeedback(
    id: string,
    dto: RecordCaseExternalFilingFeedbackDto,
    actor: ComplianceIncidentActorContext,
  ) {
    await this.prisma.$transaction(async (tx) => {
      const incident = await tx.complianceIncident.findUnique({
        where: { id },
      });
      if (!incident) {
        throw new NotFoundException(`Compliance case not found: ${id}`);
      }
      const filing = await this.getCurrentFilingForWrite(tx, id);
      const currentStatus = this.normalizeCaseFilingStatus(filing.status);
      if (currentStatus !== ComplianceCaseFilingStatus.SUBMITTED) {
        throw new BadRequestException(
          `External filing feedback for case ${id} can only be recorded while SUBMITTED.`,
        );
      }

      const nextStatus =
        dto.status === 'ACKNOWLEDGED'
          ? ComplianceCaseFilingStatus.ACKNOWLEDGED
          : ComplianceCaseFilingStatus.RETURNED;
      const feedbackAt = this.normalizeDateInput(dto.feedbackAt) || new Date();
      const nextExternalRefNo =
        this.normalizeOptionalString(dto.externalRefNo) ||
        this.normalizeOptionalString(filing.externalRefNo) ||
        null;

      await tx.complianceIncidentExternalFiling.update({
        where: { incidentId: id },
        data: {
          status: nextStatus,
          externalRefNo: nextExternalRefNo,
          latestFeedback: dto.feedback,
          latestFeedbackAt: feedbackAt,
          latestFeedbackById: actor.actorId,
          latestFeedbackByNo: actor.actorNo || null,
          latestFeedbackByRole: actor.actorRole || null,
        },
      });

      await this.appendFilingEvent(tx, {
        filingId: filing.id,
        eventType:
          nextStatus === ComplianceCaseFilingStatus.ACKNOWLEDGED
            ? ComplianceIncidentEventType.FILING_ACKNOWLEDGED
            : ComplianceIncidentEventType.FILING_RETURNED,
        eventAt: feedbackAt,
        actor,
        note: this.normalizeOptionalString(dto.note) || dto.feedback,
        statusFrom: currentStatus,
        statusTo: nextStatus,
        externalRefNo: nextExternalRefNo,
        feedback: dto.feedback,
      });

      const workflowContext = await this.getAuditWorkflowContext(tx, incident as any);
      await this.auditLogsService.recordByActor(
        {
          triggerType: AuditTriggerType.DATA_UPDATE,
          action:
            nextStatus === ComplianceCaseFilingStatus.ACKNOWLEDGED
              ? AuditActions.INCIDENT_FILING_ACKNOWLEDGED
              : AuditActions.INCIDENT_FILING_RETURNED,
          module: AuditModules.COMPLIANCE_INCIDENTS,
          entityType: AuditEntityTypes.COMPLIANCE_INCIDENT,
          entityId: incident.id,
          entityNo: incident.incidentNo,
          traceId: workflowContext?.traceId || undefined,
          workflowType: workflowContext?.workflowType || undefined,
          workflowId: workflowContext?.workflowId || undefined,
          workflowNo: workflowContext?.workflowNo || undefined,
          reason: dto.feedback,
          metadata: {
            filingId: filing.id,
            filingNo: filing.filingNo,
            statusFrom: currentStatus,
            statusTo: nextStatus,
            externalRefNo: nextExternalRefNo,
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

    return this.findOne(id, actor);
  }

  async closeExternalFiling(
    id: string,
    dto: CloseCaseExternalFilingDto,
    actor: ComplianceIncidentActorContext,
  ) {
    await this.prisma.$transaction(async (tx) => {
      const incident = await tx.complianceIncident.findUnique({
        where: { id },
      });
      if (!incident) {
        throw new NotFoundException(`Compliance case not found: ${id}`);
      }
      const filing = await this.getCurrentFilingForWrite(tx, id);
      const currentStatus = this.normalizeCaseFilingStatus(filing.status);
      if (
        currentStatus !== ComplianceCaseFilingStatus.ACKNOWLEDGED &&
        currentStatus !== ComplianceCaseFilingStatus.SUBMITTED
      ) {
        throw new BadRequestException(
          `External filing for case ${id} can only be closed from ACKNOWLEDGED or SUBMITTED.`,
        );
      }

      const now = new Date();
      await tx.complianceIncidentExternalFiling.update({
        where: { incidentId: id },
        data: {
          status: ComplianceCaseFilingStatus.CLOSED,
          closedAt: now,
          closedById: actor.actorId,
          closedByNo: actor.actorNo || null,
          closedByRole: actor.actorRole || null,
        },
      });

      await this.appendFilingEvent(tx, {
        filingId: filing.id,
        eventType: ComplianceIncidentEventType.FILING_CLOSED,
        eventAt: now,
        actor,
        note: this.normalizeOptionalString(dto.note) || 'External filing follow-up closed.',
        statusFrom: currentStatus,
        statusTo: ComplianceCaseFilingStatus.CLOSED,
        externalRefNo: this.normalizeOptionalString(filing.externalRefNo),
      });

      await this.syncLegacyReportMirrorFromFiling(
        tx,
        id,
        {
          ...filing,
          status: ComplianceCaseFilingStatus.CLOSED,
        } as any,
        {
          reportReason:
            this.normalizeOptionalString(dto.note) ||
            this.normalizeOptionalString((incident as any).finalDispositionReason) ||
            null,
          reportedAt: filing.submittedAt || null,
        },
      );

      const workflowContext = await this.getAuditWorkflowContext(tx, incident as any);
      await this.auditLogsService.recordByActor(
        {
          triggerType: AuditTriggerType.DATA_UPDATE,
          action: AuditActions.INCIDENT_FILING_CLOSED,
          module: AuditModules.COMPLIANCE_INCIDENTS,
          entityType: AuditEntityTypes.COMPLIANCE_INCIDENT,
          entityId: incident.id,
          entityNo: incident.incidentNo,
          traceId: workflowContext?.traceId || undefined,
          workflowType: workflowContext?.workflowType || undefined,
          workflowId: workflowContext?.workflowId || undefined,
          workflowNo: workflowContext?.workflowNo || undefined,
          reason:
            this.normalizeOptionalString(dto.note) ||
            'External filing follow-up closed.',
          metadata: {
            filingId: filing.id,
            filingNo: filing.filingNo,
            statusFrom: currentStatus,
            statusTo: ComplianceCaseFilingStatus.CLOSED,
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

    return this.findOne(id, actor);
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
        filings: {
          orderBy: [{ createdAt: 'desc' }],
          include: {
            events: {
              orderBy: { eventAt: 'desc' },
            },
          },
        },
      },
    });

    if (!item) {
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
    const canonicalFilings = this.getCanonicalExternalFilings(row.filings || []);
    const currentFiling = this.getCurrentFiling(canonicalFilings);
    const mappedCurrentFiling = currentFiling
      ? this.mapExternalFiling(currentFiling)
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
      currentFiling: mappedCurrentFiling,
      filingHistory: mappedCurrentFiling?.events || [],
      reportLocked: this.isReportLocked(row),
      dispositionHistory: (row.dispositionRecords || []).map((record) =>
        this.mapDispositionRecord(record),
      ),
      alerts: mappedAlerts,
      events: row.events.map((event) => this.mapIncidentEvent(event)),
      availableCaseActions: this.getAvailableWorkItemActions(actionContext),
      availableInterimMeasures: this.getAvailableInterimMeasures(actionContext),
      availableWorkflowActions: this.getAvailableWorkflowActions(actionContext),
      availableMlroActions: this.getAvailableMlroActions(actionContext, actor),
      availableFilingActions: this.getAvailableFilingActions(row),
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
        metadata: true,
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
            metadata: true,
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

        const workflowContext = await this.getAuditWorkflowContext(tx, current as any);
        await this.auditLogsService.recordSystem(
          {
            triggerType: AuditTriggerType.SYSTEM_EVENT,
            action: AuditActions.INCIDENT_OVERDUE_MARKED,
            module: AuditModules.COMPLIANCE_INCIDENTS,
            entityType: AuditEntityTypes.COMPLIANCE_INCIDENT,
            entityId: current.id,
            entityNo: current.incidentNo,
            traceId: workflowContext?.traceId || undefined,
            workflowType: workflowContext?.workflowType || undefined,
            workflowId: workflowContext?.workflowId || undefined,
            workflowNo: workflowContext?.workflowNo || undefined,
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

  async createFromAlertInTransaction(
    tx: IncidentWriteClient,
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
      tx as Prisma.TransactionClient,
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

    await this.appendEvent(tx as Prisma.TransactionClient, {
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

    const workflowContext = await this.getAuditWorkflowContext(tx as Prisma.TransactionClient, {
      sourceType: updatedAlert.sourceType,
      metadata: JSON.stringify({
        sourceId: updatedAlert.sourceId,
        sourceNo: updatedAlert.sourceNo,
        journeyId: updatedAlert.journeyId,
      }),
    });
    await this.auditLogsService.recordByActor(
      {
        triggerType: AuditTriggerType.DATA_CREATE,
        action: AuditActions.INCIDENT_CREATED,
        module: AuditModules.COMPLIANCE_INCIDENTS,
        entityType: AuditEntityTypes.COMPLIANCE_INCIDENT,
        entityId: incident.id,
        entityNo: incident.incidentNo,
        traceId: workflowContext?.traceId || undefined,
        workflowType: workflowContext?.workflowType || undefined,
        workflowId: workflowContext?.workflowId || undefined,
        workflowNo: workflowContext?.workflowNo || undefined,
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
      tx as Prisma.TransactionClient,
    );

    return incident.id;
  }

  async createFromAlert(
    alertId: string,
    dto: CreateIncidentFromAlertDto,
    actor: ComplianceIncidentActorContext,
  ) {
    const createdIncidentId = await this.prisma.$transaction(async (tx) => {
      return this.createFromAlertInTransaction(tx, alertId, dto, actor);
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

      const workflowContext = await this.getAuditWorkflowContext(tx, incident as any);
      await this.auditLogsService.recordByActor(
        {
          triggerType: AuditTriggerType.DATA_UPDATE,
          action: AuditActions.INCIDENT_ALERT_LINKED,
          module: AuditModules.COMPLIANCE_INCIDENTS,
          entityType: AuditEntityTypes.COMPLIANCE_INCIDENT,
          entityId: incidentId,
          entityNo: incident.incidentNo,
          traceId: workflowContext?.traceId || undefined,
          workflowType: workflowContext?.workflowType || undefined,
          workflowId: workflowContext?.workflowId || undefined,
          workflowNo: workflowContext?.workflowNo || undefined,
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

  async applyActionInTransaction(
    tx: IncidentWriteClient,
    id: string,
    dto: UpdateComplianceIncidentActionDto,
    actor: ComplianceIncidentActorContext,
  ) {
    if (String(dto.action || '').trim().toUpperCase() === 'FALSE_POSITIVE') {
      throw new BadRequestException(
        'FALSE_POSITIVE is no longer a direct case action. Propose FALSE_POSITIVE in the finalized report and submit to MLRO.',
      );
    }
    if (String(dto.action || '').trim().toUpperCase() === 'REPORT') {
      throw new BadRequestException(
        'REPORT is no longer a direct case action. Propose REPORT in the finalized report and submit to MLRO.',
      );
    }
    if (String(dto.action || '').trim().toUpperCase() === 'CLOSE') {
      throw new BadRequestException(
        'Generic CLOSE is no longer supported. Final case closure is gated by MLRO review.',
      );
    }

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

    const currentStatus = current.status as ComplianceIncidentStatus;
    this.assertActionAllowed(currentStatus, dto.action);
    const currentFinalizedReport = this.getCurrentFinalizedReport(current.reports || []);
    let customerControlSnapshot:
      | Awaited<ReturnType<ComplianceIncidentsService['findCustomerControlSnapshot']>>
      | null
      | undefined;
    const loadCustomerControlSnapshot = async (): Promise<
      NonNullable<
        Awaited<ReturnType<ComplianceIncidentsService['findCustomerControlSnapshot']>>
      >
    > => {
      if (!current.customerId) {
        throw new BadRequestException(`Only customer-bound cases support ${dto.action}`);
      }
      if (customerControlSnapshot === undefined) {
        customerControlSnapshot = await this.getCustomerControlSnapshot(
          current.customerId,
          tx as Prisma.TransactionClient,
        );
      }
      return customerControlSnapshot as NonNullable<
        Awaited<ReturnType<ComplianceIncidentsService['findCustomerControlSnapshot']>>
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
    const currentAssigneeUserId = this.getIncidentAssigneeUserId(current);

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
      assigneeUserId = this.normalizeOptionalString(dto.assigneeUserId) || actor.actorId;

      if (
        currentStatus === ComplianceIncidentStatus.ASSIGNED ||
        currentStatus === ComplianceIncidentStatus.INVESTIGATING
      ) {
        if (!currentAssigneeUserId || currentAssigneeUserId !== actor.actorId) {
          throw new ForbiddenException(
            `Only assignee ${currentAssigneeUserId} can reassign this case`,
          );
        }
      }

      const assignee = await this.resolveIncidentAssignee(assigneeUserId, tx as Prisma.TransactionClient);
      assigneeUserNo = assignee.userNo;
      updateData.ownerUserId = assigneeUserId;
      updateData.ownerUserNo = assigneeUserNo;
      updateData.assignedAt = now;
    }

    if (
      [
        ComplianceIncidentAction.FREEZE,
        ComplianceIncidentAction.UNFREEZE,
        ComplianceIncidentAction.RESTRICT,
        ComplianceIncidentAction.UNRESTRICT,
      ].includes(dto.action) &&
      [ComplianceIncidentStatus.ASSIGNED, ComplianceIncidentStatus.INVESTIGATING].includes(
        currentStatus,
      )
    ) {
      if (!currentAssigneeUserId || currentAssigneeUserId !== actor.actorId) {
        throw new ForbiddenException(
          `Only assignee ${currentAssigneeUserId} can execute action ${dto.action}`,
        );
      }
    }

    if (dto.action === ComplianceIncidentAction.FREEZE) {
      const customer = await loadCustomerControlSnapshot();
      const currentHoldStatus = this.normalizeFreezeStatus(customer.complianceHoldStatus);
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
      const currentHoldStatus = this.normalizeFreezeStatus(customer.complianceHoldStatus);
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
      const currentRestrictionStatus = this.normalizeRestrictionStatus(customer.restrictionStatus);
      if (currentRestrictionStatus === 'RESTRICTED') {
        if (customer.restrictionCaseId === current.id) {
          throw new ConflictException(`Customer ${customer.id} is already restricted by this case`);
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
      const currentRestrictionStatus = this.normalizeRestrictionStatus(customer.restrictionStatus);
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

    let resolvedDispositionCode = explicitDispositionCode;
    let finalizeDisposition = !!dto.finalizeDisposition;

    if (dto.action === ComplianceIncidentAction.FREEZE) {
      resolvedDispositionCode = CASE_DISPOSITION_CODES.RISK_CONFIRMED;
    }

    if (dto.action === ComplianceIncidentAction.RESTRICT) {
      resolvedDispositionCode = CASE_DISPOSITION_CODES.RISK_CONFIRMED;
    }

    if (resolvedDispositionCode) {
      const record = await this.createDispositionRecord(tx as Prisma.TransactionClient, current, {
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
        mirrorLegacyDecisionFromDisposition(resolvedDispositionCode) || resolvedDispositionCode;

      if (finalizeDisposition) {
        updateData.finalDispositionCode = resolvedDispositionCode;
        updateData.finalDispositionReason = dispositionReason || null;
        updateData.finalDispositionAt = now;
        updateData.finalDispositionRecordId = record.id;
      }
    }

    const updated = await tx.complianceIncident.update({
      where: { id },
      data: updateData,
    });

    await this.appendEvent(tx as Prisma.TransactionClient, {
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
        decision: mirrorLegacyDecisionFromDisposition(resolvedDispositionCode) || decision,
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

    const workflowContext = await this.getAuditWorkflowContext(tx as Prisma.TransactionClient, updated as any);
    await this.auditLogsService.recordByActor(
      {
        triggerType: AuditTriggerType.DATA_UPDATE,
        action: resolution.auditAction,
        module: AuditModules.COMPLIANCE_INCIDENTS,
        entityType: AuditEntityTypes.COMPLIANCE_INCIDENT,
        entityId: updated.id,
        entityNo: updated.incidentNo,
        traceId: workflowContext?.traceId || undefined,
        workflowType: workflowContext?.workflowType || undefined,
        workflowId: workflowContext?.workflowId || undefined,
        workflowNo: workflowContext?.workflowNo || undefined,
        statusFrom: resolution.statusChanged ? currentStatus : undefined,
        statusTo: resolution.statusChanged ? updated.status : undefined,
        reason: reason || note || `${dto.action} executed`,
        metadata: {
          action: dto.action,
          assigneeUserId,
          assigneeUserNo,
          decision: mirrorLegacyDecisionFromDisposition(resolvedDispositionCode) || decision,
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
      tx as Prisma.TransactionClient,
    );

    return updated.id;
  }

  async applyAction(
    id: string,
    dto: UpdateComplianceIncidentActionDto,
    actor: ComplianceIncidentActorContext,
  ) {
    const updatedId = await this.prisma.$transaction(async (tx) => {
      return this.applyActionInTransaction(tx, id, dto, actor);
    });

    return this.findOne(updatedId, actor);
  }
}
