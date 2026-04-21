# Wave 1 Cleanup — Scope Boundary, Code Structure, Naming, Build Health

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tighten Wave 1 module exports, remove stale doc references, unify approval creator-field naming (makerUserId → createdByUserId), fix 4 failing non-Wave-1 tests, annotate dual-RBAC path and cross-wave coupling boundaries, and mark completed implementation plan checkboxes.

**Architecture:** Four independent subsystems touched in sequence — module boundary, docs, Prisma schema rename + code sync, test mocks. No cross-task dependencies; Tasks 1–3 are pure edits; Task 4 requires a DB migration; Tasks 5–6 are code-only.

**Tech Stack:** NestJS modules, Prisma ORM (SQLite), React (admin-web), Jest

---

## Scope note
These four tasks are independent and could run as separate plans. They are combined here for efficiency since each is small.

---

## Task 1 — Trim `governance.module.ts` exports to Wave 1 only

**Why:** `BusinessConfigModule`, `GovernanceRegistriesModule`, `RegulatoryGatesModule`, and `SlaTimersModule` are in `@Global()` exports, making them silently injectable project-wide. None are used outside governance — confirmed by grep. Trimming exports forces explicit imports when those waves are built, making dependency graph visible.

**Files:**
- Modify: `src/modules/governance/governance.module.ts`

- [ ] **Step 1: Edit governance.module.ts — trim exports**

Replace the exports array (leave imports unchanged — they are needed internally):

```typescript
// src/modules/governance/governance.module.ts
import { Global, Module } from '@nestjs/common';
import { ApprovalsModule } from './approvals/approvals.module';
import { BusinessConfigModule } from './business-config/business-config.module';
import { ChangeTicketsModule } from './change-tickets/change-tickets.module';
import { DeleteRequestsModule } from './delete-requests/delete-requests.module';
import { GovernanceRegistriesModule } from './registries/governance-registries.module';
import { RegulatoryGatesModule } from './regulatory-gates/regulatory-gates.module';
import { SlaTimersModule } from './sla-timers/sla-timers.module';

@Global()
@Module({
  imports: [
    ApprovalsModule,
    BusinessConfigModule,
    ChangeTicketsModule,
    DeleteRequestsModule,
    GovernanceRegistriesModule,
    RegulatoryGatesModule,
    SlaTimersModule,
  ],
  exports: [ApprovalsModule, ChangeTicketsModule, DeleteRequestsModule],
})
export class GovernanceModule {}
```

- [ ] **Step 2: Verify build passes**

```bash
cd Exchange_js && npm run build 2>&1 | tail -20
```

Expected: `Successfully compiled` with exit code 0. If any module fails to resolve a previously-global service, add an explicit import to that module and re-run.

- [ ] **Step 3: Commit**

```bash
git add Exchange_js/src/modules/governance/governance.module.ts
git commit -m "refactor(governance): trim @Global exports to Wave 1 modules only"
```

---

## Task 2 — Fix `AGENTS.md` deprecated doc reference

**Why:** `AGENTS.md` line 7 lists `frontend-ui-constraints.md` as mandatory reading. That file is marked `Status: deprecated` and replaced by `frontend-platform-constraints.md` + `frontend-admin-ui-constraints.md` + `frontend-client-ui-constraints.md`. Agents reading the old file get stale rules.

**Files:**
- Modify: `Exchange_js/AGENTS.md`

- [ ] **Step 1: Remove deprecated reference and renumber**

In `AGENTS.md`, the mandatory read list currently reads:
```
1. `docs/README.md`
2. `docs/constraints/README.md`
3. `docs/constraints/frontend-ui-constraints.md`       ← REMOVE THIS LINE
4. `docs/constraints/backend-architecture-constraints.md`
5. `docs/constraints/runtime-config-constraints.md`
...
```

