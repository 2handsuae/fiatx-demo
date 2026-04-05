# Wave 1 Audit Business Workflow Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild Wave 1 audit semantics around business workflows, one-trace-per-workflow-instance rules, and operator-facing action labels without expanding scope beyond current governed/member flows.

**Architecture:** Reuse the existing audit storage fields, but reinterpret `workflowType/workflowNo` as business workflow identity for the current Wave 1 flows. Keep governance containers as technical metadata, not first-layer workflow names. Propagate one parent workflow context through `ChangeTicket`, `DeleteRequest`, `Approval`, provisioning side effects, invitation side effects, and audit export so Audit Center can present business workflows and user actions directly.

**Tech Stack:** NestJS, Prisma, Jest, React, Vite, TypeScript

---

## File Structure Map

- `src/modules/risk-engine/audit-logs/constants/audit-actions.constant.ts`
  - Add business workflow taxonomy and canonical user-action vocabulary/mapping helpers.
- `src/modules/risk-engine/audit-logs/dto/audit-log.dto.ts`
  - Extend read-model response shape for business workflow and user-action projection.
- `src/modules/risk-engine/audit-logs/audit-logs.service.ts`
  - Derive business workflow, primary ref no, user action, and technical container projection in list/detail reads.
- `src/modules/governance/change-tickets/change-tickets.service.ts`
  - Emit business workflow context for both governed change flows and preserve one trace across provisioning side effects.
- `src/modules/governance/delete-requests/delete-requests.service.ts`
  - Stop inheriting target trace; emit business workflow context for the three delete flows.
- `src/modules/governance/approvals/approvals.service.ts`
  - Preserve parent business workflow context on approval records and audits.
- `src/modules/governance/approvals/audit-evidence-export-approval.service.ts`
  - Emit evidence export workflow context and keep export events aligned with the new model.
- `src/modules/identity/users/users.service.ts`
  - Pass workflow/trace context into `USER_CREATED` and provisioning child-flow writes.
- `src/modules/identity/users/admin-invitations.service.ts`
  - Accept inherited workflow context so invitation create/resend/accept stays on the same provisioning trace.
- `src/modules/identity/access-control/access-control.service.ts`
  - Accept inherited workflow context so role-binding updates stay on the correct business workflow trace.
- `admin-web/src/pages/AuditLogsPage.tsx`
  - Show business workflow and user action as the first-layer audit columns/filter labels.
- `admin-web/src/pages/AuditLogDetailPage.tsx`
  - Show business workflow and primary ref first, move container/raw action/trace into technical section.
- `admin-web/src/pages/EvidenceExportDetailPage.tsx`
  - Align audit export references with the new business workflow language where surfaced.
- `docs/specs/modules/audit-logging-product-doc.md`
  - Promote the new operator-facing workflow/action language if implementation stabilizes.
- `docs/specs/modules/audit-logging-technical-doc.md`
  - Promote trace/workflow/container rules if implementation stabilizes.

## Task 1: Freeze Business Workflow and User-Action Taxonomy in Code

**Files:**
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/risk-engine/audit-logs/constants/audit-actions.constant.ts`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/risk-engine/audit-logs/audit-logs.service.spec.ts`

- [ ] Add a Wave 1 business-workflow constant set:
  - `ADMIN_MEMBER_PROVISIONING`
  - `ADMIN_LOGIN_ACCESS`
  - `ADMIN_ROLE_BINDING_CHANGE`
  - `CHANGE_TICKET_DELETION`
  - `ADMIN_USER_DELETION`
  - `AUDIT_EVIDENCE_PACKAGE_DELETION`
  - `AUDIT_EVIDENCE_EXPORT`
- [ ] Add a user-action vocabulary/mapping helper for:
  - `REQUEST_CREATED`
  - `SUBMITTED`
  - `APPROVED_FOR_EXECUTION`
  - `EXECUTED`
  - `INVITATION_ISSUED`
  - `INVITATION_RESENT`
  - `ACTIVATED`
  - `ACTIVATION_FAILED`
  - `LOGIN_SUCCEEDED`
  - `LOGIN_FAILED`
  - `ROLE_BINDINGS_UPDATED`
  - `CANCELLED`
  - `EXPORTED`
  - `EXPORT_FAILED`
