# Audit Logging Rules
Last Updated: 2026-04-30 | Scope: Wave 1–4 | Source: docs/constraints/audit-logging-constraints.md, audit-trace-context-constraints.md

---

## Injection & Service Usage

- Must inject `AuditLogsService` via NestJS DI — never instantiate with `new`.
- Must route all new audit writes through `AuditLogsService`; no ad-hoc table writes in feature modules.
- Must use `recordByActor()` for human/API-triggered actions and `recordSystem()` for jobs/orchestrators.
- Canonical implementation lives in `src/modules/risk-engine/audit-logs`.
- Must keep action/entity/workflow-type dictionaries centralized in `constants/audit-actions.constant.ts` (`AuditActions`, `AuditGovernanceActions`, `AuditEntityTypes`, `AuditWorkflowTypes`, `AuditBusinessWorkflowTypes`). Note: `AuditModules` constant still exists for legacy reference but the `module` field has been removed from `audit_log_events` — do not pass it to `recordByActor`/`recordSystem`.

## Required Fields

- `workflowType`: always required; must come from `AuditWorkflowTypes` or `AuditBusinessWorkflowTypes`; never null; never derived lazily from action name at write time.
- `action`: required; must match `/^[A-Z0-9]+(?:_[A-Z0-9]+)*$/` (UPPER_SNAKE_CASE).
- `traceId`: strongly recommended on every row; must be a valid UUID v4 when set; omit only for truly standalone non-sequence events.

## Forbidden Fields

- `workflowId` and `workflowNo` are **not** columns on `audit_log_events` — they were removed 2026-04-08.
- `module` is **not** a column on `audit_log_events` — removed 2026-04-29. Do not pass `module:` in any `recordByActor`/`recordSystem` call.
- `triggerType` is **not** a column on `audit_log_events` — removed 2026-04-30. Do not pass `triggerType:` in any `recordByActor`/`recordSystem` call.
- Must never set `workflowId` or `workflowNo` in `recordByActor` / `recordSystem` payloads.
- Must never propagate an `auditContext` object containing `workflowId` or `workflowNo`; service-to-service context must only carry `{ workflowType, traceId }`.

## action Naming Conventions

- State transition actions: `<ENTITY>_<FROM_STATUS>_TO_<TO_STATUS>` (except approved allowlist).
- Manual actions: must start with `MANUAL_`.
- System actions: must start with `SYSTEM_`.
- Compliance alert/incident actions: use domain names (`ALERT_*`, `INCIDENT_*`) — not `MANUAL_*` / `SYSTEM_*`.

## Governance Action Naming Convention

Governance workflow actions use SHORT_UPPERCASE values stored under `AuditGovernanceActions.<WORKFLOW>.*`:

- **Initiation**: `<DOMAIN>_REQUESTED` — covers both record creation and approval submission (one log, not two)
- **Approval decisions** (shared across workflows): `APPROVAL_GRANTED`, `APPROVAL_DECLINED`, `APPROVAL_CANCELLED`
- **Execution results**: past-tense verb (e.g., `ACCOUNT_ACTIVATED`, `ACCOUNT_SUSPENDED`, `CHANGE_APPLIED`, `PACKAGE_PURGED`)
- **System events**: `<DOMAIN>_EXPIRED` (e.g., `INVITE_LINK_EXPIRED`)

Workflows are distinguished by `workflowType` field, not by action name prefix.
Reference implementation: `AuditGovernanceActions.AUDIT_EVIDENCE_EXPORT.*` in `audit-actions.constant.ts`.

## When Audit Log MUST Be Written

A feature or workflow is **not delivery-complete** without audit coverage for every:
- New feature with durable state.
- New workflow or key state transition.
- Automatic block / deny action (silent blocking without audit is forbidden).
- Repair action (must capture: actor, reason, target subject, result).
- Evidence package export (must append an audit event with `action=PACKAGE_EXPORTED` or equivalent governance action).
- Provider callback side effect.

P0 domains that must have unified write path coverage:
- Auth login chain
- Transaction compliance (KYT / Travel Rule)
- Compliance alert and incident lifecycle
- Config center changes
- Wallet master data
- Customer master data
- Swap Quote lifecycle
- Governance change ticket and release gate lifecycle

## traceId Propagation Rules

- **Format:** raw UUID v4, no prefix, no business-field embedding — generate via `randomUUID()` from `node:crypto`.
- **One trace per sequence:** every business sequence has exactly one `traceId`; all audit rows in that sequence share it.
- **Generate at the entry point:** the owning service generates the `traceId` when the primary entity is first created and persists it on the entity row (e.g. `change_tickets.traceId`, `approval_cases.traceId`, `delete_requests.traceId`, `customer_main.onboardingTraceId`).
- **Inherit, never re-generate:** sub-actions always read the parent entity's `traceId` and pass it through — they never mint a new one.
- **Parent pointer in metadata:** when a child action's `entityId` differs from the root sequence's primary entity, the row's `metadata` should include `{ parentEntityType, parentEntityId, parentEntityNo }` — but sequence queries must use `WHERE traceId = X`, not metadata joins.

## Data Model Invariants

- Write table for new traffic: `audit_log_events` only; must stop adding new writes to legacy domain audit tables.
- `actorNo` non-null → at least one `ACTOR` subject row in `audit_log_subject_nos` with the same No must exist.
- `entityOwnerNo` non-null → at least one `OWNER` subject row must exist.
- `metadata`, `beforeData`, `afterData` must be recursively masked before DB persistence; sensitive keys (`password`, `token`, `secret`, `privateKey`, `authorization`) masked as `***`.
- `payloadDigest` must be computed from normalized masked payload.
- `retainedUntil` must be set to `occurredAt + 8 years` on every write.
- `idempotencyKey` unique semantics must support idempotent retry.

## Evidence Package

- Export as single JSON file: `manifest + records + digest`.
- Digests computed with SHA-256 per record and for the package.
- Must persist one row in `audit_evidence_packages` per export execution.
- Export must be approval-backed (`AUDIT_EVIDENCE_EXPORT_APPROVAL`); the legacy direct bypass path must not remain callable once approval-backed flow is active.
- Exported `records` must be typed, masked event records — not a raw payload dump.

## Query Contract

- `GET /admin/audit-logs` must support exact filters: `subjectNo`, `subjectType`, `actorNo`, `entityOwnerNo`.
- `keyword` search must stay complementary — must not replace exact No filters.
- `subjectNo` lookup path must remain distinct from `traceId + workflowType` lookup; the two query families must not be merged.
- `GET /admin/audit-logs/:id` must include `subjectNos[]` in response.
- Admin UI must keep No-first retrieval as default operator workflow.