Replace lines 4–19 (the numbered list) with:
```markdown
1. `docs/README.md`
2. `docs/constraints/README.md`
3. `docs/constraints/frontend-platform-constraints.md`
4. `docs/constraints/frontend-admin-ui-constraints.md`
5. `docs/constraints/frontend-client-ui-constraints.md`
6. `docs/constraints/backend-architecture-constraints.md`
7. `docs/constraints/runtime-config-constraints.md`
8. `docs/constraints/onboarding-flow-constraints.md`
9. `docs/constraints/customer-transaction-flow-constraints.md`
10. `docs/constraints/internal-transaction-flow-constraints.md`
11. `docs/constraints/audit-logging-constraints.md`
12. `docs/constraints/rbac-member-management-constraints.md`
13. `docs/constraints/governance-approval-constraints.md`
14. `docs/constraints/governance-change-ticket-constraints.md`
15. `docs/constraints/governance-delete-request-constraints.md`
16. `docs/constraints/governance-sla-timer-constraints.md`
17. `docs/constraints/compliance-alert-incident-constraints.md`
```

- [ ] **Step 2: Commit**

```bash
git add Exchange_js/AGENTS.md
git commit -m "docs(agents): replace deprecated frontend-ui-constraints with current split files"
```

---

## Task 3 — Mark `governance-sla-timer-constraints.md` as Wave 9 deferred

**Why:** The file has no Status field and still claims Wave 1 ownership. SLA was formally moved to Wave 9 via `wave-boundary-sla-governance-realignment.md`. Without the status marker, agents treat it as active Wave 1 truth.

**Files:**
- Modify: `docs/constraints/governance-sla-timer-constraints.md`

- [ ] **Step 1: Add status header at top of file**

Insert at the very top of the file, before `# Governance SLA Timer Constraints`:

```markdown
Status: wave-9-deferred
Note: SLA governance (WF-04) was formally moved to Wave 9 via
docs/cleanup/2026-04-wave1-foundation-reset/wave-boundary-sla-governance-realignment.md (2026-04).
This document remains valid specification for Wave 9 implementation.
It is NOT Wave 1 scope and MUST NOT be treated as active Wave 1 truth.

---

```

- [ ] **Step 2: Commit**

```bash
git add Exchange_js/docs/constraints/governance-sla-timer-constraints.md
git commit -m "docs(sla): mark governance-sla-timer-constraints as wave-9-deferred"
```

---

## Task 4 — Rename `makerUserId/makerUserNo` → `createdByUserId/createdByUserNo` in schema

**Why:** `change_tickets` and `delete_requests` both use `createdByUserId`. The `approval_cases` table uses `makerUserId` — a legacy maker-checker term. Unifying to `createdByUserId` makes the creator-field naming consistent across all three Wave 1 governance tables.

**Files:**
- Modify: `prisma/schema.prisma` (ApprovalCase model)
- Create: new Prisma migration (auto-generated)

- [ ] **Step 1: Update schema.prisma**

In the `ApprovalCase` model, rename the two fields:

```prisma
// Before:
makerUserId    String
makerUserNo    String?

// After:
createdByUserId  String
createdByUserNo  String?
```

The full updated model section (fields only, surrounding context preserved):
```prisma
  id                             String                         @id @default(uuid())
  approvalNo                     String                         @unique
  actionType                     String
  entityRef                      String
  createdByUserId                String
  createdByUserNo                String?
  status                         String                         @default("DRAFT")
```

- [ ] **Step 2: Generate migration**

```bash
cd Exchange_js && npx prisma migrate dev --name rename_approval_maker_to_created_by 2>&1
```

Expected output: `The following migration(s) have been created and applied` with a new folder under `prisma/migrations/`.

If it prompts about data loss: this is a rename, not a drop — confirm to proceed.

- [ ] **Step 3: Verify Prisma client regenerated**

```bash
grep -n "createdByUserId" Exchange_js/node_modules/@prisma/client/index.d.ts | head -5
```

Expected: at least one match confirming the generated client knows the new field name.

