# Admin Account Suspension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the Admin Account Suspension workflow (C4) — CISO/TECH_OFFICER initiates, SMO approves, system suspends the target admin and invalidates their sessions.

**Architecture:** Three-layer pattern matching C1 (Admin Invite): Domain Service holds `suspendUser()`, Approval Sub-Workflow extends `ApprovalHandlerBase`, Workflow Service orchestrates initiation + execution. JWT Strategy adds a SUSPENDED check for lightweight session invalidation.

**Tech Stack:** NestJS, Prisma (SQLite), class-validator, @nestjs/event-emitter, @nestjs/passport

---

### Task 1: Prisma Schema — Add `suspendedAt` field to User model

**Files:**
- Modify: `prisma/schema.prisma:10-36` (User model)
- Create: `prisma/migrations/20260505100000_add_user_suspended_at/migration.sql`

- [ ] **Step 1: Add `suspendedAt` field to User model in schema.prisma**

In `prisma/schema.prisma`, inside the `model User` block (after line 23 `lockedUntil`), add:

```prisma
  suspendedAt         DateTime?
```

The full field list becomes:

```prisma
model User {
  id                  String                @id @default(uuid())
  userNo              String                @unique @default("TEMP")
  email               String
  password            String
  role                String
  status              String
  failedLoginAttempts Int                   @default(0)
  lockedUntil         DateTime?
  suspendedAt         DateTime?
  lastLoginAt         DateTime?
  deletedAt           DateTime?
  deletedBy           String?
  deleteRequestId     String?
  deleteReason        String?
  createdAt           DateTime              @default(now())
  updatedAt           DateTime              @updatedAt
  userRoles           UserRole[]
  adminInvitations    AdminUserInvitation[]

  @@index([deletedAt])
  @@map("users")
}
```

- [ ] **Step 2: Generate migration**

Run:
```bash
cd Exchange_js && npx prisma migrate dev --name add_user_suspended_at
```

Expected: Migration file created, Prisma client regenerated.

- [ ] **Step 3: Verify migration**

Run:
```bash
cd Exchange_js && npx prisma migrate status
```

Expected: All migrations applied, no drift.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(schema): add suspendedAt field to User model for C4 suspension"
```

---

### Task 2: Register `ADMIN_SUSPENSION_APPROVAL` in approval constants

**Files:**
- Modify: `src/modules/governance/approvals/constants/approval.constants.ts`

- [ ] **Step 1: Add `ADMIN_SUSPENSION_APPROVAL` to `ApprovalActionTypes`**

In `approval.constants.ts`, in the `ApprovalActionTypes` object, after the `ADMIN_INVITE_APPROVAL` entry, add:

```typescript
  ADMIN_SUSPENSION_APPROVAL: 'ADMIN_SUSPENSION_APPROVAL',
```

- [ ] **Step 2: Add default policy for `ADMIN_SUSPENSION_APPROVAL`**

In `DEFAULT_APPROVAL_POLICIES`, after the `ADMIN_INVITE_APPROVAL` policy entry, add:

```typescript
  [ApprovalActionTypes.ADMIN_SUSPENSION_APPROVAL]: {
    riskLevel: ApprovalRiskLevels.HIGH,
    checkerRoles: ['SENIOR_MANAGEMENT_OFFICER'],
    timeoutHours: 48,
    allowCancel: true,
    allowRetry: false,
  },
```

- [ ] **Step 3: Verify TypeScript compiles**

Run:
```bash
cd Exchange_js && npx tsc --noEmit 2>&1 | head -20
```

Expected: No new errors.

- [ ] **Step 4: Commit**

```bash
git add src/modules/governance/approvals/constants/approval.constants.ts
git commit -m "feat(approvals): register ADMIN_SUSPENSION_APPROVAL action type and policy"
```

---

### Task 3: Register `ADMIN_SUSPENSION` in `hasDedicatedAuditService`

**Files:**
- Modify: `src/modules/governance/approvals/approvals.service.ts:371-378`

- [ ] **Step 1: Add `ADMIN_SUSPENSION` to the DEDICATED array**

In `approvals.service.ts`, find the `hasDedicatedAuditService` method (~line 371). Add `AuditBusinessWorkflowTypes.ADMIN_SUSPENSION` to the `DEDICATED` array:

```typescript
  private hasDedicatedAuditService(workflowType: string | null | undefined): boolean {
    if (!workflowType) return false;
    const DEDICATED: string[] = [
      AuditBusinessWorkflowTypes.AUDIT_EVIDENCE_EXPORT,
      AuditBusinessWorkflowTypes.ADMIN_INVITE,
      AuditBusinessWorkflowTypes.ADMIN_SUSPENSION,
    ];
    return DEDICATED.includes(workflowType);
  }
