# Approval Object Snapshot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `objectSnapshot` JSON column to `approval_cases` so each approval carries a frozen copy of its subject (request) data; hide request page navigation entries in admin UI.

**Architecture:** Prisma migration adds the column. `CreateApprovalDto` gets an optional `objectSnapshot` field. Each of 6 workflows passes the request record when calling `createAndSubmit`. Frontend approval detail page renders the snapshot as a generic JSON block. Three sidebar nav entries are hidden.

**Tech Stack:** NestJS, Prisma, SQLite, React, TypeScript

---

### Task 1: DB Migration — Add `objectSnapshot` column

**Files:**
- Create: `prisma/migrations/20260507180000_add_approval_object_snapshot/migration.sql`
- Modify: `prisma/schema.prisma:719-769`

- [ ] **Step 1: Add column to Prisma schema**

In `prisma/schema.prisma`, inside the `ApprovalCase` model, add `objectSnapshot` after `metadataJson`:

```prisma
  metadataJson                   String                         @default("{}")
  objectSnapshot                 String?
  traceId                        String
```

- [ ] **Step 2: Generate migration**

Run:
```bash
cd Exchange_js && npx prisma migrate dev --name add_approval_object_snapshot
```

Expected: new migration directory created under `prisma/migrations/`, schema updated.

- [ ] **Step 3: Verify migration SQL**

Read the generated `migration.sql`. It should contain:
```sql
ALTER TABLE "approval_cases" ADD COLUMN "objectSnapshot" TEXT;
```

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(migration): add objectSnapshot column to approval_cases"
```

---

### Task 2: Backend — DTO + Service changes

**Files:**
- Modify: `src/modules/governance/approvals/dto/approval.dto.ts:12-47`
- Modify: `src/modules/governance/approvals/approvals.service.ts:738-768` (createCaseWithUniqueNo call in createDraftCase)
- Modify: `src/modules/governance/approvals/approvals.service.ts:530-584` (mapApproval)

- [ ] **Step 1: Add `objectSnapshot` to `CreateApprovalDto`**

In `src/modules/governance/approvals/dto/approval.dto.ts`, add after the `metadata` field (line 26):

```typescript
  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;

  @ApiPropertyOptional({ type: Object, description: 'Frozen snapshot of the approval subject (request) at creation time' })
  @IsOptional()
  @IsObject()
  objectSnapshot?: Record<string, unknown>;
```

- [ ] **Step 2: Pass `objectSnapshot` through to Prisma create**

In `src/modules/governance/approvals/approvals.service.ts`, find the `createCaseWithUniqueNo` call inside `createDraftCase` (around line 738). The data object passed already has all DTO fields spread. Add `objectSnapshot` serialization:

Find the line:
```typescript
        metadataJson: this.serializeMetadata(dto.metadata || {}),
```

Add after it:
```typescript
        objectSnapshot: dto.objectSnapshot ? JSON.stringify(dto.objectSnapshot) : null,
```

- [ ] **Step 3: Add `objectSnapshot` to `mapApproval` response**

In `src/modules/governance/approvals/approvals.service.ts`, in the `mapApproval` method (line 551), add after the `metadata` line:

Find:
```typescript
      metadata: this.parseMetadata(approval.metadataJson),
```

Add after it:
```typescript
      objectSnapshot: approval.objectSnapshot ? JSON.parse(approval.objectSnapshot as string) : null,
