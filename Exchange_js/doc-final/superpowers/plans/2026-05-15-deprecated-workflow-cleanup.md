# Deprecated Workflow Constants & Module Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove 6 deprecated `AuditBusinessWorkflowTypes` constants and the two upstream modules they belong to (DeleteRequests, ChangeTickets), plus the dead token-layer audit calls from the password reset workflow.

**Architecture:** Four atomic commits, each leaving TypeScript compilation clean. Constants, code, and DB migrations for each domain are removed in the same commit. business-config module is deprecated but out of scope — its CT references are intentionally left in place.

**Tech Stack:** NestJS, Prisma/SQLite, TypeScript

---

## File Map

### Task 1 — Delete Requests removal
| File | Action |
|---|---|
| `src/modules/audit-logging/constants/audit-actions.constant.ts` | Remove DR entries from `AuditWorkflowTypes`, `AuditBusinessWorkflowTypes`, `AuditGovernanceActions`, `DeleteRequestTargetTypes` |
| `src/modules/governance/approvals/constants/approval.constants.ts` | Remove `DELETE_REQUEST_APPROVAL` action type + policy block |
| `src/modules/governance/governance.module.ts` | Remove `DeleteRequestsModule` import/export |
| `src/modules/governance/approvals/approvals.module.ts` | Remove `DeleteRequestsModule` forwardRef |
| `src/modules/governance/approvals/approvals.service.ts` | Remove DR imports, DI injection, `resolveDeleteRequestWorkflowType()`, DR branches |
| `src/modules/audit-logging/audit-logs.service.ts` | Remove `DELETE_REQUEST` entity-type registry entry |
| `prisma/schema.prisma` | Remove `DeleteRequest` model + `deleteRequestApprovalCase` from `ApprovalCase` |
| `src/modules/governance/delete-requests/` | **Delete entire directory** |

### Task 2 — Change Tickets removal
| File | Action |
|---|---|
| `src/modules/audit-logging/constants/audit-actions.constant.ts` | Remove CT entries from `AuditWorkflowTypes`, `AuditBusinessWorkflowTypes`, `AuditGovernanceActions`, `ChangeTicketTypes` |
| `src/modules/governance/approvals/constants/approval.constants.ts` | Remove `CHANGE_TICKET_APPROVAL` action type + policy block |
| `src/modules/governance/governance.module.ts` | Remove `ChangeTicketsModule` import/export |
| `src/modules/governance/approvals/approvals.module.ts` | Remove `ChangeTicketsModule` forwardRef |
| `src/modules/governance/approvals/approvals.service.ts` | Remove CT imports, DI injection, `resolveChangeTicketWorkflowType()`, CT branches |
| `src/modules/governance/sla-timers/sla-timers.module.ts` | Remove `ChangeTicketSlaProjectionService` |
| `src/modules/audit-logging/audit-logs.service.ts` | Remove `CHANGE_TICKET` entity-type registry entry |
| `src/app.module.ts` | Remove `GovernedExecutionModule` import |
| `prisma/schema.prisma` | Remove `ChangeTicket`, `ChangeTicketGateRun` models + `changeTicketApprovalCase` from `ApprovalCase` |
| `src/modules/governance/change-tickets/` | **Delete entire directory** |
| `src/modules/governance/sla-timers/change-ticket-sla-projection.service.ts` | **Delete file** |
| `src/modules/identity/governed-execution/` | **Delete entire directory** (listener + module) |

### Task 3 — ADMIN_CREDENTIAL_MGMT removal
| File | Action |
|---|---|
| `src/modules/audit-logging/constants/audit-actions.constant.ts` | Remove `ADMIN_CREDENTIAL_MGMT` from `AuditWorkflowTypes` + `AuditBusinessWorkflowTypes` + `AuditGovernanceActions` block |
| `src/modules/identity/users/admin-password-reset-workflow.service.ts` | Remove 4 audit calls using `ADMIN_CREDENTIAL_MGMT` + `recordFailure()` method |

### Task 4 — Dead constants removal
| File | Action |
|---|---|
| `src/modules/audit-logging/constants/audit-actions.constant.ts` | Remove `ADMIN_ROLE_BINDING` + `ADMIN_ACCOUNT_DELETION` from both enums + GovernanceActions blocks |

---

## Task 1: Remove Delete Requests Module

