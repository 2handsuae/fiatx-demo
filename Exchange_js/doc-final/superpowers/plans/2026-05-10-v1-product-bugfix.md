# V1 Product Bug Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 6 confirmed product-level bugs found during V1 code audit.

**Architecture:** Point fixes across auth, approval engine, and audit logging. No new files created — all modifications to existing services. Fix 2 and Fix 5 share a helper method extracted into `approvals.service.ts`.

**Tech Stack:** NestJS, Prisma, TypeScript

---

### Task 1: Add ROLE_DEFINITION_CREATE to V1_APPROVAL_ACTION_TYPES

**Files:**
- Modify: `src/modules/governance/approvals/constants/approval.constants.ts:339-347`

- [ ] **Step 1: Add the missing action type**

In `approval.constants.ts`, find `V1_APPROVAL_ACTION_TYPES` and add `ROLE_DEFINITION_CREATE`:

```typescript
export const V1_APPROVAL_ACTION_TYPES: readonly string[] = [
  ApprovalActionTypes.ADMIN_INVITE_APPROVAL,
  ApprovalActionTypes.ADMIN_ROLE_BINDING_CHANGE_APPROVAL,
  ApprovalActionTypes.ADMIN_SUSPENSION_APPROVAL,
  ApprovalActionTypes.ADMIN_REACTIVATION_APPROVAL,
  ApprovalActionTypes.AUDIT_EVIDENCE_EXPORT_APPROVAL,
  ApprovalActionTypes.APPROVAL_POLICY_CHANGE,
  ApprovalActionTypes.ROLE_DEFINITION_CREATE,   // ADD THIS LINE
  ApprovalActionTypes.ROLE_DEFINITION_MODIFY,
] as const;
```

- [ ] **Step 2: Verify the constant exists**

Run: `cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js && grep -n 'ROLE_DEFINITION_CREATE' src/modules/governance/approvals/constants/approval.constants.ts`

Expected: Should show the constant defined in `ApprovalActionTypes` AND now in `V1_APPROVAL_ACTION_TYPES`.

- [ ] **Step 3: Commit**

```bash
git add src/modules/governance/approvals/constants/approval.constants.ts
git commit -m "fix(approvals): add ROLE_DEFINITION_CREATE to V1_APPROVAL_ACTION_TYPES"
```

---

### Task 2: Fix Duplicate Audit Logs for 3 Approval Types

**Files:**
- Modify: `src/modules/governance/approvals/approvals.service.ts:350-360`

- [ ] **Step 1: Add missing workflow types to DEDICATED list**

In `approvals.service.ts`, find `hasDedicatedAuditService` and add the 3 missing types:

```typescript
  private hasDedicatedAuditService(workflowType: string | null | undefined): boolean {
    if (!workflowType) return false;
    const DEDICATED: string[] = [
      AuditBusinessWorkflowTypes.AUDIT_EVIDENCE_EXPORT,
      AuditBusinessWorkflowTypes.ADMIN_INVITE,
      AuditBusinessWorkflowTypes.ADMIN_ROLE_BINDING_CHANGE,
      AuditBusinessWorkflowTypes.ADMIN_SUSPENSION,
      AuditBusinessWorkflowTypes.ADMIN_REACTIVATION,
      AuditBusinessWorkflowTypes.APPROVAL_POLICY,          // ADD
      AuditBusinessWorkflowTypes.ROLE_DEFINITION_CREATE,   // ADD
      AuditBusinessWorkflowTypes.ROLE_DEFINITION_MODIFY,   // ADD
    ];
    return DEDICATED.includes(workflowType);
  }
```

- [ ] **Step 2: Verify the constants exist**

Run: `cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js && grep -n 'APPROVAL_POLICY\|ROLE_DEFINITION_CREATE\|ROLE_DEFINITION_MODIFY' src/modules/audit-logging/constants/audit-actions.constant.ts | head -10`

Expected: Should show these workflow types defined in `AuditBusinessWorkflowTypes`. If any are missing, check what the actual constant names are and use those.

- [ ] **Step 3: Compile check**

Run: `cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js && npx tsc --noEmit --pretty 2>&1 | head -30`

