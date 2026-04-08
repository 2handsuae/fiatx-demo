import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AuditLogsService } from '../../risk-engine/audit-logs/audit-logs.service';
import {
  AuditActions,
  AuditBusinessWorkflowTypes,
  AuditEntityTypes,
  AuditModules,
} from '../../risk-engine/audit-logs/constants/audit-actions.constant';
import {
  AuditEvidencePackageStatus,
  AuditResult,
  AuditSubjectRole,
  AuditTriggerType,
  ExportEvidencePackageDto,
} from '../../risk-engine/audit-logs/dto/audit-log.dto';
import { sha256Hex } from '../../risk-engine/audit-logs/utils/audit-digest.util';
import { ApprovalsService } from './approvals.service';
import {
  ApprovalActorContext,
  ApprovalDecisionEvent,
  ApprovalEvents,
  ApprovalActionTypes,
  ApprovalStatuses,
} from './constants/approval.constants';

interface ApprovalSummary {
  approvalId: string;
  approvalNo?: string | null;
  approvalStatus: string;
  approvedBy?: string | null;
  approvalDecidedAt?: string | null;
}

@Injectable()
export class AuditEvidenceExportApprovalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
    private readonly approvalsService: ApprovalsService,
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

  private toAuditActor(actor: ApprovalActorContext) {
    return {
      actorType: actor.actorType,
      actorId: actor.userId,
      actorNo: actor.userNo,
      actorRole: actor.role || actor.roleCodes[0] || 'UNKNOWN',
    };
  }

  private buildApprovalRelatedSubjects(
    packageId: string,
    packageNo: string,
    approvalId?: string | null,
    approvalNo?: string | null,
  ) {
    const subjects = [];

    if (approvalNo) {
      subjects.push({
        subjectRole: AuditSubjectRole.RELATED,
        subjectType: AuditEntityTypes.APPROVAL_CASE,
        subjectId: approvalId || undefined,
        subjectNo: approvalNo,
      });
    }

    subjects.push({
      subjectRole: AuditSubjectRole.RELATED,
      subjectType: AuditEntityTypes.AUDIT_EVIDENCE_PACKAGE,
      subjectId: packageId,
      subjectNo: packageNo,
    });

    return subjects;
  }

  async createExportRequest(
    query: ExportEvidencePackageDto,
    actor: ApprovalActorContext,
  ) {
    const selection = await this.auditLogsService.prepareEvidenceExportSelection(query);
    const requestedAt = new Date().toISOString();
    const requestManifest = {
      version: '1.0',
      generatedAt: requestedAt,
      requestPhase: 'PENDING_APPROVAL',
      exportMode: selection.normalizedCriteria.mode,
      criteria: selection.normalizedCriteria,
      workflowSummary: selection.workflowSummary,
      itemCount: selection.itemCount,
      approvalStatus: ApprovalStatuses.PENDING,
    };
    const requestDigest = sha256Hex(requestManifest);

    const evidencePackage = await this.auditLogsService.createEvidencePackageRecord({
      exportedByType: actor.actorType,
      exportedById: actor.userId,
      exportedByNo: actor.userNo || null,
      exportedByRole: actor.role || actor.roleCodes[0] || null,
      status: AuditEvidencePackageStatus.PENDING_APPROVAL,
      exportMode: selection.normalizedCriteria.mode,
      fileName: null,
      filterSnapshot: this.serializeJson(selection.filterSnapshot),
      selectedEventIdsSnapshot: this.serializeJson(selection.selectedEventIds),
      itemCount: selection.itemCount,
      digest: requestDigest,
      manifest: this.serializeJson(requestManifest),
      packageBody: null,
    });

    const approval = await this.approvalsService.create(
      {
        actionType: ApprovalActionTypes.AUDIT_EVIDENCE_EXPORT_APPROVAL,
        entityRef: evidencePackage.id,
        workflowType: AuditBusinessWorkflowTypes.AUDIT_EVIDENCE_EXPORT,
        workflowId: evidencePackage.id,
        workflowNo: evidencePackage.packageNo,
        metadata: {
          packageId: evidencePackage.id,
          packageNo: evidencePackage.packageNo,
          itemCount: selection.itemCount,
          workflowSummary: selection.workflowSummary,
        },
        traceId: query.traceId,
      },
      actor,
    );

    const submitted = approval.status === ApprovalStatuses.PENDING
      ? approval
      : await this.approvalsService.submit(
          approval.id,
          {
            reason: `Evidence export request ${evidencePackage.packageNo} submitted`,
            traceId: approval.traceId,
          },
          actor,
        );

    await this.prisma.auditEvidencePackage.update({
      where: { id: evidencePackage.id },
      data: {
        approvalCaseId: submitted.id,
        approvalCaseNo: submitted.approvalNo || null,
      },
    });

    await this.auditLogsService.recordByActor(
      {
        triggerType: AuditTriggerType.EVIDENCE_EXPORT,
        action: AuditActions.AUDIT_EVIDENCE_EXPORT_REQUESTED,
        module: AuditModules.AUDIT_LOGS,
        entityType: AuditEntityTypes.AUDIT_EVIDENCE_PACKAGE,
        entityId: evidencePackage.id,
        entityNo: evidencePackage.packageNo,
        workflowType: AuditBusinessWorkflowTypes.AUDIT_EVIDENCE_EXPORT,
        traceId: submitted.traceId,
        result: AuditResult.SUCCESS,
        reason: `Evidence export request ${evidencePackage.packageNo} created`,
        metadata: {
          approvalId: submitted.id,
          approvalNo: submitted.approvalNo || null,
          exportMode: evidencePackage.exportMode,
          itemCount: selection.itemCount,
          workflowSummary: selection.workflowSummary,
          ...(submitted.id
            ? {
                parentEntityType: 'APPROVAL_CASE',
                parentEntityId: submitted.id,
                parentEntityNo: submitted.approvalNo || null,
              }
            : {}),
        },
        subjectNos: this.buildApprovalRelatedSubjects(
          evidencePackage.id,
          evidencePackage.packageNo,
          submitted.id,
          submitted.approvalNo || null,
        ),
        requestId: `EVIDENCE_EXPORT_REQUEST_${evidencePackage.packageNo}`,
        sourcePlatform: 'ADMIN_API',
      },
      this.toAuditActor(actor),
    );

    return this.auditLogsService.findEvidencePackage(evidencePackage.id);
  }

  async downloadEvidencePackage(id: string, actor: ApprovalActorContext) {
    const found = await this.auditLogsService.findEvidencePackage(id);
    if (!found) {
      throw new NotFoundException(`Evidence package not found: ${id}`);
    }

    if (!found.approvalCaseId) {
      throw new BadRequestException('Evidence export is missing approval binding');
    }

    await this.approvalsService.requireApproved({
      actionType: ApprovalActionTypes.AUDIT_EVIDENCE_EXPORT_APPROVAL,
      entityRef: id,
      approvalCaseId: found.approvalCaseId,
      actor,
      traceId: this.normalizeOptionalString(found.approvalCase?.traceId),
    });

    if (found.status !== AuditEvidencePackageStatus.READY) {
      if (found.status === AuditEvidencePackageStatus.FAILED) {
        throw new BadRequestException('Approval granted but package generation failed');
      }
      throw new BadRequestException('Export package is not ready');
    }

    const downloaded = await this.auditLogsService.downloadEvidencePackage(id);

    await this.auditLogsService.recordByActor(
      {
        triggerType: AuditTriggerType.EVIDENCE_EXPORT,
        action: AuditActions.AUDIT_EVIDENCE_PACKAGE_DOWNLOADED,
        module: AuditModules.AUDIT_LOGS,
        entityType: AuditEntityTypes.AUDIT_EVIDENCE_PACKAGE,
        entityId: found.id,
        entityNo: found.packageNo,
        workflowType: AuditBusinessWorkflowTypes.AUDIT_EVIDENCE_EXPORT,
        traceId: this.normalizeOptionalString(found.approvalCase?.traceId) || undefined,
        result: AuditResult.SUCCESS,
        reason: `Evidence package ${found.packageNo} downloaded`,
        metadata: {
          approvalCaseId: found.approvalCaseId,
          approvalNo: this.normalizeOptionalString(found.approvalCase?.approvalNo),
          fileName: found.fileName || null,
          ...(found.approvalCase
            ? {
                parentEntityType: 'APPROVAL_CASE',
                parentEntityId: found.approvalCase.id,
                parentEntityNo: found.approvalCase.approvalNo,
              }
            : {}),
        },
        subjectNos: this.buildApprovalRelatedSubjects(
          found.id,
          found.packageNo,
          found.approvalCaseId,
          this.normalizeOptionalString(found.approvalCase?.approvalNo),
        ),
        requestId: `EVIDENCE_EXPORT_DOWNLOAD_${found.packageNo}`,
        sourcePlatform: 'ADMIN_API',
      },
      this.toAuditActor(actor),
    );

    return downloaded;
  }

  @OnEvent(ApprovalEvents.APPROVED, { async: true })
  async handleApprovedApproval(event: ApprovalDecisionEvent) {
    if (event.actionType !== ApprovalActionTypes.AUDIT_EVIDENCE_EXPORT_APPROVAL) {
      return;
    }

    const evidencePackage = await this.prisma.auditEvidencePackage.findFirst({
      where: {
        deletedAt: null,
        OR: [{ approvalCaseId: event.approvalId }, { id: event.entityRef }],
      },
    });

    if (!evidencePackage || evidencePackage.status === AuditEvidencePackageStatus.READY) {
      return;
    }

    const exporterActor: ApprovalActorContext = {
      actorType: 'ADMIN',
      userId: evidencePackage.exportedById,
      userNo: evidencePackage.exportedByNo || undefined,
      role: evidencePackage.exportedByRole || undefined,
      roleCodes: evidencePackage.exportedByRole ? [evidencePackage.exportedByRole] : [],
    };

    try {
      const selectedEventIds =
        this.parseJson<string[]>(evidencePackage.selectedEventIdsSnapshot) || [];
      const filterSnapshot =
        this.parseJson<Record<string, unknown>>(evidencePackage.filterSnapshot) || {};
      const exportQuery: ExportEvidencePackageDto = {
        ...filterSnapshot,
        selectedEventIds,
        includeRecords:
          typeof filterSnapshot.includeRecords === 'boolean'
            ? (filterSnapshot.includeRecords as boolean)
            : true,
        maxItems:
          typeof filterSnapshot.maxItems === 'number'
            ? (filterSnapshot.maxItems as number)
            : selectedEventIds.length,
        mode:
          typeof filterSnapshot.mode === 'string'
            ? (filterSnapshot.mode as ExportEvidencePackageDto['mode'])
            : undefined,
      };

      const approvalSummary: ApprovalSummary = {
        approvalId: event.approvalId,
        approvalNo: this.normalizeOptionalString(event.approvalNo),
        approvalStatus: ApprovalStatuses.APPROVED,
        approvedBy: this.normalizeOptionalString(event.decisionByUserId),
        approvalDecidedAt: this.normalizeOptionalString(event.decidedAt),
      };
      const artifacts = await this.auditLogsService.buildEvidencePackageArtifacts(
        exportQuery,
        this.toAuditActor(exporterActor),
        approvalSummary,
      );

      await this.prisma.auditEvidencePackage.update({
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
          action: AuditActions.AUDIT_EVIDENCE_PACKAGE_EXPORTED,
          module: AuditModules.AUDIT_LOGS,
          entityType: AuditEntityTypes.AUDIT_EVIDENCE_PACKAGE,
          entityId: evidencePackage.id,
          entityNo: evidencePackage.packageNo,
          workflowType: AuditBusinessWorkflowTypes.AUDIT_EVIDENCE_EXPORT,
          result: AuditResult.SUCCESS,
          reason: `Exported ${artifacts.itemCount} audit logs after approval`,
          traceId: event.traceId,
          metadata: {
            digest: artifacts.digest,
            itemCount: artifacts.itemCount,
            exportMode: evidencePackage.exportMode,
            approvalId: event.approvalId,
            ...(event.approvalId
              ? {
                  parentEntityType: 'APPROVAL_CASE',
                  parentEntityId: event.approvalId,
                  parentEntityNo: this.normalizeOptionalString(event.approvalNo),
                }
              : {}),
          },
          requestId: `EXPORT_${evidencePackage.packageNo}`,
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
          userNo: event.decisionByUserNo || exporterActor.userNo,
          role: event.decisionByRole || exporterActor.role,
          roleCodes: event.decisionByRole ? [event.decisionByRole] : exporterActor.roleCodes,
        },
        'Evidence export package generated successfully',
      );
    } catch (error) {
      await this.prisma.auditEvidencePackage.update({
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
          userNo: event.decisionByUserNo || exporterActor.userNo,
          role: event.decisionByRole || exporterActor.role,
          roleCodes: event.decisionByRole ? [event.decisionByRole] : exporterActor.roleCodes,
        },
        error instanceof Error ? error.message : 'Evidence export generation failed',
      );
    }
  }

  @OnEvent(ApprovalEvents.REJECTED, { async: true })
  async handleRejectedApproval(event: ApprovalDecisionEvent) {
    if (event.actionType !== ApprovalActionTypes.AUDIT_EVIDENCE_EXPORT_APPROVAL) {
      return;
    }

    await this.prisma.auditEvidencePackage.updateMany({
      where: {
        deletedAt: null,
        OR: [{ approvalCaseId: event.approvalId }, { id: event.entityRef }],
      },
      data: {
        status: AuditEvidencePackageStatus.REJECTED,
      },
    });
  }

  @OnEvent(ApprovalEvents.CANCELLED, { async: true })
  async handleCancelledApproval(event: ApprovalDecisionEvent) {
    if (event.actionType !== ApprovalActionTypes.AUDIT_EVIDENCE_EXPORT_APPROVAL) {
      return;
    }

    await this.prisma.auditEvidencePackage.updateMany({
      where: {
        deletedAt: null,
        OR: [{ approvalCaseId: event.approvalId }, { id: event.entityRef }],
      },
      data: {
        status: AuditEvidencePackageStatus.CANCELLED,
      },
    });
  }

  @OnEvent(ApprovalEvents.EXPIRED, { async: true })
  async handleExpiredApproval(event: ApprovalDecisionEvent) {
    if (event.actionType !== ApprovalActionTypes.AUDIT_EVIDENCE_EXPORT_APPROVAL) {
      return;
    }

    await this.prisma.auditEvidencePackage.updateMany({
      where: {
        deletedAt: null,
        OR: [{ approvalCaseId: event.approvalId }, { id: event.entityRef }],
      },
      data: {
        status: AuditEvidencePackageStatus.EXPIRED,
      },
    });
  }
}