- [ ] **Step 4: Commit schema + migration**

```bash
git add Exchange_js/prisma/schema.prisma Exchange_js/prisma/migrations/
git commit -m "feat(schema): rename approval_cases.maker_user_id -> created_by_user_id"
```

---

## Task 5 — Update all code references: `makerUserId` → `createdByUserId`

**Files:**
- Modify: `src/modules/governance/approvals/approvals.service.ts`
- Modify: `src/modules/governance/approvals/approvals.service.spec.ts`
- Modify: `admin-web/src/pages/ApprovalsPage.tsx`
- Modify: `admin-web/src/pages/ApprovalDetailPage.tsx`
- Modify: `docs/constraints/governance-sla-timer-constraints.md`

Note: `outstanding-settlements.service.ts` uses `makerUserId` for its **own** `outstanding_settlements` table — not `approval_cases`. No change needed there.

- [ ] **Step 1: Update `approvals.service.ts` — 8 occurrences**

| Line | Old | New |
|------|-----|-----|
| 540 | `actor.userId === approval.makerUserId` | `actor.userId === approval.createdByUserId` |
| 553 | `makerUserId: approval.makerUserId,` | `createdByUserId: approval.createdByUserId,` |
| 554 | `makerUserNo: approval.makerUserNo \|\| null,` | `createdByUserNo: approval.createdByUserNo \|\| null,` |
| 737 | `makerUserId: actor.userId,` | `createdByUserId: actor.userId,` |
| 738 | `makerUserNo: this.normalizeOptionalString(actor.userNo),` | `createdByUserNo: this.normalizeOptionalString(actor.userNo),` |
| 776 | `if (approval.makerUserId !== actor.userId)` | `if (approval.createdByUserId !== actor.userId)` |
| 1198 | `{ makerUserNo: { contains: keyword } },` | `{ createdByUserNo: { contains: keyword } },` |
| 1200 | `{ makerUserId: { contains: keyword } },` | `{ createdByUserId: { contains: keyword } },` |

- [ ] **Step 2: Update `approvals.service.spec.ts` — buildApproval mock**

In the `buildApproval` factory function (around lines 18–19):
```typescript
// Before:
makerUserId: 'maker-1',
makerUserNo: 'USR-MAKER-001',

// After:
createdByUserId: 'maker-1',
createdByUserNo: 'USR-MAKER-001',
```

- [ ] **Step 3: Update `ApprovalsPage.tsx`**

Line 16 — interface field:
```typescript
// Before:
makerUserId: string;
// After:
createdByUserId: string;
```

Line 243 — display expression:
```tsx
// Before:
{item.makerUserNo || item.makerUserId}
// After:
{item.createdByUserNo || item.createdByUserId}
```

- [ ] **Step 4: Update `ApprovalDetailPage.tsx`**

Line 26 — interface field:
```typescript
// Before:
makerUserId: string;
// After:
createdByUserId: string;
```

Line 295 — display value:
```tsx
// Before:
<InfoField label="Maker User ID" value={detail.makerUserId} mono />
// After:
<InfoField label="Created By" value={detail.createdByUserId} mono />
```

- [ ] **Step 5: Update `governance-sla-timer-constraints.md` line 58**

```markdown
# Before:
7. `ownerUserId = approval.makerUserId`

# After:
7. `ownerUserId = approval.createdByUserId`
```

- [ ] **Step 6: Verify no remaining `makerUserId` references in approval context**

```bash
grep -rn "makerUserId\|makerUserNo" Exchange_js/src/modules/governance/ Exchange_js/admin-web/src/pages/Approvals
```

Expected: 0 matches. If any remain, fix them before proceeding.

- [ ] **Step 7: Run backend build + admin-web build**

```bash
cd Exchange_js && npm run build 2>&1 | tail -10
cd Exchange_js/admin-web && npm run build 2>&1 | tail -10
```

Expected: both pass with exit code 0.

- [ ] **Step 8: Run affected tests**

