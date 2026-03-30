# Wave 1 Code Cleanup Candidate List

Status: active
Owner: project-owner-and-agents
Last Updated: 2026-03-30
Applies To: `Exchange_js`
Supersedes: none
Depends On: `docs/cleanup/wave-1-residual-cleanup-inventory.md`, `docs/acceptance/wave-1-foundation-final-acceptance.md`, `docs/specs/workflows/governance-sla-timer-workflow.md`, `docs/specs/workflows/change-ticket-release-gate-workflow.md`, `docs/specs/workflows/delete-request-soft-delete-workflow.md`
Source of Truth Level: cleanup

## Purpose
- This file records the current code-level scan results for `Wave 1` residual cleanup.
- It narrows the residual inventory from category-level rules into concrete code candidates and non-candidates.
- It is intentionally conservative: if a candidate still looks semantically risky, this file records it as blocked instead of treating it as safe cleanup.

## Scan Scope
- Governance runtime:
  - `src/modules/governance/approvals/**`
  - `src/modules/governance/change-tickets/**`
  - `src/modules/governance/delete-requests/**`
  - `src/modules/governance/sla-timers/**`
- Identity / admin boundary runtime:
  - `src/modules/identity/access-control/**`
  - `src/modules/identity/users/**`
  - `src/modules/identity/auth/**`
- Nearby operator surfaces checked for live dependency evidence:
  - `admin-web/src/**`
  - `docs/specs/**`
  - `docs/acceptance/**`

## Scan Summary
- Current result: no `Wave 1` runtime code candidate is yet proven safe for immediate deletion.
- Current result: canonical Wave 1 taxonomy already appears converged in code constants:
  - approval action types
  - change ticket types
  - delete request target types
  - SLA timer types
- Current result: the most suspicious-looking leftovers in or near Wave 1 fall into three buckets:
1. active demo/test surfaces that are still referenced by acceptance or RBAC
2. strings that look legacy at first glance but are still canonical in current runtime context
3. genuine legacy/compatibility items that belong to later waves, not Wave 1

## Ready-To-Clean Candidates
- none yet
- A future item may move into `ready` only after proving:
  - no active route/UI/spec/acceptance dependency remains
  - no semantic interpretation changes
  - no canonical audit/governance contract changes

## Blocked Or Not-Ready Wave 1 Candidates
| Candidate | Files | Why It Looked Suspicious | Why It Is Not Ready | Current Classification |
| --- | --- | --- | --- | --- |
| SLA demo controller and mock service | `src/modules/governance/sla-timers/sla-timer-demo.controller.ts`, `src/modules/governance/sla-timers/sla-timer-mock.service.ts`, `src/modules/governance/sla-timers/sla-timers.module.ts` | looks like demo-only runtime surface | still referenced by acceptance, workflow spec, and RBAC route catalog; deleting it would change documented operator/demo behavior | blocked-active-demo-surface |
| `APPROVAL_CASE` strings in SLA subject typing and admin detail rendering | `src/modules/governance/sla-timers/constants/sla-timer.constants.ts`, `src/modules/governance/sla-timers/sla-timers.service.ts`, `admin-web/src/pages/SlaTimerDetailPage.tsx` | could be mistaken for the retired delete target | in this context it is the canonical SLA subject type for approval-backed timers, not a deprecated delete target | not-a-cleanup-item |
| repeated system-actor helper payloads in governance services | `src/modules/governance/approvals/approvals.service.ts`, `src/modules/governance/change-tickets/change-tickets.service.ts`, `src/modules/governance/delete-requests/delete-requests.service.ts`, `src/modules/governance/sla-timers/sla-timers.service.ts` | looks repetitive and refactorable | this is runtime actor/audit semantics, not dead code; deduping it would be refactor work, not cleanup-only work | out-of-scope-refactor |

## Items Confirmed Already Clean In Wave 1
| Area | Evidence | Conclusion |
| --- | --- | --- |
| approval action taxonomy | `src/modules/governance/approvals/constants/approval.constants.ts` | only canonical 5 approval action types remain |
| change ticket taxonomy | `src/modules/governance/change-tickets/constants/change-ticket.constants.ts` | only canonical 6 change ticket types remain |
| delete request target taxonomy | `src/modules/governance/delete-requests/constants/delete-request.constants.ts` | only canonical 4 target types remain |
| SLA timer taxonomy | `src/modules/governance/sla-timers/constants/sla-timer.constants.ts` | only canonical 2 timer types remain |

## Non-Wave-1 Findings Discovered During The Scan
These findings are real, but they should not be cleaned under a `Wave 1` label.

| Finding | Files | Likely Wave | Notes |
| --- | --- | --- | --- |
| legacy incident owner fallback | `src/modules/identity/onboarding/onboarding.service.ts`, `src/modules/identity/periodic-review/periodic-review.service.ts` | Wave 2 / Wave 3 | tied to compliance/case assignee convergence, not Wave 1 governance cleanup |
| frontend backward-compatible permission aliases | `admin-web/src/rbac/permissions.ts` | Wave 4 or frontend cleanup | no current usage found in code scan, but the aliases are pricing/config surface debt, not Wave 1 |
| legacy withdraw status badge helpers | `admin-web/src/utils/transactionRootDisplay.ts`, `admin-web/src/pages/WithdrawTransactionList.tsx`, `admin-web/src/pages/WithdrawTransactionDetail.tsx` | Wave 7 | this is withdraw UI compatibility, not governance/audit cleanup |

## Recommended Next Actions
1. do not delete any Wave 1 runtime code yet
2. if a future thread wants to remove SLA demo endpoints, first refile it as a semantics-affecting thread and update:
   - `docs/specs/workflows/governance-sla-timer-workflow.md`
   - `docs/acceptance/governance-e2e-acceptance-checklist.md`
   - RBAC route catalog truth
3. if a future thread wants to dedupe system-actor helpers, treat it as a refactor thread with explicit audit regression checks
4. if a future cleanup thread wants a real code deletion candidate, start by proving that no acceptance/runbook/spec path still depends on it

## Practical Conclusion
- The current `Wave 1` residual cleanup track is still mostly a documentation/index boundary, not a runtime code-deletion track.
- That is acceptable and consistent with:
  - `implementation-complete`
  - `documentation-complete`
  - `runtime compat debt = 0`
- In other words: current Wave 1 cleanup is narrow because Wave 1 is already genuinely converged.