```

- [ ] **Step 2: Verify TypeScript compiles**

Run:
```bash
cd Exchange_js && npx tsc --noEmit 2>&1 | head -20
```

Expected: No new errors.

- [ ] **Step 3: Commit**

```bash
git add src/modules/governance/approvals/approvals.service.ts
git commit -m "feat(approvals): register ADMIN_SUSPENSION in dedicated audit service list"
```

---

### Task 4: Domain Service — Add `suspendUser()` to `UsersDomainService`

**Files:**
- Modify: `src/modules/identity/users/users.domain.service.ts`

- [ ] **Step 1: Add `suspendUser` method**

At the end of `UsersDomainService` class (before the closing `}`), add:

```typescript
  async suspendUser(
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
      throw new ConflictException('SUPER_ADMIN account cannot be suspended');
    }

    if (user.status === 'SUSPENDED') {
      return { id: user.id, userNo: user.userNo, status: user.status };
    }

    if (user.status !== 'ACTIVE' && user.status !== 'INACTIVE' && user.status !== 'INVITE_SENT' && user.status !== 'PENDING_INVITE_APPROVAL') {
      throw new ConflictException(`Cannot suspend user in status: ${user.status}`);
    }

    const updated = await client.user.update({
      where: { id: userId },
      data: { status: 'SUSPENDED', suspendedAt: new Date() },
      select: { id: true, userNo: true, status: true },
    });

    return updated;
  }
