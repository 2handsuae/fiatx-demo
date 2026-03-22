Status: active
Owner: project-owner-and-agents
Last Updated: 2026-03-22
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

## Action Groups
- `Alert Actions`
  - assignment and triage outcome
- `Workflow Actions`
  - workflow-bound business decision
- `Case Actions`
  - assignment and linked-alert management after escalation

## Triage Rules
- `OPEN` alert may be assigned, but workflow actions are not available yet.
- Workflow actions are allowed only when:
  - alert is workflow-bound
  - alert is `ASSIGNED`
  - current actor is the assignee
- Canonical triage outcomes are:
  - `FALSE_POSITIVE`
  - `ESCALATE_TO_CASE`
  - `RESOLVED_BY_WORKFLOW`

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