```

- [ ] **Step 4: Verify backend compiles**

Run:
```bash
cd Exchange_js && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/modules/governance/approvals/dto/approval.dto.ts src/modules/governance/approvals/approvals.service.ts
git commit -m "feat(approvals): accept and return objectSnapshot in DTO and service"
```

---

### Task 3: Workflow — Admin Invite passes snapshot

**Files:**
- Modify: `src/modules/identity/users/admin-invite-workflow.service.ts:68-88`

- [ ] **Step 1: Build snapshot and pass to `createAndSubmit`**

In `admin-invite-workflow.service.ts`, the `createAndSubmit` call starts at line 68. Add `objectSnapshot` to the first argument object. The snapshot captures the provisional user data that is the "object" of this approval:

```typescript
      approvalCase = await this.approvalsService.createAndSubmit(
        {
          actionType: ApprovalActionTypes.ADMIN_INVITE_APPROVAL,
          entityRef: user.id,
          workflowType: AuditBusinessWorkflowTypes.ADMIN_INVITE,
          workflowId: user.id,
          workflowNo: user.userNo,
          traceId,
          metadata: {
            userNo: user.userNo,
            userEmail: user.email,
            roleCodes,
            changeReason: dto.changeReason || null,
          },
          objectSnapshot: {
            userNo: user.userNo,
            email: user.email,
            roleCodes,
            changeReason: dto.changeReason || null,
            status: user.status,
            createdAt: user.createdAt,
          },
        },
        {
          reason: dto.changeReason || `Admin invite request for ${user.email}`,
          traceId,
        },
        actor,
      );
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/identity/users/admin-invite-workflow.service.ts
git commit -m "feat(admin-invite): pass objectSnapshot to approval case"
```

---

### Task 4: Workflow — Role Binding Change passes snapshot

**Files:**
- Modify: `src/modules/identity/users/admin-role-binding-change-workflow.service.ts:83-102`

- [ ] **Step 1: Pass request record as `objectSnapshot`**

In `admin-role-binding-change-workflow.service.ts`, the `createAndSubmit` call starts at line 83. The `request` variable (created at line 71) contains the full `adminRoleChangeRequest` record. Add `objectSnapshot`:

```typescript
    const approvalCase = await this.approvalsService.createAndSubmit(
      {
        actionType: ApprovalActionTypes.ADMIN_ROLE_BINDING_CHANGE_APPROVAL,
        entityRef: request.id,
        workflowType: AuditBusinessWorkflowTypes.ADMIN_ROLE_BINDING_CHANGE,
        workflowId: request.id,
        workflowNo: requestNo,
        traceId,
        metadata: {
          requestNo,
          targetUserId: targetUser.id,
          targetUserNo: targetUser.userNo,
          currentRoleCodes,
          proposedRoleCodes: dto.roleCodes,
          changeReason: dto.changeReason,
        },
        objectSnapshot: {
          requestNo: request.requestNo,
          targetUserId: request.targetUserId,
          targetUserNo: targetUser.userNo,
          targetEmail: targetUser.email,
          currentRoleCodes: JSON.parse(request.currentRoleCodes),
          proposedRoleCodes: JSON.parse(request.proposedRoleCodes),
          changeReason: request.changeReason,
          status: request.status,
          createdAt: request.createdAt,
        },
      },
      { reason: dto.changeReason, traceId },
      actor,
    );
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/identity/users/admin-role-binding-change-workflow.service.ts
git commit -m "feat(role-change): pass objectSnapshot to approval case"
```

---

### Task 5: Workflow — Admin Suspension passes snapshot

**Files:**
- Modify: `src/modules/identity/users/admin-suspension-workflow.service.ts:88-107`

- [ ] **Step 1: Pass target user data as `objectSnapshot`**

In `admin-suspension-workflow.service.ts`, the `createAndSubmit` call starts at line 88. Suspension has no separate request table — the "object" is the target user + reason. Add `objectSnapshot`:

```typescript
    const approvalCase = await this.approvalsService.createAndSubmit(
      {
        actionType: ApprovalActionTypes.ADMIN_SUSPENSION_APPROVAL,
        entityRef: dto.targetUserId,
        workflowType: AuditBusinessWorkflowTypes.ADMIN_SUSPENSION,
        workflowId: dto.targetUserId,
        workflowNo: targetUser.userNo,
        traceId,
        metadata: {
          targetUserNo: targetUser.userNo,
          targetEmail: targetUser.email,
          reason: dto.reason,
        },
        objectSnapshot: {
          targetUserId: dto.targetUserId,
          targetUserNo: targetUser.userNo,
          targetEmail: targetUser.email,
          targetStatus: targetUser.status,
          reason: dto.reason,
        },
      },
      {
        reason: dto.reason,
        traceId,
      },
      actor,
    );
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/identity/users/admin-suspension-workflow.service.ts
git commit -m "feat(suspension): pass objectSnapshot to approval case"
```

---

### Task 6: Workflow — Admin Reactivation passes snapshot

**Files:**
- Modify: `src/modules/identity/users/admin-reactivation-workflow.service.ts:88-107`

- [ ] **Step 1: Pass target user data as `objectSnapshot`**

In `admin-reactivation-workflow.service.ts`, the `createAndSubmit` call starts at line 88. Same pattern as Suspension. Add `objectSnapshot`:

```typescript
    const approvalCase = await this.approvalsService.createAndSubmit(
      {
        actionType: ApprovalActionTypes.ADMIN_REACTIVATION_APPROVAL,
        entityRef: dto.targetUserId,
        workflowType: AuditBusinessWorkflowTypes.ADMIN_REACTIVATION,
        workflowId: dto.targetUserId,
        workflowNo: targetUser.userNo,
        traceId,
        metadata: {
          targetUserNo: targetUser.userNo,
          targetEmail: targetUser.email,
          reason: dto.reason,
        },
        objectSnapshot: {
          targetUserId: dto.targetUserId,
          targetUserNo: targetUser.userNo,
          targetEmail: targetUser.email,
          targetStatus: targetUser.status,
          reason: dto.reason,
        },
      },
      {
        reason: dto.reason,
        traceId,
      },
      actor,
    );
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/identity/users/admin-reactivation-workflow.service.ts
git commit -m "feat(reactivation): pass objectSnapshot to approval case"
```

---

### Task 7: Workflow — Audit Evidence Export passes snapshot

**Files:**
- Modify: `src/modules/audit-logging/audit-evidence-export-workflow.service.ts:116-136`

- [ ] **Step 1: Pass evidence package record as `objectSnapshot`**

In `audit-evidence-export-workflow.service.ts`, the `createAndSubmit` call starts at line 116. The `evidencePackage` variable (created at line 100) is the request subject. Add `objectSnapshot`:

```typescript
    const submitted = await this.approvalsService.createAndSubmit(
      {
        actionType: ApprovalActionTypes.AUDIT_EVIDENCE_EXPORT_APPROVAL,
        entityRef: evidencePackage.id,
        workflowType: AuditBusinessWorkflowTypes.AUDIT_EVIDENCE_EXPORT,
        workflowId: evidencePackage.id,
        workflowNo: evidencePackage.packageNo,
        metadata: {
          packageId: evidencePackage.id,
          packageNo: evidencePackage.packageNo,
          itemCount: selection.itemCount,
          workflowSummary: selection.workflowSummary,
        },
        objectSnapshot: {
          packageNo: evidencePackage.packageNo,
          exportMode: evidencePackage.exportMode,
          itemCount: evidencePackage.itemCount,
          status: evidencePackage.status,
          filterSnapshot: selection.filterSnapshot,
          digest: evidencePackage.digest,
          createdAt: evidencePackage.createdAt,
        },
        traceId: query.traceId,
      },
      {
        reason: `Evidence export request ${evidencePackage.packageNo} submitted`,
        traceId: query.traceId,
      },
      actor,
    );
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/audit-logging/audit-evidence-export-workflow.service.ts
git commit -m "feat(evidence-export): pass objectSnapshot to approval case"
```

---

### Task 8: Workflow — Approval Policy Change passes snapshot

**Files:**
- Modify: `src/modules/governance/approvals/approval-policy-change-workflow.service.ts:127-147`

- [ ] **Step 1: Pass policy change request as `objectSnapshot`**

In `approval-policy-change-workflow.service.ts`, the `createAndSubmit` call starts at line 127. The `request` variable (created at line 112) is the subject. Add `objectSnapshot`:

```typescript
    const approvalCase = await this.approvalsService.createAndSubmit(
      {
        actionType: ApprovalActionTypes.APPROVAL_POLICY_CHANGE,
        entityRef: request.id,
        workflowType: AuditBusinessWorkflowTypes.APPROVAL_POLICY,
        workflowId: request.id,
        workflowNo: requestNo,
        traceId,
        metadata: {
          requestNo,
          targetActionType,
          currentStepsConfig: currentPolicy.steps,
          proposedStepsConfig: proposedSteps,
          currentCheckerRoles: currentPolicy.checkerRoles,
          proposedCheckerRoles,
          changeReason,
        },
        objectSnapshot: {
          requestNo: request.requestNo,
          targetActionType: request.targetActionType,
          currentCheckerRoles: request.currentCheckerRoles,
          proposedCheckerRoles: request.proposedCheckerRoles,
          currentStepsConfig: JSON.parse(request.currentStepsConfig),
          proposedStepsConfig: JSON.parse(request.proposedStepsConfig),
          changeReason: request.changeReason,
          status: request.status,
          createdAt: request.createdAt,
        },
      },
      { reason: changeReason, traceId },
      actor,
    );
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/governance/approvals/approval-policy-change-workflow.service.ts
git commit -m "feat(policy-change): pass objectSnapshot to approval case"
```

---

### Task 9: Frontend — Add objectSnapshot display to Approval Detail

**Files:**
- Modify: `admin-web/src/pages/ApprovalDetailPage.tsx:22-52` (interface)
- Modify: `admin-web/src/pages/ApprovalDetailPage.tsx` (render section)

- [ ] **Step 1: Add `objectSnapshot` to `ApprovalDetail` interface**

In `ApprovalDetailPage.tsx`, add to the `ApprovalDetail` interface (after line 38 `metadata`):

```typescript
  metadata?: Record<string, unknown>;
  objectSnapshot?: Record<string, unknown> | null;
