# Credential Reset Workflow Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify admin-initiated password reset and MFA reset into standard three-layer architecture with approval flows; keep self-service password reset unchanged.

**Architecture:** Add 2 new ApprovalActionTypes and ApprovalHandlerBase subclasses. Create new MFA reset workflow. Refactor existing password reset workflow's CISO path to go through approval. Both follow the same pattern as admin-suspension-workflow.

**Tech Stack:** NestJS, Prisma, TypeScript, EventEmitter2

---

### Task 1: Add Constants — ApprovalActionTypes, WorkflowTypes, Audit Actions

**Files:**
- Modify: `src/modules/governance/approvals/constants/approval.constants.ts`
- Modify: `src/modules/audit-logging/constants/audit-actions.constant.ts`

- [ ] **Step 1: Add ApprovalActionTypes**

In `src/modules/governance/approvals/constants/approval.constants.ts`, find the end of the `ApprovalActionTypes` object (after `ROLE_DEFINITION_MODIFY` at line 53). Add before the closing `} as const;`:

```typescript
  // ─── Credential Reset Governance (2026-05-10) ────
  ADMIN_PASSWORD_RESET: 'ADMIN_PASSWORD_RESET',
  ADMIN_MFA_RESET: 'ADMIN_MFA_RESET',
```

- [ ] **Step 2: Add default approval policies**

In the same file, find `FALLBACK_APPROVAL_POLICIES` object (ends around line 332). Add before the closing `};`:

```typescript
  // ─── Credential Reset Governance (2026-05-10) ────
  [ApprovalActionTypes.ADMIN_PASSWORD_RESET]: {
    riskLevel: ApprovalRiskLevels.HIGH,
    steps: [{ stepNo: 1, roles: ['SENIOR_MANAGEMENT_OFFICER'] }],
    timeoutHours: 48,
    allowCancel: true,
    allowRetry: false,
  },
  [ApprovalActionTypes.ADMIN_MFA_RESET]: {
    riskLevel: ApprovalRiskLevels.HIGH,
    steps: [{ stepNo: 1, roles: ['SENIOR_MANAGEMENT_OFFICER'] }],
    timeoutHours: 48,
    allowCancel: true,
    allowRetry: false,
  },
```

- [ ] **Step 3: Add to V1_APPROVAL_ACTION_TYPES**

In the same file, find `V1_APPROVAL_ACTION_TYPES` array (line ~339). Add before the closing `] as const;`:

```typescript
  ApprovalActionTypes.ADMIN_PASSWORD_RESET,
  ApprovalActionTypes.ADMIN_MFA_RESET,
```

- [ ] **Step 4: Add AuditWorkflowTypes entries**

In `src/modules/audit-logging/constants/audit-actions.constant.ts`, find `AuditWorkflowTypes` (around line 110). Add before the closing `} as const;`:

```typescript
  // Credential Reset Governance (2026-05-10)
  ADMIN_PASSWORD_RESET: 'ADMIN_PASSWORD_RESET',
  ADMIN_MFA_RESET: 'ADMIN_MFA_RESET',
```

- [ ] **Step 5: Add AuditBusinessWorkflowTypes entries**

In the same file, find `AuditBusinessWorkflowTypes` (around line 130). Add before the closing `} as const;`:

```typescript
  // Credential Reset Governance (2026-05-10)
  ADMIN_PASSWORD_RESET: 'ADMIN_PASSWORD_RESET',
  ADMIN_MFA_RESET: 'ADMIN_MFA_RESET',
```

- [ ] **Step 6: Add AuditGovernanceActions namespaces**

In the same file, find `AuditGovernanceActions` object. Add after the `ADMIN_CREDENTIAL_MGMT` namespace (around line 499), before the closing of the parent object:

