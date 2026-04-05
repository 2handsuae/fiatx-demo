Status: draft
Owner: project-owner-and-agents
Last Updated: 2026-04-05
Applies To: `Exchange_js`
Supersedes: none
Depends On: `docs/specs/modules/audit-logging-module.md`, `docs/constraints/audit-logging-constraints.md`, `docs/specs/workflows/change-ticket-release-gate-workflow.md`, `docs/specs/workflows/delete-request-soft-delete-workflow.md`, `docs/specs/workflows/admin-member-auth-boundary-workflow.md`, `docs/specs/workflows/audit-evidence-export-approval-workflow.md`
Source of Truth Level: design-note

# Wave 1 Audit Business Workflow Redesign

## Purpose

- Re-center `Wave 1` audit logs around business workflows that operators can understand directly.
- Keep governance containers (`ChangeTicket`, `DeleteRequest`, `ApprovalCase`) as runtime infrastructure, but move them out of the first-layer operator mental model.
- Fix `traceId` semantics so one complete business workflow instance uses one trace, instead of leaking or inheriting unrelated container traces.

## In Scope

- `Wave 1` audit semantics for the current governance and member flows:
  - `ADMIN_MEMBER_PROVISIONING`
  - `ADMIN_LOGIN_ACCESS`
  - `ADMIN_ROLE_BINDING_CHANGE`
  - `CHANGE_TICKET_DELETION`
  - `ADMIN_USER_DELETION`
  - `AUDIT_EVIDENCE_PACKAGE_DELETION`
  - `AUDIT_EVIDENCE_EXPORT`
- Audit write paths under:
  - `change-tickets`
  - `delete-requests`
  - `approvals`
  - `users`
  - `admin-invitations`
  - `access-control`
- Audit Center list/detail presentation for workflow and action labels.

## Out of Scope

- New cross-wave workflow families.
- Rebuilding generic SLA / obligation semantics.
- Deleting governance container fields from storage.
- Renaming persisted Prisma columns such as `workflowType`, `workflowNo`, or `traceId`.

## Design Summary

- Audit logs should present **business workflow first**.
- Governance containers remain real runtime objects, but are treated as **technical/container metadata**, not as the main operator-facing workflow name.
- `Approval` is not a top-level workflow in this model. It is an embedded governance node inside another workflow.
- `traceId` is the correlation id for **one business workflow instance end-to-end**.

## Canonical Business Workflows

### 1. `ADMIN_MEMBER_PROVISIONING`

- Covers:
  - governed proposal creation for admin-member provisioning
  - approval to `READY`
  - `consume`
  - formal user creation
  - initial role binding
  - invitation issuance
  - invitation resend
  - invitation acceptance / activation

Canonical user-layer actions:
- `REQUEST_CREATED`
- `SUBMITTED`
- `APPROVED_FOR_EXECUTION`
- `EXECUTED`
- `INVITATION_ISSUED`
- `INVITATION_RESENT`
- `ACTIVATED`
- `ACTIVATION_FAILED`

Technical actions that may appear underneath:
- `CHANGE_TICKET_CREATED`
- `CHANGE_TICKET_SUBMITTED`
- `APPROVAL_SUBMITTED`
- `APPROVAL_APPROVED`
- `CHANGE_TICKET_APPROVED`
- `CHANGE_TICKET_CONSUMED`
- `USER_CREATED`
- `USER_ROLE_BINDING_UPDATED`
- `ADMIN_INVITATION_CREATED`
- `ADMIN_INVITATION_RESENT`
- `ADMIN_INVITATION_ACCEPTED`
- `ADMIN_INVITATION_ACCEPT_FAILED`

### 2. `ADMIN_LOGIN_ACCESS`

- Covers runtime admin login and account access boundary behavior.

Canonical user-layer actions:
- `LOGIN_SUCCEEDED`
- `LOGIN_FAILED`
- `ACCOUNT_LOCKED`
- `ACCOUNT_UNLOCKED`

Technical actions that may appear underneath:
- `ADMIN_LOGIN_SUCCESS`
- `ADMIN_LOGIN_FAILED`
- `ACCOUNT_LOCKED`
- `ACCOUNT_UNLOCKED`

### 3. `ADMIN_ROLE_BINDING_CHANGE`

- Covers governed admin role-binding replacement.

Canonical user-layer actions:
- `REQUEST_CREATED`
- `SUBMITTED`
- `APPROVED_FOR_EXECUTION`
- `EXECUTED`
- `ROLE_BINDINGS_UPDATED`

