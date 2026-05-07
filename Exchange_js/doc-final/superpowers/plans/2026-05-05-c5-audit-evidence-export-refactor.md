# C5 Audit Evidence Export — 3-Layer Refactoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the monolithic AuditEvidenceExportApprovalService (555 lines) into a proper 3-layer architecture: thin approval handler + workflow orchestrator + domain service methods.

**Architecture:** Layer 2 (thin handler extending ApprovalHandlerBase) writes approval audit logs and emits a secondary "decided" event. Layer 3 (new workflow service) subscribes to the decided event and orchestrates all business logic through Layer 1 (AuditLogsService domain methods). Controller routes move from `/admin/audit-logs/...` to `/admin/audit/evidence-packages`.

**Tech Stack:** NestJS, Prisma, EventEmitter2, Jest

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/modules/audit-logging/audit-logs.service.ts` | Modify | Add 5 domain methods for evidence package state changes |
| `src/modules/audit-logging/audit-evidence-export-approval.service.ts` | Create | Layer 2 thin handler (~25 lines) |
| `src/modules/audit-logging/audit-evidence-export-workflow.service.ts` | Create | Layer 3 workflow orchestrator |
| `src/modules/audit-logging/audit-evidence-package.controller.ts` | Create | PRD-compliant routes |
| `src/modules/audit-logging/audit-logs.module.ts` | Modify | Register new services + controller |
| `src/modules/audit-logging/audit-logs.controller.ts` | Modify | Remove migrated evidence routes |
| `src/modules/governance/approvals/approvals.module.ts` | Modify | Remove old C5 service |
| `src/modules/governance/approvals/audit-evidence-export-approval.service.ts` | Delete | Replaced by audit-logging module version |
| `src/modules/governance/approvals/audit-evidence-export-approval.service.spec.ts` | Delete | Replaced by workflow spec |
| `src/modules/audit-logging/audit-evidence-export-workflow.service.spec.ts` | Create | Tests for workflow |

---

### Task 1: Add Domain Methods to AuditLogsService

**Files:**
- Modify: `src/modules/audit-logging/audit-logs.service.ts` (insert after `downloadEvidencePackage` method, ~line 3138)

- [ ] **Step 1: Add 5 new domain methods**

Insert immediately after the `downloadEvidencePackage` method (before `markArchivedBefore`):

```typescript
  async findEvidencePackageForApproval(
    approvalId: string,
    entityRef?: string | null,
  ): Promise<any | null> {
    const db = this.getDb() as any;
    if (!this.canOperateAuditEvidencePackage(db)) return null;
    const orClauses: any[] = [{ approvalCaseId: approvalId }];
    if (entityRef) orClauses.push({ id: entityRef });
    return db.auditEvidencePackage.findFirst({ where: { deletedAt: null, OR: orClauses } });
  }

  async linkEvidencePackageApproval(
    packageId: string,
    approvalCaseId: string,
    approvalCaseNo: string | null,
  ): Promise<void> {
    const db = this.getDb() as any;
    if (!this.canOperateAuditEvidencePackage(db)) {
      throw this.auditStorageUnavailable('Audit evidence package storage');
    }
    await db.auditEvidencePackage.update({
      where: { id: packageId },
      data: { approvalCaseId, approvalCaseNo },
    });
  }

  async finalizeEvidencePackage(
    packageId: string,
    data: { status: string; fileName: string; digest: string; manifest: string; packageBody: string },
  ): Promise<void> {
    const db = this.getDb() as any;
    if (!this.canOperateAuditEvidencePackage(db)) {
      throw this.auditStorageUnavailable('Audit evidence package storage');
    }
    await db.auditEvidencePackage.update({ where: { id: packageId }, data });
  }

  async markEvidencePackageFailed(packageId: string): Promise<void> {
    const db = this.getDb() as any;
    if (!this.canOperateAuditEvidencePackage(db)) return;
    await db.auditEvidencePackage.update({
      where: { id: packageId },
      data: { status: AuditEvidencePackageStatus.FAILED },
    });
  }

  async bulkMarkEvidencePackagesStatus(
    approvalId: string,
    entityRef: string | null | undefined,
    status: AuditEvidencePackageStatus,
  ): Promise<void> {
    const db = this.getDb() as any;
    if (!this.canOperateAuditEvidencePackage(db)) return;
    const orClauses: any[] = [{ approvalCaseId: approvalId }];
    if (entityRef) orClauses.push({ id: entityRef });
    await db.auditEvidencePackage.updateMany({
      where: { deletedAt: null, OR: orClauses },
      data: { status },
    });
  }
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd Exchange_js && npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No errors from `audit-logs.service.ts`

