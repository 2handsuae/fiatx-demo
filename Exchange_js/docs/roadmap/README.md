# Roadmap Docs

Status: active
Owner: project-owner-and-agents
Last Updated: 2026-03-27
Applies To: `Exchange_js`
Supersedes: none
Depends On: `docs/README.md`
Source of Truth Level: roadmap

## Purpose
- Use this folder for project, wave, and phase planning.
- These documents define delivery scope and sequencing.
- For completed waves, roadmap docs also record the completion note and point readers to durable constraints/specs/acceptance.

## Update When
- A wave boundary changes.
- A phase scope or order changes.
- A milestone, dependency, or non-goal changes.
- A wave moves from in-progress to complete and needs durable references to:
1. constraints
2. workflow specs
3. entity specs
4. module specs
5. acceptance runbooks

## Current Key Roadmap Docs
- `docs/roadmap/project-version-plan.md`
  - Top-level project wave sequencing and wave summaries.
- `docs/roadmap/wave-2-compliance-foundation-phase-plan.md`
  - Completed Wave 2 phase breakdown and historical closure context.
- `docs/roadmap/wave-3-customer-onboarding-phase-plan.md`
  - Completed Wave 3 phase breakdown and current durable references.
- `docs/roadmap/wave-4-ledger-asset-structure-phase-plan.md`
  - Active Wave 4 phase plan for ledger, wallet/account model, config release model, and pricing/quote baseline.
- `docs/roadmap/wave-5-payin-deposit-phase-plan.md`
  - Completed Wave 5 phase breakdown and historical phase context through `Phase 4`.
  - Durable runtime truth now lives in `docs/constraints/**`, `docs/specs/**`, and `docs/acceptance/**`; `docs/cleanup/wave-5-cleanup-master-plan.md` is retained as the completed closeout record.
- `docs/roadmap/wave-6-pricing-quote-swap-phase-plan.md`
  - Runtime-complete and cleanup-complete Wave 6 sequencing record for swap pricing, quote execution, manual risk simulation, fee closure, and evidence export.
  - Completed cleanup history is retained in `docs/cleanup/wave-6-cleanup-master-plan.md`.
- `docs/roadmap/wave-7-withdraw-payout-phase-plan.md`
  - Active Wave 7 sequencing record for withdraw / payout canonical runtime, transaction-risk rollout, minimum reconciliation closeout, and post-Wave 7 handoff to Wave 8 finance ops and Wave 9 governance ops.

## Do Not Use For
- Hard behavioral constraints.
- Permanent workflow semantics.
- Cleanup-stage deletion details.

## Completion Rule
- A completed wave doc MUST include:
1. current completion status
2. durable references to constraints/specs/acceptance
3. an explicit note that cleanup docs are archived history, not the main runtime truth
