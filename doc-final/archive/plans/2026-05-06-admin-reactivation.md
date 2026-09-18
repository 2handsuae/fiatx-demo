# C4b Admin Account Reactivation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a governed approval workflow to reactivate SUSPENDED admin accounts, with full backend API and admin-web UI.

**Architecture:** 3-layer (domain service → approval handler → workflow service), mirroring C4 suspension. Plus frontend button/modal in the existing detail page.

**Tech Stack:** NestJS, Prisma, EventEmitter2, React, Tailwind (adm-* tokens), lucide-react

---

### Task 1: Add ADMIN_REACTIVATION_APPROVAL to approval constants and policy

**Files:**
- Modify: `src/modules/governance/approvals/constants/approval.constants.ts:45-46` (add action type after ADMIN_SUSPENSION_APPROVAL)
- Modify: `src/modules/governance/approvals/constants/approval.constants.ts:237-243` (add policy after ADMIN_SUSPENSION_APPROVAL policy)

- [ ] **Step 1: Add the action type constant**

In `src/modules/governance/approvals/constants/approval.constants.ts`, after line 45 (`ADMIN_SUSPENSION_APPROVAL: 'ADMIN_SUSPENSION_APPROVAL',`), add:

```typescript
  ADMIN_REACTIVATION_APPROVAL: 'ADMIN_REACTIVATION_APPROVAL',
```

- [ ] **Step 2: Add the default approval policy**

In the same file, after the `ADMIN_SUSPENSION_APPROVAL` policy block (after line 243), add:

```typescript
  [ApprovalActionTypes.ADMIN_REACTIVATION_APPROVAL]: {
    riskLevel: ApprovalRiskLevels.HIGH,
    checkerRoles: ['SENIOR_MANAGEMENT_OFFICER'],
    timeoutHours: 48,
    allowCancel: true,
    allowRetry: false,
  },
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd Exchange_js && npx tsc --noEmit -p tsconfig.build.json 2>&1 | head -20`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/modules/governance/approvals/constants/approval.constants.ts
git commit -m "feat(approvals): add ADMIN_REACTIVATION_APPROVAL action type and policy"
```

---

### Task 2: Add ADMIN_REACTIVATION to hasDedicatedAuditService

**Files:**
- Modify: `src/modules/governance/approvals/approvals.service.ts:377` (add to DEDICATED array)

- [ ] **Step 1: Add ADMIN_REACTIVATION to the DEDICATED array**

In `src/modules/governance/approvals/approvals.service.ts`, find the `hasDedicatedAuditService` method. The `DEDICATED` array currently ends with `AuditBusinessWorkflowTypes.ADMIN_SUSPENSION`. Add after it:

```typescript
      AuditBusinessWorkflowTypes.ADMIN_REACTIVATION,
```

So the array becomes:
```typescript
    const DEDICATED: string[] = [
      AuditBusinessWorkflowTypes.AUDIT_EVIDENCE_EXPORT,
      AuditBusinessWorkflowTypes.ADMIN_INVITE,
      AuditBusinessWorkflowTypes.ADMIN_ROLE_BINDING_CHANGE,
      AuditBusinessWorkflowTypes.ADMIN_SUSPENSION,
      AuditBusinessWorkflowTypes.ADMIN_REACTIVATION,
    ];
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd Exchange_js && npx tsc --noEmit -p tsconfig.build.json 2>&1 | head -20`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/modules/governance/approvals/approvals.service.ts
git commit -m "feat(approvals): register ADMIN_REACTIVATION in hasDedicatedAuditService"
```

---

### Task 3: Add reactivateUser() to domain service

**Files:**
- Modify: `src/modules/identity/users/users.domain.service.ts` (add method after `suspendUser`)

- [ ] **Step 1: Add the reactivateUser method**

After the `suspendUser` method (after line 162), add:

```typescript
  async reactivateUser(
    userId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<{ id: string; userNo: string; status: string }> {
    const client = tx || this.prisma;
    const user = await client.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { id: true, userNo: true, status: true, userRoles: { select: { role: { select: { code: true } } } } },
    });
    if (!user) throw new NotFoundException('User not found');

    const roleCodes = user.userRoles.map((ur: any) => ur.role.code);
    if (roleCodes.includes('SUPER_ADMIN')) {
      throw new ConflictException('SUPER_ADMIN account cannot be reactivated via this workflow');
    }

    if (user.status !== 'SUSPENDED') {
      throw new ConflictException(`Cannot reactivate user in status: ${user.status}`);
    }

    const updated = await client.user.update({
      where: { id: userId },
      data: { status: 'ACTIVE', suspendedAt: null },
      select: { id: true, userNo: true, status: true },
    });

    return updated;
  }
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd Exchange_js && npx tsc --noEmit -p tsconfig.build.json 2>&1 | head -20`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/modules/identity/users/users.domain.service.ts
git commit -m "feat(identity): add reactivateUser() domain method"
```

---

### Task 4: Create Layer 2 — Approval handler

**Files:**
- Create: `src/modules/identity/users/admin-reactivation-approval.service.ts`

- [ ] **Step 1: Create the approval handler file**

Create `src/modules/identity/users/admin-reactivation-approval.service.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import {
  AuditBusinessWorkflowTypes,
  AuditEntityTypes,
  AuditGovernanceActions,
} from '../../audit-logging/constants/audit-actions.constant';
import { ApprovalHandlerBase } from '../../governance/approvals/approval-handler.base';
import { ApprovalActionTypes } from '../../governance/approvals/constants/approval.constants';

@Injectable()
export class AdminReactivationApprovalService extends ApprovalHandlerBase {
  readonly actionType = ApprovalActionTypes.ADMIN_REACTIVATION_APPROVAL;
  readonly workflowType = AuditBusinessWorkflowTypes.ADMIN_REACTIVATION;
  readonly auditActions = {
    granted: AuditGovernanceActions.ADMIN_REACTIVATION.APPROVAL_GRANTED,
    declined: AuditGovernanceActions.ADMIN_REACTIVATION.APPROVAL_DECLINED,
    cancelled: AuditGovernanceActions.ADMIN_REACTIVATION.APPROVAL_CANCELLED,
  };
  readonly entityType = AuditEntityTypes.ADMIN_USER;

