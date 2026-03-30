# Wave 5 Residual Cleanup Inventory

Status: active
Owner: project-owner-and-agents
Last Updated: 2026-03-30
Applies To: `Exchange_js`
Supersedes: none
Depends On: `docs/roadmap/wave-5-payin-deposit-phase-plan.md`, `docs/cleanup/wave-5-cleanup-master-plan.md`, `docs/acceptance/wave-5-payin-deposit-final-acceptance-checklist.md`
Source of Truth Level: cleanup

## Purpose
- This file records the current residual cleanup judgment for `Wave 5`.
- It exists because `Wave 5` is semantically complete, but code review still shows residual compatibility and historical-support traces in active runtime code.
- It is not a redesign plan. It is a memory and boundary document for future cleanup threads.

## Current Judgment
- `Wave 5` is semantically complete in the current official scope:
  - runtime implementation-complete
  - closeout complete
  - final acceptance active
  - cleanup master archived as closure record
- Long-term truth still belongs to:
  - `docs/constraints/**`
  - `docs/specs/**`
  - `docs/acceptance/**`
- However, the current branch still contains residual `Wave 5`-related compatibility and historical-support traces in active runtime code.
- Therefore the correct interpretation is:
  - `Wave 5 semantic closure = complete`
  - `Wave 5 physical/runtime residual cleanup = not fully exhausted`
- `2026-03-30` residual-retirement note:
  - `tx-cases/mock-backfill` has been retired from the active admin route and RBAC surface
  - `TX_DEPOSIT_TRAVEL_RULE` is now treated as historical replay / ingestion context only, not active operator simulation truth
  - tx response lifecycle normalization remains intentionally retained only at the compatibility edge

## Why A Residual Inventory Is Needed
- `Wave 5` cleanup documentation already uses a strong closure tone, and that remains correct at the workflow and operator-contract layer.
- The current code scan still shows a few active traces that should not be forgotten during later wave cleanup:
  - historical transaction risk contexts
  - lifecycle compatibility normalization for transaction response containers
  - retained but still not-fully-classified support surfaces
- That does not invalidate Wave 5 completion.
- It does mean future cleanup threads need a more precise memory than “everything except simulation is gone.”

## Confirmed Good End State
- Primary active deposit contract appears converged on:
  - `signal -> payin -> deposit`
  - `TX_DEPOSIT_FINAL`
  - canonical alert / case callback
  - accounting-block audit
  - approval-backed evidence export
- Evidence seen in:
  - `docs/acceptance/wave-5-payin-deposit-final-acceptance-checklist.md`
  - `docs/acceptance/wave-5-deposit-evidence-export-runbook.md`
  - `src/modules/asset-treasury/payins/payins.admin.controller.ts`
  - `src/modules/trading/deposit-transactions/deposit-transactions.controller.ts`
- Explicitly retained support surfaces remain intentional, not debt:
  - `POST /admin/treasury/payins/:id/mock-event`
  - `POST /admin/compliance/tx-kyt-cases/mock-complete`
  - `POST /admin/compliance/tx-travel-rule-cases/mock-complete`
  - client `/deposit` simulation entry
  - compensation-only `payin_confirmed` path

## Residual Cleanup Classes
### A. historical transaction risk context retention
- `TX_DEPOSIT_TRAVEL_RULE` still exists as an active historical provider-result ingestion context.
- Current comments and admin UI wording already say the deposit chain should converge on lifecycle snapshots plus `TX_DEPOSIT_FINAL`.
- This means the historical risk context is no longer part of the active operator path and now remains only as historical replay / ingestion boundary.

### B. tx response lifecycle compatibility normalization
- Transaction compliance runtime still normalizes older provider/status vocabulary into:
  - `CREATED`
  - `RECEIVED`
  - `FINAL`
- This is compatible and useful, but it is still a residual compatibility boundary that should remain visible.

### C. support-surface boundary still partially open
- `tx-cases/mock-backfill` is no longer exposed as admin surface.
- Historical data repair, if ever needed again, must now use a dedicated script or one-off remediation thread rather than a long-lived admin endpoint.
- This residual class is therefore closed for the active runtime.

