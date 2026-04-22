# Tier Upgrade Workflow

Wave: 3 | Source verified: tier-upgrade-case.service.ts, tier-upgrade-case-approval-projection.service.ts, client-risk-assessment.service.ts (trigger point), config/client-risk-assessment-policy.json, prisma/schema.prisma
Last Updated: 2026-04-21

## Purpose

Manages the structured process for upgrading a customer's risk tier from LOW to HIGH, requiring Sumsub Level 2 verification followed by dual MLRO + SMO approval, with the customer restricted from trading throughout.

## Actors

| Actor | Role |
|---|---|
| System (CRA engine) | Detects LOW → HIGH upgrade scenario after CRA is SIGNED; creates TierUpgradeCase automatically |
| Sumsub | Provides Level 2 verification flow; webhook callback signals completion |
| MLRO | Phase 2 approver (must approve the `RISK_RATING_TIER_UPGRADE_APPROVAL` ApprovalCase) |
| SMO (Senior Management Officer) | Phase 2 co-approver (dual approval required) |
| Customer | Completes Sumsub Level 2 verification to advance from Phase 1 |

## Trigger Condition

`TierUpgradeCaseService.createFromCra()` is called by `ClientRiskAssessmentService.signAssessment()` only when:
- `assessment.previousRiskTier === 'LOW'` AND
- `assessment.resultingRiskTier === 'HIGH'`

No other tier transitions (MEDIUM → HIGH, HIGH → HIGH) trigger this workflow. The CRA policy (`config/client-risk-assessment-policy.json`) also enforces `downgradeForbidden: true` and maps HIGH tier to `wave3-level-2` only.

## State Machine

### TierUpgradeCase.status

| Status | Description | Trigger | Next |
|---|---|---|---|
| PENDING_LEVEL2 | Case created; customer restricted; Sumsub moved to Level 2 | `createFromCra()` on LOW→HIGH CRA | Sumsub Level 2 webhook → PENDING_PHASE2_APPROVAL |
| PENDING_PHASE2_APPROVAL | Sumsub Level 2 complete; `RISK_RATING_TIER_UPGRADE_APPROVAL` ApprovalCase submitted | `handleLevel2WorkflowComplete()` | ApprovalCase APPROVED → COMPLETED; REJECTED → REJECTED |
| COMPLETED | Tier promoted to HIGH; restriction cleared | MLRO + SMO dual approval APPROVED | Terminal |
| REJECTED | Customer offboarded (REJECTED + INACTIVE) | MLRO + SMO dual approval REJECTED | Terminal |

## Flow

1. CRA engine signs an assessment with `LOW → HIGH` result; calls `createFromCra(cra)`.
2. Within a DB transaction:
   - `TierUpgradeCase` created with `status=PENDING_LEVEL2`.
   - `CustomerMain.restrictionStatus` set to `RESTRICTED`, `restrictionReason=tier_upgrade_pending_level2`.
3. System calls `sumsubClient.moveToLevel(applicantId, 'wave3-level-2')` and updates `CustomerMain.sumsubCurrentLevelName=wave3-level-2`, `sumsubExperiencedLevel2=true`.
4. Audit event `TIER_UPGRADE_CASE_CREATED` written with `triggerType=AUTOMATED`.
5. Customer completes the Sumsub Level 2 flow (identity + liveness + address + source of funds/wealth documents).
6. Sumsub webhook fires; orchestrator calls `handleLevel2WorkflowComplete(customerId)`.
7. `ApprovalsService.createAndSubmit()` creates an ApprovalCase with `actionType=RISK_RATING_TIER_UPGRADE_APPROVAL`.
8. `TierUpgradeCase` updated to `status=PENDING_PHASE2_APPROVAL`, `phase2ApprovalCaseId` linked.
9. Approval event listener (`TierUpgradeCaseApprovalProjectionService`) listens for `ApprovalEvents.APPROVED` and `ApprovalEvents.REJECTED`.
10. On APPROVED — DB transaction:
    - `CustomerMain`: `riskTier=HIGH`, `amlRiskTier=HIGH`, `riskTierUpdatedAt=now`, `restrictionStatus=CLEAR`, `latestRiskApprovalId` and `latestRiskApprovalStatus=APPROVED` updated.
    - `TierUpgradeCase`: `status=COMPLETED`, `completedAt=now`.
    - Audit event `TIER_UPGRADE_CASE_COMPLETED`.
11. On REJECTED — DB transaction:
    - `CustomerMain`: `onboardingStatus=REJECTED`, `operatingStatus=INACTIVE`, `restrictionStatus=CLEAR`.
    - `TierUpgradeCase`: `status=REJECTED`, `rejectedAt=now`.
    - Audit event `TIER_UPGRADE_CASE_REJECTED`.

## Key Rules

- Only the LOW → HIGH scenario creates a TierUpgradeCase; `createFromCra()` will silently return if the customer record is missing.
- The customer is immediately RESTRICTED upon case creation — before Sumsub Level 2 is even started.
- `moveToLevel('wave3-level-2')` failures are logged but do not block case creation (best-effort).
- `handleLevel2WorkflowComplete()` is idempotent with regard to existing cases: it only acts on cases in `PENDING_LEVEL2` status (`findFirst` with `orderBy: createdAt desc`).
- If `TierUpgradeCase.update` fails after approval creation (partial failure), a warning log is emitted and manual recovery is required — the approval case will exist but the upgrade case will not reflect the new phase.
- The ApprovalCase `actionType` is `RISK_RATING_TIER_UPGRADE_APPROVAL`; the projection service filters for this specific action type and for `entityRef` starting with `tier_upgrade_case:`.
- Policy enforces `tierLevelConstraint: { HIGH: ['wave3-level-2'] }` — HIGH risk tier customers must be at Sumsub Level 2.
- Downgrade from HIGH is forbidden (`downgradeForbidden: true` in CRA policy).
- All terminal state changes are wrapped in DB transactions (`prisma.$transaction`).

## API Endpoints

There are no dedicated HTTP endpoints on the TierUpgradeCase service itself — it is driven entirely by:

| Event/Call | Source | Calls |
|---|---|---|
| `ClientRiskAssessmentService.signAssessment()` | Admin via CRA workflow | `createFromCra()` |
| Sumsub Level 2 webhook callback | Sumsub → orchestrator | `handleLevel2WorkflowComplete()` |
| `ApprovalEvents.APPROVED/REJECTED` | Governance approvals module | `handleSignoffComplete()` via projection |

### Customer-visible status query (read-only)

| Method | Path | Description |
|---|---|---|
| GET | `/onboarding/my-tier-upgrade` | Returns active TierUpgradeCase status for customer (`client-risk-assessment-customer.controller.ts`, filters `PENDING_LEVEL2` or `PENDING_PHASE2_APPROVAL`) |