**Files:**
- Modify: `src/modules/audit-logging/constants/audit-actions.constant.ts`
- Modify: `src/modules/governance/approvals/constants/approval.constants.ts`
- Modify: `src/modules/governance/governance.module.ts`
- Modify: `src/modules/governance/approvals/approvals.module.ts`
- Modify: `src/modules/governance/approvals/approvals.service.ts`
- Modify: `src/modules/audit-logging/audit-logs.service.ts`
- Modify: `prisma/schema.prisma`
- Delete: `src/modules/governance/delete-requests/`

- [ ] **Step 1: Remove DR entries from audit-actions.constant.ts**

In `src/modules/audit-logging/constants/audit-actions.constant.ts`, remove the following lines.

From `AuditWorkflowTypes` (the first enum, around line 46–48):
```
  DELETE_REQUEST: 'DELETE_REQUEST',
```

From `AuditWorkflowTypes` (second block, around line 113–114):
```
  DELETE_REQUEST: 'DELETE_REQUEST',
```

From `AuditBusinessWorkflowTypes` (around lines 135–141):
```
  CHANGE_TICKET_DELETION: 'CHANGE_TICKET_DELETION',
  ADMIN_USER_DELETION: 'ADMIN_USER_DELETION',
  AUDIT_EVIDENCE_PACKAGE_DELETION: 'AUDIT_EVIDENCE_PACKAGE_DELETION',
```

Remove `DeleteRequestTargetTypes` object entirely. Find it by searching for `DeleteRequestTargetTypes` — it is a standalone `export const` block, delete the whole object.

Remove `AUDIT_EVIDENCE_PACKAGE_DELETION` block from `AuditGovernanceActions`:
```typescript
  // D2 — Audit Evidence Package Deletion
  AUDIT_EVIDENCE_PACKAGE_DELETION: {
    DELETION_REQUESTED: 'DELETION_REQUESTED',
    APPROVAL_GRANTED:   'APPROVAL_GRANTED',
    APPROVAL_DECLINED:  'APPROVAL_DECLINED',
    APPROVAL_CANCELLED: 'APPROVAL_CANCELLED',
    PACKAGE_PURGED:     'PACKAGE_PURGED',
  },
```

- [ ] **Step 2: Remove DELETE_REQUEST_APPROVAL from approval.constants.ts**

In `src/modules/governance/approvals/constants/approval.constants.ts`:

Remove from `ApprovalActionTypes` object:
```
  DELETE_REQUEST_APPROVAL: 'DELETE_REQUEST_APPROVAL',
```

Also update the Wave 1 comment block at the top of the file — remove the line:
```
 *   DELETE_REQUEST_APPROVAL         — soft-delete gate
```

Remove the approval policy entry (approximately lines 214–221):
```typescript
  [ApprovalActionTypes.DELETE_REQUEST_APPROVAL]: {
    riskLevel: ApprovalRiskLevels.HIGH,
    steps: [{ stepNo: 1, roles: ['CISO'] }],
    timeoutHours: 24,
    allowCancel: true,
    allowRetry: true,
  },
```

- [ ] **Step 3: Remove DeleteRequestsModule from governance.module.ts**

In `src/modules/governance/governance.module.ts`:

Remove import:
```typescript
import { DeleteRequestsModule } from './delete-requests/delete-requests.module';
```

Remove from `imports[]` array:
```
    DeleteRequestsModule,
```

Remove from `exports[]` array:
```
    DeleteRequestsModule,
```

- [ ] **Step 4: Remove DeleteRequestsModule forwardRef from approvals.module.ts**

In `src/modules/governance/approvals/approvals.module.ts`:

Remove import and forwardRef reference:
```typescript
import { DeleteRequestsModule } from '../delete-requests/delete-requests.module';
```
and the corresponding entry:
```
    forwardRef(() => DeleteRequestsModule),
```

- [ ] **Step 5: Remove DR code from approvals.service.ts**

In `src/modules/governance/approvals/approvals.service.ts`:

Remove imports (lines 43–44):
```typescript
import { DeleteRequestsService } from '../delete-requests/delete-requests.service';
import { DeleteRequestTargetTypes } from '../delete-requests/constants/delete-request.constants';
```

Remove DI injection from constructor (lines 95–97):
```typescript
    @Optional()
    @Inject(forwardRef(() => DeleteRequestsService))
    private readonly deleteRequestsService?: DeleteRequestsService,
```

