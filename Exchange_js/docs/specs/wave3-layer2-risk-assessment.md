# Wave 3 -- Layer 2: Client Risk Assessment (CRA)

> Living spec -- tracks current code state, not aspirational design.
> Last synced: 2026-04-11

---

## Overview

Layer 2 performs periodic AML-based risk assessment per VARA III.D.8.
The demo system uses an **AML-only model** -- no business CRA scoring.
Sumsub integration path: `runAmlCheck` -> webhook `applicantReviewed` -> `getApplicant` snapshot.

Trigger types (enum `AssessmentTriggerType`):

| Value                  | Source                              |
|------------------------|-------------------------------------|
| `INITIAL_ONBOARDING`   | Onboarding approval flow            |
| `SCHEDULED_QUARTERLY`  | Cron (90-day frequency, all tiers)  |
| `SUMSUB_AML_HIT`       | Sumsub push notification            |
| `MLRO_MANUAL`          | Admin manual trigger                |

Entry points:
- `startAssessment()` -- creates assessment + calls `runAmlCheck`; used for scheduled/manual triggers.
- `recordAssessmentFromKnownAmlResult()` -- reuses existing AML result from onboarding; no new `/aml/check` call.

---

## 4 Scenarios

| Scenario    | Trigger Condition             | AML Result        | Approval Flow                                   | Customer Impact                                | Status Flow |
|-------------|-------------------------------|-------------------|--------------------------------------------------|------------------------------------------------|-------------|
| LOW -> LOW  | GREEN, no labels              | GREEN              | `AUTO_R2` (system auto-sign)                     | None                                            | `PENDING_SUMSUB_RESULT` -> `SIGNED` |
| LOW -> HIGH | RED + PEP/ADVERSE_MEDIA labels | RED                | Phase 1: MLRO single -> restrict + L2 upgrade + materials -> Phase 2: MLRO+SMO dual-sign | RESTRICTED, level moved to `wave3-level-2`, L2 materials created | `PENDING_SUMSUB_RESULT` -> `PENDING_PHASE1_APPROVAL` -> `PENDING_MATERIAL_SUBMISSION` -> `PENDING_PHASE2_APPROVAL` -> `SIGNED` |
| HIGH -> HIGH | RED or GREEN (blocked)        | RED or GREEN       | MLRO single (`RISK_RATING_MAINTENANCE_APPROVAL`) | Maintain HIGH tier                              | `PENDING_SUMSUB_RESULT` -> `PENDING_SIGNATURE` -> `SIGNED` |
| HIGH -> LOW  | GREEN (downgrade blocked)     | GREEN              | MLRO single (downgrade forbidden)                | Maintain HIGH tier (downgrade blocked)          | `PENDING_SUMSUB_RESULT` -> `PENDING_SIGNATURE` -> `SIGNED` |

Sanctions short-circuit: RED + `SANCTIONS_*` labels -> `ESCALATED_TO_SUMSUB`, customer FROZEN.

---

## Status Machine

```
PENDING_SUMSUB_RESULT
  |
  +-- [SANCTIONS_* labels] --> ESCALATED_TO_SUMSUB
  |                             |
  |                             +-- Sumsub case APPROVE --> SIGNED (unfreeze)
  |                             +-- Sumsub case REJECT  --> SIGNED (offboard)
  |
  +-- [LOW->LOW: GREEN, stable] --> SIGNED (auto, signedBy=SYSTEM)
  |
  +-- [LOW->HIGH: RED + PEP/ADVERSE] --> PENDING_PHASE1_APPROVAL
  |                                        |
  |                                        +-- APPROVED --> PENDING_MATERIAL_SUBMISSION
  |                                        |                  |
  |                                        |                  +-- all cycles CLEARED --> PENDING_PHASE2_APPROVAL
  |                                        |                                              |
  |                                        |                                              +-- APPROVED --> SIGNED (clear restriction)
  |                                        |                                              +-- REJECTED --> SIGNED (offboard)
  |                                        +-- REJECTED --> SIGNED (offboard)
  |
  +-- [HIGH->HIGH or HIGH->LOW blocked] --> PENDING_SIGNATURE
                                              |
                                              +-- APPROVED --> SIGNED
                                              +-- REJECTED --> SIGNED (offboard)
```

---

## Policy Rules

Source: `config/client-risk-assessment-policy.json` (version `1.0.0`, effective `2026-04-09`)

