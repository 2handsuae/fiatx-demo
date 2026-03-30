# Wave 6 Residual Cleanup Inventory

Status: active
Owner: project-owner-and-agents
Last Updated: 2026-03-30
Applies To: `Exchange_js`
Supersedes: none
Depends On: `docs/roadmap/wave-6-pricing-quote-swap-phase-plan.md`, `docs/cleanup/wave-6-cleanup-master-plan.md`, `docs/acceptance/wave-6-swap-final-acceptance-checklist.md`
Source of Truth Level: cleanup

## Purpose
- This file records the post-retirement residual judgment for `Wave 6`.
- It exists so future cleanup threads do not accidentally reopen `Wave 6` after the active `quote-root` retirement is complete.

## Current Judgment
- `Wave 6 semantic closure = complete`
- `Wave 6 cleanup closeout = complete`
- `Wave 6 quote-root retirement = complete`
- The current branch no longer treats:
  - `quoteId` as the active `SWAP` trace root
  - `quoteNo` as the active `SWAP` workflow summary root
  - quote-only swap export selection as an active operator path

## Confirmed Closed Findings
| Finding | Files | Result |
| --- | --- | --- |
| swap workflow trace previously allowed `swapNo -> quoteNo -> id` fallback | `src/modules/trading/swap-transactions/swap-transaction-workflow.service.ts` | retired; `SWAP` trace now resolves from `swapId / swapNo` only |
| swap risk / alert / case audit previously wrote `workflowId / workflowNo` from `quoteId / quoteNo` | `src/modules/risk-engine/transaction-compliance/transaction-risk-bridge.service.ts` | retired; active audit root is now `swapId / swapNo` |
| swap audit/evidence export previously expanded quote-root and retained quote-only workflow summary behavior | `src/modules/risk-engine/audit-logs/audit-logs.service.ts` | retired; active export/query root is now `swapId / swapNo` only |
| acceptance and workflow docs previously still described quote-root export | `docs/acceptance/**`, `docs/specs/workflows/swap-canonical-workflow.md` | retired; active docs now describe `swap-root-only` export |

## Remaining Frozen Compatibility Boundary
- Shared manual-risk compatibility shell remains intentionally readable at historical / ingestion boundaries:
  - `ONBOARDING_CDD.mockDataType`
  - `InboundTransferSignal.simulationRiskLevel`
  - `InboundTransferSignal.simulationRiskReason`
- These fields are not `Wave 6` active truth.
- They are retained compatibility shared with other waves and should only be revisited in a dedicated cross-wave compatibility thread.

## What This Means In Practice
- `Wave 6` should not be reopened as an active residual-retirement wave.
- Future `SWAP` work should assume:
  1. active workflow trace root = `swapId / swapNo`
  2. active audit / evidence export root = `swapId / swapNo`
  3. `quoteId / quoteNo` = linked evidence only

## Explicitly Not Recommended
- Do not reintroduce `quoteId / quoteNo` fallback for convenience in operator search or evidence export.
- Do not treat retained `simulationRisk*` or `mockDataType` compatibility as a reason to reopen `Wave 6` cleanup.

## Practical Conclusion
- `Wave 6` is now closed as:
  - semantic truth complete
  - cleanup closeout complete
  - active operator/audit/export root retirement complete
- The only remembered residue is the frozen shared manual-risk compatibility shell, which is no longer a `Wave 6`-specific active debt.
