Status: active
Owner: project-owner-and-agents
Last Updated: 2026-03-22
Applies To: `Exchange_js`
Supersedes: none
Depends On: `docs/specs/workflows/periodic-review-canonical-workflow.md`
Source of Truth Level: specs-entity

# Periodic Review Cycle Entity

## Purpose
- This document defines the canonical semantics for `PeriodicReviewCycle` as the workflow-root entity of periodic review.

## Canonical Fields
- `id`
- `cycleNo`
- `customerId`
- `status`
- `dueAt`
- `triggeredAt`
- `clearedAt`
- `rejectedAt`
- `currentCddResponseId`
- `currentEddResponseId`
- `primaryAlertId`
- `primaryIncidentId` as the current physical linked-case anchor
- `latestDecisionRecordId`
- `resolutionReason`

## Lifecycle Anchor
- Current runtime cycle status values are:
  - `PENDING_CDD_INPUT`
  - `CDD_UNDER_REVIEW`
  - `PENDING_EDD_INPUT`
  - `EDD_UNDER_REVIEW`
  - `CLEARED`
  - `REJECTED`

## Write Owners
- Periodic review scheduler creates due cycles.
- Periodic review service owns response/cycle linkage.
- Compliance center and transition services update linked alert/case anchors and resolution outcome.

## Related Workflow Binding
- `PeriodicReviewCycle` is the workflow root for:
  - response
  - alert
  - case
  - MLRO
  - filing when applicable
- Canonical trace is:
  - `PERIODIC_REVIEW:<cycle.id>`

## Historical / Retired Notes
- `primaryIncidentId` is the current physical name for linked case anchor.
- It should be read as the linked compliance case reference, not as proof that incident-named runtime remains canonical.
