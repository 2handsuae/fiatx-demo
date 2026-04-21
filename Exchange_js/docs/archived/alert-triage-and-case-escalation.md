> **DEPRECATED** — This document describes logic that has been removed or replaced.
> Archived on 2026-04-11. Wave 2 compliance content moved to Sumsub.
>
> Replacement: Wave 2 compliance domain fully migrated to Sumsub integration.

Status: active
Owner: project-owner-and-agents
Last Updated: 2026-03-26
Applies To: `Exchange_js`
Supersedes: none
Depends On: `docs/constraints/compliance-alert-incident-constraints.md`, `docs/specs/entities/compliance-alert-entity.md`, `docs/specs/entities/compliance-case-entity.md`
Source of Truth Level: specs-workflow

# Alert Triage And Case Escalation

## Purpose
- This document defines the shared alert-triage and case-escalation workflow used by Wave 2 kernel consumers.

## Actors
- `Triage Operator`
- `Investigator`
- `MLRO`

## Alert State Model
- `OPEN`
- `ASSIGNED`
- `ESCALATED`
- `CLOSED`

## Alert Handling
- Alert detail uses one canonical handling surface: `Alert Handling`.
- `Alert Handling` combines:
  - work-item ownership actions
  - alert-level resolution actions
- Canonical handling actions are:
  - `ASSIGN`
  - `REASSIGN`
  - `FALSE_POSITIVE`
  - `DIRECT_DISPOSITION`
  - `ESCALATE_TO_CASE`

## Primary Object Binding
- Workflow-bound alert resolution operates on one fixed `primaryObject`.
- `primaryObject` is chosen by alert type and is not user-selectable in the UI.
- Current fixed mapping is:
  - `ONBOARDING_JOURNEY -> Onboarding Journey`
  - `PERIODIC_REVIEW_CYCLE -> Periodic Review Cycle`
  - `DEPOSIT -> Deposit`

## Direct Disposition Proposal Set
- `FALSE_POSITIVE` never requires analyst proposal selection.
- `FALSE_POSITIVE` records an implied proceed semantic for audit, then resumes the bound workflow through canonical callback logic.
- `DIRECT_DISPOSITION` is the only alert-level path that applies a single-object negative proposal.
- Current direct proposals are:
  - onboarding / periodic review `REVIEW_CDD`: `REJECT`, `REQUIRE_EDD`
  - onboarding / periodic review `REVIEW_EDD`: `REJECT`
  - deposit review alerts: `REJECT`, `FREEZE_TRANSACTION`

## Triage Rules
- `OPEN` alert may be assigned, but no resolution action is available yet.
- Resolution actions are allowed only when:
  - alert is workflow-bound
  - alert is `ASSIGNED`
  - current actor is the assignee
- Canonical resolution outcomes are:
  - `FALSE_POSITIVE`
  - `DIRECT_DISPOSITION`
  - `ESCALATE_TO_CASE`

## Escalation Rules
- `ESCALATE_TO_CASE` creates or links a compliance case.
- Escalation is triage-only and does not advance onboarding or periodic review by itself.
- Escalation must preserve upstream workflow trace.

## Workflow-Bound Vs Generic
- Workflow-bound alert/case carries:
  - `workflow`
  - `stage`
  - `rule`
- Generic or transaction cases may reuse the same alert/case kernel without onboarding-specific transitions.

## Non-Goals
- This document does not define MLRO approval or external filing lifecycle in detail.
