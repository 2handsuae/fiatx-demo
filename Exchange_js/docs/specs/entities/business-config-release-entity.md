Status: draft
Owner: project-owner-and-agents
Last Updated: 2026-03-23
Applies To: `Exchange_js`
Supersedes: none
Depends On: `docs/constraints/business-base-config-release-constraints.md`, `docs/specs/workflows/config-release-activation-workflow.md`
Source of Truth Level: specs-entity

# Business Config Release Entity

## Purpose
- This document defines the Wave 4 current semantics for revision-governed business base configuration.

## Positioning
- This is a Wave 4 runtime entity spec for the implemented governance model.
- It defines the durable meaning of revision/release persistence and its activation boundary in current runtime.

## Canonical Concepts
- `Business Base Config Subject`
  - one of:
    - `COA`
    - `AcctEvent`
    - `ClearingTemplate`
    - `JournalTemplate`
    - `PricingPolicy`
- `Item`
  - one durable business-keyed config record under a subject
- `Revision`
  - one version of one item
- `Subject Release`
  - one time-slice snapshot of one subject’s effective set

## Canonical Fields
- For item revision semantics:
  - `subjectType`
  - `businessKey`
  - `revisionNo`
  - `status`
  - `basedOnRevision`
  - `changeSummary`
- For subject release semantics:
  - `releaseNo`
  - `subjectType`
  - `status`
  - `basedOnRelease`
  - `effectiveFrom`
  - `validationSummaryJson`
  - `changeTicketId`
  - `approvalCaseId`
  - `publishedAt`

## Canonical Meaning
- `Revision` answers how one item evolved.
- `Subject Release` answers what the whole subject looked like at one named release point.
- `Revision Detail` and `As-Of-Release` answer different questions and MUST NOT be collapsed into one concept.
- `Subject Release` also defines the canonical activation boundary for:
  - `Change Ticket` / approval gate checks
  - stage / validate / publish audit evidence

## Relationship Rules
- One item has many revisions.
- One subject release contains many release items.
- One release item points to exactly one active revision for one item inside that subject snapshot.
- A Wave 4 release is never the global snapshot of every platform config subject at once.

## Current Runtime Notes
- Current runtime persists:
  - revision rows
  - release rows
  - release-item bindings
- Current runtime emits canonical audit evidence for subject release stage / validate / publish lifecycle actions.

## Non-Goals
- This entity does not define asset master data governance in Wave 4 v1.
- This entity does not define online editing UX as the primary authoring path.
