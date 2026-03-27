# Onboarding Flow Constraints

## 1) Scope and Ownership
- Scope module: `src/modules/identity/onboarding/**`.
- Customer endpoints under `/onboarding/**`.
- Admin compliance endpoints under `/admin/compliance/**`.
- Customer and admin authority MUST remain separated by token type.
- This document follows current implementation names.
- Compliance `Case` domain semantics are defined by `docs/constraints/compliance-alert-case-foundation-constraints.md`.

## 1.1) Related Canonical Docs
- Workflow truth:
1. `docs/specs/workflows/onboarding-canonical-workflow.md`
2. `docs/specs/workflows/mlro-and-final-approval-governance.md`
3. `docs/specs/workflows/onboarding-periodic-review-audit-trace-contract.md`
- Entity truth:
1. `docs/specs/entities/customer-entity.md`
2. `docs/specs/entities/review-response-entity.md`
3. `docs/specs/entities/approval-case-entity.md`
- Module integration truth:
1. `docs/specs/modules/customer-onboarding-module.md`
2. `docs/specs/modules/compliance-center-module.md`
3. `docs/specs/modules/approvals-module.md`

## 2) Canonical Identities
- Onboarding domain MUST only use these identities:
1. `customer`
2. `cddResponse` (onboarding evidence container / provider response, not compliance `Case`)
3. `eddResponse` (onboarding evidence container / provider response, not compliance `Case`)
4. `workflowDecisionRecord`
5. `alert`
6. `case` (compliance investigation object; some historical physical/service names may still contain `incident` in normalization or archived cleanup context)
- Final approval MUST be approval-backed and projected back to customer lifecycle.
- Approval runtime semantics are defined by the approvals module; onboarding MUST consume approval result projection instead of directly inventing a separate final-review entity.
- Note:
1. `cddResponse / eddResponse / workflowDecisionRecord` are current physical/runtime names
2. operator-facing canonical naming is `CDD Response / EDD Response`
3. active admin/runtime contract uses `Case`; historical `incident` names are archived implementation residue only and MUST NOT be reintroduced as new external surface

## 3) Next-Step Contract
- `getNextStep` is the single source for onboarding guidance.
- Contract output MUST be:
1. `actions[]`
2. `blockedReason`
3. `activeCaseId`
4. `requiresEdd`
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
- Frontend MAY use `actions[]`, `blockedReason`, and `activeCaseId` from this contract, but onboarding primary state MUST be derived from canonical customer fields.

## 4) State Machine Constraints
- Customer lifecycle MUST stay progress-only:
1. `NONE -> PENDING_CDD_INPUT -> CDD_UNDER_REVIEW -> PENDING_EDD_INPUT -> EDD_UNDER_REVIEW -> FINAL_APPROVAL -> APPROVED`
- Customer terminal status MUST stay:
1. `REJECTED`
2. `WITHDRAWN`
- Canonical response lifecycle projection MUST stay:
1. `CREATED -> COMPLETED`
- Historical physical/internal persistence MAY still retain intermediate names such as `RECEIVED / FINAL` in migration, normalization, or archived cleanup context, but new external contracts MUST NOT expose them as canonical response lifecycle truth.
- DecisionRecord lifecycle MUST stay:
1. `CREATED -> COMPLETED | FAILED`
- State fields MUST express lifecycle progress only, not business decisions.

## 5) Risk Engine Constraints
- Risk decision domain MUST expose one entry:
1. `evaluate(contextType, subjectId, signals, policyVersion?)`
- Every evaluate call MUST persist one `workflowDecisionRecord`.
- DecisionRecord MUST be replayable with:
1. `contextType`
2. `policyVersion`
3. `inputHash`
4. input snapshot
5. output (`decision`, `recommendedActions`, `reasonCodes`)
- External CDD/EDD provider callback MUST be treated as evidence input only; final routing is decided by Risk Engine output mapping.

