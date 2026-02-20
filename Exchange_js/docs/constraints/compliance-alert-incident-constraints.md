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
1. `NEW`
2. `ASSIGNED`
3. `IN_REVIEW`
4. terminal: `ESCALATED` / `RESOLVED` / `FALSE_POSITIVE`
- Alert terminal states MUST NOT support `REOPEN`.
- Alert action constraints MUST remain:
1. `NEW` -> `ASSIGN`
2. `ASSIGNED` -> `ASSIGN` / `START_REVIEW` / `ESCALATE` / `MARK_FALSE_POSITIVE`
3. `IN_REVIEW` -> `ASSIGN` / `RESOLVE` / `ESCALATE` / `MARK_FALSE_POSITIVE`
4. terminal -> no action
- Alert dedupe key MUST stay `ruleCode:sourceType:sourceId[:stage]`.
- When same dedupe key hits terminal alert, implementation MUST create a new alert row (no reopen), and MUST rotate old dedupe key archive suffix.

## 3) Incident Lifecycle Constraints
- Incident status machine MUST remain:
1. `NEW`
2. `ASSIGNED`
3. `INVESTIGATING`
4. `RESOLVED`
5. terminal: `CLOSED` / `FALSE_POSITIVE`
- Incident terminal states MUST NOT support `REOPEN`.
- Incident action constraints MUST remain:
1. `NEW` -> `ASSIGN` / `MARK_FALSE_POSITIVE`
2. `ASSIGNED` -> `ASSIGN` / `START_INVESTIGATION` / `MARK_FALSE_POSITIVE`
3. `INVESTIGATING` -> `ASSIGN` / `MARK_RESOLVED` / `MARK_FALSE_POSITIVE`
4. `RESOLVED` -> `CLOSE`
5. terminal -> no action
- Required fields MUST be enforced:
1. `MARK_RESOLVED`: `reason`, `rootCauseCategory`, `resolutionSummary`
2. `CLOSE`: `reason` and `closureChecklist` with at least 3 items
3. `MARK_FALSE_POSITIVE`: `reason`

## 4) Alert to Incident Escalation Constraints
- Incident creation in V1 MUST be manual from alert escalation only:
1. `POST /admin/compliance/incidents/from-alert/:alertId`
- Escalation MUST be transactional and atomic:
1. alert transitions to terminal `ESCALATED`
2. incident row is created with `status=NEW`
3. primary relation row is created in `compliance_incident_alerts`
- One alert MUST belong to at most one incident (`alertId` global unique in relation table).
- One incident MAY aggregate multiple alerts (`PRIMARY` + `RELATED`).

## 5) Data Model Constraints
- Canonical incident tables MUST be:
1. `compliance_incidents`
2. `compliance_incident_alerts`
3. `compliance_incident_events`
- `compliance_incidents.primaryAlertId` SHOULD be unique when present.
- `compliance_incident_alerts` MUST enforce:
1. unique `(incidentId, alertId)`
2. unique `alertId`
- Retention MUST stay aligned with alert/audit baseline: `retainedUntil = baseTime + 8 years`.

## 6) API Contract Constraints
- Alert admin APIs MUST remain:
1. `GET /admin/compliance/alerts`
2. `GET /admin/compliance/alerts/:id`
3. `PATCH /admin/compliance/alerts/:id/action`
4. `POST /admin/compliance/alerts/simulate`
- Incident admin APIs MUST remain:
1. `GET /admin/compliance/incidents`
2. `GET /admin/compliance/incidents/:id`
3. `PATCH /admin/compliance/incidents/:id/action`
4. `POST /admin/compliance/incidents/from-alert/:alertId`
5. `POST /admin/compliance/incidents/:id/alerts`
- List responses MUST stay machine-parsable `{ total, skip, take, items[] }`.
- Detail responses MUST include timeline events and linked relation records.

## 7) Audit Logging Constraints (Alert/Incident)
- All alert/incident writes MUST go through `AuditLogsService`.
- MUST use centralized constants in `audit-actions.constant.ts` for:
1. module (`COMPLIANCE_ALERTS`, `COMPLIANCE_INCIDENTS`)
2. entity type (`COMPLIANCE_ALERT`, `COMPLIANCE_INCIDENT`)
3. action names (`ALERT_*`, `INCIDENT_*`)
- For alert/incident domain actions, trigger type MUST follow current implementation contract:
1. create escalation incident: `DATA_CREATE`
2. status/action updates: `DATA_UPDATE`
- Action names MUST stay `UPPER_SNAKE_CASE`.

## 8) Admin UI Constraints
- Compliance Center menu MUST include:
1. `Alerts`
2. `Incidents`
3. `Audit Logs`
- Action buttons MUST be status-aware and hidden/disabled for terminal states.
- UI MUST prevent duplicate submissions while action request is in-flight.
- Escalate action in alerts UI MUST create incident (not only set alert status).

## 9) Thread Delivery Checklist (Alert/Incident)
- Status/action matrix changed? -> backend + frontend + tests all updated.
- Any relation change? -> transaction behavior verified.
- Any API shape change? -> DTO + controller + page contract aligned.
- Audit action/module/entity constants aligned with service writes.
- Build and targeted tests pass for:
1. alert service/controller
2. incident service/controller
3. related compliance trigger modules