| Priority | Condition                       | Tier           | Action                     | Immediate Effect | Signoff Method      |
|----------|---------------------------------|----------------|----------------------------|------------------|---------------------|
| 1        | `labels_contains_SANCTIONS`     | `HIGH`         | `ESCALATE_TO_SUMSUB_CASE`  | `FREEZE`         | `ESCALATED`         |
| 2        | `labels_contains_PEP`           | `HIGH`         | `PEP_REVIEW`               | `RESTRICT`       | `DUAL_MLRO_SENIOR`  |
| 3        | `labels_contains_ADVERSE_MEDIA` | `HIGH`         | `MANUAL_REVIEW`            | --               | `MANUAL_MLRO`       |
| 4        | `red_other`                     | `KEEP_PREVIOUS` | `MANUAL_REVIEW`            | --               | `MANUAL_MLRO`       |
| 5        | `any_required_material_stale`   | `UNKNOWN`      | `REQUEST_REFRESH`          | --               | `MANUAL_MLRO`       |
| 6        | `green_stable`                  | `LOW`          | `REAFFIRM`                 | --               | `AUTO_R2`           |

Rules are evaluated in priority order; first match wins.

**Downgrade forbidden**: when `previousTier=HIGH` and rule produces non-HIGH tier, the tier is forced back to `HIGH` and `signoffMethod` escalates from `AUTO_R2` to `DUAL_MLRO_SENIOR` (or `MANUAL_MLRO` for maintenance).

**Scenario derivation** (in `applyPolicy`):
- `signoffMethod=ESCALATED` -> `ESCALATED`
- `signoffMethod=AUTO_R2` and no downgrade block -> `LOW_TO_LOW`
- `previousTier=HIGH` and `resultingTier=HIGH` (or downgrade blocked) -> `HIGH_MAINTAIN`
- `previousTier!=HIGH` and `resultingTier=HIGH` -> `LOW_TO_HIGH` (signoff forced to `PHASE1_MLRO`)

**Tier-Level constraint**:

| Tier   | Allowed Sumsub Levels               |
|--------|--------------------------------------|
| LOW    | `wave3-level-1`                      |
| MEDIUM | `wave3-level-1`, `wave3-level-2`     |
| HIGH   | `wave3-level-2`                      |

---

## Approval Action Types

| Action Type                         | Checker Roles                        | Timeout | Used In            |
|-------------------------------------|--------------------------------------|---------|--------------------|
| `RISK_RATING_UPGRADE_PHASE1`        | `MLRO`                               | 168h    | LOW->HIGH Phase 1  |
| `RISK_RATING_HIGH_APPROVAL`         | `MLRO`, `SENIOR_MANAGEMENT_OFFICER`  | 240h    | LOW->HIGH Phase 2  |
| `RISK_RATING_MAINTENANCE_APPROVAL`  | `MLRO`                               | 168h    | HIGH->HIGH / HIGH->LOW maintenance |
| `RISK_RATING_MEDIUM_APPROVAL`       | `COMPLIANCE_OFFICER`                 | 168h    | Medium threshold (reserved) |
| `PEP_RELATIONSHIP_APPROVAL`         | `MLRO`, `SENIOR_MANAGEMENT_OFFICER`  | 240h    | PEP relationship (reserved) |

Note: DB `ApprovalPolicy` table takes precedence over code constants. `signoffActionTypeMap` in the policy JSON maps signoff methods to action types.

---

## Prisma Model: `ClientRiskAssessment`

Table: `client_risk_assessments`

| Field                         | Type       | Purpose                                        |
|-------------------------------|------------|-------------------------------------------------|
| `id`                          | `String`   | CUID primary key                                |
| `assessmentNo`                | `String`   | Human-readable reference (unique, prefix `CRA`) |
| `customerId`                  | `String`   | FK to `CustomerMain`                            |
| `triggerType`                 | `String`   | `INITIAL_ONBOARDING` / `SCHEDULED_QUARTERLY` / `SUMSUB_AML_HIT` / `MLRO_MANUAL` |
| `triggeredAt`                 | `DateTime` | Auto-set on creation                            |
| `policyVersion`               | `String`   | Snapshot of policy version at trigger time       |
| `previousRiskTier`            | `String?`  | Customer tier before this assessment             |
| `resultingRiskTier`           | `String?`  | Tier after policy evaluation                     |
| `scoreSuggestedTier`          | `String?`  | Set when downgrade was blocked                   |
| `recommendedAction`           | `String?`  | Policy-determined action                         |
| `reasoning`                   | `String?`  | JSON: `{ ruleId, amlAnswer, amlLabels, ... }`   |
| `status`                      | `String`   | See status machine above                         |
| `signoffMethod`               | `String?`  | `AUTO_R2` / `MANUAL_MLRO` / `PHASE1_MLRO` / `DUAL_MLRO_SENIOR` / `ESCALATED` |
| `approvalCaseId`              | `String?`  | FK to `ApprovalCase` (maintenance scenario)      |
| `phase1ApprovalCaseId`        | `String?`  | FK for Phase 1 approval                          |
| `phase2ApprovalCaseId`        | `String?`  | FK for Phase 2 approval                          |
| `signedBy`                    | `String?`  | `SYSTEM` for auto, actor ID for manual           |
| `signedAt`                    | `DateTime?`| When assessment was signed off                   |
| `sumsubAmlCheckInspectionId`  | `String?`  | Sumsub inspection reference                      |
| `sumsubAmlReviewAnswer`       | `String?`  | `GREEN` or `RED`                                 |
| `sumsubAmlLabels`             | `String?`  | JSON array of reject labels                      |
| `sumsubRiskScore`             | `Int?`     | From `getApplicant` snapshot                     |
| `sumsubTags`                  | `String?`  | JSON array from snapshot                         |
| `sumsubInternalCaseRef`       | `String?`  | Sumsub case reference (sanctions path)           |
| `sumsubCaseFinalDecision`     | `String?`  | `APPROVE` or `REJECT` (sanctions path)           |
| `traceId`                     | `String`   | Unique trace ID (prefix `CLIENT_RISK_ASSESSMENT:`) |

