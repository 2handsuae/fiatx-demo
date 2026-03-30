# Wave 7 Residual Cleanup Inventory

Status: active
Owner: project-owner-and-agents
Last Updated: 2026-03-30
Applies To: `Exchange_js`
Supersedes: none
Depends On: `docs/roadmap/wave-7-withdraw-payout-phase-plan.md`, `docs/cleanup/wave-7-cleanup-master-plan.md`, `docs/acceptance/wave-7-cleanup-closeout-baseline.md`
Source of Truth Level: cleanup

## Purpose
- This file records the final residual-retirement judgment for `Wave 7`.
- It exists because `Wave 7` closeout is now complete at the active runtime, operator-contract, and acceptance layer, while a few explicit historical/compatibility traces are intentionally frozen.
- It is not an active implementation plan. It is a closure record and boundary document for future historical-review threads.

## Current Judgment
- `Wave 7` remains complete in the current official scope:
  - runtime main chain landed
  - cleanup closeout complete
  - acceptance and evidence baseline active
  - cleanup master preserved as closure record
- Long-term truth still belongs to:
  - `docs/constraints/**`
  - `docs/specs/**`
  - `docs/acceptance/**`
- However, the current branch still contains explicit `Wave 7`-related frozen compatibility traces.
- Therefore the correct interpretation is:
  - `Wave 7 semantic closure = complete`
  - `Wave 7 cleanup closeout = complete`
  - `Wave 7 active residual retirement = complete`
  - only frozen historical/compatibility support remains

## Why A Residual Inventory Is Needed
- `Wave 7` cleanup master now acts as a closure record and that remains correct.
- The current branch still retains a few compatibility boundaries that should not be forgotten:
  - old persisted/raw rail values normalized at read boundaries
  - historical `TX_WITHDRAW_PRECHECK / REVIEW_WITHDRAW_PRECHECK` replay support
  - legacy response lifecycle statuses in raw payload / adapter boundaries
- That does not reopen `Wave 7` as an active cleanup wave.
- It does mean future cleanup threads need a more precise memory than “Wave 7 is fully clean.”

## Confirmed Good End State
- The active Wave 7 path is already converged on:
  - `payin -> deposit`
  - `withdraw -> payout`
  - `TX_DEPOSIT_FINAL / TX_WITHDRAW_FINAL`
  - canonical alert / case / callback routing
  - approval-backed evidence export
  - minimum daily reconciliation
- Operator-facing cleanup now confirmed:
  - active alert stage filter no longer advertises `REVIEW_WITHDRAW_PRECHECK`
  - alert detail uses canonical `riskBand / riskReason` as primary truth
  - historical `simulationRisk*` values are no longer used as active alert truth
  - `PayinList` / `PayoutList` now use `adminFetch`
  - `PayinList` / `PayoutList` now display `ownerNo-first`
  - raw rail status and raw type differences no longer leak into admin display truth

## Residual Cleanup Classes
### A. frozen historical rail-value compatibility
- Active public contracts are now canonical:
  - `PayinType = CRYPTO / FIAT`
  - `PayoutType = CRYPTO / FIAT`
  - `PayinStatus.CLEARED`
  - `PayoutStatus.CLEARED`
- Historical stored/raw inputs may still carry:
  - lowercase payin type values
  - legacy payout status `CLEAR`
- Admin read-model and operator display remain canonicalized.
- The remaining compatibility survives only at read boundaries for old data and raw payloads.

### B. historical PRECHECK replay support
- Historical `TX_WITHDRAW_PRECHECK / REVIEW_WITHDRAW_PRECHECK` remains readable in:
  - audit trails
  - evidence export
  - historical decision / alert / case records
- These records are already read-only and no longer own any live workflow, simulation, or recommendation surface.

### C. legacy response lifecycle input support
- Legacy response states such as `PASS / ACCEPTED / NOT_REQUIRED / REVIEW / FAIL` still exist in raw payload compatibility and adapter logic.
- Active operator-facing lifecycle truth is already `CREATED / RECEIVED / FINAL`.
- The remaining compatibility should be treated as ingestion/history support, not active product semantics.