  constructor(auditLogsService: AuditLogsService, eventEmitter: EventEmitter2) {
    super(auditLogsService, eventEmitter);
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd Exchange_js && npx tsc --noEmit -p tsconfig.build.json 2>&1 | head -20`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/modules/identity/users/admin-reactivation-approval.service.ts
git commit -m "feat(identity): add Layer 2 reactivation approval handler"
```

---

### Task 5: Create Layer 3 — Workflow service

**Files:**
- Create: `src/modules/identity/users/admin-reactivation-workflow.service.ts`

- [ ] **Step 1: Create the workflow service file**

Create `src/modules/identity/users/admin-reactivation-workflow.service.ts`:

```typescript
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import {
  AuditBusinessWorkflowTypes,
  AuditEntityTypes,
  AuditGovernanceActions,
} from '../../audit-logging/constants/audit-actions.constant';
import { AuditResult } from '../../audit-logging/dto/audit-log.dto';
import { ApprovalsService } from '../../governance/approvals/approvals.service';
import { ApprovalDecidedEvent } from '../../governance/approvals/approval-handler.base';
import {
  ApprovalActionTypes,
  ApprovalActorContext,
} from '../../governance/approvals/constants/approval.constants';
import { UsersDomainService } from './users.domain.service';

const SECONDARY_EVENT = 'workflow.admin-reactivation.decided';

export interface InitiateReactivationDto {
  targetUserId: string;
  reason: string;
}

@Injectable()
export class AdminReactivationWorkflowService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly usersDomainService: UsersDomainService,
    private readonly approvalsService: ApprovalsService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  private toAuditActor(actor: ApprovalActorContext) {
    return {
      actorType: actor.actorType,
      actorId: actor.userId,
      actorNo: actor.userNo,
      actorRole: actor.role || actor.roleCodes[0] || 'UNKNOWN',
    };
  }

  async initiateReactivation(dto: InitiateReactivationDto, actor: ApprovalActorContext) {
    const traceId = randomUUID();

    if (actor.userId === dto.targetUserId) {
      throw new ForbiddenException('Cannot reactivate your own account');
    }

    const targetUser = await this.usersDomainService.findById(dto.targetUserId);
    if (!targetUser) {
      throw new NotFoundException('Target user not found');
    }

    if (targetUser.status !== 'SUSPENDED') {
      throw new ConflictException(`User is not suspended (current status: ${targetUser.status})`);
    }

    const targetRoles = await this.prisma.userRole.findMany({
      where: { userId: dto.targetUserId },
      select: { role: { select: { code: true } } },
    });
    if (targetRoles.some((ur: any) => ur.role.code === 'SUPER_ADMIN')) {
      throw new ForbiddenException('SUPER_ADMIN account cannot be managed via this workflow');
    }

    const existingPending = await this.prisma.approvalCase.findFirst({
      where: {
        actionType: ApprovalActionTypes.ADMIN_REACTIVATION_APPROVAL,
        entityRef: dto.targetUserId,
        status: 'PENDING',
        deletedAt: null,
      },
    });
    if (existingPending) {
      throw new ConflictException(
        `A pending reactivation approval already exists: ${existingPending.approvalNo}`,
      );
    }

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
      },
      {
        reason: dto.reason,
        traceId,
      },
      actor,
    );

    await this.auditLogsService.recordByActor(
      {
        action: AuditGovernanceActions.ADMIN_REACTIVATION.REACTIVATION_REQUESTED,
        entityType: AuditEntityTypes.ADMIN_USER,
        entityId: dto.targetUserId,
        entityNo: targetUser.userNo,
        workflowType: AuditBusinessWorkflowTypes.ADMIN_REACTIVATION,
        traceId,
        result: AuditResult.SUCCESS,
        metadata: {
          targetEmail: targetUser.email,
          reason: dto.reason,
          approvalNo: approvalCase.approvalNo,
        },
        requestId: `ADMIN_REACTIVATION_REQUESTED_${targetUser.userNo}`,
        sourcePlatform: 'ADMIN_API',
      },
      this.toAuditActor(actor),
    );

    return {
      approvalNo: approvalCase.approvalNo,
      traceId,
      targetUserNo: targetUser.userNo,
      status: 'PENDING',
    };
  }

  @OnEvent(SECONDARY_EVENT, { async: true })
  async handleApprovalDecided(event: ApprovalDecidedEvent) {
    if (event.decision === 'APPROVED') {
      return this.executeReactivation(event);
    }
  }

  private async executeReactivation(event: ApprovalDecidedEvent) {
    try {
      const result = await this.usersDomainService.reactivateUser(event.entityRef);

      await this.auditLogsService.recordSystem({
        action: AuditGovernanceActions.ADMIN_REACTIVATION.ACCOUNT_REACTIVATED,
        entityType: AuditEntityTypes.ADMIN_USER,
        entityId: event.entityRef,
        entityNo: result.userNo,
        workflowType: AuditBusinessWorkflowTypes.ADMIN_REACTIVATION,
        traceId: event.traceId,
        result: AuditResult.SUCCESS,
        metadata: {
          approvalId: event.approvalId,
          approvalNo: event.approvalNo,
          reactivatedByUserId: event.decisionByUserId,
          reactivatedByUserNo: event.decisionByUserNo,
        },
        requestId: `ADMIN_REACTIVATION_EXECUTED_${result.userNo}`,
        sourcePlatform: 'ADMIN_API',
      });

      await this.approvalsService.markExecutionResult(
        event.approvalId,
        true,
        {
          actorType: 'ADMIN',
          userId: event.decisionByUserId || 'SYSTEM',
          userNo: event.decisionByUserNo || undefined,
          role: event.decisionByRole || 'SYSTEM',
          roleCodes: event.decisionByRole ? [event.decisionByRole] : [],
        },
        'Account reactivated successfully',
      );
    } catch (error) {
      await this.auditLogsService.recordSystem({
        action: AuditGovernanceActions.ADMIN_REACTIVATION.ACCOUNT_REACTIVATED,
        entityType: AuditEntityTypes.ADMIN_USER,
        entityId: event.entityRef,
        workflowType: AuditBusinessWorkflowTypes.ADMIN_REACTIVATION,
        traceId: event.traceId,
        result: AuditResult.FAILED,
        reason: error instanceof Error ? error.message : 'Reactivation execution failed',
        metadata: { approvalId: event.approvalId },
        requestId: `ADMIN_REACTIVATION_EXEC_FAILED_${event.entityRef}`,
        sourcePlatform: 'ADMIN_API',
      });

      await this.approvalsService
        .markExecutionResult(
          event.approvalId,
          false,
          {
            actorType: 'ADMIN',
            userId: event.decisionByUserId || 'SYSTEM',
            userNo: event.decisionByUserNo || undefined,
            role: event.decisionByRole || 'SYSTEM',
            roleCodes: event.decisionByRole ? [event.decisionByRole] : [],
          },
          error instanceof Error ? error.message : 'Reactivation execution failed',
        )
        .catch(() => undefined);

      throw error;
    }
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd Exchange_js && npx tsc --noEmit -p tsconfig.build.json 2>&1 | head -20`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/modules/identity/users/admin-reactivation-workflow.service.ts
git commit -m "feat(identity): add Layer 3 reactivation workflow orchestrator"
```

---

### Task 6: Create DTO, add controller endpoint, register in module

**Files:**
- Create: `src/modules/identity/users/dto/reactivate-admin-user.dto.ts`
- Modify: `src/modules/identity/users/users.controller.ts` (add endpoint + import)
- Modify: `src/modules/identity/users/users.module.ts` (register services)

- [ ] **Step 1: Create the DTO**

Create `src/modules/identity/users/dto/reactivate-admin-user.dto.ts`:

```typescript
import { IsNotEmpty, IsString } from 'class-validator';
import { Transform } from 'class-transformer';

export class ReactivateAdminUserDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsNotEmpty()
  @IsString()
  reason!: string;
}
```

- [ ] **Step 2: Add the reactivate endpoint to users.controller.ts**

Add import at top of `users.controller.ts` — after the `AdminSuspensionWorkflowService` import (line 21):

```typescript
import { AdminReactivationWorkflowService } from './admin-reactivation-workflow.service';
```

After the `SuspendAdminUserDto` import (line 24):

```typescript
import { ReactivateAdminUserDto } from './dto/reactivate-admin-user.dto';
```

Add `AdminReactivationWorkflowService` to the constructor:

```typescript
  constructor(
    private readonly adminInviteWorkflow: AdminInviteWorkflowService,
    private readonly adminSuspensionWorkflow: AdminSuspensionWorkflowService,
    private readonly adminReactivationWorkflow: AdminReactivationWorkflowService,
    private readonly usersService: UsersService,
  ) {}
```

Add the endpoint after the `suspendUser` method (after line 135):

```typescript
  @Post(':id/reactivate')
  @RequirePermissions(buildPermissionCode('POST', '/users/:id/reactivate'))
  @ApiOperation({ summary: 'Initiate admin account reactivation approval (C4b)' })
  async reactivateUser(
    @Req() req: any,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ValidationPipe({ transform: true })) body: ReactivateAdminUserDto,
  ) {
    if (req.user?.type !== 'ADMIN') {
      throw new ForbiddenException('Admin token required');
    }

    return this.adminReactivationWorkflow.initiateReactivation(
      { targetUserId: id, reason: body.reason },
      this.buildAdminActor(req),
    );
  }
