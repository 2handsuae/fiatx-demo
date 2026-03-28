Status: active
Owner: project-owner-and-agents
Last Updated: 2026-03-28
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

## Wave 5 Deposit Snapshot Extension
- For deposit-root exports, `packageBody.snapshots` now extends beyond `deposit / payin / provider response` summary.
- Deposit evidence snapshots MUST support these collections:
  - `deposits`
  - `kytCases`
  - `travelRuleCases`
  - `riskDecisionRecords`
  - `alerts`
  - `cases`
  - `journals`
  - `internalTransactions`
  - `internalFunds`
  - `depositEvidenceChain`
- `depositEvidenceChain` is the replay-oriented aggregate keyed by deposit identity.
- Each `depositEvidenceChain` item MAY include:
  - `depositId`
  - `depositNo`
  - `payinId`
  - `payinNo`
  - `decisionRecordIds`
  - `kytCaseIds`
  - `travelRuleCaseIds`
  - `alertIds`
  - `caseIds`
  - `journalIds`
  - `internalTransactionIds`
  - `internalFundIds`
- Deposit evidence package semantics remain approval-backed and do not create a separate deposit-only export engine.

## Wave 7 Withdraw Snapshot Extension
- For withdraw-root exports, `packageBody.snapshots` extends to the outbound business root and execution root together.
- Withdraw evidence snapshots MUST support these collections:
  - `withdrawTransactions`
  - `payouts`
  - `preKytCases`
  - `mainKytCases`
  - `travelRuleCases`
  - `riskDecisionRecords`
  - `alerts`
  - `cases`
  - `journals`
  - `clearings`
  - `reconciliationBreaks`
  - `withdrawEvidenceChain`
- `withdrawEvidenceChain` is the replay-oriented aggregate keyed by withdraw identity.
- Each `withdrawEvidenceChain` item MAY include:
  - `withdrawId`
  - `withdrawNo`
  - `payoutId`
  - `payoutNo`
  - `decisionRecordIds`
  - `preKytCaseIds`
  - `mainKytCaseIds`
  - `travelRuleCaseIds`
  - `alertIds`
  - `caseIds`
  - `journalIds`
  - `clearingIds`
  - `reconciliationBreakIds`
- Withdraw evidence export remains approval-backed and does not create a second withdraw-only export API.

## Related / Parallel Objects
- `Compliance Case Evidence Package` is a separate export object with aligned approval and soft-delete semantics.
- Audit evidence package remains the canonical Wave 1 object for `Audit Center` export, not a generic evidence container for all domains.

## Historical / Retired Notes
- Direct package generation without approval is retired runtime behavior.
