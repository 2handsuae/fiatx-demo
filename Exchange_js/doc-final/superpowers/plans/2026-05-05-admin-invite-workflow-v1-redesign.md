# Admin Invite Workflow V1 Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the monolithic `admin-invite-approval.service.ts` with strict three-layer architecture (Domain Service → Approval Sub-Workflow → Workflow) including a reusable `ApprovalHandlerBase` abstract class.

**Architecture:** Layer 1 (`users.domain.service.ts`) owns User entity writes. Layer 2 (`admin-invite-approval.service.ts`) extends `ApprovalHandlerBase` and handles approval audit only. Layer 3 (`admin-invite-workflow.service.ts`) orchestrates the full invite journey and subscribes to secondary approval-decided events. Two-stage event dispatch: raw approval events → Layer 2 → secondary `workflow.admin-invite.decided` event → Layer 3.

**Tech Stack:** NestJS, Prisma (SQLite), EventEmitter2, class-validator, React (admin-web)

---

## File Structure

| Action | File | Responsibility |
|--------|------|---------------|
| Create | `src/modules/governance/approvals/approval-handler.base.ts` | Abstract base class for all Layer 2 approval sub-workflows |
| Create | `src/modules/identity/users/users.domain.service.ts` | Layer 1 — User entity writes (create, updateStatus, delete) |
| Rewrite | `src/modules/identity/users/admin-invite-approval.service.ts` | Layer 2 — Extends ApprovalHandlerBase (4 constants only) |
| Create | `src/modules/identity/users/admin-invite-workflow.service.ts` | Layer 3 — Full invite journey orchestration |
| Modify | `src/modules/identity/users/users.service.ts` | Keep read-only queries, remove write methods |
| Rewrite | `src/modules/identity/users/users.controller.ts` | Transport only, delegates to workflow |
| Modify | `src/modules/identity/users/users.module.ts` | Register new providers |
| Rewrite | `admin-web/src/pages/PlatformMembers.tsx` | List page with invite modal |
| Rewrite | `admin-web/src/pages/PlatformMemberDetailPage.tsx` | Detail page with contextual actions |

---

## Task 0: Add Missing Audit Action Constants

**Files:**
- Modify: `src/modules/audit-logging/constants/audit-actions.constant.ts`