```

- [ ] **Step 3: Register services in users.module.ts**

Add imports at the top of `users.module.ts`:

```typescript
import { AdminReactivationApprovalService } from './admin-reactivation-approval.service';
import { AdminReactivationWorkflowService } from './admin-reactivation-workflow.service';
```

Add both to the `providers` array:

```typescript
    AdminReactivationApprovalService,
    AdminReactivationWorkflowService,
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `cd Exchange_js && npx tsc --noEmit -p tsconfig.build.json 2>&1 | head -20`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/modules/identity/users/dto/reactivate-admin-user.dto.ts \
       src/modules/identity/users/users.controller.ts \
       src/modules/identity/users/users.module.ts
git commit -m "feat(identity): add reactivate endpoint and register C4b services"
```

---

### Task 7: Add reactivate permission route to RBAC catalog

**Files:**
- Modify: `src/modules/identity/access-control/rbac.catalog.ts:198` (add route after suspend)

- [ ] **Step 1: Add the permission route**

In `src/modules/identity/access-control/rbac.catalog.ts`, after line 198 (`route('POST', '/users/:id/suspend', ...)`), add:

```typescript
  route('POST', '/users/:id/reactivate', 'Reactivate admin user (C4b)', ['IAM_ASSIGN']),
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd Exchange_js && npx tsc --noEmit -p tsconfig.build.json 2>&1 | head -20`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/modules/identity/access-control/rbac.catalog.ts
git commit -m "feat(rbac): add reactivate permission route for C4b"
```

---

### Task 8: Smoke test backend API

- [ ] **Step 1: Rebuild and start**

Run:
```bash
cd Exchange_js && npm run dev:stop && npm run dev:rebuild
```

Wait for backend to start, then:

```bash
npm run dev:start
```

- [ ] **Step 2: Login as SUPER_ADMIN and get token**