Expected: No errors related to the added constants.

- [ ] **Step 4: Commit**

```bash
git add src/modules/governance/approvals/approvals.service.ts
git commit -m "fix(approvals): add 3 missing types to hasDedicatedAuditService to prevent duplicate audit logs"
```

---

### Task 3: Block SUSPENDED Users from Logging In

**Files:**
- Modify: `src/modules/identity/auth/auth.service.ts:84-116`
- Modify: `src/modules/identity/users/users.domain.service.ts:351-378`
- Modify: `src/modules/identity/users/first-login-workflow.service.ts:389-478`

- [ ] **Step 1: Add SUSPENDED check in `validateUser`**

In `auth.service.ts`, find the INACTIVE check block (ends around line 116 with `throw new ForbiddenException('Account not activated...')`). Immediately AFTER the closing `}` of the INACTIVE block and BEFORE the LOCKED check, add:

```typescript
    if (user.status === 'SUSPENDED') {
      await this.auditLogsService.recordByActor(
        {
          action: AuditActions.ADMIN_LOGIN_FAILED,
          entityType: AuditEntityTypes.AUTH,
          entityId: user.id,
          entityNo: user.userNo,
          result: AuditResult.REJECTED,
          reason: 'Admin login rejected: account suspended',
          metadata: {
            identifierHash: this.maskIdentifier(identifier),
            accountStatus: user.status,
          },
          ...this.buildLoginAuditContext({
            traceId: authTraceId,
            userNo: user.userNo,
            identifier,
          }),
          requestId: ctx.requestId,
          sourceIp: ctx.sourceIp,
          sourcePlatform: ctx.sourcePlatform || 'ADMIN_AUTH_API',
        },
        {
          actorType: 'ADMIN',
          actorId: user.id,
          actorNo: user.userNo,
          actorRole: user.role,
        },
      );
      throw new ForbiddenException('Account has been suspended');
    }
```

- [ ] **Step 2: Add `status` to `findFirstLoginState` select**

In `users.domain.service.ts`, find `findFirstLoginState` method. Add `status: true` to the `select` object:

```typescript
      select: {
        id: true,
        userNo: true,
        email: true,
        role: true,
        status: true,           // ADD THIS LINE
        firstLoginStatus: true,
        firstLoginTraceId: true,
        mfaSecret: true,
        mfaEnabledAt: true,
        mfaVerifyFailCount: true,
        mfaVerifyLockedUntil: true,
      },
```

Also update the method's return type to include `status: string`:

```typescript
  async findFirstLoginState(userId: string): Promise<{
    id: string;
    userNo: string;
    email: string;
    role: string;
    status: string;             // ADD THIS LINE
    firstLoginStatus: string;
    // ... rest unchanged
  } | null> {
```

- [ ] **Step 3: Add status gate in `verifyMfaLogin`**

In `first-login-workflow.service.ts`, find `verifyMfaLogin`. The method calls `this.loadUser(userId)` at line ~399. After that call and before the MFA checks, add:

```typescript
    const user = await this.loadUser(userId);

    // Status gate: reject SUSPENDED and LOCKED users
    if (user.status === 'SUSPENDED') {
      throw new ForbiddenException('Account has been suspended');
    }
    if (user.status === 'LOCKED') {
      throw new ForbiddenException('Account is locked');
    }

    if (!user.mfaSecret) {
```

Note: `loadUser` internally calls `findFirstLoginState` which now includes `status`. Verify that `loadUser` passes through the `status` field — read the method to confirm. If `loadUser` has its own select or mapping, add `status` there too.

- [ ] **Step 4: Compile check**

Run: `cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js && npx tsc --noEmit --pretty 2>&1 | head -30`

Expected: No type errors.

- [ ] **Step 5: Commit**

```bash
git add src/modules/identity/auth/auth.service.ts src/modules/identity/users/users.domain.service.ts src/modules/identity/users/first-login-workflow.service.ts
git commit -m "fix(auth): block SUSPENDED users from logging in via password and MFA paths"
```

---

### Task 4: Fix handleExpired Audit Action and Method