Remove `resolveDeleteRequestWorkflowType()` method entirely:
```typescript
  private resolveDeleteRequestWorkflowType(targetType: unknown): string {
    switch (this.normalizeOptionalString(targetType)?.toUpperCase()) {
      case DeleteRequestTargetTypes.CHANGE_TICKET:
        return AuditBusinessWorkflowTypes.CHANGE_TICKET_DELETION;
      case DeleteRequestTargetTypes.ADMIN_USER:
        return AuditBusinessWorkflowTypes.ADMIN_USER_DELETION;
      case DeleteRequestTargetTypes.AUDIT_EVIDENCE_PACKAGE:
        return AuditBusinessWorkflowTypes.AUDIT_EVIDENCE_PACKAGE_DELETION;
      default:
        return AuditWorkflowTypes.DELETE_REQUEST;
    }
  }
```

Remove the DR branch from `resolveParentWorkflowContext()`:
```typescript
    if (actionType === ApprovalActionTypes.DELETE_REQUEST_APPROVAL) {
      const request = await db.deleteRequest?.findFirst?.({
        where: {
          id: entityRef,
        },
        select: {
          id: true,
          requestNo: true,
          traceId: true,
          targetType: true,
        },
      });

      if (request) {
        return {
          workflowType: this.resolveDeleteRequestWorkflowType(request.targetType),
          workflowId: this.normalizeOptionalString(request.id),
          workflowNo: this.normalizeOptionalString(request.requestNo),
          traceId: this.normalizeOptionalString(request.traceId),
        };
      }
    }
```

Remove the DR branch from `projectGovernanceApprovalDecision()`:
```typescript
    if (
      approval.actionType === ApprovalActionTypes.DELETE_REQUEST_APPROVAL &&
      this.deleteRequestsService
    ) {
      await this.deleteRequestsService.syncApprovalProjectionByEvent(event);
    }
```

- [ ] **Step 6: Remove DELETE_REQUEST from audit-logs.service.ts entity registry**

In `src/modules/audit-logging/audit-logs.service.ts`, remove the line:
```typescript
      DELETE_REQUEST: { model: 'deleteRequest', field: 'requestNo' },
```

- [ ] **Step 7: Remove DeleteRequest from Prisma schema**

In `prisma/schema.prisma`:

Remove the entire `model DeleteRequest { ... }` block (lines ~922–955, search for `model DeleteRequest`).

Remove the reverse relation from the `ApprovalCase` model (line ~771):
```
  deleteRequestApprovalCase      DeleteRequest?                 @relation("DeleteRequestApprovalCase")
```

- [ ] **Step 8: Delete the delete-requests directory**

```bash
rm -rf src/modules/governance/delete-requests
```

- [ ] **Step 9: Generate and apply Prisma migration**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js
npx prisma migrate dev --name remove_delete_requests
```

Expected: Migration file created and applied. The `delete_requests` table is dropped.

- [ ] **Step 10: Verify TypeScript compiles clean**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js
npx tsc --noEmit
```

Expected: Zero errors.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "chore: remove DeleteRequests module, workflow constants, and DB table"
```

---

## Task 2: Remove Change Tickets Module

**Files:**
- Modify: `src/modules/audit-logging/constants/audit-actions.constant.ts`
- Modify: `src/modules/governance/approvals/constants/approval.constants.ts`
- Modify: `src/modules/governance/governance.module.ts`
- Modify: `src/modules/governance/approvals/approvals.module.ts`
- Modify: `src/modules/governance/approvals/approvals.service.ts`
- Modify: `src/modules/governance/sla-timers/sla-timers.module.ts`
- Modify: `src/modules/audit-logging/audit-logs.service.ts`
- Modify: `src/app.module.ts`
- Modify: `prisma/schema.prisma`
- Delete: `src/modules/governance/change-tickets/`
- Delete: `src/modules/governance/sla-timers/change-ticket-sla-projection.service.ts`
- Delete: `src/modules/identity/governed-execution/`

- [ ] **Step 1: Remove CT entries from audit-actions.constant.ts**

In `src/modules/audit-logging/constants/audit-actions.constant.ts`, remove:

From `AuditWorkflowTypes` (around line 46):
```
  CHANGE_TICKET: 'CHANGE_TICKET',
```

From `AuditWorkflowTypes` (second block, around line 113):
```
  CHANGE_TICKET: 'CHANGE_TICKET',
```

From `AuditBusinessWorkflowTypes`:
```
  ADMIN_MEMBER_PROVISIONING: 'ADMIN_MEMBER_PROVISIONING',
