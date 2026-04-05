Status: active
Owner: project-owner-and-agents
Last Updated: 2026-04-02
Applies To: `Exchange_js`
Supersedes: none
Depends On: `docs/specs/workflows/delete-request-soft-delete-workflow.md`
Source of Truth Level: specs-entity

# Delete Request Entity

## Purpose
- Canonical entity semantics for governance delete requests in the minimal approval-and-consume model.

## Canonical Fields
- `id`
- `requestNo`
- `targetType`
- `targetId`
- `targetNo`
- `status`
- `approvalCaseId`
- `approvalNo`
- `createdByUserId`
- `createdByUserNo`
- `submittedByUserId`
- `submittedByUserNo`
- `consumedByUserId`
- `consumedByUserNo`
- `deleteReason`
- `resultNote`
- `docRef`
- `targetSnapshotJson`
- `targetSnapshotDigest`
- `traceId`
- `submittedAt`
- `consumedAt`
- `createdAt`
- `updatedAt`

## Lifecycle Anchor
- `DeleteRequestsService` owns creation, target resolution, approval binding, cancel, and consume.
- Approval remains a separate governance object identified by `approvalCaseId` and `approvalNo`.
- Consume writes the standardized soft-delete fields onto the target object.

## State Model
- `DRAFT`
- `PENDING_APPROVAL`
- `READY`
- `DONE`
- `FAILED`
- `REJECTED`
- `CANCELLED`

## Target Model
- `CHANGE_TICKET`
- `AUDIT_EVIDENCE_PACKAGE`
- `ADMIN_USER`

## Action Model
- `create`
- `list`
- `getById`
- `submit`
- `cancel`
- `consume`

## Read-Model Meaning
- `requestNo` is the operator-facing primary identifier.
- `targetNo` is the canonical lookup key for admin create and detail flows.
- `targetSnapshotJson` preserves the target view captured at request creation and final consume.
- `targetSnapshotDigest` carries the stored snapshot digest when the request keeps one.
- `resultNote` captures the final consume outcome note.
