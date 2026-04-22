# Customer

Wave: 3 | Source verified: `prisma/schema.prisma`, `src/modules/identity/customer-status.util.ts`, `src/modules/identity/customers/customers.service.ts`, `src/modules/identity/customers/customers.controller.ts`, `src/modules/identity/onboarding/onboarding.service.ts`, `src/modules/identity/onboarding/onboarding-workflow-transition.service.ts`, `src/modules/identity/onboarding/onboarding-final-approval.service.ts`, `src/modules/identity/onboarding/onboarding-admin.controller.ts`, `src/modules/identity/onboarding/onboarding-customer.controller.ts`
Last Updated: 2026-04-21

---

## Prisma Model: CustomerMain

Table: `customer_main`
Business Key: `customerNo`

### Fields

| Field | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| id | String (UUID) | No | uuid() | Internal PK |
| customerNo | String | No | "TEMP" → generated | Unique business key (e.g. CUST-00001) |
| email | String | Yes | — | Unique |
| phone | String | Yes | — | Unique |
| emailVerifiedAt | DateTime | Yes | — | |
| phoneVerifiedAt | DateTime | Yes | — | |
| firstName | String | Yes | — | |
| lastName | String | Yes | — | |
| companyName | String | Yes | — | Corporate customers only |
| passwordHash | String | Yes | — | |
| passwordUpdatedAt | DateTime | Yes | — | |
| riskScore | Int | Yes | — | Numeric risk score from CDD |
| riskLevel | String | Yes | — | Legacy risk label from CDD provider |
| riskUpdatedAt | DateTime | Yes | — | |
| failedLoginCount | Int | No | 0 | |
| lockedUntil | DateTime | Yes | — | Account lockout expiry |
| lastLoginAt | DateTime | Yes | — | |
| lastLoginIp | String | Yes | — | |
| locale | String | Yes | — | |
| timezone | String | Yes | — | |
| termsAcceptedAt | DateTime | Yes | — | |
| customerType | String | No | "UNKNOWN" | INDIVIDUAL or CORPORATE (CORPORATE legacy-disabled in current onboarding) |
| onboardingStatus | String | No | "NONE" | See Onboarding Status Machine below |
| verificationProvider | String | Yes | — | e.g. "SUMSUB" |
| verificationSubstatus | String | Yes | — | Sumsub substatus |
| verificationCustomerActionRequired | Boolean | No | false | Customer must take action in Sumsub |
| verificationCanContinue | Boolean | No | false | Customer may continue Sumsub flow |
| verificationLatestEventType | String | Yes | — | Last Sumsub webhook event type |
| verificationLatestEventAt | DateTime | Yes | — | |
| sumsubApplicantId | String | Yes | — | Unique; Sumsub applicant reference |
| sumsubCurrentLevelName | String | Yes | — | Active Sumsub verification level |
| sumsubLatestReviewId | String | Yes | — | |
| sumsubLatestAttemptId | String | Yes | — | |
| sumsubExperiencedLevel2 | Boolean | No | false | Customer has completed level-2 in Sumsub |
| onboardingTraceId | String | Yes | — | Trace UUID for onboarding audit |
| operatingStatus | String | No | "INACTIVE" | INACTIVE or ACTIVE |
| restrictionStatus | String | No | "CLEAR" | CLEAR or RESTRICTED |
| restrictionCaseId | String | Yes | — | Compliance case that triggered restriction |
| restrictionReason | String | Yes | — | |
| restrictionSetAt | DateTime | Yes | — | |
| restrictionReleasedAt | DateTime | Yes | — | |
| amlRiskTier | String | No | "LOW" | LOW / MEDIUM / HIGH; synced from riskTier on approval |
| eddRequired | Boolean | No | false | Customer has EDD obligation |
| complianceHoldStatus | String | No | "ACTIVE" | ACTIVE or FROZEN |
| complianceHoldCaseId | String | Yes | — | |
| complianceHoldReason | String | Yes | — | |
| complianceHoldSetAt | DateTime | Yes | — | |
| complianceHoldReleasedAt | DateTime | Yes | — | |
| cddDocumentExpiresAt | DateTime | Yes | — | Set to now+365d on CDD-CLEAR or CDD-REQUIRE_EDD; triggers re-verification when expired |
| latestRiskApprovalId | String | Yes | — | Unique; FK → ApprovalCase (final approval) |
| latestRiskApprovalStatus | String | Yes | — | Denormalised status mirror of latestRiskApproval |
| riskTier | String | No | "LOW" | Wave 3: LOW / HIGH; set on final approval based on Sumsub level |
| riskTierUpdatedAt | DateTime | Yes | — | |
| pepStatus | String | No | "NONE" | NONE / HIT / CONFIRMED |
| pepConfirmedAt | DateTime | Yes | — | |
| latestRiskAssessmentId | String | Yes | — | FK → ClientRiskAssessment |
| nextReviewAt | DateTime | Yes | — | Scheduled next periodic review date |
| activePeriodicReviewCycleId | String | Yes | — | Unique; FK → PeriodicReviewCycle |
| periodicReviewOverdueAt | DateTime | Yes | — | |
| periodicReviewOverdueReason | String | Yes | — | |
| latestDecisionRecordId | String | Yes | — | FK → WorkflowDecisionRecord |
| investorClassification | String | No | "RETAIL" | RETAIL / QUALIFIED / INSTITUTIONAL |
| investorClassificationSource | String | No | "CDD" | CDD or ADMIN_OVERRIDE |
| investorClassificationUpdatedAt | DateTime | Yes | — | |
| createdAt | DateTime | No | now() | |
| updatedAt | DateTime | No | @updatedAt | |