## 6) CDD/EDD Orchestration Constraints
- Starting onboarding MUST create or reuse active CDD evidence container (`cddResponse`) in `CREATED`.
- Session completion MUST store provider payload and complete the underlying onboarding evidence container evaluation.
- Historical physical/internal state names such as `RECEIVED -> FINAL` MAY still exist inside implementation or migration context, but operator-facing/runtime contract MUST continue to project response lifecycle as `CREATED -> COMPLETED`.
- CDD completion MUST evaluate risk and move customer to `CDD_UNDER_REVIEW` (container waiting for recommendation execution).
- CDD completion MUST create a pending `workflowDecisionRecord` and queue final CDD risk simulation for Admin `Risk Policy Executions`.
- EDD completion MUST evaluate risk and move customer to `EDD_UNDER_REVIEW` (container waiting for recommendation execution).
- Historical CDD `mockDataType` compatibility MAY remain in runtime internals, but it MUST NOT be treated as the active client UI contract:
1. `LOW_RISK` -> auto-pass onboarding to `APPROVED + ACTIVE` without creating/updating onboarding journey alert
2. `MEDIUM_RISK` / `HIGH_RISK_OR_PEP` -> create/update onboarding journey alert only
3. `SANCTION_AND_OTHER` -> create/update onboarding journey alert only
- Legacy compatibility for CDD mock completion MUST remain:
1. when `mockDataType` is missing and `result='FAIL'`, map to `SANCTION_AND_OTHER`
2. otherwise map to `LOW_RISK`
- Final approve/reject action MUST only be allowed from `FINAL_APPROVAL`.

## 7) Alert and Incident Integration
- Onboarding review signal MUST be upserted by journey key + stage (`customerId:journeyId + stage`) as one alert per review stage.
- EDD re-evaluation MUST use a dedicated `REVIEW_EDD` alert instead of rewriting the `REVIEW_CDD` alert.
- Alert/incident decision details MAY be written to filter fields (`decisionRecommendation`, `decision`) but MUST NOT change state-machine definition.
- Recommendation options MUST come from risk-engine output (`recommendedDecisions`) and be projected to alert/incident detail.
- Recommendation set contract MUST remain:
1. CDD review: `CLEAR`, `REJECT`, `REQUIRE_EDD`
2. EDD review: `CLEAR`, `REJECT`
- EDD-stage recommendation rendering MUST NOT show `REQUIRE_EDD` in alert or incident detail views.
- `REVIEW_CDD` stage MAY be progressed by assigned onboarding journey alert decision action:
1. `CLEAR` -> customer `APPROVED + ACTIVE`
2. `REJECT` -> customer `REJECTED`
3. `REQUIRE_EDD` -> create/reuse EDD evidence container (`eddResponse`) and move customer to `PENDING_EDD_INPUT`
- `REVIEW_EDD` stage MAY be progressed by assigned onboarding journey alert/incident decision action:
1. `CLEAR` -> customer `FINAL_APPROVAL`
2. `REJECT` -> customer `REJECTED`
- Alert/case decision MUST first write producer-side disposition/event, then delegate workflow mutation to onboarding workflow transition consumer.
- Onboarding workflow mutation MUST NOT be implemented as ad-hoc customer status updates scattered in alert/case handlers.
- Recommendation actions are intentionally repeat-callable at container level; illegal transitions MUST be blocked by onboarding stage validation.
- Alert workflow state (`ASSIGN/ESCALATE/CLOSE`) and onboarding recommendation actions MUST stay decoupled.

## 8) Trading Gate and Legacy Snapshot
- Trading eligibility gate MUST use canonical customer state:
1. `onboardingStatus = APPROVED`
2. `operatingStatus = ACTIVE`
3. `restrictionStatus != RESTRICTED`
4. `complianceHoldStatus != FROZEN`
- Legacy fields (`complianceStatus`, `cddStatus`, `eddStatus`) have been removed from customer schema/payload and MUST NOT be reintroduced as customer lifecycle truth.
- Reinitiation MUST only be available for rejected/withdrawn/expired scenarios.