```bash
cd Exchange_js && npx jest --testPathPattern="approvals.service.spec|audit-evidence-export" --no-coverage 2>&1 | tail -20
```

Expected: all pass.

- [ ] **Step 9: Commit**

```bash
git add Exchange_js/src/modules/governance/approvals/ \
        Exchange_js/admin-web/src/pages/ApprovalsPage.tsx \
        Exchange_js/admin-web/src/pages/ApprovalDetailPage.tsx \
        Exchange_js/docs/constraints/governance-sla-timer-constraints.md
git commit -m "refactor(approvals): rename makerUserId -> createdByUserId across service, spec, admin-web, docs"
```

---

## Task 6 — Fix 4 failing Wave 2-3 tests

**Why:** `LiquidityConfigService` and `AssetsService` instantiate `AuditLogsService` directly (`new AuditLogsService(prisma)` in their constructors). The test mocks for `prisma` don't include `auditLogEvent` — so `AuditLogsService.recordSystem()` throws `Audit log event storage is unavailable`. Additionally, `AssetsService.changeStatus` calls `findUnique` before `update`, but the test doesn't mock the `findUnique` return for that describe block.

**Files:**
- Modify: `src/modules/counterparty/liquidity-config/liquidity-config.service.spec.ts`
- Modify: `src/modules/asset-treasury/assets/assets.service.spec.ts`

- [ ] **Step 1: Fix `liquidity-config.service.spec.ts` — add auditLogEvent mock**

In the `mockPrismaService` object (around line 10), add the `auditLogEvent` table mock:

```typescript
const mockPrismaService = {
  liquidityConfiguration: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  liquidityProvider: {
    findUnique: jest.fn(),
  },
  asset: {
    findUnique: jest.fn(),
  },
  auditLogEvent: {
    create: jest.fn().mockResolvedValue({ id: 'audit-id' }),
  },
};
```

- [ ] **Step 2: Fix `assets.service.spec.ts` — add auditLogEvent mock + fix changeStatus test**

In the `mockPrismaService` object (around line 7), add `auditLogEvent`:

```typescript
const mockPrismaService = {
  asset: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  auditLogEvent: {
    create: jest.fn().mockResolvedValue({ id: 'audit-id' }),
  },
};
```

In the `changeStatus` describe block (around line 105), add a `findUnique` mock before the service call (the method reads the asset before updating):

```typescript
describe('changeStatus', () => {
  it('should update status', async () => {
    mockPrismaService.asset.findUnique.mockResolvedValue({
      id: '1',
      status: AssetStatus.ACTIVE,
    });
    mockPrismaService.asset.update.mockResolvedValue({
      id: '1',
      status: AssetStatus.DISABLED,
    });
    const result = await service.changeStatus('1', AssetStatus.DISABLED);
    expect(result.status).toBe(AssetStatus.DISABLED);
    expect(mockPrismaService.asset.update).toHaveBeenCalledWith({
      where: { id: '1' },
      data: { status: AssetStatus.DISABLED },
    });
  });
});
```

- [ ] **Step 3: Run the previously-failing tests**

```bash
cd Exchange_js && npx jest --testPathPattern="liquidity-config.service.spec|assets.service.spec" --no-coverage 2>&1 | tail -20
```

Expected: 4/4 previously-failing tests now pass.

- [ ] **Step 4: Run full test suite to confirm no regressions**

```bash
cd Exchange_js && npm test -- --passWithNoTests 2>&1 | tail -15
```

Expected: 933/933 pass (0 failures).

- [ ] **Step 5: Commit**

```bash
git add Exchange_js/src/modules/counterparty/liquidity-config/liquidity-config.service.spec.ts \
        Exchange_js/src/modules/asset-treasury/assets/assets.service.spec.ts
git commit -m "test(wave2-3): add auditLogEvent mock to fix liquidity-config and assets spec failures"
```

---

## Final verification

- [ ] **Full build check**

