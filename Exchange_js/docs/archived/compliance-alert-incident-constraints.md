> **DEPRECATED** — This document describes logic that has been removed or replaced.
> Archived on 2026-04-11. Wave 2 compliance content moved to Sumsub.
>
> Replacement: Wave 2 compliance domain fully migrated to Sumsub integration.

# Compliance Alert & Incident Constraints (`risk-engine/compliance-alerts` + `risk-engine/compliance-incidents`, Current Runtime Case Surface)

## 0) Positioning in Wave 2
- This document defines CURRENT V1 runtime constraints for the existing alert + incident implementation.
- Domain-semantic baseline for `Wave 2` MUST follow `docs/constraints/compliance-alert-case-foundation-constraints.md`.
- In this file, `incident` means the current internal implementation/storage name that now serves canonical compliance `Case`.
- If a future change needs to choose between:
1. domain naming
2. current runtime implementation detail
  use:
1. `compliance-alert-case-foundation-constraints.md` for domain semantics
2. this file for current runtime implementation boundaries
- External admin/customer contracts MUST use canonical `Case` semantics; this file MUST NOT be read as approval to keep `incident` as an active public contract term.

## 1) Scope and Ownership
- MUST cover current compliance alert implementation plus the active runtime case surface exposed as canonical compliance `Case`.
- MUST apply to:
1. backend modules `src/modules/risk-engine/compliance-alerts/**`
2. backend modules `src/modules/risk-engine/compliance-incidents/**`
3. admin pages `/dashboard/compliance/alerts` and `/dashboard/compliance/cases`
4. historical retired `/dashboard/compliance/incidents` redirect context when reading archived cleanup threads
- MUST enforce admin-only operations for current alert and case admin APIs.

## 1.1) Related Canonical Docs
- Workflow truth:
1. `docs/specs/workflows/alert-triage-and-case-escalation.md`
2. `docs/specs/workflows/case-final-lifecycle-and-external-filing.md`
3. `docs/specs/workflows/mlro-and-final-approval-governance.md`
- Entity truth:
1. `docs/specs/entities/compliance-alert-entity.md`
2. `docs/specs/entities/compliance-case-entity.md`
3. `docs/specs/entities/compliance-case-report-entity.md`
4. `docs/specs/entities/compliance-external-filing-entity.md`
5. `docs/specs/entities/approval-case-entity.md`
6. `docs/specs/entities/risk-decision-record-entity.md`
- Module integration truth:
1. `docs/specs/modules/compliance-center-module.md`
2. `docs/specs/modules/risk-engine-module.md`
3. `docs/specs/modules/approvals-module.md`

## 2) Alert Lifecycle Constraints
- Alert status machine MUST remain:
1. `OPEN`
2. `ASSIGNED`
3. `ESCALATED`
4. `CLOSED`
- Closed status MUST be terminal.
- Current runtime MUST expose one canonical alert interaction surface:
1. `Alert Handling`
- For workflow-bound alerts, `Alert Handling` MUST remain:
1. `ASSIGN`
2. `REASSIGN`
3. `FALSE_POSITIVE`
4. `DIRECT_DISPOSITION`
5. `ESCALATE_TO_CASE`
- `DIRECT_DISPOSITION` proposal sets MUST remain:
1. onboarding / periodic review `REVIEW_CDD`: `REJECT`, `REQUIRE_EDD`
2. onboarding / periodic review `REVIEW_EDD`: `REJECT`
3. deposit review alerts: `REJECT`, `FREEZE_TRANSACTION`
- Generic `CLOSE` MUST NOT be exposed for workflow-bound alerts.
- `NO_ACTION` MUST NOT be exposed for workflow-bound alerts.
- `FALSE_POSITIVE` on workflow-bound alerts MUST auto-resolve through canonical workflow callback logic while preserving distinct alert outcome semantics.
- `FALSE_POSITIVE` MUST NOT require analyst-side proposal selection.
- `DIRECT_DISPOSITION` MUST apply only to the fixed primary object bound to the alert type.
- `ESCALATE_TO_CASE` MUST remain triage-only and MUST NOT advance onboarding workflow.
- Alert handling read model and UI visibility MUST align with backend executor guard.
- Resolution actions for workflow-bound alerts MUST only be exposed when:
1. status is `ASSIGNED`
2. current actor is the current assignee
- Case recommendation projection priority for onboarding flow MUST be:
1. primary alert latest `metadata.recommendedDecisions`
2. primary alert `decisionRecommendation` fallback
3. case metadata snapshot as final fallback only
- EDD-stage recommendation rendering MUST NOT contain `REQUIRE_EDD` in either alert or case detail views.
- Alert dedupe key MUST stay `ruleCode:sourceType:sourceId[:stage]`.
- When same dedupe key hits a closed alert, implementation MUST create a new alert row and rotate old dedupe key archive suffix.

