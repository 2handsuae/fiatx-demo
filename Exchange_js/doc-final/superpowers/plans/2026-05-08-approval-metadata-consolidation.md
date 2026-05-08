# Approval Metadata Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the redundant `metadataJson` column from `approval_cases`, keeping `objectSnapshot` as the single JSON payload.

**Architecture:** Delete the DB column, remove serialize/parse helpers and DTO field, strip `metadata` from all 6 workflow `createAndSubmit` calls (merging Evidence Export's `workflowSummary` into its `objectSnapshot`), and remove the Metadata display section from the frontend.

**Tech Stack:** NestJS + Prisma + SQLite (backend), React (admin-web)

---

### Task 1: Prisma Schema — Remove `metadataJson` Field

**Files:**
- Modify: `prisma/schema.prisma:734`

- [ ] **Step 1: Remove the `metadataJson` field from the ApprovalCase model**

In `prisma/schema.prisma`, find the `ApprovalCase` model (line ~734) and delete the `metadataJson` line:

```prisma
// DELETE this line:
metadataJson                   String                         @default("{}")
```

The `objectSnapshot` field (line ~735) stays untouched.

- [ ] **Step 2: Regenerate Prisma client**

Run: `npx prisma generate`
Expected: Prisma Client generated successfully

- [ ] **Step 3: Create and apply migration**

Run: `npx prisma migrate dev --name drop-approval-metadata-json`
Expected: Migration created and applied. The `metadataJson` column is dropped from `approval_cases`.

- [ ] **Step 4: Verify migration SQL**

Run: `cat prisma/migrations/*drop-approval-metadata-json*/migration.sql`
Expected: Contains `ALTER TABLE "approval_cases" DROP COLUMN "metadataJson";`

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "chore(prisma): drop metadataJson column from approval_cases"
```

---

### Task 2: Backend Service — Remove metadata Helpers and Mapping

**Files:**
- Modify: `src/modules/governance/approvals/approvals.service.ts:119-138,563,753`
- Modify: `src/modules/governance/approvals/dto/approval.dto.ts:23-26`

- [ ] **Step 1: Delete `serializeMetadata` method**

In `approvals.service.ts`, delete lines 119-126:

```typescript
// DELETE entire method:
private serializeMetadata(value: unknown): string {
  if (value === null || value === undefined) return '{}';
  try {
    return JSON.stringify(value);
  } catch {
    throw new BadRequestException('Failed to serialize approval metadata');
  }
}
```

- [ ] **Step 2: Delete `parseMetadata` method**

In `approvals.service.ts`, delete lines 128-138:

```typescript
// DELETE entire method:
private parseMetadata(value: string | null | undefined): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
```

- [ ] **Step 3: Remove `metadataJson` write from `createDraftCase`**

In `approvals.service.ts`, find the `createDraftCase` method and delete the `metadataJson` line (~line 753):

```typescript
// DELETE this line:
metadataJson: this.serializeMetadata(dto.metadata || {}),
```

- [ ] **Step 4: Remove `metadata` output from `mapApproval`**

In `approvals.service.ts`, find the `mapApproval` method and delete the `metadata` line (~line 563):

```typescript
// DELETE this line:
metadata: this.parseMetadata(approval.metadataJson),
```

- [ ] **Step 5: Remove `BadRequestException` import if now unused**

Check if `BadRequestException` is still used elsewhere in the file. If `serializeMetadata` was the only call site, remove it from the imports.

Run: `grep -n 'BadRequestException' src/modules/governance/approvals/approvals.service.ts`

If only the import line remains, remove `BadRequestException` from the import statement.

- [ ] **Step 6: Delete `metadata` field from `CreateApprovalDto`**

In `dto/approval.dto.ts`, delete lines 23-26:

```typescript
// DELETE these 4 lines:
@ApiPropertyOptional({ type: Object })
@IsOptional()
@IsObject()
metadata?: Record<string, unknown>;
```

- [ ] **Step 7: Remove unused imports from DTO if needed**

Check if `@IsObject` is still used (by `objectSnapshot`). If yes, keep it. If `@ApiPropertyOptional` and `@IsOptional` are still used by `objectSnapshot`, keep them too.

Run: `grep -c 'IsObject\|ApiPropertyOptional\|IsOptional' src/modules/governance/approvals/dto/approval.dto.ts`

Only remove imports that have zero remaining usages.

- [ ] **Step 8: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 9: Commit**

```bash
git add src/modules/governance/approvals/approvals.service.ts src/modules/governance/approvals/dto/approval.dto.ts
git commit -m "refactor(approvals): remove metadataJson helpers, DTO field, and mapping"
```

---

### Task 3: Workflow — Admin Invite (remove metadata)

**Files:**
- Modify: `src/modules/identity/users/admin-invite-workflow.service.ts:77-82`

- [ ] **Step 1: Delete the `metadata` object from `createAndSubmit`**

In `admin-invite-workflow.service.ts`, find the `createAndSubmit` call (~line 68). Delete the `metadata` property (lines ~77-82):

```typescript
// DELETE this block:
metadata: {
  userNo: user.userNo,
  userEmail: user.email,
  roleCodes,
  changeReason: dto.changeReason || null,
},
```

The `objectSnapshot` block stays untouched — it already contains `email` (equivalent to metadata's `userEmail`) and all other fields.

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/modules/identity/users/admin-invite-workflow.service.ts
git commit -m "refactor(admin-invite): remove metadata from createAndSubmit"
```

---

### Task 4: Workflow — Role Binding Change (remove metadata)

**Files:**
- Modify: `src/modules/identity/users/admin-role-binding-change-workflow.service.ts:92-99`

- [ ] **Step 1: Delete the `metadata` object from `createAndSubmit`**

In `admin-role-binding-change-workflow.service.ts`, find the `createAndSubmit` call (~line 83). Delete the `metadata` property (lines ~92-99):

```typescript
// DELETE this block:
metadata: {
  requestNo,
  targetUserId: targetUser.id,
  targetUserNo: targetUser.userNo,
  currentRoleCodes,
  proposedRoleCodes: dto.roleCodes,
  changeReason: dto.changeReason,
},
```

The `objectSnapshot` already contains all these fields.

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/modules/identity/users/admin-role-binding-change-workflow.service.ts
git commit -m "refactor(role-binding-change): remove metadata from createAndSubmit"
```

---

### Task 5: Workflow — Admin Suspension (remove metadata)

**Files:**
- Modify: `src/modules/identity/users/admin-suspension-workflow.service.ts:97-101`

- [ ] **Step 1: Delete the `metadata` object from `createAndSubmit`**

In `admin-suspension-workflow.service.ts`, find the `createAndSubmit` call (~line 88). Delete the `metadata` property (lines ~97-101):

```typescript
// DELETE this block:
metadata: {
  targetUserNo: targetUser.userNo,
  targetEmail: targetUser.email,
  reason: dto.reason,
},
```

The `objectSnapshot` already contains all these fields.

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/modules/identity/users/admin-suspension-workflow.service.ts
git commit -m "refactor(admin-suspension): remove metadata from createAndSubmit"
```

---

### Task 6: Workflow — Admin Reactivation (remove metadata)

**Files:**
- Modify: `src/modules/identity/users/admin-reactivation-workflow.service.ts:97-101`

- [ ] **Step 1: Delete the `metadata` object from `createAndSubmit`**

In `admin-reactivation-workflow.service.ts`, find the `createAndSubmit` call (~line 88). Delete the `metadata` property (lines ~97-101):

```typescript
// DELETE this block:
metadata: {
  targetUserNo: targetUser.userNo,
  targetEmail: targetUser.email,
  reason: dto.reason,
},
```

The `objectSnapshot` already contains all these fields.

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/modules/identity/users/admin-reactivation-workflow.service.ts
git commit -m "refactor(admin-reactivation): remove metadata from createAndSubmit"
```

---

### Task 7: Workflow — Evidence Export (remove metadata, merge `workflowSummary`)

**Files:**
- Modify: `src/modules/audit-logging/audit-evidence-export-workflow.service.ts:123-128`

This is the only workflow where metadata has a unique field (`workflowSummary`) not present in `objectSnapshot`.

- [ ] **Step 1: Add `workflowSummary` to `objectSnapshot`**

In `audit-evidence-export-workflow.service.ts`, find the `createAndSubmit` call (~line 116). Add `workflowSummary` to the `objectSnapshot` block:

```typescript
objectSnapshot: {
  packageNo: evidencePackage.packageNo,
  exportMode: evidencePackage.exportMode,
  itemCount: evidencePackage.itemCount,
  status: evidencePackage.status,
  filterSnapshot: selection.filterSnapshot,
  digest: evidencePackage.digest,
  createdAt: evidencePackage.createdAt,
  workflowSummary: selection.workflowSummary,
},
```

- [ ] **Step 2: Delete the `metadata` object**

Delete the `metadata` property (lines ~123-128):

```typescript
// DELETE this block:
metadata: {
  packageId: evidencePackage.id,
  packageNo: evidencePackage.packageNo,
  itemCount: selection.itemCount,
  workflowSummary: selection.workflowSummary,
},
```

Note: `packageId` and `packageNo` are already in `objectSnapshot`. `itemCount` is already in `objectSnapshot`. Only `workflowSummary` was unique and has been merged in Step 1.

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/modules/audit-logging/audit-evidence-export-workflow.service.ts
git commit -m "refactor(evidence-export): merge workflowSummary into objectSnapshot, remove metadata"
```

---

### Task 8: Workflow — Policy Change (remove metadata)

**Files:**
- Modify: `src/modules/governance/approvals/approval-policy-change-workflow.service.ts:136-143`

- [ ] **Step 1: Delete the `metadata` object from `createAndSubmit`**

In `approval-policy-change-workflow.service.ts`, find the `createAndSubmit` call (~line 127). Delete the `metadata` property (lines ~136-143):

```typescript
// DELETE this block:
metadata: {
  requestNo,
  targetActionType,
  currentStepsConfig: currentPolicy.steps,
  proposedStepsConfig: proposedSteps,
  currentCheckerRoles: currentPolicy.checkerRoles,
  proposedCheckerRoles,
  changeReason,
},
```

The `objectSnapshot` already contains all fields: `requestNo`, `targetActionType`, `currentStepsConfig`, `proposedStepsConfig`, `currentCheckerRoles`, `proposedCheckerRoles`, `changeReason`.

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/modules/governance/approvals/approval-policy-change-workflow.service.ts
git commit -m "refactor(policy-change): remove metadata from createAndSubmit"
```

---

### Task 9: Frontend — Remove Metadata Display from ApprovalDetailPage

**Files:**
- Modify: `admin-web/src/pages/ApprovalDetailPage.tsx:38,447-448,650-661`

- [ ] **Step 1: Remove `metadata` from `ApprovalDetail` interface**

In `ApprovalDetailPage.tsx`, find the `ApprovalDetail` interface (~line 22). Delete the `metadata` field (~line 38):

```typescript
// DELETE this line:
metadata?: Record<string, unknown>;
```

- [ ] **Step 2: Remove `hasMetadata` variable**

Delete lines ~447-448:

```typescript
// DELETE these lines:
const hasMetadata          =
  !!detail.metadata && Object.keys(detail.metadata).length > 0;
```

- [ ] **Step 3: Remove Metadata display section**

Delete lines ~650-661 (the entire `{/* ⑦ Metadata */}` block):

```tsx
// DELETE this entire block:
{/* ⑦ Metadata */}
{hasMetadata && (
  <section className="px-6 py-5">
    <Cap>Metadata</Cap>
    <p className="mt-1 mb-4 font-mono text-[9px] text-adm-t3">
      Structured payload for this approval case
    </p>
    <div className="rounded border border-adm-border bg-adm-bg p-4">
      <JsonBlock title="metadata" value={detail.metadata} />
    </div>
  </section>
)}
```

The Object Snapshot section (lines ~663-674, `{/* ⑧ Request Snapshot */}`) stays untouched.

- [ ] **Step 4: Verify TypeScript compiles**

Run: `cd admin-web && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add admin-web/src/pages/ApprovalDetailPage.tsx
git commit -m "refactor(admin-web): remove Metadata display section from ApprovalDetailPage"
```

---

### Task 10: Smoke Test — End-to-End Verification

- [ ] **Step 1: Rebuild and restart dev stack**

```bash
npm run dev:stop
npm run dev:start
```

Expected: All services start without errors.

- [ ] **Step 2: Verify DB column is gone**

```bash
sqlite3 /tmp/exchange_js_branch/dev.db ".schema approval_cases" | grep -i metadata
```

Expected: No output (metadataJson column no longer exists).

- [ ] **Step 3: Trigger an approval workflow (e.g., Admin Invite)**

Use the admin UI or API to create a new admin invite. Verify:
- The approval case is created successfully
- `objectSnapshot` is populated in the API response
- No `metadata` field appears in the API response

- [ ] **Step 4: Verify ApprovalDetailPage renders correctly**

Open the approval detail page in browser. Verify:
- Object Snapshot section renders correctly
- No Metadata section is visible
- No console errors

- [ ] **Step 5: Final commit (if any fixups needed)**

If any issues were found and fixed during smoke testing, commit those fixes.
