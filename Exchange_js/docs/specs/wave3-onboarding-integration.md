# Wave 3 -- Onboarding Integration (Layer 1 -> Layer 2 -> Layer 3)

> Living spec -- tracks current code state, not aspirational design.
> Last synced: 2026-04-11

---

## Overview

This document describes how onboarding completion triggers Layer 2 (risk assessment) and Layer 3 (material seeding). The chain:

```
Sumsub verification --> final approval --> tier assignment --> material seeding
```

Key service: `OnboardingFinalApprovalService` (`src/modules/identity/onboarding/onboarding-final-approval.service.ts`)

---

## Onboarding -> APPROVED Flow

### 1. Sumsub Verification Complete

The `applicantWorkflowCompleted` webhook fires when Sumsub finishes verifying a customer.

### 2. Final Approval Gate

| Condition                                      | Path                                           |
|------------------------------------------------|-------------------------------------------------|
| Customer has `sumsubExperiencedLevel2 = true`   | Enters `FINAL_APPROVAL` status; requires MLRO+SMO dual-sign via `ONBOARDING_FINAL_APPROVAL` |
| Customer has `sumsubExperiencedLevel2 = false`  | Direct `APPROVED` (no approval gate)            |

The `ONBOARDING_FINAL_APPROVAL` action type uses `ApprovalCase` with:
- `checkerRoles`: `['MLRO', 'SENIOR_MANAGEMENT_OFFICER']`
- `timeoutHours`: 240
- Entity ref: `customerId`

### 3. On APPROVED (approval projection)

When the approval event fires (`governance.approval.approved`), `syncApprovalProjectionByEvent` executes:

1. Update customer: `onboardingStatus = 'APPROVED'`, `operatingStatus = 'ACTIVE'`, `eddRequired = true`
2. Determine default tier from level:
   ```
   level = customer.sumsubCurrentLevelName || 'wave3-level-1'
   defaultTier = level contains 'level-2' or 'level2' ? 'HIGH' : 'LOW'
   ```
3. Set `riskTier = defaultTier`, `amlRiskTier = defaultTier`, `riskTierUpdatedAt = now()`
4. Call `materialRefreshService.seedInitialHoldings(customerId, level)`
5. Mark approval execution result as success

### 4. On REJECTED

Customer -> `onboardingStatus = 'REJECTED'`, `operatingStatus = 'INACTIVE'`, `eddRequired = true`.

---

## Level <-> Tier Default Mapping

| Sumsub Level       | Default Risk Tier | Notes                         |
|--------------------|--------------------|-------------------------------|
| `wave3-level-1`    | `LOW`              | Standard retail customer      |
| `wave3-level-2`    | `HIGH`             | Enhanced due diligence tier   |

**Downgrade forbidden**: once a customer reaches `HIGH`, they cannot be downgraded to `LOW` via any CRA assessment. The `downgradeForbidden: true` flag in `client-risk-assessment-policy.json` enforces this. The policy engine forces tier back to `HIGH` and escalates the signoff method.

---

## Material Seeding on Onboarding

Called by `OnboardingFinalApprovalService.syncApprovalProjectionByEvent` on APPROVED.

### `seedInitialHoldings(customerId, levelName)`

1. Resolves required materials via `getRequiredMaterialsForLevel(normalizeLevelName(levelName), policy)`
2. Skips any material types that already exist for the customer
3. Creates `CustomerMaterialHolding` for each required material:
   - `status`: `FRESH`
   - `managementMode`: from policy config
   - `verifiedAt`: `now()`
   - `expiresAt`: randomized for demo variety
4. No `MaterialRefreshCycle` created -- holdings start fresh

### Expiry Randomization

For `SELF_MANAGED` materials with `windowDays`:
```
randomFraction = 0.3 + Math.random() * 0.6    // range: [0.3, 0.9)
expiresAt = now + floor(windowDays[riskTier] * randomFraction)
```

This produces varied expiry dates across customers for realistic demo data.

For `SUMSUB_MANAGED` materials (e.g. `EMIRATES_ID`): `expiresAt = null` -- expiry comes from Sumsub document monitoring.

### Materials by Level

| Level 1 (`wave3-level-1`)  | Level 2 (`wave3-level-2`)                         |
|----------------------------|----------------------------------------------------|
| `EMIRATES_ID`              | `EMIRATES_ID`                                      |
| `LIVENESS`                 | `LIVENESS`                                         |
| `PROOF_OF_ADDRESS`         | `PROOF_OF_ADDRESS`                                 |
|                            | `SOURCE_OF_FUNDS`                                  |
|                            | `SOURCE_OF_WEALTH`                                 |

### `normalizeLevelName` Mapping

The customer model stores level names in short form (`"level2"`), but the material policy uses full form (`"wave3-level-2"`). The `normalizeLevelName()` function bridges this:

