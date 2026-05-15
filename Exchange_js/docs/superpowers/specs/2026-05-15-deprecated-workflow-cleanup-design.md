# Design: Deprecated Workflow Constants & Module Cleanup

**Date:** 2026-05-15  
**Scope:** Backend — governance module, identity module, audit constants  
**Approach:** Option B — Full removal with CT dependency cleanup  

---

## Background

Six `AuditBusinessWorkflowTypes` constants were identified as dead or deprecated:

| Constant | Reason for removal |
|---|---|
| `AUDIT_EVIDENCE_PACKAGE_DELETION` | Tied exclusively to Delete Requests (DR) module — DR is deprecated |
| `ADMIN_USER_DELETION` | Tied exclusively to Delete Requests module — DR is deprecated |
| `ADMIN_MEMBER_PROVISIONING` | Tied exclusively to Change Tickets `ADMIN_ACCESS_CHANGE` path — CT is deprecated |
| `ADMIN_CREDENTIAL_MGMT` | V1 token-lifecycle tracking, superseded by `ADMIN_PASSWORD_RESET` which is complete |
| `ADMIN_ROLE_BINDING` | Dead enum value — active code uses `ADMIN_ROLE_BINDING_CHANGE` instead |
| `ADMIN_ACCOUNT_DELETION` | Dead enum value — no service implements this workflow |

Upstream investigation revealed two full modules are deprecated:
- **Delete Requests (DR)** — `src/modules/governance/delete-requests/`
- **Change Tickets (CT)** — `src/modules/governance/change-tickets/`

**business-config** module is also deprecated and is explicitly out of scope for this cleanup — its CT references are left in place.

---

## Section 1 — What Gets Deleted Entirely

### 1.1 Audit Constants (`audit-actions.constant.ts`)

Remove from `AuditBusinessWorkflowTypes`:
- `AUDIT_EVIDENCE_PACKAGE_DELETION`
- `ADMIN_USER_DELETION`
- `ADMIN_MEMBER_PROVISIONING`
- `ADMIN_CREDENTIAL_MGMT`
- `ADMIN_ROLE_BINDING`
- `ADMIN_ACCOUNT_DELETION`

Remove from `AuditWorkflowTypes` (base enum):
- `ADMIN_ACCOUNT_DELETION`

Remove from `AuditGovernanceActions` (sub-action blocks):
- `ADMIN_CREDENTIAL_MGMT` block (5 actions: MFA_RESET_EXECUTED, PASSWORD_RESET_*)
- `ADMIN_ROLE_BINDING` block (7 actions)
- `ADMIN_ACCOUNT_DELETION` block (5 actions)
- `AUDIT_EVIDENCE_PACKAGE_DELETION` block (5 actions)

Remove standalone constant objects:
- `DeleteRequestTargetTypes` — entire object
- `ChangeTicketTypes` — entire object

Remove from `approval.constants.ts`:
- `DELETE_REQUEST_APPROVAL` action type + its approval policy config
- `CHANGE_TICKET_APPROVAL` action type + its approval policy config

### 1.2 Delete Requests Module

Delete entire directory:
```
src/modules/governance/delete-requests/
```

### 1.3 Change Tickets Module

Delete entire directory:
```
src/modules/governance/change-tickets/
```

Delete related file (empty shell):
```
src/modules/governance/sla-timers/change-ticket-sla-projection.service.ts
```

---

## Section 2 — Files That Stay But Need Surgery

### 2.1 `governance.module.ts`
- Remove `ChangeTicketsModule` import and from `imports[]` / `exports[]`
- Remove `DeleteRequestsModule` import and from `imports[]` / `exports[]`

### 2.2 `approvals.module.ts`
- Remove `forwardRef(() => ChangeTicketsModule)` from imports

### 2.3 `approvals.service.ts`
- Remove `ChangeTicketsService` constructor injection (`@Inject(forwardRef(...))`)
- Remove `resolveChangeTicketWorkflowType()` method and all call sites
- Remove `resolveDeleteRequestWorkflowType()` method and all call sites
- Remove `db.changeTicket?.findFirst()` lookup in `resolveParentWorkflowContext()`
- Remove `this.changeTicketsService.syncApprovalProjectionByEvent()` call and surrounding guard

