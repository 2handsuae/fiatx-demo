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

### Trigger dependencies on SQLite table-recreate migrations

**Context:** When executing the 2026-04-08 `customer_main.activeJourneyId` drop via the SQLite table-recreate pattern, the migration failed mid-flight because the `wallets` table has two triggers (`wallets_owner_semantics_insert`, `wallets_owner_semantics_update`) whose bodies reference `customer_main`. SQLite validates trigger bodies at compile time, so `DROP TABLE "customer_main"` returned "no such table" as SQLite tried to re-validate the dependent trigger during the drop.

**Rule for any future SQLite table-recreate migration:**
1. Before the `DROP TABLE`, issue `DROP TRIGGER IF EXISTS <name>;` for every trigger that references the table.
2. After the `ALTER TABLE ... RENAME TO ...`, recreate those triggers verbatim using their original `sql` body from `sqlite_master`.
3. To find dependent triggers, run:
   ```sql
   SELECT name, sql FROM sqlite_master
   WHERE type = 'trigger' AND sql LIKE '%<table-name>%';
   ```

Treat this as part of the standard SQLite table-recreate checklist. Anyone writing a `*_new` migration must verify no triggers will break before they run it.

**Effort to document this properly in a migration guide:** S — add to a migration-conventions doc if one is ever created.

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