**Files:**
- Modify: `src/modules/audit-logging/constants/audit-actions.constant.ts`
- Modify: `src/modules/governance/approvals/approval-handler.base.ts:27-34,156-185`
- Modify: 8 ApprovalHandlerBase subclass files (listed below)

#### Step group A: Register APPROVAL_EXPIRED audit actions

- [ ] **Step 1: Add APPROVAL_EXPIRED to each governance namespace**

In `audit-actions.constant.ts`, find `AuditGovernanceActions` and add `APPROVAL_EXPIRED` to each relevant namespace. Follow the existing pattern — each namespace already has `APPROVAL_GRANTED`, `APPROVAL_DECLINED`, `APPROVAL_CANCELLED`. Add `APPROVAL_EXPIRED` after `APPROVAL_CANCELLED` in each:

```typescript
  ADMIN_INVITE: {
    // ... existing fields ...
    APPROVAL_CANCELLED: 'APPROVAL_CANCELLED',
    APPROVAL_EXPIRED: 'APPROVAL_EXPIRED',    // ADD
    // ... rest ...
  },
  ADMIN_ROLE_BINDING: {
    // ... existing fields ...
    APPROVAL_CANCELLED: 'APPROVAL_CANCELLED',
    APPROVAL_EXPIRED: 'APPROVAL_EXPIRED',    // ADD
    // ... rest ...
  },
  ADMIN_SUSPENSION: {
    // ... existing fields ...
    APPROVAL_CANCELLED: 'APPROVAL_CANCELLED',
    APPROVAL_EXPIRED: 'APPROVAL_EXPIRED',    // ADD
    // ... rest ...
  },
  ADMIN_REACTIVATION: {
    // ... existing fields ...
    APPROVAL_CANCELLED: 'APPROVAL_CANCELLED',
    APPROVAL_EXPIRED: 'APPROVAL_EXPIRED',    // ADD
    // ... rest ...
  },
  APPROVAL_POLICY: {
    // ... existing fields ...
    APPROVAL_CANCELLED: 'APPROVAL_CANCELLED',
    APPROVAL_EXPIRED: 'APPROVAL_EXPIRED',    // ADD
    // ... rest ...
  },
  AUDIT_EVIDENCE_EXPORT: {
    // ... existing fields ...
    APPROVAL_CANCELLED: 'APPROVAL_CANCELLED',
    APPROVAL_EXPIRED: 'APPROVAL_EXPIRED',    // ADD
    // ... rest ...
  },
  ROLE_DEFINITION: {
    // ... existing fields ...
    APPROVAL_CANCELLED: 'APPROVAL_CANCELLED',
    APPROVAL_EXPIRED: 'APPROVAL_EXPIRED',    // ADD
    // ... rest ...
  },
```

Note: `ROLE_DEFINITION` namespace is shared by both Create and Modify handlers — one constant suffices.

- [ ] **Step 2: Compile check**

Run: `cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js && npx tsc --noEmit --pretty 2>&1 | head -20`

Expected: No errors.

#### Step group B: Update base class

- [ ] **Step 3: Extend `auditActions` interface in base class**

In `approval-handler.base.ts`, find the `auditActions` abstract property (lines 29-33). Add `expired`:

```typescript
  abstract readonly auditActions: {
    granted: string;
    declined: string;
    cancelled: string;
    expired: string;
  };
```

- [ ] **Step 4: Fix `handleExpired` method**

In `approval-handler.base.ts`, replace the entire `handleExpired` method (lines 156-185) with:

```typescript
  @OnEvent(ApprovalEvents.EXPIRED, { async: true })
  async handleExpired(event: ApprovalDecisionEvent) {
    if (event.actionType !== this.actionType) return;

    await this.auditLogsService.recordSystem({
      action: this.auditActions.expired,
      entityType: this.entityType,
      entityId: event.entityRef,
      entityNo: event.workflowNo || undefined,
      workflowType: this.workflowType,
      traceId: event.traceId,
      result: AuditResult.SUCCESS,
      metadata: {
        approvalId: event.approvalId,
        approvalNo: event.approvalNo,
        expiredAt: event.decidedAt,
      },
      requestId: `${this.workflowType}_APPROVAL_EXPIRED_${event.approvalNo}`,
      sourcePlatform: 'ADMIN_API',
    });

    await this.emitDecidedEvent('EXPIRED', event);
  }
```

