import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { generateReferenceNo } from '../../../common/utils/no-generator.util';
import { ApprovalsService } from '../../governance/approvals/approvals.service';
import {
  ApprovalActorContext,
  ApprovalDecisionEvent,
  ApprovalEvents,
  ApprovalActionTypes,
  ApprovalStatuses,
} from '../../governance/approvals/constants/approval.constants';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import {
  AuditActions,
  AuditEntityTypes,
  AuditModules,
} from '../audit-logs/constants/audit-actions.constant';
import {
  AuditActorContext,
  AuditEvidencePackageStatus,
  AuditResult,
  AuditTriggerType,
} from '../audit-logs/dto/audit-log.dto';
import { sha256Hex } from '../audit-logs/utils/audit-digest.util';
import { ComplianceIncidentsService } from './compliance-incidents.service';
import {
  ComplianceCaseEvidencePackageQueryDto,
  ExportComplianceCaseEvidencePackageDto,
} from './dto/compliance-case-evidence-package.dto';
import {
  ONBOARDING_SOURCE_TYPE,
  ONBOARDING_WORKFLOW,
} from '../constants/onboarding-compliance-workflow.constant';

interface ApprovalSummary {
  approvalId: string;
  approvalNo?: string | null;
  approvalStatus: string;
  approvedBy?: string | null;
  approvalDecidedAt?: string | null;
}

@Injectable()
export class ComplianceCaseEvidencePackagesService {
  private static readonly DEFAULT_TAKE = 20;
  private static readonly MAX_NO_RETRIES = 5;
  private static readonly MAX_EXPORT_CASES = 500;

  constructor(
    private readonly prisma: PrismaService,
    private readonly approvalsService: ApprovalsService,
    private readonly auditLogsService: AuditLogsService,
    private readonly complianceIncidentsService: ComplianceIncidentsService,
  ) {}

  private normalizeOptionalString(value: unknown): string | null {
    if (value === null || value === undefined) return null;
    const normalized = String(value).trim();
    return normalized.length ? normalized : null;
  }

  private serializeJson(value: unknown): string {
    return JSON.stringify(value ?? {});
  }

  private parseJson<T>(value?: string | null): T | null {
    if (!value) return null;
    try {
      return JSON.parse(value) as T;
    } catch {
      return null;
    }
  }

  private normalizeSkip(skip?: number): number {
    if (!skip || skip < 0) return 0;
    return skip;
  }

  private normalizeTake(take?: number): number {
    if (!take || take < 1) return ComplianceCaseEvidencePackagesService.DEFAULT_TAKE;
    return Math.min(take, 200);
  }

  private toAuditActor(actor: ApprovalActorContext): AuditActorContext {
    return {
      actorType: actor.actorType,
      actorId: actor.userId,
      actorNo: actor.userNo,
      actorRole: actor.role || actor.roleCodes[0] || 'UNKNOWN',
    };
  }

  private isUniqueConflict(error: unknown, field?: string): boolean {
    if (!error || typeof error !== 'object') return false;
    if ((error as any).code !== 'P2002') return false;
    if (!field) return true;
    const target = (error as any)?.meta?.target;
    if (Array.isArray(target)) {
      return target.includes(field);
    }
    return String(target || '').includes(field);
  }

  private async createPackageRecord(data: any) {
    for (let i = 0; i < ComplianceCaseEvidencePackagesService.MAX_NO_RETRIES; i += 1) {
      try {
        const packageNo = generateReferenceNo('CEP');
        return await this.prisma.complianceCaseEvidencePackage.create({
          data: {
            ...data,
            packageNo,
            fileName: data.fileName || `${packageNo}.json`,
          },
        });
      } catch (error) {
        if (this.isUniqueConflict(error, 'packageNo')) {
          continue;
        }
        throw error;
      }
    }

    throw new InternalServerErrorException(
      `Failed to generate unique case evidence package number after ${ComplianceCaseEvidencePackagesService.MAX_NO_RETRIES} attempts`,
    );
  }

