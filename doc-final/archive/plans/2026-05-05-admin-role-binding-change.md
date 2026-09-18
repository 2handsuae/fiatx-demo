# Admin Role Binding Change — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a dedicated 3-layer approval workflow for changing admin user role bindings, replacing the generic Change Ticket path.

**Architecture:** Layer 2 thin approval handler extends `ApprovalHandlerBase` → emits secondary event `workflow.admin-role-binding.decided` → Layer 3 workflow orchestrator subscribes and executes role change via `AccessControlService.replaceUserRoles()`. New `AdminRoleChangeRequest` entity holds before/after role snapshots during approval wait.

**Tech Stack:** NestJS, Prisma (SQLite), class-validator, EventEmitter2, Jest

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `prisma/schema.prisma` | Modify | Add `AdminRoleChangeRequest` model + User reverse relation |
| `src/modules/governance/approvals/constants/approval.constants.ts` | Modify | Add `ADMIN_ROLE_BINDING_CHANGE_APPROVAL` + policy |
| `src/modules/audit-logging/constants/audit-actions.constant.ts` | Modify | Add `ADMIN_ROLE_CHANGE_REQUEST` to `AuditEntityTypes` |
| `src/modules/governance/approvals/approvals.service.ts` | Modify | Add to `hasDedicatedAuditService()` guard |
| `src/modules/identity/access-control/rbac.catalog.ts` | Modify | Populate `HARD_MUTEX_ROLE_PAIRS` with 3 pairs |
| `src/modules/identity/users/dto/create-role-change-request.dto.ts` | Create | DTO for POST + query |
| `src/modules/identity/users/admin-role-binding-change-approval.service.ts` | Create | Layer 2 thin handler |
| `src/modules/identity/users/admin-role-binding-change-workflow.service.ts` | Create | Layer 3 orchestrator |
| `src/modules/identity/users/admin-role-change-request.controller.ts` | Create | REST controller |
| `src/modules/identity/users/users.module.ts` | Modify | Register new services + controller |
| `src/modules/identity/access-control/access-control.controller.ts` | Modify | Remove PUT route |
| `src/modules/identity/access-control/access-control.service.ts` | Modify | Remove `executeGovernedRoleBindingChange()` |
| `src/modules/identity/governed-execution/governed-execution.listener.ts` | Modify | Remove `ADMIN_ROLE_BINDING_CHANGE` case |
| `src/modules/governance/change-tickets/change-tickets.service.ts` | Modify | Remove `createAdminRoleBindingChangeTicket()` |
| `src/modules/identity/users/admin-role-binding-change-workflow.service.spec.ts` | Create | Unit tests |

---

### Task 1: Prisma Schema — Add AdminRoleChangeRequest Model

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add AdminRoleChangeRequest model and User reverse relation**

Open `prisma/schema.prisma`. In the `User` model (line 10–36), add the reverse relation field after the `adminInvitations` line:

```prisma
  roleChangeRequests  AdminRoleChangeRequest[] @relation("roleChangeTarget")
```

Then, after the `AdminUserInvitation` model (after line 116), add the new model:

```prisma
model AdminRoleChangeRequest {
  id                String    @id @default(uuid())
  requestNo         String    @unique @default("TEMP")
  targetUserId      String
  currentRoleCodes  String
  proposedRoleCodes String
  changeReason      String
  status            String    @default("PENDING_APPROVAL")
  approvalCaseId    String?
  approvalCaseNo    String?
  requestedByUserId String
  executedAt        DateTime?
  failureReason     String?
  createdAt         DateTime  @default(now())
  updatedAt         DateTime  @updatedAt
  deletedAt         DateTime?

  targetUser        User      @relation("roleChangeTarget", fields: [targetUserId], references: [id])

  @@index([targetUserId])
  @@index([approvalCaseId])
  @@index([status])
  @@index([requestedByUserId])
  @@map("admin_role_change_requests")
}
```

- [ ] **Step 2: Generate and apply migration**

Run:
```bash
cd Exchange_js && npx prisma migrate dev --name add_admin_role_change_request
```

Expected: Migration applies successfully, `admin_role_change_requests` table created.

- [ ] **Step 3: Verify Prisma client generation**

Run:
```bash
cd Exchange_js && npx prisma generate
```

Expected: Client generates without errors.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "$(cat <<'EOF'
feat(schema): add AdminRoleChangeRequest model for role binding workflow
EOF
)"
```

---

### Task 2: Constants — Approval Type, Policy, SoD Rules, and Entity Type

**Files:**
- Modify: `src/modules/governance/approvals/constants/approval.constants.ts`
- Modify: `src/modules/audit-logging/constants/audit-actions.constant.ts`
- Modify: `src/modules/governance/approvals/approvals.service.ts`
- Modify: `src/modules/identity/access-control/rbac.catalog.ts`

- [ ] **Step 1: Add ADMIN_ROLE_BINDING_CHANGE_APPROVAL to ApprovalActionTypes**

In `src/modules/governance/approvals/constants/approval.constants.ts`, add after the `ADMIN_INVITE_APPROVAL` line (line 43):

```typescript
  ADMIN_ROLE_BINDING_CHANGE_APPROVAL: 'ADMIN_ROLE_BINDING_CHANGE_APPROVAL',