```bash
cd Exchange_js && npm run build 2>&1 | tail -5
cd Exchange_js/admin-web && npm run build 2>&1 | tail -5
cd Exchange_js/client-web && npm run build 2>&1 | tail -5
```

Expected: all three pass.

- [ ] **Full test suite**

```bash
cd Exchange_js && npm test -- --passWithNoTests 2>&1 | tail -10
```

Expected: 933 pass, 0 fail.

---

## Task 7 — Annotate User.role legacy field and dual-RBAC path (Code Structure / P0-2)

**Why:** `users.role` is a legacy single-role field. Active RBAC runs through `user_roles → roles → role_permissions`. `auth.service.ts` includes both in JWT `roleCodes` for backward compatibility. Without a comment, future developers may assume `user.role` is the authoritative source and either remove the RBAC chain or duplicate it.

**Files:**
- Modify: `prisma/schema.prisma` (User model, `role` field)
- Modify: `src/modules/identity/auth/auth.service.ts` (lines 327–337)

- [ ] **Step 1: Add comment to `schema.prisma` User.role field**

In the `User` model, change the `role` field line from:
```prisma
  role                String
```
to:
```prisma
  // Legacy: single-role string kept for JWT backward compatibility.
  // Authoritative RBAC is resolved via userRoles → roles → role_permissions.
  // auth.service.ts includes this field in JWT roleCodes for tokens issued
  // before the roleCodes claim existed. Safe to remove only after all
  // active sessions have been refreshed.
  role                String
```

- [ ] **Step 2: Add comment to `auth.service.ts` login() roleCodes block**

Around lines 327–337, replace the existing code block with the same code + comment:
```typescript
    // RBAC resolution: primary source is user_roles table (getUserRoleCodes).
    // user.role (legacy) is appended so older JWT tokens that predate the
    // roleCodes claim continue to work. Once all sessions are refreshed,
    // the user.role fallback here can be removed.
    const resolvedRoleCodes = this.accessControlService
      ? await this.accessControlService.getUserRoleCodes(user.id)
      : [];
    const roleCodes = Array.from(
      new Set(
        [...resolvedRoleCodes, String(user.role || '').trim().toUpperCase()].filter(
          Boolean,
        ),
      ),
    );
    const primaryRole = getPrimaryRoleCode(roleCodes) || user.role || 'ADMIN';
```

- [ ] **Step 3: Commit**

```bash
git add Exchange_js/prisma/schema.prisma Exchange_js/src/modules/identity/auth/auth.service.ts
git commit -m "docs(auth): annotate User.role legacy field and dual-RBAC fallback path"
```

---

## Task 8 — Annotate ApprovalCase Wave 1 stable contract boundary (Code Structure / P0-3)

**Why:** `ApprovalCase` is reused by Wave 2-5 flows (onboarding, regulatory gates, internal transactions). Without a contract boundary annotation, Wave 2+ developers modifying `ApprovalsService` may unknowingly break Wave 1 approval behavior. The three Wave 1 action types need to be explicitly marked as stable.

**Files:**
- Modify: `src/modules/governance/approvals/constants/approval.constants.ts`

- [ ] **Step 1: Add Wave 1 stable contract block to `approval.constants.ts`**

Insert after the opening line (`export const ApprovalActionTypes = {`), before the first entry:

Replace the current `ApprovalActionTypes` block:
```typescript
export const ApprovalActionTypes = {
  AUDIT_EVIDENCE_EXPORT_APPROVAL: 'AUDIT_EVIDENCE_EXPORT_APPROVAL',
  CASE_EVIDENCE_EXPORT_APPROVAL: 'CASE_EVIDENCE_EXPORT_APPROVAL',
  CHANGE_TICKET_APPROVAL: 'CHANGE_TICKET_APPROVAL',
  DELETE_REQUEST_APPROVAL: 'DELETE_REQUEST_APPROVAL',
  ONBOARDING_FINAL_APPROVAL: 'ONBOARDING_FINAL_APPROVAL',
  POOL_SETTLEMENT_BATCH_APPROVAL: 'POOL_SETTLEMENT_BATCH_APPROVAL',
  TREASURY_CROSS_POOL_TRANSFER_APPROVAL: 'TREASURY_CROSS_POOL_TRANSFER_APPROVAL',
} as const;
```

