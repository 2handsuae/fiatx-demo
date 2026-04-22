# Material Refresh Workflow

Wave: 3 | Source verified: material-refresh.service.ts, material-freshness-cron.service.ts, admin-material-management.controller.ts, material-refresh-cycles.controller.ts, policy/compute-stage.ts, config/material-refresh-policy.json
Last Updated: 2026-04-21

## Purpose

Tracks the freshness of customer KYC materials (Emirates ID, Liveness, Proof of Address, Source of Funds, Source of Wealth) and escalates through three warning stages before enforcing a trading restriction when a document expires.

## Actors

| Actor | Role |
|---|---|
| System (daily cron 02:00 UTC) | Scans all holdings and fires stage transitions automatically |
| Sumsub | Provides the refresh action SDK for customer document re-submission and returns GREEN/RED review result |
| Customer | Submits updated document via Sumsub SDK inside the open cycle |
| Admin | Monitors cycles/holdings; can simulate stage transitions for demo |

## Material Types and Expiry Windows (from config/material-refresh-policy.json)

| Material | Managed by | LOW | MEDIUM | HIGH | Level Required |
|---|---|---|---|---|---|
| EMIRATES_ID | SUMSUB_MANAGED | from doc | from doc | from doc | Level 1 + 2 |
| LIVENESS | SELF_MANAGED | 730d | 365d | 180d | Level 1 + 2 |
| PROOF_OF_ADDRESS | SELF_MANAGED | 365d | 270d | 180d | Level 1 + 2 |
| SOURCE_OF_FUNDS | SELF_MANAGED | — | 540d | 365d | Level 2 only |
| SOURCE_OF_WEALTH | SELF_MANAGED | — | — | 730d | Level 2 only |

All five materials have `enforceRestriction: true` (applying RESTRICTED status on expiry).

## Stage Thresholds (from policy/compute-stage.ts)

| daysFromExpiry | Stage |
|---|---|
| > 30 | FRESH (no action) |
| 1 – 30 | NOTIFIED → triggers NUDGE_ONLY cycle |
| 1 – 7 | URGENT → escalates existing cycle |
| 0 (expired) | BLOCKING → enforces restriction |
| -30 (30 days past expiry) | GRACE_EXPIRED → terminates cycle, offboards |

## State Machine

### MaterialRefreshCycle.status

| Status | Description | Trigger | Next |
|---|---|---|---|
| PENDING_CUSTOMER_EVIDENCE | Cycle open, awaiting customer document upload | `enterNotifiedStage()` | Customer submits → PENDING_SUMSUB_REVIEW; grace expires → REJECTED |
| PENDING_SUMSUB_REVIEW | Customer submitted, waiting for Sumsub review result | Customer POSTs `/submit` | GREEN → CLEARED; RED → back to PENDING_CUSTOMER_EVIDENCE |
| CLEARED | Document accepted; holding refreshed | Sumsub GREEN callback | Terminal |
| REJECTED | Grace period expired with no valid submission | `terminateCycle()` or grace cron | Terminal — customer set WITHDRAWN/INACTIVE |

### MaterialRefreshCycle.stage

| Stage | Description | Trigger |
|---|---|---|
| NUDGE_ONLY | Soft reminder; 30 days before expiry | `daysFromExpiry` 1–30 (cron) |
| URGENT | Urgent banner; 7 days before expiry | `daysFromExpiry` 1–7 (cron) |
| BLOCKING | Document expired; RESTRICTED status applied | `daysFromExpiry` ≤ 0 (cron) |

### CustomerMaterialHolding.status

FRESH → NOTIFIED → URGENT → BLOCKING → EXPIRED (on restriction) / FRESH (on resolution)

## Flow

