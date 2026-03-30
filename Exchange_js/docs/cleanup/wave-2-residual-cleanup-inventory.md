# Wave 2 Residual Cleanup Inventory

Status: active
Owner: project-owner-and-agents
Last Updated: 2026-03-30
Applies To: `Exchange_js`
Supersedes: none
Depends On: `docs/roadmap/project-version-plan.md`, `docs/roadmap/wave-2-compliance-foundation-phase-plan.md`, `docs/acceptance/wave-2-wave-3-final-acceptance-checklist.md`, `docs/cleanup/wave-2-cleanup-master-plan.md`, `docs/cleanup/wave-2-wave-3-final-closure-plan.md`, `docs/constraints/compliance-alert-incident-constraints.md`
Source of Truth Level: cleanup

## Purpose
- This file records the current residual cleanup judgment for `Wave 2`.
- It exists because `Wave 2` is semantically complete, but code review still shows residual compatibility and physical-field dependencies that should not be forgotten during later wave cleanup.
- It is not a redesign plan. It is a memory and boundary document for future cleanup threads.

## Current Judgment
- `Wave 2` is semantically complete in the current official scope:
  - phase plan complete
  - staged cleanup complete
  - final closure complete
  - final acceptance active
- Long-term truth still belongs to:
  - `docs/constraints/**`
  - `docs/specs/**`
  - `docs/acceptance/**`
- However, the current branch still contains residual `Wave 2`-related compatibility traces in active runtime code.
- Therefore the correct interpretation is:
  - `Wave 2 semantic closure = complete`
  - `Wave 2 physical/runtime residual cleanup = not fully exhausted`
- `2026-03-30` core convergence note:
  - canonical case query / export filters now go through a shared compatibility helper
  - legacy decision normalization is no longer scattered across multiple active services
  - remaining `Wave 2` residue is now mainly downstream or physical-compat only

## Why A Residual Inventory Is Needed
- `Wave 2 / Wave 3` final closure documents use a strong closure tone.
- The current code scan shows that some tokens listed there as effectively retired still remain in runtime code, but mainly as:
  - physical storage fields
  - normalization inputs
  - compatibility mirrors
  - cross-wave downstream consumers
- That does not invalidate Wave 2 completion.
- It does mean future cleanup threads need a more precise memory than “everything is already gone.”

## Confirmed Good End State
- Primary active case contract appears converged on:
  - `caseNo`
  - `assigneeUserId`
  - `assigneeUserNo`
  - canonical case workflow semantics
  - canonical filing model
- Evidence seen in:
  - `src/modules/risk-engine/compliance-incidents/dto/compliance-incident.dto.ts`
  - `admin-web/src/pages/ComplianceCasesPage.tsx`
  - `admin-web/src/pages/ComplianceCaseDetailPage.tsx`
- In other words: user-facing main case pages are mostly on the canonical contract already.

## Residual Cleanup Classes
### A. physical legacy field dependency
- Runtime still reads or writes physical legacy fields such as:
  - `incidentNo`
  - `ownerUserId`
  - `ownerUserNo`
  - `reportStatus`
  - `reportRefNo`
  - `reportedAt`
  - `reportReason`
- These are not necessarily active public contract leaks.
- They are still residual cleanup because the runtime internally depends on them.

### B. normalization-only legacy vocabulary
- Some legacy decision words remain accepted at normalization boundaries, especially:
  - `APPROVE_STAGE`
  - `REJECT_STAGE`
- If those values are no longer emitted by any active producer, they are future cleanup candidates.
- If they are still needed for historical or cross-wave input normalization, they stay blocked.

### C. cross-wave downstream dependency
- Some residual Wave 2 legacy tokens are now consumed by later waves.
- That means the cleanup cannot be done under a pure Wave 2 label without coordinating later-wave truth.

### D. compatibility mirror retention
- `report*` mirror fields are explicitly documented as compatibility-only.
- They may remain acceptable for now, but they should not silently drift back into primary semantics.