```

- [ ] **Step 2: Add objectSnapshot render block**

Find the section in the JSX that renders `metadata` using `<JsonBlock>`. Add a similar block for `objectSnapshot` immediately before or after it:

```tsx
{detail.objectSnapshot && (
  <div className="mt-4">
    <h3 className="text-sm font-medium text-adm-t2 mb-2">Request Snapshot</h3>
    <JsonBlock data={detail.objectSnapshot} />
  </div>
)}
```

The `<JsonBlock>` component is already imported and used in this page for metadata display.

- [ ] **Step 3: Verify in browser**

Run:
```bash
cd Exchange_js && npm run dev:start
```

Navigate to `http://localhost:3501/dashboard/control-gates/approvals`, open any approval detail. For new approvals (created after the migration), the "Request Snapshot" section should appear. For old approvals, it should not render.

- [ ] **Step 4: Commit**

```bash
git add admin-web/src/pages/ApprovalDetailPage.tsx
git commit -m "feat(admin-web): display objectSnapshot on approval detail page"
```

---

### Task 10: Frontend — Hide request page navigation entries

**Files:**
- Modify: `admin-web/src/components/DashboardLayout.tsx:105-180`

- [ ] **Step 1: Comment out 3 sidebar entries**

In `DashboardLayout.tsx`, comment out these entries from the `menuItems` array:

