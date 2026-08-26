# Audit Logging Rules
Last Updated: 2026-08-25 | Scope: V1 governance domain (IAM / APPROVAL / CONFIG / AUDIT) | Source: `doc-final/superpowers/specs/2026-08-25-audit-log-redesign-design.md` (审计日志重构第一批设计稿)

> This batch only guarantees correctness for the V1 governance domain (admin lifecycle, approvals, role definitions, audit log self-queries). The three transaction domains (deposit/withdraw/swap) still write under the pre-redesign contract until their own batch — see `doc-final/BACKLOG.md` § 审计日志重构 · 第一批之后仍欠的账.

---

## Injection & Service Usage

- Must inject `AuditLogsService` via NestJS DI — never instantiate with `new`.
- Must route all new audit writes through `AuditLogsService`; no ad-hoc table writes in feature modules.
- Must use `recordByActor()` for human/API-triggered actions and `recordSystem()` for jobs/orchestrators.
- Canonical implementation lives in `src/modules/audit-logging/` (not `risk-engine`).
- Must keep the V1 action dictionary centralized in `constants/audit-actions.constant.ts`: `V1_AUDIT_ACTIONS` (45 live codes, one entry per code with its four declared properties — see "Every Code Is Frozen At Birth" below) and `DEPRECATED_AUDIT_ACTIONS` (11 retired codes, write-blocked). The legacy `AuditActions`/`AuditGovernanceActions` constants still exist and are still referenced by ~25 non-V1 domain files — do not delete them until those callers migrate in their own domain batch.

## Audit Point Placement: Orchestration Layer Only

- Audit writes belong in the **orchestration layer** (workflow services under `identity/users/`, `identity/access-control/`, `governance/approvals/`) — never in domain/entity services, never in controllers.
  Rationale: most required fields (`actorNo`, `actorRolesAtTime`, `correlationId`/`causationId`, `permissionCode`/`approvalNo`, multi-subject roles, `sourcePlatform`/`endpoint`/`requestId`) are only known at the orchestration layer; forcing domain services to accept them as parameters leaks request/journey/authorization context into a layer that should only know about itself.
- **Division of labor**: the domain/entity layer *judges* (rejects illegal transitions, throws a structured exception with a reason code); the orchestration layer *catches and records*. A rejected action must still be audited — "silently blocked, no audit" is forbidden.
- **The only allowed exception**: `audit-logs.controller.ts`'s `GET /admin/audit-logs` handler writes `AUDIT_LOG_QUERIED` directly. This action exists only at the controller boundary (querying has no corresponding workflow); its word-list entry declares `correlationMode: NONE` (a query does not belong to any business journey). Do not use this as precedent for other controller-level audit writes — it is a named, singular exception, not a pattern.
- A full-repo scan for `recordByActor`/`recordSystem` calls outside workflow services (excluding the one exception above) must return zero hits for V1-domain files. SLA-scanner and webhook-handler files are orchestration-like by nature (they know actor/journey/basis) and may keep audit calls in place, provided they also populate `subjects` and the three tracing IDs.

## `outcome`: Four-Value Enum, Replaces `*_FAILED` Action Codes

- `outcome` is one of exactly four values: `SUCCESS` / `FAILED` / `DENIED` / `PARTIAL`.
- `outcome` answers **"did the action itself execute or not"**, never "was the business result good or bad":
  - `APPROVAL_DECLINED` (a maker-checker rejection) has `outcome: SUCCESS` — the act of declining executed successfully. The business rejection is expressed by the action code's name, not by `outcome`.
  - `DENIED` is reserved for the system **actively blocking an action that never executed**: SoD conflicts (`APPROVAL_SOD_DENIED`), self-tamper protection, rate limiting, expired tokens.
  - `FAILED` is reserved for **attempted but technically unsuccessful**: email send failure, downstream write failure.
- The seven legacy `*_FAILED` action codes (`MFA_VERIFY_FAILED`, `RESET_FAILED`, `CHANGE_APPLY_FAILED`, `ROLE_ACTIVATE_FAILED`, `ROLE_MODIFY_FAILED`, `MODIFICATION_APPLY_FAILED`, `GENERATION_FAILED`) are retired — express failure as `outcome=FAILED` + `reasonCode` on the base action code instead of minting a separate `*_FAILED` code.
- A non-`SUCCESS` outcome **must** carry `reasonCode`. Word-list rule (see below): `requiredFields` only applies on the success path; the non-success path instead mandates `reasonCode` (a failed/denied action typically can't produce the success-path artifacts `requiredFields` lists — e.g. no export artifact if generation failed — so success-path fields can't be blanket-required across all outcomes).

## `subjectRole`: Five Closed Values on the `audit_log_subjects` Subtable

