# Audit Trace Context Cleanup + Onboarding Verification Visibility

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse `audit_log_events` to use only `workflowType + traceId` as the sequence-grouping mechanism (dropping `workflowId/workflowNo`), add a single-purpose `customer_main.onboardingTraceId` column to persist the onboarding trace, wire every Sumsub webhook step into the audit trail, expose verification substatus on the admin Customer Detail page, and document the audit trace model + a global deferred-refactors registry so this kind of cleanup is tracked going forward.

**Architecture:**
- **Audit model:** One canonical rule — every business sequence generates one `randomUUID()` at its entry point, persists it on the primary entity, and inherits it to every downstream audit row and governed child workflow. `audit_log_events` schema drops `workflowId` and `workflowNo` — `workflowType` provides category labels, `traceId` provides sequence grouping, and parent-entity pointers (for approvals etc.) move into `metadata`.
- **Onboarding trace:** `customer_main.activeJourneyId` (redundant, triple-purposed field) is removed. A new single-purpose `customer_main.onboardingTraceId` column holds the UUID v4 generated at `POST /onboarding/verification/start`. Sumsub webhook audit rows inherit this traceId.
- **Audit writes for sumsub events:** `writeSumsubAudit` helper on `OnboardingService` called outside the Prisma transaction (matching the 84 existing non-atomic audit write sites). Uses `DATA_UPDATE` triggerType (no action-prefix constraint) so real and simulated paths share the action name.
- **Frontend:** additive Verification section on Customer Detail; filter/column cleanup on Audit Logs list + detail pages.
- **Docs:** global `docs/cleanup/deferred-refactors.md` as the team's running TODO for cross-cutting cleanup items, plus a formal `docs/constraints/audit-trace-context-constraints.md` codifying the new rules.

**Tech Stack:** NestJS 10 + Prisma 6 (SQLite for dev) + React 18 + TypeScript 5. Jest with Prisma mocks for backend tests.

---

## Scope Check

This plan touches `audit_log_events` (a foundational table), so it spans modules beyond the 8 wave-1 flows the user originally named:
- **In scope**: the 8 wave-1 flows (admin login, admin invitation, admin role change, change ticket delete, admin delete, evidence create, evidence delete, customer onboarding), plus **every service currently writing `workflowId`/`workflowNo`** into audit rows (32 services across identity / governance / risk-engine / asset-treasury / trading / clearing-settle / accounting modules — counted via grep).
- **Out of scope**: the same columns on business tables (`approval_cases.workflowId/workflowNo`, `change_tickets.workflowId`, etc.). Those are business columns used by their own services for linking to parent entities; they're unaffected.
- **Behavior change flagged**: the SWAP cross-trace expansion logic in `audit-logs.service` (lines 1335-...) only exists because SWAP audit rows historically had different `traceId`s for payin/payout/swap-txn sub-entities and needed `workflowNo` to bridge them. Deleting the expansion means SWAP audit queries will only return rows sharing the same `traceId`. Fixing SWAP to propagate one shared traceId across its sub-entities is scheduled as the first item in `docs/cleanup/deferred-refactors.md`.

---

## File Structure

| File | Role | Op |
|---|---|---|
| `docs/cleanup/deferred-refactors.md` | Global team TODO for cross-cutting cleanup items | Create |
| `docs/constraints/audit-trace-context-constraints.md` | Codify the trace/workflow rules as a binding constraint doc | Create |
| `Exchange_js/admin-web/src/pages/CustomerDetail.tsx` | Verification section + remove `activeJourneyId` from interface | Modify |
| `Exchange_js/admin-web/src/pages/AuditLogsPage.tsx` | Remove `workflowNo` from filter state + Workflow No table column | Modify |
| `Exchange_js/admin-web/src/pages/AuditLogDetailPage.tsx` | Remove `workflowId`/`workflowNo` display from hero/sidebar | Modify |
| `Exchange_js/prisma/schema.prisma` | Add `onboardingTraceId`, drop `activeJourneyId`, drop `workflowId`/`workflowNo` from `AuditLogEvent` | Modify |
| `Exchange_js/prisma/migrations/20260408010000_add_customer_onboarding_trace_id/migration.sql` | Add new column to `customer_main` | Create |
| `Exchange_js/prisma/migrations/20260408020000_drop_customer_active_journey_id/migration.sql` | Drop old column via SQLite table-recreate | Create |
| `Exchange_js/prisma/migrations/20260408030000_drop_audit_log_workflow_id_no/migration.sql` | Drop both workflow columns from `audit_log_events` via SQLite table-recreate | Create |
| `Exchange_js/src/modules/identity/onboarding/onboarding.service.ts` | Add `writeSumsubAudit` helper; wire into `handleSumsubVerificationEvent`; populate `onboardingTraceId` in `startVerification`; replace all `activeJourneyId` usages | Modify |
| `Exchange_js/src/modules/identity/onboarding/onboarding-final-approval.service.ts` | Replace `activeJourneyId` usages; drop `workflowId/workflowNo` from audit writes | Modify |
| `Exchange_js/src/modules/identity/onboarding/onboarding-workflow-transition.service.ts` | Replace `activeJourneyId` usages; drop `workflowId/workflowNo` from audit writes | Modify |
| `Exchange_js/src/modules/identity/onboarding/onboarding.service.spec.ts` | Strip `activeJourneyId` mocks; add sumsub audit tests | Modify |
| `Exchange_js/src/modules/identity/onboarding/onboarding-final-approval.service.spec.ts` | Strip `activeJourneyId` mocks | Modify |
| `Exchange_js/src/modules/sumsub-ingestion/sumsub-ingestion.service.ts` | Pass `simulatedByUserId` in context to `handleSumsubVerificationEvent` | Modify |
| `Exchange_js/src/modules/risk-engine/audit-logs/audit-logs.service.ts` | Remove `workflowId/workflowNo` from internal field set, query builder, mapEvent; delete SWAP cross-trace expansion | Modify |
| `Exchange_js/src/modules/risk-engine/audit-logs/dto/audit-log.dto.ts` | Remove `workflowId/workflowNo` from `CreateAuditLogEventDto` and `AuditLogQueryDto` | Modify |
| `Exchange_js/src/modules/governance/approvals/approvals.service.ts` | Move approval parent pointer (change ticket / delete request) into `metadata.parentEntity*` for audit writes; remove `workflowId/workflowNo` from audit writes | Modify |
| `Exchange_js/src/modules/governance/approvals/audit-evidence-export-approval.service.ts` | Remove `workflowId/workflowNo` from audit writes | Modify |
| **All 32 services with `recordByActor`/`recordSystem` call sites** | Remove `workflowId: ...,` and `workflowNo: ...,` lines from audit write payloads | Modify (mechanical sweep) |

The 32 services (full list from grep):
`identity/auth`, `identity/access-control`, `identity/users`, `identity/onboarding` (3 files), `identity/periodic-review` (2 files), `governance/approvals` (2 files), `governance/change-tickets`, `governance/delete-requests`, `governance/registries`, `governance/regulatory-gates`, `governance/sla-timers`, `risk-engine/audit-logs`, `risk-engine/compliance-alerts`, `risk-engine/compliance-incidents`, `risk-engine/risk-decision-records`, `risk-engine/transaction-compliance`, `asset-treasury/payins`, `asset-treasury/payouts`, `asset-treasury/internal-transactions`, `asset-treasury/internal-transaction-workflow`, `asset-treasury/internal-funds`, `trading/deposit-transactions` (2 files), `trading/swap-transactions`, `trading/withdraw-transactions` (2 files), `clearing-settle/pool-settlement-batches`.

---

## Task 1 — Global deferred-refactors doc + audit trace constraint doc

Docs first, because every subsequent task references these rules and they have to exist to cite.

**Files:**
- Create: `Exchange_js/docs/cleanup/deferred-refactors.md`
- Create: `Exchange_js/docs/constraints/audit-trace-context-constraints.md`

**Verification approach:** Manual review of content; no code, no test.

- [ ] **Step 1: Create `docs/cleanup/deferred-refactors.md`**

```markdown
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

## Documentation debt

### 5. Update `docs/constraints/onboarding-flow-constraints.md` with the new trace rules

**Context:** the existing constraints doc does not yet mention `onboardingTraceId`, the audit write path, or the removal of `activeJourneyId`. Add a section cross-referencing `audit-trace-context-constraints.md`.

**Who is blocked:** anyone reading the onboarding constraints to build new onboarding-adjacent work.

**Effort:** S — 1 section append.

---

## Conventions

- When an item is closed: prefix the heading with `~~` and append `**→ closed by [plan file / PR]**` at the end of the section.
- When a new item is added mid-sprint: put it at the bottom of the relevant section, not at the top. Order matters as a weak priority signal.
- When an item blocks something in-flight: escalate it out of this file and into an actual plan file under `docs/superpowers/plans/`.
```

- [ ] **Step 2: Create `docs/constraints/audit-trace-context-constraints.md`**