- [ ] Add read-model tests that prove raw technical actions map to the intended user-action labels.
- [ ] Run:
```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js && npm test -- src/modules/risk-engine/audit-logs/audit-logs.service.spec.ts --runInBand
```

## Task 2: Rewire ChangeTicket Audit Writes To Business Workflow Context

**Files:**
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/governance/change-tickets/change-tickets.service.ts`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/governance/change-tickets/change-tickets.service.spec.ts`

- [ ] Add helpers to resolve:
  - `ADMIN_ACCESS_CHANGE -> ADMIN_MEMBER_PROVISIONING`
  - `RBAC_CATALOG_CHANGE -> ADMIN_ROLE_BINDING_CHANGE`
- [ ] Ensure all change-ticket audit writes use:
  - `workflowType = business workflow type`
  - `workflowNo = ticketNo`
  - `traceId = ticket.traceId`
- [ ] Keep ticket container info in metadata/technical projection instead of making it the first-layer workflow name.
- [ ] Ensure `subjectNos` always include:
  - `ticketNo`
  - `approvalNo` when present
  - target admin `userNo` when known from binding snapshot
- [ ] Add tests covering both change types and their resulting workflow/action projections.
- [ ] Run:
```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js && npm test -- src/modules/governance/change-tickets/change-tickets.service.spec.ts --runInBand
```

## Task 3: Rewire DeleteRequest Audit Writes and Fix Trace Semantics

**Files:**
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/governance/delete-requests/delete-requests.service.ts`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/governance/delete-requests/delete-requests.service.spec.ts`

- [ ] Add helpers to resolve:
  - `CHANGE_TICKET -> CHANGE_TICKET_DELETION`
  - `ADMIN_USER -> ADMIN_USER_DELETION`
  - `AUDIT_EVIDENCE_PACKAGE -> AUDIT_EVIDENCE_PACKAGE_DELETION`
- [ ] Stop inheriting target trace when a delete request is created.
- [ ] Ensure each delete request starts its own trace unless a caller explicitly supplies one.
- [ ] Ensure all delete-request audit writes use:
  - `workflowType = business delete workflow`
  - `workflowNo = requestNo`
  - `traceId = request.traceId`
- [ ] Ensure `subjectNos` always include:
  - `requestNo`
  - `approvalNo` when present
  - `targetNo`
  - actor `userNo`
- [ ] Add regression tests proving deleting a change ticket no longer reuses the target change ticket trace.
- [ ] Run:
```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js && npm test -- src/modules/governance/delete-requests/delete-requests.service.spec.ts --runInBand
```

## Task 4: Make Approval an Embedded Governance Node Instead of a Top-Level Operator Workflow

**Files:**
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/governance/approvals/approvals.service.ts`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/governance/approvals/approvals.service.spec.ts`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/governance/approvals/audit-evidence-export-approval.service.ts`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/governance/approvals/audit-evidence-export-approval.service.spec.ts`

- [ ] Keep `APPROVAL_*` technical actions unchanged.
- [ ] Ensure approval records always inherit parent workflow context from the caller:
  - parent business workflow type
  - parent primary ref no
  - parent trace id
- [ ] Ensure evidence-export approval flow uses:
  - `workflowType = AUDIT_EVIDENCE_EXPORT`
  - `workflowNo = packageNo` or the chosen export root ref
  - one trace across request, approval, export result
- [ ] Add tests proving approval events for CT/DR/export are queryable under the parent workflow context.
- [ ] Run:
```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js && npm test -- src/modules/governance/approvals/approvals.service.spec.ts src/modules/governance/approvals/audit-evidence-export-approval.service.spec.ts --runInBand
```

