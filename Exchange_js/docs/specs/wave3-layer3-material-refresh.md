# Wave 3 -- Layer 3: Material Refresh (CDD Record Keeping)

> Living spec -- tracks current code state, not aspirational design.
> Last synced: 2026-04-11

---

## Overview

Layer 3 keeps CDD records up-to-date per VARA III.E.5. Each customer holds a set of material documents; each material has a validity window that depends on the customer's risk tier.

Key design decisions:
- Materials are tied to **Sumsub LEVEL** (not tier) -- `requiredForLevels` in policy determines which materials a customer needs.
- Window durations vary by **risk tier** -- HIGH customers have shorter windows.
- `normalizeLevelName()` handles the mismatch between customer-stored level names (`"level2"`) and policy keys (`"wave3-level-2"`).

Service: `MaterialRefreshService` (`src/modules/identity/material-refresh/material-refresh.service.ts`)

---

## Material Types

Source: `config/material-refresh-policy.json` (version `1.1.0`, effective `2026-04-10`)

| Material Type       | Management Mode  | Required For Levels              | Window (LOW) | Window (MEDIUM) | Window (HIGH) | Enforce Restriction |
|---------------------|------------------|----------------------------------|--------------|-----------------|---------------|---------------------|
| `EMIRATES_ID`       | `SUMSUB_MANAGED` | `wave3-level-1`, `wave3-level-2` | -- (doc expiry) | -- (doc expiry) | -- (doc expiry) | `true` |
| `LIVENESS`          | `SELF_MANAGED`   | `wave3-level-1`, `wave3-level-2` | 730 days     | 365 days        | 180 days      | `true` |
| `PROOF_OF_ADDRESS`  | `SELF_MANAGED`   | `wave3-level-1`, `wave3-level-2` | 365 days     | 270 days        | 180 days      | `true` |
| `SOURCE_OF_FUNDS`   | `SELF_MANAGED`   | `wave3-level-2`                  | --           | 540 days        | 365 days      | `true` |
| `SOURCE_OF_WEALTH`  | `SELF_MANAGED`   | `wave3-level-2`                  | --           | --              | 730 days      | `true` |

Notes:
- `SUMSUB_MANAGED`: expiry comes from Sumsub `idDoc.validUntil`; no policy `windowDays`.
- `SELF_MANAGED`: expiry calculated from policy `windowDays` based on customer risk tier.
- `EMIRATES_ID` uses Sumsub action level `wave3-action-id-refresh`.
- All materials have `enforceRestriction: true` -- expiry triggers `RESTRICTED` status.

### Level -> Required Materials

| Level             | Materials                                                              |
|-------------------|------------------------------------------------------------------------|
| `wave3-level-1`   | `EMIRATES_ID`, `LIVENESS`, `PROOF_OF_ADDRESS`                          |
| `wave3-level-2`   | `EMIRATES_ID`, `LIVENESS`, `PROOF_OF_ADDRESS`, `SOURCE_OF_FUNDS`, `SOURCE_OF_WEALTH` |

Determined by `getRequiredMaterialsForLevel()` which filters `policy.materials` by `requiredForLevels`. Materials with `alternativeOf` are skipped.

---

## Holding Status Machine

```
MISSING ---------> REFRESH_IN_PROGRESS ---------> FRESH
  (seedInitialHoldings                              |
   or recomputeHoldingsForCustomer)                 |
                                                    v
                                             (window expires)
                                                    |
                                                    v
                                            REFRESH_IN_PROGRESS --> FRESH (renewed)
                                                    |
                                                    v
                                               EXPIRED (blocking stage)
```

