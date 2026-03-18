# Audit Logging Constraints (`risk-engine/audit-logs`)

## Scope and Ownership
- MUST treat unified audit logging as a cross-domain capability spanning:
1. `identity`
2. `risk-engine`
3. `trading`
4. `asset-treasury`
5. `accounting`
6. `clearing-settle`
7. `governance`
8. `orchestrators`
- MUST keep canonical implementation under `/Users/songshengwei/Documents/codex/projects/重做版/Exchange_js/src/modules/risk-engine/audit-logs`.
- MUST route all new audit writes through `AuditLogsService` (no ad-hoc table writes in feature modules).
- SHOULD keep module/action/entity dictionaries centralized in `constants/audit-actions.constant.ts`.

## Canonical Data Model Constraints
- MUST use `audit_log_events` as the canonical write table for new audit traffic.
- MUST maintain `audit_evidence_packages` for export traceability.
- MUST maintain `audit_log_subject_nos` as the multi-subject No detail table.
- MUST keep `actorNo` and `entityOwnerNo` in `audit_log_events` synchronized with `audit_log_subject_nos`:
1. when `actorNo` is non-null, at least one `ACTOR` subject row with the same No MUST exist
2. when `entityOwnerNo` is non-null, at least one `OWNER` subject row with the same No MUST exist
3. when `entityNo` is non-null, at least one `ENTITY` subject row SHOULD exist
- MUST preserve governance fields on each event: `idempotencyKey`, `payloadDigest`, `maskVersion`, `retainedUntil`.
- SHOULD persist `entityNo`, `entityOwnerType`, `entityOwnerId`, `requestId`, `sourcePlatform` whenever available.

## Trigger and Action Normalization Constraints
- MUST normalize `triggerType` by deterministic order:
1. `EVIDENCE_EXPORT`
2. `STATE_TRANSITION`
3. `MANUAL_OVERRIDE`
4. `AUTH_EVENT`
5. `PERMISSION_CHANGE`
6. `CONFIG_CHANGE`
7. `DATA_CREATE`
8. `DATA_UPDATE`
9. `DATA_DELETE`
10. `SYSTEM_EVENT`
- MUST keep `action` in `UPPER_SNAKE_CASE`.
- STATE transition actions MUST follow `<ENTITY>_<FROM_STATUS>_TO_<TO_STATUS>` (except approved allowlist).
- MANUAL actions MUST start with `MANUAL_`.
- SYSTEM actions MUST start with `SYSTEM_`.
- MUST include P0 coverage actions for:
1. Auth
2. Compliance (KYT/Travel Rule)
3. Current V1 Compliance Alert/Incident implementation lifecycle
4. Config domains
5. Wallet
6. Customer
7. Swap Quote lifecycle
- Compliance alert/current-incident implementation actions SHOULD use `DATA_CREATE` / `DATA_UPDATE` trigger types with domain action names (`ALERT_*`, `INCIDENT_*`), instead of `MANUAL_*` / `SYSTEM_*`.

## No-First Query Constraints
- `GET /admin/audit-logs` MUST support exact filters:
1. `subjectNo`
2. `subjectType`
3. `actorNo`
4. `entityOwnerNo`
- `GET /admin/audit-logs/:id` MUST include `subjectNos[]` in response.
- Evidence export records MUST include `actorNo`, `entityOwnerNo`, and `subjectNos[]`.
- `keyword` search SHOULD stay complementary and MUST NOT replace exact No filters.
- Admin UI MUST keep No-first retrieval as default operator workflow.

## Unified Write Path Constraints
- MUST implement direct unified write mode: new business traffic writes only to `audit_log_events`.
- MUST stop adding new writes to legacy domain audit tables; legacy tables MAY remain for historical read only.
- MUST cover P0 domains in unified write path:
1. Auth login chain
2. Transaction compliance
3. Current V1 compliance alert and incident implementation lifecycle
4. Config center changes
5. Wallet master data
6. Customer master data
7. Swap Quote lifecycle
8. Governance change ticket and release gate lifecycle
- SHOULD write via `recordByActor()` for human/API actions and `recordSystem()` for jobs/orchestrators.

## Evidence Package and Export Constraints
- MUST export evidence package as a single JSON file (`manifest + records + digest`).
- MUST compute record digests and package digest with SHA-256.
- MUST persist one row in `audit_evidence_packages` per export execution.
- MUST append one audit event with `triggerType=EVIDENCE_EXPORT` for the export action itself.
- SHOULD keep `includeRecords` and `maxItems<=5000` contract stable.

## Masking, Digest, and Idempotency Constraints
- MUST apply recursive masking before DB persistence for `metadata`, `beforeData`, and `afterData`.
- MUST mask sensitive keys (`password`, `token`, `secret`, `privateKey`, `authorization`) as `***`.
- MUST mask network/account identifiers under the active mask version policy.
- MUST compute `payloadDigest` from normalized masked payload.
- MUST support idempotent retry via `idempotencyKey` unique semantics.
- SHOULD derive idempotency from module/entity/action/request context when caller does not provide one.

## Retention and Backfill Constraints
- MUST set `retainedUntil = occurredAt + 8 years` during write.
- Retention handling MUST be repeatable and idempotent in job execution.
- Backfill scripts MUST support both `--dry-run` and `--apply`.
- Backfill scripts MUST be idempotent (re-run safe, no duplicate semantic records).
- Backfill-origin events SHOULD set `sourcePlatform=BACKFILL`.

## Runtime Compatibility Constraints
- MUST keep API compatibility for:
1. `POST /admin/audit-logs`
2. `GET /admin/audit-logs`
3. `GET /admin/audit-logs/:id`
4. `POST /admin/audit-logs/export/evidence-package`
- Audit Logs MUST be surfaced under `Audit Center`.
- Compliance Center MUST NOT duplicate the `Audit Logs` navigation entry.
- MUST preserve machine-parsable response shape for list/detail/export.
- SHOULD keep old data readable even after schema enhancement.
- Governance/audit read-write paths MUST fail fast when required audit tables are unavailable; MUST NOT silently downgrade to noop/in-memory success responses.

## Thread Delivery Checklist
- Constraint links added to both `AGENTS.md` and `docs/constraints/README.md`.
- Product and technical docs updated with implemented state + next-stage roadmap.
- Trigger/action/data-field definitions consistent across docs and code.
- Query/filter/export contracts validated against controller/DTO.
- Operational commands documented (`audit:backfill:*`, `audit:backfill:nos:*`, `audit:retention:*`).
