# Audit Evidence Package

Wave: 1 | Source verified: prisma/schema.prisma, src/modules/audit-logging/audit-logs.service.ts, src/modules/audit-logging/audit-logs.controller.ts, src/modules/governance/approvals/audit-evidence-export-approval.service.ts, src/modules/audit-logging/dto/audit-log.dto.ts
Last Updated: 2026-04-21

## Prisma Model: AuditEvidencePackage

Table: `audit_evidence_packages`
Business Key: `packageNo` (format: generated via `generateReferenceNo`, unique)

### Fields

| Field | Type | Nullable | Notes |
|---|---|---|---|
| id | String (UUID) | No | Primary key |
| packageNo | String | No | Unique business key; default "TEMP" replaced on create |
| approvalCaseId | String | Yes | FK → ApprovalCase.id (SetNull on delete); unique — one package per approval |
| approvalCaseNo | String | Yes | Denormalized approval reference number |
| exportedByType | String | No | Actor type e.g. "ADMIN" |
| exportedById | String | No | Actor user ID |
| exportedByNo | String | Yes | Actor business number |
| exportedByRole | String | Yes | Role code of the exporting actor |
| status | String | No | Default "READY"; see Status Values below |
| exportMode | String | No | Default "SELECTION"; enum: SELECTION |
| fileName | String | Yes | Set to `<packageNo>.json` after approval triggers generation |
| filterSnapshot | String (JSON) | Yes | Serialized export filter criteria snapshot |
| selectedEventIdsSnapshot | String (JSON) | Yes | Serialized array of selected audit event IDs |
| itemCount | Int | No | Number of audit log events included |
| digest | String | No | SHA-256 hex digest of package content; computed by `sha256Hex()` |
| manifest | String (JSON) | No | Package manifest with version, generatedAt, phase, criteria, workflowSummary |
| packageBody | String (JSON) | Yes | Full export content; null until approval granted and generation completes |
| deletedAt | DateTime | Yes | Soft-delete timestamp |
| deletedBy | String | Yes | Actor who soft-deleted |
| deleteRequestId | String | Yes | Linked delete request ID |
| deleteReason | String | Yes | Reason for deletion |
| createdAt | DateTime | No | Auto |
| updatedAt | DateTime | No | Auto-updated |

### Relations

| Relation | Type | Notes |
|---|---|---|
| approvalCase | ApprovalCase (optional) | Via `approvalCaseId`; relation name "AuditEvidencePackageApprovalCase" |

### Indexes

- `createdAt`
- `(exportedByType, exportedById)`
- `(status, createdAt)`
- `(exportMode, createdAt)`
- `approvalCaseId`
- `approvalCaseNo`
- `deletedAt`

## Status / Enum Values

`AuditEvidencePackageStatus` (from `audit-log.dto.ts`):

| Value | Meaning |
|---|---|
| `PENDING_APPROVAL` | Created; awaiting checker approval |
| `READY` | Approval granted; package body generated; available for download |
| `FAILED` | Approval granted but artifact generation threw an error |
| `REJECTED` | Checker rejected the approval case |
| `CANCELLED` | Approval case was cancelled before decision |
| `EXPIRED` | Approval case expired (SLA timeout) |

`AuditEvidenceExportMode`:

| Value | Meaning |
|---|---|
| `SELECTION` | Caller provides explicit `selectedEventIds` list |

## Key Business Rules

- Every export request must pass a 4-eyes approval gate (`ApprovalActionTypes.AUDIT_EVIDENCE_EXPORT_APPROVAL`). The package is created in `PENDING_APPROVAL` status and bound to an `ApprovalCase` before any export content is generated.
- `packageBody` is only populated after the `ApprovalEvents.APPROVED` event fires. Generation is triggered via NestJS EventEmitter in `handleApprovedApproval()`.
- `digest` is a SHA-256 hex hash (`sha256Hex()`) computed over the final manifest+body object. Before approval the digest covers only the request manifest.
- Download (`GET evidence-packages/:id/download`) requires the linked `ApprovalCase` to be in APPROVED status; the method calls `approvalsService.requireApproved()` which throws if not approved.
- On `REJECTED`, `CANCELLED`, or `EXPIRED` approval events, the package status is updated via `updateMany` but no packageBody is generated.
- Soft-delete is supported via `deletedAt`/`deletedBy`/`deleteRequestId`/`deleteReason`; hard-delete is gated by a delete request governance workflow.
- `approvalCaseId` has a unique constraint — exactly one approval case per evidence package.
- `selectedEventIds` max 5000 items; `maxItems` max 5000.

## Service Methods (key operations)

- `createExportRequest(query, actor)` — prepares selection, creates package record (PENDING_APPROVAL), creates and submits ApprovalCase, writes audit log
- `downloadEvidencePackage(id, actor)` — verifies approval status, delegates to `auditLogsService.downloadEvidencePackage(id)`, writes download audit log
- `handleApprovedApproval(event)` — event listener (ApprovalEvents.APPROVED): builds artifacts, updates package to READY with fileName/digest/manifest/packageBody, marks execution result
- `handleRejectedApproval(event)` — sets status REJECTED
- `handleCancelledApproval(event)` — sets status CANCELLED
- `handleExpiredApproval(event)` — sets status EXPIRED
- `auditLogsService.createEvidencePackageRecord(data)` — raw DB insert
- `auditLogsService.findEvidencePackage(id)` — single package lookup with approvalCase include
- `auditLogsService.findEvidencePackages(query)` — paginated list
- `auditLogsService.buildEvidencePackageArtifacts(exportQuery, actor, approvalSummary)` — constructs manifest + packageBody + digest
- `auditLogsService.prepareEvidenceExportSelection(query)` — resolves event IDs, builds normalized criteria and workflowSummary

## API Endpoints

| Method | Path | Permission Group | Description |
|---|---|---|---|
| POST | /admin/audit-logs/export/evidence-package | AUDIT_EXPORT_CREATE | Create export request; triggers approval flow |
| GET | /admin/audit-logs/evidence-packages | AUDIT_EXPORT_READ | List evidence package records (paginated, filterable by status) |
| GET | /admin/audit-logs/evidence-packages/:id | AUDIT_EXPORT_READ | Get single evidence package detail |
| GET | /admin/audit-logs/evidence-packages/:id/download | AUDIT_EXPORT_READ | Download package body; blocked until status=READY and approval=APPROVED |