```

- [ ] **Step 2: Verify TypeScript compiles**

Run:
```bash
cd Exchange_js && npx tsc --noEmit 2>&1 | head -20
```

Expected: No new errors.

- [ ] **Step 3: Commit**

```bash
git add src/modules/identity/users/users.domain.service.ts
git commit -m "feat(users): add suspendUser domain method with SUPER_ADMIN guard"
```

---

### Task 5: Layer 2 — Create `AdminSuspensionApprovalService`

**Files:**
- Create: `src/modules/identity/users/admin-suspension-approval.service.ts`

- [ ] **Step 1: Create the approval sub-workflow file**

Create `src/modules/identity/users/admin-suspension-approval.service.ts`:

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
export class AdminSuspensionApprovalService extends ApprovalHandlerBase {
  readonly actionType = ApprovalActionTypes.ADMIN_SUSPENSION_APPROVAL;
  readonly workflowType = AuditBusinessWorkflowTypes.ADMIN_SUSPENSION;
  readonly auditActions = {
    granted: AuditGovernanceActions.ADMIN_SUSPENSION.APPROVAL_GRANTED,
    declined: AuditGovernanceActions.ADMIN_SUSPENSION.APPROVAL_DECLINED,
    cancelled: AuditGovernanceActions.ADMIN_SUSPENSION.APPROVAL_CANCELLED,
  };
  readonly entityType = AuditEntityTypes.ADMIN_USER;

  constructor(auditLogsService: AuditLogsService, eventEmitter: EventEmitter2) {
    super(auditLogsService, eventEmitter);
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run:
```bash
cd Exchange_js && npx tsc --noEmit 2>&1 | head -20
```

Expected: No new errors.

- [ ] **Step 3: Commit**

```bash
git add src/modules/identity/users/admin-suspension-approval.service.ts
git commit -m "feat(users): add AdminSuspensionApprovalService (Layer 2)"
```

---

### Task 6: Layer 3 — Create `AdminSuspensionWorkflowService`

**Files:**
- Create: `src/modules/identity/users/admin-suspension-workflow.service.ts`

- [ ] **Step 1: Create the workflow service file**

Create `src/modules/identity/users/admin-suspension-workflow.service.ts`:

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

const SECONDARY_EVENT = 'workflow.admin-suspension.decided';

export interface InitiateSuspensionDto {
  targetUserId: string;
  reason: string;
}

@Injectable()
export class AdminSuspensionWorkflowService {
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

  async initiateSuspension(dto: InitiateSuspensionDto, actor: ApprovalActorContext) {
    const traceId = randomUUID();

    if (actor.userId === dto.targetUserId) {
      throw new ForbiddenException('Cannot suspend your own account');
    }

    const targetUser = await this.usersDomainService.findById(dto.targetUserId);
    if (!targetUser) {
      throw new NotFoundException('Target user not found');
    }

    const targetRoles = await this.prisma.userRole.findMany({
      where: { userId: dto.targetUserId },
      select: { role: { select: { code: true } } },
    });
    if (targetRoles.some((ur: any) => ur.role.code === 'SUPER_ADMIN')) {
      throw new ForbiddenException('SUPER_ADMIN account cannot be suspended');
    }

    if (targetUser.status === 'SUSPENDED') {
      throw new ConflictException('User is already suspended');
    }

    const existingPending = await this.prisma.approvalCase.findFirst({
      where: {
        actionType: ApprovalActionTypes.ADMIN_SUSPENSION_APPROVAL,
        entityRef: dto.targetUserId,
        status: 'PENDING',
        deletedAt: null,
      },
    });
    if (existingPending) {
      throw new ConflictException(
        `A pending suspension approval already exists: ${existingPending.approvalNo}`,
      );
    }

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
      },
      {
        reason: dto.reason,
        traceId,
      },
      actor,
    );

    await this.auditLogsService.recordByActor(
      {
        action: AuditGovernanceActions.ADMIN_SUSPENSION.SUSPENSION_REQUESTED,
        entityType: AuditEntityTypes.ADMIN_USER,
        entityId: dto.targetUserId,
        entityNo: targetUser.userNo,
        workflowType: AuditBusinessWorkflowTypes.ADMIN_SUSPENSION,
        traceId,
        result: AuditResult.SUCCESS,
        metadata: {
          targetEmail: targetUser.email,
          reason: dto.reason,
          approvalNo: approvalCase.approvalNo,
        },
        requestId: `ADMIN_SUSPENSION_REQUESTED_${targetUser.userNo}`,
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
      return this.executeSuspension(event);
    }
  }

  private async executeSuspension(event: ApprovalDecidedEvent) {
    try {
      const result = await this.usersDomainService.suspendUser(event.entityRef);

      await this.auditLogsService.recordSystem({
        action: AuditGovernanceActions.ADMIN_SUSPENSION.ACCOUNT_SUSPENDED,
        entityType: AuditEntityTypes.ADMIN_USER,
        entityId: event.entityRef,
        entityNo: result.userNo,
        workflowType: AuditBusinessWorkflowTypes.ADMIN_SUSPENSION,
        traceId: event.traceId,
        result: AuditResult.SUCCESS,
        metadata: {
          approvalId: event.approvalId,
          approvalNo: event.approvalNo,
          suspendedByUserId: event.decisionByUserId,
          suspendedByUserNo: event.decisionByUserNo,
        },
        requestId: `ADMIN_SUSPENSION_EXECUTED_${result.userNo}`,
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
        'Account suspended successfully',
      );
    } catch (error) {
      await this.auditLogsService.recordSystem({
        action: AuditGovernanceActions.ADMIN_SUSPENSION.ACCOUNT_SUSPENDED,
        entityType: AuditEntityTypes.ADMIN_USER,
        entityId: event.entityRef,
        workflowType: AuditBusinessWorkflowTypes.ADMIN_SUSPENSION,
        traceId: event.traceId,
        result: AuditResult.FAILED,
        reason: error instanceof Error ? error.message : 'Suspension execution failed',
        metadata: { approvalId: event.approvalId },
        requestId: `ADMIN_SUSPENSION_EXEC_FAILED_${event.entityRef}`,
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
          error instanceof Error ? error.message : 'Suspension execution failed',
        )
        .catch(() => undefined);

      throw error;
    }
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run:
```bash
cd Exchange_js && npx tsc --noEmit 2>&1 | head -20
```

Expected: No new errors.

- [ ] **Step 3: Commit**

```bash
git add src/modules/identity/users/admin-suspension-workflow.service.ts
git commit -m "feat(users): add AdminSuspensionWorkflowService (Layer 3)"
```

---

### Task 7: Controller — Add suspend endpoint

**Files:**
- Modify: `src/modules/identity/users/users.controller.ts`
- Create: `src/modules/identity/users/dto/suspend-admin-user.dto.ts`

- [ ] **Step 1: Create the DTO**

Create `src/modules/identity/users/dto/suspend-admin-user.dto.ts`:

```typescript
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString } from 'class-validator';

