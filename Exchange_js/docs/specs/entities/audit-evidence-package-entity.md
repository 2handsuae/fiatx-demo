Status: active
Owner: project-owner-and-agents
Last Updated: 2026-03-22
Applies To: `Exchange_js`
Supersedes: none
Depends On: `docs/specs/workflows/audit-evidence-export-approval-workflow.md`
Source of Truth Level: specs-entity

# Audit Evidence Package Entity

## Purpose
- This document defines the canonical semantics for `Audit Evidence Package` as the Wave 1 governed export object for `Audit Center`.

## Canonical Fields
- `id`
- `packageNo`
- `approvalCaseId`
- `exportedByType`
- `exportedById`
- `exportedByRole`
- `status`
- `exportMode`
- `fileName`
- `filterSnapshot`
- `selectedEventIdsSnapshot`
- `itemCount`
- `digest`
- `manifest`
- `packageBody`
- `deletedAt`
- `deletedBy`
- `deleteRequestId`
- `deleteReason`

## Lifecycle Anchor
- Package request is created before approval completes.
- Approval is a linked governance object, not an embedded package status mirror.
- Downloadable evidence requires both:
  - linked approval allowed to execute
  - package status `READY`

## Write Owners
- `AuditEvidenceExportApprovalService` owns request creation and final package artifact generation.
- `ApprovalsService` owns the linked approval lifecycle and execution result projection.
- `DeleteRequestsService` may retire the package through governed soft deletion.

## Read-Model Meaning
- `packageNo` is the operator-facing identifier.
- `filterSnapshot` and `selectedEventIdsSnapshot` preserve export intent at request time.
- `manifest` and `packageBody` represent the persisted evidence package output.
- Soft-deleted packages remain historically traceable through delete-request detail, but disappear from normal export list/detail/download flows.

## Related / Parallel Objects
- `Compliance Case Evidence Package` is a separate export object with aligned approval and soft-delete semantics.
- Audit evidence package remains the canonical Wave 1 object for `Audit Center` export, not a generic evidence container for all domains.

## Historical / Retired Notes
- Direct package generation without approval is retired runtime behavior.
