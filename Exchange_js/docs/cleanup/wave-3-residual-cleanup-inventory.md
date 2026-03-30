# Wave 3 Residual Cleanup Inventory

Status: active
Owner: project-owner-and-agents
Last Updated: 2026-03-30
Applies To: `Exchange_js`
Supersedes: none
Depends On: `docs/roadmap/project-version-plan.md`, `docs/roadmap/wave-3-customer-onboarding-phase-plan.md`, `docs/acceptance/wave-2-wave-3-final-acceptance-checklist.md`, `docs/cleanup/wave-3-cleanup-master-plan.md`, `docs/cleanup/wave-2-wave-3-final-closure-plan.md`, `docs/constraints/onboarding-flow-constraints.md`
Source of Truth Level: cleanup

## Purpose
- This file records the current residual cleanup judgment for `Wave 3`.
- It exists because `Wave 3` is semantically complete, but code review still shows residual compatibility and physical-field dependencies in active runtime code.
- It is not a redesign plan. It is a memory and boundary document for future cleanup threads.

## Current Judgment
- `Wave 3` is semantically complete in the current official scope:
  - phase plan complete
  - staged cleanup complete
  - final closure complete
  - final acceptance active
- Long-term truth still belongs to:
  - `docs/constraints/**`
  - `docs/specs/**`
  - `docs/acceptance/**`
- However, the current branch still contains residual `Wave 3`-related compatibility traces in active runtime code.
- Therefore the correct interpretation is:
  - `Wave 3 semantic closure = complete`
  - `Wave 3 physical/runtime residual cleanup = not fully exhausted`
- `2026-03-30` core convergence note:
  - active workflow transition outputs no longer emit compatibility `finalApprovalStatus`
  - `Customer Detail` now labels `onboardingAuditLogs` as archived / historical context only
  - shared assignee fallback is centralized at the compatibility boundary instead of being reimplemented across runtime surfaces

## Why A Residual Inventory Is Needed
- `Wave 3` cleanup and final-closure documents use a strong completion tone.
- The current code scan shows that this is true at the semantic and public-contract layer, but not yet at literal zero-residue runtime level.
- The remaining residue is mainly:
  - physical response-identity fields used inside runtime services
  - historical audit mirror data still surfaced in one admin read-model as archived context
  - cross-wave fallback logic inherited from `Wave 2`
  - later-wave readers that may still consume physical response identity or shared fallback behavior
- That does not invalidate Wave 3 completion.
- It does mean future cleanup threads need a more precise memory than “everything is already gone.”

## Confirmed Good End State
- Primary active onboarding / periodic-review contract appears converged on:
  - canonical customer status
  - `responseNo`
  - `responseType`
  - canonical final approval summary
- Evidence seen in:
  - `src/modules/identity/customers/customers.service.ts`
  - `client-web/src/pages/Verification.tsx`
  - `admin-web/src/pages/CddResponsesPage.tsx`
  - `admin-web/src/pages/CustomerManagement.tsx`
- No active runtime hit was found for:
  - `publicStatus`
  - `getLegacyPublicStatusFromCanonical`
- Retired route aliases remain retired at the catalog boundary:
  - `src/modules/identity/access-control/rbac.catalog.spec.ts`

## Residual Cleanup Classes
### A. physical response-identity dependency
- Active runtime still reads or writes physical `caseNo / caseType` fields inside onboarding and periodic-review internals.
- Public and operator-facing contracts may already project them as `responseNo / responseType`.
- They are still residual cleanup because the runtime internally depends on the old physical identity fields.

### B. historical audit mirror surfacing
- `onboarding_audit_logs` is no longer canonical audit truth.
- A customer detail read-model still loads and displays it as historical context.
- This may remain acceptable as archived context, but it should not silently drift back into active workflow truth.

### C. cross-wave `Wave 2 -> Wave 3` bridge dependency
- Onboarding and periodic-review services still contain assignee fallback logic from `ownerUserId` to `assigneeUserId`.
- That is not a pure Wave 3 residue.
- It means part of Wave 3 runtime still depends on `Wave 2` compatibility behavior and cannot be cleaned under a Wave 3-only label.

### D. later-wave downstream dependency
- Some later transaction / reconciliation readers still sit outside the current Wave 3 convergence scope.
- This inventory therefore records the core runtime as converged, while leaving downstream identity and bridge residue for later threads.

