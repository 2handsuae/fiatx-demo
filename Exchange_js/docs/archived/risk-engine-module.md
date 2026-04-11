Status: active
Owner: project-owner-and-agents
Last Updated: 2026-03-24
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
  - `RiskEngineService`
  - `RiskDecisionRecordsService`
  - `RiskDecisionOrchestratorService`

## Integration Contract
- Upstream business modules submit evaluation context and evidence containers.
- Downstream modules consume:
  - decision record snapshots
  - orchestration outcome
  - recommendation projection
- Workflow-bound trace and owner context must be propagated into downstream audit and orchestration.

## Current Transaction Contexts
- Current transaction-side contexts include:
  - `TX_DEPOSIT_KYT_MAIN`
  - `TX_DEPOSIT_TRAVEL_RULE`
- Deposit-side transaction evaluation is fed by transaction compliance aggregate and derived screening status.
- Decision record output is the explanation root before:
  - alert upsert
  - case escalation
  - workflow-bound deposit callback
- Risk engine remains upstream of those consumers and does not directly own deposit status writes.

## Historical Aliases / Retired Names
- Current physical model name `WorkflowDecisionRecord` is historical implementation naming.
- Canonical meaning is risk decision record.

## MUST / MUST NOT
- MUST treat decision record as the root explanation object for recommendation and orchestration.
- MUST NOT treat decision record as alert/case itself.
- MUST NOT mint a new workflow trace when orchestrating workflow-bound alert/case.