```markdown
# Audit Trace Context Constraints

> **Scope:** governs how `audit_log_events` rows are populated, how `traceId` is generated and propagated, and how sequences are grouped.
> **Status:** binding. Every new service that writes `audit_log_events` MUST follow these rules.
> **Audience:** backend engineers adding or modifying audit writes.

---

## 1. Canonical fields for sequence grouping

`audit_log_events` has exactly two fields for linking rows into a sequence:

| Field | Role | Required? |
|---|---|---|
| `traceId` | The unique identifier for one business sequence. All rows belonging to the same sequence share this value. | Strongly recommended — include on every row unless there is no parent sequence at all |
| `workflowType` | The category label (`ONBOARDING`, `ADMIN_LOGIN_ACCESS`, `CHANGE_TICKET`, `APPROVAL`, ...). Used for dashboard category filters. | Required |

`workflowId` and `workflowNo` are **not** columns on `audit_log_events` — they were removed in `2026-04-08-audit-trace-context-and-onboarding-cleanup`. Parent-entity pointers (when needed) live in `metadata.parentEntityType`, `metadata.parentEntityId`, `metadata.parentEntityNo`.

---

## 2. Rules for generating `traceId`

**Rule 1 — Format.** `traceId` is always a raw UUID v4. No prefix, no business-field embedding. Generate via `randomUUID()` from `node:crypto`.

**Rule 2 — One trace per sequence.** Every business sequence (admin login attempt, onboarding run, change ticket workflow, evidence export request, ...) is identified by exactly one `traceId`. All audit rows in that sequence carry the same value.

**Rule 3 — Generate at the entry point.** The service that owns the primary entity of a sequence generates the `traceId` when the entity is first created (e.g. `ChangeTicketsService.createTicket` calls `randomUUID()` and assigns it to `change_tickets.traceId`). `auth.service` generates a fresh UUID at the start of every login attempt. Sub-actions never generate a new traceId; they always inherit.

**Rule 4 — Persist on the primary entity row.** Every entity type that represents a sequence has a `traceId` column and it is written at creation time:
- `change_tickets.traceId`
- `delete_requests.traceId`
- `approval_cases.traceId`
- `admin_user_invitations.traceId`
- `customer_main.onboardingTraceId` (single-purpose; only for the sumsub onboarding sequence)

**Rule 5 — Inherit to child actions.** When a child action runs as part of an existing sequence, it reads the parent entity's traceId and passes it through. The `approvals.service` reads the parent change ticket's `traceId` and stores it on the approval case. Access-control role changes read `binding.traceId` from the governance bridge. Evidence package audit rows read `approval.traceId`. `OnboardingService.handleSumsubVerificationEvent` reads `customer.onboardingTraceId`.

---

## 3. Rules for `workflowType`

**Rule 6 — Always set.** Every audit row MUST have a `workflowType` from `AuditWorkflowTypes` or `AuditBusinessWorkflowTypes`. Never null.

**Rule 7 — No derivation at write time.** Do not lazily derive workflowType from the action name. Pick the explicit constant.

**Rule 8 — Exactly one category per row.** If an action could be categorized two ways, pick the one closest to the operator's mental model. Cross-cutting actions belong to the parent workflow, not the child.

---

## 4. Rules for `metadata` (when used for parent pointers)

**Rule 9 — Parent pointer shape.** When an audit row represents a child action whose entity differs from the root sequence's primary entity (e.g. an approval case audit row whose `entityId = approval.id` but the sequence is owned by a change ticket), the row's `metadata` SHOULD include:

```ts
metadata: {
  parentEntityType: 'CHANGE_TICKET' | 'DELETE_REQUEST' | 'CUSTOMER' | ...,
  parentEntityId: '<uuid>',
  parentEntityNo: '<human-readable-no>',
  // ... other metadata ...
}
```

**Rule 10 — traceId alone is enough for sequence grouping.** Do not treat `metadata.parentEntityId` as a required join key. It's a UI convenience for "click through to parent". Sequence queries MUST use `WHERE traceId = X`.

---

## 5. Rules for `recordByActor` / `recordSystem` payloads

**Rule 11 — Always include `workflowType` and `traceId`.** A row without workflowType fails the writeside check. A row without traceId is permitted only for standalone non-sequence events (no example currently exists; this is a safety escape hatch).

**Rule 12 — Never set `workflowId` or `workflowNo`.** These fields were removed. If code is setting them, delete the lines.

**Rule 13 — Never propagate an `auditContext` object containing `workflowId` or `workflowNo`.** Service-to-service audit context propagation (e.g. the `InternalAuditContext` type in `access-control.service.ts` and `admin-invitations.service.ts`) must only carry `{ workflowType, traceId }`. Remove `workflowNo` from the type and all usages.

---

## 6. Examples — how the 8 completed wave-1 flows should look

| Flow | Who generates traceId | workflowType | entityId | Parent pointer in metadata? |
|---|---|---|---|---|
| Admin login | `auth.service.validateUser` — `randomUUID()` once per login attempt | `ADMIN_LOGIN_ACCESS` | `user.id` (or null on first failure) | No |
| Admin invitation | Inherited from the change ticket that governs the invitation | `ADMIN_MEMBER_PROVISIONING` | `user.id` | `{ parentEntityType: 'CHANGE_TICKET', parentEntityId: ticket.id, parentEntityNo: ticket.ticketNo }` |
| Admin role change | Inherited from `binding.traceId` (from change ticket) | `ADMIN_ROLE_BINDING_CHANGE` | `user.id` | Same as above |
| Change ticket create | `change-tickets.service.createTicket` — generates | Resolved from `changeType` | `ticket.id` | No |
| Delete request create | `delete-requests.service.createRequest` — generates | Resolved from `targetType` | `request.id` | No |
| Approval case create (wrapping a ticket) | Inherited from `ticket.traceId` | Resolved from `actionType` | `approval.id` | `{ parentEntityType: 'CHANGE_TICKET', parentEntityId: ticket.id, parentEntityNo: ticket.ticketNo }` |
| Evidence package export | Inherited from the approval's traceId | `AUDIT_EVIDENCE_EXPORT` | `package.id` | `{ parentEntityType: 'APPROVAL_CASE', parentEntityId: approval.id, parentEntityNo: approval.approvalNo }` |
| Customer onboarding (sumsub webhook) | `onboarding.service.startVerification` — generates, stores on `customer.onboardingTraceId` | `ONBOARDING` | `customer.id` | No |

---

## 7. Validation (enforced by `audit-logs.service`)

- `action` must match `/^[A-Z0-9]+(?:_[A-Z0-9]+)*$/`
- `workflowType` must be non-empty (to be enforced after this cleanup; see deferred-refactors item 2)
- `traceId` must be a valid UUID v4 when set
- `MANUAL_OVERRIDE` triggerType requires non-empty `reason`
- State-transition rows require `statusFrom` and `statusTo`

---

## 8. Deferred
- Action-name prefix convention (deferred-refactors item 2) would let us drop `workflowType` entirely. Not yet.
- SWAP cross-trace joining (deferred-refactors item 1) would let us delete the historical workaround. Not yet.
```

- [ ] **Step 3: Commit**

```bash
git add Exchange_js/docs/cleanup/deferred-refactors.md \
        Exchange_js/docs/constraints/audit-trace-context-constraints.md
git commit -m "docs(audit): add audit trace context constraints + deferred refactors registry"
```

---

## Task 2 — Frontend Verification section on Customer Detail

Independent of all backend changes. Ships visible value immediately.

**Files:**
- Modify: `Exchange_js/admin-web/src/pages/CustomerDetail.tsx`

**Verification:** manual via the running admin-web preview. Navigate to any customer's detail page, run a sumsub simulation in another tab, refresh, confirm the new Verification section renders.

- [ ] **Step 1: Extend `CustomerDetailData` interface with verification fields**

In `CustomerDetail.tsx`, add these fields to the `CustomerDetailData` interface (below `phone?: string | null;`):

```ts
  // Verification (Sumsub) snapshot
  verificationProvider?: string | null;
  verificationSubstatus?: string | null;
  verificationCustomerActionRequired?: boolean;
  verificationCanContinue?: boolean;
  verificationLatestEventType?: string | null;
  verificationLatestEventAt?: string | null;
  sumsubApplicantId?: string | null;
  sumsubCurrentLevelName?: string | null;
  sumsubLatestReviewId?: string | null;
  sumsubLatestAttemptId?: string | null;
  sumsubExperiencedLevel2?: boolean;
  onboardingTraceId?: string | null;
```

- [ ] **Step 2: Add `hasVerification` derived boolean**

Below the existing `hasFinalApproval` useMemo, add:

```ts
  const hasVerification = useMemo(
    () =>
      !!detail?.verificationProvider ||
      !!detail?.verificationSubstatus ||
      !!detail?.sumsubApplicantId,
    [detail],
  );
```

- [ ] **Step 3: Insert the Verification left-column section**

Locate the `{/* ③ Compliance Snapshot */}` section in the left main column. Immediately after its closing `</section>`, and immediately before `{hasRestriction && (`, insert:

```tsx
          {/* ④ Verification (Sumsub) */}
          {hasVerification && (
            <section className="px-6 py-5">
              <Cap>Verification</Cap>
              <p className="mt-1 mb-4 font-mono text-[9px] text-adm-t3">
                Identity provider snapshot — latest webhook event and SDK identifiers
              </p>
              <div className="mt-3 mb-4 flex flex-wrap items-center gap-2">
                <AdminBadge value={detail.verificationSubstatus || 'CREATED'} />
                {detail.sumsubExperiencedLevel2 && (
                  <span className="inline-flex items-center rounded border border-adm-blue/25 bg-adm-blue/10 px-1.5 py-px font-mono text-[9px] text-adm-blue">
                    EDD level2
                  </span>
                )}
              </div>
              <FieldGrid>
                <Field label="Provider" value={detail.verificationProvider ?? undefined} />
                <Field label="Current Level" value={detail.sumsubCurrentLevelName ?? undefined} />
                <Field
                  label="Latest Event"
                  value={detail.verificationLatestEventType ?? undefined}
                  mono
                />
                <Field
                  label="Latest Event At"
                  value={fmt(detail.verificationLatestEventAt)}
                  mono
                />
                <Field
                  label="Customer Action Required"
                  value={
                    detail.verificationCustomerActionRequired === undefined
                      ? undefined
                      : detail.verificationCustomerActionRequired
                        ? 'YES'
                        : 'NO'
                  }
                />
                <Field
                  label="Can Continue"
                  value={
                    detail.verificationCanContinue === undefined
                      ? undefined
                      : detail.verificationCanContinue
                        ? 'YES'
                        : 'NO'
                  }
                />
                <Field label="Applicant ID" value={detail.sumsubApplicantId ?? undefined} mono />
                <Field label="Latest Review ID" value={detail.sumsubLatestReviewId ?? undefined} mono />
                <Field label="Latest Attempt ID" value={detail.sumsubLatestAttemptId ?? undefined} mono />
                <Field label="Trace ID" value={detail.onboardingTraceId ?? undefined} mono full />
              </FieldGrid>
            </section>
          )}
```

- [ ] **Step 4: Add Verification sidebar group**

Between the existing `Status` sidebar group and the `Risk` sidebar group, insert:

