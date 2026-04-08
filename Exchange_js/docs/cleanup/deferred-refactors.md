# Deferred Refactors Registry

> **Scope:** project-wide cross-cutting cleanup items that are intentionally deferred. Every new refactor that someone decides not to tackle immediately should land here with enough context that a future engineer (or the same engineer 3 months later) can pick it up without digging through chat history.
>
> **Audience:** anyone about to start architectural work. Check this list first so you can fold related items into your scope.
>
> **Updated:** whenever a deferred item is added, closed, or revised.

## How to use this registry

- **Adding an item:** include the *what*, *why it was deferred*, *who will be unblocked when it lands*, and *estimated effort tier* (S / M / L).
- **Closing an item:** strike it through and link the PR or plan file that closed it. Do not delete — history of decisions matters.
- **Priority:** items within each section are loosely ordered by "how much pain is it causing right now". Bump as needed.

---

## Architectural cleanup

### 1. SWAP workflow should propagate a single shared `traceId` across payin/payout/swap-transaction sub-entities

**Context:** Prior to 2026-04, `audit_log_events` had a dedicated `resolveSwapWorkflowSearchExpansion` query path (audit-logs.service ~line 1335) that let operators filter SWAP audit history by `workflowNo` — the only place in the codebase that needed cross-trace joining, because SWAP sub-entities each generated their own traceId. That expansion code was deleted as part of `2026-04-08-audit-trace-context-and-onboarding-cleanup`, along with `workflowId/workflowNo` columns on `audit_log_events`.

**What needs to happen:** `SwapTransactionWorkflowService` (and its payin/payout bridges) should assign one shared `traceId` to every audit row inside a single swap's lifecycle. Once this is done, operators can filter SWAP history with `WHERE traceId = <swap trace>` and get the same result the old workflowNo expansion used to give.

**Who is blocked:** SWAP operators. Current impact is low because SWAP audit searches are mostly done by swap identifier, not cross-trace.

**Effort:** M — touches `SwapTransactionWorkflowService`, `PayinsService`, `PayoutsService`, plus end-to-end tests that verify the shared traceId.

### 2. Converge `action` naming to `<WORKFLOW_TYPE>_<VERB>` prefix convention

**Context:** `audit_log_events.workflowType` is a denormalized category label that could theoretically be derived from a strict `action` prefix convention (e.g. `ADMIN_LOGIN_FAILED` → workflowType `ADMIN_LOGIN_ACCESS`). Today's action names are inconsistent: some start with the entity (`USER_ROLE_BINDING_UPDATED`), some with the workflow (`CHANGE_TICKET_CREATED`), some with neither (`ACCOUNT_LOCKED`). Enforcing the prefix would let us drop `workflowType` as a column in a future cleanup.

**What needs to happen:** define the canonical prefix per workflow, rename all `AuditActions.*` constants + their call sites, add a lint-time regex check to `ACTION_NAME_RE` in `audit-logs.service.ts` that enforces the prefix.

**Who is blocked:** nobody immediately. This is an architectural simplification for the next Wave cleanup.

**Effort:** L — touches ~100 action name constants and ~400 references across services + specs.

### 3. Business-table `workflowId/workflowNo` columns on `admin_user_invitations`

**Context:** The invitation row stores `workflowType/workflowNo/traceId` columns that were populated by the governance layer to propagate audit context. After the audit log cleanup, these columns are dead weight — they're read back only to reconstruct an audit context that no longer needs `workflowNo`. Only `traceId` remains useful.

**What needs to happen:** drop `workflowType` and `workflowNo` columns from `admin_user_invitations`, keep `traceId`. Update `AdminInvitationsService.findLatestInvitationAuditContext` to return only `{ traceId }`. Update callers.

**Who is blocked:** nobody. Mild schema hygiene.

**Effort:** S — ~20 lines across 2-3 files + SQLite migration.

### 4. Business-table workflow columns on `customer_main` (if any survive after the onboarding cleanup)

**Context:** `customer_main.activeJourneyId` was removed in the 2026-04-08 cleanup. Audit that no other business table has triple-purposed "journey identifier" columns that should be narrowed.