```typescript
  // Credential Reset Governance (2026-05-10)
  ADMIN_PASSWORD_RESET: {
    RESET_REQUESTED:      'ADMIN_PASSWORD_RESET_REQUESTED',
    APPROVAL_GRANTED:     'ADMIN_PASSWORD_RESET_APPROVAL_GRANTED',
    APPROVAL_DECLINED:    'ADMIN_PASSWORD_RESET_APPROVAL_DECLINED',
    APPROVAL_CANCELLED:   'ADMIN_PASSWORD_RESET_APPROVAL_CANCELLED',
    APPROVAL_EXPIRED:     'ADMIN_PASSWORD_RESET_APPROVAL_EXPIRED',
    RESET_EXECUTED:       'ADMIN_PASSWORD_RESET_EXECUTED',
    RESET_FAILED:         'ADMIN_PASSWORD_RESET_FAILED',
    RESET_CANCELLED:      'ADMIN_PASSWORD_RESET_CANCELLED',
  },

  ADMIN_MFA_RESET: {
    RESET_REQUESTED:      'ADMIN_MFA_RESET_REQUESTED',
    APPROVAL_GRANTED:     'ADMIN_MFA_RESET_APPROVAL_GRANTED',
    APPROVAL_DECLINED:    'ADMIN_MFA_RESET_APPROVAL_DECLINED',
    APPROVAL_CANCELLED:   'ADMIN_MFA_RESET_APPROVAL_CANCELLED',
    APPROVAL_EXPIRED:     'ADMIN_MFA_RESET_APPROVAL_EXPIRED',
    RESET_EXECUTED:       'ADMIN_MFA_RESET_EXECUTED',
    RESET_FAILED:         'ADMIN_MFA_RESET_FAILED',
    RESET_CANCELLED:      'ADMIN_MFA_RESET_CANCELLED',
  },
```

- [ ] **Step 7: Compile check**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js && npx tsc --noEmit --pretty 2>&1 | head -20
```

Expected: No errors.

- [ ] **Step 8: Commit**

```bash
git add src/modules/governance/approvals/constants/approval.constants.ts src/modules/audit-logging/constants/audit-actions.constant.ts
git commit -m "feat(constants): add ADMIN_PASSWORD_RESET and ADMIN_MFA_RESET approval types and audit actions"
```

---

### Task 2: Add hasDedicatedAuditService Entries

**Files:**
- Modify: `src/modules/governance/approvals/approvals.service.ts`

- [ ] **Step 1: Add both workflow types to DEDICATED list**

In `src/modules/governance/approvals/approvals.service.ts`, find the `hasDedicatedAuditService` method (line ~351). In the `DEDICATED` array, add after `AuditBusinessWorkflowTypes.ROLE_DEFINITION_MODIFY`:

```typescript
      AuditBusinessWorkflowTypes.ADMIN_PASSWORD_RESET,
      AuditBusinessWorkflowTypes.ADMIN_MFA_RESET,
```

- [ ] **Step 2: Compile check**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js && npx tsc --noEmit --pretty 2>&1 | head -20
```

- [ ] **Step 3: Commit**

```bash
git add src/modules/governance/approvals/approvals.service.ts
git commit -m "fix(approvals): add credential reset types to hasDedicatedAuditService"
```

---

### Task 3: Create ApprovalHandler Subclasses

**Files:**
- Create: `src/modules/identity/users/admin-password-reset-approval.service.ts`
- Create: `src/modules/identity/users/admin-mfa-reset-approval.service.ts`

- [ ] **Step 1: Create password reset approval handler**

Create `src/modules/identity/users/admin-password-reset-approval.service.ts`:

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
export class AdminPasswordResetApprovalService extends ApprovalHandlerBase {
  readonly actionType = ApprovalActionTypes.ADMIN_PASSWORD_RESET;
  readonly workflowType = AuditBusinessWorkflowTypes.ADMIN_PASSWORD_RESET;
  readonly auditActions = {
    granted: AuditGovernanceActions.ADMIN_PASSWORD_RESET.APPROVAL_GRANTED,
    declined: AuditGovernanceActions.ADMIN_PASSWORD_RESET.APPROVAL_DECLINED,
    cancelled: AuditGovernanceActions.ADMIN_PASSWORD_RESET.APPROVAL_CANCELLED,
    expired: AuditGovernanceActions.ADMIN_PASSWORD_RESET.APPROVAL_EXPIRED,
  };
  readonly entityType = AuditEntityTypes.ADMIN_USER;

