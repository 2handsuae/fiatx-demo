Status: active
Owner: project-owner-and-agents
Last Updated: 2026-03-22
Applies To: `Exchange_js`
Supersedes: none
Depends On: `docs/specs/entities/risk-decision-record-entity.md`
Source of Truth Level: specs-module

# Risk Engine Module

## Purpose
- This module owns risk evaluation, decision recording, recommendation projection, and orchestration into downstream alert/case workflows.

## Bounded Context
- Risk engine is upstream of compliance center.
- It produces decision records and recommendation signals.
- It does not own alert/case lifecycle directly.

## Canonical Entrypoints
- Decision records:
  - `GET /admin/risk/decision-records`
  - `GET /admin/risk/decision-records/:id`
- Internal kernel services:
  - `RiskDecisionRecordsService`
  - `RiskDecisionOrchestratorService`

## Integration Contract
- Upstream business modules submit evaluation context and evidence containers.
- Downstream modules consume:
  - decision record snapshots
  - orchestration outcome
  - recommendation projection
- Workflow-bound trace and owner context must be propagated into downstream audit and orchestration.

## Historical Aliases / Retired Names
- Current physical model name `WorkflowDecisionRecord` is historical implementation naming.
- Canonical meaning is risk decision record.

## MUST / MUST NOT
- MUST treat decision record as the root explanation object for recommendation and orchestration.
- MUST NOT treat decision record as alert/case itself.
- MUST NOT mint a new workflow trace when orchestrating workflow-bound alert/case.