## Concrete Findings From Current Review
| Finding | Files | Classification | Current Judgment |
| --- | --- | --- | --- |
| deposit travel-rule update path still evaluates risk with historical `TX_DEPOSIT_TRAVEL_RULE` context, but code and operator surface now treat it as replay / ingestion-only history while `TX_DEPOSIT_FINAL` remains the active decision root | `src/modules/risk-engine/transaction-compliance/transaction-risk-bridge.service.ts` | historical transaction risk context retention | active operator truth closed on `2026-03-30`; runtime compatibility remains intentionally historical |
| admin risk-policy execution page no longer advertises `TX_DEPOSIT_TRAVEL_RULE` as current operator simulation surface | `admin-web/src/pages/RiskPolicyExecutionsPage.tsx` | operator-facing legacy trace visibility | closed on `2026-03-30`; only per-record historical rendering remains |
| transaction compliance runtime still exposes compatibility lifecycle normalization through `normalizeKytResponseLifecycleStatus`, `normalizeTravelRuleResponseLifecycleStatus`, and read APIs such as `listKytCases` / `listTravelRuleCases` | `src/modules/risk-engine/transaction-compliance/types/tx-compliance.types.ts`, `src/modules/risk-engine/transaction-compliance/transaction-compliance.service.ts` | tx response lifecycle compatibility normalization | active compatibility boundary; semantically acceptable, not yet retired |
| `tx-cases/mock-backfill` has been removed from controller, service, DTO, and RBAC route catalog | `src/modules/risk-engine/transaction-compliance/transaction-compliance-admin.controller.ts`, `src/modules/risk-engine/transaction-compliance/transaction-compliance.service.ts`, `src/modules/risk-engine/transaction-compliance/dto/tx-compliance.dto.ts`, `src/modules/identity/access-control/rbac.catalog.ts` | closed support-surface retirement | retired on `2026-03-30`; do not reintroduce without a new explicit decision |

## What This Inventory Means In Practice
- `Wave 5` should not be treated as “nothing left to inspect.”
- `Wave 5` also should not be reopened as a business redesign wave.
- The right posture is:
1. preserve the current canonical deposit workflow
2. keep retained simulation / compensation surface boundaries explicit
3. remember the remaining historical/compatibility traces
4. treat `mock-backfill` retirement as complete unless a new remediation design explicitly revives it
5. retire the remaining traces only when later-wave dependencies are also in scope

## Recommended Future Order
1. keep `Wave 5` semantic truth frozen
2. when later waves touch transaction compliance or risk-policy execution, check whether they still depend on:
   - `TX_DEPOSIT_TRAVEL_RULE`
   - lifecycle compatibility status normalization
3. only after downstream/operator dependencies are cleared, propose runtime retirement

## Explicitly Not Recommended Now
- Do not remove `TX_DEPOSIT_TRAVEL_RULE` handling without checking whether historical provider-result ingestion still needs replay/query support.
- Do not remove lifecycle compatibility normalization without proving that no active provider payload, seeded record, or operator query still depends on it.
- Do not reintroduce `tx-cases/mock-backfill` as a casual admin endpoint; any revival requires a new explicit operator/remediation decision.
- Do not reinterpret intentionally retained simulation / compensation surfaces as cleanup debt.

## Exit Condition
- `Wave 5 residual cleanup` can be considered complete only when:
1. deposit runtime no longer relies on historical `TX_DEPOSIT_TRAVEL_RULE` path outside explicitly approved replay/archival boundaries
2. tx response lifecycle normalization is either retired or explicitly justified by a still-active producer/reader
3. any future historical repair path is explicitly designed instead of being left as an undeclared admin support route

## Practical Conclusion
- `Wave 5` is complete enough to stay closed as a semantic wave.
- `Wave 5` residual retirement is complete for the active admin route surface and operator-facing travel-rule legacy hint.
- `Wave 5` is not clean enough to pretend all historical and compatibility traces are gone.
- This file exists so those residuals stay visible when later waves are reviewed.
