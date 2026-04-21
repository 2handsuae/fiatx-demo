> **DEPRECATED** — This document describes logic that has been removed or replaced.
> Archived on 2026-04-11. Wave 2 compliance content moved to Sumsub.
>
> Replacement: Wave 2 compliance domain fully migrated to Sumsub integration.

Status: active
Owner: project-owner-and-agents
Last Updated: 2026-03-26
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
  - triage resolution
  - single-object direct disposition at alert level
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
  - `primaryObject`
  - `availableHandlingActions`
  - `availableDirectProposals`
- Trace:
  - `traceId`
  - `workflowType`
  - `workflowId`
  - `workflowNo`

## Canonical Outcome Model
- Alert outcome is distinct from case-level proposal and MLRO approval.
- Canonical alert outcomes are:
  - `FALSE_POSITIVE`
  - `ESCALATE_TO_CASE`
  - `DIRECT_DISPOSITION`
- Canonical direct proposals for workflow-bound alerts are:
  - onboarding / periodic review `REVIEW_CDD`: `REJECT`, `REQUIRE_EDD`
  - onboarding / periodic review `REVIEW_EDD`: `REJECT`
  - deposit review alerts: `REJECT`, `FREEZE_TRANSACTION`

## Assignment Rule
- Resolution actions are visible and executable only when:
  - alert is workflow-bound
  - alert status is `ASSIGNED`
  - current actor is the assignee
- `OPEN` alert may allow assignment actions, but not resolution actions.

## Canonical Admin Contract
- `PATCH /admin/compliance/alerts/:id/action` is the work-item-only public route.
- `POST /admin/compliance/alerts/:id/resolve` is the only canonical alert resolution route.
- Removed onboarding-specific and periodic-review-specific alert decision routes are not part of the active contract.

## Historical / Retired Semantics
- `RESOLVED` is historical read compatibility only.
- Legacy vocabulary such as `APPROVE_STAGE / REJECT_STAGE / NO_ACTION` is normalization-only and not active runtime truth.