| Input              | Output             |
|--------------------|--------------------|
| `"level2"`         | `"wave3-level-2"`  |
| `"level-2"`        | `"wave3-level-2"`  |
| `"level1"`         | `"wave3-level-1"`  |
| `"level-1"`        | `"wave3-level-1"`  |
| `"wave3-level-2"`  | `"wave3-level-2"`  |
| Other              | `"wave3-<input>"`  |

---

## EDD + Dual-Sign

Both PEP and HIGH RISK customers require Enhanced Due Diligence (EDD) and MLRO + Senior Management Officer dual-sign.

### Onboarding Final Approval

| Property        | Value                                      |
|-----------------|--------------------------------------------|
| Action Type     | `ONBOARDING_FINAL_APPROVAL`                |
| Risk Level      | `HIGH`                                     |
| Checker Roles   | `['MLRO', 'SENIOR_MANAGEMENT_OFFICER']`    |
| Timeout         | 240 hours (10 days)                        |
| Allow Cancel    | `true`                                     |
| Allow Retry     | `true`                                     |

### When EDD + Dual-Sign Triggers

- Level 2 customers (`sumsubExperiencedLevel2 = true`) require final approval before `APPROVED`.
- PEP hits during CRA trigger `RESTRICT` + `DUAL_MLRO_SENIOR` signoff (via policy rule priority 2).
- HIGH tier CRA Phase 2 uses `RISK_RATING_HIGH_APPROVAL` with `['MLRO', 'SENIOR_MANAGEMENT_OFFICER']`.

### DB Policy Override

The `ApprovalPolicy` table in the database takes precedence over `DEFAULT_APPROVAL_POLICIES` in code constants. When updating approval policies:
- Update the DB `ApprovalPolicy` row **and** the code constants to keep them in sync.
- DB is authoritative at runtime; code constants are fallback defaults.

---

## Wave 2 Content Removed

Wave 3 moved compliance investigation features to Sumsub. The following have been removed or hidden:

| Removed Component               | Replacement                      |
|---------------------------------|----------------------------------|
| Compliance alerts UI            | Sumsub monitoring dashboard      |
| Compliance cases UI             | Sumsub case management           |
| Risk engine investigation UI    | Sumsub risk scoring              |
| CDD Response menu               | Hidden (Sumsub handles CDD)     |
| EDD Response menu                | Hidden (Sumsub handles EDD)     |
| Risk Management sidebar group    | Removed from admin navigation   |

**Retained from Wave 1**:
- Approvals system (governance) -- used for onboarding final approval, CRA signoff, change tickets, delete requests, audit exports.
- Audit logs -- all Layer 2/3 actions write audit trail via `AuditLogsService`.

---

## Known Constraints

### SUMSUB_MOCK_MODE

When `SUMSUB_MOCK_MODE=true` (default for local dev):
- All Sumsub API calls (`runAmlCheck`, `getApplicant`, `moveToLevel`, `createApplicantAction`, `createActionSdkToken`) return hardcoded mock responses.
- AML check results must be simulated via `/admin/sumsub/simulate/*` endpoints.
- Document monitoring events must be simulated manually.

### DB Approval Policy Override

The `ApprovalPolicy` database table is authoritative at runtime. Code constants in `approval.constants.ts` are fallback defaults used only when no DB policy row exists for an action type. Both must be updated when changing approval rules.

### Level Name Mismatch

The `CustomerMain.sumsubCurrentLevelName` field stores values like `"level2"` (from Sumsub SDK), but the material refresh policy uses `"wave3-level-2"` as keys. The `normalizeLevelName()` function in `material-refresh.service.ts` handles this mapping. This function is called in:
- `seedInitialHoldings`
- `recomputeHoldingsForCustomer`
- `getRequiredMaterialsForLevel`

### Circular Dependency Resolution

Layer 2 and Layer 3 have bidirectional dependencies:
- CRA service needs `materialRefreshService` to seed/recompute holdings after signoff.
- Material refresh service needs `clientRiskAssessmentService` to trigger Phase 2 approval when all materials clear.

Both are resolved via property injection in `onModuleInit`:
```
craService.materialRefreshService = materialRefreshService
materialRefreshService.clientRiskAssessmentService = craService
```

The `OnboardingFinalApprovalService` also uses property injection for `materialRefreshService` to call `seedInitialHoldings` on approval.

### Assessment Frequency

All tiers use 90-day assessment frequency (from `assessmentFrequencyDays` in policy JSON). This is a demo simplification -- production would likely use shorter intervals for HIGH.

### Grace Period

`recomputeHoldingsForCustomer` uses a hardcoded 14-day grace period for newly created MISSING holdings (vs. 30 days in the stage policy for expiry-triggered cycles).