```tsx
          {/* Verification */}
          <SidebarGroup title="Verification">
            <div className="flex items-center justify-between gap-2">
              <span className="shrink-0 font-mono text-[9px] text-adm-t3">Substatus</span>
              <AdminBadge value={detail.verificationSubstatus || 'CREATED'} />
            </div>
            <SidebarKV label="Level" value={detail.sumsubCurrentLevelName} mono />
            <SidebarKV label="Provider" value={detail.verificationProvider} />
            <SidebarKV label="Last Event" value={detail.verificationLatestEventType} mono />
            <SidebarKV label="Updated" value={fmt(detail.verificationLatestEventAt)} mono />
            <SidebarKV
              label="EDD Level2"
              value={detail.sumsubExperiencedLevel2 ? 'YES' : 'NO'}
            />
          </SidebarGroup>
```

- [ ] **Step 5: Manually verify in the running preview**

```
1. The admin-web preview server is already running. Navigate to /dashboard/customer/management.
2. Click any customer row → detail page loads.
3. Confirm the new "Verification" section appears in the left column (between Compliance and Restriction).
4. Confirm the new "Verification" sidebar group appears in the right column (between Status and Risk).
5. For brand-new customers (onboardingStatus = NONE), hasVerification is false and the section is hidden.
```

- [ ] **Step 6: Commit**

```bash
git add Exchange_js/admin-web/src/pages/CustomerDetail.tsx
git commit -m "feat(admin-web): show verification substatus + sumsub fields on Customer Detail"
```

---

## Task 3 — Schema: add `customer_main.onboardingTraceId`

Creates the single-purpose column that will hold the UUID v4 per-customer onboarding trace. Does not touch any read/write code yet — purely additive.

**Files:**
- Modify: `Exchange_js/prisma/schema.prisma`
- Create: `Exchange_js/prisma/migrations/20260408010000_add_customer_onboarding_trace_id/migration.sql`

**Verification:** `npm run build` succeeds; `prisma migrate deploy` applies cleanly; column exists in the dev DB.

- [ ] **Step 1: Add the column to `schema.prisma`**

Find the `CustomerMain` model in `prisma/schema.prisma` (around line 130-200). Below the `sumsubExperiencedLevel2` field (and above `operatingStatus` — pick a reasonable spot), add:

```prisma
  onboardingTraceId               String?
```

(Keep the existing `activeJourneyId` field for now — it will be removed in Task 7. The two columns coexist during the migration.)

- [ ] **Step 2: Create the migration file**

```bash
mkdir -p Exchange_js/prisma/migrations/20260408010000_add_customer_onboarding_trace_id
```

Create `Exchange_js/prisma/migrations/20260408010000_add_customer_onboarding_trace_id/migration.sql`:

```sql
-- Add single-purpose UUID column holding the onboarding sequence trace ID.
-- Populated at POST /onboarding/verification/start; inherited by every sumsub
-- webhook audit row.
ALTER TABLE "customer_main" ADD COLUMN "onboardingTraceId" TEXT;
```

SQLite supports plain `ADD COLUMN` for nullable columns on all versions — no table-recreate needed.

- [ ] **Step 3: Generate Prisma client + apply migration**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js
PATH="$HOME/.nvm/versions/node/v18.20.8/bin:$PATH" npx prisma generate
DATABASE_URL="file:/tmp/exchange_js_main/dev.db" \
PATH="$HOME/.nvm/versions/node/v18.20.8/bin:$PATH" \
  npx prisma migrate deploy 2>&1 | tail -5
```

Expected: "The following migration have been applied: 20260408010000_add_customer_onboarding_trace_id"

- [ ] **Step 4: Verify the column exists**

```bash
sqlite3 /tmp/exchange_js_main/dev.db "PRAGMA table_info(customer_main);" | grep -E "onboardingTraceId|activeJourneyId"
```

Expected: both columns listed (activeJourneyId will be removed later).

- [ ] **Step 5: Build the backend to confirm TypeScript compiles with the new Prisma types**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js
PATH="$HOME/.nvm/versions/node/v18.20.8/bin:$PATH" npm run build 2>&1 | tail -5
```

Expected: build succeeds. The new field is nullable and unreferenced so no code needs updating.

- [ ] **Step 6: Commit**

```bash
git add Exchange_js/prisma/schema.prisma \
        Exchange_js/prisma/migrations/20260408010000_add_customer_onboarding_trace_id/migration.sql
git commit -m "feat(schema): add customer_main.onboardingTraceId (single-purpose UUID trace column)"
```

---

## Task 4 — Backend: populate `onboardingTraceId` at `POST /onboarding/verification/start`

Wires the generation-at-entry-point rule from the constraints doc. After this task, every customer who calls Start Verification will have a traceId set that downstream audit writes can inherit.

**Files:**
- Modify: `Exchange_js/src/modules/identity/onboarding/onboarding.service.ts`
- Test: `Exchange_js/src/modules/identity/onboarding/onboarding.service.spec.ts`

**Verification:** new unit test asserts `onboardingTraceId` is set after `startVerification` returns.

- [ ] **Step 1: Import `randomUUID`**

