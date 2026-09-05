import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { randomUUID } from 'crypto';
import { AuditLogsService } from './audit-logs.service';
import {
  AuditEntityTypes,
} from './constants/audit-actions.constant';
import {
  AuditCategory,
  AuditEvidencePackageStatus,
  AuditOutcome,
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
      actorNo: actor.userNo || 'UNKNOWN',

      actorDisplayName: actor.userNo || 'UNKNOWN',
      actorRolesAtTime: [actor.role || actor.roleCodes[0] || 'UNKNOWN'],
    };
  }

  async createExportRequest(query: ExportEvidencePackageDto, actor: ApprovalActorContext) {
    // START：本次导出旅程的 correlationId。不再采信调用方可能在 query.traceId 里传入的
    // 值——铁律要求 START 永远铸造新值（同 Task 6-8 其余工作流）。AuditEvidencePackage
    // 表没有 traceId/correlationId 列，同一个值同事务写进 ApprovalCase.traceId 承载，
    // 供 executePackageGeneration 经 ApprovalDecidedEvent.traceId INHERIT 读回。
    const correlationId = randomUUID();
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
        entityRef: evidencePackage.packageNo,
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
        traceId: correlationId,
      },
      {
        reason: `Evidence export request ${evidencePackage.packageNo} submitted`,
        traceId: correlationId,
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
        action: 'AUDIT_EVIDENCE_EXPORT_REQUESTED',
        actionDomain: 'AUDIT',
        category: AuditCategory.GOVERNANCE,
        primarySubjectType: AuditEntityTypes.AUDIT_EVIDENCE_PACKAGE,
        primarySubjectNo: evidencePackage.packageNo,
        correlationId,
        outcome: AuditOutcome.SUCCESS,
        metadata: { dateRangeFrom, dateRangeTo, itemCount: selection.itemCount, approvalNo: submitted.approvalNo },
        requestId: randomUUID(),
        sourcePlatform: 'ADMIN_API',
      },
      this.toAuditActor(actor),
    );

    return this.auditLogsService.findEvidencePackage(evidencePackage.id);
  }

  async downloadEvidencePackage(id: string, actor: ApprovalActorContext, sourceIp?: string) {
    const found = await this.auditLogsService.findEvidencePackage(id);
    if (!found) throw new NotFoundException(`Evidence package not found: ${id}`);
    if (!found.approvalCaseId) throw new BadRequestException('Evidence export is missing approval binding');

    await this.approvalsService.requireApproved({
      actionType: ApprovalActionTypes.AUDIT_EVIDENCE_EXPORT_APPROVAL,
      entityRef: found.packageNo,
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
        action: 'AUDIT_EVIDENCE_EXPORT_DOWNLOADED',
        actionDomain: 'AUDIT',
        category: AuditCategory.GOVERNANCE,
        primarySubjectType: AuditEntityTypes.AUDIT_EVIDENCE_PACKAGE,
        primarySubjectNo: found.packageNo,
        // INHERIT：读 ApprovalCase.traceId——它就是 createExportRequest 铸造的
        // correlationId 原样传播过来的。读不到就让 assertActionSpec 在写入时报错。
        correlationId: this.normalizeOptionalString(found.approvalCase?.traceId) || undefined,
        outcome: AuditOutcome.SUCCESS,
        sourceIp,
        requestId: randomUUID(),
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
    // entityRef 现在存 packageNo（铁律⑥）；findEvidencePackageForApproval 内部的
    // OR 分支已同步改按 packageNo 回查（audit-logs.service.ts）。
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
          action: 'AUDIT_EVIDENCE_EXPORT_GENERATED',
          actionDomain: 'AUDIT',
          category: AuditCategory.GOVERNANCE,
          primarySubjectType: AuditEntityTypes.AUDIT_EVIDENCE_PACKAGE,
          primarySubjectNo: evidencePackage.packageNo,
          // INHERIT：读 ApprovalDecidedEvent.traceId——它就是 createExportRequest 铸造的
          // correlationId 原样传播过来的（经 ApprovalCase.traceId）。
          correlationId: event.traceId,
          // 异步驱动：这条记录是被"审批已批准"这个决定触发的。
          causationId: event.approvalId,
          outcome: AuditOutcome.SUCCESS,
          // DTO 的 payloadDigest 字段只满足 assertActionSpec 的 requiredFields 校验
          // （不落库——与 DB 的同名行级完整性摘要列是两个概念，recordByActor 从不读
          // input.payloadDigest，见该字段上的 DTO 注释）；metadata.payloadDigest 才是
          // 这份"证据包内容摘要"实际持久化、可查询的地方，与 evidencePackage.digest
          // （finalizeEvidencePackage 已写）互为副本，供只看审计流不联表也能核对。
          payloadDigest: artifacts.digest,
          metadata: { fileSize, fileCount: artifacts.itemCount, payloadDigest: artifacts.digest },
          requestId: randomUUID(),
          sourcePlatform: 'ADMIN_API',
        },
        this.toAuditActor(exporterActor),
      );

    } catch (error) {
      await this.auditLogsService.markEvidencePackageFailed(evidencePackage.id);

      // 生成失败也必须留痕——「失败必须记」是本批核心，静默失败＝没有证据证明它发生过。
      // requiredFields（此码是产物摘要 payloadDigest）只在成功路径强制：失败时按定义就
      // 没有产物、也就没有摘要，编一个假摘要比不写更误导。故走 outcome=FAILED + reasonCode，
      // assertActionSpec 对非成功路径改为强制 reasonCode（失败要能被机器聚合）。
      await this.auditLogsService.recordByActor(
        {
          action: 'AUDIT_EVIDENCE_EXPORT_GENERATED',
          actionDomain: 'AUDIT',
          category: AuditCategory.GOVERNANCE,
          primarySubjectType: 'AUDIT_EVIDENCE_PACKAGE',
          primarySubjectNo: evidencePackage.packageNo,
          correlationId: event.traceId,
          causationId: event.approvalId,
          outcome: AuditOutcome.FAILED,
          reasonCode: 'GENERATION_ERROR',
          reason: `Evidence package generation failed: ${(error as Error)?.message ?? 'unknown'}`,
          sourcePlatform: 'SYSTEM',
        },
        this.toAuditActor(exporterActor),
      );
    }
  }

  private async executePackageTermination(event: ApprovalDecidedEvent) {
    const statusMap: Record<string, AuditEvidencePackageStatus> = {
      DECLINED: AuditEvidencePackageStatus.REJECTED,
      CANCELLED: AuditEvidencePackageStatus.CANCELLED,
      EXPIRED: AuditEvidencePackageStatus.EXPIRED,
    };
    const status = statusMap[event.decision] || AuditEvidencePackageStatus.CANCELLED;
    // entityRef 现在存 packageNo（铁律⑥）；bulkMarkEvidencePackagesStatus 内部的
    // OR 分支已同步改按 packageNo 回查（audit-logs.service.ts）。
    await this.auditLogsService.bulkMarkEvidencePackagesStatus(event.approvalId, event.entityRef, status);
  }
}