  constructor(auditLogsService: AuditLogsService, eventEmitter: EventEmitter2) {
    super(auditLogsService, eventEmitter);
  }
}
```

- [ ] **Step 2: Create MFA reset approval handler**

Create `src/modules/identity/users/admin-mfa-reset-approval.service.ts`:

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
export class AdminMfaResetApprovalService extends ApprovalHandlerBase {
  readonly actionType = ApprovalActionTypes.ADMIN_MFA_RESET;
  readonly workflowType = AuditBusinessWorkflowTypes.ADMIN_MFA_RESET;
  readonly auditActions = {
    granted: AuditGovernanceActions.ADMIN_MFA_RESET.APPROVAL_GRANTED,
    declined: AuditGovernanceActions.ADMIN_MFA_RESET.APPROVAL_DECLINED,
    cancelled: AuditGovernanceActions.ADMIN_MFA_RESET.APPROVAL_CANCELLED,
    expired: AuditGovernanceActions.ADMIN_MFA_RESET.APPROVAL_EXPIRED,
  };
  readonly entityType = AuditEntityTypes.ADMIN_USER;

  constructor(auditLogsService: AuditLogsService, eventEmitter: EventEmitter2) {
    super(auditLogsService, eventEmitter);
  }
}
```

- [ ] **Step 3: Compile check**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js && npx tsc --noEmit --pretty 2>&1 | head -20
```

- [ ] **Step 4: Commit**

```bash
git add src/modules/identity/users/admin-password-reset-approval.service.ts src/modules/identity/users/admin-mfa-reset-approval.service.ts
git commit -m "feat(approvals): add ApprovalHandlerBase subclasses for password and MFA reset"
```

---

### Task 4: Create AdminMfaResetWorkflowService

**Files:**
- Create: `src/modules/identity/users/admin-mfa-reset-workflow.service.ts`

- [ ] **Step 1: Create the workflow service**

Create `src/modules/identity/users/admin-mfa-reset-workflow.service.ts`:

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

const SECONDARY_EVENT = 'workflow.admin-mfa-reset.decided';

@Injectable()
export class AdminMfaResetWorkflowService {
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

  async initiateAdminMfaReset(targetUserId: string, actor: ApprovalActorContext) {
    const traceId = randomUUID();

    if (actor.userId === targetUserId) {
      throw new ForbiddenException('Cannot reset your own MFA via admin path');
    }

    const targetUser = await this.usersDomainService.findById(targetUserId);
    if (!targetUser) {
      throw new NotFoundException('Target user not found');
    }

    if (targetUser.status !== 'ACTIVE') {
      throw new ConflictException(`Cannot reset MFA for user in status: ${targetUser.status}`);
    }

    const targetRoles = await this.prisma.userRole.findMany({
      where: { userId: targetUserId },
      select: { role: { select: { code: true } } },
    });
    if (targetRoles.some((ur: any) => ur.role.code === 'SUPER_ADMIN')) {
      throw new ForbiddenException('Cannot reset SUPER_ADMIN MFA via admin path');
    }

    const user = await this.prisma.user.findFirst({
      where: { id: targetUserId, deletedAt: null },
      select: { mfaEnabledAt: true },
    });
    if (!user?.mfaEnabledAt) {
      throw new ConflictException('Target user has no MFA binding to reset');
    }

    const existingPending = await this.prisma.approvalCase.findFirst({
      where: {
        actionType: ApprovalActionTypes.ADMIN_MFA_RESET,
        entityRef: targetUserId,
        status: 'PENDING',
        deletedAt: null,
      },
    });
    if (existingPending) {
      throw new ConflictException(
        `A pending MFA reset approval already exists: ${existingPending.approvalNo}`,
      );
    }

    const approvalCase = await this.approvalsService.createAndSubmit(
      {
        actionType: ApprovalActionTypes.ADMIN_MFA_RESET,
        entityRef: targetUserId,
        workflowType: AuditBusinessWorkflowTypes.ADMIN_MFA_RESET,
        workflowId: targetUserId,
        workflowNo: targetUser.userNo,
        traceId,
        objectSnapshot: {
          targetUserId,
          targetUserNo: targetUser.userNo,
          targetEmail: targetUser.email,
          targetStatus: targetUser.status,
        },
      },
      {
        reason: `Admin MFA reset request for ${targetUser.email}`,
        traceId,
      },
      actor,
    );

    await this.auditLogsService.recordByActor(
      {
        action: AuditGovernanceActions.ADMIN_MFA_RESET.RESET_REQUESTED,
        entityType: AuditEntityTypes.ADMIN_USER,
        entityId: targetUserId,
        entityNo: targetUser.userNo,
        workflowType: AuditBusinessWorkflowTypes.ADMIN_MFA_RESET,
        traceId,
        result: AuditResult.SUCCESS,
        metadata: {
          targetEmail: targetUser.email,
          approvalNo: approvalCase.approvalNo,
        },
        requestId: `ADMIN_MFA_RESET_REQUESTED_${targetUser.userNo}`,
        sourcePlatform: 'ADMIN_API',
      },
      this.toAuditActor(actor),
    );

    return {
      approvalNo: approvalCase.approvalNo,
      traceId,
      targetUserNo: targetUser.userNo,
      status: 'PENDING_APPROVAL',
    };
  }

  @OnEvent(SECONDARY_EVENT, { async: true })
  async handleApprovalDecided(event: ApprovalDecidedEvent) {
    switch (event.decision) {
      case 'APPROVED':
        return this.executeReset(event);
      case 'DECLINED':
      case 'CANCELLED':
      case 'EXPIRED':
        return this.recordCancellation(event);
    }
  }

  private async executeReset(event: ApprovalDecidedEvent) {
    try {
      const result = await this.usersDomainService.resetMfa(event.entityRef);

      await this.auditLogsService.recordSystem({
        action: AuditGovernanceActions.ADMIN_MFA_RESET.RESET_EXECUTED,
        entityType: AuditEntityTypes.ADMIN_USER,
        entityId: event.entityRef,
        entityNo: result.userNo,
        workflowType: AuditBusinessWorkflowTypes.ADMIN_MFA_RESET,
        traceId: event.traceId,
        result: AuditResult.SUCCESS,
        metadata: {
          approvalId: event.approvalId,
          approvalNo: event.approvalNo,
          resetByUserId: event.decisionByUserId,
          resetByUserNo: event.decisionByUserNo,
        },
        requestId: `ADMIN_MFA_RESET_EXECUTED_${result.userNo}`,
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
        'MFA reset executed successfully',
      );
    } catch (error) {
      await this.auditLogsService.recordSystem({
        action: AuditGovernanceActions.ADMIN_MFA_RESET.RESET_FAILED,
        entityType: AuditEntityTypes.ADMIN_USER,
        entityId: event.entityRef,
        workflowType: AuditBusinessWorkflowTypes.ADMIN_MFA_RESET,
        traceId: event.traceId,
        result: AuditResult.FAILED,
        reason: error instanceof Error ? error.message : 'MFA reset execution failed',
        metadata: { approvalId: event.approvalId },
        requestId: `ADMIN_MFA_RESET_FAILED_${event.entityRef}`,
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
          error instanceof Error ? error.message : 'MFA reset execution failed',
        )
        .catch(() => undefined);

      throw error;
    }
  }

  private async recordCancellation(event: ApprovalDecidedEvent) {
    await this.auditLogsService.recordSystem({
      action: AuditGovernanceActions.ADMIN_MFA_RESET.RESET_CANCELLED,
      entityType: AuditEntityTypes.ADMIN_USER,
      entityId: event.entityRef,
      workflowType: AuditBusinessWorkflowTypes.ADMIN_MFA_RESET,
      traceId: event.traceId,
      result: AuditResult.SUCCESS,
      metadata: {
        approvalId: event.approvalId,
        approvalNo: event.approvalNo,
        decision: event.decision,
      },
      requestId: `ADMIN_MFA_RESET_CANCELLED_${event.entityRef}`,
      sourcePlatform: 'ADMIN_API',
    });
  }
}
```

