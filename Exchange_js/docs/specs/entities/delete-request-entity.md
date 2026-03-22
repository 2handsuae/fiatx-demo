Status: active
Owner: project-owner-and-agents
Last Updated: 2026-03-22
Applies To: `Exchange_js`
Supersedes: none
Depends On: `docs/specs/workflows/delete-request-soft-delete-workflow.md`
Source of Truth Level: specs-entity

# Delete Request Entity

## Purpose
- This document defines the canonical semantics for `Delete Request` as the Wave 1 governed soft-delete object.

## Canonical Fields
- `id`
- `requestNo`
- `targetType`
- `targetId`
- `targetNo`
- `status`
- `latestApprovalId`
- `latestApprovalStatus`
- `makerUserId`
- `submittedByUserId`
- `executedByUserId`
- `deleteReason`
- `docRef`
- `targetSnapshotJson`
- `traceId`
- `submittedAt`
- `executedAt`

## Lifecycle Anchor
- Delete request is the governance root for soft-delete approval and execute flow.
- Approval result projects to request status, but approval remains a separate governance object.
- Execute writes standardized delete fields onto the target object instead of deleting the governance chain.

## Write Owners
- `DeleteRequestsService` owns request creation, target validation, snapshot capture, and execute behavior.
- `ApprovalsService` owns approval lifecycle and execution-result projection.

## Read-Model Meaning
- `requestNo` is the operator-facing primary identifier.
- `targetNo` is the canonical admin-facing lookup value for create, list, and detail flows.
- `targetSnapshotJson` preserves the pre-delete target view for after-the-fact review.
- `latestApprovalStatus` keeps the real approval terminal status even when request status mirrors to `REJECTED`.

## Supported Targets
- `CHANGE_TICKET`
- `AUDIT_EVIDENCE_PACKAGE`
- `COMPLIANCE_CASE_EVIDENCE_PACKAGE`
- `ADMIN_USER`

## Historical / Retired Notes
- `APPROVAL_CASE` is not a supported target and is retired runtime history.
- This entity does not define undelete or hard-delete semantics.