With:
```typescript
/**
 * WAVE 1 STABLE CONTRACT
 * The following three action types are Wave 1 governed flows.
 * Their state machine, SoD rules, timeout policies, and execution
 * dispatch are stable public API — do not change their behavior
 * without a Wave 1 regression pass.
 *
 *   AUDIT_EVIDENCE_EXPORT_APPROVAL  — audit evidence package export gate
 *   CHANGE_TICKET_APPROVAL          — admin access / RBAC change gate
 *   DELETE_REQUEST_APPROVAL         — soft-delete gate
 *
 * The remaining types belong to future waves and are pre-registered here
 * for schema continuity:
 *   CASE_EVIDENCE_EXPORT_APPROVAL        — Wave 2-3
 *   ONBOARDING_FINAL_APPROVAL            — Wave 2-3
 *   POOL_SETTLEMENT_BATCH_APPROVAL       — Wave 5+
 *   TREASURY_CROSS_POOL_TRANSFER_APPROVAL — Wave 5+
 */
export const ApprovalActionTypes = {
  AUDIT_EVIDENCE_EXPORT_APPROVAL: 'AUDIT_EVIDENCE_EXPORT_APPROVAL',
  CASE_EVIDENCE_EXPORT_APPROVAL: 'CASE_EVIDENCE_EXPORT_APPROVAL',
  CHANGE_TICKET_APPROVAL: 'CHANGE_TICKET_APPROVAL',
  DELETE_REQUEST_APPROVAL: 'DELETE_REQUEST_APPROVAL',
  ONBOARDING_FINAL_APPROVAL: 'ONBOARDING_FINAL_APPROVAL',
  POOL_SETTLEMENT_BATCH_APPROVAL: 'POOL_SETTLEMENT_BATCH_APPROVAL',
  TREASURY_CROSS_POOL_TRANSFER_APPROVAL: 'TREASURY_CROSS_POOL_TRANSFER_APPROVAL',
} as const;
```

- [ ] **Step 2: Commit**

```bash
git add Exchange_js/src/modules/governance/approvals/constants/approval.constants.ts
git commit -m "docs(approvals): annotate Wave 1 stable contract boundary in ApprovalActionTypes"
```

---

## Task 9 — Classify `compliance_case_evidence_packages` as Wave 2-3 in schema (P1-1)

**Why:** The design doc (`change-delete-ticket-minimalization-design.md`) explicitly removed `COMPLIANCE_CASE_EVIDENCE_PACKAGE` from Wave 1 delete targets, but the table exists in schema without any wave annotation. Its FK to `approval_cases` is for Wave 2-3 evidence export approval — not Wave 1.

**Files:**
- Modify: `prisma/schema.prisma` (`ComplianceCaseEvidencePackage` model)

- [ ] **Step 1: Add Wave 2-3 annotation above the model**

Find the line `model ComplianceCaseEvidencePackage {` (around line 657) and insert above it:

```prisma
// Wave 2-3: Compliance case evidence export. This table is NOT a Wave 1
// delete target (removed from Wave 1 scope per change-delete-ticket-minimalization-design.md).
// Its FK to approval_cases (approvalCaseId) is for the Wave 2-3 evidence export
// approval flow — not part of Wave 1 governed five flows.
model ComplianceCaseEvidencePackage {
```

- [ ] **Step 2: Commit**

```bash
git add Exchange_js/prisma/schema.prisma
git commit -m "docs(schema): annotate compliance_case_evidence_packages as Wave 2-3"
```

---

## Task 10 — Mark completed implementation plan checkboxes (P2-3)

