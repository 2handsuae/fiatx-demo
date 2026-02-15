# Onboarding Flow Constraints

## 1) Scope and Ownership
- Scope module: `src/modules/identity/onboarding/**`.
- Customer endpoints under `/onboarding/**`.
- Admin compliance endpoints under `/admin/compliance/**`.
- MUST keep customer and admin authority separated by token type.

## 2) Single-Path Next Step Contract
- `getNextStep` is the single decision source for UI guidance.
- Allowed `step` values:
1. `ENTITY_INFO`
2. `CDD`
3. `WAIT_REVIEW`
4. `EDD`
5. `REINITIATE`
6. `COMPLETED`
- Allowed `action` values:
1. `SAVE_ENTITY`
2. `START_CDD`
3. `COMPLETE_CDD`
4. `COMPLETE_EDD`
5. `WAIT`
6. `REINITIATE_CDD`
7. `REINITIATE_EDD`
8. `NONE`
- MUST NOT introduce parallel/competing "next step" logic in controllers or frontend pages.

## 3) Entity Preconditions
- `customerType` MUST be explicit (`INDIVIDUAL` or `CORPORATE`) before case bootstrapping.
- Corporate onboarding MUST require:
1. corporate profile
2. at least one UBO
- Missing prerequisites MUST return explicit validation errors.

## 4) Case Lifecycle Constraints
- CDD/EDD review actions MUST only apply to `SUBMITTED` cases.
- CDD review outcomes:
1. `APPROVE`
2. `REJECT`
3. `UPGRADE_EDD`
- EDD MLRO outcomes:
1. `APPROVE`
2. `REJECT`
- Final customer decision only allowed after CDD approved + EDD approved when EDD required.

## 5) Reinitiation Rules
- CDD reinitiation only allowed when next action is `REINITIATE_CDD`.
- EDD reinitiation only allowed after EDD/final-approval rejection, and when CDD is approved.
- Reinitiation MUST create/attach valid active case context and session context.

## 6) Compliance Snapshot and Trading Gate
- Any onboarding state mutation MUST trigger compliance snapshot recomputation.
- Trading eligibility MUST gate on `complianceStatus === ACTIVE`.
- Onboarding-related reject/expired states MUST map to actionable reinitiation outcome.

## 7) Session and Provider Handling
- Session creation MUST be case-bound and traceable.
- Mock completion path MUST behave deterministically and update case lifecycle consistently.
- Provider payload mapping MUST be stored as structured data (raw/normalized where applicable).

## 8) Auditability (Mandatory)
- Key onboarding actions MUST write onboarding audit logs, including:
1. actor id/role
2. customer id
3. case type/id when applicable
4. from/to stage when applicable
5. detail payload
- MUST keep reason fields for review/rejection/final decision.

## 9) Thread Delivery Checklist (Onboarding)
- Next-step contract unchanged or explicitly versioned.
- Status transitions validated (including invalid transition tests).
- Role boundary tested (customer vs admin token).
- Reinitiation path tested for both CDD and EDD.
- Audit log entries verified for new critical actions.