```

Remove `ChangeTicketTypes` exported constant object entirely — search for `export const ChangeTicketTypes` and delete the whole block.

The `ADMIN_ROLE_BINDING` and `ADMIN_ACCOUNT_DELETION` GovernanceActions blocks are handled in Task 4 — do NOT remove them here.

- [ ] **Step 2: Remove CHANGE_TICKET_APPROVAL from approval.constants.ts**

In `src/modules/governance/approvals/constants/approval.constants.ts`:

Remove from `ApprovalActionTypes`:
```
  CHANGE_TICKET_APPROVAL: 'CHANGE_TICKET_APPROVAL',
```

Remove from the comment block at the top:
```
 *   CHANGE_TICKET_APPROVAL          — admin access / RBAC change gate
```

Remove the approval policy block:
```typescript
  [ApprovalActionTypes.CHANGE_TICKET_APPROVAL]: {
    riskLevel: ApprovalRiskLevels.HIGH,
    steps: [{ stepNo: 1, roles: ['CISO'] }],
    timeoutHours: 24,
    allowCancel: true,
    allowRetry: true,
  },
```

- [ ] **Step 3: Remove ChangeTicketsModule from governance.module.ts**

In `src/modules/governance/governance.module.ts`:

Remove:
```typescript
import { ChangeTicketsModule } from './change-tickets/change-tickets.module';
```

Remove from `imports[]`:
```
    ChangeTicketsModule,
```

Remove from `exports[]`:
```
    ChangeTicketsModule,
```

- [ ] **Step 4: Remove ChangeTicketsModule forwardRef from approvals.module.ts**

In `src/modules/governance/approvals/approvals.module.ts`, remove:
```typescript
import { ChangeTicketsModule } from '../change-tickets/change-tickets.module';
```
and:
```
    forwardRef(() => ChangeTicketsModule),
```

- [ ] **Step 5: Remove CT code from approvals.service.ts**

In `src/modules/governance/approvals/approvals.service.ts`:

Remove imports (lines 29–30):
```typescript
import { ChangeTicketsService } from '../change-tickets/change-tickets.service';
import { ChangeTicketTypes } from '../change-tickets/constants/change-ticket.constants';
```

Remove DI injection from constructor:
```typescript
    @Optional()
    @Inject(forwardRef(() => ChangeTicketsService))
    private readonly changeTicketsService?: ChangeTicketsService,
```

Remove `resolveChangeTicketWorkflowType()` method:
```typescript
  private resolveChangeTicketWorkflowType(changeType: unknown): string {
    switch (this.normalizeOptionalString(changeType)?.toUpperCase()) {
      case ChangeTicketTypes.ADMIN_ACCESS_CHANGE:
        return AuditBusinessWorkflowTypes.ADMIN_MEMBER_PROVISIONING;
      case ChangeTicketTypes.RBAC_CATALOG_CHANGE:
        return AuditBusinessWorkflowTypes.ADMIN_ROLE_BINDING_CHANGE;
      case ChangeTicketTypes.BUSINESS_CONFIG_CHANGE:
        return AuditBusinessWorkflowTypes.BUSINESS_CONFIG_CHANGE;
      default:
        return AuditWorkflowTypes.CHANGE_TICKET;
    }
  }
```

Remove the CT branch from `resolveParentWorkflowContext()`:
```typescript
    if (actionType === ApprovalActionTypes.CHANGE_TICKET_APPROVAL) {
      const ticket = await db.changeTicket?.findFirst?.({
        where: {
          id: entityRef,
          deletedAt: null,
        },
        select: {
          id: true,
          ticketNo: true,
          traceId: true,
          changeType: true,
        },
      });

      if (ticket) {
        return {
          workflowType: this.resolveChangeTicketWorkflowType(ticket.changeType),
          workflowId: this.normalizeOptionalString(ticket.id),
          workflowNo: this.normalizeOptionalString(ticket.ticketNo),
          traceId: this.normalizeOptionalString(ticket.traceId),
        };
      }
    }
```

Remove the CT branch from `projectGovernanceApprovalDecision()`:
```typescript
    if (
      approval.actionType === ApprovalActionTypes.CHANGE_TICKET_APPROVAL &&
      this.changeTicketsService
    ) {
      await this.changeTicketsService.syncApprovalProjectionByEvent(event);
      return;
    }