Indexes: `[customerId, status]`, `[customerId, triggeredAt]`, `[sumsubAmlCheckInspectionId]`, `[status, triggeredAt]`

---

## API Endpoints

### Admin -- Risk Assessment

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/admin/compliance/customers/:customerId/risk-assessment/trigger` | Manual trigger (MLRO) |
| `GET`  | `/admin/compliance/risk-assessments` | List assessments (filters: `status`, `triggerType`, `customerId`) |
| `GET`  | `/admin/compliance/risk-assessments/:id` | Assessment detail with customer info |

### Admin -- Sumsub Simulation

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/admin/sumsub/simulate/aml-check-result` | Simulate AML webhook for a pending assessment |
| `POST` | `/admin/sumsub/simulate/risk-assessment-scenario` | Trigger + simulate AML result in one call |
| `POST` | `/admin/sumsub/simulate/sumsub-case-decision` | Simulate sanctions case final decision |
| `POST` | `/admin/sumsub/simulate/ongoing-doc-monitoring-fire` | Simulate ongoing document monitoring |

---

## Demo Simulation Flow

### LOW -> LOW (reaffirm)

1. `POST /admin/sumsub/simulate/risk-assessment-scenario` with `{ customerNo, reviewAnswer: "GREEN" }`
2. Assessment auto-signs immediately -> status `SIGNED`

### LOW -> HIGH (PEP upgrade)

1. `POST /admin/sumsub/simulate/risk-assessment-scenario` with `{ customerNo, reviewAnswer: "RED", rejectLabels: ["PEP_TIER_1"] }`
2. Assessment -> `PENDING_PHASE1_APPROVAL`; customer RESTRICTED, pepStatus = CONFIRMED
3. Approve Phase 1 via approvals UI -> customer moves to `wave3-level-2`, L2 materials created
4. Assessment -> `PENDING_MATERIAL_SUBMISSION`
5. Complete all material cycles (simulate GREEN for each) -> assessment -> `PENDING_PHASE2_APPROVAL`
6. Approve Phase 2 via approvals UI -> assessment `SIGNED`, restriction cleared

### HIGH -> HIGH (maintenance)

1. `POST /admin/sumsub/simulate/risk-assessment-scenario` with `{ customerNo, reviewAnswer: "RED", rejectLabels: ["ADVERSE_MEDIA_FINANCIAL_CRIME"] }`
2. Assessment -> `PENDING_SIGNATURE`
3. Approve via approvals UI -> assessment `SIGNED`

### HIGH -> LOW (downgrade blocked)

1. `POST /admin/sumsub/simulate/risk-assessment-scenario` with `{ customerNo, reviewAnswer: "GREEN" }` (customer already HIGH)
2. Policy suggests LOW but `downgradeForbidden=true` forces HIGH
3. Assessment -> `PENDING_SIGNATURE` (maintenance signoff)
4. Approve -> assessment `SIGNED`, tier stays HIGH

### Sanctions Escalation

1. `POST /admin/sumsub/simulate/risk-assessment-scenario` with `{ customerNo, reviewAnswer: "RED", rejectLabels: ["SANCTIONS_OFAC"] }`
2. Assessment -> `ESCALATED_TO_SUMSUB`, customer FROZEN
3. `POST /admin/sumsub/simulate/sumsub-case-decision` with `{ assessmentId, decision: "APPROVE" }` (false positive) or `"REJECT"` (true match -> offboard)
