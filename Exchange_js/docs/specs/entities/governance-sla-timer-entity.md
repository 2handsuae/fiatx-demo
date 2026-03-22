Status: active
Owner: project-owner-and-agents
Last Updated: 2026-03-22
Applies To: `Exchange_js`
Supersedes: none
Depends On: `docs/specs/workflows/governance-sla-timer-workflow.md`
Source of Truth Level: specs-entity

# Governance SLA Timer Entity

## Purpose
- This document defines the canonical semantics for Wave 1 governance SLA timer records and their notification registry.

## Canonical Fields
- `id`
- `timerNo`
- `workflowType`
- `workflowId`
- `workflowNo`
- `subjectType`
- `subjectId`
- `subjectNo`
- `timerType`
- `ownerUserId`
- `status`
- `dueAt`
- `graceSeconds`
- `traceId`
- `contextJson`
- `closedAt`
- `expiredAt`
- `activeKey`
- `notifications[]`

## Lifecycle Anchor
- Timer is the workflow-bound SLA object.
- Notification rows are subordinate registry records attached to a timer.
- Active uniqueness is expressed through `activeKey`, not a business-visible timer status.

## Write Owners
- `ApprovalSlaProjectionService` and `ChangeTicketSlaProjectionService` own workflow-bound timer creation and refresh.
- `SlaTimersService` owns operator actions such as list, detail, recalc, and close.
- `SlaTimerSweepService` owns automatic expiry and notification trigger behavior.

## Read-Model Meaning
- `timerNo` is the operator-facing primary identifier.
- `workflowNo` and `subjectNo` are mandatory query anchors for admin search and replay.
- `contextJson` carries workflow-specific computation context, but does not replace typed timer taxonomy.
- Notification timeline is derived from related `SlaNotification` rows.

## Companion Notification Fields
- `notificationType`
- `status`
- `scheduledAt`
- `triggeredAt`
- `reasonCode`
- `message`
- `metadataJson`

## Historical / Retired Notes
- `DUE_SOON`, `BREACHED`, and `CANCELLED` are not valid timer states in Wave 1.
- `sla_notifications` is a registry, not an outbound messaging system.
