Status: active
Owner: project-owner-and-agents
Last Updated: 2026-03-22
Applies To: `Exchange_js`
Supersedes: none
Depends On: `docs/constraints/governance-approval-constraints.md`, `docs/constraints/governance-change-ticket-constraints.md`, `docs/constraints/governance-delete-request-constraints.md`, `docs/constraints/governance-sla-timer-constraints.md`, `docs/constraints/audit-logging-constraints.md`
Source of Truth Level: specs-module

# Governance Control Foundation Module

## Purpose
- This document defines the durable Wave 1 control foundation that later waves reuse for:
  - approval-backed control gates
  - audit evidence export
  - soft-delete governance
  - release gate blocking
  - governance SLA timing

## Canonical Module Boundary
- Canonical implementations remain under:
  - `src/modules/risk-engine/audit-logs`
  - `src/modules/governance/approvals`
  - `src/modules/governance/change-tickets`
  - `src/modules/governance/delete-requests`
  - `src/modules/governance/sla-timers`
- `Wave 1` control foundation is a shared governance surface, not a single monolith service.
- `WF-GOV-02` filing / receipt / effectiveness semantics are explicitly out of scope for this module.

## Canonical Entrypoints
- Audit Center:
  - `GET /admin/audit-logs`
  - `GET /admin/audit-logs/:id`
  - `POST /admin/audit-logs/export/evidence-package`
- Control Gates:
  - `GET /admin/control-gates/approvals`
  - `GET /admin/control-gates/change-tickets`
  - `GET /admin/control-gates/delete-requests`
  - `GET /admin/control-gates/sla-timers`

## Shared Control Contracts
- Operator-facing No-first identifiers remain:
  - `approvalNo`
  - `ticketNo`
  - `requestNo`
  - `timerNo`
  - `packageNo`
- Control workflows MUST preserve:
  - `traceId`
  - `workflowType`
  - `workflowNo`
  - `subjectNos`
- Canonical Wave 1 governance taxonomy remains limited to:
  - approval action types in `docs/constraints/governance-approval-constraints.md`
  - change ticket types in `docs/constraints/governance-change-ticket-constraints.md`
  - delete request target types in `docs/constraints/governance-delete-request-constraints.md`
  - SLA types in `docs/constraints/governance-sla-timer-constraints.md`

## Historical Aliases / Retired Paths
- `AuditLogsService.exportEvidencePackage()` direct export bypass is retired runtime history and MUST NOT be reintroduced.
- `APPROVAL_CASE` is not a supported delete-request target and MUST NOT return as a compatibility alias.
- Generic or trading-oriented change-ticket type values are retired for active Wave 1 governance runtime.

## MUST / MUST NOT
- MUST route control-gate audit through `AuditLogsService`.
- MUST keep audit evidence export approval-backed.
- MUST use approval engine for:
  - audit evidence export
  - change ticket approval
  - delete request approval
- MUST keep Wave 1 control foundation documentation truth in:
  - `docs/constraints/**`
  - `docs/specs/**`
  - `docs/acceptance/**`
- MUST NOT bypass approval state, delete shared approval objects directly, or write audit tables ad hoc from feature modules.
