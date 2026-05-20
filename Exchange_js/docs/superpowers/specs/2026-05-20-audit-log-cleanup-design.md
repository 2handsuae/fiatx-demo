# Audit Log Cleanup — SubjectNo Deletion + Approval Entity Fix

## Goal

Remove the redundant `AuditLogSubjectNo` table and fix the audit entity inconsistency in approval-handler workflows, so that each audit event's entity accurately reflects its direct object.

## Two changes

### Change 1: Delete AuditLogSubjectNo table

The `AuditLogSubjectNo` table stores ACTOR/ENTITY/OWNER/RELATED rows per audit event. ACTOR, ENTITY, and OWNER rows duplicate fields already on `AuditLogEvent` (`actorNo`, `entityNo`, `entityOwnerNo`). RELATED rows enable cross-entity search (e.g., find all events related to a specific payin), but this is already navigable through `traceId` and domain model relationships.

**Delete:**
- Prisma model `AuditLogSubjectNo` + the `subjectNos` relation on `AuditLogEvent`
- `src/modules/audit-logging/utils/audit-subject-no.util.ts` (entire file)
- From `audit-logs.service.ts`: `buildSubjectNos()`, `mergeSubjectNos()`, `buildRelatedSubjectNo()`, `derivePrimaryRefNo()`, `canOperateAuditLogSubjectNo()`, all `includeSubjectNos` logic, all `subjectNos` creation in `recordByActor`/`recordSystem`
- From `audit-log.dto.ts`: `AuditSubjectRole` enum, `AuditSubjectNoDto`, `AuditLogSubjectNoView`, `subjectNos` field on `AuditLogView`
- From 7 workflow services: all `subjectNos` arrays passed to `recordByActor`, and the `AuditSubjectRole` imports
- From frontend `AuditLogDetailPage.tsx`: the "Subject Anchors" display section
- From frontend `AuditLogsPage.tsx`: the `AuditSubjectNo` interface
- DB migration to drop the table

**Do NOT touch** `subjectNo` fields on other models (SlaTimer, RegulatoryGate, etc.) — those are domain fields unrelated to AuditLogSubjectNo.

**Backfill scripts** (`scripts/backfill-audit-log-events.ts`, `scripts/backfill-audit-log-nos.ts`): leave as-is. They are historical migration scripts; the table drop will make their SubjectNo logic inert.

### Change 2: Fix approval audit entity consistency

**Problem:** `approval-handler.base.ts` writes audit events (APPROVAL_GRANTED/DECLINED/CANCELLED/EXPIRED) with mixed entity fields: `entityType` = domain type (e.g., ACCESS_CONTROL), `entityNo` = approval number. The entity identity is incoherent.

Meanwhile, `approvals.service.ts` has `hasDedicatedAuditService()` that **skips** its own generic audit events (APPROVAL_SUBMITTED/APPROVED/REJECTED/CANCELLED) for 11 workflow types, deferring to the handler base. But the handler's entity fields are wrong, and the generic service's fields are correct (`entityType=APPROVAL_CASE, entityNo=approvalNo`).

Additionally, `expirePendingApprovalCase()` in `approvals.service.ts` writes APPROVAL_EXPIRED **unconditionally** (no `hasDedicatedAuditService` check), AND the handler base also writes its own EXPIRED event — creating **duplicate** EXPIRED audit entries for dedicated-service workflows.

**Fix:**

1. **Remove `hasDedicatedAuditService()`** from `approvals.service.ts` — let generic audit always fire. The generic audit uses correct entity fields: `entityType=APPROVAL_CASE, entityId=approval.id, entityNo=approvalNo`.

2. **Remove ALL audit logging from `approval-handler.base.ts`** — delete `handleApproved`, `handleRejected`, `handleCancelled`, `handleExpired` audit calls. Keep `emitDecidedEvent()` in each handler method — this is the bridge to workflow-specific execution.

3. **Remove `auditLogsService` dependency** from `ApprovalHandlerBase` constructor and all 16 subclasses.

4. **Remove `auditActions` and `entityType` abstract properties** from `ApprovalHandlerBase` — they're only used for audit, which is being removed.

