Status: active
Owner: project-owner-and-agents
Last Updated: 2026-03-22
Applies To: `Exchange_js`
Supersedes: none
Depends On: `docs/constraints/compliance-alert-incident-constraints.md`, `docs/constraints/onboarding-alert-case-workflow-stage-rule-mapping.md`
Source of Truth Level: specs-entity

# Compliance Alert Entity

## Purpose
- This document defines the canonical entity semantics for compliance `Alert`.
- It freezes the alert meaning used by triage, workflow decision, and escalation into case.

## Entity Role
- `Alert` is the triage kernel.
- It owns:
  - rule hit aggregation
  - assignment
  - triage outcome
  - workflow decision at alert level
  - escalation into case
- It is not the full investigation record.

## Canonical Fields
- Identity:
  - `id`
  - `alertNo`
- Assignment:
  - `assigneeUserId`
  - `assigneeUserNo`
- Runtime classification:
  - `workflow`
  - `stage`
  - `rule`
  - `severity`
- Triage lifecycle:
  - `status`
  - `assignedAt`
  - `dueAt`
  - `closedAt`
- Triage conclusion:
  - `currentDispositionCode`
  - `finalDispositionCode`
  - `availableAlertActions`
  - `availableWorkflowActions`
- Trace:
  - `traceId`
  - `workflowType`
  - `workflowId`
  - `workflowNo`

## Canonical Outcome Model
- Alert outcome is distinct from workflow decision.
- Canonical alert outcomes are:
  - `FALSE_POSITIVE`
  - `ESCALATE_TO_CASE`
  - `RESOLVED_BY_WORKFLOW`
- Canonical workflow decisions for workflow-bound alerts are:
  - `CLEAR`
  - `REJECT`
  - `REQUIRE_EDD`

## Assignment Rule
- Workflow actions are visible and executable only when:
  - alert is workflow-bound
  - alert status is `ASSIGNED`
  - current actor is the assignee
- `OPEN` alert may allow assignment actions, but not workflow decision actions.

## Historical / Retired Semantics
- `RESOLVED` is historical read compatibility only.
- Legacy vocabulary such as `APPROVE_STAGE / REJECT_STAGE / NO_ACTION` is normalization-only and not active runtime truth.
