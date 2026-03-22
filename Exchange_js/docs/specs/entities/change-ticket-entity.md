Status: active
Owner: project-owner-and-agents
Last Updated: 2026-03-22
Applies To: `Exchange_js`
Supersedes: none
Depends On: `docs/specs/workflows/change-ticket-release-gate-workflow.md`
Source of Truth Level: specs-entity

# Change Ticket Entity

## Purpose
- This document defines the canonical semantics for `Change Ticket` as the Wave 1 governance release-control object.

## Canonical Fields
- `id`
- `ticketNo`
- `status`
- `changeType`
- `scopeSummary`
- `riskLevel`
- `testEvidenceRef`
- `rollbackPlanRef`
- `latestApprovalId`
- `latestApprovalStatus`
- `traceId`
- `emergency`
- `emergencyReason`
- `postApprovalDueAt`
- `postApprovalCompletedAt`
- `createdByUserId`
- `submittedByUserId`
- `closedByUserId`
- `submittedAt`
- `deployedAt`
- `closedAt`
- `deletedAt`
- `deletedBy`
- `deleteRequestId`
- `deleteReason`

## Lifecycle Anchor
- Change ticket is the workflow root for Wave 1 release gate semantics.
- Approval terminal state projects into ticket state, but approval remains a separate governance object.
- Gate runs are subordinate execution records attached to the ticket.

## Write Owners
- `ChangeTicketsService` owns ticket lifecycle and approval binding.
- `ReleaseGatesService` owns gate-run evaluation and deploy gate checks.
- `DeleteRequestsService` may soft-delete closed tickets.

## Read-Model Meaning
- `ticketNo` is the operator-facing primary identifier.
- `latestApprovalStatus` preserves actual approval terminal truth even when ticket status maps to `REJECTED`.
- `postApprovalDueAt` and `postApprovalCompletedAt` exist only for emergency post-approval follow-up semantics.

## Historical / Retired Notes
- `APPROVED` is not a stable `change_tickets.status`.
- Generic or trading-oriented `changeType` values are retired runtime history and are not canonical Wave 1 truth.