## Task 5: Propagate One Provisioning Trace Through User Creation, Role Binding, and Invitation Child Flow

**Files:**
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/identity/users/users.service.ts`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/identity/users/admin-invitations.service.ts`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/identity/access-control/access-control.service.ts`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/identity/users/users.service.spec.ts`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/identity/users/admin-invitations.service.spec.ts`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/identity/access-control/access-control.service.spec.ts`

- [ ] Introduce an internal audit-context parameter for governed execution paths:
  - business workflow type
  - primary ref no
  - trace id
- [ ] Pass that context from `ChangeTicket.consume` into:
  - `UsersService.executeAdminMemberProvisioning`
  - `AccessControlService.executeGovernedRoleBindingChange`
- [ ] Ensure:
  - `USER_CREATED`
  - `USER_ROLE_BINDING_UPDATED`
  - `ADMIN_INVITATION_CREATED`
  - `ADMIN_INVITATION_RESENT`
  - `ADMIN_INVITATION_ACCEPTED`
  - `ADMIN_INVITATION_ACCEPT_FAILED`
  all stay on the same provisioning trace when they belong to one provisioning workflow instance.
- [ ] Keep `ADMIN_LOGIN_*` on separate login workflow traces.
- [ ] Add tests proving provisioning and invitation child-flow audits share one trace, while login remains separate.
- [ ] Run:
```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js && npm test -- src/modules/identity/users/users.service.spec.ts src/modules/identity/users/admin-invitations.service.spec.ts src/modules/identity/access-control/access-control.service.spec.ts --runInBand
```

## Task 6: Rebuild Audit Read Models and Admin UI Around Business Workflow First

**Files:**
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/risk-engine/audit-logs/dto/audit-log.dto.ts`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/risk-engine/audit-logs/audit-logs.service.ts`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/admin-web/src/pages/AuditLogsPage.tsx`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/admin-web/src/pages/AuditLogDetailPage.tsx`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/risk-engine/audit-logs/audit-logs.service.spec.ts`

- [ ] Extend audit API responses with derived display fields:
  - `businessWorkflow`
  - `businessWorkflowLabel`
  - `primaryRefNo`
  - `userAction`
  - `userActionLabel`
- [ ] Keep raw fields available for technical sections:
  - `action`
  - `entityType`
  - `entityNo`
  - `traceId`
  - container metadata
- [ ] Update Audit Logs list/detail so the first-layer presentation uses business workflow and user action, not raw container names.
- [ ] Move raw container and trace information into the technical section by default.
- [ ] Run:
```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js && npm test -- src/modules/risk-engine/audit-logs/audit-logs.service.spec.ts --runInBand
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/admin-web && npm run build
```

## Task 7: Promote Durable Docs Once Runtime Behavior Stabilizes

**Files:**
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/docs/specs/modules/audit-logging-product-doc.md`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/docs/specs/modules/audit-logging-technical-doc.md`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/docs/specs/workflows/change-ticket-release-gate-workflow.md`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/docs/specs/workflows/delete-request-soft-delete-workflow.md`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/docs/specs/workflows/admin-member-auth-boundary-workflow.md`

- [ ] Promote the approved business-workflow-first terminology into permanent docs.
- [ ] Explicitly document:
  - one workflow instance = one trace
  - approval is embedded
  - delete flows do not inherit target trace
  - business workflow is first-layer UI language
- [ ] Run a final focused regression:
```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js && npm test -- src/modules/governance/change-tickets/change-tickets.service.spec.ts src/modules/governance/delete-requests/delete-requests.service.spec.ts src/modules/governance/approvals/approvals.service.spec.ts src/modules/governance/approvals/audit-evidence-export-approval.service.spec.ts src/modules/identity/users/users.service.spec.ts src/modules/identity/users/admin-invitations.service.spec.ts src/modules/identity/access-control/access-control.service.spec.ts src/modules/risk-engine/audit-logs/audit-logs.service.spec.ts --runInBand
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/admin-web && npm run build
```
