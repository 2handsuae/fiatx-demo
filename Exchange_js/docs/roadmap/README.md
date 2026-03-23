# Roadmap Docs

Status: active
Owner: project-owner-and-agents
Last Updated: 2026-03-23
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

## Do Not Use For
- Hard behavioral constraints.
- Permanent workflow semantics.
- Cleanup-stage deletion details.

## Completion Rule
- A completed wave doc MUST include:
1. current completion status
2. durable references to constraints/specs/acceptance
3. an explicit note that cleanup docs are archived history, not the main runtime truth