```bash
curl -s http://localhost:3000/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@fiatx.com","password":"admin123"}' | jq '.accessToken' -r
```

Save the token as `$TOKEN`.

- [ ] **Step 3: Find a SUSPENDED user**

```bash
curl -s http://localhost:3000/users -H "Authorization: Bearer $TOKEN" | jq '.[] | select(.status=="SUSPENDED") | {id, userNo, status}'
```

If no SUSPENDED user exists, first suspend one via `POST /users/:id/suspend`, then approve it.

- [ ] **Step 4: Test reactivation endpoint**

```bash
curl -s -X POST http://localhost:3000/users/$SUSPENDED_USER_ID/reactivate \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"reason":"Security incident resolved"}' | jq .
```

Expected: `{ "approvalNo": "APR...", "traceId": "...", "targetUserNo": "...", "status": "PENDING" }`

- [ ] **Step 5: Approve the reactivation**

```bash
curl -s http://localhost:3000/admin/control-gates/approvals?skip=0&take=1 \
  -H "Authorization: Bearer $TOKEN" | jq '.items[0] | {id, approvalNo, actionType, status}'
```

```bash
curl -s -X POST http://localhost:3000/admin/control-gates/approvals/$APPROVAL_ID/approve \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"reason":"Approved"}' | jq .
```

- [ ] **Step 6: Verify user is ACTIVE again**

```bash
curl -s http://localhost:3000/users/$SUSPENDED_USER_ID -H "Authorization: Bearer $TOKEN" | jq '{status, userNo}'
```

Expected: `{ "status": "ACTIVE", "userNo": "..." }`

- [ ] **Step 7: Commit (no code changes, just verify)**

No commit needed — this task is verification only.

---

### Task 9: Add frontend permission constant and reactivate UI

**Files:**
- Modify: `admin-web/src/rbac/permissions.ts` (add USERS_REACTIVATE)
- Modify: `admin-web/src/pages/PlatformMemberDetailPage.tsx` (add button + modal)

- [ ] **Step 1: Add USERS_REACTIVATE permission constant**

In `admin-web/src/rbac/permissions.ts`, after the `USERS_SUSPEND` line, add:

```typescript
  USERS_REACTIVATE: 'api.post.users_id_reactivate',
```

- [ ] **Step 2: Add UserCheck to lucide-react import**

In `PlatformMemberDetailPage.tsx`, change the import from:

```typescript
import { Mail, RefreshCw, Copy, Check, ShieldCheck, UserX, X } from 'lucide-react';
```

to:

```typescript
import { Mail, RefreshCw, Copy, Check, ShieldCheck, UserCheck, UserX, X } from 'lucide-react';
```

- [ ] **Step 3: Add reactivate state variables**

After the suspend state block (`const [submittingSuspend, setSubmittingSuspend] = useState(false);`), add:

```typescript
  const [showReactivateModal, setShowReactivateModal] = useState(false);
  const [reactivateReason, setReactivateReason] = useState('');
  const [submittingReactivate, setSubmittingReactivate] = useState(false);
```

- [ ] **Step 4: Add handleSubmitReactivate handler**

After the `handleSubmitSuspend` function, add:

```typescript
  /* ── Reactivate user ── */

  const handleSubmitReactivate = async () => {
    if (!member || !reactivateReason.trim()) return;
    setSubmittingReactivate(true);
    try {
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/users/${id}/reactivate`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: reactivateReason.trim() }),
        },
      );
      if (!res.ok) throw new Error(await getApiErrorMessage(res, 'Failed to submit reactivation request'));
      const data = await res.json();
      setShowReactivateModal(false);
      setReactivateReason('');
      setNotice(`Reactivation request submitted for approval (${data.approvalNo}).`);
      void fetchDetail();
    } catch (err: unknown) {
      if (err instanceof AdminSessionError) return;
      setError(err instanceof Error ? err.message : 'Failed to submit reactivation request.');
    } finally {
      setSubmittingReactivate(false);
    }
  };
```

- [ ] **Step 5: Add canReactivate derived variable and update showActions**

In the "Derived" section, after the `canSuspend` definition, add:

```typescript
  const canReactivate =
    member.status === 'SUSPENDED' &&
    hasAnyPermission([PERMISSIONS.USERS_REACTIVATE]);
```

Update `showActions` to include it:

```typescript
  const showActions = canResend || canChangeRoles || canSuspend || canReactivate;
