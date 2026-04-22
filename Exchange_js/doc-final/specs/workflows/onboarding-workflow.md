# Customer Onboarding Workflow

Wave: 3 | Source verified: src/modules/identity/onboarding/onboarding.service.ts, onboarding-final-approval.service.ts, onboarding-admin.controller.ts, onboarding-customer.controller.ts, customer-status.util.ts, dto/onboarding.dto.ts, sumsub-ingestion/sumsub-ingestion.service.ts
Last Updated: 2026-04-21

## Purpose

Guide a new customer from account creation through KYC/KYB verification (CDD → optional EDD) to APPROVED status, gating all trading activity behind compliance sign-off.

## Actors / Systems

| Actor | Role |
|---|---|
| Customer | Submits KYC documents via Sumsub SDK (mobile/web) |
| Sumsub | External KYC/AML provider; processes documents, sends webhook results |
| OnboardingService | Orchestrates state transitions and responds to Sumsub events |
| OnboardingFinalApprovalService | Creates and tracks the FINAL_APPROVAL ApprovalCase; projects decision back onto customer |
| ApprovalsService | Governance: holds the PENDING approval case pending MLRO decision |
| MLRO / Admin | Reviews EDD; approves or rejects the final approval case |
| RiskEngineService | Evaluates policy rules at CDD and EDD decision points |
| SumsubIngestionService | Routes Sumsub webhooks to OnboardingService |

## Onboarding Status State Machine

Canonical statuses are defined in `customer-status.util.ts`. Legacy statuses in parentheses map to the canonical equivalent.

| Status | operatingStatus | Meaning | Customer Next Action |
|---|---|---|---|
| NONE | INACTIVE | Account created, verification not started | START_VERIFICATION |
| PENDING_VERIFICATION | INACTIVE | Sumsub session active or result pending | CONTINUE_VERIFICATION or WAIT_VERIFICATION |
| FINAL_APPROVAL | INACTIVE | EDD path: waiting MLRO/Admin final decision | WAIT_FINAL_APPROVAL |
| APPROVED | ACTIVE | Onboarding complete, trading enabled | NONE |
| REJECTED | INACTIVE | Permanently rejected (or workflow failed) | REINITIATE_VERIFICATION |
| WITHDRAWN | INACTIVE | Customer withdrew; can reinitiate | REINITIATE_VERIFICATION |

### verificationSubstatus values (set while onboardingStatus = PENDING_VERIFICATION)

| Substatus | Trigger | Customer action required |
|---|---|---|
| SUBMITTED | `applicantPending` event | No |
| UNDER_REVIEW | `applicantOnHold` or non-RETRY `applicantReviewed` | No |
| NEXT_LEVEL_REQUIRED | `applicantLevelChanged` (EDD escalation) | No (verificationCanContinue=true) |
| RESUBMIT_REQUIRED | `applicantReviewed` RED + RETRY | Yes (verificationCanContinue=true) |
| COMPLETED | `applicantWorkflowCompleted` | No |
| FAILED | `applicantWorkflowFailed` | No |
| PROCESSING | Any unhandled event type | No |

### Legacy status mapping (backward compat)

| Legacy Status | Canonical Status |
|---|---|
| PENDING_CDD_INPUT | PENDING_VERIFICATION |
| CDD_UNDER_REVIEW | PENDING_VERIFICATION |
| PENDING_EDD_INPUT | PENDING_VERIFICATION |
| EDD_UNDER_REVIEW | PENDING_VERIFICATION |

## CDD Path vs EDD Path

### CDD Path (Level 1 — Low Risk)