Technical actions that may appear underneath:
- `CHANGE_TICKET_CREATED`
- `CHANGE_TICKET_SUBMITTED`
- `APPROVAL_SUBMITTED`
- `APPROVAL_APPROVED`
- `CHANGE_TICKET_APPROVED`
- `CHANGE_TICKET_CONSUMED`
- `USER_ROLE_BINDING_UPDATED`

### 4. `CHANGE_TICKET_DELETION`

- Covers deleting a terminal `ChangeTicket` through a governed delete request.

Canonical user-layer actions:
- `REQUEST_CREATED`
- `SUBMITTED`
- `APPROVED_FOR_EXECUTION`
- `CANCELLED`
- `EXECUTED`

Technical actions that may appear underneath:
- `DELETE_REQUEST_CREATED`
- `DELETE_REQUEST_SUBMITTED`
- `APPROVAL_SUBMITTED`
- `APPROVAL_APPROVED`
- `DELETE_REQUEST_APPROVED`
- `DELETE_REQUEST_CANCELLED`
- `DELETE_REQUEST_CONSUMED`

### 5. `ADMIN_USER_DELETION`

- Covers governed deletion of an admin user.

Canonical user-layer actions:
- `REQUEST_CREATED`
- `SUBMITTED`
- `APPROVED_FOR_EXECUTION`
- `CANCELLED`
- `EXECUTED`

Technical actions that may appear underneath:
- `DELETE_REQUEST_CREATED`
- `DELETE_REQUEST_SUBMITTED`
- `APPROVAL_SUBMITTED`
- `APPROVAL_APPROVED`
- `DELETE_REQUEST_APPROVED`
- `DELETE_REQUEST_CANCELLED`
- `DELETE_REQUEST_CONSUMED`

### 6. `AUDIT_EVIDENCE_PACKAGE_DELETION`

- Covers governed deletion of an audit evidence package.

Canonical user-layer actions:
- `REQUEST_CREATED`
- `SUBMITTED`
- `APPROVED_FOR_EXECUTION`
- `CANCELLED`
- `EXECUTED`

Technical actions that may appear underneath:
- `DELETE_REQUEST_CREATED`
- `DELETE_REQUEST_SUBMITTED`
- `APPROVAL_SUBMITTED`
- `APPROVAL_APPROVED`
- `DELETE_REQUEST_APPROVED`
- `DELETE_REQUEST_CANCELLED`
- `DELETE_REQUEST_CONSUMED`

### 7. `AUDIT_EVIDENCE_EXPORT`

- Covers approval-gated export of an audit evidence package.

Canonical user-layer actions:
- `REQUEST_CREATED`
- `SUBMITTED`
- `APPROVED_FOR_EXECUTION`
- `EXPORTED`
- `EXPORT_FAILED`

Technical actions that may appear underneath:
- `APPROVAL_SUBMITTED`
- `APPROVAL_APPROVED`
- `AUDIT_EVIDENCE_PACKAGE_EXPORTED`
- `APPROVAL_EXECUTED`
- `APPROVAL_EXECUTION_FAILED`

## Trace Model

### Primary Rule

- One complete **business workflow instance** uses one `traceId`.
- `traceId` is not:
  - an entity id
  - an approval id
  - a ticket/request number
  - a per-step id

### When To Create a New Trace

- Create a new `traceId` when a new business workflow instance starts.
- Examples:
  - starting one new admin provisioning request
  - starting one role-binding change request
  - starting one delete request
  - starting one evidence export request
  - starting one login attempt

### When NOT To Create a New Trace

- Do not create a new trace for embedded approval events inside the same workflow.
- Do not create a new trace for downstream formal-write side effects that are part of the same workflow instance.
- Do not let a new delete workflow inherit the target object's trace.

### Concrete Examples

- `ADMIN_MEMBER_PROVISIONING`
  - one trace from proposal creation through consume, user creation, invitation issuance, resend, and activation
- `ADMIN_ROLE_BINDING_CHANGE`
  - one trace from request creation through consume and final role-binding update
- `CHANGE_TICKET_DELETION`
  - one trace for the delete workflow itself; it must not reuse the target change ticket trace
- `ADMIN_LOGIN_ACCESS`
  - each login attempt is its own workflow instance and gets its own trace

## Workflow Identity Model

### Business Workflow Name

- The main workflow label shown to operators.
- This is the first-layer concept in Audit Center.

### Primary Ref No

