Status: active
Owner: project-owner-and-agents
Last Updated: 2026-03-26
Applies To: `Exchange_js`
Supersedes: none
Depends On: `docs/specs/workflows/swap-canonical-workflow.md`, `docs/specs/entities/pricing-quote-entity.md`
Source of Truth Level: acceptance

# Wave 6 Best Execution Evidence Export Runbook

## Purpose
- Explain how to interpret a Wave 6 swap evidence package.

## Current Proof Standard
- The current runtime proves `policy-consistent execution evidence`.
- The package does NOT claim “best venue across the full market”.
- This limitation is intentional because the runtime still executes under a single-LP assumption.

## What The Package Must Show
- request snapshot
- pricing policy snapshot
- market source snapshot
- quote snapshot
- swap lifecycle snapshot
- transaction risk decision
- workflow-bound alert / case evidence
- journal evidence
- outstanding evidence
- final outcome

## How To Read The Package
1. Start from `manifest.workflowSummary`.
2. For `workflowType=SWAP`, treat `workflowSummary.workflowNos` as the canonical `swapNo` reference.
3. Open the swap evidence chain row for the target `swapId`.
4. Confirm the linked `quoteId` and `quoteNo`.
5. Verify `policyRef`, market source, formula, and TTL in the quote snapshot.
6. Verify the swap consumed that exact quote.
7. Verify the risk decision and any alert/case ids.
8. Verify the journal ids and outstanding ids.
9. Confirm the terminal outcome:
   - `SUCCESS`
   - `REJECTED`
   - `FAILED`

## Interpretation Rule
- If quote, swap, risk, and accounting ids line up across the package, the runtime has proven that the trade executed consistently with the active pricing policy and the frozen quote snapshot.
- `quoteNo` remains required linked evidence, but it must be confirmed from `swapEvidenceChain` or the quote snapshot rather than treated as an active workflow summary or export root.

## Future Extension Point
- If multi-LP execution is added later, the evidence package should append candidate LP comparison and route-selection rationale rather than replacing the current quote snapshot chain.