Key changes:
- `this.auditActions.cancelled` → `this.auditActions.expired`
- `recordByActor(payload, actor)` → `recordSystem(payload)` (removes fabricated actor)

- [ ] **Step 5: Compile — expect 8 errors**

Run: `cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js && npx tsc --noEmit --pretty 2>&1 | head -40`

Expected: 8 type errors, one per subclass, because they don't have `expired` yet.

#### Step group C: Update all 8 subclasses

- [ ] **Step 6: Add `expired` to all 8 handler subclasses**

For each of the 8 files below, find the `auditActions` property and add `expired`. The pattern is identical — add one line after `cancelled`:

**File 1:** `src/modules/identity/users/admin-invite-approval.service.ts`
```typescript
    auditActions = {
      granted: AuditGovernanceActions.ADMIN_INVITE.APPROVAL_GRANTED,
      declined: AuditGovernanceActions.ADMIN_INVITE.APPROVAL_DECLINED,
      cancelled: AuditGovernanceActions.ADMIN_INVITE.APPROVAL_CANCELLED,
      expired: AuditGovernanceActions.ADMIN_INVITE.APPROVAL_EXPIRED,
    };
```

**File 2:** `src/modules/identity/users/admin-role-binding-change-approval.service.ts`
```typescript
    auditActions = {
      granted: AuditGovernanceActions.ADMIN_ROLE_BINDING.APPROVAL_GRANTED,
      declined: AuditGovernanceActions.ADMIN_ROLE_BINDING.APPROVAL_DECLINED,
      cancelled: AuditGovernanceActions.ADMIN_ROLE_BINDING.APPROVAL_CANCELLED,
      expired: AuditGovernanceActions.ADMIN_ROLE_BINDING.APPROVAL_EXPIRED,
    };
```

**File 3:** `src/modules/identity/users/admin-suspension-approval.service.ts`
```typescript
    auditActions = {
      granted: AuditGovernanceActions.ADMIN_SUSPENSION.APPROVAL_GRANTED,
      declined: AuditGovernanceActions.ADMIN_SUSPENSION.APPROVAL_DECLINED,
      cancelled: AuditGovernanceActions.ADMIN_SUSPENSION.APPROVAL_CANCELLED,
      expired: AuditGovernanceActions.ADMIN_SUSPENSION.APPROVAL_EXPIRED,
    };
```

**File 4:** `src/modules/identity/users/admin-reactivation-approval.service.ts`
```typescript
    auditActions = {
      granted: AuditGovernanceActions.ADMIN_REACTIVATION.APPROVAL_GRANTED,
      declined: AuditGovernanceActions.ADMIN_REACTIVATION.APPROVAL_DECLINED,
      cancelled: AuditGovernanceActions.ADMIN_REACTIVATION.APPROVAL_CANCELLED,
      expired: AuditGovernanceActions.ADMIN_REACTIVATION.APPROVAL_EXPIRED,
    };
```

**File 5:** `src/modules/identity/access-control/role-definition-create-approval.service.ts`
```typescript
    auditActions = {
      granted: AuditGovernanceActions.ROLE_DEFINITION.APPROVAL_GRANTED,
      declined: AuditGovernanceActions.ROLE_DEFINITION.APPROVAL_DECLINED,
      cancelled: AuditGovernanceActions.ROLE_DEFINITION.APPROVAL_CANCELLED,
      expired: AuditGovernanceActions.ROLE_DEFINITION.APPROVAL_EXPIRED,
    };
```

**File 6:** `src/modules/identity/access-control/role-definition-modify-approval.service.ts`
```typescript
    auditActions = {
      granted: AuditGovernanceActions.ROLE_DEFINITION.APPROVAL_GRANTED,
      declined: AuditGovernanceActions.ROLE_DEFINITION.APPROVAL_DECLINED,
      cancelled: AuditGovernanceActions.ROLE_DEFINITION.APPROVAL_CANCELLED,
      expired: AuditGovernanceActions.ROLE_DEFINITION.APPROVAL_EXPIRED,
    };
```