- The root operator-facing number that anchors the workflow instance.
- Storage may continue using `workflowNo`, but UI copy should prefer:
  - `Primary Ref No`
  - or `Flow Ref No`
- It is not a new workflow-owned id; it is the main existing `No` used to anchor the workflow.

Examples:
- `ADMIN_MEMBER_PROVISIONING -> CT...`
- `ADMIN_ROLE_BINDING_CHANGE -> CT...`
- `CHANGE_TICKET_DELETION -> DR...`
- `ADMIN_USER_DELETION -> DR...`
- `AUDIT_EVIDENCE_PACKAGE_DELETION -> DR...`
- `AUDIT_EVIDENCE_EXPORT -> EVP...`
- `ADMIN_LOGIN_ACCESS -> ADMIN...`

## Governance Container Model

- Governance containers stay in the runtime model:
  - `CHANGE_TICKET`
  - `DELETE_REQUEST`
  - `APPROVAL_CASE`
- They remain necessary for:
  - routing
  - storage
  - SoD
  - consume
  - approval linkage
- They should not be the first-layer workflow name shown to operators in Audit Center.
- The container should be available only in technical/detail sections.

## Approval Model

- `Approval` does not become its own top-level business workflow.
- Approval audit events stay technically real:
  - `APPROVAL_SUBMITTED`
  - `APPROVAL_APPROVED`
  - `APPROVAL_REJECTED`
  - `APPROVAL_CANCELLED`
  - `APPROVAL_EXPIRED`
  - `APPROVAL_EXECUTED`
  - `APPROVAL_EXECUTION_FAILED`
- But approval rows should inherit the parent workflow context:
  - parent business workflow type
  - parent primary ref no
  - parent trace

## SubjectNo Model

### Purpose

- `subjectNos` are the operator lookup anchors.
- They should include all numbers an operator would realistically search with.

### Minimum Rule

For a governed workflow record, `subjectNos` should include:
- actor `userNo`
- root workflow `Primary Ref No`
- linked `approvalNo` when present
- target `No` when the workflow acts on a target object

### Examples

- `ADMIN_MEMBER_PROVISIONING`
  - `CT...`
  - `APR...`
  - `ADMIN...`
  - actor `ADMIN-...`
- `ADMIN_USER_DELETION`
  - `DR...`
  - `APR...`
  - target `ADMIN...`
  - actor `ADMIN-...`
- `CHANGE_TICKET_DELETION`
  - `DR...`
  - `APR...`
  - target `CT...`
  - actor `ADMIN-...`

## UI / Audit Center Projection

### Default Visible Fields

- `Business Workflow`
- `Primary Ref No`
- `User Action`
- `Occurred At`
- `Result`
- `Subjects`

### Technical Section Only

- raw `action`
- `entityType`
- `entityNo`
- governance container type / no
- `approvalNo`
- `traceId`
- raw `workflowType` / `workflowNo`

### Naming Rule

- UI should stop using raw container labels like:
  - `CHANGE_TICKET`
  - `DELETE_REQUEST`
  - `APPROVAL`
as the primary workflow name in Audit Center for these Wave 1 flows.

## Implementation Direction

### Storage Strategy

- Keep existing Prisma fields:
  - `workflowType`
  - `workflowId`
  - `workflowNo`
  - `traceId`
- Reinterpret `workflowType/workflowNo` for the current Wave 1 governed flows as:
  - business workflow type
  - primary ref no
- Move governance container identity into metadata and technical projections where needed.

### Read-Model Strategy

- Audit read models should derive:
  - `businessWorkflow`
  - `businessWorkflowLabel`
  - `userAction`
  - `userActionLabel`
  - `primaryRefNo`
- Raw persisted `action` remains available in technical detail and for filtering/debug.

### Propagation Strategy

- `ChangeTicket` and `DeleteRequest` audit writes become the root source of parent workflow context.
- Approval records inherit parent workflow context instead of surfacing themselves as standalone operator workflows.
- Provisioning child-flow writes in `UsersService`, `AdminInvitationsService`, and `AccessControlService` must receive and preserve the same parent trace / workflow context.

## Success Criteria

- Operators can read Audit Center in business language first.
- A complete business workflow is traceable through one `traceId`.
- Delete workflows no longer inherit target workflow traces.
- Approval events remain queryable but no longer confuse first-layer workflow identity.
- `subjectNos` expose the root ref, approval ref, target ref, and actor ref consistently for the governed Wave 1 flows.
