Status: draft
Owner: project-owner-and-agents
Last Updated: 2026-03-23
Applies To: `Exchange_js`
Supersedes: none
Depends On: `docs/adr/business-base-config-release-model.md`, `docs/constraints/backend-architecture-constraints.md`, `docs/constraints/governance-change-ticket-constraints.md`, `docs/specs/entities/business-config-release-entity.md`, `docs/specs/workflows/config-release-activation-workflow.md`
Source of Truth Level: constraints

# Business Base Config Release Constraints (`Wave 4` Runtime Baseline)

## 1) Purpose and Positioning
- This document defines the Wave 4 current governance model for business base configuration.
- It freezes the release-governed configuration baseline already implemented in runtime for the five in-scope subjects.
- Current runtime now exposes the core revision/release model for:
1. `COA`
2. `AcctEvent`
3. `JournalTemplate`
4. `ClearingTemplate`
5. `PricingPolicy`
- Current runtime also records canonical audit evidence for subject release lifecycle actions.
- Remaining gap is no longer core runtime availability, but downstream acceptance and broader operator-surface refinement.

## 2) In-Scope Subjects
- The first Wave 4 business base config subjects MUST be:
1. `COA`
2. `AcctEvent`
3. `ClearingTemplate`
4. `JournalTemplate`
5. `PricingPolicy`
- `Asset` is explicitly out of scope for the first release-governed subject model and remains master data in Wave 4 Phase 1.

## 3) Authoring Model
- Business base config authoring MUST use `config-as-code` as the primary path.
- Draft authoring and review MUST happen in repository-controlled change flow.
- Admin UI MUST remain read-only for this subject model in Wave 4.
- Operator self-service editing MUST NOT become the default Wave 4 authoring path.

## 4) Item Revision Contract
- Each config item MUST own its own independent `revision` history.
- Different items under the same subject MAY have different active revision numbers at the same time.
- Released revisions MUST NOT be edited in place.
- Revision MUST remain the unit for:
1. detail history lookup
2. diff against another revision
3. release-item binding

## 5) Subject Release Contract
- Release MUST be scoped per subject, not per whole platform.
- A `Subject Release` MUST represent one time-slice snapshot of one subject’s effective set.
- Subject release naming MUST be subject-qualified, for example:
1. `COA-REL-002`
2. `ACCTEVENT-REL-004`
3. `JOURNALTPL-REL-003`
- Wave 4 MUST NOT introduce one platform-wide “all config at once” release object as the default contract.

## 6) Bundle Versioning Rules
- `JournalHeaderTemplate + JournalLineTemplate` MUST version as one bundle.
- `ClearingTemplate + ClearingLineTemplate` MUST version as one bundle.
- Line-level independent revision streams are forbidden.

## 7) Governance Activation Path
- Subject release activation MUST bind to existing governance controls:
1. `Change Ticket`
2. `Approval`
3. release validation evidence
- Manual publish MUST happen only after governance approval is satisfied.
- Saving config content MUST NOT automatically activate it.
- `stageRelease`, `validateRelease`, and `publishRelease` MUST write canonical audit log evidence.
- Canonical audit contract for these actions MUST use:
1. `module = governance/business-config`
2. `entityType = CONFIG`
3. `entityNo = releaseNo`
4. `triggerType = CONFIG_CHANGE`
- Validation failure and publish blocking by `Change Ticket` / approval gate MUST also leave durable audit evidence before error return.

## 8) Historical Read Model Contract
- Wave 4 config governance MUST expose these read-only views:
1. `Current`
2. `As-Of-Release`
3. `Revision Detail`
4. `Release Diff`
- `Current` answers which revision of each item is active now.
- `As-Of-Release` answers what the whole subject looked like at a named subject release.
- `Revision Detail` answers what changed for one item version.

## 9) Validation Requirements
- Release preparation MUST include static validation at minimum:
1. stable business key uniqueness
2. revision continuity per item
3. release completeness for the subject snapshot
4. referenced template/policy/event existence
- Release preparation SHOULD include semantic dry-run where applicable:
1. journal render and balance check
2. clearing render
3. pricing simulation
- Publish MUST NOT rely on manual memory alone; release evidence is required.

## 10) Current Runtime Compatibility Note
- Current runtime already treats business base config as release-governed for the five in-scope subjects.
- Existing subject read surfaces remain available, but compatibility-era fake-write route and `/acct-events/sync-defaults` have been physically deleted.
- Repository-managed config and subject release publish flow are the only supported authoring / activation path in current runtime.

## 11) Forbidden Patterns
- MUST NOT edit a released revision in place.
- MUST NOT use admin save as implicit activation.
- MUST NOT create a global platform release as the only release model.
- MUST NOT version template header and lines separately.
- MUST NOT put `Asset` into the first subject-release batch.

## 12) Change Protocol
- Any change to this baseline MUST include:
1. impacted subject list
2. activation/governance impact
3. history and replay impact
4. compatibility note for older operator memory or historical docs if deleted route/sync concepts are mentioned