```

- [ ] **Step 6: Add Reactivate button in sidebar Actions**

After the `{canSuspend && (...)}` button block in the sidebar, add:

```typescript
                {canReactivate && (
                  <button
                    onClick={() => { setReactivateReason(''); setShowReactivateModal(true); }}
                    className={adminButtonClass('workflowPrimary')}
                  >
                    <UserCheck size={13} />
                    Reactivate User
                  </button>
                )}
```

- [ ] **Step 7: Add Reactivate Confirmation Modal**

After the Suspend Modal's closing `)}`, add before the final `</div>`:

```typescript
      {/* ════ Reactivate Modal ════ */}
      {showReactivateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md overflow-hidden rounded-xl border border-adm-border bg-adm-panel shadow-xl">

            {/* Header */}
            <div className="flex items-center justify-between border-b border-adm-border bg-adm-card px-5 py-4">
              <div>
                <p className="font-mono text-[11px] font-semibold text-adm-t1">
                  Reactivate Admin Account
                </p>
                <p className="mt-1 font-mono text-[9px] text-adm-t3">
                  {member.userNo} · {member.email}
                </p>
              </div>
              <button
                onClick={() => setShowReactivateModal(false)}
                className="rounded p-1 text-adm-t3 hover:bg-adm-hover hover:text-adm-t1"
              >
                <X size={15} />
              </button>
            </div>

            {/* Body */}
            <div className="px-5 py-4 space-y-3">
              <div className="rounded border border-adm-amber/30 bg-adm-amber/10 px-3 py-2.5 font-mono text-[10px] text-adm-amber leading-relaxed">
                This will submit a reactivation request for approval. If approved, this user will
                regain access to the admin panel.
              </div>

              <div>
                <p className="mb-1.5 font-mono text-[8.5px] uppercase tracking-[0.14em] text-adm-t3">
                  Reason for Reactivation
                </p>
                <textarea
                  value={reactivateReason}
                  onChange={(e) => setReactivateReason(e.target.value)}
                  rows={4}
                  placeholder="Describe why this account should be reactivated…"
                  className="w-full rounded border border-adm-border bg-adm-bg px-3 py-2 font-mono text-[10px] text-adm-t2 placeholder:text-adm-t3 focus:border-adm-amber focus:outline-none resize-none transition-colors"
                  autoFocus
                />
              </div>
            </div>

            {/* Footer */}
            <div className="flex justify-end gap-2 border-t border-adm-border bg-adm-card px-5 py-4">
              <button onClick={() => setShowReactivateModal(false)} className={adminButtonClass('modalCancel')}>
                Cancel
              </button>
              <button
                onClick={() => void handleSubmitReactivate()}
                disabled={submittingReactivate || !reactivateReason.trim()}
                className={adminButtonClass('modalConfirm')}
              >
                {submittingReactivate ? 'Submitting…' : 'Submit for Approval'}
              </button>
            </div>

          </div>
        </div>
      )}
```

- [ ] **Step 8: Verify TypeScript compiles**

Run: `cd Exchange_js/admin-web && npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No errors

- [ ] **Step 9: Commit**

```bash
git add admin-web/src/rbac/permissions.ts admin-web/src/pages/PlatformMemberDetailPage.tsx
git commit -m "feat(admin): add reactivate user button and confirmation modal"
```

---

### Task 10: Browser verification

- [ ] **Step 1: Navigate to a SUSPENDED user's detail page**

Open `http://localhost:3501/dashboard/members`, find a SUSPENDED user, click to detail.

- [ ] **Step 2: Verify Reactivate button visible**

Confirm "Reactivate User" amber button appears in sidebar Actions. Confirm "Suspend User" is NOT visible (since status is SUSPENDED).

- [ ] **Step 3: Test modal interaction**

Click "Reactivate User" → modal opens → type reason → Submit → success notice with approval number.

- [ ] **Step 4: Verify end-to-end flow**

Navigate to Approvals, find the ADMIN_REACTIVATION_APPROVAL, approve it. Go back to user detail — status should now be ACTIVE, and "Suspend User" button should reappear.

---

### Task 11: Update roadmap

**Files:**
- Modify: `doc-final/reference/roadmap.md`

- [ ] **Step 1: Mark C4b complete**

Find the C4b entry in `doc-final/reference/roadmap.md` and mark it as complete with today's date.

- [ ] **Step 2: Commit**

```bash
git add doc-final/reference/roadmap.md
git commit -m "docs(roadmap): mark C4b Admin Account Reactivation complete"
```