| Transition                        | Trigger                                                      |
|-----------------------------------|--------------------------------------------------------------|
| `MISSING` -> `REFRESH_IN_PROGRESS` | `recomputeHoldingsForCustomer` creates holding + cycle       |
| `(new)` -> `FRESH`                 | `seedInitialHoldings` on onboarding (no cycle needed)        |
| `FRESH` -> `REFRESH_IN_PROGRESS`   | `enterNotifiedStage` (T-30 from expiry)                      |
| `REFRESH_IN_PROGRESS` -> `FRESH`   | `handleSumsubActionResult` with GREEN                        |
| `REFRESH_IN_PROGRESS` -> `EXPIRED` | `enterBlockingStage` (T-0, material expired)                 |

---

## Cycle Status Machine

```
PENDING_CUSTOMER_EVIDENCE
    |
    +-- customer submits --> PENDING_SUMSUB_REVIEW
    |                           |
    |                           +-- GREEN --> CLEARED
    |                           +-- RED   --> PENDING_CUSTOMER_EVIDENCE (retry)
    |
    +-- grace expired (T+30) --> REJECTED (offboard)
```

| Status                       | Meaning                                          |
|------------------------------|--------------------------------------------------|
| `PENDING_CUSTOMER_EVIDENCE`  | Waiting for customer to upload/submit document    |
| `PENDING_SUMSUB_REVIEW`      | Customer submitted, awaiting Sumsub verification  |
| `CLEARED`                    | Sumsub approved, holding refreshed to `FRESH`     |
| `REJECTED`                   | Grace period expired, customer offboarded         |

RED result resets cycle back to `PENDING_CUSTOMER_EVIDENCE` for retry (no new cycle created).

---

## Stage Escalation

Source: `config/material-refresh-policy.json` stages array.

| Stage        | Days from Expiry | Action                      | Side Effects                                           |
|--------------|------------------|-----------------------------|--------------------------------------------------------|
| `NUDGE_ONLY` | T-30             | `CREATE_CYCLE_NUDGE_ONLY`   | Create `MaterialRefreshCycle`, Sumsub action; holding -> `REFRESH_IN_PROGRESS` |
| `URGENT`     | T-7              | `ESCALATE_URGENT`           | Cycle stage updated; customer notification escalated    |
| `BLOCKING`   | T-0              | `ENFORCE_RESTRICTION`       | Holding -> `EXPIRED`; customer -> `RESTRICTED` if `enforceRestriction` |
| `TERMINATE`  | T+30             | `TERMINATE_CYCLE_OFFBOARD`  | Cycle -> `REJECTED`; customer -> `WITHDRAWN` / `INACTIVE`; holding -> `EXPIRED` |

### Stage Methods

- **`enterNotifiedStage(holdingId)`**: Creates cycle with status `PENDING_CUSTOMER_EVIDENCE`, stage `NUDGE_ONLY`. Creates Sumsub applicant action. Sets `graceExpiresAt` to `expiresAt + 30 days`.
- **`escalateToUrgent(holdingId)`**: Updates cycle stage to `URGENT`. If no active cycle exists, falls through to `enterNotifiedStage`.
- **`enterBlockingStage(holdingId)`**: Updates cycle stage to `BLOCKING`. Marks holding `EXPIRED`. If `enforceRestriction`, sets customer `RESTRICTED` with reason `material_expired:<materialType>`.
- **`terminateCycle(cycleId, reason)`**: Sets cycle to `REJECTED`. Customer -> `WITHDRAWN` / `INACTIVE`. Holding -> `EXPIRED`, clears `activeRefreshCycleId`.

---

## Key Methods

### `seedInitialHoldings(customerId, levelName)`

Called on onboarding approval. Creates `FRESH` holdings with randomized `expiresAt`.

- Gets required materials for `normalizeLevelName(levelName)`
- Skips materials that already exist for this customer
- For `SELF_MANAGED`: `expiresAt = now + floor(windowDays * random(0.3, 0.9))`
- For `SUMSUB_MANAGED` (no `windowDays`): `expiresAt = null` (expiry comes from Sumsub doc monitoring)
- No cycle created -- holdings start as `FRESH`

### `recomputeHoldingsForCustomer(customerId, levelName)`