### 2.4 `governed-execution.listener.ts`
- Remove `handleChangeTicketConsumed()` event handler and `ChangeTicketConsumedEvent` import
- If the file has no remaining handlers after removal, delete the file entirely

### 2.5 `sla-timers/sla-timers.module.ts`
- Remove `ChangeTicketSlaProjectionService` import, from `providers[]`, and from `exports[]`

### 2.6 `audit-logs.service.ts`
- Remove `CHANGE_TICKET: { model: 'changeTicket', field: 'ticketNo' }` entry from the entity-type registry

### 2.7 `admin-password-reset-workflow.service.ts`
- In `createResetToken()`: remove the 4 audit calls that use `AuditBusinessWorkflowTypes.ADMIN_CREDENTIAL_MGMT`:
  - `PASSWORD_RESET_REVOKED` loop (audit for each revoked old token)
  - `PASSWORD_RESET_REQUESTED` call (token created)
- In `consumeResetToken()`: remove `PASSWORD_RESET_COMPLETED` audit call
- In `recordFailure()`: remove `PASSWORD_RESET_FAILED` audit call; if the method has no remaining body, delete it and its call sites
- Remove all `AuditGovernanceActions.ADMIN_CREDENTIAL_MGMT.*` references

---

## Section 3 — DB Migrations

Two Prisma migrations, each atomic:

| Migration | Action |
|---|---|
| `remove_delete_requests` | Remove `DeleteRequest` model from schema; generate migration to `DROP TABLE delete_requests` |
| `remove_change_tickets` | Remove `ChangeTicket` model from schema; generate migration to `DROP TABLE change_tickets` |

**FK check required before CT migration:** verify no other non-deprecated table has a FK to `change_tickets`. `business_config_releases.changeTicketId` exists but business-config is deprecated and out of scope — leave the FK in place.

---

## Section 4 — Execution Order & Verification

Constants and their referencing code are removed **in the same step** so that `tsc --noEmit` passes cleanly after each commit.

| Step | Scope | Commit message |
|---|---|---|
| 1 | Remove DR constants (`AUDIT_EVIDENCE_PACKAGE_DELETION`, `ADMIN_USER_DELETION`, `DeleteRequestTargetTypes`, `DELETE_REQUEST_APPROVAL` policy) **+** delete `delete-requests/` directory **+** clean `governance.module.ts` and `approvals.service.ts` DR parts **+** Prisma migration drop `delete_requests` | `chore: remove DeleteRequests module, workflow constants, and DB table` |
| 2 | Remove CT constants (`ADMIN_MEMBER_PROVISIONING`, `ChangeTicketTypes`, `CHANGE_TICKET_APPROVAL` policy) **+** delete `change-tickets/` directory **+** clean all CT external deps (governance.module / approvals.module / approvals.service CT parts / governed-execution.listener / sla-timers / audit-logs.service) **+** Prisma migration drop `change_tickets` | `chore: remove ChangeTickets module, workflow constants, and DB table` |
| 3 | Remove `ADMIN_CREDENTIAL_MGMT` constant + GovernanceActions block **+** remove 4 audit calls from `admin-password-reset-workflow.service.ts` | `chore: remove ADMIN_CREDENTIAL_MGMT token-layer audit calls` |
| 4 | Remove truly dead constants with zero code refs: `ADMIN_ROLE_BINDING` + GovernanceActions block, `ADMIN_ACCOUNT_DELETION` + GovernanceActions block (both in `AuditBusinessWorkflowTypes` and `AuditWorkflowTypes`) | `chore: remove dead ADMIN_ROLE_BINDING and ADMIN_ACCOUNT_DELETION audit constants` |

Each step is independently compilable and revertable.

---

## Out of Scope

- `business-config` module CT references — entire module is deprecated, handled separately
- `BusinessConfigRelease.changeTicketId` Prisma field — left in place
- `ADMIN_PASSWORD_RESET` workflow — kept intact, no changes
- `ADMIN_MFA_RESET` workflow — kept intact, no changes
- `ADMIN_ROLE_BINDING_CHANGE` workflow — kept intact (distinct from deprecated `ADMIN_ROLE_BINDING`)
- `ASSET_LISTING` dead constant — not in scope for this cleanup