## Concrete Findings From Current Review
| Finding | Files | Classification | Current Judgment |
| --- | --- | --- | --- |
| case runtime still maps physical `incidentNo/owner*` into canonical `caseNo/assignee*` | `src/modules/risk-engine/compliance-incidents/compliance-incidents.service.ts` | physical legacy field dependency | expected residual; not ready for direct removal |
| external filing still syncs legacy `report*` mirrors | `src/modules/risk-engine/compliance-incidents/compliance-incidents.service.ts` | compatibility mirror retention | still allowed as documented mirror behavior; not a delete candidate yet |
| case evidence export still resolves canonical assignee query through physical `ownerUserId` because the current storage model has not been renamed | `src/modules/risk-engine/compliance-incidents/compliance-case-evidence-packages.service.ts`, `src/modules/risk-engine/compliance-incidents/compliance-incident-compat.util.ts` | physical legacy field dependency | core convergence closed on `2026-03-30`; keep as explicit physical-compat boundary |
| legacy decision normalization still accepts `APPROVE_STAGE / REJECT_STAGE`, but active runtime now reads them only through shared compatibility helpers | `src/modules/risk-engine/constants/compliance-disposition.constant.ts`, `src/modules/risk-engine/risk-decision-orchestrator.service.ts`, `src/modules/risk-engine/compliance-incidents/compliance-incidents.service.ts`, `src/modules/identity/onboarding/workflow-transition.service.ts` | normalization-only legacy vocabulary | active duplication closed on `2026-03-30`; future retirement still requires producer proof |
| transaction compliance bridge still uses `incidentNo` as linked case source | `src/modules/risk-engine/transaction-compliance/transaction-risk-bridge.service.ts` | cross-wave downstream dependency | do not clean under Wave 2 alone |
| deposit and reconciliation downstream views still surface linked `incidentNo` | `src/modules/trading/deposit-transactions/deposit-transactions.service.ts`, `src/modules/clearing-settle/safeguarding-reconciliation/safeguarding-reconciliation.service.ts`, `admin-web/src/pages/SafeguardingBreakList.tsx`, `admin-web/src/pages/SafeguardingBreakDetail.tsx` | cross-wave downstream dependency | belongs to later-wave convergence, not pure Wave 2 cleanup |
| closure-search-gate tokens still appear in active runtime code | multiple files above | doc/runtime mismatch | closure wording should be read as semantic closure, not literal zero-token physical absence |

## What This Inventory Means In Practice
- `Wave 2` should not be treated as “nothing left to inspect.”
- `Wave 2` also should not be reopened as a semantic redesign wave.
- The right posture is:
1. preserve current canonical semantics
2. remember physical and compatibility residue
3. retire residue only when the relevant later-wave consumers are also in scope

## Recommended Future Order
1. keep `Wave 2` semantic truth frozen
2. during later wave cleanup, check whether the later-wave consumer still depends on:
   - `incidentNo`
   - `owner*`
   - `report*`
   - `APPROVE_STAGE / REJECT_STAGE`
3. only after downstream consumers are cleared, propose physical/runtime retirement

## Explicitly Not Recommended Now
- Do not start by deleting `incidentNo`-based internal reads from case runtime.
- Do not remove `report*` mirror fields without checking filing and read-model behavior.
- Do not remove normalization of `APPROVE_STAGE / REJECT_STAGE` without proving no producer still emits them.
- Do not clean transaction bridge / reconciliation linked-case usage under a Wave 2-only label.

## Exit Condition
- `Wave 2 residual cleanup` can be considered complete only when:
1. active runtime no longer depends on `incidentNo / owner* / report*` outside explicitly approved physical-compat boundaries
2. legacy decision normalization is either removed or explicitly justified by a still-active producer
3. later-wave consumers no longer project linked case identity through `incidentNo`

## Practical Conclusion
- `Wave 2` is complete enough to stay closed as a semantic wave.
- `Wave 2` core convergence is now complete for case-kernel query and normalization boundaries.
- `Wave 2` is not clean enough to pretend all downstream and physical compatibility traces are gone.
- This file exists so those residuals stay visible when later waves are reviewed.