The spec defines `INVITE_CANCELLED` as a Layer 3 business audit action (distinct from Layer 2's `APPROVAL_CANCELLED`). This constant doesn't exist yet.

- [ ] **Step 1: Add `INVITE_CANCELLED` to `AuditGovernanceActions.ADMIN_INVITE`**

In `src/modules/audit-logging/constants/audit-actions.constant.ts`, find the `ADMIN_INVITE` block and add:

```typescript
  ADMIN_INVITE: {
    INVITE_REQUESTED:       'INVITE_REQUESTED',
    APPROVAL_GRANTED:       'APPROVAL_GRANTED',
    APPROVAL_DECLINED:      'APPROVAL_DECLINED',
    APPROVAL_CANCELLED:     'APPROVAL_CANCELLED',
    INVITE_LINK_DISPATCHED: 'INVITE_LINK_DISPATCHED',
    INVITE_CANCELLED:       'INVITE_CANCELLED',       // NEW — Layer 3 writes when user is deleted
    INVITE_LINK_EXPIRED:    'INVITE_LINK_EXPIRED',
    ACCOUNT_ACTIVATED:      'ACCOUNT_ACTIVATED',
  },
```

- [ ] **Step 2: Verify compiles**

Run: `cd Exchange_js && npx tsc --noEmit --pretty 2>&1 | head -10`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/modules/audit-logging/constants/audit-actions.constant.ts
git commit -m "feat(audit): add INVITE_CANCELLED action constant for Layer 3 admin invite workflow"
```

---

## Task 1: Create ApprovalHandlerBase Abstract Class

**Files:**
- Create: `src/modules/governance/approvals/approval-handler.base.ts`

This is the reusable abstract class that all Layer 2 approval services will extend. It subscribes to raw approval engine events, filters by `actionType`, writes approval-layer audit logs, and emits a secondary `workflow.[type].decided` event for Layer 3 to consume.

- [ ] **Step 1: Create the base class file**

```typescript
// src/modules/governance/approvals/approval-handler.base.ts
import { OnEvent } from '@nestjs/event-emitter';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import { AuditResult } from '../../audit-logging/dto/audit-log.dto';
import {
  ApprovalDecisionEvent,
  ApprovalEvents,
} from './constants/approval.constants';

export interface ApprovalDecidedEvent {
  decision: 'APPROVED' | 'DECLINED' | 'CANCELLED' | 'EXPIRED';
  actionType: string;
  entityRef: string;
  approvalId: string;
  approvalNo: string;
  traceId: string;
  workflowType: string;
  decisionByUserId?: string | null;
  decisionByUserNo?: string | null;
  decisionByRole?: string | null;
  decisionReason?: string | null;
  decidedAt?: string | null;
  metadata: Record<string, any>;
}

export abstract class ApprovalHandlerBase {
  abstract readonly actionType: string;
  abstract readonly workflowType: string;
  abstract readonly auditActions: {
    granted: string;
    declined: string;
    cancelled: string;
  };
  abstract readonly entityType: string;

  constructor(
    protected readonly auditLogsService: AuditLogsService,
    protected readonly eventEmitter: EventEmitter2,
  ) {}

  private buildSecondaryEventName(): string {
    const kebab = this.workflowType.toLowerCase().replace(/_/g, '-');
    return `workflow.${kebab}.decided`;
  }

  private buildAuditActor(event: ApprovalDecisionEvent) {
    return {
      actorType: 'ADMIN' as const,
      actorId: event.decisionByUserId || 'SYSTEM',
      actorNo: (event.decisionByUserNo as string | undefined) || undefined,
      actorRole: (event.decisionByRole as string | undefined) || 'SYSTEM',
    };
  }

  private async emitDecidedEvent(
    decision: ApprovalDecidedEvent['decision'],
    event: ApprovalDecisionEvent,
  ) {
    const payload: ApprovalDecidedEvent = {
      decision,
      actionType: event.actionType,
      entityRef: event.entityRef,
      approvalId: event.approvalId,
      approvalNo: event.approvalNo,
      traceId: event.traceId,
      workflowType: this.workflowType,
      decisionByUserId: event.decisionByUserId,
      decisionByUserNo: event.decisionByUserNo,
      decisionByRole: event.decisionByRole,
      decisionReason: event.decisionReason,
      decidedAt: event.decidedAt,
      metadata: {},
    };

    const eventName = this.buildSecondaryEventName();
    if (typeof this.eventEmitter.emitAsync === 'function') {
      await this.eventEmitter.emitAsync(eventName, payload);
    } else {
      this.eventEmitter.emit(eventName, payload);
    }
  }

  @OnEvent(ApprovalEvents.APPROVED, { async: true })
  async handleApproved(event: ApprovalDecisionEvent) {
    if (event.actionType !== this.actionType) return;

    await this.auditLogsService.recordByActor(
      {
        action: this.auditActions.granted,
        entityType: this.entityType,
        entityId: event.entityRef,
        workflowType: this.workflowType,
        traceId: event.traceId,
        result: AuditResult.SUCCESS,
        metadata: { approvalId: event.approvalId, approvalNo: event.approvalNo },
        requestId: `${this.workflowType}_APPROVAL_GRANTED_${event.approvalNo}`,
        sourcePlatform: 'ADMIN_API',
      },
      this.buildAuditActor(event),
    );

    await this.emitDecidedEvent('APPROVED', event);
  }

  @OnEvent(ApprovalEvents.REJECTED, { async: true })
  async handleRejected(event: ApprovalDecisionEvent) {
    if (event.actionType !== this.actionType) return;

    await this.auditLogsService.recordByActor(
      {
        action: this.auditActions.declined,
        entityType: this.entityType,
        entityId: event.entityRef,
        workflowType: this.workflowType,
        traceId: event.traceId,
        result: AuditResult.REJECTED,
        metadata: {
          approvalId: event.approvalId,
          approvalNo: event.approvalNo,
          decisionReason: event.decisionReason,
        },
        requestId: `${this.workflowType}_APPROVAL_DECLINED_${event.approvalNo}`,
        sourcePlatform: 'ADMIN_API',
      },
      this.buildAuditActor(event),
    );

    await this.emitDecidedEvent('DECLINED', event);
  }

  @OnEvent(ApprovalEvents.CANCELLED, { async: true })
  async handleCancelled(event: ApprovalDecisionEvent) {
    if (event.actionType !== this.actionType) return;

    await this.auditLogsService.recordByActor(
      {
        action: this.auditActions.cancelled,
        entityType: this.entityType,
        entityId: event.entityRef,
        workflowType: this.workflowType,
        traceId: event.traceId,
        result: AuditResult.SUCCESS,
        metadata: { approvalId: event.approvalId, approvalNo: event.approvalNo },
        requestId: `${this.workflowType}_APPROVAL_CANCELLED_${event.approvalNo}`,
        sourcePlatform: 'ADMIN_API',
      },
      this.buildAuditActor(event),
    );

    await this.emitDecidedEvent('CANCELLED', event);
  }

  @OnEvent(ApprovalEvents.EXPIRED, { async: true })
  async handleExpired(event: ApprovalDecisionEvent) {
    if (event.actionType !== this.actionType) return;

    await this.auditLogsService.recordByActor(
      {
        action: this.auditActions.cancelled,
        entityType: this.entityType,
        entityId: event.entityRef,
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
      },
      {
        actorType: 'ADMIN',
        actorId: 'SYSTEM',
        actorRole: 'SYSTEM',
      },
    );

    await this.emitDecidedEvent('EXPIRED', event);
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd Exchange_js && npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No errors related to `approval-handler.base.ts`

- [ ] **Step 3: Commit**

```bash
git add src/modules/governance/approvals/approval-handler.base.ts
git commit -m "feat(governance): add ApprovalHandlerBase abstract class for Layer 2 services"
```

---

## Task 2: Create Users Domain Service (Layer 1)

**Files:**
- Create: `src/modules/identity/users/users.domain.service.ts`

Layer 1 owns User entity data operations: create provisional user, update status, physical delete. Accepts optional `tx` for transactional composition.

- [ ] **Step 1: Create the domain service**

```typescript
// src/modules/identity/users/users.domain.service.ts
import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { generateReferenceNo } from '../../../common/utils/no-generator.util';
import { getPrimaryRoleCode } from '../access-control/rbac.catalog';

const MAX_USER_NO_RETRIES = 10;

export interface CreateProvisionalUserInput {
  email: string;
  roleCodes: string[];
}

export interface ProvisionalUser {
  id: string;
  userNo: string;
  email: string;
  status: string;
  role: string;
}

@Injectable()
export class UsersDomainService {
  constructor(private readonly prisma: PrismaService) {}

  private normalizeEmail(email: string): string {
    return String(email || '').trim().toLowerCase();
  }

  private isUniqueConstraintOn(error: unknown, field: string): boolean {
    const e = error as { code?: string; meta?: { target?: string[] | string } };
    if (e?.code !== 'P2002') return false;
    const t = e.meta?.target;
    return Array.isArray(t) ? t.includes(field) : typeof t === 'string' && t.includes(field);
  }

  async createProvisionalUser(
    input: CreateProvisionalUserInput,
    tx?: Prisma.TransactionClient,
  ): Promise<ProvisionalUser> {
    const client = tx || this.prisma;
    const email = this.normalizeEmail(input.email);

    const existing = await client.user.findFirst({
      where: { email, deletedAt: null },
      select: { id: true },
    });
    if (existing) throw new ConflictException('Email already exists');

    const primaryRoleCode = getPrimaryRoleCode(input.roleCodes) || input.roleCodes[0];
    const temporaryPassword = randomBytes(24).toString('hex');
    const passwordHash = await bcrypt.hash(temporaryPassword, 10);

    for (let i = 0; i < MAX_USER_NO_RETRIES; i++) {
      const userNo = generateReferenceNo('ADM');
      try {
        const user = await client.user.create({
          data: {
            userNo,
            email,
            password: passwordHash,
            role: primaryRoleCode,
            status: 'PENDING_INVITE_APPROVAL',
          },
        });
        return {
          id: user.id,
          userNo: user.userNo,
          email: user.email,
          status: user.status,
          role: user.role,
        };
      } catch (err) {
        if (this.isUniqueConstraintOn(err, 'userNo')) continue;
        if (this.isUniqueConstraintOn(err, 'email'))
          throw new ConflictException('Email already exists');
        throw err;
      }
    }

    throw new InternalServerErrorException(
      `Failed to generate unique userNo after ${MAX_USER_NO_RETRIES} attempts`,
    );
  }

  async updateStatus(
    userId: string,
    newStatus: string,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const client = tx || this.prisma;
    const user = await client.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { id: true, status: true },
    });
    if (!user) throw new NotFoundException('User not found');

    await client.user.update({
      where: { id: userId },
      data: { status: newStatus },
    });
  }

  async physicalDelete(userId: string, tx?: Prisma.TransactionClient): Promise<void> {
    const client = tx || this.prisma;
    await client.user.delete({ where: { id: userId } }).catch(() => undefined);
  }

  async findById(userId: string): Promise<ProvisionalUser | null> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { id: true, userNo: true, email: true, status: true, role: true },
    });
    if (!user) return null;
    return {
      id: user.id,
      userNo: user.userNo,
      email: user.email,
      status: user.status,
      role: user.role,
    };
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd Exchange_js && npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No errors related to `users.domain.service.ts`

- [ ] **Step 3: Commit**

```bash
git add src/modules/identity/users/users.domain.service.ts
git commit -m "feat(identity): add UsersDomainService (Layer 1) for User entity writes"
```

---

## Task 3: Rewrite Admin Invite Approval Service (Layer 2)

**Files:**
- Rewrite: `src/modules/identity/users/admin-invite-approval.service.ts`

The new Layer 2 is minimal — extends `ApprovalHandlerBase`, provides 4 constants, done.

- [ ] **Step 1: Replace the file contents**

```typescript
// src/modules/identity/users/admin-invite-approval.service.ts
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
export class AdminInviteApprovalService extends ApprovalHandlerBase {
  readonly actionType = ApprovalActionTypes.ADMIN_INVITE_APPROVAL;
  readonly workflowType = AuditBusinessWorkflowTypes.ADMIN_INVITE;
  readonly auditActions = {
    granted: AuditGovernanceActions.ADMIN_INVITE.APPROVAL_GRANTED,
    declined: AuditGovernanceActions.ADMIN_INVITE.APPROVAL_DECLINED,
    cancelled: AuditGovernanceActions.ADMIN_INVITE.APPROVAL_CANCELLED,
  };
  readonly entityType = AuditEntityTypes.ACCESS_CONTROL;

  constructor(auditLogsService: AuditLogsService, eventEmitter: EventEmitter2) {
    super(auditLogsService, eventEmitter);
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd Exchange_js && npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/modules/identity/users/admin-invite-approval.service.ts
git commit -m "feat(identity): rewrite AdminInviteApprovalService as Layer 2 (extends ApprovalHandlerBase)"
```

---

## Task 4: Create Admin Invite Workflow Service (Layer 3)

**Files:**
- Create: `src/modules/identity/users/admin-invite-workflow.service.ts`

Layer 3 orchestrates the full invite journey: initiate (create user + bind roles + submit approval), handle approval decisions (dispatch invite or delete user), handle resend.

- [ ] **Step 1: Create the workflow service**

```typescript
// src/modules/identity/users/admin-invite-workflow.service.ts
import { Injectable, InternalServerErrorException } from '@nestjs/common';
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
import { AccessControlService } from '../access-control/access-control.service';
import { AdminInvitationsService } from './admin-invitations.service';
import { UsersDomainService } from './users.domain.service';

const SECONDARY_EVENT = 'workflow.admin-invite.decided';

export interface InitiateAdminInviteDto {
  email: string;
  roleCodes: string[];
  changeReason?: string;
}

@Injectable()
export class AdminInviteWorkflowService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly usersDomainService: UsersDomainService,
    private readonly accessControlService: AccessControlService,
    private readonly approvalsService: ApprovalsService,
    private readonly adminInvitationsService: AdminInvitationsService,
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

  async initiateInvite(dto: InitiateAdminInviteDto, actor: ApprovalActorContext) {
    const traceId = randomUUID();
    const roleCodes = dto.roleCodes;

    const user = await this.usersDomainService.createProvisionalUser({
      email: dto.email,
      roleCodes,
    });

    let approvalCase: any = null;
    try {
      await this.accessControlService.replaceUserRoles(
        user.id,
        roleCodes,
        { actorId: actor.userId, actorNo: actor.userNo, actorRole: actor.role || actor.roleCodes[0] || 'UNKNOWN' },
        { workflowType: AuditBusinessWorkflowTypes.ADMIN_INVITE, traceId },
      );

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
        },
        {
          reason: dto.changeReason || `Admin invite request for ${user.email}`,
          traceId,
        },
        actor,
      );
    } catch (error) {
      await this.usersDomainService.physicalDelete(user.id);
      throw error;
    }

    await this.auditLogsService.recordByActor(
      {
        action: AuditGovernanceActions.ADMIN_INVITE.INVITE_REQUESTED,
        entityType: AuditEntityTypes.ACCESS_CONTROL,
        entityId: user.id,
        entityNo: user.userNo,
        workflowType: AuditBusinessWorkflowTypes.ADMIN_INVITE,
        traceId,
        result: AuditResult.SUCCESS,
        metadata: {
          userEmail: user.email,
          roleCodes,
          approvalNo: approvalCase.approvalNo,
          changeReason: dto.changeReason || null,
        },
        requestId: `ADMIN_INVITE_REQUESTED_${user.userNo}`,
        sourcePlatform: 'ADMIN_API',
      },
      this.toAuditActor(actor),
    );

    return {
      userId: user.id,
      userNo: user.userNo,
      email: user.email,
      status: 'PENDING_INVITE_APPROVAL',
      approvalNo: approvalCase.approvalNo,
      approvalStatus: approvalCase.status,
    };
  }

  @OnEvent(SECONDARY_EVENT, { async: true })
  async handleApprovalDecided(event: ApprovalDecidedEvent) {
    switch (event.decision) {
      case 'APPROVED':
        return this.executeInviteDispatch(event);
      case 'DECLINED':
      case 'CANCELLED':
      case 'EXPIRED':
        return this.executeInviteCancellation(event);
    }
  }

  private async executeInviteDispatch(event: ApprovalDecidedEvent) {
    const user = await this.usersDomainService.findById(event.entityRef);
    if (!user) return;

    try {
      const invitation = await this.adminInvitationsService.createInvitationForUser({
        userId: user.id,
        actor: {
          actorId: event.decisionByUserId || 'SYSTEM',
          actorRole: event.decisionByRole || 'SYSTEM',
          actorNo: event.decisionByUserNo || undefined,
        },
        auditContext: {
          workflowType: AuditBusinessWorkflowTypes.ADMIN_INVITE,
          traceId: event.traceId,
        },
      });

      await this.usersDomainService.updateStatus(user.id, 'INVITE_SENT');

      await this.auditLogsService.recordByActor(
        {
          action: AuditGovernanceActions.ADMIN_INVITE.INVITE_LINK_DISPATCHED,
          entityType: AuditEntityTypes.ACCESS_CONTROL,
          entityId: user.id,
          entityNo: user.userNo,
          workflowType: AuditBusinessWorkflowTypes.ADMIN_INVITE,
          traceId: event.traceId,
          result: AuditResult.SUCCESS,
          metadata: {
            approvalId: event.approvalId,
            approvalNo: event.approvalNo,
            inviteExpiresAt: invitation.inviteExpiresAt,
          },
          requestId: `ADMIN_INVITE_DISPATCHED_${user.userNo}`,
          sourcePlatform: 'ADMIN_API',
        },
        {
          actorType: 'ADMIN',
          actorId: event.decisionByUserId || 'SYSTEM',
          actorNo: event.decisionByUserNo || undefined,
          actorRole: event.decisionByRole || 'SYSTEM',
        },
      );

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
        'Admin invite link dispatched',
      );
    } catch (error) {
      await this.auditLogsService.recordByActor(
        {
          action: AuditGovernanceActions.ADMIN_INVITE.INVITE_LINK_DISPATCHED,
          entityType: AuditEntityTypes.ACCESS_CONTROL,
          entityId: user.id,
          entityNo: user.userNo,
          workflowType: AuditBusinessWorkflowTypes.ADMIN_INVITE,
          traceId: event.traceId,
          result: AuditResult.FAILED,
          reason: error instanceof Error ? error.message : 'Failed to dispatch invite',
          metadata: { approvalId: event.approvalId },
          requestId: `ADMIN_INVITE_DISPATCH_FAILED_${user.userNo}`,
          sourcePlatform: 'ADMIN_API',
        },
        {
          actorType: 'ADMIN',
          actorId: event.decisionByUserId || 'SYSTEM',
          actorRole: event.decisionByRole || 'SYSTEM',
        },
      );

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
          error instanceof Error ? error.message : 'Failed to dispatch invite',
        )
        .catch(() => undefined);

      throw error;
    }
  }

  private async executeInviteCancellation(event: ApprovalDecidedEvent) {
    const user = await this.usersDomainService.findById(event.entityRef);
    if (!user) return;

    await this.usersDomainService.physicalDelete(user.id);

    await this.auditLogsService
      .recordByActor(
        {
          action: AuditGovernanceActions.ADMIN_INVITE.INVITE_CANCELLED,
          entityType: AuditEntityTypes.ACCESS_CONTROL,
          entityId: user.id,
          entityNo: user.userNo,
          workflowType: AuditBusinessWorkflowTypes.ADMIN_INVITE,
          traceId: event.traceId,
          result: AuditResult.SUCCESS,
          metadata: {
            approvalId: event.approvalId,
            approvalNo: event.approvalNo,
            decision: event.decision,
            decisionReason: event.decisionReason,
          },
          requestId: `ADMIN_INVITE_CANCELLED_${user.userNo}`,
          sourcePlatform: 'ADMIN_API',
        },
        {
          actorType: 'ADMIN',
          actorId: event.decisionByUserId || 'SYSTEM',
          actorNo: event.decisionByUserNo || undefined,
          actorRole: event.decisionByRole || 'SYSTEM',
        },
      )
      .catch(() => undefined);
  }

  async resendInvitation(userId: string, actor: ApprovalActorContext) {
    const user = await this.usersDomainService.findById(userId);
    if (!user) throw new InternalServerErrorException('User not found');

    return this.adminInvitationsService.resendInvitationForUser({
      userId: user.id,
      actor: {
        actorId: actor.userId,
        actorRole: actor.role || actor.roleCodes[0] || 'UNKNOWN',
        actorNo: actor.userNo,
      },
      auditContext: {
        workflowType: AuditBusinessWorkflowTypes.ADMIN_INVITE,
      },
    });
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd Exchange_js && npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No errors related to the new file

- [ ] **Step 3: Commit**

```bash
git add src/modules/identity/users/admin-invite-workflow.service.ts
git commit -m "feat(identity): add AdminInviteWorkflowService (Layer 3) — full invite journey orchestration"
```

---

## Task 5: Refactor UsersService (Remove Write Methods)

**Files:**
- Modify: `src/modules/identity/users/users.service.ts`

Remove `createAdminUser` and `executeAdminMemberProvisioning` methods (now owned by Layer 1 + Layer 3). Keep read-model methods (`findAll`, `getMemberDetail`, `findOne`, `findById`, `findByIdentifier`, `resendAdminInvitation`, `update`).

- [ ] **Step 1: Remove the `createAdminUser` method (lines 297-417)**

Delete the entire `createAdminUser` method body and its associated imports that are no longer needed.

- [ ] **Step 2: Remove the `executeAdminMemberProvisioning` method (lines 419-477)**

Delete the entire method.

- [ ] **Step 3: Remove unused private helpers**

Remove `normalizeRoleCodes`, `normalizeEmail`, `sameRoleCodes`, `isRecoverableProvisioningError`, `isUniqueConstraintOn`, `buildProvisioningAuditContext`, `applyAuditContext`, `toAdminActor` if they are no longer used by remaining methods. Keep `normalizeOptionalString`, `activeUserWhere`, `mapInvitationStatus` which are used by read methods.

- [ ] **Step 4: Remove unused imports**

Remove: `ConflictException`, `InternalServerErrorException`, `randomBytes`, `bcrypt`, `generateReferenceNo`, `getPrimaryRoleCode`, `AuditActions`, `AuditModules` (keep only what's needed by remaining methods).

- [ ] **Step 5: Verify TypeScript compiles**

Run: `cd Exchange_js && npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add src/modules/identity/users/users.service.ts
git commit -m "refactor(identity): remove write methods from UsersService (moved to UsersDomainService + Workflow)"
```

---

## Task 6: Rewrite Users Controller

**Files:**
- Rewrite: `src/modules/identity/users/users.controller.ts`

Transport-only controller. Delegates to `AdminInviteWorkflowService` for invite initiation and resend. Delegates to `UsersService` for list/detail queries.

- [ ] **Step 1: Rewrite the controller**

```typescript
// src/modules/identity/users/users.controller.ts
import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { AdminPermissionGuard } from '../access-control/admin-permission.guard';
import { RequirePermissions } from '../access-control/require-permissions.decorator';
import { buildPermissionCode } from '../access-control/permission-code.util';
import { ApprovalActorContext } from '../../governance/approvals/constants/approval.constants';
import { AdminInviteWorkflowService } from './admin-invite-workflow.service';
import { UsersService } from './users.service';
import { CreateAdminUserDto } from './dto/create-admin-user.dto';

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
export class UsersController {
  constructor(
    private readonly adminInviteWorkflow: AdminInviteWorkflowService,
    private readonly usersService: UsersService,
  ) {}

  private buildAdminActor(req: any): ApprovalActorContext {
    return {
      actorType: 'ADMIN',
      userId: req.user.userId,
      userNo: req.user.userNo,
      role: req.user.role || 'ADMIN',
      roleCodes: req.user.roleCodes || [req.user.role || 'ADMIN'],
    };
  }

  @Post()
  @RequirePermissions(buildPermissionCode('POST', '/users'))
  @ApiOperation({ summary: 'Initiate admin invite approval (C1)' })
  async create(
    @Req() req: any,
    @Body(new ValidationPipe({ transform: true })) body: CreateAdminUserDto,
  ) {
    if (req.user?.type !== 'ADMIN') {
      throw new ForbiddenException('Admin token required');
    }

    return this.adminInviteWorkflow.initiateInvite(
      {
        email: body.email,
        roleCodes: body.roleCodes,
        changeReason: body.changeReason,
      },
      this.buildAdminActor(req),
    );
  }

  @Get()
  @RequirePermissions(buildPermissionCode('GET', '/users'))
  @ApiOperation({ summary: 'List all users' })
  async findAll(@Req() req: any, @Query('skip') skip?: string, @Query('take') take?: string) {
    if (req.user?.type !== 'ADMIN') {
      throw new ForbiddenException('Admin token required');
    }

    const users = await this.usersService.findAll({
      skip: skip ? Number(skip) : undefined,
      take: take ? Number(take) : 20,
      orderBy: { createdAt: 'desc' },
    });

    return users.map((user: any) => ({
      id: user.id,
      userNo: user.userNo,
      email: user.email,
      role: user.role,
      status: user.status,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      lastLoginAt: user.lastLoginAt,
      roles: (user.userRoles || [])
        .map((item: any) => item.role?.code)
        .filter(Boolean),
    }));
  }

  @Get(':id')
  @RequirePermissions(buildPermissionCode('GET', '/users'))
  @ApiOperation({ summary: 'Get one user detail with invitation summary' })
  async findOne(@Req() req: any, @Param('id', new ParseUUIDPipe()) id: string) {
    if (req.user?.type !== 'ADMIN') {
      throw new ForbiddenException('Admin token required');
    }

    return this.usersService.getMemberDetail(id);
  }

  @Post(':id/invitations/resend')
  @RequirePermissions(buildPermissionCode('POST', '/users/:id/invitations/resend'))
  @ApiOperation({ summary: 'Resend admin invitation link for INACTIVE/INVITE_SENT member' })
  async resendInvitation(@Req() req: any, @Param('id') id: string) {
    if (req.user?.type !== 'ADMIN') {
      throw new ForbiddenException('Admin token required');
    }

    return this.adminInviteWorkflow.resendInvitation(id, this.buildAdminActor(req));
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd Exchange_js && npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/modules/identity/users/users.controller.ts
git commit -m "refactor(identity): rewrite UsersController — transport only, delegates to workflow"
```

---

## Task 7: Update Users Module

**Files:**
- Modify: `src/modules/identity/users/users.module.ts`

Register the new `UsersDomainService` and `AdminInviteWorkflowService` providers.

- [ ] **Step 1: Rewrite the module**

```typescript
// src/modules/identity/users/users.module.ts
import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../../../core/prisma/prisma.module';
import { AccessControlModule } from '../access-control/access-control.module';
import { ApprovalsModule } from '../../governance/approvals/approvals.module';
import { UsersService } from './users.service';
import { UsersDomainService } from './users.domain.service';
import { AdminInvitationsService } from './admin-invitations.service';
import { AdminInviteApprovalService } from './admin-invite-approval.service';
import { AdminInviteWorkflowService } from './admin-invite-workflow.service';
import { UsersController } from './users.controller';

@Module({
  imports: [PrismaModule, AccessControlModule, forwardRef(() => ApprovalsModule)],
  providers: [
    UsersService,
    UsersDomainService,
    AdminInvitationsService,
    AdminInviteApprovalService,
    AdminInviteWorkflowService,
  ],
  controllers: [UsersController],
  exports: [UsersService, UsersDomainService, AdminInvitationsService],
})
export class UsersModule {}
```

- [ ] **Step 2: Verify full application bootstraps**

Run: `cd Exchange_js && npx tsc --noEmit --pretty 2>&1 | tail -5`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/modules/identity/users/users.module.ts
git commit -m "feat(identity): register UsersDomainService + AdminInviteWorkflowService in UsersModule"
```

---

## Task 8: Integration Verification

**Files:**
- None (verification only)

- [ ] **Step 1: Run the full TypeScript compilation**

Run: `cd Exchange_js && npx tsc --noEmit --pretty 2>&1 | tail -20`
Expected: 0 errors

- [ ] **Step 2: Run existing tests**

Run: `cd Exchange_js && npx jest --passWithNoTests --forceExit 2>&1 | tail -20`
Expected: All existing tests pass (or no tests found for modified files)

- [ ] **Step 3: Start the dev server and verify boot**

Run: `cd Exchange_js && npm run dev:start`
Then verify: `curl -s http://localhost:3500/api | head -5`
Expected: Swagger JSON response (server started successfully)

- [ ] **Step 4: Stop dev server**

Run: `cd Exchange_js && npm run dev:stop`

- [ ] **Step 5: Commit (if any compilation fixes were needed)**

```bash
git add -A
git commit -m "fix(identity): address compilation issues from admin invite redesign"
```

---

## Task 9: Rewrite Platform Members List Page

**Files:**
- Rewrite: `admin-web/src/pages/PlatformMembers.tsx`

List page with status badges, invite modal, and row click navigation.

- [ ] **Step 1: Rewrite the list page**

```tsx
// admin-web/src/pages/PlatformMembers.tsx
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Button,
  Table,
  Tag,
  Modal,
  Form,
  Input,
  Select,
  message,
  Space,
} from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { apiClient } from '../services/apiClient';

interface Member {
  id: string;
  userNo: string;
  email: string;
  role: string;
  status: string;
  roles: string[];
  createdAt: string;
  lastLoginAt: string | null;
}

const STATUS_COLORS: Record<string, string> = {
  PENDING_INVITE_APPROVAL: 'orange',
  INVITE_SENT: 'blue',
  ACTIVE: 'green',
  PENDING_SUSPENSION_APPROVAL: 'gold',
  SUSPENDED: 'red',
};

const ROLE_OPTIONS = [
  { value: 'SUPER_ADMIN', label: 'Super Admin' },
  { value: 'CISO', label: 'CISO' },
  { value: 'MLRO', label: 'MLRO' },
  { value: 'DPO', label: 'DPO' },
  { value: 'COMPLIANCE_OFFICER', label: 'Compliance Officer' },
  { value: 'TECH_OFFICER', label: 'Tech Officer' },
  { value: 'SENIOR_MANAGEMENT_OFFICER', label: 'Senior Management' },
  { value: 'CUSTOMER_SUPPORT_OFFICER', label: 'Customer Support' },
];

export default function PlatformMembers() {
  const navigate = useNavigate();
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form] = Form.useForm();

  const fetchMembers = async () => {
    setLoading(true);
    try {
      const res = await apiClient.get('/users');
      setMembers(res.data);
    } catch (err: any) {
      message.error(err?.response?.data?.message || 'Failed to load members');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMembers();
  }, []);

  const handleInvite = async (values: { email: string; roleCodes: string[]; changeReason: string }) => {
    setSubmitting(true);
    try {
      await apiClient.post('/users', values);
      message.success('Invite submitted for approval');
      setModalOpen(false);
      form.resetFields();
      fetchMembers();
    } catch (err: any) {
      message.error(err?.response?.data?.message || 'Failed to submit invite');
    } finally {
      setSubmitting(false);
    }
  };

  const columns = [
    { title: 'User No', dataIndex: 'userNo', key: 'userNo', width: 140 },
    { title: 'Email', dataIndex: 'email', key: 'email' },
    { title: 'Role', dataIndex: 'role', key: 'role', width: 180 },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      width: 200,
      render: (status: string) => (
        <Tag color={STATUS_COLORS[status] || 'default'}>{status}</Tag>
      ),
    },
    {
      title: 'Created',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 180,
      render: (v: string) => v ? new Date(v).toLocaleString() : '-',
    },
    {
      title: 'Last Login',
      dataIndex: 'lastLoginAt',
      key: 'lastLoginAt',
      width: 180,
      render: (v: string | null) => v ? new Date(v).toLocaleString() : '-',
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <h2>Platform Members</h2>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setModalOpen(true)}>
          Invite New Member
        </Button>
      </div>

      <Table
        columns={columns}
        dataSource={members}
        rowKey="id"
        loading={loading}
        onRow={(record) => ({
          onClick: () => navigate(`/platform-members/${record.id}`),
          style: { cursor: 'pointer' },
        })}
        pagination={{ pageSize: 20 }}
      />

      <Modal
        title="Invite New Admin Member"
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        footer={null}
        destroyOnClose
      >
        <Form form={form} layout="vertical" onFinish={handleInvite}>
          <Form.Item
            name="email"
            label="Email"
            rules={[
              { required: true, message: 'Email is required' },
              { type: 'email', message: 'Invalid email' },
            ]}
          >
            <Input placeholder="user@example.com" />
          </Form.Item>

          <Form.Item
            name="roleCodes"
            label="Roles"
            rules={[{ required: true, message: 'At least one role is required' }]}
          >
            <Select mode="multiple" placeholder="Select roles" options={ROLE_OPTIONS} />
          </Form.Item>

          <Form.Item
            name="changeReason"
            label="Reason"
            rules={[{ required: true, message: 'Reason is required' }]}
          >
            <Input.TextArea rows={3} placeholder="Reason for inviting this member" />
          </Form.Item>

          <Form.Item>
            <Space>
              <Button type="primary" htmlType="submit" loading={submitting}>
                Submit for Approval
              </Button>
              <Button onClick={() => setModalOpen(false)}>Cancel</Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
```

- [ ] **Step 2: Verify frontend compiles**

Run: `cd Exchange_js/admin-web && npx tsc --noEmit 2>&1 | tail -10`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add admin-web/src/pages/PlatformMembers.tsx
git commit -m "feat(admin-web): rewrite PlatformMembers list page with invite modal"
```

---

## Task 10: Rewrite Platform Member Detail Page

**Files:**
- Rewrite: `admin-web/src/pages/PlatformMemberDetailPage.tsx`

Detail page showing member info, invitation status, and contextual actions.

- [ ] **Step 1: Rewrite the detail page**

```tsx
// admin-web/src/pages/PlatformMemberDetailPage.tsx
import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Button,
  Card,
  Descriptions,
  Tag,
  Space,
  message,
  Spin,
  Result,
} from 'antd';
import { ArrowLeftOutlined, MailOutlined } from '@ant-design/icons';
import { apiClient } from '../services/apiClient';

interface MemberDetail {
  id: string;
  userNo: string;
  email: string;
  role: string;
  status: string;
  roles: string[];
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
  latestInvitation: {
    inviteStatus: 'PENDING' | 'EXPIRED' | 'USED' | 'REVOKED';
    inviteExpiresAt: string;
  } | null;
}

const STATUS_COLORS: Record<string, string> = {
  PENDING_INVITE_APPROVAL: 'orange',
  INVITE_SENT: 'blue',
  ACTIVE: 'green',
  PENDING_SUSPENSION_APPROVAL: 'gold',
  SUSPENDED: 'red',
};

export default function PlatformMemberDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [member, setMember] = useState<MemberDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchDetail = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.get(`/users/${id}`);
      setMember(res.data);
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Failed to load member');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (id) fetchDetail();
  }, [id]);

  const handleResend = async () => {
    setResending(true);
    try {
      await apiClient.post(`/users/${id}/invitations/resend`);
      message.success('Invitation resent successfully');
      fetchDetail();
    } catch (err: any) {
      message.error(err?.response?.data?.message || 'Failed to resend invitation');
    } finally {
      setResending(false);
    }
  };

  if (loading) return <Spin style={{ display: 'block', marginTop: 100 }} size="large" />;
  if (error || !member) return <Result status="error" title={error || 'Member not found'} />;

  const canResend = member.status === 'INVITE_SENT' || member.status === 'INACTIVE';

  return (
    <div style={{ padding: 24 }}>
      <Space style={{ marginBottom: 16 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/platform-members')}>
          Back
        </Button>
      </Space>

      <Card title={`Member: ${member.userNo}`} extra={<Tag color={STATUS_COLORS[member.status] || 'default'}>{member.status}</Tag>}>
        <Descriptions column={2} bordered size="small">
          <Descriptions.Item label="User No">{member.userNo}</Descriptions.Item>
          <Descriptions.Item label="Email">{member.email}</Descriptions.Item>
          <Descriptions.Item label="Primary Role">{member.role}</Descriptions.Item>
          <Descriptions.Item label="All Roles">{member.roles.join(', ') || '-'}</Descriptions.Item>
          <Descriptions.Item label="Status">
            <Tag color={STATUS_COLORS[member.status] || 'default'}>{member.status}</Tag>
          </Descriptions.Item>
          <Descriptions.Item label="Created">{new Date(member.createdAt).toLocaleString()}</Descriptions.Item>
          <Descriptions.Item label="Updated">{new Date(member.updatedAt).toLocaleString()}</Descriptions.Item>
          <Descriptions.Item label="Last Login">{member.lastLoginAt ? new Date(member.lastLoginAt).toLocaleString() : 'Never'}</Descriptions.Item>
        </Descriptions>
      </Card>

      {member.latestInvitation && (
        <Card title="Invitation Status" style={{ marginTop: 16 }}>
          <Descriptions column={2} bordered size="small">
            <Descriptions.Item label="Invite Status">
              <Tag color={member.latestInvitation.inviteStatus === 'PENDING' ? 'blue' : member.latestInvitation.inviteStatus === 'USED' ? 'green' : 'red'}>
                {member.latestInvitation.inviteStatus}
              </Tag>
            </Descriptions.Item>
            <Descriptions.Item label="Expires At">
              {new Date(member.latestInvitation.inviteExpiresAt).toLocaleString()}
            </Descriptions.Item>
          </Descriptions>
        </Card>
      )}

      {canResend && (
        <Card title="Actions" style={{ marginTop: 16 }}>
          <Button
            type="primary"
            icon={<MailOutlined />}
            loading={resending}
            onClick={handleResend}
          >
            Resend Invitation
          </Button>
        </Card>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify frontend compiles**

Run: `cd Exchange_js/admin-web && npx tsc --noEmit 2>&1 | tail -10`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add admin-web/src/pages/PlatformMemberDetailPage.tsx
git commit -m "feat(admin-web): rewrite PlatformMemberDetailPage with invitation status and resend"
```

---

## Task 11: End-to-End Verification

**Files:**
- None (verification only)

- [ ] **Step 1: Full TypeScript check (backend + frontend)**

Run: `cd Exchange_js && npx tsc --noEmit --pretty 2>&1 | tail -10`
Run: `cd Exchange_js/admin-web && npx tsc --noEmit 2>&1 | tail -10`
Expected: 0 errors on both

- [ ] **Step 2: Start full stack**

Run: `cd Exchange_js && npm run dev:start`
Expected: All services start (API :3500, Admin :3501)

- [ ] **Step 3: Verify API endpoint is reachable**

Run: `curl -s http://localhost:3500/api-json | python3 -c "import sys,json; d=json.load(sys.stdin); print('POST /users' if '/users' in str(d.get('paths',{})) else 'MISSING')"`
Expected: `POST /users`

- [ ] **Step 4: Verify admin-web loads**

Open `http://localhost:3501` and navigate to Platform Members page.
Expected: Page renders with table (may be empty if no users exist).

- [ ] **Step 5: Stop dev server and final commit if needed**

Run: `cd Exchange_js && npm run dev:stop`

```bash
git add -A
git commit -m "fix: address any remaining issues from admin invite v1 redesign"
```
