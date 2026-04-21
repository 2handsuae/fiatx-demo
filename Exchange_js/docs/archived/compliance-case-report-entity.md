> **DEPRECATED** — This document describes logic that has been removed or replaced.
> Archived on 2026-04-11. Wave 2 compliance content moved to Sumsub.
>
> Replacement: Wave 2 compliance domain fully migrated to Sumsub integration.

Status: active
Owner: project-owner-and-agents
Last Updated: 2026-03-22
Applies To: `Exchange_js`
Supersedes: none
Depends On: `docs/specs/entities/compliance-case-entity.md`, `docs/specs/workflows/case-final-lifecycle-and-external-filing.md`
Source of Truth Level: specs-entity

# Compliance Case Report Entity

## Purpose
- This document defines the canonical semantics for `Case Report` as an entity distinct from case and filing.

## Canonical Fields
- `id`
- `incidentId` as the physical case foreign-key anchor
- `version`
- `isCurrent`
- `status`
- `workflow`
- `stage`
- `ruleCode`
- `factsSummary`
- `investigationScope`
- `evidenceSummary`
- `containmentSummary`
- `analystConclusion`
- `recommendedActions`
- `finalDispositionCode`
- `finalDispositionReason`
- `filingRequired`
- `filingType`
- `filingAuthority`
- `linkedAlertSnapshot`
- `decisionRecordSnapshot`
- `providerResponseSnapshot`
- `createdByUserId / createdByUserNo`
- `finalizedByUserId / finalizedByUserNo`
- `finalizedAt`
- `supersededAt`

## Lifecycle Anchor
- Canonical status values are:
  - `DRAFT`
  - `FINALIZED`
  - `SUPERSEDED`

## Write Owners
- Investigator owns report drafting and finalization.
- MLRO reviews the case governance outcome, not the report object as a separate approval entity.

## Related Workflow Binding
- Case report holds proposal data used before MLRO approval:
  - workflow proposal
  - final disposition proposal
  - filing proposal
- Finalized report is evidence for the case and may later be superseded.

## Historical / Retired Fields
- Legacy `reportStatus / reportRefNo / reportedAt / reportReason` are not report-entity fields.
- Those legacy fields belong to historical compatibility projection only.
