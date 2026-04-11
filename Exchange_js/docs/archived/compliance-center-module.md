Status: active
Owner: project-owner-and-agents
Last Updated: 2026-03-26
Applies To: `Exchange_js`
Supersedes: none
Depends On: `docs/specs/entities/compliance-alert-entity.md`, `docs/specs/entities/compliance-case-entity.md`
Source of Truth Level: specs-module

# Compliance Center Module

## Purpose
- This module provides the shared Wave 2 compliance kernel:
  - alert triage
  - case investigation
  - MLRO governance
  - external filing follow-up

## Bounded Context
- `Alert` is the triage kernel.
- `Case` is the investigation kernel.
- Workflow-bound consumers such as onboarding, periodic review, and deposit transaction workflows integrate into this module; they do not replace it.

## Canonical Entrypoints
- Alerts:
  - `GET /admin/compliance/alerts`
  - `GET /admin/compliance/alerts/:id`
  - `PATCH /admin/compliance/alerts/:id/action`
  - `POST /admin/compliance/alerts/:id/resolve`
- Cases:
  - `GET /admin/compliance/cases`
  - `GET /admin/compliance/cases/:id`
  - `POST /admin/compliance/cases/from-alert/:alertId`
  - `PATCH /admin/compliance/cases/:id/action`
  - `PUT /admin/compliance/cases/:id/report/draft`
  - `POST /admin/compliance/cases/:id/report/finalize`
  - `POST /admin/compliance/cases/:id/report/submit-to-mlro`
  - `POST /admin/compliance/cases/:id/mlro-review`
  - `POST /admin/compliance/cases/:id/filing/submit`
  - `POST /admin/compliance/cases/:id/filing/feedback`
  - `POST /admin/compliance/cases/:id/filing/close`

## Upstream / Downstream Dependencies
- Upstream:
  - risk engine recommendation/orchestration
  - onboarding workflow
  - periodic review workflow
  - deposit transaction workflow
- Downstream:
  - approvals for onboarding final approval
  - audit center for canonical trace
  - customer control state changes
  - canonical deposit callback execution

## Historical Aliases / Retired Names
- `incident` is historical physical/runtime naming only.
- `/admin/compliance/incidents/**` is retired from active runtime.
- New runtime consumers MUST use `/cases/**`.

## Transaction Workflow Binding
- Deposit transaction workflow is a workflow-bound consumer of Compliance Center.
- `FALSE_POSITIVE` on a workflow-bound deposit alert MUST resolve through canonical deposit `CLEAR` callback rather than by direct deposit write.
- MLRO-approved transaction case `CLEAR` / `REJECT` MUST resolve through canonical deposit callback execution.
- Compliance Center remains the triage/investigation kernel only:
  - it owns alert and case lifecycle
  - it does not become the source of truth for `deposit.status`

## MUST / MUST NOT
- MUST call current case/alert surfaces for investigation and triage behavior.
- MUST treat alert public interaction as:
  - work-item assignment via `PATCH /admin/compliance/alerts/:id/action`
  - canonical resolution via `POST /admin/compliance/alerts/:id/resolve`
- MUST NOT write compliance case fields directly from business modules to bypass kernel rules.
- MUST NOT treat provider response containers as cases.
- MUST NOT write `deposit.status` directly from alert/case services outside canonical callback execution.
