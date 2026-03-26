# Acceptance Docs

Status: active
Owner: project-owner-and-agents
Last Updated: 2026-03-24
Applies To: `Exchange_js`
Supersedes: none
Depends On: `docs/README.md`
Source of Truth Level: acceptance

## Purpose
- Use this folder for runbooks, step-by-step validation, operator checklists, and demo acceptance.
- This is the layer that teaches testers, operators, and demo owners how to validate current behavior in practice.
- Do not move user/operator validation steps into workflow specs or module specs unless they are needed as semantic background only.

## Current Key Acceptance Docs
- `docs/acceptance/wave-1-foundation-final-acceptance.md`
  - Final acceptance conclusion for Wave 1 governance / audit foundation. This is the result-summary page, not a replacement for the detailed governance checklist or runtime runbook.
- `docs/acceptance/wave-2-wave-3-final-acceptance-checklist.md`
  - Top-level final acceptance and operator runbook for Wave 2 case kernel and Wave 3 onboarding / periodic review runtime.
- `docs/acceptance/wave-5-payin-deposit-final-acceptance-checklist.md`
  - Wave 5 final acceptance entry for happy path, review-clear path, reject path, and accounting-block path.
- `docs/acceptance/wave-5-deposit-accounting-blocked-runbook.md`
  - Operator runbook for `DEPOSIT_ACCOUNTING_BLOCKED` diagnosis, compensation boundary, and Audit Center triage.
- `docs/acceptance/wave-5-deposit-evidence-export-runbook.md`
  - Audit Center export walkthrough for deposit evidence package interpretation and replay.
- `docs/acceptance/onboarding-compliance-center-wave3-acceptance-checklist.md`
  - Focused onboarding + compliance-center manual script.
- `docs/acceptance/local-main-runtime-runbook.md`
  - Local runtime repair and validation runbook.
- `docs/acceptance/wave-4-ledger-asset-structure-acceptance-checklist.md`
  - Draft Wave 4 manual acceptance target for config release, quote, clearing, journal, and wallet-balance validation.

## Update When
- Validation flow changes.
- Demo path changes.
- Expected results or caveats change.

## Do Not Use For
- Permanent workflow truth.
- Constraint ownership.

## Wave Completion Rule
- Every completed wave MUST leave at least one final acceptance or final runbook document in this folder.
- That document MUST explain:
1. who runs the validation
2. which chain to execute
3. what to expect
4. how to confirm success