- [ ] **Step 2: Compile check**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js && npx tsc --noEmit --pretty 2>&1 | head -20
```

Expected: May fail because module registration hasn't happened yet. That's fine — will be resolved in Task 6.

- [ ] **Step 3: Commit**

```bash
git add src/modules/identity/users/admin-mfa-reset-workflow.service.ts
git commit -m "feat(identity): add AdminMfaResetWorkflowService with approval flow"
```

---

### Task 5: Refactor AdminPasswordResetWorkflowService — Add Approval to CISO Path

**Files:**
- Modify: `src/modules/identity/users/admin-password-reset-workflow.service.ts`

- [ ] **Step 1: Add new imports**

In `src/modules/identity/users/admin-password-reset-workflow.service.ts`, add these imports after the existing imports (before line 32):

```typescript
import { OnEvent } from '@nestjs/event-emitter';
import { ApprovalsService } from '../../governance/approvals/approvals.service';
import { ApprovalDecidedEvent } from '../../governance/approvals/approval-handler.base';
import {
  ApprovalActionTypes,
  ApprovalActorContext,
} from '../../governance/approvals/constants/approval.constants';
```

- [ ] **Step 2: Add SECONDARY_EVENT constant**

Add after the existing `MAX_TOKEN_RETRIES` constant (line 35):

```typescript
const SECONDARY_EVENT = 'workflow.admin-password-reset.decided';
```

- [ ] **Step 3: Add ApprovalsService to constructor**

Add `ApprovalsService` to the constructor. Find the constructor (line 39-45) and replace it:

```typescript
  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
    private readonly usersDomainService: UsersDomainService,
    private readonly jwtService: JwtService,
    private readonly auditLogsService: AuditLogsService,
    private readonly approvalsService: ApprovalsService,
  ) {}
