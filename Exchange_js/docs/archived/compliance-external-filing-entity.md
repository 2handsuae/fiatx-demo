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

# Compliance External Filing Entity

## Purpose
- This document defines the canonical semantics for `External Filing` as a case-follow-up entity distinct from case report and case final disposition.

## Canonical Fields
- `id`
- `filingNo`
- `incidentId` as physical case foreign-key anchor
- `filingType`
- `filingAuthority`
- `status`
- `requiredAt`
- `requiredById / requiredByNo / requiredByRole`
- `submittedAt`
- `submittedById / submittedByNo / submittedByRole`
- `externalRefNo`
- `latestFeedback`
- `latestFeedbackAt`
- `latestFeedbackById / latestFeedbackByNo / latestFeedbackByRole`
- `closedAt`
- `closedById / closedByNo / closedByRole`
- `metadata`

## Lifecycle Anchor
- Canonical filing lifecycle values are:
  - `REQUIRED`
  - `SUBMITTED`
  - `ACKNOWLEDGED`
  - `RETURNED`
  - `CLOSED`

## Write Owners
- Filing owner records submit / feedback / close actions.
- MLRO may require filing through case approval, but filing remains a separate entity.

## Related Workflow Binding
- Filing inherits the same workflow trace as the upstream case when workflow-bound.
- Filing follow-up does not reopen the case.

## Historical / Retired Fields
- `reportStatus / reportRefNo / reportedAt / reportReason` are compatibility mirrors only.
- Historical heuristic backfill rows may remain stored, but they do not replace canonical filing semantics.
