# Module Specs

Status: active
Owner: project-owner-and-agents
Last Updated: 2026-03-23
Applies To: `Exchange_js`
Supersedes: none
Depends On: `docs/specs/README.md`, `docs/constraints/README.md`
Source of Truth Level: specs-module

## Purpose
- Use this folder for durable module-level documentation.
- These files describe subsystem boundaries, module responsibilities, and long-lived implementation structures that are broader than a single entity or workflow.
- Module specs are the main place to explain:
1. which entrypoints new code MUST call
2. which historical aliases or old module names still exist only for legacy context
3. which surfaces MUST NOT be used in new runtime work

## Typical Contents
- module overview
- major components
- canonical entrypoints
- key read/write responsibilities
- external dependencies
- integration boundaries
- historical aliases / retired names
- `MUST call` / `MUST NOT call directly`

## Archived Modules (2026-04-11)
The following module specs have been moved to `docs/archived/`:
- `compliance-center-module.md`, `risk-engine-module.md` — Wave 2 → Sumsub
- `periodic-review-module.md` — replaced by `wave3-layer2-risk-assessment.md` / `wave3-layer3-material-refresh.md`
- `audit-logging-technical-doc.md`, `audit-logging-product-doc.md` — replaced by `docs/constraints/audit-trace-context-constraints.md`

## Current Module Specs
- `docs/specs/modules/governance-control-foundation-module.md`
- `docs/specs/modules/rbac-member-management-module.md`
- `docs/specs/modules/customer-onboarding-module.md`
- `docs/specs/modules/approvals-module.md`
- `docs/specs/modules/audit-logging-module.md`
- `docs/specs/modules/accounting-ledger-module.md`
- `docs/specs/modules/pricing-center-module.md`
- `docs/specs/modules/asset-treasury-foundation-module.md`

## Update When
- A subsystem contract changes.
- A module boundary changes.
- A shared implementation pattern becomes durable enough to document.

## Do Not Use For
- Detailed field-level truth that belongs in entity specs.
- Step-by-step user acceptance scripts that belong in `docs/acceptance/**`.