A single business event routinely touches multiple objects, each playing a different role ("MLRO approves unfreezing deposit DEP-1234" touches 5 objects: the deposit order, the customer, the approval case, the funds order, the asset). One `primarySubjectType`/`primarySubjectNo` pair on the main table cannot hold all of them, and stuffing the rest into `metadata` makes them unqueryable (JSON columns can't be indexed).

- Table: `audit_log_subjects` — `id` / `eventId` (FK, `onDelete: Cascade`) / `subjectType` / `subjectNo` / `subjectRole` / `occurredAt` / `createdAt`.
- Unique key **must include `subjectRole`**: `@@unique([eventId, subjectType, subjectNo, subjectRole])`. The same object can hold two roles on one event (freezing a customer makes them both `OWNER` and `PRIMARY`) — a key without the role column would misfire as a duplicate.
- `subjectNo` stores the **business key**, never a UUID — the object may later be deleted; the business key stays legible in the record.
- Five roles, closed enum:

  | Role | Meaning | Cardinality |
  |---|---|---|
  | `PRIMARY` | The object the event **directly acted on** | **at most 1** |
  | `OWNER` | The owning party, usually the customer. **Regulatory retrieval-by-customer goes through this role.** | 0..N |
  | `INSTRUMENT` | The credential/basis the action **relied on**: approval case, rule row, withdrawal address, quote | 0..N |
  | `RELATED` | An **implicated** but not directly-acted-on document: funds order, asset, wallet, ledger account | 0..N |
  | `COUNTERPARTY` | The **counterparty**: external VASP, payee, remitter | 0..N |

- **`ACTOR` is deliberately not a role.** The actor is already recorded on the main table's `actorNo` — a duplicate subject row buys no new query capability, only a second place for the two to drift apart. Store each fact exactly once.
- **Zero `PRIMARY` is legal** (e.g. a limit-block event where no order was ever created — only `OWNER` and `INSTRUMENT` apply). The write-time guard only rejects **more than one** `PRIMARY` on the same event.
- **⚠️ Current coverage gap** (found during Task 11 end-to-end acceptance, 2026-08-25): only the 6 cross-cutting `APPROVAL_*` codes (written by `approvals.service.ts`) and `AUDIT_LOG_QUERIED` (only when the query carries `ownerCustomerNo`) actually populate this subtable. The ~38 other V1 codes (all of IAM's admin-lifecycle codes, `ROLE_DEFINITION_*`, `APPROVAL_POLICY_CHANGE_*`, `AUDIT_EVIDENCE_EXPORT_*`) set the flat `primarySubjectType`/`primarySubjectNo` columns but never pass a `subjects:` array — so subtable-based lookup by, say, an admin user's business number returns zero rows even though that same number appears as `primarySubjectNo` on real events. See `doc-final/BACKLOG.md` for the fix (each affected workflow service needs 1-2 lines added, following the pattern already in `approvals.service.ts`).

## Splitting One Record Into Two: Either Criterion Triggers a Split

Applies to **every** log, no exceptions:

| Criterion | Rule | Why |
|---|---|---|
| **A · Independent outcomes** | Each object can succeed/fail on its own → split | One record has exactly **one** `outcome`; it cannot hold "approval succeeded but execution failed" |
| **B · Different PRIMARY** | Two subjects' state each changed → split | One record has exactly **one** `fromStatus`/`toStatus` pair, and it describes the **PRIMARY's** state only |

Self-check: if you're about to write `fromStatus == toStatus`, stop — that is almost always a sign the wrong `PRIMARY` was chosen. The only legitimate `from == to` case is an idempotent replay, which should be expressed via `outcome` instead. A multi-step approval's intermediate votes should leave `fromStatus`/`toStatus` **empty** (meaning "this action did not move PRIMARY's state") rather than writing `from == to`, which falsely implies nothing happened.

## Three Tracing IDs

One-line mnemonic: `traceId` is "this one instant"; `correlationId` is "this whole journey". A journey contains many instants; one instant can touch several journeys.

| | `traceId` | `correlationId` | `causationId` |
|---|---|---|---|
| Boundary | one external trigger | one full execution of one business process | the event that directly caused this one |
| Lifespan | ms–s | minutes–months | — |
| Cuts across | entities (one trigger can move many records) | time (one thing takes many triggers to finish) | the boundary between the two above |
| Generated by | framework, at the request entry point | business layer, when the process starts | passed in by the caller |

- **Format**: opaque UUID v4. Never embed a business number, date, or type into it — anything encoded into an id will eventually change, and a changed id then lies. Filter by type using the `actionDomain` column instead.
- **`correlationMode`** — only `correlationId` needs this declared per action code, as one of three values:
  - `START`: mint a UUID v4, write it onto the primary record's `correlationId` column in the same transaction.
  - `INHERIT`: read it off this record's **PRIMARY subject**; if the subject is a subordinate entity (e.g. a funds leg), walk the parent FK up to the primary record first.
  - `NONE`: does not belong to any journey (rare — currently only `AUDIT_LOG_QUERIED`).
  - Whether a code starts or continues a journey is a **fixed property of the code**, not situational — `ADMIN_INVITE_REQUESTED` always starts, `ADMIN_INVITE_ACCEPTED` always continues. Declare it once, in the code's spec entry.
- **`causationId`** is half-declared in the code spec (only whether it's required; the value itself varies per occurrence). **`traceId` is not declared at all** — framework-generated, passed through mechanically, no judgment involved.
- **Hard rule, never relaxed: if `INHERIT` cannot find a value, the write must fail — it must never silently mint a new one.** `primary.correlationId ?? randomUUID()` is the most common shortcut and it is forbidden: every failed read silently opens a new journey, the chain breaks, the data looks normal, and nothing ever errors.

## Every Code Is Frozen At Birth

Adding a new action code requires declaring, **at the moment of creation** (never "ship now, backfill later"):

```
<CODE>
  meaning:            one sentence
  actionDomain:       IAM / APPROVAL / CONFIG / AUDIT / …
  correlationMode:    START / INHERIT / NONE
  extra required fields: whatever this code specifically demands
  causationId:        required or not (required for asynchronously-driven codes)
```

Once any row has been written under a code, backfilling a "required field" rule after the fact leaves every historical row permanently incomplete and unfixable (append-only is rule #1). The upside: these four properties together are exactly what `assertActionSpec` machine-checks at write time — missing a required field, or a `START` code reading an already-open journey, both get rejected outright. "Conditionally required" moves from a paragraph of prose to an enforced gate.

- On the success path, `requiredFields` (declared per code) is enforced.
- On any non-success path, `reasonCode` is enforced instead (see the `outcome` section above for why the two can't share one rule).

## Action Code Naming: Prefix-First, Six Closed Suffixes

- Action codes are **flat and globally unique** — a single column identifies the code; no second column is needed to disambiguate. (This replaces the old `workflowType + action` composite key.)
- **All codes in one flow share the same prefix** (e.g. every `ADMIN_SUSPENSION_*` code belongs to one flow). This trades some readability (`ADMIN_SUSPENSION_APPLIED` reads less plainly than `ADMIN_ACCOUNT_SUSPENDED` would) for the ability to pull an entire flow with one prefix query — over an 8-year retention window, retrievability outweighs readability. Readability is carried by `actionDomain` and the word-list document instead.
- Six suffixes, closed set:

  | Suffix | Meaning |
  |---|---|
  | `_REQUESTED` | Start of a journey, typically `correlationMode = START` |
  | `_APPLIED` | **Change was applied** — executed after approval, or auto-applied by the system (e.g. a lock) |
  | `_COMPLETED` | **A non-approval multi-step flow finished** (first-login's four steps, self-service password change) |
  | `_CANCELLED` | Aborted mid-flow. Only add to a code family that has a real cancel path in code — don't add for symmetry |
  | `_EXPIRED` | Expired, system-written |
  | `_DENIED` | The system actively blocked the action; pairs with `outcome=DENIED` |

- **Never encode a classification dimension into the code itself** (no `TRADING_DEPOSIT_APPROVED`) — classification schemes get reorganized; action codes must not have to change with them.

## Forbidden Fields

- `workflowId` and `workflowNo` are **not** columns on `audit_log_events` — removed 2026-04-08.
- `module` is **not** a column — removed 2026-04-29. Do not pass `module:` in any `recordByActor`/`recordSystem` call.
- `triggerType` is **not** a column — removed 2026-04-30. Do not pass `triggerType:` in any call.
- `updatedAt` is **not** a column — removed 2026-08-25 (append-only tables have no "last updated" semantics).
- Must never propagate an `auditContext` object containing `workflowId` or `workflowNo`.
- `workflowType` still exists as a column but must not be relied on for V1-domain semantics — it is a transitional exception (see Data Model Invariants below) scheduled for physical removal in the transaction-domain batch.

## Data Model Invariants

- Write table for new traffic: `audit_log_events` (+ `audit_log_subjects`) only; must stop adding new writes to legacy domain audit tables.
- `eventNo` is the stable business key — unique, auto-generated at write time. `id` (UUID) exists only for the subtable's FK.
- `payloadDigest` must be computed from the normalized, masked payload — but masking must never touch the input to the digest in a way that lets a tampered value produce the same digest as the original; mask the stored fields, compute the digest from source truth.
- `metadata`, `beforeData`, `afterData` must be recursively masked before DB persistence; sensitive keys (`password`, `token`, `secret`, `privateKey`, `authorization`) masked as `***`.
- `retainedUntil` must be set to `occurredAt + 8 years` on every write; `legalHold` (boolean, default false) suspends retention expiry when true — trigger/release operational process is not yet defined, see BACKLOG.
- `idempotencyKey` unique semantics must support idempotent retry — on a hit, skip `persistSubjects` too (replaying it would collide with the subtable's unique key).
- `seq` (autoincrement integer) is the physical primary key and the monotonic ordering guarantee; `prevHash`/`selfHash` support a hash chain — verification tooling for the chain is not yet built, see BACKLOG.

## Evidence Package

- Export as a single JSON file: `manifest + records + digest`.
- Digests computed with SHA-256 per record and for the package.
- Must persist one row in `audit_evidence_packages` per export execution.
- Export must be approval-backed (`AUDIT_EVIDENCE_EXPORT_APPROVAL`); the legacy direct bypass path must not remain callable once the approval-backed flow is active.
- Exported `records` must be typed, masked event records — not a raw payload dump.
- A failed export must still be audited: `AUDIT_EVIDENCE_EXPORT_GENERATED` with `outcome=FAILED` + `reasonCode`, not silent (this was a real gap fixed in this batch — see "Every Code Is Frozen At Birth" / `requiredFields`-vs-`reasonCode` split above).

## Query Contract

- `GET /admin/audit-logs` must support exact filters: `subjectNo`, `subjectRole` (used together — "this business key, in this role"), `primarySubjectType`, `primarySubjectNo`, `ownerCustomerNo`, `actionDomain`, `outcome`, `correlationId`, `causationId`, `traceId`, `actorNo`, `isReadOnly`.
- `subjectNo` filtering goes through the **`subjects` relation** (the subtable) — it is a different query path from `primarySubjectNo` (the flat main-table column). Given the coverage gap noted above, callers investigating a V1 IAM/CONFIG action's target should currently use `primarySubjectNo=`, not `subjectNo=`, until the affected workflow services are updated to populate `subjects`.
- `keyword` search must stay complementary — must not replace exact No filters.
- `GET /admin/audit-logs/:id` and the list endpoint must include `subjects: { subjectType, subjectNo, subjectRole }[]` in the response — this **replaces** the old `subjectNos[]` string-array contract (that contract required a table, `audit_log_subject_nos`, which was dropped 2026-05-19; the contract had drifted from the implementation ever since. This batch reconciles it: the new shape is the relational `subjects[]`, not a flat string array).
- Admin UI must keep No-first retrieval as default operator workflow.

## Five Non-Field Conventions (Necessary But Not Yet All Implemented)

These five hold up everything above — missing any one of them undermines the guarantees the schema/word-list work is meant to provide. None is implemented as of this batch; tracked in BACKLOG under the operational-hardening items.

1. **Revoke UPDATE/DELETE at the database-user level for the audit write account.** "Append-only" enforced only by service-layer discipline will eventually meet someone's well-intentioned `UPDATE` to fix a typo. Make it physically impossible, not just against policy.
2. **Keep a separate display-name mapping table with an effective-date range.** The main table only ever stores the immutable `action` code — human-readable labels live and change elsewhere.
3. **Store everything in UTC, keep hosts NTP-synced.** Clock drift produces wrong event ordering, and ordering is often exactly what responsibility hinges on.
4. **Masking rule: sensitive keys get masked, but `payloadDigest` is computed from the original, unmasked payload.** Otherwise masking itself becomes a way to launder a tampered record.
5. **Oversized payloads need an explicit truncation priority.** This project's order: truncate `beforeData`/`afterData` first; `reason` is truncated last (cf. CloudTrail's rule that `errorMessage` is truncated last).

## When Audit Log MUST Be Written

A feature or workflow is **not delivery-complete** without audit coverage for every:
- New feature with durable state.
- New workflow or key state transition.
- Automatic block / deny action (silent blocking without audit is forbidden) — including denials produced by segregation-of-duties checks (`APPROVAL_SOD_DENIED` is the reference case: a maker attempting to self-approve was previously blocked but left zero trace).
- Repair action (must capture: actor, reason, target subject, result).
- Evidence package export (must append an audit event with the appropriate `AUDIT_EVIDENCE_EXPORT_*` code).
- A journey that times out or goes stale with nobody acting on it ("hit its deadline and nothing happened" must be as visible as any action — otherwise a three-month-silent record is indistinguishable from "system broken" vs. "someone is sitting on it").

Record-density guide (not a hard rule): ask three questions — is there a party who'd bear responsibility for this step; did something here become irreversible; could this specific step be individually challenged after the fact. Pass any one → log it. A smooth happy-path business action runs roughly 8 log lines; a fully-worked exception path runs 15–25.