Called on tier upgrade (Phase 1 approval). Two responsibilities:

1. **Recompute windows** for existing `SELF_MANAGED` holdings based on new tier's `windowDays`.
2. **Create MISSING holdings** for materials required by the new level but not yet held. Creates `REFRESH_IN_PROGRESS` holdings with active cycles (`PENDING_CUSTOMER_EVIDENCE`, `NUDGE_ONLY`, trigger `INITIAL_COLLECTION`).

### `handleSumsubActionResult(event)`

Webhook handler for `applicantActionReviewed`.

- **RED**: Reset cycle to `PENDING_CUSTOMER_EVIDENCE`, clear `customerSubmittedAt` (retry).
- **GREEN**: Close cycle (`CLEARED`), refresh holding to `FRESH`. New `expiresAt` from Sumsub doc `validUntil` or fallback to policy `windowDays`. Release restriction if this material caused it.

After GREEN, checks the **CRA bridge** (see below).

### `normalizeLevelName(raw)`

Maps short-form level names to policy keys:

| Input             | Output            |
|-------------------|-------------------|
| `"level2"`        | `"wave3-level-2"` |
| `"level-2"`       | `"wave3-level-2"` |
| `"level1"`        | `"wave3-level-1"` |
| `"level-1"`       | `"wave3-level-1"` |
| `"wave3-level-2"` | `"wave3-level-2"` (passthrough) |

---

## CRA Bridge (Layer 3 -> Layer 2)

When a material cycle is `CLEARED` via `handleSumsubActionResult`:

1. Check if customer has a `ClientRiskAssessment` in `PENDING_MATERIAL_SUBMISSION`.
2. Count remaining active cycles (`PENDING_CUSTOMER_EVIDENCE` or `PENDING_SUMSUB_REVIEW`).
3. If `pendingCycles === 0` (all materials cleared), call `clientRiskAssessmentService.handleMaterialSubmissionComplete(customerId, 'GREEN')`.
4. This triggers **Phase 2 approval** creation in the CRA service.

The bridge is property-injected to avoid circular dependency:
```
materialRefreshService.clientRiskAssessmentService = craService  // set in module onModuleInit
```

---

## Prisma Models

### `CustomerMaterialHolding`

Table: `customer_material_holdings`

| Field                  | Type       | Purpose                                           |
|------------------------|------------|---------------------------------------------------|
| `id`                   | `String`   | CUID primary key                                  |
| `holdingNo`            | `String`   | Human-readable reference (unique, prefix `CMH`)   |
| `customerId`           | `String`   | FK to `CustomerMain`                              |
| `materialType`         | `String`   | `EMIRATES_ID` / `LIVENESS` / `PROOF_OF_ADDRESS` / `SOURCE_OF_FUNDS` / `SOURCE_OF_WEALTH` |
| `managementMode`       | `String`   | `SUMSUB_MANAGED` or `SELF_MANAGED`                |
| `verifiedAt`           | `DateTime` | When material was last verified                   |
| `expiresAt`            | `DateTime?`| When material expires (null for SUMSUB_MANAGED awaiting doc data) |
| `status`               | `String`   | `FRESH` / `REFRESH_IN_PROGRESS` / `EXPIRED` / `MISSING` |
| `activeRefreshCycleId` | `String?`  | FK to current active `MaterialRefreshCycle` (unique) |

Unique constraint: `[customerId, materialType]` -- one holding per material type per customer.
Indexes: `[expiresAt, status]`, `[customerId]`

### `MaterialRefreshCycle`

Table: `material_refresh_cycles`

