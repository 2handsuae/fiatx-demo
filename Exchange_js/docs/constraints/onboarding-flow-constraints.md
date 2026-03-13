# Onboarding Flow Constraints

## 1) Scope and Ownership
- Scope module: `src/modules/identity/onboarding/**`.
- Customer endpoints under `/onboarding/**`.
- Admin compliance endpoints under `/admin/compliance/**`.
- Customer and admin authority MUST remain separated by token type.

## 2) Canonical Identities
- Onboarding domain MUST only use these identities:
1. `customer`
2. `cddCase`
3. `eddCase`
4. `onboardingDecisionRecord`
5. `alert`
6. `incident`
- MRLO/Senior approval MUST be represented as action + audit log, not a new entity.

## 3) Next-Step Contract
- `getNextStep` is the single source for onboarding guidance.
- Contract output MUST be:
1. `publicStatus`
2. `actions[]`
3. `blockedReason`
4. `activeCaseId`
5. `requiresEdd`
- Allowed `publicStatus`:
1. `NONE`
2. `PENDING_CDD`
3. `REVIEW_CDD`
4. `PENDING_EDD`
5. `REVIEW_EDD`
6. `FINAL_APPROVAL`
7. `ACTIVE`
8. `REJECTED`
9. `WITHDRAWN`
- Allowed action types:
1. `START_CDD`
2. `CREATE_CDD_SESSION`
3. `COMPLETE_CDD`
4. `START_EDD`
5. `CREATE_EDD_SESSION`
6. `COMPLETE_EDD`
7. `WAIT_REVIEW`
8. `WAIT_FINAL_APPROVAL`
9. `REINITIATE_CDD`
10. `NONE`
- MUST NOT add competing next-step logic in controller or frontend page layers.

## 4) State Machine Constraints
- Customer lifecycle MUST stay progress-only:
1. `NONE -> PENDING_CDD -> REVIEW_CDD -> PENDING_EDD -> REVIEW_EDD -> FINAL_APPROVAL -> ACTIVE`
- Customer terminal status MUST stay:
1. `REJECTED`
2. `WITHDRAWN`
- CDD/EDD case lifecycle MUST stay:
1. `CREATED -> RECEIVED -> FINAL`
- DecisionRecord lifecycle MUST stay:
1. `CREATED -> COMPLETED | FAILED`
- State fields MUST express lifecycle progress only, not business decisions.

## 5) Risk Engine Constraints
- Risk decision domain MUST expose one entry:
1. `evaluate(contextType, subjectId, signals, policyVersion?)`
- Every evaluate call MUST persist one `onboardingDecisionRecord`.
- DecisionRecord MUST be replayable with:
1. `contextType`
2. `policyVersion`
3. `inputHash`
4. input snapshot
5. output (`decision`, `recommendedActions`, `reasonCodes`)
- External CDD/EDD provider callback MUST be treated as evidence input only; final routing is decided by Risk Engine output mapping.

## 6) CDD/EDD Orchestration Constraints
- Starting onboarding MUST create or reuse active CDD case in `CREATED`.
- Session completion MUST move case to `RECEIVED`, store provider payload, then finalize case as `FINAL` after evaluation.
- CDD completion MUST evaluate risk and move customer to `REVIEW_CDD` (container waiting for recommendation execution).
- EDD completion MUST evaluate risk and move customer to `REVIEW_EDD` (container waiting for recommendation execution).
- CDD mock submission profile MUST support:
1. `LOW_RISK` -> auto-pass onboarding to `ACTIVE` without creating/updating onboarding journey alert
2. `MEDIUM_RISK` / `HIGH_RISK_OR_PEP` -> create/update onboarding journey alert only
3. `SANCTION_AND_OTHER` -> create/update onboarding journey alert, then auto-escalate and auto-create incident
- Legacy compatibility for CDD mock completion MUST remain:
1. when `mockDataType` is missing and `result='FAIL'`, map to `SANCTION_AND_OTHER`
2. otherwise map to `LOW_RISK`
- Final approve/reject action MUST only be allowed from `FINAL_APPROVAL`.