```

- [ ] **Step 6: Remove ChangeTicketSlaProjectionService from sla-timers.module.ts**

In `src/modules/governance/sla-timers/sla-timers.module.ts`, remove:
```typescript
import { ChangeTicketSlaProjectionService } from './change-ticket-sla-projection.service';
```
Remove from `providers[]`:
```
    ChangeTicketSlaProjectionService,
```
If it appears in `exports[]`, remove it there too.

- [ ] **Step 7: Remove CHANGE_TICKET from audit-logs.service.ts entity registry**

In `src/modules/audit-logging/audit-logs.service.ts`, remove:
```typescript
      CHANGE_TICKET: { model: 'changeTicket', field: 'ticketNo' },
```

- [ ] **Step 8: Remove GovernedExecutionModule from app.module.ts**

In `src/app.module.ts`, remove the import:
```typescript
import { GovernedExecutionModule } from './modules/identity/governed-execution/governed-execution.module';
```
And remove `GovernedExecutionModule` from the `imports[]` array.

- [ ] **Step 9: Remove CT models from Prisma schema**

In `prisma/schema.prisma`:

Remove the entire `model ChangeTicket { ... }` block (search for `model ChangeTicket`).

Remove the entire `model ChangeTicketGateRun { ... }` block (search for `model ChangeTicketGateRun`).

Remove the reverse relation from `ApprovalCase` model:
```
  changeTicketApprovalCase       ChangeTicket?                  @relation("ChangeTicketApprovalCase")
```

- [ ] **Step 10: Delete CT directories and files**

```bash
rm -rf src/modules/governance/change-tickets
rm -f src/modules/governance/sla-timers/change-ticket-sla-projection.service.ts
rm -rf src/modules/identity/governed-execution
```

- [ ] **Step 11: Generate and apply Prisma migration**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js
npx prisma migrate dev --name remove_change_tickets
```

Expected: Migration file created. `change_ticket_gate_runs` and `change_tickets` tables are dropped (gate_runs first due to FK cascade dependency).

- [ ] **Step 12: Verify TypeScript compiles clean**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js
npx tsc --noEmit
```

Expected: Zero errors.

- [ ] **Step 13: Commit**

```bash
git add -A
git commit -m "chore: remove ChangeTickets module, workflow constants, and DB table"
```

---

## Task 3: Remove ADMIN_CREDENTIAL_MGMT Audit Calls

**Files:**
- Modify: `src/modules/audit-logging/constants/audit-actions.constant.ts`
- Modify: `src/modules/identity/users/admin-password-reset-workflow.service.ts`

- [ ] **Step 1: Remove ADMIN_CREDENTIAL_MGMT from audit-actions.constant.ts**

In `src/modules/audit-logging/constants/audit-actions.constant.ts`:

Remove from `AuditWorkflowTypes` (around line 129):
```
  // C3d — Admin Credential Management (MFA Reset, future: Password Reset, Session Revocation)
  ADMIN_CREDENTIAL_MGMT: 'ADMIN_CREDENTIAL_MGMT',
```

Remove from `AuditBusinessWorkflowTypes` (around line 152):
```
  // C3d — Admin Credential Management
  ADMIN_CREDENTIAL_MGMT: 'ADMIN_CREDENTIAL_MGMT',
```

Remove the entire `ADMIN_CREDENTIAL_MGMT` block from `AuditGovernanceActions`:
```typescript
  // C3d — Admin Credential Management
  ADMIN_CREDENTIAL_MGMT: {
    MFA_RESET_EXECUTED:        'CREDENTIAL_MFA_RESET_EXECUTED',
    // C5 — Admin Password Reset
    PASSWORD_RESET_REQUESTED: 'PASSWORD_RESET_REQUESTED',
    PASSWORD_RESET_COMPLETED: 'PASSWORD_RESET_COMPLETED',
    PASSWORD_RESET_FAILED:    'PASSWORD_RESET_FAILED',
    PASSWORD_RESET_REVOKED:   'PASSWORD_RESET_REVOKED',
  },