- [ ] **Step 3: Commit**

```bash
git add src/modules/audit-logging/audit-logs.service.ts
git commit -m "feat(audit): add domain methods for evidence package state management"
```

---

### Task 2: Create Layer 2 Thin Approval Handler

**Files:**
- Create: `src/modules/audit-logging/audit-evidence-export-approval.service.ts`

- [ ] **Step 1: Create the thin handler**

```typescript
import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AuditLogsService } from './audit-logs.service';
import {
  AuditBusinessWorkflowTypes,
  AuditEntityTypes,
  AuditGovernanceActions,
} from './constants/audit-actions.constant';
import { ApprovalHandlerBase } from '../governance/approvals/approval-handler.base';
import { ApprovalActionTypes } from '../governance/approvals/constants/approval.constants';

@Injectable()
export class AuditEvidenceExportApprovalService extends ApprovalHandlerBase {
  readonly actionType = ApprovalActionTypes.AUDIT_EVIDENCE_EXPORT_APPROVAL;
  readonly workflowType = AuditBusinessWorkflowTypes.AUDIT_EVIDENCE_EXPORT;
  readonly auditActions = {
    granted: AuditGovernanceActions.AUDIT_EVIDENCE_EXPORT.APPROVAL_GRANTED,
    declined: AuditGovernanceActions.AUDIT_EVIDENCE_EXPORT.APPROVAL_DECLINED,
    cancelled: AuditGovernanceActions.AUDIT_EVIDENCE_EXPORT.APPROVAL_CANCELLED,
  };
  readonly entityType = AuditEntityTypes.AUDIT_EVIDENCE_PACKAGE;

  constructor(auditLogsService: AuditLogsService, eventEmitter: EventEmitter2) {
    super(auditLogsService, eventEmitter);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/audit-logging/audit-evidence-export-approval.service.ts
git commit -m "feat(audit): add thin C5 approval handler extending ApprovalHandlerBase"
```

---

### Task 3: Create Layer 3 Workflow Orchestrator

**Files:**
- Create: `src/modules/audit-logging/audit-evidence-export-workflow.service.ts`

- [ ] **Step 1: Create workflow service**

```typescript
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
  AuditSubjectRole,
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

  private buildApprovalRelatedSubjects(
    packageId: string,
    packageNo: string,
    approvalId?: string | null,
    approvalNo?: string | null,
  ) {
    const subjects: Array<{ subjectRole: string; subjectType: string; subjectId?: string; subjectNo: string }> = [];
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
        subjectNos: this.buildApprovalRelatedSubjects(
          evidencePackage.id,
          evidencePackage.packageNo,
          submitted.id,
          submitted.approvalNo || null,
        ),
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
        subjectNos: this.buildApprovalRelatedSubjects(
          found.id,
          found.packageNo,
          found.approvalCaseId,
          this.normalizeOptionalString(found.approvalCase?.approvalNo),
        ),
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
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd Exchange_js && npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No errors from new file

- [ ] **Step 3: Commit**

```bash
git add src/modules/audit-logging/audit-evidence-export-workflow.service.ts
git commit -m "feat(audit): add C5 workflow orchestrator (Layer 3)"
```

---

### Task 4: Create PRD-Compliant Controller

**Files:**
- Create: `src/modules/audit-logging/audit-evidence-package.controller.ts`

- [ ] **Step 1: Create the controller**

```typescript
import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AdminPermissionGuard } from 'src/modules/identity/access-control/admin-permission.guard';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApprovalActorContext } from '../governance/approvals/constants/approval.constants';
import { AuditEvidenceExportWorkflowService } from './audit-evidence-export-workflow.service';
import { AuditLogsService } from './audit-logs.service';
import { EvidencePackageQueryDto, ExportEvidencePackageDto } from './dto/audit-log.dto';