## 9) Auditability (Mandatory)
- Canonical onboarding / periodic review audit store MUST be `audit_log_events`.
- `onboarding_audit_logs` is historical compatibility residue only and MUST NOT be treated as:
1. canonical source for trace queries
2. canonical source for evidence export
3. active runtime audit truth
- Workflow-bound onboarding trace root MUST remain:
1. `workflowType = ONBOARDING`
2. `workflowId = journeyId`
3. `workflowNo = journeyId`
4. `traceId = ONBOARDING:<journeyId>`
- Key onboarding actions MUST write canonical audit events with:
1. actor id/role
2. customer id
3. evidence container type/id when applicable
4. from/to stage when applicable
5. detail payload
- Canonical audit events for onboarding flow MUST also include:
1. `traceId`
2. `workflowType`
3. `workflowId`
4. `workflowNo`
5. `entityOwnerType/entityOwnerId/entityOwnerNo`
- `onboarding final approval` MUST inherit the same onboarding trace and MUST NOT generate a new random trace when created from onboarding flow.
- Decision transition actions MUST keep reason fields for audit and replay.

## 10) Thread Delivery Checklist (Onboarding)
- `getNextStep` contract changes explicitly versioned/documented when touched.
- Customer/case/decision transitions validated with tests.
- Risk Engine evaluate-to-record behavior validated.
- Alert/incident linkage validated for onboarding journey rules.
- Audit log records verified for critical actions.
- `Audit Center` trace query verified for onboarding flow when work touches:
1. response submit
2. alert
3. case
4. final approval
- Cross-module read-model stability verified for `GET /customers/:id` onboarding snapshot fields:
1. canonical customer status fields
2. `cddResponses`
3. `eddResponses`

## 11) Client Verification Projection Rules
- Client `/verification` UI MUST treat canonical customer fields as the primary onboarding state source.
- `getNextStep` MAY still be consumed for action guidance, `blockedReason`, and `activeCaseId`, but MUST NOT be treated as the primary onboarding state source.
- Client `/verification` MUST remain the customer-side evidence collection and mock-complete surface.
- Shared `Simulation Mode` MUST gate customer-side evidence collection and mock-complete actions on `/verification`.
- When shared `Simulation Mode` is disabled, `/verification` MUST NOT expose these customer-side simulation actions:
1. `Bootstrap CDD`
2. `Regenerate Session`
3. `Mock Complete CDD`
4. `Start EDD`
5. `Reinitiate CDD / EDD`
6. `Mock Complete EDD`
- Admin `CDD Response / EDD Response` pages MAY browse evidence detail, but MUST NOT introduce a second onboarding provider mock-complete surface.
- Projection baseline MUST keep these canonical mappings:
1. `onboardingStatus = NONE` -> `CDD` / `START_CDD`
2. `onboardingStatus = PENDING_CDD_INPUT` -> `CDD` / `COMPLETE_CDD`
3. `onboardingStatus = PENDING_EDD_INPUT` -> `EDD` / `COMPLETE_EDD`
4. `onboardingStatus = CDD_UNDER_REVIEW | EDD_UNDER_REVIEW` -> `WAIT_REVIEW` / `WAIT`
5. `onboardingStatus = FINAL_APPROVAL` -> `WAIT_REVIEW` / `WAIT`
6. `onboardingStatus = REJECTED | WITHDRAWN` -> `REINITIATE` / `REINITIATE_CDD`
7. `onboardingStatus = APPROVED` and `operatingStatus = ACTIVE` -> terminal completion and client redirect
- Final `ONBOARDING_CDD` risk simulation MUST be executed from Admin `Risk Policy Executions`, not from a client-side risk selection dialog.
- CDD mock-complete in client MUST submit session completion without client-side risk selection; `mockDataType` is retained compatibility only and is not the active UI contract.
- EDD mock-complete MUST keep direct `{ result: 'PASS' }`.
- In `PENDING_EDD`, client MUST require explicit `Start EDD` action to create session link when no valid QR link exists; client MUST NOT auto-start EDD session implicitly.
