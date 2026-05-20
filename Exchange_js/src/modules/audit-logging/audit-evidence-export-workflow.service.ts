import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { AuditLogsService } from './audit-logs.service';
import {
  AuditBusinessWorkflowTypes,
  AuditEntityTypes,
  AuditGovernanceActions,
} from './constants/audit-actions.constant';
import {
  AuditEvidencePackageStatus,
  AuditResult,
  ExportEvidencePackageDto,
} from './dto/audit-log.dto';
import { sha256Hex } from './utils/audit-digest.util';
import { ApprovalsService } from '../governance/approvals/approvals.service';
import { ApprovalDecidedEvent } from '../governance/approvals/approval-handler.base';
import {
  ApprovalActorContext,
  ApprovalActionTypes,
  ApprovalStatuses,
} from '../governance/approvals/constants/approval.constants';

const SECONDARY_EVENT = 'workflow.audit-evidence-export.decided';

@Injectable()
export class AuditEvidenceExportWorkflowService {
  constructor(
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

  async createExportRequest(query: ExportEvidencePackageDto, actor: ApprovalActorContext) {
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

    const submitted = await this.approvalsService.createAndSubmit(
      {
        actionType: ApprovalActionTypes.AUDIT_EVIDENCE_EXPORT_APPROVAL,
        entityRef: evidencePackage.id,
        objectSnapshot: {
          packageNo: evidencePackage.packageNo,
          exportMode: evidencePackage.exportMode,
          itemCount: evidencePackage.itemCount,
          status: evidencePackage.status,
          filterSnapshot: selection.filterSnapshot,
          digest: evidencePackage.digest,
          createdAt: evidencePackage.createdAt,
          workflowSummary: selection.workflowSummary,
        },
        traceId: query.traceId,
      },
      {
        reason: `Evidence export request ${evidencePackage.packageNo} submitted`,
        traceId: query.traceId,
      },
      actor,
    );

    await this.auditLogsService.linkEvidencePackageApproval(
      evidencePackage.id,
      submitted.id,
      submitted.approvalNo || null,
    );

    const dateRangeFrom = this.normalizeOptionalString((selection.filterSnapshot as any)?.startAt);
    const dateRangeTo = this.normalizeOptionalString((selection.filterSnapshot as any)?.endAt);

    await this.auditLogsService.recordByActor(
      {
        action: AuditGovernanceActions.AUDIT_EVIDENCE_EXPORT.EXPORT_REQUESTED,
        entityType: AuditEntityTypes.AUDIT_EVIDENCE_PACKAGE,
        entityId: evidencePackage.id,
        entityNo: evidencePackage.packageNo,
        workflowType: AuditBusinessWorkflowTypes.AUDIT_EVIDENCE_EXPORT,
        traceId: submitted.traceId,
        result: AuditResult.SUCCESS,
        metadata: { dateRangeFrom, dateRangeTo, itemCount: selection.itemCount },
        requestId: `EVIDENCE_EXPORT_REQUESTED_${evidencePackage.packageNo}`,
        sourcePlatform: 'ADMIN_API',
      },
      this.toAuditActor(actor),
    );

    return this.auditLogsService.findEvidencePackage(evidencePackage.id);
  }

  async downloadEvidencePackage(id: string, actor: ApprovalActorContext) {
    const found = await this.auditLogsService.findEvidencePackage(id);
    if (!found) throw new NotFoundException(`Evidence package not found: ${id}`);
    if (!found.approvalCaseId) throw new BadRequestException('Evidence export is missing approval binding');

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
        action: AuditGovernanceActions.AUDIT_EVIDENCE_EXPORT.PACKAGE_DOWNLOADED,
        entityType: AuditEntityTypes.AUDIT_EVIDENCE_PACKAGE,
        entityId: found.id,
        entityNo: found.packageNo,
        workflowType: AuditBusinessWorkflowTypes.AUDIT_EVIDENCE_EXPORT,
        traceId: this.normalizeOptionalString(found.approvalCase?.traceId) || undefined,
        result: AuditResult.SUCCESS,
        requestId: `EVIDENCE_EXPORT_DOWNLOAD_${found.packageNo}_${Date.now()}`,
        sourcePlatform: 'ADMIN_API',
      },
      this.toAuditActor(actor),
    );

