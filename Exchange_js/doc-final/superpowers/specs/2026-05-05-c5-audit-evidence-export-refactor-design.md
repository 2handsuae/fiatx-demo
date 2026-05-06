# C5 Audit Evidence Export — 3-Layer Workflow Refactoring Design

## Problem

`AuditEvidenceExportApprovalService` (555 lines) violates platform architecture:
- Rule #5: 9 direct `this.prisma.auditEvidencePackage.*` calls bypass domain service
- Layer violation: single file acts as both approval handler (Layer 2) AND workflow orchestrator (Layer 3)
- Rule #2: `createExportRequest()` has multi-table writes without transaction coordination
- Dead import: `AuditModules` imported unused
- Spec tests: 3 action assertions use legacy constant values

The AdminInvite workflow (delivered) demonstrates the correct pattern:
- Layer 2: 27-line thin handler extending `ApprovalHandlerBase`
- Layer 3: separate workflow service subscribing to secondary "decided" event

## Design

### Architecture

```
Controller (HTTP)
    │
    ▼
Layer 3: AuditEvidenceExportWorkflowService
    │ calls domain methods         subscribes to decided event
    ▼                                       ▲
Layer 1: AuditLogsService          Layer 2: AuditEvidenceExportApprovalService
(domain: evidence package CRUD)    (thin: extends ApprovalHandlerBase)
                                   writes approval audit + emits decided event
```

### Layer 1 — Domain Service: `AuditLogsService`

Already owns `auditEvidencePackage` entity. New methods added:

```typescript
findEvidencePackageForApproval(approvalId: string, entityRef?: string | null): Promise<any | null>
linkEvidencePackageApproval(packageId: string, approvalCaseId: string, approvalCaseNo: string | null): Promise<void>
finalizeEvidencePackage(packageId: string, data: { status, fileName, digest, manifest, packageBody }): Promise<void>
markEvidencePackageFailed(packageId: string): Promise<void>
bulkMarkEvidencePackagesStatus(approvalId: string, entityRef: string | null | undefined, status: AuditEvidencePackageStatus): Promise<void>
```

Existing methods reused: `createEvidencePackageRecord`, `prepareEvidenceExportSelection`, `buildEvidencePackageArtifacts`, `findEvidencePackage`, `downloadEvidencePackage`.

### Layer 2 — Approval Handler

File: `src/modules/audit-logging/audit-evidence-export-approval.service.ts`