@ApiTags('Admin - Audit Evidence Packages')
@Controller('admin/audit/evidence-packages')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
@ApiBearerAuth()
export class AuditEvidencePackageController {
  constructor(
    private readonly workflowService: AuditEvidenceExportWorkflowService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  private ensureApprovalAdmin(req: any): ApprovalActorContext {
    if (req.user?.type !== 'ADMIN') {
      throw new ForbiddenException('Admin token required');
    }
    return {
      actorType: 'ADMIN',
      userId: String(req.user.userId || ''),
      userNo: req.user.userNo,
      role: req.user.role,
      roleCodes: Array.isArray(req.user.roleCodes) ? req.user.roleCodes : [],
    };
  }

  @Post()
  @ApiOperation({ summary: 'Request audit evidence package export (approval-gated)' })
  createExportRequest(
    @Req() req: any,
    @Body(new ValidationPipe({ transform: true })) body: ExportEvidencePackageDto,
  ) {
    return this.workflowService.createExportRequest(body, this.ensureApprovalAdmin(req));
  }

  @Get()
  @ApiOperation({ summary: 'List evidence packages' })
  findAll(
    @Req() req: any,
    @Query(new ValidationPipe({ transform: true })) query: EvidencePackageQueryDto,
  ) {
    this.ensureApprovalAdmin(req);
    return this.auditLogsService.findEvidencePackages(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get evidence package detail' })
  findOne(@Req() req: any, @Param('id') id: string) {
    this.ensureApprovalAdmin(req);
    return this.auditLogsService.findEvidencePackage(id);
  }

  @Get(':id/download')
  @ApiOperation({ summary: 'Download evidence package content' })
  download(@Req() req: any, @Param('id') id: string) {
    return this.workflowService.downloadEvidencePackage(id, this.ensureApprovalAdmin(req));
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/audit-logging/audit-evidence-package.controller.ts
git commit -m "feat(audit): add PRD-compliant evidence package controller"
```

---

### Task 5: Update Module Registrations

**Files:**
- Modify: `src/modules/audit-logging/audit-logs.module.ts`
- Modify: `src/modules/governance/approvals/approvals.module.ts`

- [ ] **Step 1: Rewrite audit-logs.module.ts**

```typescript
import { Global, Module } from '@nestjs/common';
import { AuditLogsService } from './audit-logs.service';
import { AuditLogsController } from './audit-logs.controller';
import { AuditEvidenceExportApprovalService } from './audit-evidence-export-approval.service';
import { AuditEvidenceExportWorkflowService } from './audit-evidence-export-workflow.service';
import { AuditEvidencePackageController } from './audit-evidence-package.controller';

@Global()
@Module({
  providers: [
    AuditLogsService,
    AuditEvidenceExportApprovalService,
    AuditEvidenceExportWorkflowService,
  ],
  controllers: [AuditLogsController, AuditEvidencePackageController],
  exports: [AuditLogsService, AuditEvidenceExportWorkflowService],
})
export class AuditLogsModule {}
```

- [ ] **Step 2: Remove C5 service from approvals.module.ts**

Remove `AuditEvidenceExportApprovalService` from providers and exports arrays. Remove its import statement.

The module should look like:

```typescript
@Module({
  imports: [
    PrismaModule,
    forwardRef(() => ChangeTicketsModule),
    forwardRef(() => DeleteRequestsModule),
  ],
  controllers: [ApprovalsController],
  providers: [
    ApprovalsService,
    ApprovalPolicyService,
  ],
  exports: [ApprovalsService],
})
export class ApprovalsModule {}
```

- [ ] **Step 3: Commit**

```bash
git add src/modules/audit-logging/audit-logs.module.ts src/modules/governance/approvals/approvals.module.ts
git commit -m "refactor(modules): move C5 services to audit-logging module"
```

---

### Task 6: Remove Old Evidence Routes from AuditLogsController

**Files:**
- Modify: `src/modules/audit-logging/audit-logs.controller.ts`

- [ ] **Step 1: Remove evidence package routes and imports**

Remove from the controller:
1. The `AuditEvidenceExportApprovalService` import and constructor injection
2. The `ensureApprovalAdmin` helper method
3. These 4 route handlers:
   - `@Get('evidence-packages')` — `findEvidencePackages`
   - `@Get('evidence-packages/:id')` — `findEvidencePackage`
   - `@Get('evidence-packages/:id/download')` — `downloadEvidencePackage`
   - `@Post('export/evidence-package')` — `createEvidencePackageExportRequest`

The resulting controller should only have:
- `@Post()` — `create` (manual audit log)
- `@Get()` — `findAll` (list audit logs)
- `@Get(':id')` — `findOne` (get audit log detail)

- [ ] **Step 2: Verify the controller compiles**

Run: `cd Exchange_js && npx tsc --noEmit --pretty 2>&1 | grep -i "audit-logs.controller" | head -5`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/modules/audit-logging/audit-logs.controller.ts
git commit -m "refactor(audit): remove migrated evidence routes from AuditLogsController"
```

---

### Task 7: Delete Old Governance Files

**Files:**
- Delete: `src/modules/governance/approvals/audit-evidence-export-approval.service.ts`
- Delete: `src/modules/governance/approvals/audit-evidence-export-approval.service.spec.ts`

- [ ] **Step 1: Delete old files**

```bash
rm src/modules/governance/approvals/audit-evidence-export-approval.service.ts
rm src/modules/governance/approvals/audit-evidence-export-approval.service.spec.ts
```

- [ ] **Step 2: Verify no broken imports**

Run: `cd Exchange_js && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors (all references to old file should be gone after Task 5 and Task 6)

- [ ] **Step 3: Commit**

```bash
git add -A src/modules/governance/approvals/audit-evidence-export-approval.service.ts src/modules/governance/approvals/audit-evidence-export-approval.service.spec.ts
git commit -m "refactor(governance): remove replaced C5 monolithic service"
```

---

### Task 8: Write Workflow Unit Tests

**Files:**
- Create: `src/modules/audit-logging/audit-evidence-export-workflow.service.spec.ts`

- [ ] **Step 1: Write the test file**

```typescript
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AuditEvidenceExportWorkflowService } from './audit-evidence-export-workflow.service';
import { ApprovalDecidedEvent } from '../governance/approvals/approval-handler.base';

describe('AuditEvidenceExportWorkflowService', () => {
  let auditLogsService: any;
  let approvalsService: any;
  let service: AuditEvidenceExportWorkflowService;

  const actor = {
    actorType: 'ADMIN' as const,
    userId: 'admin-1',
    userNo: 'USR-1',
    role: 'COMPLIANCE_OFFICER',
    roleCodes: ['COMPLIANCE_OFFICER'],
  };

  beforeEach(() => {
    auditLogsService = {
      prepareEvidenceExportSelection: jest.fn(),
      createEvidencePackageRecord: jest.fn(),
      linkEvidencePackageApproval: jest.fn().mockResolvedValue(undefined),
      findEvidencePackage: jest.fn(),
      findEvidencePackageForApproval: jest.fn(),
      downloadEvidencePackage: jest.fn(),
      buildEvidencePackageArtifacts: jest.fn(),
      finalizeEvidencePackage: jest.fn().mockResolvedValue(undefined),
      markEvidencePackageFailed: jest.fn().mockResolvedValue(undefined),
      bulkMarkEvidencePackagesStatus: jest.fn().mockResolvedValue(undefined),
      recordByActor: jest.fn().mockResolvedValue(undefined),
    };

    approvalsService = {
      createAndSubmit: jest.fn(),
      requireApproved: jest.fn().mockResolvedValue(undefined),
      markExecutionResult: jest.fn().mockResolvedValue(undefined),
    };

    service = new AuditEvidenceExportWorkflowService(auditLogsService, approvalsService);
  });

  describe('createExportRequest', () => {
    it('creates package, submits approval, links, and writes EXPORT_REQUESTED audit', async () => {
      auditLogsService.prepareEvidenceExportSelection.mockResolvedValue({
        normalizedCriteria: { mode: 'SELECTION' },
        filterSnapshot: { workflowType: 'DEPOSIT' },
        selectedEventIds: ['log-1'],
        records: [],
        itemCount: 1,
        workflowSummary: { workflowType: 'DEPOSIT', workflowNos: ['DEP-1'] },
      });
      auditLogsService.createEvidencePackageRecord.mockResolvedValue({
        id: 'pkg-1',
        packageNo: 'EVP-1',
        exportMode: 'SELECTION',
      });
      approvalsService.createAndSubmit.mockResolvedValue({
        id: 'approval-1',
        approvalNo: 'APR2603140001',
        status: 'PENDING',
        traceId: 'trace-1',
      });
      auditLogsService.findEvidencePackage.mockResolvedValue({
        id: 'pkg-1',
        packageNo: 'EVP-1',
        status: 'PENDING_APPROVAL',
        approvalCaseId: 'approval-1',
      });

      const result = await service.createExportRequest({ selectedEventIds: ['log-1'], traceId: 'trace-1' } as any, actor);

      expect(result.status).toBe('PENDING_APPROVAL');
      expect(approvalsService.createAndSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          actionType: 'AUDIT_EVIDENCE_EXPORT_APPROVAL',
          entityRef: 'pkg-1',
          workflowType: 'AUDIT_EVIDENCE_EXPORT',
        }),
        expect.objectContaining({ traceId: 'trace-1' }),
        actor,
      );
      expect(auditLogsService.linkEvidencePackageApproval).toHaveBeenCalledWith('pkg-1', 'approval-1', 'APR2603140001');
      expect(auditLogsService.recordByActor).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'EXPORT_REQUESTED',
          workflowType: 'AUDIT_EVIDENCE_EXPORT',
        }),
        expect.objectContaining({ actorId: 'admin-1' }),
      );
    });
  });