```

- [ ] **Step 2: Remove 4 ADMIN_CREDENTIAL_MGMT audit calls from admin-password-reset-workflow.service.ts**

In `src/modules/identity/users/admin-password-reset-workflow.service.ts`, inside `createResetToken()`:

Remove the REVOKED audit loop (the `for (const old of pendingTokens)` block that fires `PASSWORD_RESET_REVOKED`):
```typescript
    // Audit: revoked tokens
    for (const old of pendingTokens) {
      await this.auditLogsService.recordSystem({
        action: AuditGovernanceActions.ADMIN_CREDENTIAL_MGMT.PASSWORD_RESET_REVOKED,
        entityType: AuditEntityTypes.PASSWORD_RESET_TOKEN,
        entityId: old.id,
        entityNo: old.resetNo,
        workflowType: AuditBusinessWorkflowTypes.ADMIN_CREDENTIAL_MGMT,
        traceId: old.traceId,
        result: AuditResult.SUCCESS,
        metadata: { supersededByResetNo: resetNo },
        entityOwnerNo: userNo,
      });
    }
```

Remove the REQUESTED audit call (the `auditLogsService.recordByActor` block that fires `PASSWORD_RESET_REQUESTED`):
```typescript
    // Audit: token requested
    const actorContext = requestSource === 'CISO'
      ? { actorType: 'ADMIN' as const, actorId: requestedByUserId!, actorNo: requestedByUserNo!, actorRole: 'CISO' }
      : { actorType: 'ADMIN' as const, actorId: userId, actorNo: userNo, actorRole: 'SELF' };

    await this.auditLogsService.recordByActor(
      {
        action: AuditGovernanceActions.ADMIN_CREDENTIAL_MGMT.PASSWORD_RESET_REQUESTED,
        entityType: AuditEntityTypes.PASSWORD_RESET_TOKEN,
        entityId: tokenRecord.id,
        entityNo: resetNo,
        workflowType: AuditBusinessWorkflowTypes.ADMIN_CREDENTIAL_MGMT,
        traceId,
        result: AuditResult.SUCCESS,
        metadata: {
          requestSource,
          ...(requestSource === 'CISO' ? { targetUserNo: userNo } : {}),
        },
        entityOwnerNo: userNo,
        sourcePlatform: 'ADMIN_API',
      },
      actorContext,
    );
```

Also remove the `actorContext` variable declaration just above the `recordByActor` call since it is only used there.

In `consumeResetToken()`, remove the COMPLETED audit call:
```typescript
    await this.auditLogsService.recordSystem({
      action: AuditGovernanceActions.ADMIN_CREDENTIAL_MGMT.PASSWORD_RESET_COMPLETED,
      entityType: AuditEntityTypes.PASSWORD_RESET_TOKEN,
      entityId: tokenRecord.id,
      entityNo: tokenRecord.resetNo,
      workflowType: AuditBusinessWorkflowTypes.ADMIN_CREDENTIAL_MGMT,
      traceId: tokenRecord.traceId,
      result: AuditResult.SUCCESS,
      metadata: { requestSource: tokenRecord.requestSource },
      entityOwnerNo: targetUser.userNo,
    });
```

Remove the entire `recordFailure()` private method — it only recorded the FAILED audit log:
```typescript
  private async recordFailure(tokenRecord: any, reason: string): Promise<void> {
    if (!tokenRecord) return;
    try {
      await this.auditLogsService.recordSystem({
        action: AuditGovernanceActions.ADMIN_CREDENTIAL_MGMT.PASSWORD_RESET_FAILED,
        entityType: AuditEntityTypes.PASSWORD_RESET_TOKEN,
        entityId: tokenRecord.id,
        entityNo: tokenRecord.resetNo,
        workflowType: AuditBusinessWorkflowTypes.ADMIN_CREDENTIAL_MGMT,
        traceId: tokenRecord.traceId,
        result: AuditResult.FAILED,
        metadata: { reason, requestSource: tokenRecord.requestSource },
        entityOwnerNo: tokenRecord.userId,
      });
    } catch {
      // audit failure must not block error response
    }
  }
```

After removing `recordFailure()`, find and remove its two call sites in `consumeResetToken()`:
```typescript
      await this.recordFailure(tokenRecord, 'INVALID_OR_CONSUMED_TOKEN');
```
```typescript
      await this.recordFailure(tokenRecord, 'TOKEN_EXPIRED');
```
Verify no other call sites remain: `grep -n "recordFailure" src/modules/identity/users/admin-password-reset-workflow.service.ts` should return zero results.

- [ ] **Step 3: Verify TypeScript compiles clean**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js
npx tsc --noEmit
```

Expected: Zero errors.

- [ ] **Step 4: Commit**