export class SuspendAdminUserDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsNotEmpty()
  @IsString()
  reason!: string;
}
```

- [ ] **Step 2: Add suspend endpoint to UsersController**

In `users.controller.ts`, add the import for the new DTO and workflow service at the top:

```typescript
import { AdminSuspensionWorkflowService } from './admin-suspension-workflow.service';
import { SuspendAdminUserDto } from './dto/suspend-admin-user.dto';
```

Add `AdminSuspensionWorkflowService` to the constructor:

```typescript
  constructor(
    private readonly adminInviteWorkflow: AdminInviteWorkflowService,
    private readonly adminSuspensionWorkflow: AdminSuspensionWorkflowService,
    private readonly usersService: UsersService,
  ) {}
```

Add the endpoint method after `resendInvitation`:

```typescript
  @Post(':id/suspend')
  @RequirePermissions(buildPermissionCode('POST', '/users/:id/suspend'))
  @ApiOperation({ summary: 'Initiate admin account suspension approval (C4)' })
  async suspendUser(
    @Req() req: any,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ValidationPipe({ transform: true })) body: SuspendAdminUserDto,
  ) {
    if (req.user?.type !== 'ADMIN') {
      throw new ForbiddenException('Admin token required');
    }

    return this.adminSuspensionWorkflow.initiateSuspension(
      { targetUserId: id, reason: body.reason },
      this.buildAdminActor(req),
    );
  }
```

- [ ] **Step 3: Verify TypeScript compiles**

Run:
```bash
cd Exchange_js && npx tsc --noEmit 2>&1 | head -20
```

Expected: No new errors.

- [ ] **Step 4: Commit**

```bash
git add src/modules/identity/users/users.controller.ts src/modules/identity/users/dto/suspend-admin-user.dto.ts
git commit -m "feat(users): add POST /users/:id/suspend endpoint"
```

---

### Task 8: Module registration

**Files:**
- Modify: `src/modules/identity/users/users.module.ts`

- [ ] **Step 1: Register new services in UsersModule**

In `users.module.ts`, add imports:

```typescript
import { AdminSuspensionApprovalService } from './admin-suspension-approval.service';
import { AdminSuspensionWorkflowService } from './admin-suspension-workflow.service';
```

Add both to the `providers` array:

```typescript
  providers: [
    UsersService,
    UsersDomainService,
    AdminInvitationsService,
    AdminInviteApprovalService,
    AdminInviteWorkflowService,
    AdminSuspensionApprovalService,
    AdminSuspensionWorkflowService,
  ],
```

- [ ] **Step 2: Verify TypeScript compiles**

Run:
```bash
cd Exchange_js && npx tsc --noEmit 2>&1 | head -20
```

Expected: No new errors.

- [ ] **Step 3: Commit**

```bash
git add src/modules/identity/users/users.module.ts
git commit -m "feat(users): register suspension services in UsersModule"
```

---

### Task 9: JWT Strategy — Add SUSPENDED check

**Files:**
- Modify: `src/modules/identity/auth/jwt.strategy.ts`

- [ ] **Step 1: Add SUSPENDED user check in `validate()`**

In `jwt.strategy.ts`, add a check for ADMIN tokens after the CUSTOMER block (after line 43). Insert before line 46 (the `const roleCodes` line):

```typescript
    if (payload?.type === 'ADMIN') {
      const adminUser = await this.prisma.user.findFirst({
        where: { id: payload.sub, deletedAt: null },
        select: { id: true, status: true },
      });

      if (!adminUser) {
        throw new UnauthorizedException('Admin user not found');
      }

      if (adminUser.status === 'SUSPENDED') {
        throw new ForbiddenException({
          code: 'ADMIN_ACCOUNT_SUSPENDED',
          message: 'Account has been suspended. Contact your administrator.',
        });
      }
    }