## 3) Case Lifecycle Constraints (Current Runtime on `compliance_incidents*`)
- Canonical case status machine MUST remain:
1. `OPEN`
2. `ASSIGNED`
3. `INVESTIGATING`
4. `PENDING_MLRO_REVIEW`
5. `CLOSED`
- Closed status MUST be terminal.
- Legacy `RESOLVED` data MAY exist for read compatibility, but MUST NOT be produced by new workflow transitions.
- Current runtime MUST distinguish:
1. `Case Actions`
2. `Interim Measures`
3. `Workflow Proposal`
4. `MLRO Review`
- Current standard `Case Actions` MUST remain:
1. `ASSIGN`
2. `REASSIGN`
3. `LINK_ALERT`
- Current standard `Interim Measures` MUST remain:
1. `FREEZE`
2. `UNFREEZE`
3. `RESTRICT`
4. `UNRESTRICT`
- Current standard `Workflow Proposal` MUST remain:
1. `CLEAR`
2. `REJECT`
3. `REQUIRE_EDD`
- Current standard `MLRO Review` MUST remain:
1. `RETURN_FOR_INVESTIGATION`
2. `APPROVE_FINAL_DISPOSITION`
- Direct generic case actions MUST NOT be standard runtime paths for:
1. `CLOSE`
2. `FALSE_POSITIVE`
3. `REPORT`
- `FALSE_POSITIVE` and `REPORT` now belong to case proposal / final-disposition semantics and MUST pass through finalized report + MLRO review.
- `INVESTIGATING -> PENDING_MLRO_REVIEW` MUST require:
1. a finalized current report
2. a proposed final disposition
3. a proposed workflow decision for workflow-bound cases
- `PENDING_MLRO_REVIEW -> CLOSED` MUST occur only through approved MLRO review.
- `RETURN_FOR_INVESTIGATION` MUST move the case back to `INVESTIGATING`.
- Case assignee role whitelist MUST be enforced:
1. assign/reassign target MUST be `SUPER_ADMIN` or `COMPLIANCE_LEAD` or `MLRO`
2. investigator-side proposal and measure actions MUST be executed by current assignee
- Workflow-bound case proposal endpoints MUST NOT execute workflow transition immediately; they only write proposal state.
- MLRO approval is the point where:
1. final disposition becomes effective
2. workflow-bound transition executes
3. case closes
- Current runtime defines an independent external filing lifecycle and MUST treat it as the canonical filing model.
- `reportStatus = NOT_REPORTED / REPORTED`, `reportRefNo`, `reportedAt`, and `reportReason` remain compatibility mirror fields only and MUST NOT be interpreted as report draft/finalize state or canonical filing truth.
- Compatibility-only legacy filing rows MAY remain stored for historical explanation, but MUST NOT drive canonical `currentFiling`, `filingStatus`, or filing actions.
- Current runtime persistence MUST include `caseType` with minimum taxonomy:
1. `ONBOARDING`
2. `PERIODIC_REVIEW`
2. `TRANSACTION`
3. `GENERIC`

## 4) Alert to Case Escalation Constraints
- Canonical case creation MUST be manual from alert escalation:
1. `POST /admin/compliance/cases/from-alert/:alertId`
- Upstream modules MUST NOT auto-create case records outside the alert triage workflow.
- Escalation MUST be transactional and atomic:
1. alert transitions to `ESCALATED`
2. case row is created with `status=OPEN`
3. primary relation row is created in `compliance_incident_alerts`
4. case metadata SHOULD inherit recommendation payload from source alert when available (`recommendedActions` / `recommendedDecisions`)
- One alert MUST belong to at most one case relation (`alertId` global unique in relation table).
- One case MAY aggregate multiple alerts (`PRIMARY` + `RELATED`).
- This relation is the current runtime implementation of canonical `Alert -> Case` escalation.

## 5) Decision and Evidence Fields
- Alert and case may persist filter fields:
1. `decisionRecommendation` / `decision`
2. `linkedCaseIds`
3. `decisionRecordIds`
- These fields are for filtering/readability and MUST NOT change state-machine semantics.

