# Workflow Specs

Status: active
Owner: project-owner-and-agents
Last Updated: 2026-04-21
Applies To: `Exchange_js`
Supersedes: none
Depends On: `docs/specs/README.md`
Source of Truth Level: specs-workflow

## Purpose
- One document per workflow.
- Explain states, transitions, actors, trigger points, and contract outputs.
- Workflow specs explain how a durable flow behaves; field ownership and object identity belong in entity specs, not here.

## Recommended Topics
- purpose
- actors
- state model
- transitions
- triggers
- read/write ownership
- API / UI projection notes

## Archived Workflows (2026-04-11)
The following workflow specs have been moved to `docs/archived/`:
- `periodic-review-canonical-workflow.md` — replaced by `wave3-layer2-risk-assessment.md` / `wave3-layer3-material-refresh.md`
- `alert-triage-and-case-escalation.md`, `case-final-lifecycle-and-external-filing.md` — Wave 2 → Sumsub

## Current Workflow Specs
- `docs/specs/workflows/audit-evidence-export-approval-workflow.md`
  - Wave 1 approval-backed audit evidence export workflow.
- `docs/specs/workflows/change-ticket-release-gate-workflow.md`
  - Wave 1 governance change ticket and release gate lifecycle.
- `docs/specs/workflows/delete-request-soft-delete-workflow.md`
  - Wave 1 governed soft-delete and execution workflow.
- `docs/specs/workflows/governance-sla-timer-workflow.md`
  - Wave 1 governance SLA timer and notification-registry lifecycle.
- `docs/specs/workflows/admin-member-auth-boundary-workflow.md`
  - Wave 1 admin member invitation, activation, and auth-boundary workflow.
- `docs/specs/workflows/onboarding-canonical-workflow.md`
  - Canonical onboarding state machine and review/final-approval paths.
- `docs/specs/workflows/payin-deposit-canonical-workflow.md`
  - Canonical Wave 5 payin/deposit workflow, lifecycle-only response containers, final-review routing, accounting ordering, and evidence replay contract.
- `docs/specs/workflows/mlro-and-final-approval-governance.md`
  - MLRO gate, case close boundary, and onboarding EDD clear final-approval governance.
- `docs/specs/workflows/onboarding-periodic-review-audit-trace-contract.md`
  - Unified trace and Audit Center replay contract for onboarding and periodic review.
- `docs/specs/workflows/config-release-activation-workflow.md`
  - Wave 4 subject-scoped config release activation path.
- `docs/specs/workflows/quote-event-clearing-journal-workflow.md`
  - Wave 4 quote-to-event-to-clearing/journal orchestration contract.
- `docs/specs/workflows/swap-canonical-workflow.md`
  - Wave 6 canonical swap workflow for quote consume, automatic risk routing, and terminal accounting behavior.
- `docs/specs/workflows/withdraw-payout-canonical-workflow.md`
  - Wave 7 canonical withdraw / payout workflow for quote-confirm entry, single-stage final review, payout receipt, repair, and fail / return propagation.
- `docs/specs/workflows/safeguarding-reconciliation-workflow.md`
  - Active Wave 7 minimum daily reconciliation workflow for break-based customer-funds handling.