  describe('downloadEvidencePackage', () => {
    it('gates on approval, downloads, and writes PACKAGE_DOWNLOADED audit', async () => {
      auditLogsService.findEvidencePackage.mockResolvedValue({
        id: 'pkg-1',
        packageNo: 'EVP-1',
        approvalCaseId: 'approval-1',
        status: 'READY',
        approvalCase: { approvalNo: 'APR-1', traceId: 'trace-1' },
      });
      auditLogsService.downloadEvidencePackage.mockResolvedValue({ id: 'pkg-1', packageNo: 'EVP-1' });

      const result = await service.downloadEvidencePackage('pkg-1', actor);

      expect(approvalsService.requireApproved).toHaveBeenCalledWith(
        expect.objectContaining({ approvalCaseId: 'approval-1', entityRef: 'pkg-1' }),
      );
      expect(auditLogsService.recordByActor).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'PACKAGE_DOWNLOADED' }),
        expect.any(Object),
      );
      expect(result.packageNo).toBe('EVP-1');
    });

    it('throws when package status is not READY', async () => {
      auditLogsService.findEvidencePackage.mockResolvedValue({
        id: 'pkg-1',
        packageNo: 'EVP-1',
        approvalCaseId: 'approval-1',
        status: 'PENDING_APPROVAL',
        approvalCase: { traceId: 'trace-1' },
      });

      await expect(service.downloadEvidencePackage('pkg-1', actor)).rejects.toThrow(BadRequestException);
    });
  });

  describe('handleApprovalDecided', () => {
    const baseEvent: ApprovalDecidedEvent = {
      decision: 'APPROVED',
      actionType: 'AUDIT_EVIDENCE_EXPORT_APPROVAL',
      entityRef: 'pkg-1',
      approvalId: 'approval-1',
      approvalNo: 'APR-1',
      traceId: 'trace-1',
      workflowType: 'AUDIT_EVIDENCE_EXPORT',
      decisionByUserId: 'checker-1',
      decisionByUserNo: 'USR-CHECKER',
      decisionByRole: 'DPO',
      decidedAt: '2026-03-14T10:00:00.000Z',
      metadata: {},
    };

    it('generates package on APPROVED and writes GENERATION_COMPLETED', async () => {
      auditLogsService.findEvidencePackageForApproval.mockResolvedValue({
        id: 'pkg-1',
        packageNo: 'EVP-1',
        status: 'PENDING_APPROVAL',
        exportedById: 'admin-1',
        exportedByNo: 'USR-1',
        exportedByRole: 'COMPLIANCE_OFFICER',
        filterSnapshot: JSON.stringify({ includeRecords: true }),
        selectedEventIdsSnapshot: JSON.stringify(['log-1']),
      });
      auditLogsService.buildEvidencePackageArtifacts.mockResolvedValue({
        generatedAt: '2026-03-14T10:00:00.000Z',
        itemCount: 1,
        manifest: { version: '1.0' },
        digest: 'd'.repeat(64),
        packageBody: { manifest: {}, records: [], digest: 'd'.repeat(64) },
      });

      await service.handleApprovalDecided(baseEvent);

      expect(auditLogsService.finalizeEvidencePackage).toHaveBeenCalledWith(
        'pkg-1',
        expect.objectContaining({ status: 'READY', digest: 'd'.repeat(64) }),
      );
      expect(auditLogsService.recordByActor).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'GENERATION_COMPLETED' }),
        expect.any(Object),
      );
      expect(approvalsService.markExecutionResult).toHaveBeenCalledWith('approval-1', true, expect.any(Object), expect.any(String));
    });

    it('marks FAILED on generation error and writes GENERATION_FAILED', async () => {
      auditLogsService.findEvidencePackageForApproval.mockResolvedValue({
        id: 'pkg-1',
        packageNo: 'EVP-1',
        status: 'PENDING_APPROVAL',
        exportedById: 'admin-1',
        exportedByRole: 'COMPLIANCE_OFFICER',
        filterSnapshot: JSON.stringify({}),
        selectedEventIdsSnapshot: JSON.stringify(['log-1']),
      });
      auditLogsService.buildEvidencePackageArtifacts.mockRejectedValue(new Error('generation failed'));

      await service.handleApprovalDecided(baseEvent);

      expect(auditLogsService.markEvidencePackageFailed).toHaveBeenCalledWith('pkg-1');
      expect(approvalsService.markExecutionResult).toHaveBeenCalledWith('approval-1', false, expect.any(Object), 'generation failed');
    });

    it('bulk marks REJECTED on DECLINED', async () => {
      await service.handleApprovalDecided({ ...baseEvent, decision: 'DECLINED' });
      expect(auditLogsService.bulkMarkEvidencePackagesStatus).toHaveBeenCalledWith('approval-1', 'pkg-1', 'REJECTED');
    });

    it('bulk marks CANCELLED on CANCELLED', async () => {
      await service.handleApprovalDecided({ ...baseEvent, decision: 'CANCELLED' });
      expect(auditLogsService.bulkMarkEvidencePackagesStatus).toHaveBeenCalledWith('approval-1', 'pkg-1', 'CANCELLED');
    });

    it('bulk marks EXPIRED on EXPIRED', async () => {
      await service.handleApprovalDecided({ ...baseEvent, decision: 'EXPIRED' });
      expect(auditLogsService.bulkMarkEvidencePackagesStatus).toHaveBeenCalledWith('approval-1', 'pkg-1', 'EXPIRED');
    });
  });
});
```

- [ ] **Step 2: Run tests**

Run: `cd Exchange_js && npx jest --testPathPattern="audit-evidence-export-workflow" --no-coverage`
Expected: All 7 tests pass

- [ ] **Step 3: Commit**

```bash
git add src/modules/audit-logging/audit-evidence-export-workflow.service.spec.ts
git commit -m "test(audit): add unit tests for C5 workflow orchestrator"
```

---

### Task 9: Final Verification

- [ ] **Step 1: Run full TypeScript check**

Run: `cd Exchange_js && npx tsc --noEmit --pretty`
Expected: No errors

- [ ] **Step 2: Run related test suites**

Run: `cd Exchange_js && npx jest --testPathPattern="audit" --no-coverage`
Expected: All audit-related tests pass

- [ ] **Step 3: Verify no import references to deleted file**

Run: `grep -r "governance/approvals/audit-evidence-export-approval" src/ --include="*.ts" | grep -v "node_modules"`
Expected: No results (all references removed)

- [ ] **Step 4: Final commit (if any fixups needed)**

```bash
git add -A && git commit -m "fix(audit): resolve any remaining type issues from C5 refactor"
```
