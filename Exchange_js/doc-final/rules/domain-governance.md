# Domain: Governance Rules
Last Updated: 2026-04-22 | Scope: Wave 1 only | Source: docs/constraints/governance-*, rbac-member-management-constraints.md
> SLA Timer → Wave 9 范围，不在本文件。governance-registries → Wave 9 范围。

---

## Approval Engine

- Must keep canonical implementation under `src/modules/governance/approvals`.
- `approvalNo` (prefix `APR`) is the operator-facing primary identifier; admin UI and search must prioritize it over `id`.
- State machine is fixed: `DRAFT → PENDING → APPROVED | REJECTED | EXPIRED | CANCELLED`; execution states: `NOT_EXECUTED | EXECUTED | EXECUTION_FAILED`.
- `submit` only from `DRAFT`; `approve`/`reject` only from `PENDING`.
- Must remain single-step (V1); 禁止 multi-step serial/parallel approvals or per-case checker-role override.
- Active Wave 1 `actionType` values are exactly: `AUDIT_EVIDENCE_EXPORT_APPROVAL`, `CASE_EVIDENCE_EXPORT_APPROVAL`, `CHANGE_TICKET_APPROVAL`, `DELETE_REQUEST_APPROVAL`, `ONBOARDING_FINAL_APPROVAL` — 禁止 adding new types without a new wave spec.
- Maker-checker SoD: same non-`SUPER_ADMIN` user must not be both maker and checker.
- `SUPER_ADMIN` may bypass SoD; audit metadata must include `superAdminBypass=true`.
- Duplicate `PENDING` approvals for the same `actionType + entityRef` must be blocked.
- All writes must go through `AuditLogsService`; records must include `approvalNo`, `traceId`, `workflowType`, `workflowNo`.
- Routes are under `/admin/control-gates/approvals`; 禁止 using `/governance` prefix.
- Required RBAC permission codes: `GOV_APPROVAL_READ`, `GOV_APPROVAL_WRITE`, `GOV_APPROVAL_DECIDE`.

---

## Change Ticket

- Must keep canonical implementation under `src/modules/governance/change-tickets`.
- `ticketNo` (prefix `CT`) is the operator-facing primary identifier.
- Canonical `changeType` values: `ADMIN_ACCESS_CHANGE`, `RBAC_CATALOG_CHANGE` only.
- Status machine: `DRAFT → PENDING_APPROVAL → READY → DONE | FAILED`; terminal exits also `REJECTED`, `CANCELLED`.
- `submit` only from `DRAFT`; must create an approval case with `actionType = CHANGE_TICKET_APPROVAL`.
- Approval projection: `APPROVED → READY`; `REJECTED | EXPIRED | CANCELLED → REJECTED`.
- `consume` only from `READY`; no maker-checker restriction on consume beyond route guard.
- 禁止 adding resubmit, gate, deploy, or close steps to this workflow.
- Creator ≠ Consumer is not enforced for change tickets (only for delete requests).
- All writes through `AuditLogsService`; `subjectNos` must include `ticketNo` (and `approvalNo` when linked).
- List page must be pure list; 禁止 embedding a bottom detail panel.
- Routes: `/dashboard/control-gates/change-tickets`; permissions: `GOV_CHANGE_TICKET_READ`, `GOV_CHANGE_TICKET_WRITE`.

---

## Delete Request

- Must keep canonical implementation under `src/modules/governance/delete-requests`.
- `requestNo` (prefix `DR`) is the operator-facing primary identifier; `targetNo` is secondary search key.
- Canonical `targetType` values: `CHANGE_TICKET`, `AUDIT_EVIDENCE_PACKAGE`, `ADMIN_USER` only.
- `COMPLIANCE_CASE_EVIDENCE_PACKAGE` and `APPROVAL_CASE` are not valid target types.
- Status machine mirrors change ticket: `DRAFT → PENDING_APPROVAL → READY → DONE | FAILED | REJECTED | CANCELLED`.
- `submit` only from `DRAFT` and only by the creator.
- `submit` must create an approval case with `actionType = DELETE_REQUEST_APPROVAL`.
- Creator must NOT consume their own request unless actor is `SUPER_ADMIN` (SoD enforced).
- `consume` must re-check that the linked approval case is `APPROVED` before deleting the target.
- `cancel` allowed from `DRAFT`, `PENDING_APPROVAL`, or `READY` by the creator; `SUPER_ADMIN` may cancel any.
- Target gate rules:
  - `CHANGE_TICKET` must be in terminal status (`DONE | FAILED | REJECTED | CANCELLED`) and not already deleted.
  - `AUDIT_EVIDENCE_PACKAGE` must have no pending linked approval.
  - `ADMIN_USER` must be resolved by `userNo`.
- Soft-delete fields on target tables must be: `deletedAt`, `deletedBy`, `deleteRequestId`, `deleteReason`.
- `SUPER_ADMIN` bypass of SoD must include `superAdminBypass=true` in audit metadata.
- `subjectNos` must include both `requestNo` and `targetNo`.
- Routes: `/dashboard/control-gates/delete-requests`; consume permission is distinct: `GOV_DELETE_REQUEST_CONSUME`.

---

## RBAC & Member Management

- Authorization truth is `user_roles + role_permissions`; `users.role` is compatibility/display field only.
- The role catalog is fixed; runtime member flows only bind users to existing roles — 禁止 authoring new catalog roles at runtime.
- `Role Management` page is a read-only catalog explainer; 禁止 using it as a create/edit/delete surface.
- `Platform Members` is the sole member operation surface (list, create, assign roles).
- Create-member result is `INACTIVE`; returns one-time invite-link metadata (`inviteLink`, `inviteExpiresAt`, `inviteStatus`).
- `INACTIVE → ACTIVE` transition only after successful invitation acceptance.
- Invitation TTL is 24h; expired/revoked/consumed tokens must be rejected explicitly.
- Resend invalidates the previous active token (only one active token per member at a time).
- `INACTIVE` admin login must be rejected with an activation-required message.
- Soft-deleted admin users must be excluded from member lists, login, and invitation flows.
- Base seed must maintain exactly 8 active role accounts (seeded by email); seed sync must be idempotent (`upsert`).
- 禁止 adding an extra `super_admin@...` seed identity.
- Retired role codes (`RI`, `SM`, `TECH_ADMIN`, `OPS_TREASURY`, `FINANCE`, `COMPLIANCE_LEAD`) must not appear as seed identities.
- `SUPER_ADMIN` retains full-site permission and maker-checker SoD bypass as intentional demo behavior.
- `ensureBaseSeeded` must detect and repair drift: missing role account, wrong role binding.