```

- [ ] **Step 2: Add approval policy for role binding change**

In the same file, add after the `ADMIN_INVITE_APPROVAL` policy block (after line 226):

```typescript
  [ApprovalActionTypes.ADMIN_ROLE_BINDING_CHANGE_APPROVAL]: {
    riskLevel: ApprovalRiskLevels.HIGH,
    checkerRoles: ['CISO'],
    timeoutHours: 48,
    allowCancel: true,
    allowRetry: false,
  },
```

- [ ] **Step 3: Add ADMIN_ROLE_CHANGE_REQUEST to AuditEntityTypes**

In `src/modules/audit-logging/constants/audit-actions.constant.ts`, add to the `AuditEntityTypes` object (after the existing `ACCESS_CONTROL` entry):

```typescript
  ADMIN_ROLE_CHANGE_REQUEST: 'ADMIN_ROLE_CHANGE_REQUEST',
```

- [ ] **Step 4: Add ADMIN_ROLE_BINDING_CHANGE to hasDedicatedAuditService guard**

In `src/modules/governance/approvals/approvals.service.ts`, find the `hasDedicatedAuditService` method (line 371). Add `AuditBusinessWorkflowTypes.ADMIN_ROLE_BINDING_CHANGE` to the `DEDICATED` array:

Change:
```typescript
    const DEDICATED: string[] = [
      AuditBusinessWorkflowTypes.AUDIT_EVIDENCE_EXPORT,
      AuditBusinessWorkflowTypes.ADMIN_INVITE,
    ];
```

To:
```typescript
    const DEDICATED: string[] = [
      AuditBusinessWorkflowTypes.AUDIT_EVIDENCE_EXPORT,
      AuditBusinessWorkflowTypes.ADMIN_INVITE,
      AuditBusinessWorkflowTypes.ADMIN_ROLE_BINDING_CHANGE,
    ];
```

- [ ] **Step 5: Populate HARD_MUTEX_ROLE_PAIRS**

In `src/modules/identity/access-control/rbac.catalog.ts`, change (line 184):

```typescript
export const HARD_MUTEX_ROLE_PAIRS: Array<[string, string]> = [];
```

To:
```typescript
export const HARD_MUTEX_ROLE_PAIRS: Array<[string, string]> = [
  ['CISO', 'MLRO'],
  ['MLRO', 'OPS_OFFICER'],
  ['CISO', 'OPS_OFFICER'],
];
```

- [ ] **Step 6: Verify TypeScript compiles**

Run:
```bash
cd Exchange_js && npx tsc --noEmit 2>&1 | head -20
```

Expected: No new errors.

- [ ] **Step 7: Commit**

```bash
git add src/modules/governance/approvals/constants/approval.constants.ts \
        src/modules/audit-logging/constants/audit-actions.constant.ts \
        src/modules/governance/approvals/approvals.service.ts \
        src/modules/identity/access-control/rbac.catalog.ts
git commit -m "$(cat <<'EOF'
feat(constants): add role binding change approval type, policy, entity type, and SoD rules
EOF
)"
```

---

### Task 3: DTO — CreateRoleChangeRequestDto and RoleChangeRequestQueryDto

**Files:**
- Create: `src/modules/identity/users/dto/create-role-change-request.dto.ts`

- [ ] **Step 1: Create DTO file**

```typescript
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

export class CreateRoleChangeRequestDto {
  @IsUUID()
  targetUserId!: string;

  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  @ArrayMinSize(1)
  roleCodes!: string[];

  @IsString()
  @IsNotEmpty()
  changeReason!: string;

  @IsOptional()
  @IsString()
  traceId?: string;
}

export class RoleChangeRequestQueryDto {
  @IsOptional()
  @IsString()
  targetUserId?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run:
```bash
cd Exchange_js && npx tsc --noEmit 2>&1 | head -20
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/modules/identity/users/dto/create-role-change-request.dto.ts
git commit -m "$(cat <<'EOF'
feat(dto): add CreateRoleChangeRequestDto and RoleChangeRequestQueryDto
EOF
)"
```

---

### Task 4: Layer 2 — AdminRoleBindingChangeApprovalService

**Files:**
- Create: `src/modules/identity/users/admin-role-binding-change-approval.service.ts`

- [ ] **Step 1: Create thin approval handler**

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
export class AdminRoleBindingChangeApprovalService extends ApprovalHandlerBase {
  readonly actionType = ApprovalActionTypes.ADMIN_ROLE_BINDING_CHANGE_APPROVAL;
  readonly workflowType = AuditBusinessWorkflowTypes.ADMIN_ROLE_BINDING_CHANGE;
  readonly auditActions = {
    granted: AuditGovernanceActions.ADMIN_ROLE_BINDING.APPROVAL_GRANTED,
    declined: AuditGovernanceActions.ADMIN_ROLE_BINDING.APPROVAL_DECLINED,
    cancelled: AuditGovernanceActions.ADMIN_ROLE_BINDING.APPROVAL_CANCELLED,
  };
  readonly entityType = AuditEntityTypes.ACCESS_CONTROL;

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

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/modules/identity/users/admin-role-binding-change-approval.service.ts
git commit -m "$(cat <<'EOF'
feat(approval): add Layer 2 thin handler for admin role binding change
EOF
)"
```

---

### Task 5: Layer 3 — AdminRoleBindingChangeWorkflowService

**Files:**
- Create: `src/modules/identity/users/admin-role-binding-change-workflow.service.ts`

- [ ] **Step 1: Write the failing test**

Create `src/modules/identity/users/admin-role-binding-change-workflow.service.spec.ts`:

```typescript
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AdminRoleBindingChangeWorkflowService } from './admin-role-binding-change-workflow.service';
import { ApprovalDecidedEvent } from '../../governance/approvals/approval-handler.base';

