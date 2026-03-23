Status: draft
Owner: project-owner-and-agents
Last Updated: 2026-03-23
Applies To: `Exchange_js`
Supersedes: none
Depends On: `docs/constraints/business-base-config-release-constraints.md`, `docs/specs/entities/business-config-release-entity.md`, `docs/specs/workflows/change-ticket-release-gate-workflow.md`
Source of Truth Level: specs-workflow

# Config Release Activation Workflow

## Purpose
- This document defines the Wave 4 current workflow for subject-scoped business config release activation.

## Actors
- `Developer`
- `Checker / Approver`
- `Release Operator`

## Workflow Scope
- Applies to subject-scoped releases for:
  - `COA`
  - `AcctEvent`
  - `ClearingTemplate`
  - `JournalTemplate`
  - `PricingPolicy`
- Does not define asset master authoring in Wave 4 v1.

## Canonical Flow
1. author or update config item revisions in repository-controlled change flow
2. package and stage a `Subject Release` snapshot
3. record stage audit evidence
4. validate the subject release and record validation success or failure audit evidence
5. create and bind `Change Ticket`
6. obtain required approval
7. manually publish / activate subject release
8. if publish is blocked by `Change Ticket` or approval gate, record blocking audit evidence before error return
9. if publish succeeds, record publish audit evidence
10. new active view becomes visible in `Current`
11. historical replay remains visible in `As-Of-Release`

## Key Outputs
- one active subject release
- immutable release history
- immutable revision history
- change-ticket-linked publish evidence
- canonical audit trail for stage / validate / publish lifecycle

## Historical Read Paths
- `Current` answers today’s active subject snapshot
- `As-Of-Release` answers a named historical subject snapshot
- `Revision Detail` answers the history of one config item version

## Canonical Audit Side Effects
- Successful stage MUST emit `BUSINESS_CONFIG_RELEASE_STAGED`.
- Successful validation MUST emit `BUSINESS_CONFIG_RELEASE_VALIDATED`.
- Failed validation MUST emit `BUSINESS_CONFIG_RELEASE_VALIDATION_FAILED` before error return.
- Successful publish MUST emit `BUSINESS_CONFIG_RELEASE_PUBLISHED`.
- Publish blocked by `Change Ticket` / approval gate MUST emit `BUSINESS_CONFIG_RELEASE_PUBLISH_BLOCKED` before error return.
- These actions use the canonical audit boundary:
  - `module = governance/business-config`
  - `entityType = CONFIG`
  - `entityNo = releaseNo`
  - `triggerType = CONFIG_CHANGE`

## Non-Goals
- This workflow does not define online editing UX.
- This workflow does not define one global release for all subjects.
- This workflow does not replace the existing governance change-ticket workflow; it composes with it.