---

## Onboarding Status Machine

`onboardingStatus` is the primary lifecycle field. Canonical values (stored in DB):

| Status | Meaning | Next States |
|---|---|---|
| NONE | Account created, verification not started | PENDING_VERIFICATION |
| PENDING_VERIFICATION | Sumsub verification in progress (applicant submitted or on-hold) | FINAL_APPROVAL, REJECTED, WITHDRAWN, NONE (re-initiate) |
| FINAL_APPROVAL | EDD passed; awaiting senior approval via ApprovalCase | APPROVED, REJECTED |
| APPROVED | Onboarding complete; customer is active | — (terminal unless CDD expires → re-initiate) |
| REJECTED | Onboarding rejected at CDD or EDD or final-approval stage | PENDING_VERIFICATION (re-initiate) |
| WITHDRAWN | Customer or admin withdrew onboarding | PENDING_VERIFICATION (re-initiate) |

**Legacy raw statuses** (pre-Wave 2) that remain in the codebase but are normalised to canonical:

| Legacy Raw | Normalises To |
|---|---|
| PENDING_CDD_INPUT | PENDING_VERIFICATION |
| CDD_UNDER_REVIEW | PENDING_VERIFICATION |
| PENDING_EDD_INPUT | PENDING_VERIFICATION |
| EDD_UNDER_REVIEW | PENDING_VERIFICATION |

**Transition engine** (`OnboardingWorkflowTransitionService.execute`):

| Stage | Disposition | Transition Code | From → To |
|---|---|---|---|
| REVIEW_CDD | CLEAR | CDD_APPROVE_TO_ACTIVE | PENDING_VERIFICATION → APPROVED + operatingStatus ACTIVE |
| REVIEW_CDD | REJECT | CDD_REJECT_TO_REJECTED | PENDING_VERIFICATION → REJECTED |
| REVIEW_CDD | REQUIRE_EDD | CDD_REQUIRE_EDD_TO_PENDING_EDD | PENDING_VERIFICATION → PENDING_EDD_INPUT (canonical: PENDING_VERIFICATION) |
| REVIEW_EDD | CLEAR | EDD_APPROVE_TO_FINAL_APPROVAL | PENDING_VERIFICATION → FINAL_APPROVAL + creates ApprovalCase |
| REVIEW_EDD | REJECT | EDD_REJECT_TO_REJECTED | PENDING_VERIFICATION → REJECTED |

**Final approval projection** (`OnboardingFinalApprovalService`, listens on `ApprovalEvents`):

| Approval Event | Customer Outcome |
|---|---|
| APPROVED | onboardingStatus → APPROVED, operatingStatus → ACTIVE; riskTier + amlRiskTier set from Sumsub level |
| REJECTED | onboardingStatus → REJECTED, operatingStatus → INACTIVE |
| CANCELLED / EXPIRED | latestRiskApprovalStatus updated; no lifecycle change |

---

## Risk / Tier Fields