```typescript
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

Base class automatically:
- Listens to `ApprovalEvents.APPROVED/REJECTED/CANCELLED/EXPIRED`
- Filters by `actionType`
- Writes audit log with `{ approvalId, approvalNo }` metadata
- Emits `workflow.audit-evidence-export.decided` with `ApprovalDecidedEvent` payload

### Layer 3 — Workflow Orchestrator

File: `src/modules/audit-logging/audit-evidence-export-workflow.service.ts`

**Dependencies:** `AuditLogsService`, `ApprovalsService`

**Public methods:**

| Method | Trigger | Audit Log Written |
|--------|---------|-------------------|
| `createExportRequest(query, actor)` | Controller POST | `EXPORT_REQUESTED` |
| `downloadEvidencePackage(id, actor)` | Controller GET download | `PACKAGE_DOWNLOADED` |

**Event handler:**

```typescript
@OnEvent('workflow.audit-evidence-export.decided', { async: true })
async handleApprovalDecided(event: ApprovalDecidedEvent) {
  switch (event.decision) {
    case 'APPROVED': return this.executePackageGeneration(event);
    case 'DECLINED':
    case 'CANCELLED':
    case 'EXPIRED': return this.executePackageTermination(event);
  }
}
```

| Internal method | Action | Audit Log |
|----------------|--------|-----------|
| `executePackageGeneration(event)` | Build artifacts, finalize package | `GENERATION_COMPLETED` or `GENERATION_FAILED` |
| `executePackageTermination(event)` | Bulk mark REJECTED/CANCELLED/EXPIRED | (none — governance log from Layer 2 suffices) |

**`createExportRequest` flow:**
1. `auditLogsService.prepareEvidenceExportSelection(query)` — validate + resolve selection
2. `auditLogsService.createEvidencePackageRecord(data)` — create package with PENDING_APPROVAL
3. `approvalsService.createAndSubmit(...)` — create + submit approval case
4. `auditLogsService.linkEvidencePackageApproval(packageId, approvalId, approvalNo)` — bind
5. `auditLogsService.recordByActor(EXPORT_REQUESTED, ...)` — audit trail
6. Return `auditLogsService.findEvidencePackage(packageId)`

**`downloadEvidencePackage` flow:**
1. `auditLogsService.findEvidencePackage(id)` — load package
2. `approvalsService.requireApproved(...)` — gate check
3. Validate status is READY
4. `auditLogsService.downloadEvidencePackage(id)` — fetch content
5. `auditLogsService.recordByActor(PACKAGE_DOWNLOADED, ...)` — audit trail

**`executePackageGeneration` flow:**
1. `auditLogsService.findEvidencePackageForApproval(approvalId, entityRef)` — load
2. `auditLogsService.buildEvidencePackageArtifacts(query, exporter, approvalSummary)` — generate
3. `auditLogsService.finalizeEvidencePackage(id, { status: READY, ... })` — persist
4. `auditLogsService.recordByActor(GENERATION_COMPLETED, ...)` — audit
5. `approvalsService.markExecutionResult(approvalId, true, ...)` — mark executed
6. On error: `markEvidencePackageFailed(id)` + `recordByActor(GENERATION_FAILED)` + `markExecutionResult(false)`

### Controller

File: `src/modules/audit-logging/audit-evidence-package.controller.ts`

```typescript
@Controller('admin/audit/evidence-packages')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
```

| Method | Route | Handler |
|--------|-------|---------|
| POST | `/` | `workflowService.createExportRequest(body, actor)` |
| GET | `/` | `auditLogsService.findEvidencePackages(query)` |
| GET | `/:id` | `auditLogsService.findEvidencePackage(id)` |
| GET | `/:id/download` | `workflowService.downloadEvidencePackage(id, actor)` |

### Module Registration

`audit-logs.module.ts`:
```typescript
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

`approvals.module.ts`: Remove `AuditEvidenceExportApprovalService` from providers and exports.

### Existing Controller Cleanup

`audit-logs.controller.ts`: Remove these routes (moved to new controller):
- `GET /evidence-packages`
- `GET /evidence-packages/:id`
- `GET /evidence-packages/:id/download`
- `POST /export/evidence-package`

### Audit Log Responsibility Matrix

| Action Constant | Layer | Writer | metadata |
|----------------|-------|--------|----------|
| `EXPORT_REQUESTED` | 3 | Workflow | `{ dateRangeFrom, dateRangeTo, itemCount }` |
| `APPROVAL_GRANTED` | 2 | Base class | `{ approvalId, approvalNo }` |
| `APPROVAL_DECLINED` | 2 | Base class | `{ approvalId, approvalNo, decisionReason }` |
| `APPROVAL_CANCELLED` | 2 | Base class | `{ approvalId, approvalNo }` |
| `GENERATION_COMPLETED` | 3 | Workflow | `{ fileSize, fileCount }` |
| `GENERATION_FAILED` | 3 | Workflow | `{ failureReason }` |
| `PACKAGE_DOWNLOADED` | 3 | Workflow | (none) |

### Test Strategy

Rewrite `audit-evidence-export-approval.service.spec.ts` → rename to test the workflow:
- Mock: `AuditLogsService` (all domain methods), `ApprovalsService`
- No `PrismaService` mock needed (workflow has no direct Prisma)
- Test cases: createExportRequest, downloadEvidencePackage, handleApprovalDecided (APPROVED success/fail, DECLINED, CANCELLED, EXPIRED)
- Verify correct audit action strings (`AuditGovernanceActions.AUDIT_EVIDENCE_EXPORT.*`)

### Non-Goals

- No changes to `ApprovalsService` internals or its transaction handling
- No changes to `ApprovalHandlerBase`
- No backward-compatible route aliases
- No new database migrations
