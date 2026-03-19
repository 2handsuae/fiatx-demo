# Compliance Alert / Case Foundation Constraints (`Wave 2` Phase 1 Baseline)

## 1) Purpose and Positioning
- This document is the authoritative Phase 1 domain baseline for `Wave 2` compliance foundation work.
- It freezes domain language only; it does NOT require runtime code, database, route, or UI mutations in this phase.
- It MUST be read together with:
1. `docs/roadmap/wave-2-compliance-foundation-phase-plan.md`
2. `docs/constraints/compliance-alert-incident-constraints.md`
- When this document conflicts with current implementation naming, this document wins for domain semantics, while `compliance-alert-incident-constraints.md` wins for current runtime compatibility.

## 2) Canonical Domain Layers
- `Provider Response`
  - Reserved for external provider response containers and evidence objects only.
  - Current scope in Phase 1 is limited to:
1. `KYT`
2. `Travel Rule`
3. `CDD`
4. `EDD`
  - These objects MUST NOT be described as the platform compliance `Case`.
- `Decision Record`
  - Reserved for `Risk Engine` execution records only.
  - It is NOT a triage object and NOT an investigation object.
- `Alert`
  - Reserved for triage objects only.
  - It receives hits, deduplicates, gets assigned, and may escalate into `Case`.
- `Case`
  - Reserved for compliance investigation objects only.
  - It owns investigation lifecycle, alert aggregation, operator actions, closure, and evidence accumulation.

## 3) Current Implementation Mapping
- Current code objects MUST be interpreted as follows in all new planning and design threads:
1. `KytCase`, `TravelRuleCase`, `CddResponse`, `EddResponse` -> provider response / evidence containers
2. `WorkflowDecisionRecord` -> current onboarding-specific implementation of `Decision Record`
3. `ComplianceAlert` -> current `Alert` implementation
4. `ComplianceIncident` -> current transitional implementation of `Case`
- The presence of `*Case` in legacy model names does NOT grant those records the canonical compliance `Case` meaning.

## 4) Decision Record Baseline Contract
- Future platform `Decision Record` semantics MUST include at least:
1. `contextType`
2. `subjectType`
3. `subjectId`
4. `ownerType`
5. `ownerId`
6. `inputSnapshot`
7. `inputHash`
8. `outputSnapshot`
9. `policyVersion`
10. `status`
11. `reasonCodes`
12. `recommendedActions`
- Phase 1 freezes this minimum contract as a design target only.
- Phase 1 MUST NOT require replacing `workflowDecisionRecord` yet.

## 5) Alert and Case Lifecycle Baseline
- Canonical `Alert` status machine MUST remain:
1. `OPEN`
2. `ASSIGNED`
3. `ESCALATED`
4. `CLOSED`
- Canonical `Case` status machine MUST remain:
1. `OPEN`
2. `ASSIGNED`
3. `CLOSED`
- Legacy `RESOLVED` may exist only for read compatibility in current `incident` implementation.
- New design work in `Wave 2` MUST treat `RESOLVED` as historical compatibility only, not a target lifecycle state.

## 6) Incident-to-Case Compatibility Policy
- `incident -> case` MUST use dual-track compatibility in Phase 1:
1. domain and planning language use `Case`
2. current runtime code, tables, routes, DTOs, services, and pages keep `incident`
- Phase 1 MUST NOT introduce:
1. `/cases` API aliases
2. Prisma table renames
3. UI menu renames
4. large-scale DTO or symbol renames
- Current runtime naming is an implementation compatibility layer, not the long-term domain baseline.

## 7) Public Interface Compatibility Boundary
- The following APIs MUST remain unchanged in Phase 1:
1. `/admin/compliance/alerts/**`
2. `/admin/compliance/incidents/**`
- The following physical tables MUST remain unchanged in Phase 1:
1. `compliance_alerts`
2. `compliance_incidents`
3. `compliance_incident_alerts`
4. `compliance_incident_events`
- Current DTO, service, and admin page names MUST remain unchanged until a later code-migration phase.
- `Case` semantic meaning is frozen now, but concrete `caseType` taxonomy is intentionally deferred beyond Phase 1.

## 8) Transition Order Freeze
- All `Wave 2` implementation work MUST follow this sequence:
1. freeze domain semantics and constraints
2. platformize `Decision Record`
3. harden `Alert` triage core
4. evolve `incident` implementation into real `Case` kernel
5. wire standard actions, evidence export, and business integrations
- New work MUST NOT skip directly to `Case` implementation naming changes before the earlier semantic freeze is complete.

## 9) Documentation Language Rules
- New docs in `Wave 2` MUST use:
1. `Provider Response` for `KYT / Travel Rule / CDD / EDD` response containers
2. `Decision Record` for risk execution records
3. `Alert` for triage objects
4. `Case` for investigation objects
- If a doc must mention `incident`, it MUST explicitly mark it as:
1. current implementation name
2. historical compatibility name
3. transitional runtime object
- New docs MUST NOT use spaced legacy phrases that combine:
1. `KYT` with `case`
2. `Travel Rule` with `case`
3. `CDD` with `case`
4. `EDD` with `case`
as the canonical compliance `Case` semantic.

## 10) Phase 1 Acceptance
- Phase 1 documentation is complete only when:
1. this foundation document and the wave plan use aligned terminology
2. `compliance-alert-incident-constraints.md` is explicitly scoped as current V1 implementation constraints
3. documentation search no longer presents `KYT / Travel Rule / CDD / EDD` as the canonical compliance `Case`
4. all `incident` mentions in updated docs are clearly marked as implementation compatibility or transition wording
5. future phases can start without re-deciding core domain meanings
