# Backend Platform Rules
Last Updated: 2026-04-21 | Scope: Wave 1–4 | Source: docs/constraints/backend-*

---

## Architecture & Module Boundaries

- Must follow NestJS module domain boundaries: `identity`, `asset-treasury`, `trading`, `accounting`, `clearing-settle`, `risk-engine`, `governance`, `orchestrators`.
- Controllers must handle transport only (request/response/auth/validation); business logic must stay in services.
- Direct DB access must go through `PrismaService` inside services only.
- Must not introduce cross-module circular dependencies.
- Must not let one module directly mutate another module's workflow root state outside the root owner service.
- Cross-module service calls must use canonical entrypoints — no backdoor calls that skip policy checks.

## Data Integrity & Transactions

- Multi-table state changes must use DB transaction.
- Onboarding/compliance state recomputation must go through service orchestration, not ad-hoc updates.
- Must keep base config (base seed/sync) and business data (business reset script) concerns separated.
- Must not rely on startup side-effect writes; boot-time checks may validate, but must not write.

## API Contract

- List, detail, action, and export endpoints must each have a single, non-overlapping semantic role.
- List endpoints must expose operator-facing identity and key lifecycle/status fields.
- Detail endpoints must not require the frontend to reconstruct primary business truth from multiple unrelated APIs.
- Action endpoints must represent a named, canonical business/governance action — not free-form partial mutation.
- Action responses must indicate: acceptance, target subject, and resulting/next state.
- Error responses must include: machine-readable code, HTTP status, human-readable message, and request/trace context.
- Must use DTO classes with `class-validator`; `ValidationPipe({ whitelist: true })` is global.
- Must reject unsupported enum/status transitions with explicit exceptions.
- Must not expose raw Prisma-shaped records as the long-term API contract.
- Must not expose `id` as the primary operator query contract when a stable operator-facing key exists.
- Must keep Swagger available at `/api` in local dev.
- Behavioral changes to existing endpoints must include: impact list, backward compatibility statement, migration strategy.

## Domain Model & Subject Classification

- Every durable table must declare its subject class before it is considered delivery-complete.
- Allowed subject classes: `Business/Governance Root`, `Config Root`, `Subordinate`, `Bridge`, `Event`, `Snapshot/Projection`, `Read Model`.
- First-class subjects must define: canonical identity contract, lifecycle owner, operator-facing read model, audit and repair boundary.
- Bridge subjects must express binding only — must not become hidden workflow roots.
- Event subjects must record durable evidence or timeline facts — must not silently become business truth owners.
- Snapshot/projection subjects must be rebuildable from their source of truth.
- Must not create a new first-class subject without operator-key, lifecycle, audit, and repair policy.
- Must not treat every durable table as equal in product semantics.

## Identity & Operator Keys

- Every durable table must have `id` for internal binding and FK relations.
- Every first-class subject must have one stable `operatorKey` in one of the forms: `...No`, stable natural `code`/`policyCode`/`eventCode`/`templateCode`, `businessKey`, or deterministic `compositeRef`.
- Workflow, transaction, and governance root subjects should use `...No`.
- Subordinate subjects should use a deterministic parent-anchored composite reference (e.g. `approvalNo + stepNo`).
- Operator list/detail pages must prioritize operatorKey over `id`; admin exact-match filters must prefer `No/Code/compositeRef`.
- Must not introduce a first-class subject that only has `id`.
- Must not require operators to query first-class subjects only by UUID.
- Compatibility aliases must not appear as competing identity fields in active DTOs.

## State Machine & Workflows

- Every workflow root must define: root subject, owning service, canonical status set, allowed actions, transition guards, side effects, audit obligations, repair boundary.
- Only the owning service may mutate the workflow root primary status.
- Workflow actions must be named domain actions, not free-form field patching.
- Unsupported transitions must be rejected explicitly.
- Repeated actions must be idempotent or fail clearly when replay is forbidden.
- Each subject may have one primary lifecycle `status`; additional state axes (approval status, execution status, etc.) must be separated into explicit fields.
- Must not let external callback handlers write root status directly without calling canonical workflow execution.
- Must not encode unrelated decision axes into one overloaded `status` field.

## Async, Idempotency & Repair

- Any flow using callbacks, jobs, retries, or compensating re-entry must define: trigger source, idempotency key, replay behavior, failure behavior, repair surface.
- Repeated deliveries of the same semantic event must not create duplicate durable business results.
- Repair is only allowed through explicit surfaces: retry, replay, recalc, re-scan, re-link, re-closeout, re-compensate.
- A repair path must be narrower than the normal workflow path.
- Must not rely on manual SQL as the canonical repair mechanism.
- Must not allow repair actions that bypass lifecycle ownership or audit.
- Every repair action must capture: who triggered it, why, which subject, what the result was.

## Read Model

- Backend services own operator-facing read models — frontend must not be the primary place where subject truth is joined or inferred.
- First-class subject detail should expose: operator-facing identity, canonical lifecycle status, key timestamps, linked subject keys, important derived display truth, allowed actions.
- Derived fields must not replace canonical source-of-truth fields.
- Operator-facing read models should mirror linked subject `No/Code` values when operationally relevant.
- Must not expose only IDs when the operator decision depends on human-readable linked identities.

## Data Lifecycle

- Config history data must not be edited in place once released; new versions/releases must replace old ones.
- Execution-result data (journals, clearings) must be treated as immutable historical outputs.
- Audit/evidence data must be treated as immutable except where an explicit governed delete path exists.
- Snapshot/projection data may be rebuilt; direct manual edits are forbidden.
- Delete is not a default right — subjects are deletable only when an active constraint explicitly defines the scope, workflow, read filtering, and retention/audit expectations.
- Retired concepts must not return to active DTO, UI, or test language.
- Immutable execution history must be corrected by compensation or reversal, not overwrite.

## Auth & Authorization

- Route access and business action authority must not be treated as the same thing; high-risk actions should use explicit action permission checks even when the route is protected.
- Authorization truth must come from canonical role/permission binding, not compatibility shadow fields.
- Sensitive governance and repair actions must respect maker-checker or maker-executor boundaries.
- Any privileged bypass must be explicit and auditable.
- Must not hardcode authorization truth into UI assumptions alone.
- Must not grant action authority implicitly just because a user can open the page.

## Provider Integration

- Provider callbacks, reports, and response containers must be treated as external evidence/integration artifacts — not as business workflow root substitutes.
- Callback ingestion must define dedupe semantics explicitly; replayed callbacks must update or no-op deterministically.
- Provider responses may inform workflow decisions but must not directly mutate canonical business state outside a documented domain workflow entrypoint.
- Must not treat raw provider status words as business truth without normalization.
- Must not accept provider callback side effects without audit evidence.

## Testing & Delivery

- A backend change is not delivery-complete until it answers: which subject/domain changed, which API/read-model changed, which workflow/lifecycle changed, which audit behavior changed, which tests prove it.
- Workflow changes should validate: valid transition path, invalid transition rejection, side effects, idempotency when relevant.
- Must not treat implementation as complete when audit integration is missing for required surfaces.
- Must not change backend semantic truth without documentation impact review.
- Any new feature or workflow with durable state, operator-visible action, or automatic blocking behavior must integrate canonical audit logging through `AuditLogsService` — missing audit logging means the feature is not delivery-complete.
