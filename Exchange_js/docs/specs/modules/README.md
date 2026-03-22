# Module Specs

Status: active
Owner: project-owner-and-agents
Last Updated: 2026-03-22
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

## Current Module Specs
- `docs/specs/modules/compliance-center-module.md`
- `docs/specs/modules/risk-engine-module.md`
- `docs/specs/modules/customer-onboarding-module.md`
- `docs/specs/modules/periodic-review-module.md`
- `docs/specs/modules/approvals-module.md`
- `docs/specs/modules/audit-logging-module.md`
- `docs/specs/modules/audit-logging-product-doc.md`
- `docs/specs/modules/audit-logging-technical-doc.md`

## Update When
- A subsystem contract changes.
- A module boundary changes.
- A shared implementation pattern becomes durable enough to document.

## Do Not Use For
- Detailed field-level truth that belongs in entity specs.
- Step-by-step user acceptance scripts that belong in `docs/acceptance/**`.
