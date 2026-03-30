Status: active
Owner: project-owner-and-agents
Last Updated: 2026-03-30
Applies To: `Exchange_js`
Supersedes: none
Depends On: `docs/constraints/onboarding-flow-constraints.md`, `docs/roadmap/wave-3-customer-onboarding-phase-plan.md`
Source of Truth Level: specs-entity

# Customer Entity

## Purpose
- This document defines the canonical customer lifecycle fields used by onboarding, customer management, and periodic review.

## Related Canonical Docs
- `docs/specs/entities/review-response-entity.md`
- `docs/specs/entities/periodic-review-cycle-entity.md`
- `docs/specs/entities/approval-case-entity.md`
- `docs/specs/workflows/onboarding-canonical-workflow.md`
- `docs/specs/workflows/periodic-review-canonical-workflow.md`
- `docs/specs/modules/customer-onboarding-module.md`
- `docs/specs/modules/periodic-review-module.md`

## Canonical Status Fields
- `onboardingStatus`
- `operatingStatus`
- `restrictionStatus`
- `complianceHoldStatus`

## Canonical Meaning
- `onboardingStatus` answers where the customer is in onboarding.
- `operatingStatus` answers whether the customer may actively operate.
- `restrictionStatus` answers whether the customer is restricted.
- `complianceHoldStatus` answers whether the customer is frozen by compliance hold semantics.

## Non-Negotiable Runtime Rule
- Customer-facing and admin-facing flows MUST derive lifecycle truth from canonical customer fields.
- `getNextStep` is guidance only and MUST NOT replace canonical customer status as the main state source.

## Legacy Status Retirement
- The following legacy customer status fields are no longer active contract:
  - `publicStatus`
  - `cddStatus`
  - `eddStatus`
  - `complianceStatus`
  - `finalApprovalStatus`
  - `accountStatus`
- They may remain only in migrations, historical fixtures, and archived cleanup context.

## Canonical Final Approval Summary
- Active customer and workflow surfaces MUST derive final-approval truth from:
  - `latestFinalApprovalId`
  - `latestFinalApprovalStatus`
  - canonical customer status fields
- Compatibility `finalApprovalStatus` is retired and MUST NOT be treated as active workflow or customer-detail truth.

## Archived Audit Mirror
- `onboardingAuditLogs` MAY still appear on admin `Customer Detail`.
- When shown there, it is archived / historical context only.
- Canonical audit truth lives in `Audit Center`, not in the customer read-model mirror.

## Workflow Relationship
- `CDD Response` and `EDD Response` are evidence containers, not customer lifecycle fields.
- `ONBOARDING_FINAL_APPROVAL` is a separate approval object, not a customer status field.
- Periodic review is a separate workflow and does not rewrite `onboardingStatus`.