    return downloaded;
  }

  @OnEvent(SECONDARY_EVENT, { async: true })
  async handleApprovalDecided(event: ApprovalDecidedEvent) {
    switch (event.decision) {
      case 'APPROVED':
        return this.executePackageGeneration(event);
      case 'DECLINED':
      case 'CANCELLED':
      case 'EXPIRED':
        return this.executePackageTermination(event);
    }
  }

  private async executePackageGeneration(event: ApprovalDecidedEvent) {
    const evidencePackage = await this.auditLogsService.findEvidencePackageForApproval(
      event.approvalId,
      event.entityRef,
    );
    if (!evidencePackage || evidencePackage.status === AuditEvidencePackageStatus.READY) return;

    const exporterActor: ApprovalActorContext = {
      actorType: 'ADMIN',
      userId: evidencePackage.exportedById,
      userNo: evidencePackage.exportedByNo || undefined,
      role: evidencePackage.exportedByRole || undefined,
      roleCodes: evidencePackage.exportedByRole ? [evidencePackage.exportedByRole] : [],
    };

    try {
      const filterSnapshot = this.parseJson<Record<string, unknown>>(evidencePackage.filterSnapshot) || {};
      const selectedEventIds = this.parseJson<string[]>(evidencePackage.selectedEventIdsSnapshot) || [];
      const exportQuery: ExportEvidencePackageDto = {
        ...filterSnapshot,
        selectedEventIds,
        includeRecords: typeof filterSnapshot.includeRecords === 'boolean' ? (filterSnapshot.includeRecords as boolean) : true,
        maxItems: typeof filterSnapshot.maxItems === 'number' ? (filterSnapshot.maxItems as number) : selectedEventIds.length,
        mode: typeof filterSnapshot.mode === 'string' ? (filterSnapshot.mode as ExportEvidencePackageDto['mode']) : undefined,
      };

      const artifacts = await this.auditLogsService.buildEvidencePackageArtifacts(
        exportQuery,
        this.toAuditActor(exporterActor),
        {
          approvalId: event.approvalId,
          approvalNo: this.normalizeOptionalString(event.approvalNo),
          approvalStatus: ApprovalStatuses.APPROVED,
          approvedBy: this.normalizeOptionalString(event.decisionByUserId),
          approvalDecidedAt: this.normalizeOptionalString(event.decidedAt),
        },
      );

      const packageBodyStr = JSON.stringify(artifacts.packageBody);
      const fileSize = Buffer.byteLength(packageBodyStr, 'utf8');

      await this.auditLogsService.finalizeEvidencePackage(evidencePackage.id, {
        status: AuditEvidencePackageStatus.READY,
        fileName: `${evidencePackage.packageNo}.json`,
        digest: artifacts.digest,
        manifest: this.serializeJson(artifacts.manifest),
        packageBody: packageBodyStr,
      });

      await this.auditLogsService.recordByActor(
        {
          action: AuditGovernanceActions.AUDIT_EVIDENCE_EXPORT.GENERATION_COMPLETED,
          entityType: AuditEntityTypes.AUDIT_EVIDENCE_PACKAGE,
          entityId: evidencePackage.id,
          entityNo: evidencePackage.packageNo,
          workflowType: AuditBusinessWorkflowTypes.AUDIT_EVIDENCE_EXPORT,
          traceId: event.traceId,
          result: AuditResult.SUCCESS,
          metadata: { fileSize, fileCount: artifacts.itemCount },
          requestId: `EVIDENCE_EXPORT_GENERATION_COMPLETED_${evidencePackage.packageNo}`,
          sourcePlatform: 'ADMIN_API',
        },
        this.toAuditActor(exporterActor),
      );

    } catch (error) {
      await this.auditLogsService.markEvidencePackageFailed(evidencePackage.id);

      await this.auditLogsService.recordByActor(
        {
          action: AuditGovernanceActions.AUDIT_EVIDENCE_EXPORT.GENERATION_FAILED,
          entityType: AuditEntityTypes.AUDIT_EVIDENCE_PACKAGE,
          entityId: evidencePackage.id,
          entityNo: evidencePackage.packageNo,
          workflowType: AuditBusinessWorkflowTypes.AUDIT_EVIDENCE_EXPORT,
          traceId: event.traceId,
          result: AuditResult.FAILED,
          metadata: { failureReason: error instanceof Error ? error.message : 'Evidence export generation failed' },
          requestId: `EVIDENCE_EXPORT_GENERATION_FAILED_${evidencePackage.packageNo}_${Date.now()}`,
          sourcePlatform: 'ADMIN_API',
        },
        this.toAuditActor(exporterActor),
      ).catch(() => {});

    }
  }

  private async executePackageTermination(event: ApprovalDecidedEvent) {
    const statusMap: Record<string, AuditEvidencePackageStatus> = {
      DECLINED: AuditEvidencePackageStatus.REJECTED,
      CANCELLED: AuditEvidencePackageStatus.CANCELLED,
      EXPIRED: AuditEvidencePackageStatus.EXPIRED,
    };
    const status = statusMap[event.decision] || AuditEvidencePackageStatus.CANCELLED;
    await this.auditLogsService.bulkMarkEvidencePackagesStatus(event.approvalId, event.entityRef, status);
  }
}
