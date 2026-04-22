# Periodic Review Workflow

Wave: 3 | Source verified: periodic-review.service.ts, periodic-review-workflow-transition.service.ts, periodic-review-sweep.service.ts, periodic-review-admin.controller.ts, periodic-review-customer.controller.ts, config/client-risk-assessment-policy.json
Last Updated: 2026-04-21

## Purpose

Ensures that all APPROVED + ACTIVE customers undergo a recurring compliance review (CDD, and optionally EDD) at the configured interval; the sweep runs every 60 seconds and the review cycle progresses through customer-submitted evidence stages before a compliance admin decides to clear, reject, or escalate to EDD.

## Review Cycle Length

The CRA policy (`config/client-risk-assessment-policy.json`) sets `assessmentFrequencyDays` uniformly at **90 days** for all risk tiers (LOW, MEDIUM, HIGH). After a cycle is CLEARED, `CustomerMain.nextReviewAt` is set to `now + 365 days` (hardcoded in `periodic-review-workflow-transition.service.ts`). The sweep fires when `nextReviewAt <= now`.

> Note: The 90-day CRA frequency governs when a fresh CRA is triggered; the 365-day value is when the next *periodic review cycle* is scheduled after a cleared review.

## Actors

| Actor | Role |
|---|---|
| System (sweep, every 60s) | Detects customers with `nextReviewAt <= now` and opens a new cycle |
| Admin | Triggers review manually; decides CDD outcome (CLEAR / REJECT / REQUIRE_EDD) and EDD outcome (CLEAR / REJECT) |
| Customer | Submits CDD response and, if required, EDD response via compliance session |
| Risk Engine | Holds the pending decision record until an admin supplies a manual verdict |

## State Machine

### PeriodicReviewCycle.status

| Status | Description | Trigger | Next |
|---|---|---|---|
| PENDING_CDD_INPUT | Cycle open; CDD response created; awaiting customer session | Cycle created by sweep or admin | Customer submits mock session → CDD_UNDER_REVIEW |
| CDD_UNDER_REVIEW | Customer CDD submitted; pending admin risk decision | Customer `mock-complete` → decision record created | Admin CLEAR → CLEARED; Admin REJECT → REJECTED; Admin REQUIRE_EDD → PENDING_EDD_INPUT |
| PENDING_EDD_INPUT | EDD escalated; EDD response created; awaiting customer session | Admin REQUIRE_EDD decision | Customer submits mock EDD session → EDD_UNDER_REVIEW |
| EDD_UNDER_REVIEW | Customer EDD submitted; pending admin risk decision | Customer `mock-complete` on EDD | Admin CLEAR → CLEARED; Admin REJECT → REJECTED |
| CLEARED | Review passed; `nextReviewAt` set to now + 365d; cycle unlinked from customer | Admin CLEAR decision at CDD or EDD stage | Terminal |
| REJECTED | Customer failed review; `nextReviewAt` cleared | Admin REJECT decision at CDD or EDD stage | Terminal |

## Flow

1. `PeriodicReviewSweepService` runs every 60 seconds (default; override via `PERIODIC_REVIEW_SWEEP_MS`). It calls `sweepDueCustomers()` which queries customers where `onboardingStatus=APPROVED`, `operatingStatus=ACTIVE`, `activePeriodicReviewCycleId IS NULL`, and `nextReviewAt <= now` (batch of 100).
2. For each due customer, `createPeriodicReviewCycle()` is called. If the customer is already RESTRICTED or FROZEN, the sweep logs `periodicReviewOverdueAt` and skips cycle creation (returns `blocked=true`).
3. A `PeriodicReviewCycle` is created (`status=PENDING_CDD_INPUT`) in a DB transaction alongside an initial `CddResponse` (`status=CREATED`). The customer's `activePeriodicReviewCycleId` is linked.
4. Customer calls `GET /periodic-review/next-step` to learn the required action (`START_CDD`), then `POST /periodic-review/cdd-responses/start` to obtain a compliance session.
5. Customer calls `POST /periodic-review/response-sessions/:sessionId/mock-complete` (with optional `result` and `mockDataType`). The session is marked `COMPLETED`; a `WorkflowDecisionRecord` is created with `status=CREATED` (pending manual simulation); cycle moves to `CDD_UNDER_REVIEW`.
6. Admin submits a manual CDD decision via the risk engine's `completeManualCddDecision()`:
   - CLEAR → cycle `status=CLEARED`; customer `nextReviewAt = now + 365d`; `activePeriodicReviewCycleId` disconnected.
   - REJECT → cycle `status=REJECTED`; customer `nextReviewAt = null`.
   - REQUIRE_EDD → `EddResponse` created; cycle `status=PENDING_EDD_INPUT`.
7. If EDD required: customer repeats steps 4–5 for EDD (`START_EDD`, `mock-complete` on EDD session).
8. Admin submits manual EDD decision (`completeManualEddDecision()`):
   - CLEAR → cycle `CLEARED`; customer `nextReviewAt = now + 365d`.
   - REJECT → cycle `REJECTED`.
9. If the customer has an active restriction matching the cycle's `primaryIncidentId`, CLEAR also sets `restrictionStatus=CLEAR` and records `restrictionReleasedAt`.

## Key Rules

- The sweep only opens a cycle for APPROVED + ACTIVE customers with no existing active cycle — fully idempotent.
- Customers who are RESTRICTED or FROZEN at sweep time are logged as overdue but not blocked; the review starts once the hold clears.
- `nextReviewAt` after a CLEAR is always `now + 365 days`, regardless of risk tier (hardcoded value in `periodic-review-workflow-transition.service.ts`).
- EDD is only available via an explicit REQUIRE_EDD decision at CDD stage — it cannot be submitted independently.
- Both CDD and EDD review decisions go through a `WorkflowDecisionRecord` (pending simulation pattern) — the admin selects `riskLevel` and `reasonCode` via the manual decision API.
- Disposition codes that do not trigger a state transition (e.g., `ESCALATE_TO_CASE`, `FALSE_POSITIVE`, `RISK_CONFIRMED`) return `executed=false` and leave the cycle unchanged.
- Audit events are written for every status change (`PERIODIC_REVIEW_CYCLE_CREATED`, `PERIODIC_REVIEW_CDD_SUBMITTED`, `PERIODIC_REVIEW_EDD_SUBMITTED`, `PERIODIC_REVIEW_WORKFLOW_CLEAR/REJECT/REQUIRE_EDD`).
- Admin can also manually trigger a review outside the sweep via `POST /admin/compliance/customers/:id/periodic-review/trigger`.

## API Endpoints

### Customer-facing (`/periodic-review`)

| Method | Path | Description |
|---|---|---|
| GET | `/periodic-review/me` | Get my periodic review status, active cycle, and next step |
| GET | `/periodic-review/next-step` | Get just the next action required |
| GET | `/periodic-review/responses` | List my CDD/EDD responses with latest session status |
| POST | `/periodic-review/cdd-responses/start` | Create a CDD session for the active cycle |
| POST | `/periodic-review/edd-responses/start` | Create an EDD session (only when cycle is PENDING_EDD_INPUT) |
| POST | `/periodic-review/responses/:id/sessions` | Create a compliance session for a specific response |
| POST | `/periodic-review/response-sessions/:sessionId/mock-complete` | Simulate provider callback; advances cycle status |

### Admin-facing (`/admin/compliance`)

| Method | Path | Description |
|---|---|---|
| POST | `/admin/compliance/customers/:id/periodic-review/trigger` | Manually trigger a periodic review cycle for an APPROVED + ACTIVE customer |
