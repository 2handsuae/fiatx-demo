> **DEPRECATED** — This document describes logic that has been removed or replaced.
> Archived on 2026-04-11. Wave 2 compliance content moved to Sumsub.
>
> Replacement: Wave 2 compliance domain fully migrated to Sumsub integration.

Status: active
Owner: project-owner-and-agents
Last Updated: 2026-03-22
Applies To: `Exchange_js`
Supersedes: none
Depends On: `docs/constraints/compliance-alert-incident-constraints.md`, `docs/specs/workflows/case-final-lifecycle-and-external-filing.md`
Source of Truth Level: specs-entity

# Compliance Case Entity

## Purpose
- This document defines the canonical entity semantics for compliance `Case`.
- It freezes the durable field meaning used by admin case list/detail, workflow-bound case handling, MLRO review, and external filing follow-up.

## Related Canonical Docs
- `docs/specs/entities/compliance-case-report-entity.md`
- `docs/specs/entities/compliance-external-filing-entity.md`
- `docs/specs/workflows/alert-triage-and-case-escalation.md`
- `docs/specs/workflows/case-final-lifecycle-and-external-filing.md`
- `docs/specs/modules/compliance-center-module.md`

## Entity Role
- `Case` is the investigation kernel.
- It owns:
  - investigation lifecycle
  - linked alerts
  - workflow proposal
  - final disposition governance
  - interim measures
  - external filing follow-up
- It is not a provider response container or approval object.

## Canonical Fields
- Identity:
  - `id`
  - `caseNo`
- Assignment:
  - `assigneeUserId`
  - `assigneeUserNo`
- Runtime classification:
  - `caseType`
  - `workflow`
  - `stage`
  - `rule`
- Lifecycle:
  - `status`
  - `assignedAt`
  - `dueAt`
  - `closedAt`
  - `closeReason`
- Governance proposal / outcome:
  - `proposedWorkflowDecision`
  - `proposedFinalDispositionCode`
  - `proposedFinalDispositionReason`
  - `finalDispositionCode`
  - `finalDispositionReason`
- Filing:
  - `filingStatus`
  - `currentFiling`
  - `filingHistory`
  - `availableFilingActions`
- Trace:
  - `traceId`
  - `workflowType`
  - `workflowId`
  - `workflowNo`

## Workflow-Bound Meaning
- Workflow-bound case means `workflow / stage / rule` are present and explain why the case exists.
- Workflow proposal stays distinct from case final disposition.
- Canonical workflow proposal values are:
  - `CLEAR`
  - `REJECT`
  - `REQUIRE_EDD`
- Canonical case final disposition values are:
  - `CLEAR`
  - `FALSE_POSITIVE`
  - `RISK_CONFIRMED`

## Filing Boundary
- `External Filing` is the only primary runtime filing model.
- Legacy `reportStatus / reportRefNo / reportedAt / reportReason` are not part of the active case contract.
- Historical report-mirror fields MUST NOT drive:
  - current filing selection
  - filing status
  - filing action availability

## Read / Write Ownership
- Investigator writes:
  - report draft/finalize
  - workflow proposal
  - proposed final disposition
  - interim measures
- MLRO writes:
  - return for investigation
  - approve final disposition
- Filing owner writes:
  - filing submit
  - filing feedback
  - filing close

## Historical / Retired Fields
- The following are retired from active runtime case contract:
  - `incidentNo`
  - `ownerUserId`
  - `ownerUserNo`
  - `reportStatus`
  - `reportRefNo`
  - `reportedAt`
  - `reportReason`
- They may remain only in:
  - migrations
  - normalization/backfill helpers
  - historical fixtures
  - archived cleanup context