## Concrete Findings From Current Review
| Finding | Files | Classification | Current Judgment |
| --- | --- | --- | --- |
| active alert stage filter no longer includes `REVIEW_WITHDRAW_PRECHECK (Legacy)` | `admin-web/src/pages/ComplianceAlertsPage.tsx` | operator-surface closeout proof | fixed; keep historical query compatibility only |
| alert detail now shows canonical `riskBand / riskReason` as primary truth and moves `simulationRisk*` to historical compatibility only | `admin-web/src/pages/ComplianceAlertDetailPage.tsx` | operator-surface closeout proof | fixed; do not reintroduce fallback |
| payin/payout admin list pages now share request helper and normalize owner display through `ownerNo-first` | `admin-web/src/pages/PayinList.tsx`, `admin-web/src/pages/PayoutList.tsx` | operator-surface symmetry closeout proof | fixed; further cleanup should not reopen raw contract changes casually |
| active payin/payout contracts are canonicalized to uppercase type and `CLEARED`, while legacy stored/raw values remain readable through service normalization | `src/modules/asset-treasury/payins/dto/payin.dto.ts`, `src/modules/asset-treasury/payouts/dto/payout.dto.ts`, `src/modules/asset-treasury/payins/payins.service.ts`, `src/modules/asset-treasury/payouts/payouts.service.ts` | frozen historical rail-value compatibility | closed active residual; keep read-boundary normalization for old data |
| historical withdraw PRECHECK remains readable and explicitly guarded as read-only in risk / workflow services and tests | `src/modules/risk-engine/risk-decision-records.service.ts`, `src/modules/risk-engine/transaction-compliance/transaction-risk-bridge.service.ts`, `src/modules/trading/withdraw-transactions/withdraw-transaction-workflow.service.ts` | historical PRECHECK replay support | retained residual; keep readable, do not reactivate |
| legacy response statuses still exist in raw compatibility evaluation paths | `src/modules/risk-engine/risk-engine.service.ts` | legacy response lifecycle input support | retained residual; operator-facing truth already converged |

## What This Inventory Means In Practice
- `Wave 7` should no longer be treated as an active cleanup-closeout wave.
- `Wave 7` should also not be treated as “all historical/query/contract traces are gone.”
- The right posture is:
1. keep the current canonical Wave 7 workflow frozen
2. keep operator-facing truth on canonical display/read-model language
3. remember that a few raw/public/historical boundaries still exist
4. retire those traces only when replay, export, and downstream callers are explicitly in scope

## Recommended Future Order
1. keep `Wave 7` semantic truth frozen
2. when later waves touch audit/evidence replay, decide whether historical PRECHECK support can move from active runtime helpers to narrower archival boundaries
3. when later waves touch response ingestion, decide whether legacy response statuses can be retired from raw compatibility parsing
4. if historical raw rail values ever become removable, retire their read-boundary normalization in a dedicated migration thread

## Explicitly Not Recommended Now
- Do not reopen `Wave 7` as a redesign wave.
- Do not reopen the now-canonical `payin/payout` public contract just to revisit old stored/raw values.
- Do not remove historical PRECHECK query/evidence support without checking replay, export, and historical investigation callers.
- Do not reinterpret legacy response lifecycle parsing as active product debt after operator-facing truth has already converged.

## Exit Condition
- `Wave 7 residual cleanup` can be considered complete only when:
1. historical raw rail values are either physically migrated away or explicitly frozen as permanent historical-input support
2. historical PRECHECK support is either physically narrowed to archival/query surfaces or explicitly frozen as permanent historical support
3. legacy response lifecycle statuses are either retired from raw compatibility parsing or explicitly frozen as permanent historical-input support

## Practical Conclusion
- `Wave 7` is complete enough to leave the active cleanup-closeout tier.
- `Wave 7` is not clean enough to pretend every historical trace is gone.
- This file exists so those residuals stay visible when later waves are reviewed.