## Concrete Findings From Current Review
| Finding | Files | Classification | Current Judgment |
| --- | --- | --- | --- |
| onboarding runtime still projects physical `caseNo` into canonical `responseNo`, and still uses `session.caseType` as response identity input | `src/modules/identity/onboarding/onboarding.service.ts` | physical response-identity dependency | expected residual; not ready for direct removal |
| periodic review runtime still projects physical `caseNo` into canonical `responseNo`, and still uses `session.caseType` as response identity input | `src/modules/identity/periodic-review/periodic-review.service.ts` | physical response-identity dependency | expected residual; not ready for direct removal |
| onboarding workflow transition output no longer emits compatibility `finalApprovalStatus`; active runtime truth now relies on `latestFinalApproval*` and canonical customer status | `src/modules/identity/onboarding/onboarding-workflow-transition.service.ts`, `src/modules/identity/periodic-review/periodic-review-workflow-transition.service.ts` | closed core-convergence finding | closed on `2026-03-30`; keep only as documentation memory |
| customer detail read-model still loads `onboardingAuditLogs`, and admin customer detail now renders them as archived / historical context only | `src/modules/identity/customers/customers.service.ts`, `admin-web/src/pages/CustomerDetail.tsx` | historical audit mirror surfacing | allowed as archived context; canonical audit truth remains in `Audit Center` |
| onboarding and periodic-review runtime still fall back from `incident.ownerUserId` to canonical assignee identity | `src/modules/identity/onboarding/onboarding.service.ts`, `src/modules/identity/periodic-review/periodic-review.service.ts` | cross-wave `Wave 2 -> Wave 3` bridge dependency | do not clean under Wave 3 alone |
| downstream transaction / reconciliation readers are still outside the current convergence thread and may continue to consume physical-response-adjacent compatibility behavior | downstream later-wave surfaces | later-wave downstream dependency | do not reinterpret as Wave 3 core-runtime debt |
| closure-search-gate wording about fully retired response/status compatibility should be read as semantic closure, not literal zero-token physical absence | files above plus closure docs | doc/runtime nuance | closure wording remains valid semantically, but physical/runtime residue still exists |

## What This Inventory Means In Practice
- `Wave 3` should not be treated as “nothing left to inspect.”
- `Wave 3` also should not be reopened as a semantic redesign wave.
- The right posture is:
1. preserve current canonical onboarding / periodic-review semantics
2. remember the remaining physical and cross-wave residue
3. treat `finalApprovalStatus` compatibility output as closed at the active runtime surface
4. retire the rest only when the relevant downstream readers and cross-wave bridges are also in scope

## Recommended Future Order
1. keep `Wave 3` semantic truth frozen
2. when later threads touch onboarding / periodic-review internals, check whether they still depend on:
   - physical `caseNo / caseType`
   - archived `onboardingAuditLogs`
   - `ownerUserId` assignee fallback
3. only after downstream consumers are cleared, propose physical/runtime retirement

## Explicitly Not Recommended Now
- Do not start by deleting `caseNo / caseType` internal reads from onboarding or periodic-review runtime.
- Do not reinterpret `onboardingAuditLogs` as current workflow truth; it is archived context only.
- Do not delete `onboardingAuditLogs` surfacing under a Wave 3-only label without checking operator expectations and customer detail behavior.
- Do not remove `ownerUserId` fallback logic under Wave 3 alone; coordinate with the `Wave 2` residual inventory.

## Exit Condition
- `Wave 3 residual cleanup` can be considered complete only when:
1. active runtime no longer depends on physical `caseNo / caseType` outside explicitly approved physical-compat boundaries
2. `onboardingAuditLogs` is either retired from operator-facing read-models or explicitly documented as intentional archived context only
3. `Wave 2 -> Wave 3` assignee fallback dependency is retired or explicitly justified at the shared boundary
4. downstream later-wave readers no longer depend on Wave 3 compatibility bridges that sit outside canonical response identity

## Practical Conclusion
- `Wave 3` is complete enough to stay closed as a semantic wave.
- `Wave 3` core convergence is now complete for active workflow output and operator-facing final-approval semantics.
- `Wave 3` is not clean enough to pretend all physical/runtime residue is gone.
- This file exists so those residuals stay visible when later waves are reviewed.