1. **Role Change Requests** (lines 130-134):
```typescript
        // Hidden: objectSnapshot on approval replaces direct navigation
        // {
        //   path: '/dashboard/members/role-change-requests',
        //   label: 'Role Change Requests',
        //   icon: <ArrowLeftRight size={13} />,
        //   requiredPermissions: [PERMISSIONS.IAM_ROLE_CHANGE_REQUESTS_READ],
        // },
```

2. **Policy Change Requests** (lines 155-159):
```typescript
        // Hidden: objectSnapshot on approval replaces direct navigation
        // {
        //   path: '/dashboard/governance/policy-change-requests',
        //   label: 'Policy Change Requests',
        //   icon: <ArrowLeftRight size={13} />,
        //   requiredPermissions: [PERMISSIONS.GOV_APPROVAL_POLICY_CHANGE_REQUESTS_READ],
        // },
```

3. **Evidence Packages** (lines 174-178):
```typescript
        // Hidden: objectSnapshot on approval replaces direct navigation
        // {
        //   path: '/dashboard/audit/evidence-exports',
        //   label: 'Evidence Packages',
        //   icon: <Layers size={13} />,
        //   requiredPermissions: [PERMISSIONS.AUDIT_EVIDENCE_EXPORTS_READ],
        // },
```

Routes in `App.tsx` are **NOT** removed — pages remain accessible via direct URL.

- [ ] **Step 2: Verify sidebar in browser**

Navigate to `http://localhost:3501`. Confirm:
- "Role Change Requests" is gone from Identity & Access
- "Policy Change Requests" is gone from Control Gates
- "Evidence Packages" is gone from Audit Center
- "Approvals" and "Approval Policies" remain visible

- [ ] **Step 3: Commit**

```bash
git add admin-web/src/components/DashboardLayout.tsx
git commit -m "feat(admin-web): hide request page nav entries from sidebar"
```
