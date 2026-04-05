Status: active
Owner: project-owner-and-agents
Last Updated: 2026-04-02
Applies To: `Exchange_js`
Supersedes: none
Depends On: `docs/specs/workflows/change-ticket-release-gate-workflow.md`
Source of Truth Level: specs-entity

# Change Ticket Entity

## Purpose
- Canonical entity semantics for governance change tickets in the minimal approval-and-consume model.

## Canonical Fields
- `id`
- `ticketNo`
- `status`
- `changeType`
- `changeReason`
- `scopeSummary`
- `testEvidenceRef`
- `rollbackPlanRef`
- `bindingSnapshotJson`
- `bindingDigest`
- `approvalCaseId`
- `approvalNo`
- `traceId`
- `createdByUserId`
- `createdByUserNo`
- `submittedByUserId`
- `submittedByUserNo`
- `consumedByUserId`
- `consumedByUserNo`
- `submittedAt`
- `consumedAt`
- `resultNote`
- `deletedAt`
- `deletedBy`
- `deleteRequestId`
- `deleteRequestNo`
- `deleteReason`
- `createdAt`
- `updatedAt`

## Lifecycle Anchor
- `ChangeTicketsService` owns creation, approval binding, approval-projection sync, and consume.
- Approval remains a separate governance object identified by `approvalCaseId` and `approvalNo`.
- Soft delete is applied by `DeleteRequestsService` onto the target ticket, not by removing the ticket chain.

## State Model
- `DRAFT`
- `PENDING_APPROVAL`
- `READY`
- `DONE`
- `FAILED`
- `REJECTED`
- `CANCELLED`

## Type Model
- `ADMIN_ACCESS_CHANGE`
- `RBAC_CATALOG_CHANGE`

## Action Model
- `create`
- `list`
- `getById`
- `submit`
- `consume`

## Read-Model Meaning
- `ticketNo` is the operator-facing primary identifier.
- `approvalCaseId` and `approvalNo` carry the linked approval reference.
- `createdByUserNo`, `submittedByUserNo`, and `consumedByUserNo` are the operator-facing user references.
- `bindingSnapshotJson` and `bindingDigest` preserve the consume-binding payload and digest snapshot when present.
- `resultNote` captures the final consume outcome note.
- `deletedAt` and related delete fields only appear after a delete request consumes the ticket.
