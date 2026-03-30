Status: draft
Owner: project-owner-and-agents
Last Updated: 2026-03-30
Applies To: `Exchange_js`
Supersedes: none
Depends On: `docs/constraints/backend-platform-constraints.md`, `docs/constraints/backend-domain-model-constraints.md`, `docs/constraints/backend-architecture-constraints.md`
Source of Truth Level: constraints

# Backend Workflow State Machine Constraints

## 1) Purpose
- This document defines the common workflow-state rules for backend workflow roots.

## 2) Workflow Root Rule
- Every workflow root MUST define:
1. root subject
2. owning service
3. canonical status set
4. allowed actions
5. transition guards
6. side effects
7. audit obligations
8. repair boundary

## 3) Ownership Rule
- Only the owning service MAY mutate the workflow root primary status.
- Other modules MAY request canonical actions, but MUST NOT write the root status ad hoc.

## 4) Action Rule
- Workflow actions MUST be named domain actions rather than free-form field patching.
- Unsupported transitions MUST be rejected explicitly.
- Repeated actions MUST be idempotent or fail clearly when replay is forbidden.

## 5) Side-Effect Rule
- Workflow side effects such as approvals, alerts, journals, clearings, payouts, evidence exports, and notifications MUST be bound to named transitions or actions.
- Side effects MUST NOT silently redefine workflow truth.

## 6) Multi-Status Rule
- Each subject may have one primary lifecycle `status`.
- Additional state axes such as approval status, execution status, export status, or compliance snapshot MUST be separated into explicit fields.

## 7) Invariants
- A workflow root MUST remain understandable without reading subordinate table internals.
- A subordinate subject MUST NOT become the hidden source of truth for the root lifecycle.

## 8) Forbidden Patterns
- MUST NOT let external callback handlers write root status directly without calling canonical workflow execution.
- MUST NOT use ambiguous generic patch actions in place of domain transitions.
- MUST NOT encode unrelated decision axes into one overloaded `status` field.

## 9) Change Protocol
- Any workflow state-machine change MUST include:
1. transition delta
2. side-effect delta
3. audit delta
4. compatibility and repair impact