```bash
git add src/modules/audit-logging/constants/audit-actions.constant.ts \
        src/modules/identity/users/admin-password-reset-workflow.service.ts
git commit -m "chore: remove ADMIN_CREDENTIAL_MGMT token-layer audit calls"
```

---

## Task 4: Remove Dead Constants (ADMIN_ROLE_BINDING, ADMIN_ACCOUNT_DELETION)

**Files:**
- Modify: `src/modules/audit-logging/constants/audit-actions.constant.ts`

- [ ] **Step 1: Verify zero active references**

```bash
grep -rn "AuditBusinessWorkflowTypes\.ADMIN_ROLE_BINDING\b\|AuditWorkflowTypes\.ADMIN_ROLE_BINDING\b" \
  src/ --include="*.ts" | grep -v spec | grep -v "audit-actions.constant.ts"
grep -rn "AuditBusinessWorkflowTypes\.ADMIN_ACCOUNT_DELETION\|AuditWorkflowTypes\.ADMIN_ACCOUNT_DELETION" \
  src/ --include="*.ts" | grep -v spec | grep -v "audit-actions.constant.ts"
```

Expected: Zero results for both. If any results appear, do NOT proceed — investigate first.

- [ ] **Step 2: Check if ADMIN_ROLE_BINDING GovernanceActions block is still referenced**

```bash
grep -rn "AuditGovernanceActions\.ADMIN_ROLE_BINDING\b" \
  src/ --include="*.ts" | grep -v spec | grep -v "audit-actions.constant.ts"
```

If zero results: delete the `ADMIN_ROLE_BINDING` GovernanceActions block (shown below).
If results exist: leave the GovernanceActions block, only delete the `AuditBusinessWorkflowTypes.ADMIN_ROLE_BINDING` and `AuditWorkflowTypes.ADMIN_ROLE_BINDING` enum entries.

- [ ] **Step 3: Remove ADMIN_ROLE_BINDING entries from audit-actions.constant.ts**

In `src/modules/audit-logging/constants/audit-actions.constant.ts`:

Remove from `AuditWorkflowTypes` (around line 119):
```
  ADMIN_ROLE_BINDING: 'ADMIN_ROLE_BINDING',
```

Remove from `AuditBusinessWorkflowTypes` (around line 146):
```
  ADMIN_ROLE_BINDING: 'ADMIN_ROLE_BINDING',
```

If Step 2 confirmed zero GovernanceActions references, also remove the block:
```typescript
  // C2 — Admin Role Binding Change
  ADMIN_ROLE_BINDING: {
    CHANGE_REQUESTED:     'CHANGE_REQUESTED',
    APPROVAL_GRANTED:     'APPROVAL_GRANTED',
    APPROVAL_DECLINED:    'APPROVAL_DECLINED',
    APPROVAL_CANCELLED:   'APPROVAL_CANCELLED',
    APPROVAL_EXPIRED:     'APPROVAL_EXPIRED',
    CHANGE_APPLIED:       'CHANGE_APPLIED',
    CHANGE_APPLY_FAILED:  'CHANGE_APPLY_FAILED',
  },
```

- [ ] **Step 4: Remove ADMIN_ACCOUNT_DELETION entries from audit-actions.constant.ts**

Remove from `AuditWorkflowTypes` (around line 124):
```
  ADMIN_ACCOUNT_DELETION: 'ADMIN_ACCOUNT_DELETION',
```

Remove from `AuditBusinessWorkflowTypes` (around line 150):
```
  ADMIN_ACCOUNT_DELETION: 'ADMIN_ACCOUNT_DELETION',
```

Remove the GovernanceActions block:
```typescript
  // D1 — Admin Account Deletion
  ADMIN_ACCOUNT_DELETION: {
    DELETION_REQUESTED:   'DELETION_REQUESTED',
    APPROVAL_GRANTED:     'APPROVAL_GRANTED',
    APPROVAL_DECLINED:    'APPROVAL_DECLINED',
    APPROVAL_CANCELLED:   'APPROVAL_CANCELLED',
    ACCOUNT_SOFT_DELETED: 'ACCOUNT_SOFT_DELETED',
  },
```

- [ ] **Step 5: Verify TypeScript compiles clean**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js
npx tsc --noEmit
```

Expected: Zero errors.

- [ ] **Step 6: Commit**

```bash
git add src/modules/audit-logging/constants/audit-actions.constant.ts
git commit -m "chore: remove dead ADMIN_ROLE_BINDING and ADMIN_ACCOUNT_DELETION audit constants"
```
