Status: active
Owner: project-owner-and-agents
Last Updated: 2026-04-03
Applies To: `Exchange_js`
Supersedes: none
Depends On: `docs/roadmap/project-version-plan.md`, `docs/cleanup/2026-04-wave1-foundation-reset/wave-1-subject-table-dictionary-and-minimal-model-review.md`, `docs/cleanup/2026-04-wave1-foundation-reset/wave-1-core-table-field-necessity-review.md`, `docs/cleanup/2026-04-wave1-foundation-reset/wave-1-no-first-missing-field-review.md`, `docs/cleanup/2026-04-wave1-foundation-reset/change-delete-ticket-minimalization-design.md`
Source of Truth Level: cleanup

# Wave 1 Foundation Tightening BCD Design

## Purpose

- Define one combined cleanup package for the remaining `Wave 1 foundation tightening` work after `A. Change / Delete Ticket` minimalization.
- Keep execution under one project umbrella, but preserve strict internal order: `D -> C -> B`.
- Reduce `Wave 1` runtime noise first, then stabilize the audit foundation, then converge the rest of the `Wave 1` base entities and UI projections.

## Why This Is One Package

- The remaining work shares one product goal: make the `Wave 1` base cleaner, more unified, and easier to explain.
- Splitting this into three separate projects would create repeated context switching and duplicated review effort.
- Collapsing everything into one undifferentiated refactor would create a large, hard-to-review diff and make scope control weak.
- The chosen shape is:
  - one combined design
  - one combined implementation plan
  - three internal stages with explicit checkpoints

## Chosen Delivery Model

### Recommended Structure

- `BCD` is one combined package.
- Execution order is fixed:
  1. `Stage D`
  2. `Stage C`
  3. `Stage B`
- Each stage must have its own:
  - scope boundary
  - review checkpoint
  - focused verification
  - user acceptance pause

### Why The Internal Order Must Stay Fixed

- `Stage D` must run first so non-`Wave 1` runtime semantics stop leaking into the base before deeper cleanup starts.
- `Stage C` must run second because `Audit` is the cross-cutting foundation that other `Wave 1` entities project into.
- `Stage B` must run last because field layering, list/detail cleanup, and operator-facing `No/code` convergence depend on the first two stages already being stable.

## Stage Overview

### Stage D: Medium Runtime Trimming With Wider Coupling Cleanup

#### Goal

- Remove non-`Wave 1` semantics from active runtime paths without starting a physical schema purge.
- Reduce obvious cross-wave direct coupling where later domains make `Wave 1` base objects behave like business-specific objects.

#### What This Stage Changes

- Runtime semantics in:
  - services
  - controllers
  - DTOs
  - list/detail/create pages
  - canonical constraints/spec docs
- Direct product-facing references that make `Wave 1` base modules speak in `Wave 2/3/8/9` terms.
- The most obvious `customer / compliance / treasury` direct-hitching points onto:
  - approval base
  - audit base
  - member / RBAC base

#### What This Stage Does Not Change

- No physical Prisma cleanup of legacy tables or legacy fields.
- No cross-wave data migration.
- No rewrite of customer, compliance, treasury, or reconciliation business workflows.
- No reintroduction of generic `obligation / SLA / escalation` into `Wave 1`.
- No generic governance engine work that belongs to `Wave 9`.

#### Stage D Acceptance Standard

- `Wave 1` active runtime paths stop presenting non-`Wave 1` semantics as canonical.
- Later domains no longer make `Wave 1` base objects look like their business-native roots in primary UI and workflow language.
- `Wave 1` source-of-truth docs describe `Wave 1` only, not adjacent wave behavior.

### Stage C: Audit Foundation Tightening

#### Goal

- Pull `Audit` back into a stable, general-purpose contract.
- Stop the audit base from acting as a domain-specific orchestration hub.

#### What This Stage Changes

- `AuditLogEvent` canonical field layering.
- `AuditLogsService` responsibilities and contract boundaries.
- The meaning of:
  - typed core fields
  - `subjectNos[]`
  - `workflow + traceId`
  - `before / after`
  - evidence export references
- Query and operator-facing lookup semantics around:
  - `No`
  - `subjectNo`
  - `workflowNo`
  - `traceId`

#### What This Stage Does Not Change

- `Audit` does not become a full configuration version-management engine.
- `Audit` does not become the sole truth store for every business history.
- This stage does not rewrite all downstream business modules.
- This stage does not implement `Wave 9` generic governance timing features.

#### Stage C Acceptance Standard

- The audit base records, queries, and exports evidence through a stable shared contract.
- Concrete business evidence assembly no longer lives as sprawling domain orchestration inside the audit base.
- `subjectNo`, `workflow`, and `traceId` each have a clear, non-overlapping operator role.
- `before / after` carry audit evidence, not arbitrary raw payload dumping.