| Field | Values | Set When |
|---|---|---|
| riskTier | LOW / HIGH | On final-approval APPROVED event; LOW if Sumsub level 1, HIGH if level 2 |
| amlRiskTier | LOW / MEDIUM / HIGH | Synced with riskTier on approval; may be overridden by compliance |
| riskScore | Integer (nullable) | Populated from CDD provider response |
| riskLevel | String (nullable) | Legacy label from CDD provider (e.g. "LOW", "HIGH") |
| pepStatus | NONE / HIT / CONFIRMED | Set by compliance workflows |
| investorClassification | RETAIL / QUALIFIED / INSTITUTIONAL | Default RETAIL; admin can override to QUALIFIED or INSTITUTIONAL |
| investorClassificationSource | CDD / ADMIN_OVERRIDE | Tracks whether classification came from CDD or admin action |
| eddRequired | Boolean | Set true when REQUIRE_EDD decision is made; retained through FINAL_APPROVAL |

---

## Trading Eligibility Gate

Trading (`DEPOSIT`, `SWAP`, `WITHDRAW`) is blocked unless ALL of the following are true (enforced by `assertTradingEligibility` in `OnboardingService`):

1. `onboardingStatus === 'APPROVED'`
2. `operatingStatus === 'ACTIVE'`
3. `restrictionStatus !== 'RESTRICTED'`
4. `complianceHoldStatus !== 'FROZEN'`

If CDD document has expired (`cddDocumentExpiresAt` is in the past), `autoExpireIfNeeded` runs first and may transition `operatingStatus` to `INACTIVE`, which then blocks trading.

There is **no** dedicated `tradingEligible` boolean field in the schema; eligibility is computed at call-time from the four fields above.

---

## Key Business Rules

- `customerNo` is the stable operator key; queries must use `customerNo` as primary search contract, not `id`.
- Only one active `PeriodicReviewCycle` per customer (`activePeriodicReviewCycleId` unique).
- Only one `latestRiskApproval` (ApprovalCase) per customer at a time (`latestRiskApprovalId` unique).
- `cddDocumentExpiresAt` is set to `now + 365 days` whenever CDD is cleared (APPROVE or REQUIRE_EDD dispositions). When it expires, `canReinitiateCdd()` returns true and the customer is sent back to re-verification.
- CORPORATE onboarding is legacy-disabled; current onboarding only supports INDIVIDUAL (`customerType`).
- `sumsubExperiencedLevel2` tracks whether the customer has completed level-2 Sumsub verification; used to determine default `riskTier` (HIGH) on approval.
- Multi-table state changes (status transitions, CddResponse finalisation, ApprovalCase creation) are always executed inside a DB transaction.
- Every status transition writes an audit log via `AuditLogsService` with `traceId`, `workflowType`, and `action`; the `traceId` is derived from `buildComplianceWorkflowTraceContext`.
- Restriction (`restrictionStatus = RESTRICTED`) blocks trading but does not change `onboardingStatus`.
- Compliance freeze (`complianceHoldStatus = FROZEN`) blocks trading independently of restriction or onboarding status.

---

## Service Methods

### `CustomersService`

- `create(data)` — Creates a new customer record; writes `CUSTOMER_CREATED` audit log.
- `findAll(params)` — Paginated list with optional search/status/customerType filter; includes `latestRiskApproval` and `activePeriodicReviewCycle` summaries.
- `findOne(id)` — Full detail view including CDD/EDD responses (last 30), corporate profile, UBO profiles, risk approval, periodic review cycle, and `auditCenterSummary`.
- `update(params)` — Patch update; writes `CUSTOMER_UPDATED` audit log with before/after lifecycle fields.
- `remove(where)` — Hard delete; writes `CUSTOMER_DELETED` audit log.

### `OnboardingService`

- `assertTradingEligibility(customerId, action)` — Guards all trading actions; auto-expires CDD first; throws `ForbiddenException` if gate fails.
- `autoExpireIfNeeded(customerId)` — Checks `cddDocumentExpiresAt`; if expired and customer is APPROVED/ACTIVE, transitions operatingStatus to INACTIVE.
- `getMyOnboarding(customerId)` — Customer-facing status + active responses snapshot.
- `getNextStep(customerId)` — Returns `NextStepPayload` with action type, blockedReason, and Sumsub verification projection.
- `startVerification(customerId)` — Initiates or resumes Sumsub verification flow; transitions to PENDING_VERIFICATION.
- `mockSubmitVerification(customerId)` — Demo-mode only; simulates applicantPending Sumsub event.
- `updateInvestorClassification(id, actorId, actorRole, dto)` — Admin override of investor classification with audit reason.
- `simulateCustomerExpired(id, actorId, actorRole)` — Admin tool: simulates CDD expiry and recomputes compliance snapshot.
- `recomputeComplianceSnapshot(customerId)` — Recalculates canonical state and writes it back to DB.