```

- [ ] **Step 2: Verify TypeScript compiles**

Run:
```bash
cd Exchange_js && npx tsc --noEmit 2>&1 | head -20
```

Expected: No new errors.

- [ ] **Step 3: Commit**

```bash
git add src/modules/identity/auth/jwt.strategy.ts
git commit -m "feat(auth): reject SUSPENDED admin users in JWT strategy"
```

---

### Task 10: Update roadmap

**Files:**
- Modify: `doc-final/reference/roadmap.md`

- [ ] **Step 1: Mark C4 as done and add production note**

In `doc-final/reference/roadmap.md`, update the Admin Account Suspension line in V1 MVP from:

```markdown
- [ ] Admin Account Suspension（账号停用审批；执行时自动 revoke 所有活跃 session）
```

to:

```markdown
- [x] Admin Account Suspension（账号停用审批；执行时 JWT Strategy 校验拦截 SUSPENDED 用户。**生产环境需改造为 token blacklist 方案实现即时 session 撤销**） ✅ 2026-05-05
```

- [ ] **Step 2: Commit**

```bash
git add doc-final/reference/roadmap.md
git commit -m "docs(roadmap): mark C4 Admin Account Suspension complete"
```

---

### Task 11: Seed — Rebuild DB to pick up new policy

**Files:** (no code changes — seed already iterates `DEFAULT_APPROVAL_POLICIES`)

- [ ] **Step 1: Rebuild database**

Run:
```bash
cd Exchange_js && npm run dev:rebuild
```

Expected: Database rebuilt, new `ADMIN_SUSPENSION_APPROVAL` policy seeded from `DEFAULT_APPROVAL_POLICIES`.

- [ ] **Step 2: Verify the policy exists**

Run:
```bash
cd Exchange_js && npx prisma studio
```

Check `approval_action_policies` table for `ADMIN_SUSPENSION_APPROVAL` row with `checkerRoles = SENIOR_MANAGEMENT_OFFICER`.

- [ ] **Step 3: Start the stack and smoke test**

Run:
```bash
cd Exchange_js && npm run dev:start
```

Smoke test via curl:

```bash
# Login as CISO
TOKEN=$(curl -s -X POST http://localhost:3500/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"ciso@fiatx.com","password":"123456"}' | jq -r '.access_token')

# Get a target user ID (e.g. OPS_OFFICER)
TARGET_ID=$(curl -s http://localhost:3500/users \
  -H "Authorization: Bearer $TOKEN" | jq -r '.[] | select(.email=="ops_officer@fiatx.com") | .id')

# Initiate suspension
curl -s -X POST "http://localhost:3500/users/$TARGET_ID/suspend" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"reason":"Security incident test"}' | jq .
```

Expected: Returns `{ approvalNo, traceId, targetUserNo, status: "PENDING" }`.

```bash
# Login as SMO and approve
SMO_TOKEN=$(curl -s -X POST http://localhost:3500/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"sm@fiatx.com","password":"123456"}' | jq -r '.access_token')

# Find the approval (use approvalNo from previous response)
APPROVAL_ID=$(curl -s "http://localhost:3500/admin/control-gates/approvals?actionType=ADMIN_SUSPENSION_APPROVAL&status=PENDING" \
  -H "Authorization: Bearer $SMO_TOKEN" | jq -r '.items[0].id // .data[0].id // .[0].id')

# Approve
curl -s -X POST "http://localhost:3500/admin/control-gates/approvals/$APPROVAL_ID/approve" \
  -H "Authorization: Bearer $SMO_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"reason":"Approved suspension"}' | jq .
```

Expected: Approval APPROVED, user status becomes SUSPENDED.

```bash
# Verify: OPS_OFFICER can no longer make API calls
OPS_TOKEN=$(curl -s -X POST http://localhost:3500/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"ops_officer@fiatx.com","password":"123456"}' | jq -r '.access_token')

curl -s http://localhost:3500/users \
  -H "Authorization: Bearer $OPS_TOKEN" | jq .
```

Expected: Login may succeed (JWT issued) but subsequent API call returns 403 with `ADMIN_ACCOUNT_SUSPENDED`.