### Stage B: Remaining Wave 1 Entity Convergence

#### Goal

- Converge the rest of the `Wave 1` base entities after the runtime and audit foundation have already been tightened.
- Make entity fields, UI projection layers, and operator-facing identifiers feel consistent.

#### What This Stage Changes

- Apply the established field-layering method to remaining `Wave 1` entities:
  - typed core
  - structured children
  - context JSON
  - technical-only fields
- Apply the established display-layering method:
  - list page
  - detail primary section
  - technical section
  - default-hidden
- Enforce the operator-facing cross-table rule:
  - internal linking uses `id`
  - operator-facing relationships preserve `id + No/code`
- Tighten the remaining `Wave 1` entity pages and usage semantics.

#### What This Stage Does Not Change

- No new workflows are introduced.
- No new cross-wave scope is opened.
- No attempt is made to collapse everything into one generic governance super-object.

#### Stage B Acceptance Standard

- Remaining `Wave 1` entity fields are layered consistently.
- Operator-facing pages no longer overload users with technical noise in their primary sections.
- All operator-visible cross-table references surface `No/code` alongside internal linking.
- `Wave 1` base entities feel like one family of objects instead of a set of unrelated islands.

## In-Scope Object Map

### Core Objects That Must Move In BCD

- `ApprovalCase`
- `ApprovalStep`
- `AuditLogEvent`
- `AuditEvidencePackage`
- `User`
- `Role`
- `Permission`
- `UserRole`
- `RolePermission`
- `AdminUserInvitation`
- their directly associated admin pages and source-of-truth docs

### Wider Coupling Points That Stage D May Trim

- `Customer` views or services that present `Wave 1` governance or audit objects as customer-native primary flow objects
- `Compliance` views or services that present `Wave 1` governance or evidence objects as case-native primary flow objects
- `Treasury / reconciliation` views or services that directly hitch onto `Wave 1` governance base objects in operator-facing primary paths

### Explicitly Out of Scope

- `Wave 8` finance ops business body
- `Wave 9` generic obligation / breach / escalation engine
- governance registries
- filing / receipt / effectiveness gate
- outsourcing governance
- complaints / disputes
- security / privacy evidence factory
- large schema deletion passes
- historical data migration scripts

## Design Principles

### 1. Runtime First, Physical Cleanup Later

- If a concept no longer belongs in active `Wave 1` behavior, remove it from runtime and canonical docs first.
- Physical schema cleanup can happen later after the runtime shape is stable.

### 2. The Audit Base Must Be Neutral

- Audit records what happened.
- Audit links objects and evidence.
- Audit does not become the business orchestrator for every later-domain evidence story.

### 3. Operator-Facing Linking Must Be `id + No/code`

- Internal system truth may continue to use `id`.
- Any relationship the operator sees, filters, reconciles, or audits must also preserve `No/code`.

### 4. Display Simplicity Is Part Of The Base

- A base object is not truly simplified if the details page still overwhelms operators.
- Page convergence is therefore in-scope, not cosmetic.

## Delivery Shape

### Output Documents

- One combined design document:
  - this file
- One combined implementation plan:
  - to be written after user review and approval of this design
- Final documentation pack only after `BCD` implementation completes:
  - `Wave 1` entity and field handbook
  - workflow diagrams
  - acceptance docs
  - test docs

### Review Model

- `Stage D` review before `Stage C`
- `Stage C` review before `Stage B`
- final combined review after `Stage B`

### Verification Model

- focused checks per stage
- code review per stage
- final integration checks after all three stages complete

## Risks And Controls

### Risk: Diff Expands Across Too Many Modules

- Control:
  - keep stage boundaries explicit
  - do not start `Stage C` until `Stage D` semantics are stable
  - do not start `Stage B` until the `Audit` contract is settled

### Risk: Cleanup Accidentally Reopens Wave 2/3/8/9 Scope

- Control:
  - preserve the out-of-scope list above
  - reject any design move that introduces new business behavior outside `Wave 1`

### Risk: Pages Look Simpler But Contracts Stay Messy

- Control:
  - every display cleanup must point to a backing field-layering decision
  - every contract cleanup must point to a source-of-truth doc update

## Final Success Definition

- `Wave 1` active runtime paths describe and behave like `Wave 1`, not like a mixed archive of later waves.
- The audit base becomes a stable foundation instead of a sprawling business-specific evidence orchestrator.
- Remaining `Wave 1` entities converge around one field-layering and one operator-facing linking model.
- The codebase becomes easier to explain, easier to review, and easier to document after implementation.