**File 7:** `src/modules/governance/approvals/approval-policy-change-approval.service.ts`
```typescript
    auditActions = {
      granted: AuditGovernanceActions.APPROVAL_POLICY.APPROVAL_GRANTED,
      declined: AuditGovernanceActions.APPROVAL_POLICY.APPROVAL_DECLINED,
      cancelled: AuditGovernanceActions.APPROVAL_POLICY.APPROVAL_CANCELLED,
      expired: AuditGovernanceActions.APPROVAL_POLICY.APPROVAL_EXPIRED,
    };
```

**File 8:** `src/modules/audit-logging/audit-evidence-export-approval.service.ts`
```typescript
    auditActions = {
      granted: AuditGovernanceActions.AUDIT_EVIDENCE_EXPORT.APPROVAL_GRANTED,
      declined: AuditGovernanceActions.AUDIT_EVIDENCE_EXPORT.APPROVAL_DECLINED,
      cancelled: AuditGovernanceActions.AUDIT_EVIDENCE_EXPORT.APPROVAL_CANCELLED,
      expired: AuditGovernanceActions.AUDIT_EVIDENCE_EXPORT.APPROVAL_EXPIRED,
    };
```

- [ ] **Step 7: Compile — should pass**

Run: `cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js && npx tsc --noEmit --pretty 2>&1 | head -20`

Expected: No errors.

- [ ] **Step 8: Commit**

```bash
git add src/modules/audit-logging/constants/audit-actions.constant.ts src/modules/governance/approvals/approval-handler.base.ts src/modules/identity/users/admin-invite-approval.service.ts src/modules/identity/users/admin-role-binding-change-approval.service.ts src/modules/identity/users/admin-suspension-approval.service.ts src/modules/identity/users/admin-reactivation-approval.service.ts src/modules/identity/access-control/role-definition-create-approval.service.ts src/modules/identity/access-control/role-definition-modify-approval.service.ts src/modules/governance/approvals/approval-policy-change-approval.service.ts src/modules/audit-logging/audit-evidence-export-approval.service.ts
git commit -m "fix(approvals): handleExpired writes APPROVAL_EXPIRED via recordSystem instead of CANCELLED via recordByActor"
```

---

### Task 5: Multi-Step Approval Cross-Step SoD Enforcement

**Files:**
- Modify: `src/modules/governance/approvals/approvals.service.ts:600-647`

- [ ] **Step 1: Add `hasActorApprovedAnyStep` helper**

In `approvals.service.ts`, add a private helper method near `resolveDecisionRole` (e.g., right before it):

```typescript
  private hasActorApprovedAnyStep(steps: any[], userId: string): boolean {
    return steps.some(
      (s) => s.status === ApprovalStepStatuses.APPROVED && s.decidedByUserId === userId,
    );
  }
```

Verify that `ApprovalStepStatuses` is already imported. If not, it should be available from the same constants file as `ApprovalStatuses`. Check with:

```bash
grep -n 'ApprovalStepStatuses' src/modules/governance/approvals/approvals.service.ts | head -5
```

- [ ] **Step 2: Add cross-step SoD check in `resolveDecisionRole`**

In `resolveDecisionRole`, find the existing maker-checker check (lines ~619-623):

```typescript
    if (
      !superAdminBypass &&
      actor.userId === approval.createdByUserId &&
      (await this.approvalPolicyService.isSameUserMakerCheckerDenied())
    ) {
      throw new ForbiddenException('Maker and checker must be different users');
    }
```

Immediately AFTER this block, add the cross-step SoD check:

```typescript
    if (approval.steps && this.hasActorApprovedAnyStep(approval.steps, actor.userId)) {
      throw new ConflictException('Same user cannot approve multiple steps of the same case');
    }
```

Verify `ConflictException` is imported from `@nestjs/common`. If not, add it to the import.

- [ ] **Step 3: Compile check**