**What needs to happen:** grep for similar patterns in `corporate_profiles`, `ubo_profiles`, etc. Deduplicate if found.

**Who is blocked:** nobody.

**Effort:** S — investigation + small fixes.

---

## Gotchas learned the hard way

### Use `ALTER TABLE DROP COLUMN`, not table-recreate, for SQLite 3.35+ column drops

**Context:** The 2026-04-08 cleanup originally tried two SQLite table-recreate migrations (`20260408020000_drop_customer_active_journey_id` and `20260408030000_drop_audit_log_workflow_id_no`) using the `CREATE TABLE x_new AS SELECT ... FROM x; DROP TABLE x; ALTER TABLE x_new RENAME TO x;` pattern. This pattern is **broken for this use case** because:

1. **`CREATE TABLE ... AS SELECT` loses ALL constraints.** The new table has no PRIMARY KEY, no UNIQUE, no NOT NULL, no DEFAULTs — it's a plain copy. After rename, `PRAGMA table_info(x)` shows every column with PK=0 and NOT NULL=0. The old constraints are silently gone.
2. **Foreign keys pointing at the recreated table break.** SQLite's FK resolution fails with "foreign key mismatch" at runtime because the referenced column no longer has a PRIMARY KEY or UNIQUE constraint. In our case, 17 tables (deposit_transactions, payouts, periodic_review_cycles, audit_log_subject_nos, etc.) had broken FKs after the recreates.
3. **Trigger dependencies need manual handling.** When `DROP TABLE x` runs, SQLite tries to re-validate every trigger whose body references `x` and errors out with "no such table". Requires `DROP TRIGGER IF EXISTS` before the table drop + recreate after.

**Use the simpler native path instead.** SQLite 3.35+ (March 2021) supports `ALTER TABLE ... DROP COLUMN` as long as the column is not part of a PRIMARY KEY, UNIQUE constraint, FOREIGN KEY, or INDEX. For the common case of dropping a nullable unindexed column, this is ONE statement:

```sql
ALTER TABLE "customer_main" DROP COLUMN "activeJourneyId";
```

If the column is in an index, drop the index first:

```sql
DROP INDEX IF EXISTS "audit_log_events_workflowType_workflowNo_occurredAt_idx";
ALTER TABLE "audit_log_events" DROP COLUMN "workflowId";
ALTER TABLE "audit_log_events" DROP COLUMN "workflowNo";
```

**Rule for any future SQLite column-drop migration:**
1. First try `ALTER TABLE ... DROP COLUMN`. If the column is not in a PK / UNIQUE / FK / INDEX, this just works and preserves everything else.
2. If the column IS in an index, drop the index first (`DROP INDEX IF EXISTS`), then drop the column.
3. If the column IS a PK / UNIQUE / FK (truly needs a schema restructure), only then fall back to the table-recreate pattern — AND use explicit `CREATE TABLE new (...)` with full constraint definitions, not `CREATE TABLE new AS SELECT`, AND handle dependent triggers (drop before, recreate after), AND remember that FKs on OTHER tables referencing the recreated table will need to be rebuilt via a `VACUUM` or separate migration.

**Effort to add this to a migration conventions doc if one is ever created:** S.

---

## Documentation debt

### 5. Update `docs/constraints/onboarding-flow-constraints.md` with the new trace rules

**Context:** `docs/constraints/onboarding-flow-constraints.md` does not yet mention `onboardingTraceId`, the new sumsub audit write path, or the removal of `activeJourneyId`. It should cross-reference `audit-trace-context-constraints.md` and explain how onboarding traces are generated and inherited.

**Who is blocked:** anyone reading the onboarding constraints to build new onboarding-adjacent work.

**Effort:** S — 1 section append.

---

## Conventions

- When an item is closed: prefix the heading with `~~` and append `**→ closed by [plan file / PR]**` at the end of the section.
- When a new item is added mid-sprint: put it at the bottom of the relevant section, not at the top. Order matters as a weak priority signal.
- When an item blocks something in-flight: escalate it out of this file and into an actual plan file under `docs/superpowers/plans/`.