## 6) Data Model Constraints
- Canonical CURRENT implementation tables MUST be:
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
5. `POST /admin/compliance/alerts/:id/resolve`
- Public `PATCH /admin/compliance/alerts/:id/action` payload MUST stay work-item-only:
1. `action`
2. `assigneeUserId`
3. optional `reason`
- Public `PATCH /admin/compliance/alerts/:id/action` MUST NOT remain a public carrier for legacy workflow/disposition payload fields.
- Canonical case admin APIs MUST remain:
1. `GET /admin/compliance/cases`
2. `GET /admin/compliance/cases/:id`
3. `PATCH /admin/compliance/cases/:id/action`
4. `POST /admin/compliance/cases/from-alert/:alertId`
5. `POST /admin/compliance/cases/:id/alerts`
6. `POST /admin/compliance/cases/:id/onboarding-decision`
7. `POST /admin/compliance/cases/:id/periodic-review-decision`
8. `PUT /admin/compliance/cases/:id/report/draft`
9. `POST /admin/compliance/cases/:id/report/finalize`
10. `POST /admin/compliance/cases/:id/report/submit-to-mlro`
11. `POST /admin/compliance/cases/:id/mlro-review`
- `Phase 2` final closure retires `/admin/compliance/incidents/**`; `/cases/**` is now the only active runtime surface.
- List responses MUST stay machine-parsable `{ total, skip, take, items[] }`.
- Detail responses MUST include timeline events, linked relation records, and risk recommendation projection (`recommendedDecisions` where applicable).
- Current alert detail responses MUST expose:
1. `primaryObject`
2. `availableHandlingActions`
3. `availableDirectProposals`
- Case responses MUST expose canonical fields such as:
1. `caseNo`
2. `caseType`
3. `assigneeUserId`
4. `assigneeUserNo`
- Canonical case list / detail primary presentation MUST default to:
1. `caseNo`
2. `assigneeUserId`
3. `assigneeUserNo`
4. `filingStatus`
- Compatibility fields such as legacy `incidentNo / owner* / report*` MUST NOT remain in active case list/detail contract after final closure.
- Canonical filing read-model fields such as `currentFiling`, `filingHistory`, and `availableFilingActions` MUST be derived only from canonical filing rows, not from compatibility-only legacy backfill residuals.
- Current case detail responses MUST expose:
1. `availableCaseActions`
2. `availableInterimMeasures`
3. workflow-proposal action set required by the current admin page
4. `availableMlroActions`
5. proposal / MLRO review snapshots needed by the current admin page
- Alert/case orchestration changes MUST NOT break customer-detail read model availability (`GET /customers/:id` MUST remain queryable without schema-invalid include/select).

## 8) Audit Logging Constraints (Alert/Case Runtime)
- All alert/case writes MUST go through `AuditLogsService`.
- `audit_log_events` MUST remain the canonical audit store for current alert/case runtime.
- When alert/case is workflow-bound, alert/case writes MUST carry workflow trace context:
1. `traceId`
2. `workflowType`
3. `workflowId`
4. `workflowNo`
- MUST use centralized constants in `audit-actions.constant.ts` for:
1. module (`COMPLIANCE_ALERTS`, `COMPLIANCE_INCIDENTS`)
2. entity type (`COMPLIANCE_ALERT`, `COMPLIANCE_INCIDENT`)
3. action names (`ALERT_*`, `INCIDENT_*`)
- Audit taxonomy MAY keep `INCIDENT_*` compatibility constants during `Wave 2`, even when UI/API semantics use `Case`.
- Historical physical/service/module names MAY still include `incident` in storage, migrations, or archived cleanup context, but `/cases/**` is the only active runtime surface and new external integrations MUST use case semantics.
- Trigger type contract MUST stay:
1. create escalation case: `DATA_CREATE`
2. status/action updates: `DATA_UPDATE`
- Action names MUST stay `UPPER_SNAKE_CASE`.
- Trace root for workflow-bound runtime MUST stay:
1. onboarding: `ONBOARDING:<journeyId>`
2. periodic review: `PERIODIC_REVIEW:<cycle.id>`
- `ESCALATE_TO_CASE`, `MLRO_SUBMITTED`, `APPROVE_FINAL_DISPOSITION`, `FILING_SUBMITTED`, and downstream approval/filing follow-up MUST continue the same upstream workflow trace rather than minting a new random trace.
- For onboarding `REVIEW_EDD -> CLEAR -> FINAL_APPROVAL`, the approval object MUST inherit the same onboarding trace used by the upstream alert/case chain.

## 9) Admin UI Constraints
- Compliance Center menu MUST include:
1. `Alerts`
2. `Cases`
- `/dashboard/compliance/incidents` is retired from active runtime and MUST NOT be reintroduced as a production navigation surface.
- Alert page MUST expose:
1. a fixed `Primary Object` card
2. a single `Alert Handling` section
- Case page MUST distinguish:
1. `Case Actions`
2. `Interim Measures`
3. `Workflow Proposal`
4. `MLRO Review`
- Action buttons MUST be status-aware and hidden/disabled for terminal states.
- `OPEN` alert UI MUST expose only assignment handling.
- `ASSIGNED` alert UI MUST expose resolution handling only to the current assignee.
- Non-assignee viewers MUST see workflow-bound alert detail as read-only.
- UI MUST prevent duplicate submissions while action request is in-flight.
- Escalate action in alerts UI MUST create case (not only set alert status).
- Alert triage permissions MUST remain separate from investigation permissions:
1. `ALERT_READ / ALERT_WRITE`
2. `CASE_READ / CASE_WRITE`
- Current runtime UI MUST NOT interpret:
1. `NOT_REPORTED` as “report still draft”
2. `REPORTED` as “report merely finalized”
3. `REPORT` as a direct investigator-side case action

## 10) Thread Delivery Checklist (Alert/Case Runtime)
- Status/action matrix changed? -> backend + frontend + tests all updated.
- Relation change? -> transaction behavior verified.
- API shape change? -> DTO + controller + page contract aligned.
- Audit action/module/entity constants aligned with service writes.
- Build and targeted tests pass for alert and case runtime modules.
- Cross-module smoke check confirms admin customer detail (`GET /customers/:id`) remains `200` after alert/case flow changes.
