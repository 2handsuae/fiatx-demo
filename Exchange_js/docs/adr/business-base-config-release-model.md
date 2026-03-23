Status: active
Owner: project-owner-and-agents
Last Updated: 2026-03-23
Applies To: `Exchange_js`
Supersedes: none
Depends On: `docs/roadmap/wave-4-ledger-asset-structure-phase-plan.md`, `docs/constraints/backend-architecture-constraints.md`, `docs/constraints/governance-change-ticket-constraints.md`
Source of Truth Level: adr

# ADR: Business Base Config Release Model

## Context

- `Exchange_js` already contains durable configuration anchors for:
  - `COA`
  - `AcctEvent`
  - `JournalTemplate`
  - `ClearingTemplate`
  - `PricingPolicy`
- Current implementation anchors are a mix of:
  - CRUD-style admin surfaces
  - idempotent base sync
  - boot-time validation/sync guards
- `Wave 4` needs a governance model that can answer:
  - what was the active config at a given time
  - which version of a single item was active
  - which change ticket and approval allowed activation
  - how a release can be replayed or diffed later
- The product owner explicitly does not want operator self-service authoring as the primary path for this wave.

## Decision

### 1. Authoring Model

- `Wave 4` adopts `config-as-code` as the primary authoring model for business base configuration.
- Drafting, review, and packaging happen in repository-controlled change flow, not in admin self-service editors.

### 2. Subject Scope

- The first release-governed business config subjects are:
  - `COA`
  - `AcctEvent`
  - `ClearingTemplate`
  - `JournalTemplate`
  - `PricingPolicy`
- `Asset` remains `master data` in `Wave 4 Phase 1` and is excluded from the first release model.

### 3. Revision Model

- Each config item has its own independent `revision` history.
- Different items under the same subject may have different active revision numbers at the same time.
- Revision is the unit for:
  - detailed history
  - diff
  - “create next draft from current”

### 4. Release Model

- Release is defined per subject, not for the whole platform.
- A `Subject Release` is a time-slice snapshot of one subject’s active set.
- Example:
  - `COA-REL-002`
  - `ACCTEVENT-REL-004`
  - `JOURNALTPL-REL-003`
- Release is the unit for:
  - change ticket linkage
  - approval linkage
  - manual publish
  - “as-of-release” historical replay

### 5. Template Bundle Rule

- `JournalHeaderTemplate + JournalLineTemplate` version as one bundle.
- `ClearingTemplate + ClearingLineTemplate` version as one bundle.
- Line-level independent version streams are forbidden.

### 6. Read-Only Admin Scope

- Admin scope for this model is read-only.
- The intended operator-facing views are:
  - `Current`
  - `As-Of-Release`
  - `Revision Detail`
  - `Release Diff`
- Admin is not the canonical place to edit, draft, or activate raw config payloads.

### 7. Activation Path

- Subject release activation must bind to existing governance controls:
  - `Change Ticket`
  - `Approval`
  - release evidence / validation
- Activation is a manual publish action after approval, not an implicit side effect of saving config.

## Consequences

- Historical replay becomes possible at two levels:
  - item-level (`revision`)
  - subject-level (`release`)
- Future Wave 4 code changes should converge away from direct admin overwrite semantics for these config subjects.
- Validation must become explicit and scriptable before publish:
  - static validation
  - semantic dry-run
  - smoke validation
- `Asset` can evolve separately as master data without blocking the first config release model.

## Alternatives Considered

### 1. One Global Platform Release

- Rejected for Wave 4.
- Reason:
  - too heavy for current scope
  - forces unrelated subjects to move together
  - makes replay and approval granularity harder to reason about

### 2. Admin Self-Service Editing As Primary Flow

- Rejected for Wave 4.
- Reason:
  - product preference is repo-authored governance
  - would require a second drafting/review system in admin
  - increases implementation scope before the base contracts are stable

### 3. Make `Asset` A Release-Governed Subject Immediately

- Deferred.
- Reason:
  - `Wave 4` first needs asset and wallet semantics frozen as master data
  - pricing/accounting config governance is the more urgent dependency for `Wave 5/6/7`

### 4. Version Header And Line Templates Separately

- Rejected.
- Reason:
  - header and lines form one semantic bundle
  - separate version streams make release replay and approval error-prone
