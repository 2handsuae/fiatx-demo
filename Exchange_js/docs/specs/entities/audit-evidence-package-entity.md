Status: active
Owner: project-owner-and-agents
Last Updated: 2026-04-03
Applies To: `Exchange_js`
Supersedes: none
Depends On: `docs/specs/workflows/audit-evidence-export-approval-workflow.md`
Source of Truth Level: specs-entity

# Audit Evidence Package Entity

## Purpose
- This document defines the canonical semantics for `Audit Evidence Package` as the governed export object for `Audit Center`.

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
- `manifest` and `packageBody` represent the persisted governed evidence package output assembled from typed event records and optional context snapshots.
- Soft-deleted packages remain historically traceable through delete-request detail, but disappear from normal export list/detail/download flows.

## Payload Contract
- `packageBody` MUST stay domain-neutral at the entity level.
- `manifest` MAY list typed records, filters, hashes, and operator-visible metadata.
- `packageBody` MAY include `records` plus optional context snapshots, but the package entity does not prescribe domain-specific assembly rules.
- Domain-specific snapshot composition belongs in the export workflow and downstream builders, not in this entity definition.

## Related / Parallel Objects
- `Compliance Case Evidence Package` is a separate export object with aligned approval and soft-delete semantics.
- Audit evidence package remains the canonical export object for `Audit Center`, not a transaction snapshot container for any one domain.

## Historical / Retired Notes
- Direct package generation without approval is retired runtime behavior.