```

- [ ] **Step 4: Add toAuditActor helper**

Add after the `hashToken` method (after line 49):

```typescript
  private toAuditActor(actor: ApprovalActorContext) {
    return {
      actorType: actor.actorType,
      actorId: actor.userId,
      actorNo: actor.userNo,
      actorRole: actor.role || actor.roleCodes[0] || 'UNKNOWN',
    };
  }
```

- [ ] **Step 5: Replace requestCisoReset with initiateAdminReset**

Replace the entire `requestCisoReset` method (lines 82-118) with:

```typescript
  async initiateAdminReset(targetUserId: string, actor: ApprovalActorContext) {
    const traceId = randomUUID();

    if (actor.userId === targetUserId) {
      throw new ForbiddenException('Cannot reset your own password via admin path');
    }

    const target = await this.prisma.user.findFirst({
      where: { id: targetUserId, deletedAt: null },
      select: {
        id: true, userNo: true, email: true, status: true,
        firstLoginStatus: true, mfaEnabledAt: true,
        userRoles: { select: { role: { select: { code: true } } } },
      },
    });
    if (!target) throw new BadRequestException('Target user not found');
    if (target.status !== 'ACTIVE') {
      throw new ConflictException(`Cannot reset password for user in status: ${target.status}`);
    }
    if (target.firstLoginStatus !== 'COMPLETED') {
      throw new ConflictException('Target user has not completed first login');
    }
    if (!target.mfaEnabledAt) {
      throw new ConflictException('Target user has not enabled MFA');
    }

    const roleCodes = target.userRoles.map((ur: any) => ur.role.code);
    if (roleCodes.includes('SUPER_ADMIN')) {
      throw new ForbiddenException('Cannot reset SUPER_ADMIN password via admin path');
    }

    const existingPending = await this.prisma.approvalCase.findFirst({
      where: {
        actionType: ApprovalActionTypes.ADMIN_PASSWORD_RESET,
        entityRef: targetUserId,
        status: 'PENDING',
        deletedAt: null,
      },
    });
    if (existingPending) {
      throw new ConflictException(
        `A pending password reset approval already exists: ${existingPending.approvalNo}`,
      );
    }

    const approvalCase = await this.approvalsService.createAndSubmit(
      {
        actionType: ApprovalActionTypes.ADMIN_PASSWORD_RESET,
        entityRef: targetUserId,
        workflowType: AuditBusinessWorkflowTypes.ADMIN_PASSWORD_RESET,
        workflowId: targetUserId,
        workflowNo: target.userNo,
        traceId,
        objectSnapshot: {
          targetUserId,
          targetUserNo: target.userNo,
          targetEmail: target.email,
          targetStatus: target.status,
          targetRoles: roleCodes,
        },
      },
      {
        reason: `Admin password reset request for ${target.email}`,
        traceId,
      },
      actor,
    );

    await this.auditLogsService.recordByActor(
      {
        action: AuditGovernanceActions.ADMIN_PASSWORD_RESET.RESET_REQUESTED,
        entityType: AuditEntityTypes.ADMIN_USER,
        entityId: targetUserId,
        entityNo: target.userNo,
        workflowType: AuditBusinessWorkflowTypes.ADMIN_PASSWORD_RESET,
        traceId,
        result: AuditResult.SUCCESS,
        metadata: {
          targetEmail: target.email,
          approvalNo: approvalCase.approvalNo,
        },
        requestId: `ADMIN_PASSWORD_RESET_REQUESTED_${target.userNo}`,
        sourcePlatform: 'ADMIN_API',
      },
      this.toAuditActor(actor),
    );

    return {
      approvalNo: approvalCase.approvalNo,
      traceId,
      targetUserNo: target.userNo,
      status: 'PENDING_APPROVAL',
    };
  }
