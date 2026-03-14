# Compliance Alert & Incident Constraints (`risk-engine/compliance-alerts` + `risk-engine/compliance-incidents`)

## 1) Scope and Ownership
- MUST cover compliance alert and incident lifecycle only.
- MUST apply to:
1. backend modules `src/modules/risk-engine/compliance-alerts/**`
2. backend modules `src/modules/risk-engine/compliance-incidents/**`
3. admin pages `/dashboard/compliance/alerts` and `/dashboard/compliance/incidents`
- MUST enforce admin-only operations for incident and alert admin APIs.

## 2) Alert Lifecycle Constraints
- Alert status machine MUST remain:
1. `OPEN`
2. `ASSIGNED`
3. `ESCALATED`
4. `CLOSED`
- Closed status MUST be terminal.
- Alert action constraints MUST remain:
1. `OPEN` -> `ASSIGN` / `ESCALATE` / `CLOSE`
2. `ASSIGNED` -> `ASSIGN` / `UNASSIGN` / `ESCALATE` / `CLOSE`
3. `ESCALATED` -> `ESCALATE` / `CLOSE`
4. `CLOSED` -> no action
- Required fields MUST be enforced:
1. `ESCALATE`: `reason`
2. `CLOSE`: `reason`
- Assignee execution rule MUST be enforced for sensitive actions:
1. when status is `ASSIGNED` or `ESCALATED`, `ESCALATE` and `CLOSE` MUST be executed by current `assigneeUserId`
2. admin UI and backend service MUST apply the same restriction logic
- Reassign guard MUST be enforced:
1. when status is `ASSIGNED`, changing assignee (`ASSIGN` to a different user) MUST be performed by current `assigneeUserId`
2. non-assignee reassign attempts MUST be rejected by backend with `403`
- Recommendation execution rule for onboarding container flow MUST be:
1. recommendation buttons are rendered from risk-engine output (`recommendedDecisions`)
2. recommendation execution MAY be invoked multiple times in UI/API
3. actual transition validity MUST be enforced by onboarding state-machine checks (illegal stage transition returns `400/409`)
- Incident recommendation projection priority for onboarding flow MUST be:
1. primary alert latest `metadata.recommendedDecisions`
2. primary alert `decisionRecommendation` fallback
3. incident metadata snapshot as final fallback only
- EDD-stage recommendation rendering MUST NOT contain `REQUIRE_EDD` in either alert or incident detail views.
- Alert dedupe key MUST stay `ruleCode:sourceType:sourceId[:stage]`.
- When same dedupe key hits a closed alert, implementation MUST create a new alert row and rotate old dedupe key archive suffix.

## 3) Incident Lifecycle Constraints
- Incident status machine MUST remain:
1. `OPEN`
2. `ASSIGNED`
3. `CLOSED`
- Closed status MUST be terminal.
- Legacy `RESOLVED` data MAY exist for read compatibility, but MUST NOT be produced by new workflow transitions.
- Incident action constraints MUST remain:
1. `OPEN` -> `ASSIGN` / `LINK_ALERT`
2. `ASSIGNED` -> `ASSIGN` / `CLOSE` / `LINK_ALERT`
3. `CLOSED` -> no action
- Required fields MUST be enforced:
1. `CLOSE`: `reason`
- Incident assignee role whitelist MUST be enforced:
1. assign/reassign target MUST be `SUPER_ADMIN` or `MLRO`
2. in `ASSIGNED`, reassign and close MUST be executed by current assignee
- Incident close MUST cascade close all linked alerts in `OPEN/ASSIGNED/ESCALATED`.