### `OnboardingWorkflowTransitionService`

- `execute(tx, input)` — Main compliance workflow transition handler; processes CDD-REVIEW or EDD-REVIEW dispositions and applies customer lifecycle patches within a transaction.

### `OnboardingFinalApprovalService`

- `submitFinalApproval(customerId, actorId, actorRole, dto)` — Submits or resubmits an ApprovalCase for final approval while customer is in FINAL_APPROVAL state.
- `proxyFinalDecision(customerId, actorId, actorRole, dto)` — Admin shortcut to APPROVE or REJECT the pending ApprovalCase directly.
- `ensurePendingApprovalInTransaction(tx, input)` — Idempotent: finds or creates a PENDING ApprovalCase within a DB transaction.
- `onApprovalApproved / onApprovalRejected / onApprovalCancelled / onApprovalExpired` — Event listeners; project ApprovalCase decision onto `CustomerMain` lifecycle.

---

## API Endpoints

### Admin: Customers (`/customers`)

| Method | Path | Guard | Description |
|---|---|---|---|
| POST | /customers | JWT + Admin | Create a new customer |
| GET | /customers | JWT + Admin | List customers (pagination, search, status, customerType filters) |
| GET | /customers/:id | JWT + Admin | Get customer detail by UUID |
| PATCH | /customers/:id | JWT + Admin | Update customer fields |
| DELETE | /customers/:id | JWT + Admin | Delete customer |

### Admin: Onboarding Compliance (`/admin/compliance`)

| Method | Path | Guard | Description |
|---|---|---|---|
| GET | /admin/compliance/cdd-responses | JWT + Admin | List CDD responses (status, customerType, workflow, customerIds filters) |
| GET | /admin/compliance/cdd-responses/:id | JWT + Admin | CDD response detail with customer snapshot |
| GET | /admin/compliance/edd-responses | JWT + Admin | List EDD responses (status, workflow, customerIds filters) |
| GET | /admin/compliance/edd-responses/:id | JWT + Admin | EDD response detail with customer snapshot |
| GET | /admin/compliance/decision-records | JWT + Admin + Permission | List onboarding risk decision records |
| GET | /admin/compliance/decision-records/:id | JWT + Admin + Permission | Decision record detail |
| POST | /admin/compliance/customers/:id/simulate-expired | JWT + Admin | Simulate CDD expiry for testing |
| PATCH | /admin/compliance/customers/:id/investor-classification | JWT + Admin | Override investor classification |

### Customer: Onboarding (`/onboarding`)

| Method | Path | Guard | Description |
|---|---|---|---|
| GET | /onboarding/me | JWT + Customer | My onboarding status and active responses |
| GET | /onboarding/responses | JWT + Customer | [Legacy] List my CDD/EDD responses |
| GET | /onboarding/next-step | JWT + Customer | Single-path onboarding next action |
| POST | /onboarding/verification/start | JWT + Customer | Start or resume Sumsub verification |
| POST | /onboarding/verification/mock-submit | JWT + Customer | [Mock] Simulate completing KYC form |
| POST | /onboarding/entity | JWT + Customer | Save entity profile |
| POST | /onboarding/cdd-responses/bootstrap | JWT + Customer | [Legacy] Start CDD journey |
| POST | /onboarding/cdd-responses/reinitiate | JWT + Customer | [Legacy] Re-initiate CDD |
| POST | /onboarding/edd-responses/start | JWT + Customer | [Legacy] Start EDD response |
| POST | /onboarding/edd-responses/reinitiate | JWT + Customer | [Legacy] Re-initiate EDD |
| POST | /onboarding/responses/:id/sessions | JWT + Customer | [Legacy] Create compliance session (QR) |
| POST | /onboarding/response-sessions/:sessionId/mock-complete | JWT + Customer | [Legacy] Mock-complete compliance session |