```

- [ ] **Step 6: Add approval event handler**

Add after the `createResetTokenForSelf` method (after line ~127), before the `createResetToken` private method:

```typescript
  @OnEvent(SECONDARY_EVENT, { async: true })
  async handleApprovalDecided(event: ApprovalDecidedEvent) {
    switch (event.decision) {
      case 'APPROVED':
        return this.executeAdminReset(event);
      case 'DECLINED':
      case 'CANCELLED':
      case 'EXPIRED':
        return this.recordCancellation(event);
    }
  }

  private async executeAdminReset(event: ApprovalDecidedEvent) {
    try {
      const target = await this.prisma.user.findFirst({
        where: { id: event.entityRef, deletedAt: null },
        select: { id: true, userNo: true, email: true, status: true },
      });
      if (!target || target.status !== 'ACTIVE') {
        throw new Error('Target user is no longer active');
      }

      await this.createResetToken(
        target.id, target.userNo, target.email,
        'CISO',
        event.decisionByUserId || null,
        event.decisionByUserNo as string || null,
      );

      await this.auditLogsService.recordSystem({
        action: AuditGovernanceActions.ADMIN_PASSWORD_RESET.RESET_EXECUTED,
        entityType: AuditEntityTypes.ADMIN_USER,
        entityId: event.entityRef,
        entityNo: target.userNo,
        workflowType: AuditBusinessWorkflowTypes.ADMIN_PASSWORD_RESET,
        traceId: event.traceId,
        result: AuditResult.SUCCESS,
        metadata: {
          approvalId: event.approvalId,
          approvalNo: event.approvalNo,
          resetByUserId: event.decisionByUserId,
          resetByUserNo: event.decisionByUserNo,
        },
        requestId: `ADMIN_PASSWORD_RESET_EXECUTED_${target.userNo}`,
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
        'Password reset token generated successfully',
      );
    } catch (error) {
      await this.auditLogsService.recordSystem({
        action: AuditGovernanceActions.ADMIN_PASSWORD_RESET.RESET_FAILED,
        entityType: AuditEntityTypes.ADMIN_USER,
        entityId: event.entityRef,
        workflowType: AuditBusinessWorkflowTypes.ADMIN_PASSWORD_RESET,
        traceId: event.traceId,
        result: AuditResult.FAILED,
        reason: error instanceof Error ? error.message : 'Password reset execution failed',
        metadata: { approvalId: event.approvalId },
        requestId: `ADMIN_PASSWORD_RESET_FAILED_${event.entityRef}`,
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
          error instanceof Error ? error.message : 'Password reset execution failed',
        )
        .catch(() => undefined);

      throw error;
    }
  }

  private async recordCancellation(event: ApprovalDecidedEvent) {
    await this.auditLogsService.recordSystem({
      action: AuditGovernanceActions.ADMIN_PASSWORD_RESET.RESET_CANCELLED,
      entityType: AuditEntityTypes.ADMIN_USER,
      entityId: event.entityRef,
      workflowType: AuditBusinessWorkflowTypes.ADMIN_PASSWORD_RESET,
      traceId: event.traceId,
      result: AuditResult.SUCCESS,
      metadata: {
        approvalId: event.approvalId,
        approvalNo: event.approvalNo,
        decision: event.decision,
      },
      requestId: `ADMIN_PASSWORD_RESET_CANCELLED_${event.entityRef}`,
      sourcePlatform: 'ADMIN_API',
    });
  }
```

- [ ] **Step 7: Compile check**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js && npx tsc --noEmit --pretty 2>&1 | head -20
```

- [ ] **Step 8: Commit**

```bash
git add src/modules/identity/users/admin-password-reset-workflow.service.ts
git commit -m "feat(identity): refactor password reset CISO path to use approval flow"
```

---

### Task 6: Update Module Registration and Controllers

**Files:**
- Modify: `src/modules/identity/users/users.module.ts`
- Modify: `src/modules/identity/users/admin-credential-mgmt.controller.ts`
- Modify: `src/modules/identity/users/users.controller.ts`
- Delete: `src/modules/identity/users/admin-mfa-reset.service.ts`

- [ ] **Step 1: Update users.module.ts**

Replace the entire file `src/modules/identity/users/users.module.ts`:

```typescript
import { Module, forwardRef } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PrismaModule } from '../../../core/prisma/prisma.module';
import { AccessControlModule } from '../access-control/access-control.module';
import { ApprovalsModule } from '../../governance/approvals/approvals.module';
import { UsersService } from './users.service';
import { UsersDomainService } from './users.domain.service';
import { AdminInvitationsService } from './admin-invitations.service';
import { AdminInviteApprovalService } from './admin-invite-approval.service';
import { AdminInviteWorkflowService } from './admin-invite-workflow.service';
import { AdminRoleBindingChangeApprovalService } from './admin-role-binding-change-approval.service';
import { AdminRoleBindingChangeWorkflowService } from './admin-role-binding-change-workflow.service';
import { AdminRoleChangeRequestController } from './admin-role-change-request.controller';
import { AdminSuspensionApprovalService } from './admin-suspension-approval.service';
import { AdminSuspensionWorkflowService } from './admin-suspension-workflow.service';
import { AdminReactivationApprovalService } from './admin-reactivation-approval.service';
import { AdminReactivationWorkflowService } from './admin-reactivation-workflow.service';
import { AdminPasswordResetApprovalService } from './admin-password-reset-approval.service';
import { AdminPasswordResetWorkflowService } from './admin-password-reset-workflow.service';
import { AdminMfaResetApprovalService } from './admin-mfa-reset-approval.service';
import { AdminMfaResetWorkflowService } from './admin-mfa-reset-workflow.service';
import { AdminCredentialMgmtController } from './admin-credential-mgmt.controller';
import { UsersController } from './users.controller';

@Module({
  imports: [
    PrismaModule,
    AccessControlModule,
    forwardRef(() => ApprovalsModule),
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'secretKey',
      signOptions: { expiresIn: '24h' },
    }),
  ],
  providers: [
    UsersService,
    UsersDomainService,
    AdminInvitationsService,
    AdminInviteApprovalService,
    AdminInviteWorkflowService,
    AdminRoleBindingChangeApprovalService,
    AdminRoleBindingChangeWorkflowService,
    AdminSuspensionApprovalService,
    AdminSuspensionWorkflowService,
    AdminReactivationApprovalService,
    AdminReactivationWorkflowService,
    AdminPasswordResetApprovalService,
    AdminPasswordResetWorkflowService,
    AdminMfaResetApprovalService,
    AdminMfaResetWorkflowService,
  ],
  controllers: [UsersController, AdminRoleChangeRequestController, AdminCredentialMgmtController],
  exports: [UsersService, UsersDomainService, AdminInvitationsService, AdminPasswordResetWorkflowService],
})
export class UsersModule {}
```

- [ ] **Step 2: Update admin-credential-mgmt.controller.ts**

Replace the entire file `src/modules/identity/users/admin-credential-mgmt.controller.ts`:

```typescript
import {
  Controller,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminPermissionGuard } from '../access-control/admin-permission.guard';
import { RequirePermissions } from '../access-control/require-permissions.decorator';
import { buildPermissionCode } from '../access-control/permission-code.util';
import { AdminMfaResetWorkflowService } from './admin-mfa-reset-workflow.service';

@ApiTags('Admin - IAM')
@Controller('admin/iam')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
@ApiBearerAuth()
export class AdminCredentialMgmtController {
  constructor(private readonly adminMfaResetWorkflow: AdminMfaResetWorkflowService) {}

  private ensureAdmin(req: any) {
    if (req.user?.type !== 'ADMIN') {
      throw new ForbiddenException('Admin token required');
    }
  }

  @Post('users/:id/reset-mfa')
  @RequirePermissions(buildPermissionCode('POST', '/admin/iam/users/:id/reset-mfa'))
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Initiate admin MFA reset with approval (CISO / TECH_OFFICER)' })
  async resetMfa(
    @Param('id', new ParseUUIDPipe()) userId: string,
    @Req() req: any,
  ) {
    this.ensureAdmin(req);
    return this.adminMfaResetWorkflow.initiateAdminMfaReset(userId, {
      actorType: 'ADMIN',
      userId: req.user.userId,
      userNo: req.user.userNo,
      role: req.user.role,
      roleCodes: req.user.roleCodes || [req.user.role],
    });
  }
}
```

- [ ] **Step 3: Update users.controller.ts — reset-password endpoint**

In `src/modules/identity/users/users.controller.ts`, find the `resetPassword` method (around line 165). Replace the method:

```typescript
  @Post(':id/reset-password')
  @RequirePermissions(buildPermissionCode('POST', '/users/:id/reset-password'))
  @ApiOperation({ summary: 'Initiate admin password reset with approval (C5)' })
  async resetPassword(
    @Req() req: any,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    if (req.user?.type !== 'ADMIN') {
      throw new ForbiddenException('Admin token required');
    }

    return this.adminPasswordResetWorkflow.initiateAdminReset(id, {
      actorType: 'ADMIN',
      userId: req.user.userId,
      userNo: req.user.userNo,
      role: req.user.role,
      roleCodes: req.user.roleCodes || [req.user.role],
    });
  }
```

- [ ] **Step 4: Delete admin-mfa-reset.service.ts**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js && rm src/modules/identity/users/admin-mfa-reset.service.ts
```

- [ ] **Step 5: Compile check**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js && npx tsc --noEmit --pretty 2>&1 | head -30
```

Expected: No errors. If there are import issues, fix them.

- [ ] **Step 6: Commit**

```bash
git add -A src/modules/identity/users/
git commit -m "feat(identity): wire up credential reset workflows, delete flat MFA reset service"
```

---

### Task 7: Final Build Verification

- [ ] **Step 1: Full compile**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js && npx tsc --noEmit --pretty 2>&1 | tail -5
```

Expected: No errors.

- [ ] **Step 2: Review commit history**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js && git log --oneline -6
```

Expected: 6 commits covering constants, hasDedicatedAuditService, approval handlers, MFA workflow, password reset refactor, and module wiring.

---

## Cross-Task Dependencies

```
Task 1 (constants)              — independent
Task 2 (hasDedicatedAuditService) — depends on Task 1 (uses new WorkflowTypes)
Task 3 (approval handlers)      — depends on Task 1 (uses new ActionTypes and AuditActions)
Task 4 (MFA workflow)           — depends on Task 1 (uses new constants)
Task 5 (password reset refactor) — depends on Task 1 (uses new constants)
Task 6 (module + controllers)   — depends on Tasks 3, 4, 5 (registers new services)
Task 7 (final verification)     — depends on all
```

Recommended order: 1 → 2 → 3 → 4 → 5 → 6 → 7