Near the top of `onboarding.service.ts`, add to the `crypto` import (or create one if it doesn't exist):

```ts
import { randomUUID } from 'node:crypto';
```

(If `randomUUID` is already imported, skip this step.)

- [ ] **Step 2: Write the failing test**

In `onboarding.service.spec.ts`, find the existing `describe('startVerification')` block (or create one near the other `startVerification` tests). Add:

```ts
    it('assigns a fresh onboardingTraceId UUID the first time startVerification is called', async () => {
      const updateSpy = jest.spyOn(prismaMock.customerMain, 'update').mockImplementation(
        async (args: any) => ({ ...mockCustomer, ...args.data }),
      );

      await service.startVerification('cust-1');

      const updateCall = updateSpy.mock.calls.find(
        (call) => (call[0] as any).data.onboardingTraceId !== undefined,
      );
      expect(updateCall).toBeDefined();
      const assignedTraceId = (updateCall![0] as any).data.onboardingTraceId;
      // UUID v4 format: 8-4-4-4-12 hex chars with version 4
      expect(assignedTraceId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
    });

    it('reuses the existing onboardingTraceId if startVerification is called a second time', async () => {
      const existingTrace = '11111111-1111-4111-8111-111111111111';
      const customerWithTrace = { ...mockCustomer, onboardingTraceId: existingTrace };
      prismaMock.customerMain.findUnique.mockResolvedValueOnce(customerWithTrace);

      const updateSpy = jest.spyOn(prismaMock.customerMain, 'update').mockImplementation(
        async (args: any) => ({ ...customerWithTrace, ...args.data }),
      );

      await service.startVerification('cust-1');

      const updateCall = updateSpy.mock.calls[0];
      // Second call should NOT overwrite onboardingTraceId
      expect((updateCall[0] as any).data.onboardingTraceId).toBeUndefined();
    });
```

Note: the existing spec file has a `prismaMock` and a `mockCustomer` fixture — reuse them. If the existing test setup uses a different naming, match that.

- [ ] **Step 3: Run the tests — expect FAIL**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js
PATH="$HOME/.nvm/versions/node/v18.20.8/bin:$PATH" \
  npx jest src/modules/identity/onboarding/onboarding.service.spec.ts \
  -t 'onboardingTraceId' --no-coverage 2>&1 | tail -20
```

Expected: both new tests FAIL because `startVerification` doesn't touch `onboardingTraceId` yet.

- [ ] **Step 4: Modify `startVerification` to set the trace ID on first call**

Find `startVerification` in `onboarding.service.ts` (around line 1804). Locate the `updateData` construction block that currently sets `verificationProvider`, `sumsubApplicantId`, etc. Add the trace assignment **conditionally on the trace being absent**:

Find the existing code near the top of `updateData` assembly:

```ts
    const updateData: Prisma.CustomerMainUpdateInput = {
      ...this.buildCustomerLifecyclePatch(customer, {
        onboardingStatus: 'PENDING_VERIFICATION',
        operatingStatus: 'INACTIVE',
      }),
```

Immediately after this spread, add:

```ts
      ...(customer.onboardingTraceId ? {} : { onboardingTraceId: randomUUID() }),
```

- [ ] **Step 5: Run tests — expect PASS**

```bash
PATH="$HOME/.nvm/versions/node/v18.20.8/bin:$PATH" \
  npx jest src/modules/identity/onboarding/onboarding.service.spec.ts \
  -t 'onboardingTraceId' --no-coverage 2>&1 | tail -20
```

Expected: both tests PASS.

- [ ] **Step 6: Run the full onboarding.service test suite to catch regressions**

```bash
PATH="$HOME/.nvm/versions/node/v18.20.8/bin:$PATH" \
  npx jest src/modules/identity/onboarding/onboarding.service.spec.ts --no-coverage 2>&1 | tail -20
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add Exchange_js/src/modules/identity/onboarding/onboarding.service.ts \
        Exchange_js/src/modules/identity/onboarding/onboarding.service.spec.ts
git commit -m "feat(onboarding): assign onboardingTraceId UUID at startVerification"
```

---

## Task 5 — Backend: `writeSumsubAudit` helper + wire into `handleSumsubVerificationEvent`

Writes an `audit_log_events` row for every sumsub webhook event (real and simulated), using only `workflowType + traceId` (no `workflowId/workflowNo` — the new canonical shape per the constraints doc). Runs outside the transaction to match the 84 other recordByActor sites in the codebase.

**Files:**
- Modify: `Exchange_js/src/modules/identity/onboarding/onboarding.service.ts`
- Modify: `Exchange_js/src/modules/sumsub-ingestion/sumsub-ingestion.service.ts`
- Test: `Exchange_js/src/modules/identity/onboarding/onboarding.service.spec.ts`

**Verification:** unit tests asserting the audit-write spy is called with the right payload shape. End-to-end verification at Task 14.

- [ ] **Step 1: Add the event-to-action map constant**

At file scope near the top of `onboarding.service.ts` (above the class definition, below imports), add:

```ts
const SUMSUB_EVENT_ACTION_MAP: Record<string, string> = {
  applicantPending: 'SUMSUB_APPLICANT_PENDING',
  applicantOnHold: 'SUMSUB_APPLICANT_ON_HOLD',
  applicantReviewed: 'SUMSUB_APPLICANT_REVIEWED',
  applicantLevelChanged: 'SUMSUB_APPLICANT_LEVEL_CHANGED',
  applicantWorkflowCompleted: 'SUMSUB_APPLICANT_WORKFLOW_COMPLETED',
  applicantWorkflowFailed: 'SUMSUB_APPLICANT_WORKFLOW_FAILED',
};

const SUMSUB_DEFAULT_ACTION = 'SUMSUB_APPLICANT_EVENT';
```

These action names satisfy `/^[A-Z0-9]+(?:_[A-Z0-9]+)*$/`. Using `DATA_UPDATE` triggerType (Task 5 Step 3 below) avoids the `SYSTEM_`/`MANUAL_` prefix constraints.

- [ ] **Step 2: Add the `writeSumsubAudit` private method**

Insert this private method directly after the existing `writeAudit` method (around line 1124, before `private async getCustomerOrThrow`):

```ts
  /**
   * Writes one audit_log_events row for a sumsub webhook step.
   * Called from handleSumsubVerificationEvent, AFTER the prisma.$transaction
   * has committed (matching the 84 other non-atomic audit-write sites in the
   * codebase). Uses workflowType + traceId only — no workflowId/workflowNo,
   * per docs/constraints/audit-trace-context-constraints.md.
   */
  private async writeSumsubAudit(input: {
    customerId: string;
    customerNo: string | null;
    onboardingTraceId: string | null;
    eventType: string;
    simulated: boolean;
    simulatedByUserId: string | null;
    onboardingStatusFrom: string | null;
    onboardingStatusTo: string | null;
    substatusFrom: string | null;
    substatusTo: string | null;
    levelName: string | null;
    reviewAnswer: string | null;
    reviewRejectType: string | null;
    applicantId: string | null;
    reviewId: string | null;
    attemptId: string | null;
  }) {
    const action = SUMSUB_EVENT_ACTION_MAP[input.eventType] || SUMSUB_DEFAULT_ACTION;
    const reason = input.simulated
      ? `Simulated sumsub event ${input.eventType} (substatus ${input.substatusFrom || '∅'} → ${input.substatusTo || '∅'})`
      : `Sumsub webhook ${input.eventType} (substatus ${input.substatusFrom || '∅'} → ${input.substatusTo || '∅'})`;

    try {
      await this.auditLogsService.recordByActor(
        {
          triggerType: AuditTriggerType.DATA_UPDATE,
          action,
          module: AuditModules.ONBOARDING,
          entityType: AuditEntityTypes.ONBOARDING,
          entityId: input.customerId,
          entityNo: input.customerNo || undefined,
          entityOwnerType: 'CUSTOMER',
          entityOwnerId: input.customerId,
          entityOwnerNo: input.customerNo || undefined,
          traceId: input.onboardingTraceId || undefined,
          workflowType: AuditWorkflowTypes.ONBOARDING,
          statusFrom: input.onboardingStatusFrom || undefined,
          statusTo: input.onboardingStatusTo || undefined,
          reason,
          metadata: {
            eventType: input.eventType,
            substatusFrom: input.substatusFrom,
            substatusTo: input.substatusTo,
            levelName: input.levelName,
            reviewAnswer: input.reviewAnswer,
            reviewRejectType: input.reviewRejectType,
            applicantId: input.applicantId,
            reviewId: input.reviewId,
            attemptId: input.attemptId,
            isSimulated: input.simulated,
            simulatedByUserId: input.simulatedByUserId,
            source: 'SUMSUB_INGESTION',
          },
          sourcePlatform: 'APPLICATION',
        },
        {
          actorType: input.simulated ? 'ADMIN' : 'SYSTEM',
          actorId: input.simulated
            ? input.simulatedByUserId || 'ADMIN_SIM'
            : 'SUMSUB',
          actorRole: input.simulated ? 'ADMIN' : 'SYSTEM',
        },
      );
    } catch (err) {
      // Match the existing pattern in approvals/payouts/customer-auth: audit
      // write failures don't fail the business operation. Log and continue.
      this.logger.error(
        `Failed to write sumsub audit for customer ${input.customerId} event ${input.eventType}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
```

- [ ] **Step 3: Capture before-state inside `handleSumsubVerificationEvent`, call audit after transaction**

Find `handleSumsubVerificationEvent` (around line 182 of `onboarding.service.ts`). The current shape is:

```ts
return this.prisma.$transaction(async (tx) => {
  const customer = await ...;
  // ... terminal state guard ...
  // ... compute updateData ...
  const updatedCustomer = await tx.customerMain.update({...});
  return { customer: {...}, verification: ... };
});
```

Refactor it to capture the transaction result, then write audit outside:

Before the `return this.prisma.$transaction` line, declare:

```ts
    let txResult: {
      customer: Parameters<typeof this.buildCustomerSnapshot>[0];
      before: {
        onboardingStatus: string | null;
        substatus: string | null;
      };
      resolved: {
        nextLevelName: string | null;
        reviewResult: { reviewAnswer: string | null; reviewRejectType: string | null };
        reviewId: string | null;
        attemptId: string | null;
      };
    } | null = null;
```

Then inside the transaction, before the final `return`, assign to `txResult`:

```ts
      txResult = {
        customer: updatedCustomer,
        before: {
          onboardingStatus: this.normalizeOptionalString(customer.onboardingStatus),
          substatus: this.normalizeOptionalString(customer.verificationSubstatus),
        },
        resolved: {
          nextLevelName,
          reviewResult: {
            reviewAnswer: reviewResult.reviewAnswer || null,
            reviewRejectType: reviewResult.reviewRejectType || null,
          },
          reviewId,
          attemptId,
        },
      };
```

And the transaction's `return` becomes:

```ts
      return {
        customer: {
          onboardingStatus: updatedCustomer.onboardingStatus ?? null,
          operatingStatus: updatedCustomer.operatingStatus ?? null,
          restrictionStatus: updatedCustomer.restrictionStatus ?? null,
        },
        verification: this.buildVerificationProjection(updatedCustomer),
      };
```

(unchanged from current)

Now OUTSIDE the `this.prisma.$transaction(...)` call — after it awaits and you have the return value — add:

```ts
    const result = await this.prisma.$transaction(async (tx) => { /* existing body */ });

    if (txResult) {
      await this.writeSumsubAudit({
        customerId: txResult.customer.id,
        customerNo: txResult.customer.customerNo || null,
        onboardingTraceId: txResult.customer.onboardingTraceId || null,
        eventType,
        simulated: context.simulated === true,
        simulatedByUserId:
          context.simulated === true
            ? this.normalizeOptionalString(context.simulatedByUserId) ||
              this.normalizeOptionalString(context.actorId)
            : null,
        onboardingStatusFrom: txResult.before.onboardingStatus,
        onboardingStatusTo: this.normalizeOptionalString(txResult.customer.onboardingStatus),
        substatusFrom: txResult.before.substatus,
        substatusTo: this.normalizeOptionalString(txResult.customer.verificationSubstatus),
        levelName: txResult.resolved.nextLevelName,
        reviewAnswer: txResult.resolved.reviewResult.reviewAnswer,
        reviewRejectType: txResult.resolved.reviewResult.reviewRejectType,
        applicantId: this.resolveSumsubApplicantId(payload, context),
        reviewId: txResult.resolved.reviewId,
        attemptId: txResult.resolved.attemptId,
      });
    }

    return result;
```

The early-return path for terminal states (APPROVED / FINAL_APPROVAL / REJECTED / WITHDRAWN) should skip the audit write — already handled because `txResult` stays null in that branch.

- [ ] **Step 4: Pass `simulatedByUserId` from the ingestion service**

Open `Exchange_js/src/modules/sumsub-ingestion/sumsub-ingestion.service.ts`. Find the `dispatch` method. Find the current call:

```ts
        result = await this.onboardingService.handleSumsubVerificationEvent(payload, {
          simulated: event.isSimulated,
          actorId: event.isSimulated
            ? (event.externalUserId || event.simulatedByUserId || 'ADMIN_SIM')
            : 'SUMSUB',
          rawBody: Buffer.from(JSON.stringify(payload)),
        });
```

Replace with:

```ts
        result = await this.onboardingService.handleSumsubVerificationEvent(payload, {
          simulated: event.isSimulated,
          actorId: event.isSimulated
            ? (event.externalUserId || event.simulatedByUserId || 'ADMIN_SIM')
            : 'SUMSUB',
          simulatedByUserId: event.simulatedByUserId || null,
          rawBody: Buffer.from(JSON.stringify(payload)),
        });
```

- [ ] **Step 5: Add unit test for real webhook audit write**

In `onboarding.service.spec.ts`, add a test after the existing `applicantOnHold` test:

```ts
    it('writes a DATA_UPDATE audit row for a real applicantOnHold webhook with traceId from customer', async () => {
      const existingTrace = '22222222-2222-4222-8222-222222222222';
      const customerWithTrace = {
        ...mockCustomer,
        onboardingTraceId: existingTrace,
        customerNo: 'CU-0001',
        onboardingStatus: 'PENDING_VERIFICATION',
        verificationSubstatus: 'SUBMITTED',
      };
      prismaMock.customerMain.findUnique.mockResolvedValue(customerWithTrace);
      // ensure update returns the customer with new substatus
      jest.spyOn(prismaMock.customerMain, 'update').mockResolvedValue({
        ...customerWithTrace,
        verificationSubstatus: 'UNDER_REVIEW',
        verificationLatestEventType: 'applicantOnHold',
      } as any);

      const recordByActorSpy = jest.spyOn(
        (service as any).auditLogsService,
        'recordByActor',
      );
      recordByActorSpy.mockResolvedValue({} as any);

      await service.handleSumsubVerificationEvent(
        {
          type: 'applicantOnHold',
          externalUserId: 'cust-1',
          applicantId: 'APPL-1',
        },
        {
          simulated: false,
          actorId: 'SUMSUB',
        },
      );

      expect(recordByActorSpy).toHaveBeenCalledTimes(1);
      const [auditInput, actor] = recordByActorSpy.mock.calls[0];
      expect(auditInput.action).toBe('SUMSUB_APPLICANT_ON_HOLD');
      expect(auditInput.triggerType).toBe('DATA_UPDATE');
      expect(auditInput.module).toBe('identity/onboarding');
      expect(auditInput.entityType).toBe('ONBOARDING');
      expect(auditInput.entityId).toBe('cust-1');
      expect(auditInput.traceId).toBe(existingTrace);
      expect(auditInput.workflowType).toBe('ONBOARDING');
      // workflowId and workflowNo MUST NOT be set (new rule)
      expect((auditInput as any).workflowId).toBeUndefined();
      expect((auditInput as any).workflowNo).toBeUndefined();
      expect(auditInput.statusTo).toBe('PENDING_VERIFICATION');
      expect((auditInput.metadata as any).eventType).toBe('applicantOnHold');
      expect((auditInput.metadata as any).substatusFrom).toBe('SUBMITTED');
      expect((auditInput.metadata as any).substatusTo).toBe('UNDER_REVIEW');
      expect((auditInput.metadata as any).isSimulated).toBe(false);
      expect(actor.actorId).toBe('SUMSUB');
      expect(actor.actorType).toBe('SYSTEM');
    });

    it('writes a DATA_UPDATE audit row with ADMIN actorType for a simulated event', async () => {
      const customerWithTrace = {
        ...mockCustomer,
        onboardingTraceId: '33333333-3333-4333-8333-333333333333',
        customerNo: 'CU-0001',
        onboardingStatus: 'PENDING_VERIFICATION',
      };
      prismaMock.customerMain.findUnique.mockResolvedValue(customerWithTrace);
      jest.spyOn(prismaMock.customerMain, 'update').mockResolvedValue(customerWithTrace as any);

      const recordByActorSpy = jest.spyOn(
        (service as any).auditLogsService,
        'recordByActor',
      );
      recordByActorSpy.mockResolvedValue({} as any);

      await service.handleSumsubVerificationEvent(
        {
          type: 'applicantOnHold',
          externalUserId: 'cust-1',
        },
        {
          simulated: true,
          actorId: 'cust-1',
          simulatedByUserId: 'admin-uuid-42',
        },
      );

      expect(recordByActorSpy).toHaveBeenCalledTimes(1);
      const [auditInput, actor] = recordByActorSpy.mock.calls[0];
      expect(auditInput.action).toBe('SUMSUB_APPLICANT_ON_HOLD');
      expect((auditInput.metadata as any).isSimulated).toBe(true);
      expect((auditInput.metadata as any).simulatedByUserId).toBe('admin-uuid-42');
      expect(actor.actorType).toBe('ADMIN');
      expect(actor.actorId).toBe('admin-uuid-42');
      expect(auditInput.reason).toContain('Simulated sumsub event applicantOnHold');
    });
```

- [ ] **Step 6: Run the new tests**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js
PATH="$HOME/.nvm/versions/node/v18.20.8/bin:$PATH" \
  npx jest src/modules/identity/onboarding/onboarding.service.spec.ts \
  -t 'audit row' --no-coverage 2>&1 | tail -20
```

Expected: both new audit tests pass.

- [ ] **Step 7: Run full onboarding suite**

```bash
PATH="$HOME/.nvm/versions/node/v18.20.8/bin:$PATH" \
  npx jest src/modules/identity/onboarding --no-coverage 2>&1 | tail -20
```

Expected: all tests pass.

- [ ] **Step 8: Commit**

```bash
git add Exchange_js/src/modules/identity/onboarding/onboarding.service.ts \
        Exchange_js/src/modules/identity/onboarding/onboarding.service.spec.ts \
        Exchange_js/src/modules/sumsub-ingestion/sumsub-ingestion.service.ts
git commit -m "feat(onboarding): write audit_log_events for every sumsub webhook step"
```

---

## Task 6 — Backend: replace `activeJourneyId` with `customer.id` / `onboardingTraceId`

Strips all read/write sites for `activeJourneyId` across the 3 onboarding services. After this task, `activeJourneyId` is dead data — the column still exists in the DB but nothing reads or writes it. The column itself is dropped in Task 8.

**Files:**
- Modify: `Exchange_js/src/modules/identity/onboarding/onboarding.service.ts`
- Modify: `Exchange_js/src/modules/identity/onboarding/onboarding-final-approval.service.ts`
- Modify: `Exchange_js/src/modules/identity/onboarding/onboarding-workflow-transition.service.ts`

**Verification:** `npm run build` + `npx jest src/modules/identity/onboarding` must pass.

**Replacement rules summary:**

| Pattern | Replace with |
|---|---|
| `customer.activeJourneyId \|\| generateReferenceNo('ONB')` | `customer.id` |
| `customer.activeJourneyId` (plain read) | `customer.id` |
| `activeJourneyId: X,` (Prisma write) | DELETE the line |
| `{ activeJourneyId: true }` (Prisma select) | DELETE the line |
| `activeJourneyId?: string \| null;` (TS interface field) | DELETE the line |
| `buildTraceContext(customer.activeJourneyId)` | `buildTraceContext(customer.id)` |
| `{ workflowType, workflowId: activeJourneyId, workflowNo: activeJourneyId }` (in approvals.createAndSubmit inputs) | `{ workflowType: ONBOARDING_WORKFLOW }` — drop the id/no fields entirely, since Task 11 removes them from the DTO |

- [ ] **Step 1: `onboarding-final-approval.service.ts` — replace all 12 occurrences**

Open the file. Apply these edits (line numbers from the 2026-04-08 grep):

- Line 42 (interface field): DELETE `activeJourneyId?: string | null;`
- Line 66 (Prisma select): DELETE `activeJourneyId: true,`
- Line 307 (conditional journeyId spread): replace
  ```ts
  ...(customer.activeJourneyId ? { journeyId: customer.activeJourneyId } : {}),
  ```
  with:
  ```ts
  journeyId: customer.id,
  ```
- Line 317 (traceId derivation):
  ```ts
  traceId: this.buildTraceContext(customer.activeJourneyId)?.traceId || undefined,
  ```
  →
  ```ts
  traceId: this.buildTraceContext(customer.id)?.traceId || undefined,
  ```
- Lines 319-326 (the conditional workflow fields block):
  ```ts
  // All three workflow fields must be provided together or not at all.
  // When activeJourneyId is absent (e.g. simulated flows), omit all three.
  ...(customer.activeJourneyId
    ? {
        workflowType: ONBOARDING_WORKFLOW,
        workflowId: customer.activeJourneyId,
        workflowNo: customer.activeJourneyId,
      }
    : {}),
  ```
  →
  ```ts
  workflowType: ONBOARDING_WORKFLOW,
  ```
  (Just pass workflowType. workflowId/workflowNo are removed from the DTO in Task 11.)
- Line 331 (metadata journey):
  ```ts
  journeyId: customer.activeJourneyId || null,
  ```
  →
  ```ts
  journeyId: customer.id,
  ```
- Line 399 (another conditional spread):
  ```ts
  ...(customer.activeJourneyId ? { journeyId: customer.activeJourneyId } : {}),
  ```
  →
  ```ts
  journeyId: customer.id,
  ```
- Line 415:
  ```ts
  journeyId: customer.activeJourneyId || null,
  ```
  →
  ```ts
  journeyId: customer.id,
  ```
- Line 598:
  ```ts
  customer.activeJourneyId || null,
  ```
  →
  ```ts
  customer.id,
  ```

Verify no references remain:

```bash
grep -n "activeJourneyId" Exchange_js/src/modules/identity/onboarding/onboarding-final-approval.service.ts
```

Expected: zero matches.

- [ ] **Step 2: Run the final-approval service spec**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js
PATH="$HOME/.nvm/versions/node/v18.20.8/bin:$PATH" \
  npx jest src/modules/identity/onboarding/onboarding-final-approval.service.spec.ts --no-coverage 2>&1 | tail -20
```

Expected: tests pass. (Spec mocks still have `activeJourneyId: 'ONB-1'` as a harmless extra field — no TypeScript error until we drop the column in Task 8.)

- [ ] **Step 3: `onboarding-workflow-transition.service.ts` — replace all 6 occurrences**

- Line 257 (conditional spread): replace `...(customer.activeJourneyId ? { journeyId: customer.activeJourneyId } : {}),` with `journeyId: customer.id,`
- Line 293 (same pattern): same replacement
- Line 369 (fallback chain):
  ```ts
  input.journeyId || customer.activeJourneyId || null,
  ```
  →
  ```ts
  input.journeyId || customer.id,
  ```
- Line 527 (write to customer_main):
  ```ts
  activeJourneyId: input.journeyId,
  ```
  DELETE the entire line.
- Line 568 (fallback with generator):
  ```ts
  input.journeyId || customer.activeJourneyId || generateReferenceNo('ONB'),
  ```
  →
  ```ts
  input.journeyId || customer.id,
  ```
- Line 620 (another write):
  ```ts
  activeJourneyId: input.journeyId || customer.activeJourneyId || null,
  ```
  DELETE the entire line.

Verify:

```bash
grep -n "activeJourneyId" Exchange_js/src/modules/identity/onboarding/onboarding-workflow-transition.service.ts
```

Expected: zero matches.

- [ ] **Step 4: `onboarding.service.ts` — replace all 22 occurrences**

This file has more sites. Apply by category:

**Category A — DELETE entire line (3 sites):**
- Line 667: `activeJourneyId?: string | null;`
- Line 1079: `activeJourneyId: true,`
- Line 2211: change `findLatestOnboardingEddResponse(customerId, customer.activeJourneyId)` → `findLatestOnboardingEddResponse(customerId, customer.id)` (this one is NOT a delete — it's a parameter substitution)

**Category B — REPLACE read with `customer.id` (12 sites):**

Lines 678, 686, 1085 (in `writeAudit`), 1333, 1394, 1494, 1660, 2123, 2253, 2483, 2576, 3241.

Each looks like one of these patterns:
- `customer.activeJourneyId,` → `customer.id,`
- `customer?.activeJourneyId || null` → `customer?.id || null`
- `cddResponse.journeyId || customer.activeJourneyId || generateReferenceNo('ONB')` → `cddResponse.journeyId || customer.id`
- `eddResponse.journeyId || customer.activeJourneyId || generateReferenceNo('ONB')` → `eddResponse.journeyId || customer.id`
- `String(customer.activeJourneyId || '').trim()` → `customer.id`

Apply the nearest-matching rule from the table at the top of this task.

**Category C — DELETE write line (7 sites):**

Lines 1343, 1356, 1403, 2152, 2278, 2538, 2621 — each is a `activeJourneyId: journeyId,` line inside a Prisma update/create data object. DELETE each.

**Verify:**

```bash
grep -n "activeJourneyId" Exchange_js/src/modules/identity/onboarding/onboarding.service.ts
```

Expected: zero matches.

- [ ] **Step 5: TypeScript build**

```bash
PATH="$HOME/.nvm/versions/node/v18.20.8/bin:$PATH" npm run build 2>&1 | tail -10
```

Expected: build succeeds.

- [ ] **Step 6: Full onboarding test suite**

```bash
PATH="$HOME/.nvm/versions/node/v18.20.8/bin:$PATH" \
  npx jest src/modules/identity/onboarding --no-coverage 2>&1 | tail -20
```

Expected: all tests pass. Spec files still contain `activeJourneyId: 'ONB-1'` on mock customers — those are harmless extra properties until Task 7 strips them.

- [ ] **Step 7: Commit**

```bash
git add Exchange_js/src/modules/identity/onboarding/onboarding.service.ts \
        Exchange_js/src/modules/identity/onboarding/onboarding-final-approval.service.ts \
        Exchange_js/src/modules/identity/onboarding/onboarding-workflow-transition.service.ts
git commit -m "refactor(onboarding): collapse activeJourneyId onto customer.id and drop workflowId/No"
```

---

## Task 7 — Strip `activeJourneyId` from spec mocks

**Files:**
- Modify: `Exchange_js/src/modules/identity/onboarding/onboarding.service.spec.ts`
- Modify: `Exchange_js/src/modules/identity/onboarding/onboarding-final-approval.service.spec.ts`

- [ ] **Step 1: Delete every line containing `activeJourneyId` from both spec files**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js
sed -i '' '/activeJourneyId/d' src/modules/identity/onboarding/onboarding.service.spec.ts
sed -i '' '/activeJourneyId/d' src/modules/identity/onboarding/onboarding-final-approval.service.spec.ts
grep -c "activeJourneyId" src/modules/identity/onboarding/onboarding.service.spec.ts
grep -c "activeJourneyId" src/modules/identity/onboarding/onboarding-final-approval.service.spec.ts
```

Expected: both counts are `0`.

- [ ] **Step 2: Run onboarding test suite**

```bash
PATH="$HOME/.nvm/versions/node/v18.20.8/bin:$PATH" \
  npx jest src/modules/identity/onboarding --no-coverage 2>&1 | tail -10
```

Expected: all tests pass. If any test asserted `workflowId === 'ONB-1'`, fix it to use the customer.id from the mock fixture.

- [ ] **Step 3: Commit**

```bash
git add Exchange_js/src/modules/identity/onboarding/onboarding.service.spec.ts \
        Exchange_js/src/modules/identity/onboarding/onboarding-final-approval.service.spec.ts
git commit -m "test(onboarding): drop activeJourneyId from spec mocks"
```

---

## Task 8 — Schema: drop `customer_main.activeJourneyId`

With all reads and writes removed in Tasks 6-7, the column is safe to drop.

**Files:**
- Modify: `Exchange_js/prisma/schema.prisma`
- Create: `Exchange_js/prisma/migrations/20260408020000_drop_customer_active_journey_id/migration.sql`

- [ ] **Step 1: Remove the field from `schema.prisma`**

At line 172 of `schema.prisma`, delete:

```prisma
  activeJourneyId                 String?
```

- [ ] **Step 2: Generate Prisma client**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js
PATH="$HOME/.nvm/versions/node/v18.20.8/bin:$PATH" npx prisma generate 2>&1 | tail -5
```

Expected: success.

- [ ] **Step 3: Verify the current live column list against what the migration will preserve**

Before writing the migration, capture the current column list from the live DB:

```bash
sqlite3 /tmp/exchange_js_main/dev.db "PRAGMA table_info(customer_main);" | awk -F'|' '{print "    \""$2"\","}' | head -80
```

Inspect the output. The migration file below preserves every column EXCEPT `activeJourneyId`. If your live DB has columns not in the list below, add them to the SELECT list before running.

- [ ] **Step 4: Create the migration file**

```bash
mkdir -p Exchange_js/prisma/migrations/20260408020000_drop_customer_active_journey_id
```

Create `Exchange_js/prisma/migrations/20260408020000_drop_customer_active_journey_id/migration.sql`:

```sql
-- Drop customer_main.activeJourneyId via SQLite table-recreate.
-- The column was a free-floating trace identifier overloaded for three
-- different jobs (audit trace, CDD/EDD response grouping, workflow handle).
-- Those jobs now use customer.id (for sequence grouping) and
-- customer.onboardingTraceId (for audit traces).
PRAGMA foreign_keys = OFF;

CREATE TABLE "customer_main_new" AS
SELECT
    "id", "customerNo", "userNo", "email", "password", "passwordUpdatedAt",
    "phone", "emailVerifiedAt", "phoneVerifiedAt", "firstName", "lastName",
    "companyName", "riskScore", "riskLevel", "riskUpdatedAt", "failedLoginCount",
    "lockedUntil", "lastLoginAt", "lastLoginIp", "locale", "timezone",
    "termsAcceptedAt", "customerType", "onboardingStatus", "verificationProvider",
    "verificationSubstatus", "verificationCustomerActionRequired",
    "verificationCanContinue", "verificationLatestEventType",
    "verificationLatestEventAt", "sumsubApplicantId", "sumsubCurrentLevelName",
    "sumsubLatestReviewId", "sumsubLatestAttemptId", "sumsubExperiencedLevel2",
    "operatingStatus", "restrictionStatus", "restrictionCaseId",
    "restrictionReason", "restrictionSetAt", "restrictionReleasedAt",
    "amlRiskTier", "eddRequired", "complianceHoldStatus",
    "complianceHoldCaseId", "complianceHoldReason", "complianceHoldSetAt",
    "complianceHoldReleasedAt", "cddDocumentExpiresAt",
    "latestFinalApprovalId", "latestFinalApprovalStatus", "nextReviewAt",
    "activePeriodicReviewCycleId", "periodicReviewOverdueAt",
    "periodicReviewOverdueReason", "latestDecisionRecordId",
    "investorClassification", "investorClassificationSource",
    "investorClassificationUpdatedAt", "onboardingTraceId",
    "createdAt", "updatedAt"
FROM "customer_main";

DROP TABLE "customer_main";
ALTER TABLE "customer_main_new" RENAME TO "customer_main";

-- Recreate indexes (mirror the original table).
CREATE UNIQUE INDEX "customer_main_customerNo_key" ON "customer_main"("customerNo");
CREATE UNIQUE INDEX "customer_main_userNo_key" ON "customer_main"("userNo");
CREATE UNIQUE INDEX "customer_main_email_key" ON "customer_main"("email");
CREATE UNIQUE INDEX "customer_main_phone_key" ON "customer_main"("phone");
CREATE UNIQUE INDEX "customer_main_sumsubApplicantId_key" ON "customer_main"("sumsubApplicantId");
CREATE UNIQUE INDEX "customer_main_latestFinalApprovalId_key" ON "customer_main"("latestFinalApprovalId");
CREATE UNIQUE INDEX "customer_main_activePeriodicReviewCycleId_key" ON "customer_main"("activePeriodicReviewCycleId");
CREATE UNIQUE INDEX "customer_main_latestDecisionRecordId_key" ON "customer_main"("latestDecisionRecordId");

PRAGMA foreign_keys = ON;
```

**Before running**: verify the live index list matches your CREATE INDEX statements:

```bash
sqlite3 /tmp/exchange_js_main/dev.db "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='customer_main' AND name NOT LIKE 'sqlite_%';"
```

Reconcile any differences before applying.

- [ ] **Step 5: Apply migration**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js
DATABASE_URL="file:/tmp/exchange_js_main/dev.db" \
PATH="$HOME/.nvm/versions/node/v18.20.8/bin:$PATH" \
  npx prisma migrate deploy 2>&1 | tail -5
```

Expected: migration applied.

- [ ] **Step 6: Verify**

```bash
sqlite3 /tmp/exchange_js_main/dev.db "PRAGMA table_info(customer_main);" | grep -c activeJourneyId
sqlite3 /tmp/exchange_js_main/dev.db "PRAGMA table_info(customer_main);" | grep -c onboardingTraceId
```

Expected: `0` for the first (dropped), `1` for the second (kept).

- [ ] **Step 7: Rebuild + run onboarding tests**

```bash
PATH="$HOME/.nvm/versions/node/v18.20.8/bin:$PATH" npm run build 2>&1 | tail -5
PATH="$HOME/.nvm/versions/node/v18.20.8/bin:$PATH" \
  npx jest src/modules/identity/onboarding --no-coverage 2>&1 | tail -10
```

Expected: both succeed.

- [ ] **Step 8: Commit**

```bash
git add Exchange_js/prisma/schema.prisma \
        Exchange_js/prisma/migrations/20260408020000_drop_customer_active_journey_id/migration.sql
git commit -m "refactor(schema): drop customer_main.activeJourneyId column"
```

---

## Task 9 — Strip `workflowId`/`workflowNo` from all 32 service call sites

The big mechanical sweep. After this task, no service in the codebase passes `workflowId` or `workflowNo` to `recordByActor`/`recordSystem`. The fields are still on the DTO and the schema at this point — removed in Tasks 10-11.

**Files (32 services — full list in the File Structure section above):**

- [ ] **Step 1: Remove `workflowId:` lines from all service files**

Run this search-and-delete:

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js
for f in $(grep -rln "workflowId:" src --include="*.service.ts" | grep -v spec); do
  echo "Processing $f"
  # Delete lines that start with (optional whitespace) `workflowId:` — inside object literals
  sed -i '' '/^[[:space:]]*workflowId: /d' "$f"
done
```

- [ ] **Step 2: Remove `workflowNo:` lines from all service files**

```bash
for f in $(grep -rln "workflowNo:" src --include="*.service.ts" | grep -v spec); do
  echo "Processing $f"
  sed -i '' '/^[[:space:]]*workflowNo: /d' "$f"
done
```

- [ ] **Step 3: Verify no call-site still references them**

```bash
grep -rn "workflowId:\|workflowNo:" src --include="*.service.ts" 2>/dev/null | grep -v spec | grep -v "audit-logs.service.ts" | grep -v "audit-log.dto.ts"
```

Expected: zero matches **outside** of `audit-logs.service.ts` and `audit-log.dto.ts` (those two files are the schema/type definitions themselves, cleaned up in Task 11).

- [ ] **Step 4: Build — may need manual patching**

```bash
PATH="$HOME/.nvm/versions/node/v18.20.8/bin:$PATH" npm run build 2>&1 | tail -30
```

Expected: build succeeds. If it fails because of a half-deleted object literal (e.g. a trailing comma on a remaining field), fix manually. The most likely issue is a service that had `workflowId` on its own line followed by another field — sed should leave the file valid.

Also check for InternalAuditContext types that still reference `workflowNo` as a type field:

```bash
grep -rn "workflowNo\?:\|workflowId\?:" src --include="*.ts" 2>/dev/null | grep -v spec | grep -v "audit-log.dto.ts"
```

Every match is a type definition (e.g. `InternalAuditContext`) that should also drop the field. Edit each manually. The known locations:
- `src/modules/identity/access-control/access-control.service.ts` — `InternalAuditContext` type
- `src/modules/identity/users/admin-invitations.service.ts` — `InternalAuditContext` type and its `findLatestInvitationAuditContext` helpers
- Any other service that declares a local `InternalAuditContext`-like interface

In each, remove the `workflowNo?: string;` field from the interface. Keep `workflowType` and `traceId`.

- [ ] **Step 5: Run the full backend test suite**

```bash
PATH="$HOME/.nvm/versions/node/v18.20.8/bin:$PATH" npx jest --no-coverage 2>&1 | tail -30
```

Expected: most tests pass. A handful may fail because spec files assert on the removed fields — fix by removing the assertions or updating them.

- [ ] **Step 6: Commit**

```bash
git add Exchange_js/src
git commit -m "refactor(audit): stop writing workflowId/workflowNo to audit_log_events (32 services)"
```

---

## Task 10 — Move approval parent pointer into audit metadata

Approvals are the one flow where `entityId` (`approval.id`) differs from the "sequence primary entity" (the parent change ticket or delete request). Today this is expressed as `workflowId = parent.id`. After the cleanup, it lives in `metadata.parentEntityType / parentEntityId / parentEntityNo`.

**Files:**
- Modify: `Exchange_js/src/modules/governance/approvals/approvals.service.ts`
- Modify: `Exchange_js/src/modules/governance/approvals/audit-evidence-export-approval.service.ts`

- [ ] **Step 1: Find the audit write block in `approvals.service.ts`**

Locate the `recordByActor` call inside the method that writes approval state-change audit rows (around line 336). The current shape (after Task 9's sweep) has `workflowId`/`workflowNo` removed but the parent info is lost.

Find where the approval's `workflowType/Id/No` are computed (look for `workflowContext` or `parentWorkflowContext` — the computed object used to populate approval_cases.workflowType etc.). The parent pointer data lives there.

Edit the audit write payload to add the parent pointer into metadata:

```ts
metadata: {
  approvalNo: approval.approvalNo,
  actionType: approval.actionType,
  entityRef: approval.entityRef,
  executionStatus: approval.executionStatus,
  // NEW: explicit parent pointer per audit-trace-context-constraints §4
  ...(approval.workflowType && approval.workflowId
    ? {
        parentEntityType: approval.workflowType,
        parentEntityId: approval.workflowId,
        parentEntityNo: approval.workflowNo,
      }
    : {}),
  ...(metadata || {}),
},
```

(Note: `approval.workflowType/workflowId/workflowNo` are columns on `approval_cases` — they persist the parent pointer for the approval case's own business logic. They are NOT audit_log_events columns. We're just reading them from the approval row and putting them into the audit row's metadata.)

- [ ] **Step 2: Apply the same pattern to `audit-evidence-export-approval.service.ts`**

Find the two `recordByActor` calls (around lines 170, 233, 338 per the earlier grep). In each, add the metadata parent pointer:

```ts
metadata: {
  // ... existing metadata ...
  ...(evidencePackage.approvalCase?.traceId
    ? {
        parentEntityType: 'APPROVAL_CASE',
        parentEntityId: evidencePackage.approvalCase.id,
        parentEntityNo: evidencePackage.approvalCase.approvalNo,
      }
    : {}),
},
```

Reference the evidence package's `approvalCase` include.

- [ ] **Step 3: Run the approvals test suite**

```bash
PATH="$HOME/.nvm/versions/node/v18.20.8/bin:$PATH" \
  npx jest src/modules/governance/approvals --no-coverage 2>&1 | tail -20
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add Exchange_js/src/modules/governance/approvals
git commit -m "refactor(approvals): move parent-entity pointer into audit metadata"
```

---

## Task 11 — Remove `workflowId`/`workflowNo` from DTO + audit-logs service internals

With all call sites clean (Task 9) and the parent pointer moved to metadata (Task 10), the fields are safe to delete from the DTO, the internal audit-logs service logic, and the SWAP expansion helper.

**Files:**
- Modify: `Exchange_js/src/modules/risk-engine/audit-logs/dto/audit-log.dto.ts`
- Modify: `Exchange_js/src/modules/risk-engine/audit-logs/audit-logs.service.ts`

- [ ] **Step 1: Remove `workflowId` and `workflowNo` from `CreateAuditLogEventDto`**

In `audit-log.dto.ts`, find the `CreateAuditLogEventDto` class. Delete the `workflowId` and `workflowNo` field declarations.

Also delete them from `AuditLogQueryDto` (the query-filter DTO).

Also delete from any `AuditLogView` type and the `mapEvent` helper output.

- [ ] **Step 2: Remove `workflowId`/`workflowNo` from `audit-logs.service.ts` internal logic**

This is the largest single-file edit. Walk through in order:

1. **Internal type definitions** (around line 60): remove `workflowType/workflowNos` + `workflowId`/`workflowNo` from any internal interfaces.
2. **Column projection in `recordByActor` → `resolveDepositWorkflowContext`** (around line 463-500): the workflow context object builder. Remove `workflowId`/`workflowNo` computations. Keep `traceId` and `workflowType`.
3. **Deposit/withdraw workflow context** (around line 500-700): various computed fields for deposit/withdraw chains that set `workflowId` / `workflowNo`. Remove those lines.
4. **SWAP cross-trace expansion** (`resolveSwapWorkflowSearchExpansion`, around line 1335): DELETE the entire method. Also delete the call site around line 1561-1580 in the query builder — the SWAP branch becomes a plain `workflowType=SWAP` filter.
5. **`validateInput`** (around line 1088): no changes needed for the workflow fields (the validator doesn't enforce them today).
6. **`mapEvent`** (around line 1159): remove `workflowId` and `workflowNo` from the returned object.
7. **Query builder** (`findAll`, around line 1540): remove `workflowType`+`workflowNo` expansion logic. Keep the plain `workflowType` equality filter.
8. **Any other internal reference**: grep-sweep:

```bash
grep -n "workflowId\|workflowNo" Exchange_js/src/modules/risk-engine/audit-logs/audit-logs.service.ts
```

For each remaining match, delete the line or edit it to remove the field.

- [ ] **Step 3: Add an entry to `deferred-refactors.md` if any behavior change has non-obvious impact**

The SWAP expansion deletion means SWAP audit queries change behavior. Task 1 already wrote item 1 in `deferred-refactors.md` documenting this. Skip this step if Task 1 was completed.

- [ ] **Step 4: Rebuild**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js
PATH="$HOME/.nvm/versions/node/v18.20.8/bin:$PATH" npm run build 2>&1 | tail -20
```

Expected: build succeeds. If any caller still references the removed types, the compiler will tell you where.

- [ ] **Step 5: Run the audit-logs service test suite**

```bash
PATH="$HOME/.nvm/versions/node/v18.20.8/bin:$PATH" \
  npx jest src/modules/risk-engine/audit-logs --no-coverage 2>&1 | tail -20
```

Expected: most pass. Any failing tests likely assert on the removed SWAP expansion or on `mapEvent` returning workflowId/workflowNo — update the assertions.

- [ ] **Step 6: Commit**

```bash
git add Exchange_js/src/modules/risk-engine/audit-logs
git commit -m "refactor(audit): remove workflowId/workflowNo from DTO + delete SWAP cross-trace expansion"
```

---

## Task 12 — Schema: drop `workflowId` / `workflowNo` columns from `audit_log_events`

**Files:**
- Modify: `Exchange_js/prisma/schema.prisma`
- Create: `Exchange_js/prisma/migrations/20260408030000_drop_audit_log_workflow_id_no/migration.sql`

- [ ] **Step 1: Remove the fields from the `AuditLogEvent` model**

In `schema.prisma`, find the `AuditLogEvent` model (around line 400-460 based on project size). Delete:

```prisma
  workflowId      String?
  workflowNo      String?
```

Leave `workflowType` and `traceId` intact.

- [ ] **Step 2: Generate Prisma client**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js
PATH="$HOME/.nvm/versions/node/v18.20.8/bin:$PATH" npx prisma generate 2>&1 | tail -5
```

- [ ] **Step 3: Verify current schema of audit_log_events in the live DB**

```bash
sqlite3 /tmp/exchange_js_main/dev.db "PRAGMA table_info(audit_log_events);" | awk -F'|' '{print "    \""$2"\","}'
```

Capture the full column list for the migration's SELECT.

- [ ] **Step 4: Create the migration**

```bash
mkdir -p Exchange_js/prisma/migrations/20260408030000_drop_audit_log_workflow_id_no
```

Create `Exchange_js/prisma/migrations/20260408030000_drop_audit_log_workflow_id_no/migration.sql`:

```sql
-- Drop workflowId and workflowNo from audit_log_events via SQLite table-recreate.
-- These fields became redundant once every business sequence adopted the
-- "one UUID v4 traceId per sequence, inherited by every audit row" rule.
-- Parent-entity pointers that previously lived in workflowId/workflowNo now
-- live in metadata.parentEntityType/parentEntityId/parentEntityNo.
-- See docs/constraints/audit-trace-context-constraints.md.
PRAGMA foreign_keys = OFF;

CREATE TABLE "audit_log_events_new" AS
SELECT
    "id", "auditNo", "triggerType", "action", "module", "entityType",
    "entityId", "entityNo", "traceId", "workflowType",
    "entityOwnerType", "entityOwnerId", "entityOwnerNo",
    "statusFrom", "statusTo", "actorType", "actorId", "actorNo", "actorRole",
    "requestId", "sourceIp", "sourcePlatform", "result", "reason",
    "metadata", "beforeData", "afterData", "idempotencyKey", "payloadDigest",
    "maskVersion", "retainedUntil", "archivedAt", "occurredAt",
    "createdAt", "updatedAt"
FROM "audit_log_events";

DROP TABLE "audit_log_events";
ALTER TABLE "audit_log_events_new" RENAME TO "audit_log_events";

-- Recreate indexes (mirror schema.prisma @@index directives).
CREATE UNIQUE INDEX "audit_log_events_auditNo_key" ON "audit_log_events"("auditNo");
CREATE UNIQUE INDEX "audit_log_events_idempotencyKey_key" ON "audit_log_events"("idempotencyKey");
CREATE INDEX "audit_log_events_occurredAt_idx" ON "audit_log_events"("occurredAt");
CREATE INDEX "audit_log_events_triggerType_occurredAt_idx" ON "audit_log_events"("triggerType", "occurredAt");
CREATE INDEX "audit_log_events_module_occurredAt_idx" ON "audit_log_events"("module", "occurredAt");
CREATE INDEX "audit_log_events_entityType_entityId_idx" ON "audit_log_events"("entityType", "entityId");
CREATE INDEX "audit_log_events_actorType_actorId_idx" ON "audit_log_events"("actorType", "actorId");
CREATE INDEX "audit_log_events_module_entityType_entityId_occurredAt_idx" ON "audit_log_events"("module", "entityType", "entityId", "occurredAt");
CREATE INDEX "audit_log_events_actorType_actorId_occurredAt_idx" ON "audit_log_events"("actorType", "actorId", "occurredAt");
CREATE INDEX "audit_log_events_actorNo_occurredAt_idx" ON "audit_log_events"("actorNo", "occurredAt");
CREATE INDEX "audit_log_events_entityOwnerNo_occurredAt_idx" ON "audit_log_events"("entityOwnerNo", "occurredAt");
CREATE INDEX "audit_log_events_traceId_occurredAt_idx" ON "audit_log_events"("traceId", "occurredAt");

PRAGMA foreign_keys = ON;
```

**Before running**: verify the live DB's column list matches your SELECT (columns may have shifted if other migrations ran). And verify the live index list matches:

```bash
sqlite3 /tmp/exchange_js_main/dev.db "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='audit_log_events' AND name NOT LIKE 'sqlite_%';"
```

- [ ] **Step 5: Apply migration**

```bash
DATABASE_URL="file:/tmp/exchange_js_main/dev.db" \
PATH="$HOME/.nvm/versions/node/v18.20.8/bin:$PATH" \
  npx prisma migrate deploy 2>&1 | tail -5
```

- [ ] **Step 6: Verify**

```bash
sqlite3 /tmp/exchange_js_main/dev.db "PRAGMA table_info(audit_log_events);" | grep -cE "workflowId|workflowNo"
```

Expected: `0`.

- [ ] **Step 7: Rebuild + run full suite**

```bash
PATH="$HOME/.nvm/versions/node/v18.20.8/bin:$PATH" npm run build 2>&1 | tail -5
PATH="$HOME/.nvm/versions/node/v18.20.8/bin:$PATH" npx jest --no-coverage 2>&1 | tail -20
```

- [ ] **Step 8: Commit**

```bash
git add Exchange_js/prisma/schema.prisma \
        Exchange_js/prisma/migrations/20260408030000_drop_audit_log_workflow_id_no/migration.sql
git commit -m "refactor(schema): drop audit_log_events.workflowId and workflowNo columns"
```

---

## Task 13 — Frontend: clean workflowId/workflowNo from admin Audit Logs pages

**Files:**
- Modify: `Exchange_js/admin-web/src/pages/AuditLogsPage.tsx`
- Modify: `Exchange_js/admin-web/src/pages/AuditLogDetailPage.tsx`

Other admin-web files (`ApprovalDetailPage.tsx`, `PlatformMemberDetailPage.tsx`, `SlaTimerDetailPage.tsx`, etc.) read `workflowNo` from their own entity tables (`approval_cases.workflowNo`, `admin_user_invitations.workflowNo`, `sla_timers.workflowNo`) — these are business columns and are **unaffected** by this cleanup. Do not touch those pages.

- [ ] **Step 1: `AuditLogsPage.tsx` — remove workflowNo from filter state**

Find the `FilterState` interface. Delete `workflowNo: string;`.

Find `DEFAULT_FILTERS`. Delete `workflowNo: '',`.

Find `buildParams` or the equivalent query-param builder. Delete the lines that set `workflowNo`.

Find `hasFilter` derived boolean. Remove `workflowNo` from the OR chain.

- [ ] **Step 2: `AuditLogsPage.tsx` — remove Workflow No column from the table**

Find the table column definitions array. Remove the `Workflow No` column entry and its matching `<td>` rendering.

Find the row rendering JSX. Delete the `<td>` that displays `item.workflowNo`.

- [ ] **Step 3: `AuditLogDetailPage.tsx` — remove workflowId / workflowNo from the interface and display**

In the `AuditLogDetail` interface (top of file), delete:

```ts
  workflowId: string;
  workflowNo: string;
```

In the hero section display, remove any `InfoField label="Workflow No"` / `InfoField label="Workflow ID"` lines.

In the sidebar section display, remove matching SidebarKV entries.

- [ ] **Step 4: Build admin-web**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/admin-web
PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH" npx tsc --noEmit 2>&1 | tail -20
```

Expected: type-check succeeds.

- [ ] **Step 5: Manual verify in running preview**

In the admin-web preview:
1. Navigate to `/dashboard/audit/audit-logs`.
2. Confirm the filter bar no longer has a "Workflow No" field.
3. Confirm the table no longer has a "Workflow No" column.
4. Click any row → detail page.
5. Confirm the hero and sidebar no longer display "Workflow ID" / "Workflow No".

- [ ] **Step 6: Commit**

```bash
git add Exchange_js/admin-web/src/pages/AuditLogsPage.tsx \
        Exchange_js/admin-web/src/pages/AuditLogDetailPage.tsx
git commit -m "refactor(admin-web): remove workflowId/workflowNo from Audit Logs list and detail pages"
```

---

## Task 14 — End-to-end verification

- [ ] **Step 1: Restart backend with fresh schema**

```bash
pkill -f "node.*dist/main" 2>/dev/null
sleep 1
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js
DATABASE_URL="file:/tmp/exchange_js_main/dev.db" API_PORT=3000 \
  ADMIN_URL="http://localhost:3502" CLIENT_URL="http://localhost:3501" \
  PATH="$HOME/.nvm/versions/node/v18.20.8/bin:$PATH" \
  node dist/main > /tmp/exchange_js_runtime_main/backend.log 2>&1 &
sleep 5
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/api
```

Expected: 200.

- [ ] **Step 2: Register a fresh customer and drive through the full flow**

```bash
ADMIN_TOKEN=$(curl -s -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@fiatx.com","password":"123456"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

TS=$(date +%s)
REG=$(curl -s -X POST http://localhost:3000/auth/customer/register \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"e2e_${TS}@example.com\",\"password\":\"Test1234!\",\"firstName\":\"E2E\",\"lastName\":\"Test\",\"customerType\":\"INDIVIDUAL\"}")
CID=$(echo "$REG" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
echo "Customer: $CID"

TOKEN=$(curl -s -X POST http://localhost:3000/auth/customer/login \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"e2e_${TS}@example.com\",\"password\":\"Test1234!\"}" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

# Start verification — should assign onboardingTraceId
curl -s -X POST http://localhost:3000/onboarding/verification/start \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" > /dev/null

# Check onboardingTraceId is set
TRACE=$(sqlite3 /tmp/exchange_js_main/dev.db "SELECT onboardingTraceId FROM customer_main WHERE id='$CID';")
echo "Trace ID: $TRACE"
```

Expected: Trace ID is a UUID v4.

- [ ] **Step 3: Run a sumsub simulation and check audit row was written**

```bash
curl -s -X POST http://localhost:3000/admin/sumsub-events/simulate \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d "{\"customerId\":\"$CID\",\"scenario\":\"MANUAL_REVIEW\"}" > /dev/null

sleep 1

# Check an audit row exists for this customer with the right shape
sqlite3 /tmp/exchange_js_main/dev.db \
  "SELECT auditNo, action, statusFrom, statusTo, traceId, workflowType FROM audit_log_events WHERE entityId='$CID';"
```

Expected: one row with:
- `action` = `SUMSUB_APPLICANT_ON_HOLD`
- `traceId` matches the customer's `onboardingTraceId`
- `workflowType` = `ONBOARDING`
- (no columns for workflowId/workflowNo exist)

- [ ] **Step 4: Confirm schema columns are dropped**

```bash
sqlite3 /tmp/exchange_js_main/dev.db "PRAGMA table_info(audit_log_events);" | grep -cE "workflowId|workflowNo"
sqlite3 /tmp/exchange_js_main/dev.db "PRAGMA table_info(customer_main);" | grep -c activeJourneyId
```

Expected: `0` and `0`.

- [ ] **Step 5: Admin-web walk-through**

In the admin-web preview:
1. Navigate to `/dashboard/customer/management`, click the new customer.
2. Confirm the Verification section shows `UNDER_REVIEW` substatus and the onboardingTraceId (from Task 2).
3. Navigate to `/dashboard/audit/audit-logs`.
4. Filter by the customer's onboardingTraceId (paste into Trace ID field).
5. Confirm the row with action `SUMSUB_APPLICANT_ON_HOLD` appears.
6. Click it — detail page renders without any Workflow ID / Workflow No fields.

- [ ] **Step 6: Final status check**

No new commits in this task — just verification. If any step fails, drop back to the relevant earlier task and fix.

---

## Documentation note (after Task 14 passes)

Also append one line to `docs/constraints/onboarding-flow-constraints.md`:

```markdown
## Audit trace

Sumsub webhook audit emission and the single-purpose `customer_main.onboardingTraceId` column are governed by `docs/constraints/audit-trace-context-constraints.md`. All sumsub event audit rows inherit `traceId` from `customer.onboardingTraceId`, which is generated once by `startVerification`.
```

Commit:

```bash
git add Exchange_js/docs/constraints/onboarding-flow-constraints.md
git commit -m "docs(onboarding): cross-reference audit trace context constraints"
```
