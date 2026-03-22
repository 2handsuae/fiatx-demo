Status: active
Owner: project-owner-and-agents
Last Updated: 2026-03-21
Applies To: `Exchange_js`
Supersedes: none
Depends On: `docs/roadmap/wave-2-compliance-foundation-phase-plan.md`, `docs/constraints/compliance-alert-case-foundation-constraints.md`, `docs/constraints/compliance-alert-incident-constraints.md`
Source of Truth Level: specs-workflow

# Case Final Lifecycle And External Filing

## Purpose
- This document defines the long-term semantic model for the final lifecycle of a compliance `Case`.
- It exists to separate:
  - `Investigation Report`
  - `Workflow Decision`
  - `Final Disposition`
  - `Measures`
  - `External Filing`
- It is the durable workflow truth for post-investigation case handling.

## Related Canonical Docs
- Entity truth:
1. `docs/specs/entities/compliance-case-entity.md`
2. `docs/specs/entities/compliance-case-report-entity.md`
3. `docs/specs/entities/compliance-external-filing-entity.md`
- Module truth:
1. `docs/specs/modules/compliance-center-module.md`
2. `docs/specs/modules/approvals-module.md`

## Core Principle
- `Workflow Decision` answers: how a workflow-bound case moves the embedded business workflow.
- `Final Disposition` answers: how the case itself is concluded.
- `Measures` answer: what controls were applied to the customer or activity.
- `External Filing` answers: whether the case requires filing to an external authority and what the filing outcome is.
- These four dimensions MUST NOT be collapsed into a single `disposition` or `reportStatus` field.

## Actors
- `Investigator`
  - owns investigation, evidence collection, and report drafting
  - may apply interim measures
  - may propose workflow decision and final disposition
- `MLRO`
  - owns final governance review before a case conclusion becomes effective
  - may approve or return a case for further investigation
- `Filing Owner`
  - owns external filing follow-up after a case has reached a reportable conclusion
  - may be the MLRO or another explicitly assigned role in a later implementation phase

## Lifecycle Layers

### 1. Investigation Report
- `Investigation Report` is the formal investigation record.
- Its lifecycle is:
  - `DRAFT`
  - `FINALIZED`
  - `SUPERSEDED`
- It answers whether the investigation write-up has been prepared, finalized, or replaced.
- It does NOT answer whether the case is reportable to an external authority.

### 2. Workflow Decision
- `Workflow Decision` exists only for workflow-bound cases such as onboarding or periodic review.
- Canonical values are:
  - `CLEAR`
  - `REQUIRE_EDD`
  - `REJECT`
- It answers how the embedded business workflow should move.
- It is NOT the case final disposition.

### 3. Final Disposition
- `Final Disposition` is the case conclusion.
- It answers how the case itself is concluded after investigation and governance review.
- It MUST remain distinct from `Workflow Decision`.
- The exact transaction/generic disposition taxonomy may expand later; this document only freezes the separation, not the full future enum list.

### 4. Measures
- `Measures` are customer or activity controls applied during or after investigation.
- Minimum current measure vocabulary is:
  - `FREEZE`
  - `UNFREEZE`
  - `RESTRICT`
  - `UNRESTRICT`
- Measures are not a replacement for final disposition.
- Measures may occur before final disposition and may be revised multiple times.

### 5. External Filing
- `External Filing` is independent from report lifecycle.
- `External Filing` is the only primary runtime model for filing lifecycle.
- It answers:
  - whether a filing is required
  - which authority receives the filing
  - filing status
  - filing reference and external feedback
- Minimum future target fields are:
  - `filingRequired`
  - `filingType`
  - `filingAuthority`
  - `filingStatus`
  - `filedAt`
  - `filedBy`
  - `externalRefNo`
  - `externalFeedback`
- `REPORT` is only an internal conclusion that a case must enter the external filing dimension.
- `REPORT` does NOT mean an `STR`, `SAR`, `VARA`, or `FIU` filing has already been submitted.
- Legacy `reportStatus / reportRefNo / reportedAt / reportReason` fields are compatibility mirrors only.
- Legacy report mirror fields MUST NOT override canonical `currentFiling`, `filingStatus`, or filing actions.

## Case Final Lifecycle

### Standard Path
1. investigate case
2. draft investigation report
3. finalize investigation report
4. submit to MLRO
5. MLRO approves final disposition or returns for investigation
6. if approved:
   - final disposition becomes effective
   - workflow decision executes if the case is workflow-bound
   - case closes
7. if external filing is required:
   - filing follow-up continues in a separate external filing dimension

### Return Path
1. investigator submits finalized report and proposals
2. MLRO returns the case for investigation
3. case returns to investigation state
4. finalized report remains historical evidence
5. investigator produces a new draft or superseding report version

## Scenario Notes

### Workflow-Bound Case
- Examples:
  - onboarding review case
  - periodic review case
- The case may propose:
  - `CLEAR`
  - `REQUIRE_EDD`
  - `REJECT`
- The case may also apply measures such as `FREEZE` or `RESTRICT`, but these do not replace workflow decision.

### Investigation-Heavy Case
- Examples:
  - transaction compliance case
  - generic investigation case
- The case may apply interim measures first, continue investigation, and only later determine:
  - final disposition
  - whether external filing is required
- A case may conclude with a reportable outcome without changing an onboarding-style workflow.

## Historical Compatibility Note
- Historical migrations, normalization helpers, and archived cleanup context may still reference:
  - `reportStatus = NOT_REPORTED / REPORTED`
  - older `incident` aliases
  - legacy disposition vocabulary
- These are not active runtime contract.
- Current runtime treats `external filing` as the canonical primary model and treats `report*` fields only as historical compatibility projection.
- Historical `LEGACY_PHASE12_BACKFILL` filing rows that lack deterministic submit evidence MAY remain stored as `LEGACY_HEURISTIC_BACKFILL` residual rows.
- These residual compatibility-only filing rows MUST NOT drive primary filing status, current filing selection, or filing action availability.
- In particular:
  - `NOT_REPORTED` does NOT mean the investigation report is still draft
  - `REPORTED` does NOT mean the report has merely been finalized or sent to MLRO

## Non-Goals
- This spec does not define the final external API shape for `FIU / VARA / STR / SAR` integrations.
- This spec does not define the full future enum set for transaction/generic final disposition.
- This spec does not force current runtime code to adopt the full target model in a single phase.