## 7) Alert and Incident Integration
- Onboarding review signal MUST be upserted by journey key (`customerId:journeyId`) as one alert in MVP.
- EDD re-evaluation SHOULD update existing journey alert instead of always creating a second alert.
- Alert/incident decision details MAY be written to filter fields (`decisionRecommendation`, `decision`) but MUST NOT change state-machine definition.
- Recommendation options MUST come from risk-engine output (`recommendedDecisions`) and be projected to alert/incident detail.
- Recommendation set contract MUST remain:
1. CDD review: `APPROVE`, `REJECT`, `REQUIRE_EDD`
2. EDD review: `APPROVE`, `REJECT`
- EDD-stage recommendation rendering MUST NOT show `REQUIRE_EDD` in alert or incident detail views.
- `REVIEW_CDD` stage MAY be progressed by assigned onboarding journey alert decision action:
1. `APPROVE` -> customer `ACTIVE`
2. `REJECT` -> customer `REJECTED`
3. `REQUIRE_EDD` -> create/reuse EDD case and move customer to `PENDING_EDD`
- `REVIEW_EDD` stage MAY be progressed by assigned onboarding journey alert/incident decision action:
1. `APPROVE` -> customer `FINAL_APPROVAL`
2. `REJECT` -> customer `REJECTED`
- Recommendation actions are intentionally repeat-callable at container level; illegal transitions MUST be blocked by onboarding stage validation.
- Alert workflow state (`ASSIGN/ESCALATE/CLOSE`) and onboarding recommendation actions MUST stay decoupled.

## 8) Trading Gate and Legacy Snapshot
- Trading eligibility gate MUST use `publicStatus === ACTIVE`.
- Legacy fields (`complianceStatus`, `cddStatus`, `eddStatus`) MAY be maintained as compatibility snapshot only.
- Reinitiation MUST only be available for rejected/withdrawn/expired scenarios.

## 9) Auditability (Mandatory)
- Key onboarding actions MUST write onboarding audit logs with:
1. actor id/role
2. customer id
3. case type/id when applicable
4. from/to stage when applicable
5. detail payload
- Decision transition actions MUST keep reason fields for audit and replay.

## 10) Thread Delivery Checklist (Onboarding)
- `publicStatus + actions[]` contract unchanged or explicitly versioned.
- Customer/case/decision transitions validated with tests.
- Risk Engine evaluate-to-record behavior validated.
- Alert/incident linkage validated for onboarding journey rules.
- Audit log records verified for critical actions.
- Cross-module read-model stability verified for `GET /customers/:id` onboarding snapshot fields:
1. `publicStatus`
2. `cddCases`
3. `eddCases`
4. `onboardingAuditLogs`

## 11) Client Verification Projection Rules
- Client `/verification` UI MAY project backend `publicStatus + actions[]` to a view-only `step/action` model for rendering, but MUST NOT re-define onboarding business states.
- Projection baseline MUST keep these mappings:
1. `NONE` + `START_CDD` -> `CDD` / `START_CDD`
2. `PENDING_CDD` + `COMPLETE_CDD` -> `CDD` / `COMPLETE_CDD`
3. `PENDING_EDD` + `COMPLETE_EDD` -> `EDD` / `COMPLETE_EDD`
4. `REVIEW_CDD|REVIEW_EDD` + `WAIT_REVIEW` -> `WAIT_REVIEW` / `WAIT`
5. `FINAL_APPROVAL` + `WAIT_FINAL_APPROVAL` -> `WAIT_REVIEW` / `WAIT`
6. `REJECTED|WITHDRAWN` + `REINITIATE_CDD` -> `REINITIATE` / `REINITIATE_CDD`
7. `ACTIVE` -> terminal completion and client redirect
- CDD mock-complete in client MUST use dialog selection and post `mockDataType`; EDD mock-complete MUST keep direct `{ result: 'PASS' }`.
- In `PENDING_EDD`, client MUST require explicit `Start EDD` action to create session link when no valid QR link exists; client MUST NOT auto-start EDD session implicitly.