## 4) Alert to Incident Escalation Constraints
- Incident creation in V1 MUST be manual from alert escalation:
1. `POST /admin/compliance/incidents/from-alert/:alertId`
- Explicit exception (mock only): CDD mock `SANCTION_AND_OTHER` MAY auto-run escalation by system actor:
1. system escalates alert
2. system creates incident from alert with recommended actions metadata
- This exception MUST stay limited to CDD mock flow for demo/testing, and MUST NOT override production manual-escalation policy.
- Escalation MUST be transactional and atomic:
1. alert transitions to `ESCALATED`
2. incident row is created with `status=OPEN`
3. primary relation row is created in `compliance_incident_alerts`
4. incident metadata SHOULD inherit recommendation payload from source alert when available (`recommendedActions` / `recommendedDecisions`)
- One alert MUST belong to at most one incident (`alertId` global unique in relation table).
- One incident MAY aggregate multiple alerts (`PRIMARY` + `RELATED`).

## 5) Decision and Evidence Fields
- Alert and incident may persist filter fields:
1. `decisionRecommendation` / `decision`
2. `linkedCaseIds`
3. `decisionRecordIds`
- These fields are for filtering/readability and MUST NOT change state-machine semantics.

## 6) Data Model Constraints
- Canonical incident tables MUST be:
1. `compliance_incidents`
2. `compliance_incident_alerts`
3. `compliance_incident_events`
- `compliance_incident_alerts` MUST enforce:
1. unique `(incidentId, alertId)`
2. unique `alertId`
- Retention MUST stay aligned with alert/audit baseline: `retainedUntil = baseTime + 8 years`.

## 7) API Contract Constraints
- Alert admin APIs MUST remain:
1. `GET /admin/compliance/alerts`
2. `GET /admin/compliance/alerts/:id`
3. `PATCH /admin/compliance/alerts/:id/action`
4. `POST /admin/compliance/alerts/simulate`
5. `POST /admin/compliance/alerts/:id/onboarding-decision`
- Incident admin APIs MUST remain:
1. `GET /admin/compliance/incidents`
2. `GET /admin/compliance/incidents/:id`
3. `PATCH /admin/compliance/incidents/:id/action`
4. `POST /admin/compliance/incidents/from-alert/:alertId`
5. `POST /admin/compliance/incidents/:id/alerts`
6. `POST /admin/compliance/incidents/:id/onboarding-decision`
- List responses MUST stay machine-parsable `{ total, skip, take, items[] }`.
- Detail responses MUST include timeline events, linked relation records, and risk recommendation projection (`recommendedDecisions` where applicable).
- Alert/incident orchestration changes MUST NOT break customer-detail read model availability (`GET /customers/:id` MUST remain queryable without schema-invalid include/select).

## 8) Audit Logging Constraints (Alert/Incident)
- All alert/incident writes MUST go through `AuditLogsService`.
- MUST use centralized constants in `audit-actions.constant.ts` for:
1. module (`COMPLIANCE_ALERTS`, `COMPLIANCE_INCIDENTS`)
2. entity type (`COMPLIANCE_ALERT`, `COMPLIANCE_INCIDENT`)
3. action names (`ALERT_*`, `INCIDENT_*`)
- Trigger type contract MUST stay:
1. create escalation incident: `DATA_CREATE`
2. status/action updates: `DATA_UPDATE`
- Action names MUST stay `UPPER_SNAKE_CASE`.

## 9) Admin UI Constraints
- Compliance Center menu MUST include:
1. `Alerts`
2. `Incidents`
- Action buttons MUST be status-aware and hidden/disabled for terminal states.
- UI MUST prevent duplicate submissions while action request is in-flight.
- Escalate action in alerts UI MUST create incident (not only set alert status).

## 10) Thread Delivery Checklist (Alert/Incident)
- Status/action matrix changed? -> backend + frontend + tests all updated.
- Relation change? -> transaction behavior verified.
- API shape change? -> DTO + controller + page contract aligned.
- Audit action/module/entity constants aligned with service writes.
- Build and targeted tests pass for alert and incident modules.
- Cross-module smoke check confirms admin customer detail (`GET /customers/:id`) remains `200` after alert/incident flow changes.