| Field                      | Type       | Purpose                                        |
|----------------------------|------------|-------------------------------------------------|
| `id`                       | `String`   | CUID primary key                               |
| `cycleNo`                  | `String`   | Human-readable reference (unique, prefix `MRC`) |
| `customerId`               | `String`   | FK to `CustomerMain`                           |
| `holdingId`                | `String`   | FK to `CustomerMaterialHolding`                |
| `materialType`             | `String`   | Denormalized from holding                       |
| `status`                   | `String`   | `PENDING_CUSTOMER_EVIDENCE` / `PENDING_SUMSUB_REVIEW` / `CLEARED` / `REJECTED` |
| `stage`                    | `String`   | `NUDGE_ONLY` / `URGENT` / `BLOCKING`           |
| `triggerType`              | `String`   | `SCHEDULED_EXPIRY` or `INITIAL_COLLECTION`      |
| `stageNudgeAt`             | `DateTime?`| When NUDGE_ONLY stage entered                   |
| `stageUrgentAt`            | `DateTime?`| When URGENT stage entered                       |
| `stageBlockingAt`          | `DateTime?`| When BLOCKING stage entered                     |
| `clearedAt`                | `DateTime?`| When cycle was cleared                          |
| `rejectedAt`               | `DateTime?`| When cycle was rejected (grace expired)         |
| `customerSubmittedAt`      | `DateTime?`| When customer submitted evidence                |
| `graceExpiresAt`           | `DateTime?`| Deadline: `expiresAt + 30 days`                 |
| `resolutionReason`         | `String?`  | E.g. `customer_refreshed`, `simulated_grace_expired` |
| `sumsubActionId`           | `String?`  | Sumsub action reference                         |
| `sumsubActionLevelName`    | `String?`  | Sumsub action level name                        |
| `triggeredByAssessmentId`  | `String?`  | FK to `ClientRiskAssessment` (if triggered by CRA) |
| `traceId`                  | `String`   | Unique trace ID (prefix `MATERIAL_REFRESH:`)    |

Indexes: `[customerId, status]`, `[status, graceExpiresAt]`, `[sumsubActionId]`

---

## API Endpoints

### Admin -- Material Management

| Method | Path | Purpose |
|--------|------|---------|
| `GET`  | `/admin/material-management/holdings` | List all holdings (filters: `customerId`, `status`, `materialType`) |
| `GET`  | `/admin/material-management/holdings/:id` | Holding detail + cycle history |
| `GET`  | `/admin/material-management/cycles` | List all cycles (filters: `customerId`, `status`, `materialType`, `stage`) |
| `GET`  | `/admin/material-management/cycles/:id` | Cycle detail |
| `POST` | `/admin/material-management/holdings/:id/simulate-stage` | Simulate stage transition (body: `targetStage`) |
| `POST` | `/admin/material-management/customers/:customerId/simulate-tier-change` | Direct tier change shortcut |

### Admin -- Sumsub Simulation

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/admin/sumsub/simulate/applicant-action-result` | Simulate cycle review result (GREEN/RED) |
| `POST` | `/admin/sumsub/simulate/ongoing-doc-monitoring-fire` | Simulate doc monitoring expiry |

### Customer -- Refresh Cycles

| Method | Path | Purpose |
|--------|------|---------|
| `GET`  | `/onboarding/refresh-cycles/:cycleId` | Get cycle status (customer-facing) |
| `POST` | `/onboarding/refresh-cycles/:cycleId/submit` | Mark evidence submitted |
| `POST` | `/onboarding/refresh-cycles/:cycleId/sdk-token` | Get Sumsub SDK token for action |

### Simulate Stage `targetStage` Values

| Value       | Effect                                                       |
|-------------|--------------------------------------------------------------|
| `T_MINUS_30`| Set expiry +25d, run `enterNotifiedStage`                    |
| `T_MINUS_7` | Set expiry +5d, run `escalateToUrgent`                       |
| `T_0`       | Set expiry -1d, run `enterBlockingStage`                     |
| `T_PLUS_30` | Set grace to past, run `terminateCycle`                      |
| `GREEN`     | Simulate customer completing refresh successfully             |
| `RED`       | No-op note (cycle stays pending for retry)                   |