Run: `cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js && npx tsc --noEmit --pretty 2>&1 | head -20`

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/modules/governance/approvals/approvals.service.ts
git commit -m "fix(approvals): enforce cross-step SoD — same user cannot approve multiple steps"
```

---

### Task 6: Make canApprove/canReject Step-Aware

**Files:**
- Modify: `src/modules/governance/approvals/approvals.service.ts:509-563`

- [ ] **Step 1: Rewrite `mapApproval` decision logic**

In `approvals.service.ts`, find `mapApproval` method. Replace the `availableDecisionRoles`, `makerCheckerConflict`, and `canDecide` computation block (lines ~514-528) with step-aware logic:

Find this block:
```typescript
    const checkerRoles = splitRoleCsv(approval.checkerRoles);
    const availableDecisionRoles = actor
      ? this.isSuperAdmin(actor)
        ? checkerRoles
        : checkerRoles.filter((role) => actor.roleCodes.includes(role))
      : [];
    const makerCheckerConflict = actor
      ? !this.isSuperAdmin(actor) &&
        actor.userId === approval.createdByUserId &&
        availableDecisionRoles.length > 0
      : false;
    const canDecide =
      approval.status === ApprovalStatuses.PENDING &&
      availableDecisionRoles.length > 0 &&
      !makerCheckerConflict;
```

Replace with:
```typescript
    const pendingStep = (approval.steps || []).find(
      (s: any) => s.status === ApprovalStepStatuses.PENDING,
    );
    const stepRoles = pendingStep
      ? splitRoleCsv(pendingStep.checkerRoleCandidates)
      : [];
    const availableDecisionRoles = actor
      ? this.isSuperAdmin(actor)
        ? stepRoles
        : stepRoles.filter((role) => actor.roleCodes.includes(role))
      : [];
    const makerCheckerConflict = actor
      ? !this.isSuperAdmin(actor) &&
        actor.userId === approval.createdByUserId &&
        availableDecisionRoles.length > 0
      : false;
    const crossStepConflict = actor
      ? this.hasActorApprovedAnyStep(approval.steps || [], actor.userId)
      : false;
    const canDecide =
      approval.status === ApprovalStatuses.PENDING &&
      !!pendingStep &&
      availableDecisionRoles.length > 0 &&
      !makerCheckerConflict &&
      !crossStepConflict;
```

Key changes:
- Uses `pendingStep.checkerRoleCandidates` instead of case-level `checkerRoles`
- Adds `!!pendingStep` guard — no pending step means `canDecide = false`
- Adds `!crossStepConflict` — reuses `hasActorApprovedAnyStep` from Task 5
- Falls back to empty `stepRoles` if no pending step (terminal state)

- [ ] **Step 2: Compile check**

Run: `cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js && npx tsc --noEmit --pretty 2>&1 | head -20`

Expected: No errors.

- [ ] **Step 3: Verify `splitRoleCsv` handles step field**

Run: `cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js && grep -n 'checkerRoleCandidates' src/modules/governance/approvals/approvals.service.ts | head -5`

Expected: The field is already used in the `approve` method (line ~889). Confirm the field name matches exactly.

- [ ] **Step 4: Commit**

```bash
git add src/modules/governance/approvals/approvals.service.ts
git commit -m "fix(approvals): make canApprove/canReject step-aware with cross-step SoD check"
```

---

### Task 7: Final Build Verification

- [ ] **Step 1: Full compile**

Run: `cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js && npx tsc --noEmit --pretty 2>&1 | tail -5`

Expected: No errors.

- [ ] **Step 2: Build**

Run: `cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js && npm run build 2>&1 | tail -10`

Expected: Build succeeds.

- [ ] **Step 3: Review all commits**

Run: `cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js && git log --oneline -6`

Expected 6 commits:
1. `fix(approvals): add ROLE_DEFINITION_CREATE to V1_APPROVAL_ACTION_TYPES`
2. `fix(approvals): add 3 missing types to hasDedicatedAuditService...`
3. `fix(auth): block SUSPENDED users from logging in...`
4. `fix(approvals): handleExpired writes APPROVAL_EXPIRED via recordSystem...`
5. `fix(approvals): enforce cross-step SoD...`
6. `fix(approvals): make canApprove/canReject step-aware...`
