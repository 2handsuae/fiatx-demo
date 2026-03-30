# Cross-Wave Cleanup Priority Summary

Status: active
Owner: project-owner-and-agents
Last Updated: 2026-03-30
Applies To: `Exchange_js`
Supersedes: none
Depends On: `docs/cleanup/README.md`, `docs/roadmap/project-version-plan.md`
Source of Truth Level: cleanup

## Purpose
- This file consolidates the current cleanup judgment across `Wave 1-7`.
- It exists to answer three practical questions:
  1. which waves are already residual-only
  2. which waves still have active cleanup closeout work
  3. what order future cleanup threads should follow
- It is not a source-of-truth workflow document.
- Long-term runtime truth still belongs to:
  - `docs/constraints/**`
  - `docs/specs/**`
  - `docs/acceptance/**`

## Portfolio Judgment
- The current wave portfolio now splits into three groups:
  1. `residual-only`
     - `Wave 1`
     - `Wave 2`
     - `Wave 3`
     - `Wave 4`
     - `Wave 5`
     - `Wave 6`
     - `Wave 7`
  2. `cross-wave dependency layer`
     - `Wave 2/3 -> later transaction/compliance surfaces`
- The key interpretation is:
  - do not reopen semantically closed waves as redesign waves
  - do not pretend active cleanup waves are already residual-only
  - do not clean cross-wave residue inside a single wave label when downstream readers still exist

## Wave Summary Table
| Wave | Runtime / semantic judgment | Cleanup posture | Current remembered debt | Recommended posture |
| --- | --- | --- | --- | --- |
| `Wave 1` | implementation-complete, documentation-complete | residual-only | no immediate safe runtime dead-code candidate; only physical/doc/dead-code scope remains | keep frozen; touch only with explicit target |
| `Wave 2` | semantic closure complete; core convergence complete | residual-only with downstream dependency | physical `incidentNo / owner* / report*`; shared legacy decision compatibility edge; later-wave linked-case readers still exist | keep closed; clean only with later-wave dependency scope |
| `Wave 3` | semantic closure complete; core convergence complete | residual-only with shared bridge and downstream dependency | physical `caseNo / caseType`; archived `onboardingAuditLogs`; shared `ownerUserId` fallback at compatibility boundary | keep closed; clean only with shared bridge or later-wave dependency scope |
| `Wave 4` | implemented scope landed; cleanup closeout complete | residual-only | historical migration SQL / cleanup traces only | keep closed; touch only for explicit residual targets |
| `Wave 5` | semantic closure complete; cleanup closeout complete | residual-only historical/compatibility trace | historical `TX_DEPOSIT_TRAVEL_RULE` replay boundary; tx response lifecycle normalization compatibility edge | keep closed; no active admin-surface retirement left |
| `Wave 6` | semantic closure complete; cleanup closeout complete | residual-only | frozen shared manual-risk compatibility shell only | keep closed; do not reopen without cross-wave compatibility scope |
| `Wave 7` | semantic closure complete; cleanup closeout complete; active residual retirement complete | residual-only closure record | frozen historical compatibility shell only: legacy persisted payout `CLEAR`, historical `PRECHECK` replay support, legacy response lifecycle input parsing | keep closed; do not reopen without explicit archival-scope need |

## Priority Tiers
### `P1` downstream convergence threads only if later-wave readers are explicitly in scope
- `Wave 2/3 -> later transaction/compliance surfaces`

Why:
- `Wave 2 + Wave 3` core runtime is now converged.
- The remaining residue is mainly in downstream later-wave readers, not in the core case / onboarding / periodic-review surfaces themselves.

### `P2` historical-only residual review
- `Wave 6`
- `Wave 4`

Why:
- `Wave 6` active operator/audit/export root retirement is complete; only frozen shared compatibility memory remains.
- `Wave 4` is already closeout-complete and mostly leaves historical migration / cleanup traces.
- It is lower urgency than live compatibility edges in later transaction waves.

### `P3` explicit-target-only cleanup
- `Wave 1`

Why:
- `Wave 1` has no broad open cleanup story left.
- The remaining space is low-yield unless a concrete target is identified in advance.

## Recommended Execution Order
1. `Wave 1 explicit-target cleanup`
   - only when a concrete physical/doc/dead-code target is identified first
2. `Wave 2/3 downstream residual retirement`
   - review later-wave transaction / reconciliation linked-case projections
   - review any remaining shared bridge dependency that sits outside the core runtime
3. `Wave 6 historical compatibility review`
   - revisit only if shared manual-risk compatibility retirement becomes in scope
4. `Wave 4 residual retirement`
   - review historical migration SQL / cleanup-only traces if and only if they become worth touching
5. `Wave 5 historical-only residual review`
   - revisit only if replay/export or compatibility-boundary policy changes

## Do Not Misclassify
- Do not reopen `Wave 7` as an active cleanup-closeout wave or an active residual-retirement wave.
- Do not reopen `Wave 5` or `Wave 6` as active redesign waves.
- Do not reopen `Wave 4` as an active cleanup-closeout wave after `2026-03-30` closeout.
- Do not reopen `Wave 2 + Wave 3` as a new core-convergence thread after `2026-03-30`.
- Do not clean downstream `Wave 2/3` residue under a single-wave label when later-wave readers are still alive.
- Do not use `Wave 1 cleanup` as a reason to change governance semantics.

## Practical Threading Rule
- If the next thread is mainly about:
  - transaction export/query fallback retirement
    - start with `Wave 5` or `Wave 6`
  - frozen historical replay boundaries after Wave 7 closeout
    - start with a narrow archival / compatibility thread, not a new Wave 7 cleanup thread
  - later-wave linked-case projections or shared downstream readers of old case/response identity
    - start with a downstream `Wave 2/3` residual thread, not a new core-convergence thread
  - historical migration / cleanup-only traces that remain after Wave 4 closeout
    - start with a `Wave 4 residual` thread, not a new Wave 4 closeout thread
  - small historical cleanup with a single file or dead shell target
    - `Wave 1` can be handled last

## Practical Conclusion
- `Wave 5` residual retirement is complete for the active route and operator surface.
- `Wave 6` residual retirement is complete for active operator, audit, and export roots.
- `Wave 7` residual retirement is complete for active runtime, operator surface, and acceptance semantics.
- No later-wave active cleanup thread remains open by default.
- `Wave 1` is now the only standing explicit-target cleanup thread, and even that should move only when a concrete physical/doc/dead-code target is selected first.