describe('AdminRoleBindingChangeWorkflowService', () => {
  let prisma: any;
  let accessControlService: any;
  let approvalsService: any;
  let auditLogsService: any;
  let service: AdminRoleBindingChangeWorkflowService;

  const actor = {
    actorType: 'ADMIN' as const,
    userId: 'admin-1',
    userNo: 'USR-A001',
    role: 'CISO',
    roleCodes: ['CISO'],
  };

  beforeEach(() => {
    prisma = {
      user: {
        findFirst: jest.fn(),
      },
      adminRoleChangeRequest: {
        create: jest.fn(),
        update: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
      },
    };

    accessControlService = {
      getUserRoleCodes: jest.fn(),
      validateHardMutex: jest.fn(),
      replaceUserRoles: jest.fn(),
    };

    approvalsService = {
      createAndSubmit: jest.fn(),
      markExecutionResult: jest.fn().mockResolvedValue(undefined),
    };

    auditLogsService = {
      recordByActor: jest.fn().mockResolvedValue(undefined),
    };

    service = new AdminRoleBindingChangeWorkflowService(
      prisma,
      accessControlService,
      approvalsService,
      auditLogsService,
    );
  });

  describe('createRoleChangeRequest', () => {
    it('rejects self-change', async () => {
      await expect(
        service.createRoleChangeRequest(
          { targetUserId: 'admin-1', roleCodes: ['MLRO'], changeReason: 'test' },
          actor,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects when target user not found', async () => {
      prisma.user.findFirst.mockResolvedValue(null);

      await expect(
        service.createRoleChangeRequest(
          { targetUserId: 'user-2', roleCodes: ['MLRO'], changeReason: 'test' },
          actor,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('creates request, submits approval, writes audit on success', async () => {
      prisma.user.findFirst.mockResolvedValue({ id: 'user-2', userNo: 'USR-U002' });
      accessControlService.getUserRoleCodes.mockResolvedValue(['COMPLIANCE_OFFICER']);
      prisma.adminRoleChangeRequest.create.mockResolvedValue({
        id: 'req-1',
        requestNo: 'RCR-2605050001',
        status: 'PENDING_APPROVAL',
      });
      approvalsService.createAndSubmit.mockResolvedValue({
        id: 'apr-1',
        approvalNo: 'APR2605050001',
        status: 'PENDING',
      });
      prisma.adminRoleChangeRequest.update.mockResolvedValue({
        id: 'req-1',
        requestNo: 'RCR-2605050001',
        status: 'PENDING_APPROVAL',
        approvalCaseId: 'apr-1',
        approvalCaseNo: 'APR2605050001',
      });

      const result = await service.createRoleChangeRequest(
        { targetUserId: 'user-2', roleCodes: ['MLRO'], changeReason: 'promotion' },
        actor,
      );

      expect(result.status).toBe('PENDING_APPROVAL');
      expect(approvalsService.createAndSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          actionType: 'ADMIN_ROLE_BINDING_CHANGE_APPROVAL',
          entityRef: 'req-1',
          workflowType: 'ADMIN_ROLE_BINDING_CHANGE',
        }),
        expect.objectContaining({ reason: 'promotion' }),
        actor,
      );
      expect(auditLogsService.recordByActor).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'CHANGE_REQUESTED',
          entityType: 'ACCESS_CONTROL',
        }),
        expect.any(Object),
      );
    });
  });

  describe('handleApprovalDecided — APPROVED', () => {
    it('executes role change and writes CHANGE_APPLIED audit', async () => {
      const event: ApprovalDecidedEvent = {
        decision: 'APPROVED',
        actionType: 'ADMIN_ROLE_BINDING_CHANGE_APPROVAL',
        entityRef: 'req-1',
        approvalId: 'apr-1',
        approvalNo: 'APR-1',
        traceId: 'trace-1',
        workflowType: 'ADMIN_ROLE_BINDING_CHANGE',
        metadata: {},
      };

      prisma.adminRoleChangeRequest.findFirst.mockResolvedValue({
        id: 'req-1',
        requestNo: 'RCR-1',
        targetUserId: 'user-2',
        proposedRoleCodes: '["MLRO"]',
        status: 'PENDING_APPROVAL',
        approvalCaseId: 'apr-1',
      });
      prisma.user.findFirst.mockResolvedValue({ id: 'user-2', userNo: 'USR-U002' });
      accessControlService.replaceUserRoles.mockResolvedValue({
        userId: 'user-2',
        roles: ['MLRO'],
      });

      await service.handleApprovalDecided(event);

      expect(accessControlService.replaceUserRoles).toHaveBeenCalledWith(
        'user-2',
        ['MLRO'],
        expect.objectContaining({ actorId: 'SYSTEM' }),
        expect.objectContaining({ workflowType: 'ADMIN_ROLE_BINDING_CHANGE' }),
      );
      expect(prisma.adminRoleChangeRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'APPROVED' }),
        }),
      );
      expect(auditLogsService.recordByActor).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'CHANGE_APPLIED' }),
        expect.any(Object),
      );
      expect(approvalsService.markExecutionResult).toHaveBeenCalledWith(
        'apr-1', true, expect.any(Object), expect.any(String),
      );
    });

    it('marks FAILED and writes CHANGE_APPLY_FAILED on execution error', async () => {
      const event: ApprovalDecidedEvent = {
        decision: 'APPROVED',
        actionType: 'ADMIN_ROLE_BINDING_CHANGE_APPROVAL',
        entityRef: 'req-1',
        approvalId: 'apr-1',
        approvalNo: 'APR-1',
        traceId: 'trace-1',
        workflowType: 'ADMIN_ROLE_BINDING_CHANGE',
        metadata: {},
      };

      prisma.adminRoleChangeRequest.findFirst.mockResolvedValue({
        id: 'req-1',
        requestNo: 'RCR-1',
        targetUserId: 'user-2',
        proposedRoleCodes: '["MLRO","CISO"]',
        status: 'PENDING_APPROVAL',
        approvalCaseId: 'apr-1',
      });
      prisma.user.findFirst.mockResolvedValue({ id: 'user-2', userNo: 'USR-U002' });
      accessControlService.replaceUserRoles.mockRejectedValue(
        new BadRequestException('Role CISO and MLRO cannot be assigned to one user.'),
      );

      await service.handleApprovalDecided(event);

      expect(prisma.adminRoleChangeRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'FAILED',
            failureReason: expect.stringContaining('cannot be assigned'),
          }),
        }),
      );
      expect(auditLogsService.recordByActor).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'CHANGE_APPLY_FAILED' }),
        expect.any(Object),
      );
      expect(approvalsService.markExecutionResult).toHaveBeenCalledWith(
        'apr-1', false, expect.any(Object), expect.any(String),
      );
    });
  });

  describe('handleApprovalDecided — DECLINED', () => {
    it('updates request status to REJECTED', async () => {
      const event: ApprovalDecidedEvent = {
        decision: 'DECLINED',
        actionType: 'ADMIN_ROLE_BINDING_CHANGE_APPROVAL',
        entityRef: 'req-1',
        approvalId: 'apr-1',
        approvalNo: 'APR-1',
        traceId: 'trace-1',
        workflowType: 'ADMIN_ROLE_BINDING_CHANGE',
        metadata: {},
      };

      prisma.adminRoleChangeRequest.findFirst.mockResolvedValue({
        id: 'req-1',
        status: 'PENDING_APPROVAL',
      });

      await service.handleApprovalDecided(event);

      expect(prisma.adminRoleChangeRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'REJECTED' }),
        }),
      );
    });
  });

  describe('handleApprovalDecided — EXPIRED', () => {
    it('updates request status to EXPIRED', async () => {
      const event: ApprovalDecidedEvent = {
        decision: 'EXPIRED',
        actionType: 'ADMIN_ROLE_BINDING_CHANGE_APPROVAL',
        entityRef: 'req-1',
        approvalId: 'apr-1',
        approvalNo: 'APR-1',
        traceId: 'trace-1',
        workflowType: 'ADMIN_ROLE_BINDING_CHANGE',
        metadata: {},
      };

      prisma.adminRoleChangeRequest.findFirst.mockResolvedValue({
        id: 'req-1',
        status: 'PENDING_APPROVAL',
      });

      await service.handleApprovalDecided(event);

      expect(prisma.adminRoleChangeRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'EXPIRED' }),
        }),
      );
    });
  });

  describe('findRoleChangeRequests', () => {
    it('returns paginated results', async () => {
      prisma.adminRoleChangeRequest.findMany.mockResolvedValue([]);
      prisma.adminRoleChangeRequest.count.mockResolvedValue(0);

      const result = await service.findRoleChangeRequests({ page: 1, limit: 20 });

      expect(result.items).toEqual([]);
      expect(result.total).toBe(0);
    });
  });

  describe('findRoleChangeRequest', () => {
    it('throws NotFoundException when not found', async () => {
      prisma.adminRoleChangeRequest.findFirst.mockResolvedValue(null);

      await expect(service.findRoleChangeRequest('bad-id')).rejects.toThrow(NotFoundException);
    });

    it('returns the request when found', async () => {
      prisma.adminRoleChangeRequest.findFirst.mockResolvedValue({
        id: 'req-1',
        requestNo: 'RCR-1',
      });

      const result = await service.findRoleChangeRequest('req-1');
      expect(result.id).toBe('req-1');
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
cd Exchange_js && npx jest --testPathPatterns="admin-role-binding-change-workflow" --no-coverage 2>&1 | tail -5
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create the workflow service**

Create `src/modules/identity/users/admin-role-binding-change-workflow.service.ts`:

```typescript
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { randomUUID } from 'crypto';
import { generateReferenceNo } from '../../../common/utils/no-generator.util';
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
import { CreateRoleChangeRequestDto, RoleChangeRequestQueryDto } from './dto/create-role-change-request.dto';

const SECONDARY_EVENT = 'workflow.admin-role-binding-change.decided';

@Injectable()
export class AdminRoleBindingChangeWorkflowService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessControlService: AccessControlService,
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

  async createRoleChangeRequest(
    dto: CreateRoleChangeRequestDto,
    actor: ApprovalActorContext,
  ) {
    if (dto.targetUserId === actor.userId) {
      throw new BadRequestException('Cannot change your own role bindings');
    }

    const targetUser = await this.prisma.user.findFirst({
      where: { id: dto.targetUserId, deletedAt: null },
      select: { id: true, userNo: true },
    });
    if (!targetUser) {
      throw new NotFoundException('Target user not found');
    }

    const currentRoleCodes = await this.accessControlService.getUserRoleCodes(
      dto.targetUserId,
    );

    this.accessControlService.validateHardMutex(dto.roleCodes);

    const traceId = dto.traceId || randomUUID();
    const requestNo = generateReferenceNo('RCR-');

    const request = await (this.prisma as any).adminRoleChangeRequest.create({
      data: {
        requestNo,
        targetUserId: dto.targetUserId,
        currentRoleCodes: JSON.stringify(currentRoleCodes),
        proposedRoleCodes: JSON.stringify(dto.roleCodes),
        changeReason: dto.changeReason,
        status: 'PENDING_APPROVAL',
        requestedByUserId: actor.userId,
      },
    });

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
      },
      { reason: dto.changeReason, traceId },
      actor,
    );

    const updated = await (this.prisma as any).adminRoleChangeRequest.update({
      where: { id: request.id },
      data: {
        approvalCaseId: approvalCase.id,
        approvalCaseNo: approvalCase.approvalNo,
      },
    });

    await this.auditLogsService.recordByActor(
      {
        action: AuditGovernanceActions.ADMIN_ROLE_BINDING.CHANGE_REQUESTED,
        entityType: AuditEntityTypes.ACCESS_CONTROL,
        entityId: request.id,
        entityNo: requestNo,
        workflowType: AuditBusinessWorkflowTypes.ADMIN_ROLE_BINDING_CHANGE,
        traceId,
        result: AuditResult.SUCCESS,
        metadata: {
          targetUserId: targetUser.id,
          targetUserNo: targetUser.userNo,
          currentRoleCodes,
          proposedRoleCodes: dto.roleCodes,
          approvalNo: approvalCase.approvalNo,
        },
        requestId: `ADMIN_ROLE_BINDING_CHANGE_REQUESTED_${requestNo}`,
        sourcePlatform: 'ADMIN_API',
      },
      this.toAuditActor(actor),
    );

    return updated;
  }

  async findRoleChangeRequests(query: RoleChangeRequestQueryDto) {
    const page = query.page || 1;
    const limit = query.limit || 20;
    const where: any = { deletedAt: null };
    if (query.targetUserId) where.targetUserId = query.targetUserId;
    if (query.status) where.status = query.status;

    const [items, total] = await Promise.all([
      (this.prisma as any).adminRoleChangeRequest.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: { targetUser: { select: { id: true, userNo: true, email: true } } },
      }),
      (this.prisma as any).adminRoleChangeRequest.count({ where }),
    ]);

    return { items, total, page, limit };
  }

  async findRoleChangeRequest(id: string) {
    const request = await (this.prisma as any).adminRoleChangeRequest.findFirst({
      where: { id, deletedAt: null },
      include: { targetUser: { select: { id: true, userNo: true, email: true } } },
    });
    if (!request) {
      throw new NotFoundException('Role change request not found');
    }
    return request;
  }

  @OnEvent(SECONDARY_EVENT, { async: true })
  async handleApprovalDecided(event: ApprovalDecidedEvent) {
    switch (event.decision) {
      case 'APPROVED':
        return this.executeRoleChange(event);
      case 'DECLINED':
        return this.executeTermination(event, 'REJECTED');
      case 'CANCELLED':
        return this.executeTermination(event, 'CANCELLED');
      case 'EXPIRED':
        return this.executeTermination(event, 'EXPIRED');
    }
  }

  private async executeRoleChange(event: ApprovalDecidedEvent) {
    const request = await (this.prisma as any).adminRoleChangeRequest.findFirst({
      where: { id: event.entityRef },
    });
    if (!request) return;

    const targetUser = await this.prisma.user.findFirst({
      where: { id: request.targetUserId, deletedAt: null },
      select: { id: true, userNo: true },
    });
    if (!targetUser) return;

    const proposedRoleCodes: string[] = JSON.parse(request.proposedRoleCodes);
    const systemActor = {
      actorId: event.decisionByUserId || 'SYSTEM',
      actorNo: event.decisionByUserNo || undefined,
      actorRole: event.decisionByRole || 'SYSTEM',
    };

    try {
      await this.accessControlService.replaceUserRoles(
        request.targetUserId,
        proposedRoleCodes,
        systemActor,
        {
          workflowType: AuditBusinessWorkflowTypes.ADMIN_ROLE_BINDING_CHANGE,
          traceId: event.traceId,
        },
      );

      await (this.prisma as any).adminRoleChangeRequest.update({
        where: { id: request.id },
        data: { status: 'APPROVED', executedAt: new Date() },
      });

      await this.auditLogsService.recordByActor(
        {
          action: AuditGovernanceActions.ADMIN_ROLE_BINDING.CHANGE_APPLIED,
          entityType: AuditEntityTypes.ACCESS_CONTROL,
          entityId: request.id,
          entityNo: request.requestNo,
          workflowType: AuditBusinessWorkflowTypes.ADMIN_ROLE_BINDING_CHANGE,
          traceId: event.traceId,
          result: AuditResult.SUCCESS,
          metadata: {
            targetUserId: targetUser.id,
            targetUserNo: targetUser.userNo,
            appliedRoleCodes: proposedRoleCodes,
            approvalId: event.approvalId,
            approvalNo: event.approvalNo,
          },
          requestId: `ADMIN_ROLE_BINDING_CHANGE_APPLIED_${request.requestNo}`,
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
        'Role binding change applied successfully',
      );
    } catch (error) {
      const failureReason =
        error instanceof Error ? error.message : 'Unknown execution error';

      await (this.prisma as any).adminRoleChangeRequest.update({
        where: { id: request.id },
        data: { status: 'FAILED', failureReason },
      });

      await this.auditLogsService.recordByActor(
        {
          action: AuditGovernanceActions.ADMIN_ROLE_BINDING.CHANGE_APPLY_FAILED,
          entityType: AuditEntityTypes.ACCESS_CONTROL,
          entityId: request.id,
          entityNo: request.requestNo,
          workflowType: AuditBusinessWorkflowTypes.ADMIN_ROLE_BINDING_CHANGE,
          traceId: event.traceId,
          result: AuditResult.FAILED,
          reason: failureReason,
          metadata: {
            targetUserId: request.targetUserId,
            failureReason,
          },
          requestId: `ADMIN_ROLE_BINDING_CHANGE_APPLY_FAILED_${request.requestNo}`,
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
          failureReason,
        )
        .catch(() => undefined);
    }
  }

  private async executeTermination(
    event: ApprovalDecidedEvent,
    status: 'REJECTED' | 'CANCELLED' | 'EXPIRED',
  ) {
    const request = await (this.prisma as any).adminRoleChangeRequest.findFirst({
      where: { id: event.entityRef },
    });
    if (!request) return;

    await (this.prisma as any).adminRoleChangeRequest.update({
      where: { id: request.id },
      data: { status },
    });
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
cd Exchange_js && npx jest --testPathPatterns="admin-role-binding-change-workflow" --no-coverage 2>&1 | tail -15
```

Expected: All 8 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/identity/users/admin-role-binding-change-workflow.service.ts \
        src/modules/identity/users/admin-role-binding-change-workflow.service.spec.ts
git commit -m "$(cat <<'EOF'
feat(workflow): add Layer 3 orchestrator for admin role binding change
EOF
)"
```

---

### Task 6: Controller — AdminRoleChangeRequestController

**Files:**
- Create: `src/modules/identity/users/admin-role-change-request.controller.ts`

- [ ] **Step 1: Create the controller**

```typescript
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
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminPermissionGuard } from '../access-control/admin-permission.guard';
import { ApprovalActorContext } from '../../governance/approvals/constants/approval.constants';
import { AdminRoleBindingChangeWorkflowService } from './admin-role-binding-change-workflow.service';
import {
  CreateRoleChangeRequestDto,
  RoleChangeRequestQueryDto,
} from './dto/create-role-change-request.dto';

@ApiTags('Admin - IAM - Role Change Requests')
@Controller('admin/iam/role-change-requests')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
@ApiBearerAuth()
export class AdminRoleChangeRequestController {
  constructor(
    private readonly workflowService: AdminRoleBindingChangeWorkflowService,
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

  private ensureAdmin(req: any) {
    if (req.user?.type !== 'ADMIN') {
      throw new ForbiddenException('Admin token required');
    }
  }

  @Post()
  @ApiOperation({ summary: 'Create admin role binding change request' })
  createRoleChangeRequest(
    @Req() req: any,
    @Body(new ValidationPipe({ transform: true })) body: CreateRoleChangeRequestDto,
  ) {
    this.ensureAdmin(req);
    return this.workflowService.createRoleChangeRequest(body, this.buildAdminActor(req));
  }

  @Get()
  @ApiOperation({ summary: 'List admin role binding change requests' })
  findRoleChangeRequests(
    @Req() req: any,
    @Query(new ValidationPipe({ transform: true })) query: RoleChangeRequestQueryDto,
  ) {
    this.ensureAdmin(req);
    return this.workflowService.findRoleChangeRequests(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get admin role binding change request detail' })
  findRoleChangeRequest(
    @Req() req: any,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    this.ensureAdmin(req);
    return this.workflowService.findRoleChangeRequest(id);
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run:
```bash
cd Exchange_js && npx tsc --noEmit 2>&1 | head -20
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/modules/identity/users/admin-role-change-request.controller.ts
git commit -m "$(cat <<'EOF'
feat(controller): add AdminRoleChangeRequestController for role binding workflow
EOF
)"
```

---

### Task 7: Module Registration

**Files:**
- Modify: `src/modules/identity/users/users.module.ts`

- [ ] **Step 1: Register new services and controller**

Update `src/modules/identity/users/users.module.ts`:

Add imports at the top:
```typescript
import { AdminRoleBindingChangeApprovalService } from './admin-role-binding-change-approval.service';
import { AdminRoleBindingChangeWorkflowService } from './admin-role-binding-change-workflow.service';
import { AdminRoleChangeRequestController } from './admin-role-change-request.controller';
```

Add to `providers` array:
```typescript
    AdminRoleBindingChangeApprovalService,
    AdminRoleBindingChangeWorkflowService,
```

Add to `controllers` array:
```typescript
  controllers: [UsersController, AdminRoleChangeRequestController],
```

Full file should look like:
```typescript
import { Module, forwardRef } from '@nestjs/common';
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
import { UsersController } from './users.controller';

@Module({
  imports: [PrismaModule, AccessControlModule, forwardRef(() => ApprovalsModule)],
  providers: [
    UsersService,
    UsersDomainService,
    AdminInvitationsService,
    AdminInviteApprovalService,
    AdminInviteWorkflowService,
    AdminRoleBindingChangeApprovalService,
    AdminRoleBindingChangeWorkflowService,
  ],
  controllers: [UsersController, AdminRoleChangeRequestController],
  exports: [UsersService, UsersDomainService, AdminInvitationsService],
})
export class UsersModule {}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run:
```bash
cd Exchange_js && npx tsc --noEmit 2>&1 | head -20
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/modules/identity/users/users.module.ts
git commit -m "$(cat <<'EOF'
feat(module): register role binding change services and controller in UsersModule
EOF
)"
```

---

### Task 8: Old Code Cleanup — Remove Change Ticket Path

**Files:**
- Modify: `src/modules/identity/access-control/access-control.controller.ts`
- Modify: `src/modules/identity/access-control/access-control.service.ts`
- Modify: `src/modules/identity/governed-execution/governed-execution.listener.ts`
- Modify: `src/modules/governance/change-tickets/change-tickets.service.ts`

- [ ] **Step 1: Remove PUT route from AccessControlController**

In `src/modules/identity/access-control/access-control.controller.ts`, remove the entire `replaceUserRoles` method (lines 77–94):

```typescript
  @Put('users/:id/roles')
  @RequirePermissions(buildPermissionCode('PUT', '/admin/iam/users/:id/roles'))
  @ApiOperation({ summary: 'Create role binding change ticket' })
  replaceUserRoles(
    @Req() req: any,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ValidationPipe({ transform: true })) body: UpdateUserRolesDto,
  ) {
    this.ensureAdmin(req);
    return this.changeTicketsService.createAdminRoleBindingChangeTicket(
      id,
      {
        roleCodes: body.roleCodes,
        changeReason: body.changeReason,
      },
      this.buildAdminActor(req),
    );
  }
```

Also remove unused imports: `Put`, `Body`, `ValidationPipe`, `UpdateUserRolesDto`, and `ChangeTicketsService` (from constructor DI and import statement). Remove the `ChangeTicketsService` from the constructor:

```typescript
  constructor(
    private readonly accessControlService: AccessControlService,
  ) {}
```

Remove unused imports from the import block:
- Remove `Put` and `Body` from `@nestjs/common`
- Remove `ValidationPipe` from `@nestjs/common`
- Remove `UpdateUserRolesDto` import
- Remove `ChangeTicketsService` import
- Remove `ApprovalActorContext` import (only used in buildAdminActor which served the removed route)
- Remove the `buildAdminActor` method (only called from removed route)

The resulting controller should be:

```typescript
import {
  Controller,
  ForbiddenException,
  Get,
  Param,
  ParseUUIDPipe,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AccessControlService } from './access-control.service';
import { AdminPermissionGuard } from './admin-permission.guard';
import { RequirePermissions } from './require-permissions.decorator';
import { buildPermissionCode } from './permission-code.util';

@ApiTags('Admin - IAM')
@Controller('admin/iam')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
@ApiBearerAuth()
export class AccessControlController {
  constructor(
    private readonly accessControlService: AccessControlService,
  ) {}

  private ensureAdmin(req: any) {
    if (req.user?.type !== 'ADMIN') {
      throw new ForbiddenException('Admin token required');
    }
  }

  @Get('roles')
  @RequirePermissions(buildPermissionCode('GET', '/admin/iam/roles'))
  @ApiOperation({ summary: 'List fixed role catalog with bound permissions' })
  listRoles(@Req() req: any) {
    this.ensureAdmin(req);
    return this.accessControlService.listRoles();
  }

  @Get('permissions')
  @RequirePermissions(buildPermissionCode('GET', '/admin/iam/permissions'))
  @ApiOperation({ summary: 'List fixed permission catalog' })
  listPermissions(@Req() req: any) {
    this.ensureAdmin(req);
    return this.accessControlService.listPermissions();
  }

  @Get('users/:id/roles')
  @RequirePermissions(buildPermissionCode('GET', '/admin/iam/users/:id/roles'))
  @ApiOperation({ summary: 'Get one user role bindings' })
  async getUserRoles(@Req() req: any, @Param('id', new ParseUUIDPipe()) id: string) {
    this.ensureAdmin(req);
    const roles = await this.accessControlService.getUserRoles(id);
    return {
      userId: id,
      roles,
    };
  }
}
```

- [ ] **Step 2: Remove executeGovernedRoleBindingChange from AccessControlService**

In `src/modules/identity/access-control/access-control.service.ts`, remove the `executeGovernedRoleBindingChange` method (lines 364–375) and the `GovernedRoleBindingChangeBinding` type (lines 25–31), `GovernedExecutionActor` type (lines 33–38), and the `buildGovernedRoleBindingAuditContext` private method (lines 112–125). Also remove `toAdminActor` private method (lines 90–96) since it's only used by `executeGovernedRoleBindingChange`.

Make `validateHardMutex` public (change `private` to `public` at line 68) so the workflow service can call it for pre-flight validation.

- [ ] **Step 3: Remove ADMIN_ROLE_BINDING_CHANGE case from GovernedExecutionListener**

In `src/modules/identity/governed-execution/governed-execution.listener.ts`, remove the `ADMIN_ROLE_BINDING_CHANGE` case (lines 22–24):

```typescript
      case 'ADMIN_ROLE_BINDING_CHANGE':
        await this.accessControlService.executeGovernedRoleBindingChange(binding as any, actor);
        break;
```

The `AccessControlService` import can also be removed from the constructor if no other case uses it. Check: the remaining `BUSINESS_CONFIG_CHANGE` case uses `businessConfigService`, not `accessControlService`. So remove the `AccessControlService` import and constructor parameter.

Resulting file:

```typescript
import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  CHANGE_TICKET_CONSUMED,
  ChangeTicketConsumedEvent,
} from '../../governance/change-tickets/events/change-ticket-consumed.event';
import { BusinessConfigService } from '../../governance/business-config/business-config.service';

@Injectable()
export class GovernedExecutionListener {
  constructor(
    private readonly businessConfigService: BusinessConfigService,
  ) {}

  @OnEvent(CHANGE_TICKET_CONSUMED)
  async handleChangeTicketConsumed(event: ChangeTicketConsumedEvent): Promise<void> {
    const { binding, actor } = event;

    switch (binding.intent) {
      case 'BUSINESS_CONFIG_CHANGE': {
        const releaseNo = String(binding.releaseNo || '');
        if (releaseNo) {
          await this.businessConfigService.publishReleaseFromGovernance(releaseNo, event.ticketNo);
        }
        break;
      }
      default:
        break;
    }
  }
}
```

- [ ] **Step 4: Remove createAdminRoleBindingChangeTicket from ChangeTicketsService**

In `src/modules/governance/change-tickets/change-tickets.service.ts`, remove the `createAdminRoleBindingChangeTicket` method (lines 613–672) and the `AdminRoleBindingChangeTicketInput` interface (find it near the method — it defines `{ roleCodes: string[]; changeReason: string }`).

- [ ] **Step 5: Verify TypeScript compiles**

Run:
```bash
cd Exchange_js && npx tsc --noEmit 2>&1 | head -30
```

Expected: No errors. If there are errors from other files importing removed code, fix them.

- [ ] **Step 6: Run all unit tests**

Run:
```bash
cd Exchange_js && npx jest --testPathPatterns="admin-role-binding-change-workflow|access-control|governed-execution" --no-coverage 2>&1 | tail -20
```

Expected: All tests pass (pre-existing failures excluded).

- [ ] **Step 7: Commit**

```bash
git add src/modules/identity/access-control/access-control.controller.ts \
        src/modules/identity/access-control/access-control.service.ts \
        src/modules/identity/governed-execution/governed-execution.listener.ts \
        src/modules/governance/change-tickets/change-tickets.service.ts
git commit -m "$(cat <<'EOF'
refactor(cleanup): remove Change Ticket role binding path, replaced by dedicated workflow
EOF
)"
```

---

### Task 9: Final Verification

**Files:** (none — verification only)

- [ ] **Step 1: TypeScript full check**

Run:
```bash
cd Exchange_js && npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 2: Run all related tests**

Run:
```bash
cd Exchange_js && npx jest --testPathPatterns="admin-role-binding-change-workflow" --no-coverage --verbose
```

Expected: All 8 tests pass.

- [ ] **Step 3: Start dev server and verify routes register**

Run:
```bash
cd Exchange_js && npm run dev:start
```

Wait for the server to start, then verify the new routes are accessible:

```bash
curl -s http://localhost:3500/admin/iam/role-change-requests 2>&1 | head -5
```

Expected: Returns 401 Unauthorized (confirms route is registered, just lacks auth).

```bash
npm run dev:stop
```

- [ ] **Step 4: Update roadmap**

In `doc-final/reference/roadmap.md`, find the Admin Role Binding Change entry and mark it as having the 3-layer refactor complete (similar to how C5 was updated).

- [ ] **Step 5: Final commit**

```bash
git add doc-final/reference/roadmap.md
git commit -m "$(cat <<'EOF'
docs(roadmap): mark C2 Admin Role Binding Change 3-layer workflow complete
EOF
)"
```