**Why:** All 5 implementation plan files show 100% `[ ]` but core functionality IS implemented in code. False 0% misleads future developers into thinking none of the Wave 1 reset work is done.

**Files:**
- Modify: `docs/cleanup/2026-04-wave1-foundation-reset/change-delete-ticket-minimalization-implementation-plan.md`
- Modify: `docs/cleanup/2026-04-wave1-foundation-reset/wave-1-governed-five-flows-implementation-plan.md`
- Modify: `docs/cleanup/2026-04-wave1-foundation-reset/wave-1-foundation-tightening-bcd-implementation-plan.md`
- Modify: `docs/cleanup/2026-04-wave1-foundation-reset/wave-1-audit-business-workflow-redesign-implementation-plan.md`
- Modify: `docs/cleanup/2026-04-wave1-foundation-reset/wave-1-evidence-export-audit-fixes-implementation-plan.md`

- [ ] **Step 1: Verify change-delete-ticket-minimalization tasks**

Run these verification checks, then mark the tasks accordingly:

```bash
# Verify Task 1 (schema/enums done): check change ticket types exist
grep -n "ADMIN_ACCESS_CHANGE\|RBAC_CATALOG_CHANGE" Exchange_js/src/modules/governance/change-tickets/constants/change-ticket.constants.ts

# Verify Task 2 (ChangeTicket backend): check service has submit/consume
grep -n "async submit\|async consume\|async create" Exchange_js/src/modules/governance/change-tickets/change-tickets.service.ts | head -10

# Verify Task 3 (DeleteRequest backend): check service exists with correct target types
grep -n "CHANGE_TICKET\|AUDIT_EVIDENCE_PACKAGE\|ADMIN_USER" Exchange_js/src/modules/governance/delete-requests/constants/delete-request.constants.ts
```

For each task whose code verification passes, change `- [ ]` to `- [x]` in the plan file.

- [ ] **Step 2: Verify wave-1-governed-five-flows tasks**

```bash
# Verify Task 1 (business endpoints create tickets): check users controller delegates
grep -n "createAdminMemberProvisioningTicket\|createAdminRoleBindingChangeTicket" Exchange_js/src/modules/identity/users/users.controller.ts Exchange_js/src/modules/identity/access-control/access-control.controller.ts

# Verify Task 2 (consume dispatches execution): check consume method dispatches
grep -n "executeAdminMemberProvisioning\|executeGovernedRoleBindingChange" Exchange_js/src/modules/governance/change-tickets/change-tickets.service.ts
```

For each verified task, change `- [ ]` to `- [x]`.

- [ ] **Step 3: Verify wave-1-foundation-tightening-bcd tasks**

```bash
# Check if BCD acceptance notes exist
ls Exchange_js/docs/cleanup/2026-04-wave1-foundation-reset/*acceptance* 2>/dev/null || echo "no acceptance file"

# Check audit service contract
grep -n "recordSystem\|recordAdmin\|buildEvidencePackage" Exchange_js/src/modules/risk-engine/audit-logs/audit-logs.service.ts | head -10
```

- [ ] **Step 4: Verify wave-1-evidence-export-audit-fixes tasks**

```bash
# Check SLA skip gate exists
grep -n "isWave1GovernedFlow\|AUDIT_EVIDENCE_EXPORT" Exchange_js/src/modules/governance/sla-timers/approval-sla-projection.service.ts

# Check evidence export creates audit on request
grep -n "recordSystem\|EVIDENCE_EXPORT" Exchange_js/src/modules/governance/approvals/audit-evidence-export-approval.service.ts | head -10
```

- [ ] **Step 5: Apply all verified `[x]` marks and commit**

After marking all verified tasks as done across all 5 files:

```bash
git add Exchange_js/docs/cleanup/2026-04-wave1-foundation-reset/
git commit -m "docs(cleanup): mark completed Wave 1 implementation plan tasks as done"
```