1. Daily cron (`MaterialFreshnessCronService`, `0 2 * * *`) scans up to 5,000 holdings with a non-null `expiresAt`.
2. For each holding, `computeStage(daysFromExpiry)` determines the target stage.
3. If target stage > current stage, the cron calls the appropriate service method:
   - `enterNotifiedStage()` — creates a `MaterialRefreshCycle` with `stage=NUDGE_ONLY`, `status=PENDING_CUSTOMER_EVIDENCE`, `graceExpiresAt = expiresAt + 30d`; creates a Sumsub applicant action; sets holding `status=REFRESH_IN_PROGRESS`.
   - `escalateToUrgent()` — updates cycle `stage=URGENT`.
   - `enterBlockingStage()` — updates cycle `stage=BLOCKING`; sets `CustomerMain.restrictionStatus=RESTRICTED`, `restrictionReason=material_expired:<type>`; sets holding `status=EXPIRED`.
4. Cron also scans for cycles where `graceExpiresAt < now` and `status=PENDING_CUSTOMER_EVIDENCE`, calling `terminateCycle()` which sets status=REJECTED and sets customer `onboardingStatus=WITHDRAWN`, `operatingStatus=INACTIVE`.
5. Customer opens Sumsub SDK via `POST /onboarding/refresh-cycles/:id/sdk-token`, completes document upload.
6. Customer confirms submission via `POST /onboarding/refresh-cycles/:id/submit` → cycle moves to `PENDING_SUMSUB_REVIEW`.
7. Sumsub callback fires `handleSumsubActionResult()`:
   - RED: cycle resets to `PENDING_CUSTOMER_EVIDENCE` for retry.
   - GREEN: holding `status=FRESH`, new `expiresAt` computed (from Sumsub doc date for SUMSUB_MANAGED, or policy windowDays for SELF_MANAGED); cycle `status=CLEARED`; if restriction was caused by this material, `restrictionStatus` cleared to `CLEAR`.
8. After all SCHEDULED_EXPIRY cycles resolve, a CRA is triggered (`clientRiskAssessmentService.startAssessment`).

## Key Rules

- A holding cannot start a new cycle if `activeRefreshCycleId` is already set (idempotent creation).
- `graceExpiresAt` is set to `holding.expiresAt + 30 days` at cycle creation; the cron uses this as the hard deadline.
- Sumsub `handleSumsubDocMonitoringFire` can also trigger `enterBlockingStage()` immediately when Sumsub reports an expired doc (bypasses the daily cron).
- Only materials with `enforceRestriction: true` apply `RESTRICTED` status — all five configured materials currently have this flag set.
- `terminateCycle()` only acts on cycles in `PENDING_CUSTOMER_EVIDENCE` or `PENDING_SUMSUB_REVIEW`.
- `recomputeHoldingsForCustomer()` recalculates SELF_MANAGED expiry windows when a customer's risk tier changes, and provisions MISSING holdings for newly required materials.
- `seedInitialHoldings()` is called at onboarding completion; new holdings start `status=FRESH` with randomized expiry between 30% and 90% of the policy window (demo variation).

## API Endpoints

### Customer-facing (`/onboarding/refresh-cycles`)

| Method | Path | Description |
|---|---|---|
| GET | `/onboarding/refresh-cycles/:cycleId` | Get cycle detail (status, stage, Sumsub action info) |
| POST | `/onboarding/refresh-cycles/:cycleId/submit` | Mark cycle as submitted (PENDING_CUSTOMER_EVIDENCE → PENDING_SUMSUB_REVIEW) |
| POST | `/onboarding/refresh-cycles/:cycleId/sdk-token` | Get Sumsub SDK token for document upload |

### Admin-facing (`/admin/material-management`)

| Method | Path | Description |
|---|---|---|
| GET | `/admin/material-management/cycles` | List all refresh cycles (filterable by customerId, status, materialType, stage) |
| GET | `/admin/material-management/cycles/:id` | Get single cycle detail with customer and holding info |
| GET | `/admin/material-management/holdings` | List all material holdings (filterable) |
| GET | `/admin/material-management/holdings/:id` | Get holding detail with full cycle history |
| POST | `/admin/material-management/holdings/:id/simulate-stage` | Simulate stage transition (T_MINUS_30, T_MINUS_7, T_0, T_PLUS_30, GREEN, RED) |
| POST | `/admin/material-management/customers/:customerId/simulate-tier-change` | Directly change customer risk tier and recompute holdings |