1. Customer starts verification → Sumsub Level 1 session created.
2. Customer completes mobile KYC form.
3. Sumsub sends `applicantPending` → substatus SUBMITTED.
4. Sumsub sends `applicantOnHold` → substatus UNDER_REVIEW (optional, Sumsub's manual queue).
5. Sumsub sends `applicantWorkflowCompleted` with GREEN → `experiencedLevel2 = false` → onboardingStatus set to **APPROVED**, operatingStatus ACTIVE, riskTier LOW.

### EDD Path (Level 2 — High Risk / Triggered by Sumsub)

EDD is triggered when Sumsub sends `applicantLevelChanged` with `levelName` containing "level2" or "level-2". This sets `sumsubExperiencedLevel2 = true` on the customer record.

1. `applicantLevelChanged` received → substatus NEXT_LEVEL_REQUIRED, `verificationCanContinue = true`.
2. Customer continues verification in Sumsub Level 2 flow.
3. Sumsub sends `applicantWorkflowCompleted` → because `experiencedLevel2 = true`:
   - onboardingStatus set to **FINAL_APPROVAL** (not APPROVED directly).
   - An `ApprovalCase` with `actionType = ONBOARDING_FINAL_APPROVAL` is created in PENDING state via `OnboardingFinalApprovalService.ensurePendingApprovalInTransaction`.
   - riskTier set to HIGH on final approval.
4. MLRO/Admin reviews and calls `POST /admin/onboarding/customers/:id/final-review` to APPROVE or REJECT.
5. Approval decision event (`ApprovalEvents.APPROVED` / `REJECTED`) triggers `syncApprovalProjectionByEvent`:
   - APPROVED → onboardingStatus=APPROVED, operatingStatus=ACTIVE, riskTier=HIGH, initial material holdings seeded.
   - REJECTED → onboardingStatus=REJECTED, operatingStatus=INACTIVE.

### EDD Trigger Summary

| Trigger | Who / What fires it |
|---|---|
| `applicantLevelChanged` webhook with level2 levelName | Sumsub (real) or admin simulation `EDD_ESCALATE` |
| Manual MLRO override (legacy) | Legacy EDD response bootstrap endpoints |

## FINAL_APPROVAL: Who Approves

The approval case is created with `actionType = ONBOARDING_FINAL_APPROVAL`. Decision is made by an **ADMIN actor** (MLRO or SMO role) via:
- `OnboardingFinalApprovalService.proxyFinalDecision` (called from `OnboardingFinalApprovalService.submitFinalApproval`)
- Or via the generic approvals endpoint if the approval case is visible in the admin approval queue.

There is no mandatory dual-approval requirement in the current service code. The `ApprovalsService.approve` / `.reject` methods are called with a single actor context. Role enforcement is up to the admin authentication layer.

Approval decision is projected back to the customer record by listening to `ApprovalEvents.APPROVED` / `REJECTED` / `CANCELLED` / `EXPIRED` via `@OnEvent` decorators in `OnboardingFinalApprovalService`.

## Trading Gate

Trading (deposit, swap, withdraw) requires:
- `onboardingStatus = APPROVED`
- `operatingStatus = ACTIVE`
- `restrictionStatus = CLEAR` (not RESTRICTED)
- `complianceHoldStatus = CLEAR` (no AML freeze)

Customers in PENDING_VERIFICATION, FINAL_APPROVAL, REJECTED, WITHDRAWN, or any INACTIVE/RESTRICTED state cannot trade.

## Resubmit / Reinitiate Rules

| Current State | Can Reinitiate |
|---|---|
| REJECTED or WITHDRAWN | Yes — `canReinitiateCdd = true` |
| CDD document expired (`cddDocumentExpiresAt` in the past) | Yes — treated same as REJECTED |
| APPROVED, FINAL_APPROVAL, PENDING_VERIFICATION | No |

## Flow

### Happy Path — CDD (Low Risk)

1. Customer registers. `onboardingStatus = NONE`.
2. `POST /onboarding/verification/start` → Sumsub applicant + Level 1 SDK token created. `onboardingStatus → PENDING_VERIFICATION`, substatus=null.
3. Customer completes mobile KYC form in Sumsub SDK.
4. Sumsub fires `applicantPending` → substatus=SUBMITTED, `verificationCustomerActionRequired=false`.
5. Sumsub fires `applicantWorkflowCompleted` (GREEN, no level2 experience) → `onboardingStatus=APPROVED`, `operatingStatus=ACTIVE`, `riskTier=LOW`. Trading enabled.

### Happy Path — EDD (High Risk)

1–4. Same as CDD path above.
5. Sumsub fires `applicantLevelChanged` (level2) → `sumsubExperiencedLevel2=true`, substatus=NEXT_LEVEL_REQUIRED.
6. Customer completes Level 2 flow in Sumsub SDK.
7. Sumsub fires `applicantWorkflowCompleted` (GREEN) → `onboardingStatus=FINAL_APPROVAL`, `ApprovalCase` created PENDING.
8. MLRO/Admin submits final approval: `POST /admin/onboarding/customers/:id/submit-final-approval`.
9. MLRO/Admin approves: `POST /admin/onboarding/customers/:id/final-review` with `decision=APPROVE`.
10. `ApprovalEvents.APPROVED` event triggers projection → `onboardingStatus=APPROVED`, `operatingStatus=ACTIVE`, `riskTier=HIGH`. Trading enabled.

### Resubmit Path

At step 5 or 7: if Sumsub fires `applicantReviewed` RED + RETRY → substatus=RESUBMIT_REQUIRED, `verificationCustomerActionRequired=true`, `verificationCanContinue=true`. Customer re-enters the SDK flow.

### Workflow Failure Path

If Sumsub fires `applicantWorkflowFailed` → `onboardingStatus=REJECTED`, substatus=FAILED. Customer can reinitiate via legacy `POST /onboarding/cdd-responses/reinitiate`.

## Key Rules

- The canonical `onboardingStatus` field has only 6 values: NONE, PENDING_VERIFICATION, FINAL_APPROVAL, APPROVED, REJECTED, WITHDRAWN. Legacy 4-value substatus names are mapped to PENDING_VERIFICATION.
- EDD path is triggered exclusively by the presence of `sumsubExperiencedLevel2=true` on the customer record at the time `applicantWorkflowCompleted` arrives. It is NOT based on `eddRequired` flag at this step.
- `applicantWorkflowCompleted` + `experiencedLevel2=false` → directly APPROVED (CDD path; no final approval case).
- `applicantWorkflowCompleted` + `experiencedLevel2=true` → FINAL_APPROVAL (EDD path; approval case required).
- Final approval is an `ApprovalCase` with `actionType=ONBOARDING_FINAL_APPROVAL`; the customer's `latestRiskApprovalId` links to it.
- `riskTier` is set at final approval projection: level2 → HIGH, else LOW.
- Initial material holdings are seeded in `materialRefreshService.seedInitialHoldings` after APPROVED projection (EDD path only).
- Sumsub events for customers already in terminal states (APPROVED, FINAL_APPROVAL, REJECTED, WITHDRAWN) are silently ignored by `handleSumsubVerificationEvent`.
- All state changes are wrapped in a DB transaction (`prisma.$transaction`). Audit log is written outside the transaction.
- Mock-mode only: `POST /onboarding/verification/mock-submit` simulates the customer completing the form when Sumsub credentials are not configured.

## API Endpoints

### Customer-facing (`/onboarding`)

| Method | Path | Description |
|---|---|---|
| GET | /onboarding/me | Get my onboarding status and active responses |
| GET | /onboarding/next-step | Get single-path onboarding next action |
| GET | /onboarding/responses | [Legacy] List my CDD/EDD responses |
| POST | /onboarding/verification/start | Start or continue provider-backed verification (creates Sumsub applicant + SDK token) |
| POST | /onboarding/verification/mock-submit | [Mock-mode only] Simulate customer form completion → fires applicantPending |
| POST | /onboarding/entity | Save entity profile (individual / corporate / UBO) |
| POST | /onboarding/cdd-responses/bootstrap | [Legacy] Bootstrap CDD responses and auto-create QR session |
| POST | /onboarding/cdd-responses/reinitiate | [Legacy] Re-initiate CDD after rejection/expiry |
| POST | /onboarding/edd-responses/start | [Legacy] Start EDD response and auto-create QR session |
| POST | /onboarding/edd-responses/reinitiate | [Legacy] Re-initiate EDD after EDD rejection |
| POST | /onboarding/responses/:id/sessions | [Legacy] Create compliance response session, returns QR payload |
| POST | /onboarding/response-sessions/:sessionId/mock-complete | [Legacy] Mock-complete a compliance response session |

### Admin-facing (`/admin/compliance` and `/admin/onboarding`)

| Method | Path | Description |
|---|---|---|
| GET | /admin/compliance/cdd-responses | List CDD responses for compliance review |
| GET | /admin/compliance/cdd-responses/:id | Get CDD response detail with customer snapshot |
| GET | /admin/compliance/edd-responses | List EDD responses for MLRO review |
| GET | /admin/compliance/edd-responses/:id | Get EDD response detail |
| GET | /admin/compliance/decision-records | List onboarding risk decision records |
| GET | /admin/compliance/decision-records/:id | Get risk decision record detail |
| POST | /admin/compliance/customers/:id/simulate-expired | Simulate CDD document expiry |
| PATCH | /admin/compliance/customers/:id/investor-classification | Override investor classification |
| POST | /admin/onboarding/customers/:id/submit-final-approval | Submit FINAL_APPROVAL case to approval queue |
| POST | /admin/onboarding/customers/:id/final-review | MLRO/Admin approves or rejects final approval (decision: APPROVE/REJECT) |
