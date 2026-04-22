# Domain: Onboarding & Compliance Rules
Last Updated: 2026-04-21 | Scope: Wave 1–4 | Source: docs/constraints/onboarding-flow-constraints.md

---

## Onboarding State Machine

**Progress-only lifecycle (non-terminal):**
```
NONE → PENDING_VERIFICATION → APPROVED
NONE → PENDING_VERIFICATION → FINAL_APPROVAL → APPROVED
```

**Terminal states:** `REJECTED`, `WITHDRAWN`

**Who can trigger:**
- Customer: `startVerification` (moves NONE → PENDING_VERIFICATION)
- Sumsub webhook events (drive all mid-flow transitions)
- Approvals module: `FINAL_APPROVAL → APPROVED` or `FINAL_APPROVAL → REJECTED`

**Key transition rules:**
- `applicantWorkflowCompleted` without `level2` experience → `APPROVED + ACTIVE` (skip FINAL_APPROVAL)
- `applicantWorkflowCompleted` after `level2` → `FINAL_APPROVAL` (requires approval signoff)
- `applicantWorkflowFailed` → `REJECTED + INACTIVE`
- `applicantReviewed + RED + RETRY` → stay `PENDING_VERIFICATION`, substatus `RESUBMIT_REQUIRED`, `canContinue=true`
- `applicantLevelChanged` to level2 → stay `PENDING_VERIFICATION`, substatus `NEXT_LEVEL_REQUIRED`, set `sumsubExperiencedLevel2=true`

**Forbidden:** Re-entering legacy raw states (`PENDING_CDD_INPUT`, `CDD_UNDER_REVIEW`, `PENDING_EDD_INPUT`, `EDD_UNDER_REVIEW`) in active runtime.

**Ownership rule:** Only `OnboardingService` may mutate customer lifecycle status. External callbacks MUST route through canonical workflow execution.

---

## CDD / EDD Gate Rules

- Active runtime is **Sumsub-first** — CDD/EDD responses are legacy evidence containers only.
- `CDD Response` and `EDD Response` MUST NOT be treated as pass/fail signals in active runtime.
- Legacy fields (`complianceStatus`, `cddStatus`, `eddStatus`) removed from schema — MUST NOT be reintroduced.
- `FINAL_APPROVAL` MUST only be created when workflow completed after customer experienced `level2`.
- `FINAL_APPROVAL` MUST NOT be created for `level1`-only workflow completions.

---

## Periodic Review Rules

- Periodic review audit store MUST be `audit_log_events` (not legacy `onboarding_audit_logs`).
- Audit trace root: `workflowType=ONBOARDING`, `traceId=customer.onboardingTraceId` (UUID v4 generated at `startVerification`, stored on `customer_main.onboardingTraceId`).
- One `audit_log_events` row per webhook event (real or simulated), action `SUMSUB_APPLICANT_<EVENT>`, `triggerType=DATA_UPDATE`.
- Expired approved customers currently follow the legacy compatibility path pending provider-first expiry re-entry implementation.

---

## Trading Eligibility Gate

**All four conditions MUST be satisfied to allow trading:**
1. `onboardingStatus = APPROVED`
2. `operatingStatus = ACTIVE`
3. `restrictionStatus != RESTRICTED`
4. `complianceHoldStatus != FROZEN`

**Blocked by any one of:**
- Onboarding not yet `APPROVED`
- Operating status `INACTIVE` or `SUSPENDED`
- `RESTRICTED` restriction status
- `FROZEN` compliance hold

Legacy fields MUST NOT be substituted for these four canonical fields.

---

## Material Refresh Rules

- `getNextStep` is the single source for onboarding guidance — competing next-step logic in controllers or frontend layers is forbidden.
- Canonical client projection mappings (MUST NOT deviate):
  - `onboardingStatus=NONE` → `START_VERIFICATION`
  - `PENDING_VERIFICATION + canContinue=true` → `CONTINUE_VERIFICATION`
  - `PENDING_VERIFICATION + canContinue!=true` → `WAIT_VERIFICATION`
  - `FINAL_APPROVAL` → `WAIT_FINAL_APPROVAL`
  - `REJECTED | WITHDRAWN` → `REINITIATE_VERIFICATION`
  - `APPROVED + ACTIVE` → terminal redirect
- Provider substatus guidance:
  - `CREATED | RESUBMIT_REQUIRED | NEXT_LEVEL_REQUIRED` → customer may continue
  - `SUBMITTED | UNDER_REVIEW | PROCESSING` → customer waits
  - `FAILED` → customer may reinitiate only after lifecycle moves to `REJECTED` or `WITHDRAWN`
- Simulation Mode MUST gate customer-side Sumsub event simulation; when disabled, MUST NOT expose simulation actions.
- Final approval submit/approve/reject MUST stay inside approvals module semantics.