  private buildWhere(query: ExportComplianceCaseEvidencePackageDto) {
    if (query.caseType && String(query.caseType).toUpperCase() !== 'ONBOARDING') {
      throw new BadRequestException(
        'Only ONBOARDING cases are supported for case evidence export.',
      );
    }

    const where: any = {
      sourceType: ONBOARDING_SOURCE_TYPE,
      caseType: 'ONBOARDING',
    };
    const andConditions: any[] = [];

    if (query.status) where.status = query.status;
    if (query.assigneeUserId) where.ownerUserId = query.assigneeUserId;

    const selectedCaseIds = Array.from(
      new Set((query.selectedCaseIds || []).map((item) => String(item || '').trim()).filter(Boolean)),
    );
    if (selectedCaseIds.length > 0) {
      where.id = { in: selectedCaseIds };
    }

    if (query.periodFrom || query.periodTo) {
      andConditions.push({
        createdAt: {
          gte: query.periodFrom ? new Date(query.periodFrom) : undefined,
          lte: query.periodTo ? new Date(query.periodTo) : undefined,
        },
      });
    }

    if (andConditions.length > 0) {
      where.AND = andConditions;
    }

    return {
      where,
      selectedCaseIds,
    };
  }

  private async buildDecisionRecordSnapshots(ids: string[]) {
    if (!ids.length) return [];

    const rows = await this.prisma.workflowDecisionRecord.findMany({
      where: { id: { in: ids } },
      include: {
        customer: {
          select: {
            id: true,
            customerNo: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    return rows.map((row) => {
      const inputPayload = this.parseJson<Record<string, unknown>>(row.inputPayload) || {};
      return {
        id: row.id,
        contextType: row.contextType,
        subjectType: String(inputPayload.subjectType || 'UNKNOWN'),
        subjectId: row.subjectId,
        ownerType: 'CUSTOMER',
        ownerId: row.customerId,
        ownerNo: row.customer?.customerNo || null,
        policyVersion: row.policyVersion,
        status: row.status,
        inputHash: row.inputHash,
        outputDecision: row.outputDecision,
        recommendedActions: this.parseJson(row.recommendedActions) || [],
        reasonCodes: this.parseJson(row.reasonCodes) || [],
        inputPayload,
        outputs: this.parseJson(row.outputs),
        errorMessage: row.errorMessage,
        createdAt: row.createdAt,
        completedAt: row.completedAt,
        updatedAt: row.updatedAt,
      };
    });
  }

  private async buildProviderResponseArtifacts(cases: any[]) {
    const references: any[] = [];
    const snapshots: any[] = [];

    const cddIds = new Set<string>();
    const eddIds = new Set<string>();
    const kytIds = new Set<string>();
    const travelIds = new Set<string>();

    for (const item of cases) {
      const linkedCaseIds = Array.isArray(item.linkedCaseIds) ? item.linkedCaseIds : [];
      references.push({
        caseId: item.id,
        caseNo: item.caseNo || item.incidentNo,
        caseType: item.caseType,
        sourceType: item.sourceType || null,
        sourceId: item.entityId || item.sourceId || null,
        sourceNo: item.entityNo || item.primaryAlertNo || null,
        entityType: item.entityType || null,
        entityId: item.entityId || null,
        entityNo: item.entityNo || null,
        linkedCaseIds,
      });

      for (const linkedId of linkedCaseIds) {
        if (String(item.caseType || '').toUpperCase() === 'ONBOARDING') {
          cddIds.add(linkedId);
          eddIds.add(linkedId);
        }
      }

      if (item.entityType === 'KYT_CASE' && item.entityId) {
        kytIds.add(item.entityId);
      }
      if (item.entityType === 'TRAVEL_RULE_CASE' && item.entityId) {
        travelIds.add(item.entityId);
      }
    }

    if (cddIds.size > 0) {
      const rows = await this.prisma.cddResponse.findMany({
        where: { id: { in: Array.from(cddIds) } },
        include: {
          reports: {
            orderBy: { receivedAt: 'desc' },
          },
        },
      });
      snapshots.push(
        ...rows.map((row) => ({
          providerObjectType: 'CDD',
          id: row.id,
          caseNo: row.caseNo,
          customerId: row.customerId,
          status: row.status,
          subjectKind: row.subjectKind,
          subjectRefId: row.subjectRefId,
          journeyId: row.journeyId,
          reports: row.reports.map((report) => ({
            ...report,
            rawPayload: this.parseJson(report.rawPayload),
            normalizedPayload: this.parseJson(report.normalizedPayload),
          })),
        })),
      );
    }

    if (eddIds.size > 0) {
      const rows = await this.prisma.eddResponse.findMany({
        where: { id: { in: Array.from(eddIds) } },
        include: {
          reports: {
            orderBy: { receivedAt: 'desc' },
          },
        },
      });
      snapshots.push(
        ...rows.map((row) => ({
          providerObjectType: 'EDD',
          id: row.id,
          caseNo: row.caseNo,
          customerId: row.customerId,
          status: row.status,
          subjectKind: row.subjectKind,
          subjectRefId: row.subjectRefId,
          journeyId: row.journeyId,
          reports: row.reports.map((report) => ({
            ...report,
            rawPayload: this.parseJson(report.rawPayload),
            normalizedPayload: this.parseJson(report.normalizedPayload),
          })),
        })),
      );
    }

    if (kytIds.size > 0) {
      const rows = await this.prisma.kytCase.findMany({
        where: { id: { in: Array.from(kytIds) } },
        include: {
          reports: {
            orderBy: { receivedAt: 'desc' },
          },
        },
      });
      snapshots.push(
        ...rows.map((row) => ({
          providerObjectType: 'KYT',
          ...row,
          reports: row.reports.map((report) => ({
            ...report,
            rawPayload: this.parseJson(report.rawPayload),
            normalizedPayload: this.parseJson(report.normalizedPayload),
          })),
          latestRawPayload: this.parseJson(row.latestRawPayload),
          latestNormalizedPayload: this.parseJson(row.latestNormalizedPayload),
        })),
      );
    }

    if (travelIds.size > 0) {
      const rows = await this.prisma.travelRuleCase.findMany({
        where: { id: { in: Array.from(travelIds) } },
        include: {
          reports: {
            orderBy: { receivedAt: 'desc' },
          },
        },
      });
      snapshots.push(
        ...rows.map((row) => ({
          providerObjectType: 'TRAVEL_RULE',
          ...row,
          reports: row.reports.map((report) => ({
            ...report,
            rawPayload: this.parseJson(report.rawPayload),
            normalizedPayload: this.parseJson(report.normalizedPayload),
          })),
          latestRawPayload: this.parseJson(row.latestRawPayload),
          latestNormalizedPayload: this.parseJson(row.latestNormalizedPayload),
        })),
      );
    }

    return { references, snapshots };
  }

  private async prepareSelection(query: ExportComplianceCaseEvidencePackageDto) {
    const { where, selectedCaseIds } = this.buildWhere(query);
    const hasFilters =
      !!query.caseType ||
      !!query.status ||
      !!query.assigneeUserId ||
      !!query.periodFrom ||
      !!query.periodTo ||
      selectedCaseIds.length > 0;

    if (!hasFilters) {
      throw new BadRequestException(
        'selectedCaseIds or at least one export filter is required',
      );
    }

    const rows = await this.prisma.complianceIncident.findMany({
      where,
      select: { id: true },
      orderBy: { createdAt: 'desc' },
      take: ComplianceCaseEvidencePackagesService.MAX_EXPORT_CASES,
    });
    if (!rows.length) {
      throw new BadRequestException('No compliance cases matched the export criteria');
    }

    const caseIds = rows.map((row) => row.id);
    const cases = await Promise.all(
      caseIds.map((id) => this.complianceIncidentsService.findOne(id)),
    );

    const decisionRecordIds = Array.from(
      new Set(
        cases.flatMap((item) =>
          Array.isArray(item.decisionRecordIds) ? item.decisionRecordIds : [],
        ),
      ),
    );
    const decisionRecords = await this.buildDecisionRecordSnapshots(decisionRecordIds);
    const providerArtifacts = await this.buildProviderResponseArtifacts(cases);

    return {
      normalizedCriteria: {
        workflow: ONBOARDING_WORKFLOW,
        caseType: 'ONBOARDING',
        status: query.status || null,
        assigneeUserId: query.assigneeUserId || null,
        periodFrom: query.periodFrom || null,
        periodTo: query.periodTo || null,
        selectedCaseIds,
        includeRecords: query.includeRecords !== false,
      },
      cases,
      caseIds,
      caseNos: cases.map((item) => item.caseNo || item.incidentNo).filter(Boolean),
      itemCount: cases.length,
      decisionRecords,
      providerArtifacts,
    };
  }

  private async buildEvidencePackageArtifacts(
    query: ExportComplianceCaseEvidencePackageDto,
    exporter: AuditActorContext,
    approvalSummary?: ApprovalSummary,
  ) {
    const selection = await this.prepareSelection(query);
    const generatedAt = new Date().toISOString();
    const manifest = {
      version: '1.0',
      generatedAt,
      exportedBy: exporter,
      exportMode: 'CASE_SELECTION',
      criteria: selection.normalizedCriteria,
      itemCount: selection.itemCount,
      caseNos: selection.caseNos,
      approval: approvalSummary
        ? {
            approvalId: approvalSummary.approvalId,
            approvalNo: approvalSummary.approvalNo || null,
            approvalStatus: approvalSummary.approvalStatus,
            approvedBy: approvalSummary.approvedBy || null,
            approvalDecidedAt: approvalSummary.approvalDecidedAt || null,
          }
        : undefined,
    };

    const cases =
      query.includeRecords === false
        ? []
        : selection.cases.map((item) => ({
            ...item,
            currentCaseReport: item.currentReport || null,
            caseReportHistorySummary: Array.isArray(item.reportHistory)
              ? item.reportHistory.map((report: any) => ({
                  id: report.id,
                  version: report.version,
                  status: report.status,
                  finalizedAt: report.finalizedAt || null,
                  finalizedByUserNo: report.finalizedByUserNo || null,
                  finalDispositionCode: report.finalDispositionCode || null,
                  updatedAt: report.updatedAt,
                }))
              : [],
          }));
    const packageBody = {
      manifest,
      cases,
      decisionRecords: selection.decisionRecords,
      providerResponseReferences: selection.providerArtifacts.references,
      providerResponseSnapshots: selection.providerArtifacts.snapshots,
    };
    const digest = sha256Hex(packageBody);

    return {
      manifest,
      packageBody: {
        ...packageBody,
        digest,
      },
      digest,
      itemCount: selection.itemCount,
      caseNos: selection.caseNos,
      caseIds: selection.caseIds,
    };
  }

  private mapEvidencePackage(row: any) {
    return {
      ...row,
      filterSnapshot: this.parseJson(row.filterSnapshot),
      selectedCaseIdsSnapshot: this.parseJson(row.selectedCaseIdsSnapshot) || [],
      manifest: this.parseJson(row.manifest),
      packageBody: this.parseJson(row.packageBody),
    };
  }

  async createExportRequest(
    query: ExportComplianceCaseEvidencePackageDto,
    actor: ApprovalActorContext,
  ) {
    const selection = await this.prepareSelection(query);
    const requestedAt = new Date().toISOString();
    const requestManifest = {
      version: '1.0',
      generatedAt: requestedAt,
      requestPhase: 'PENDING_APPROVAL',
      exportMode: 'CASE_SELECTION',
      criteria: selection.normalizedCriteria,
      itemCount: selection.itemCount,
      caseNos: selection.caseNos,
      approvalStatus: ApprovalStatuses.PENDING,
    };
    const requestDigest = sha256Hex(requestManifest);

    const evidencePackage = await this.createPackageRecord({
      exportedByType: actor.actorType,
      exportedById: actor.userId,
      exportedByRole: actor.role || actor.roleCodes[0] || null,
      status: AuditEvidencePackageStatus.PENDING_APPROVAL,
      exportMode: 'CASE_SELECTION',
      filterSnapshot: this.serializeJson(selection.normalizedCriteria),
      selectedCaseIdsSnapshot: this.serializeJson(selection.caseIds),
      itemCount: selection.itemCount,
      digest: requestDigest,
      manifest: this.serializeJson(requestManifest),
      packageBody: null,
    });

    const traceId = `CASE_EXPORT_${evidencePackage.packageNo}`;
    const approval = await this.approvalsService.create(
      {
        actionType: ApprovalActionTypes.CASE_EVIDENCE_EXPORT_APPROVAL,
        entityRef: evidencePackage.id,
        metadata: {
          packageId: evidencePackage.id,
          packageNo: evidencePackage.packageNo,
          itemCount: selection.itemCount,
          caseNos: selection.caseNos,
        },
        traceId,
      },
      actor,
    );

    const submitted =
      approval.status === ApprovalStatuses.PENDING
        ? approval
        : await this.approvalsService.submit(
            approval.id,
            {
              reason: `Case evidence export request ${evidencePackage.packageNo} submitted`,
              traceId,
            },
            actor,
          );

    await this.prisma.complianceCaseEvidencePackage.update({
      where: { id: evidencePackage.id },
      data: {
        approvalCaseId: submitted.id,
      },
    });

    return this.findEvidencePackage(evidencePackage.id);
  }

  async findEvidencePackages(query: ComplianceCaseEvidencePackageQueryDto) {
    const skip = this.normalizeSkip(query.skip);
    const take = this.normalizeTake(query.take);
    const where: any = {};
    if (query.status) {
      where.status = query.status;
    }

    const [total, rows] = await Promise.all([
      this.prisma.complianceCaseEvidencePackage.count({ where }),
      this.prisma.complianceCaseEvidencePackage.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        include: {
          approvalCase: {
            select: {
              id: true,
              approvalNo: true,
              actionType: true,
              entityRef: true,
              status: true,
              executionStatus: true,
              traceId: true,
              decisionByUserId: true,
              decisionByRole: true,
              decidedAt: true,
              createdAt: true,
              updatedAt: true,
            },
          },
        },
      }),
    ]);

    return {
      total,
      skip,
      take,
      items: rows.map((row) => this.mapEvidencePackage(row)),
    };
  }

  async findEvidencePackage(id: string) {
    const found = await this.prisma.complianceCaseEvidencePackage.findUnique({
      where: { id },
      include: {
        approvalCase: {
          select: {
            id: true,
            approvalNo: true,
            actionType: true,
            entityRef: true,
            status: true,
            executionStatus: true,
            traceId: true,
            decisionByUserId: true,
            decisionByRole: true,
            decidedAt: true,
            createdAt: true,
            updatedAt: true,
          },
        },
      },
    });
    if (!found) {
      throw new NotFoundException(`Case evidence package not found: ${id}`);
    }

    return this.mapEvidencePackage(found);
  }

  async downloadEvidencePackage(id: string, actor: ApprovalActorContext) {
    const found = await this.findEvidencePackage(id);
    if (!found.approvalCaseId) {
      throw new BadRequestException('Case evidence export is missing approval binding');
    }

    await this.approvalsService.requireApproved({
      actionType: ApprovalActionTypes.CASE_EVIDENCE_EXPORT_APPROVAL,
      entityRef: id,
      approvalCaseId: found.approvalCaseId,
      actor,
      traceId: this.normalizeOptionalString(found.approvalCase?.traceId),
    });

    if (found.status !== AuditEvidencePackageStatus.READY) {
      if (found.status === AuditEvidencePackageStatus.FAILED) {
        throw new BadRequestException('Approval granted but package generation failed');
      }
      throw new BadRequestException('Case evidence package is not ready');
    }

    return {
      id: found.id,
      packageNo: found.packageNo,
      fileName: found.fileName || `${found.packageNo}.json`,
      digest: found.digest,
      content:
        found.packageBody || {
          manifest: found.manifest,
          cases: [],
          decisionRecords: [],
          providerResponseReferences: [],
          providerResponseSnapshots: [],
          digest: found.digest,
        },
    };
  }

  @OnEvent(ApprovalEvents.APPROVED, { async: true })
  async handleApprovedApproval(event: ApprovalDecisionEvent) {
    if (event.actionType !== ApprovalActionTypes.CASE_EVIDENCE_EXPORT_APPROVAL) {
      return;
    }

    const evidencePackage = await this.prisma.complianceCaseEvidencePackage.findFirst({
      where: {
        OR: [{ approvalCaseId: event.approvalId }, { id: event.entityRef }],
      },
    });
    if (!evidencePackage || evidencePackage.status === AuditEvidencePackageStatus.READY) {
      return;
    }

    const exporterActor: ApprovalActorContext = {
      actorType: 'ADMIN',
      userId: evidencePackage.exportedById,
      role: evidencePackage.exportedByRole || undefined,
      roleCodes: evidencePackage.exportedByRole ? [evidencePackage.exportedByRole] : [],
      userNo: undefined,
    };

    try {
      const filterSnapshot =
        this.parseJson<ExportComplianceCaseEvidencePackageDto>(evidencePackage.filterSnapshot) || {};
      const selectedCaseIds =
        this.parseJson<string[]>(evidencePackage.selectedCaseIdsSnapshot) || [];

      const approvalSummary: ApprovalSummary = {
        approvalId: event.approvalId,
        approvalNo: this.normalizeOptionalString(event.approvalNo),
        approvalStatus: ApprovalStatuses.APPROVED,
        approvedBy: this.normalizeOptionalString(event.decisionByUserId),
        approvalDecidedAt: this.normalizeOptionalString(event.decidedAt),
      };
      const artifacts = await this.buildEvidencePackageArtifacts(
        {
          ...filterSnapshot,
          selectedCaseIds,
        },
        this.toAuditActor(exporterActor),
        approvalSummary,
      );

      await this.prisma.complianceCaseEvidencePackage.update({
        where: { id: evidencePackage.id },
        data: {
          status: AuditEvidencePackageStatus.READY,
          fileName: `${evidencePackage.packageNo}.json`,
          digest: artifacts.digest,
          manifest: this.serializeJson(artifacts.manifest),
          packageBody: this.serializeJson(artifacts.packageBody),
        },
      });

      await this.auditLogsService.recordByActor(
        {
          triggerType: AuditTriggerType.EVIDENCE_EXPORT,
          action: AuditActions.CASE_EVIDENCE_PACKAGE_EXPORTED,
          module: AuditModules.COMPLIANCE_INCIDENTS,
          entityType: AuditEntityTypes.COMPLIANCE_CASE_EVIDENCE_PACKAGE,
          entityId: evidencePackage.id,
          entityNo: evidencePackage.packageNo,
          result: AuditResult.SUCCESS,
          reason: `Exported ${artifacts.itemCount} compliance cases after approval`,
          traceId: event.traceId,
          metadata: {
            digest: artifacts.digest,
            itemCount: artifacts.itemCount,
            caseNos: artifacts.caseNos,
            approvalId: event.approvalId,
          },
          requestId: `CASE_EXPORT_${evidencePackage.packageNo}`,
          sourcePlatform: 'ADMIN_API',
        },
        this.toAuditActor(exporterActor),
      );

      await this.approvalsService.markExecutionResult(
        event.approvalId,
        true,
        {
          actorType: 'ADMIN',
          userId: event.decisionByUserId || exporterActor.userId,
          userNo: exporterActor.userNo,
          role: event.decisionByRole || exporterActor.role,
          roleCodes: event.decisionByRole ? [event.decisionByRole] : exporterActor.roleCodes,
        },
        'Case evidence package generated successfully',
      );
    } catch (error) {
      await this.prisma.complianceCaseEvidencePackage.update({
        where: { id: evidencePackage.id },
        data: {
          status: AuditEvidencePackageStatus.FAILED,
        },
      });

      await this.approvalsService.markExecutionResult(
        event.approvalId,
        false,
        {
          actorType: 'ADMIN',
          userId: event.decisionByUserId || exporterActor.userId,
          userNo: exporterActor.userNo,
          role: event.decisionByRole || exporterActor.role,
          roleCodes: event.decisionByRole ? [event.decisionByRole] : exporterActor.roleCodes,
        },
        error instanceof Error ? error.message : 'Case evidence generation failed',
      );
    }
  }

  @OnEvent(ApprovalEvents.REJECTED, { async: true })
  async handleRejectedApproval(event: ApprovalDecisionEvent) {
    if (event.actionType !== ApprovalActionTypes.CASE_EVIDENCE_EXPORT_APPROVAL) {
      return;
    }

    await this.prisma.complianceCaseEvidencePackage.updateMany({
      where: {
        OR: [{ approvalCaseId: event.approvalId }, { id: event.entityRef }],
      },
      data: {
        status: AuditEvidencePackageStatus.REJECTED,
      },
    });
  }

  @OnEvent(ApprovalEvents.CANCELLED, { async: true })
  async handleCancelledApproval(event: ApprovalDecisionEvent) {
    if (event.actionType !== ApprovalActionTypes.CASE_EVIDENCE_EXPORT_APPROVAL) {
      return;
    }

    await this.prisma.complianceCaseEvidencePackage.updateMany({
      where: {
        OR: [{ approvalCaseId: event.approvalId }, { id: event.entityRef }],
      },
      data: {
        status: AuditEvidencePackageStatus.CANCELLED,
      },
    });
  }

  @OnEvent(ApprovalEvents.EXPIRED, { async: true })
  async handleExpiredApproval(event: ApprovalDecisionEvent) {
    if (event.actionType !== ApprovalActionTypes.CASE_EVIDENCE_EXPORT_APPROVAL) {
      return;
    }

    await this.prisma.complianceCaseEvidencePackage.updateMany({
      where: {
        OR: [{ approvalCaseId: event.approvalId }, { id: event.entityRef }],
      },
      data: {
        status: AuditEvidencePackageStatus.EXPIRED,
      },
    });
  }
}