5. **Remove corresponding audit action constants** from `AuditGovernanceActions` (APPROVAL_GRANTED, APPROVAL_DECLINED, APPROVAL_CANCELLED, APPROVAL_EXPIRED entries in each workflow's constant object).

**Result — role definition create workflow audit trail:**

| Event | entityType | entityNo | Source |
|-------|-----------|----------|--------|
| CREATE_REQUESTED | ACCESS_CONTROL | roleCode | workflow service |
| APPROVAL_SUBMITTED | APPROVAL_CASE | approvalNo | approvals.service |
| APPROVAL_APPROVED | APPROVAL_CASE | approvalNo | approvals.service |
| ROLE_ACTIVATED | ACCESS_CONTROL | roleCode | workflow service |

Each event's entity = its direct object. `traceId` links the full chain.

## Files affected

### Change 1 (SubjectNo deletion)

**Delete entirely:**
- `src/modules/audit-logging/utils/audit-subject-no.util.ts`

**Schema:**
- `prisma/schema.prisma` — remove `AuditLogSubjectNo` model, remove `subjectNos` relation on `AuditLogEvent`

**Audit core:**
- `src/modules/audit-logging/audit-logs.service.ts` — remove 6 methods/helpers, all SubjectNo creation logic in `recordByActor`/`recordSystem`, keyword search on `subjectNos.some.subjectNo` in `buildWhere`
- `src/modules/audit-logging/dto/audit-log.dto.ts` — remove `AuditSubjectRole`, `AuditSubjectNoDto`, `AuditLogSubjectNoView`, `subjectNos` field on view

**Workflow services (remove `subjectNos` arrays + `AuditSubjectRole` imports):**
- `src/modules/identity/access-control/role-definition-create-workflow.service.ts`
- `src/modules/identity/access-control/role-definition-modify-workflow.service.ts`
- `src/modules/identity/onboarding/workflow-transition.service.ts`
- `src/modules/identity/onboarding/onboarding-workflow-transition.service.ts`
- `src/modules/asset-treasury/wallets/custodian-wallet-create-workflow.service.ts`
- `src/modules/asset-treasury/withdrawal-addresses/withdrawal-address-workflow.service.ts`
- `src/modules/audit-logging/audit-evidence-export-workflow.service.ts`
- `src/modules/governance/sla-timers/sla-timers.service.ts`

**Frontend:**
- `admin-web/src/pages/AuditLogDetailPage.tsx` — remove "Subject Anchors" section
- `admin-web/src/pages/AuditLogsPage.tsx` — remove `AuditSubjectNo` interface

### Change 2 (Approval entity fix)

**Core approval files:**
- `src/modules/governance/approvals/approvals.service.ts` — delete `hasDedicatedAuditService()`, remove all `if (!this.hasDedicatedAuditService(...))` guards
- `src/modules/governance/approvals/approval-handler.base.ts` — remove audit calls, `auditLogsService` dep, `auditActions`/`entityType` abstracts

**16 handler subclasses (remove `auditLogsService` from constructor, remove `auditActions`/`entityType` properties):**
- `src/modules/audit-logging/audit-evidence-export-approval.service.ts`
- `src/modules/asset-treasury/wallets/custodian-wallet-create-approval.service.ts`
- `src/modules/asset-treasury/assets/asset-activation-approval.service.ts`
- `src/modules/asset-treasury/assets/asset-reactivation-approval.service.ts`
- `src/modules/asset-treasury/assets/asset-suspension-approval.service.ts`
- `src/modules/identity/users/admin-mfa-reset-approval.service.ts`
- `src/modules/identity/users/admin-suspension-approval.service.ts`
- `src/modules/identity/users/admin-password-reset-approval.service.ts`
- `src/modules/identity/users/admin-role-binding-change-approval.service.ts`
- `src/modules/identity/users/admin-invite-approval.service.ts`
- `src/modules/identity/users/admin-reactivation-approval.service.ts`
- `src/modules/identity/access-control/role-definition-modify-approval.service.ts`
- `src/modules/identity/access-control/role-definition-create-approval.service.ts`
- `src/modules/governance/transaction-limits/transaction-limit-creation-approval.service.ts`
- `src/modules/governance/transaction-limits/transaction-limit-change-approval.service.ts`
- `src/modules/governance/approvals/approval-policy-change-approval.service.ts`

**Audit action constants:**
- `src/modules/audit-logging/constants/audit-actions.constant.ts` — remove APPROVAL_GRANTED/DECLINED/CANCELLED/EXPIRED from each workflow's `AuditGovernanceActions` entries

### Migration

- New Prisma migration to drop `audit_log_subject_nos` table
- `npm run dev:rebuild`

## What stays

- `entityOwnerType`, `entityOwnerId`, `entityOwnerNo` on AuditLogEvent — owner fields serve customer-scoped querying; only a subset of events use them but the use case is valid
- `entityId` on AuditLogEvent — used for internal entity lookups in audit service
- `workflowType` on AuditLogEvent — independent dimension from `action`, actively used for filtering
- `ApprovalDecidedEvent` interface on handler base — still needed for workflow event emission
- All `subjectNo` fields on domain models (SlaTimer, RegulatoryGate, etc.) — unrelated to AuditLogSubjectNo

## Testing

- `npx tsc --noEmit` — compilation
- `npm run dev:rebuild` — DB rebuild
- Existing test files: `sla-timers.service.spec.ts` — may reference `subjectNos` in mocks, update accordingly
- Manual: create an approval workflow, verify audit log shows correct entity for each step
