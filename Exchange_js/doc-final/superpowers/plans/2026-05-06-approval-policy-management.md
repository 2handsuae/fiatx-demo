# Approval Policy Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow admins to view and modify approval checker roles through a governed change workflow (APPROVAL_POLICY_CHANGE → CISO approval → auto-apply).

**Architecture:** Three-layer pattern matching AdminRoleBindingChange: domain service (policy read/upsert) → thin approval handler (extends ApprovalHandlerBase) → workflow service (orchestrates request lifecycle). New controller exposes read + change-request endpoints. Frontend page with edit modal.

**Tech Stack:** NestJS, Prisma, SQLite, React + Tailwind (admin dark theme)

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `prisma/schema.prisma` | Add `ApprovalPolicyChangeRequest` model |
| Create | `prisma/migrations/.../migration.sql` | DB migration (auto-generated) |
| Modify | `src/modules/governance/approvals/constants/approval.constants.ts` | Add `APPROVAL_POLICY_CHANGE` type + default policy + V1 whitelist |
| Modify | `src/modules/audit-logging/constants/audit-actions.constant.ts` | Verify `APPROVAL_POLICY` entity type exists |
| Modify | `src/modules/governance/approvals/approval-policy.service.ts` | Add `listV1Policies()` + `upsertCheckerRoles()` |
| Create | `src/modules/governance/approvals/approval-policy-change-approval.service.ts` | Thin handler extending `ApprovalHandlerBase` |
| Create | `src/modules/governance/approvals/approval-policy-change-workflow.service.ts` | Workflow orchestration |
| Create | `src/modules/governance/approvals/approval-policy.controller.ts` | REST endpoints for policies + change requests |
| Modify | `src/modules/governance/approvals/approvals.module.ts` | Register new services + controller |
| Create | `admin-web/src/pages/ApprovalPoliciesPage.tsx` | Frontend list page + edit modal |
| Modify | `admin-web/src/rbac/permissions.ts` | Add policy permissions |
| Modify | `admin-web/src/App.tsx` | Add governance route |
| Modify | `doc-final/reference/roadmap.md` | Mark workflow #10 complete |

---

### Task 1: Prisma Model + Migration + Constants

**Files:**
- Modify: `prisma/schema.prisma`
- Modify: `src/modules/governance/approvals/constants/approval.constants.ts`
- Modify: `src/modules/audit-logging/constants/audit-actions.constant.ts`

- [ ] **Step 1: Add `ApprovalPolicyChangeRequest` model to Prisma schema**

Open `prisma/schema.prisma` and add the new model after the existing `ApprovalActionPolicy` model (around line 803):

```prisma
model ApprovalPolicyChangeRequest {
  id                   String    @id @default(uuid())
  requestNo            String    @unique @default("TEMP")
  targetActionType     String
  currentCheckerRoles  String
  proposedCheckerRoles String
  changeReason         String
  status               String    @default("PENDING_APPROVAL")
  approvalCaseId       String?
  approvalCaseNo       String?
  requestedByUserId    String
  executedAt           DateTime?
  failureReason        String?
  createdAt            DateTime  @default(now())
  updatedAt            DateTime  @updatedAt
  deletedAt            DateTime?

  @@index([targetActionType, status])
  @@index([approvalCaseId])
  @@index([status])
  @@index([requestedByUserId])
  @@map("approval_policy_change_requests")
}
```

- [ ] **Step 2: Generate and apply migration**

Run:
```bash
cd Exchange_js && npx prisma migrate dev --name add_approval_policy_change_request
```
Expected: Migration created and applied, `prisma/migrations/XXXXXX_add_approval_policy_change_request/migration.sql` generated.

- [ ] **Step 3: Add `APPROVAL_POLICY_CHANGE` to `ApprovalActionTypes`**

In `src/modules/governance/approvals/constants/approval.constants.ts`, add to the `ApprovalActionTypes` object (after `ADMIN_REACTIVATION_APPROVAL`):

```typescript
  // ─── Approval Policy Governance (2026-05-06) ────
  APPROVAL_POLICY_CHANGE: 'APPROVAL_POLICY_CHANGE',
```

- [ ] **Step 4: Add default policy for `APPROVAL_POLICY_CHANGE`**

In the same file, add to `DEFAULT_APPROVAL_POLICIES` (after the last entry):

```typescript
  [ApprovalActionTypes.APPROVAL_POLICY_CHANGE]: {
    riskLevel: ApprovalRiskLevels.HIGH,
    checkerRoles: ['CISO'],
    timeoutHours: 48,
    allowCancel: true,
    allowRetry: false,
  },
```

- [ ] **Step 5: Add V1 visibility whitelist constant**

In the same file, add after the `DEFAULT_APPROVAL_POLICIES` export:

```typescript
/**
 * Only these action types are visible in the Approval Policy Management UI.
 * Non-V1 types remain in code but are filtered out of API responses.
 */
export const V1_APPROVAL_ACTION_TYPES: readonly string[] = [
  ApprovalActionTypes.ADMIN_INVITE_APPROVAL,
  ApprovalActionTypes.ADMIN_ROLE_BINDING_CHANGE_APPROVAL,
  ApprovalActionTypes.ADMIN_SUSPENSION_APPROVAL,
  ApprovalActionTypes.ADMIN_REACTIVATION_APPROVAL,
  ApprovalActionTypes.AUDIT_EVIDENCE_EXPORT_APPROVAL,
  ApprovalActionTypes.APPROVAL_POLICY_CHANGE,
] as const;
```

- [ ] **Step 6: Verify `APPROVAL_POLICY` exists in `AuditEntityTypes`**

Open `src/modules/audit-logging/constants/audit-actions.constant.ts`. Check that `AuditEntityTypes` contains `APPROVAL_POLICY`. If not, add:

```typescript
  APPROVAL_POLICY: 'APPROVAL_POLICY',
```

Also verify `AuditGovernanceActions.APPROVAL_POLICY` block exists with: `MODIFICATION_REQUESTED`, `APPROVAL_GRANTED`, `APPROVAL_DECLINED`, `APPROVAL_CANCELLED`, `MODIFICATION_APPLIED`, `MODIFICATION_APPLY_FAILED`.

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/ \
  src/modules/governance/approvals/constants/approval.constants.ts \
  src/modules/audit-logging/constants/audit-actions.constant.ts
git commit -m "feat(governance): add ApprovalPolicyChangeRequest model and constants"
```

---

### Task 2: Domain Service — `listV1Policies` + `upsertCheckerRoles`

**Files:**
- Modify: `src/modules/governance/approvals/approval-policy.service.ts`

- [ ] **Step 1: Add `listV1Policies` method**

In `approval-policy.service.ts`, add after the existing `getPolicy` method. This merges hardcoded defaults with DB overrides for V1 types only:

```typescript
  async listV1Policies(): Promise<
    (ResolvedApprovalPolicy & { source: 'DEFAULT' | 'CUSTOMIZED'; editable: boolean })[]
  > {
    const dbOverrides = await this.prisma.approvalActionPolicy.findMany({
      where: { actionType: { in: [...V1_APPROVAL_ACTION_TYPES] } },
    });
    const dbMap = new Map(dbOverrides.map((o) => [o.actionType, o]));

    return V1_APPROVAL_ACTION_TYPES.map((actionType) => {
      const dbRow = dbMap.get(actionType);
      const defaultPolicy = DEFAULT_APPROVAL_POLICIES[actionType];
      if (!defaultPolicy) {
        throw new Error(`V1 whitelist references unknown actionType: ${actionType}`);
      }
      const hasOverride = !!dbRow;
      return {
        actionType,
        riskLevel: dbRow?.riskLevel ?? defaultPolicy.riskLevel,
        checkerRoles: splitRoleCsv(dbRow?.checkerRoles) ?? defaultPolicy.checkerRoles,
        timeoutHours: dbRow?.timeoutHours ?? defaultPolicy.timeoutHours,
        allowCancel: dbRow?.allowCancel ?? defaultPolicy.allowCancel,
        allowRetry: dbRow?.allowRetry ?? defaultPolicy.allowRetry,
        source: hasOverride ? ('CUSTOMIZED' as const) : ('DEFAULT' as const),
        editable: actionType !== ApprovalActionTypes.APPROVAL_POLICY_CHANGE,
      };
    });
  }
```

Add the needed imports at the top of the file:

```typescript
import {
  ApprovalActionTypes,
  DEFAULT_APPROVAL_POLICIES,
  V1_APPROVAL_ACTION_TYPES,
  splitRoleCsv,
} from './constants/approval.constants';
```

- [ ] **Step 2: Add `upsertCheckerRoles` method**

In the same file, add after `listV1Policies`:

```typescript
  async upsertCheckerRoles(
    actionType: string,
    checkerRoles: string[],
    tx?: any,
  ): Promise<void> {
    if (actionType === ApprovalActionTypes.APPROVAL_POLICY_CHANGE) {
      throw new BadRequestException({
        code: 'SELF_POLICY_IMMUTABLE',
        message: 'APPROVAL_POLICY_CHANGE policy cannot be modified through the platform',
      });
    }
    const defaultPolicy = DEFAULT_APPROVAL_POLICIES[actionType];
    if (!defaultPolicy) {
      throw new BadRequestException(`Unknown actionType: ${actionType}`);
    }
    const db = tx || this.prisma;
    await db.approvalActionPolicy.upsert({
      where: { actionType },
      update: { checkerRoles: checkerRoles.join(',') },
      create: {
        actionType,
        riskLevel: defaultPolicy.riskLevel,
        checkerRoles: checkerRoles.join(','),
        timeoutHours: defaultPolicy.timeoutHours,
        allowCancel: defaultPolicy.allowCancel,
        allowRetry: defaultPolicy.allowRetry,
      },
    });
  }
```

Add `BadRequestException` to the imports from `@nestjs/common`.

- [ ] **Step 3: Verify build**

Run:
```bash
cd Exchange_js && npx tsc --noEmit --pretty 2>&1 | head -30
```
Expected: No errors in the modified files.

- [ ] **Step 4: Commit**

```bash
git add src/modules/governance/approvals/approval-policy.service.ts
git commit -m "feat(governance): add listV1Policies and upsertCheckerRoles to ApprovalPolicyService"
```

---

### Task 3: Thin Approval Handler

**Files:**
- Create: `src/modules/governance/approvals/approval-policy-change-approval.service.ts`

- [ ] **Step 1: Create the approval handler**

Create `src/modules/governance/approvals/approval-policy-change-approval.service.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import { ApprovalHandlerBase } from './approval-handler.base';
import { ApprovalActionTypes } from './constants/approval.constants';
import {
  AuditBusinessWorkflowTypes,
  AuditEntityTypes,
  AuditGovernanceActions,
} from '../../audit-logging/constants/audit-actions.constant';

@Injectable()
export class ApprovalPolicyChangeApprovalService extends ApprovalHandlerBase {
  readonly actionType = ApprovalActionTypes.APPROVAL_POLICY_CHANGE;
  readonly workflowType = AuditBusinessWorkflowTypes.APPROVAL_POLICY;
  readonly auditActions = {
    granted: AuditGovernanceActions.APPROVAL_POLICY.APPROVAL_GRANTED,
    declined: AuditGovernanceActions.APPROVAL_POLICY.APPROVAL_DECLINED,
    cancelled: AuditGovernanceActions.APPROVAL_POLICY.APPROVAL_CANCELLED,
  };
  readonly entityType = AuditEntityTypes.APPROVAL_POLICY;
}
```

- [ ] **Step 2: Verify build**

Run:
```bash
cd Exchange_js && npx tsc --noEmit --pretty 2>&1 | head -30
```
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/modules/governance/approvals/approval-policy-change-approval.service.ts
git commit -m "feat(governance): add ApprovalPolicyChangeApprovalService handler"
```

---

### Task 4: Workflow Service

**Files:**
- Create: `src/modules/governance/approvals/approval-policy-change-workflow.service.ts`

- [ ] **Step 1: Create the workflow service**

Create `src/modules/governance/approvals/approval-policy-change-workflow.service.ts`:

```typescript
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { ApprovalsService } from './approvals.service';
import { ApprovalPolicyService } from './approval-policy.service';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import {
  ApprovalActionTypes,
  V1_APPROVAL_ACTION_TYPES,
} from './constants/approval.constants';
import {
  AuditBusinessWorkflowTypes,
  AuditEntityTypes,
  AuditGovernanceActions,
} from '../../audit-logging/constants/audit-actions.constant';
import { AuditResult } from '../../audit-logging/dto/audit-log.dto';
import { generateReferenceNo } from '../../../common/utils/no-generator.util';

/** Secondary event emitted by ApprovalPolicyChangeApprovalService */
const SECONDARY_EVENT = 'workflow.approval-policy.decided';

interface ApprovalActorContext {
  userId: string;
  userNo: string;
  role?: string;
  roleCodes?: string[];
}

interface ApprovalDecidedEvent {
  approvalCaseId: string;
  approvalNo: string;
  entityRef: string;
  decision: 'APPROVED' | 'DECLINED' | 'CANCELLED' | 'EXPIRED';
  decisionByUserId?: string;
  decisionByUserNo?: string;
  decisionByRole?: string;
  traceId: string;
  workflowType: string;
  workflowNo?: string;
}

const MAX_REQUEST_NO_RETRIES = 5;

@Injectable()
export class ApprovalPolicyChangeWorkflowService {
  private readonly logger = new Logger(ApprovalPolicyChangeWorkflowService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly approvalsService: ApprovalsService,
    private readonly policyService: ApprovalPolicyService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  // ─── Create Change Request ────────────────────────

  async requestChange(
    targetActionType: string,
    proposedCheckerRoles: string[],
    changeReason: string,
    actor: ApprovalActorContext,
  ): Promise<{ requestNo: string; approvalNo: string; status: string }> {
    // 1. Validate targetActionType in V1 whitelist
    if (!V1_APPROVAL_ACTION_TYPES.includes(targetActionType)) {
      throw new BadRequestException({
        code: 'INVALID_ACTION_TYPE',
        message: `Action type '${targetActionType}' is not a valid V1 approval type`,
      });
    }

    // 2. Self-protection: APPROVAL_POLICY_CHANGE cannot be modified
    if (targetActionType === ApprovalActionTypes.APPROVAL_POLICY_CHANGE) {
      throw new BadRequestException({
        code: 'SELF_POLICY_IMMUTABLE',
        message: 'APPROVAL_POLICY_CHANGE policy cannot be modified through the platform',
      });
    }

    // 3. Validate proposedCheckerRoles is non-empty
    if (!proposedCheckerRoles || proposedCheckerRoles.length === 0) {
      throw new BadRequestException('proposedCheckerRoles must not be empty');
    }

    // 4. Snapshot current policy
    const currentPolicy = await this.policyService.getPolicy(targetActionType);
    const currentCheckerRoles = currentPolicy.checkerRoles;

    // 5. Reject if no actual change
    const sortedCurrent = [...currentCheckerRoles].sort().join(',');
    const sortedProposed = [...proposedCheckerRoles].sort().join(',');
    if (sortedCurrent === sortedProposed) {
      throw new ConflictException({
        code: 'NO_CHANGE',
        message: 'Proposed checker roles are identical to current configuration',
      });
    }

    const traceId = randomUUID();

    // 6. Create request with retry for requestNo uniqueness
    let requestNo = '';
    let request: any;
    for (let i = 0; i < MAX_REQUEST_NO_RETRIES; i++) {
      requestNo = generateReferenceNo('APC');
      try {
        request = await this.prisma.approvalPolicyChangeRequest.create({
          data: {
            requestNo,
            targetActionType,
            currentCheckerRoles: currentCheckerRoles.join(','),
            proposedCheckerRoles: proposedCheckerRoles.join(','),
            changeReason,
            status: 'PENDING_APPROVAL',
            requestedByUserId: actor.userId,
          },
        });
        break;
      } catch (err: any) {
        if (err?.code === 'P2002' && i < MAX_REQUEST_NO_RETRIES - 1) continue;
        throw err;
      }
    }

    // 7. Create and submit approval case
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
          currentCheckerRoles,
          proposedCheckerRoles,
          changeReason,
        },
      },
      { reason: changeReason, traceId },
      actor,
    );

    // 8. Link approval case to request
    await this.prisma.approvalPolicyChangeRequest.update({
      where: { id: request.id },
      data: {
        approvalCaseId: approvalCase.id,
        approvalCaseNo: approvalCase.approvalNo,
      },
    });

    // 9. Audit: MODIFICATION_REQUESTED
    await this.auditLogsService.recordByActor(
      {
        action: AuditGovernanceActions.APPROVAL_POLICY.MODIFICATION_REQUESTED,
        entityType: AuditEntityTypes.APPROVAL_POLICY,
        entityId: request.id,
        entityNo: requestNo,
        workflowType: AuditBusinessWorkflowTypes.APPROVAL_POLICY,
        traceId,
        result: AuditResult.SUCCESS,
        metadata: {
          targetActionType,
          currentCheckerRoles,
          proposedCheckerRoles,
          changeReason,
          approvalNo: approvalCase.approvalNo,
        },
        entityOwnerNo: actor.userNo,
        sourcePlatform: 'ADMIN_API',
      },
      {
        actorType: 'ADMIN',
        actorId: actor.userId,
        actorNo: actor.userNo,
        actorRole: actor.role || 'UNKNOWN',
      },
    );

    return {
      requestNo,
      approvalNo: approvalCase.approvalNo,
      status: 'PENDING_APPROVAL',
    };
  }

  // ─── Handle Approval Decision ─────────────────────

  @OnEvent(SECONDARY_EVENT, { async: true })
  async handleApprovalDecided(event: ApprovalDecidedEvent): Promise<void> {
    switch (event.decision) {
      case 'APPROVED':
        return this.executePolicyChange(event);
      case 'DECLINED':
        return this.executeTermination(event, 'REJECTED');
      case 'CANCELLED':
        return this.executeTermination(event, 'CANCELLED');
      case 'EXPIRED':
        return this.executeTermination(event, 'EXPIRED');
    }
  }

  // ─── Execute Policy Change (on APPROVED) ──────────

  private async executePolicyChange(event: ApprovalDecidedEvent): Promise<void> {
    const request = await this.prisma.approvalPolicyChangeRequest.findFirst({
      where: { id: event.entityRef, deletedAt: null },
    });
    if (!request || request.status !== 'PENDING_APPROVAL') {
      this.logger.warn(`Skipping policy change: request ${event.entityRef} not found or not PENDING`);
      return;
    }

    const proposedRoles = request.proposedCheckerRoles.split(',').filter(Boolean);

    try {
      await this.prisma.$transaction(async (tx: any) => {
        await this.policyService.upsertCheckerRoles(
          request.targetActionType,
          proposedRoles,
          tx,
        );
        await tx.approvalPolicyChangeRequest.update({
          where: { id: request.id },
          data: { status: 'APPROVED', executedAt: new Date() },
        });
      });

      await this.approvalsService.markExecutionResult(
        event.approvalCaseId,
        true,
      );

      await this.auditLogsService.recordSystem({
        action: AuditGovernanceActions.APPROVAL_POLICY.MODIFICATION_APPLIED,
        entityType: AuditEntityTypes.APPROVAL_POLICY,
        entityId: request.id,
        entityNo: request.requestNo,
        workflowType: AuditBusinessWorkflowTypes.APPROVAL_POLICY,
        traceId: event.traceId,
        result: AuditResult.SUCCESS,
        metadata: {
          targetActionType: request.targetActionType,
          appliedCheckerRoles: proposedRoles,
        },
        entityOwnerNo: request.requestedByUserId,
      });
    } catch (err: any) {
      this.logger.error(`Policy change execution failed: ${err.message}`, err.stack);

      await this.prisma.approvalPolicyChangeRequest.update({
        where: { id: request.id },
        data: { status: 'FAILED', failureReason: err.message },
      });

      await this.approvalsService.markExecutionResult(
        event.approvalCaseId,
        false,
      );

      await this.auditLogsService.recordSystem({
        action: AuditGovernanceActions.APPROVAL_POLICY.MODIFICATION_APPLY_FAILED,
        entityType: AuditEntityTypes.APPROVAL_POLICY,
        entityId: request.id,
        entityNo: request.requestNo,
        workflowType: AuditBusinessWorkflowTypes.APPROVAL_POLICY,
        traceId: event.traceId,
        result: AuditResult.FAILED,
        metadata: { error: err.message },
        entityOwnerNo: request.requestedByUserId,
      });
    }
  }

  // ─── Terminate Request (on DECLINED / CANCELLED / EXPIRED) ──

  private async executeTermination(
    event: ApprovalDecidedEvent,
    status: 'REJECTED' | 'CANCELLED' | 'EXPIRED',
  ): Promise<void> {
    await this.prisma.approvalPolicyChangeRequest.updateMany({
      where: { id: event.entityRef, status: 'PENDING_APPROVAL' },
      data: { status },
    });
  }

  // ─── Read Operations ──────────────────────────────

  async listChangeRequests(query: {
    skip?: number;
    take?: number;
    status?: string;
  }): Promise<{ items: any[]; total: number }> {
    const where: any = { deletedAt: null };
    if (query.status) where.status = query.status;

    const [items, total] = await Promise.all([
      this.prisma.approvalPolicyChangeRequest.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: query.skip || 0,
        take: query.take || 20,
      }),
      this.prisma.approvalPolicyChangeRequest.count({ where }),
    ]);

    return { items, total };
  }

  async getChangeRequestById(id: string): Promise<any> {
    return this.prisma.approvalPolicyChangeRequest.findFirst({
      where: { id, deletedAt: null },
    });
  }
}
```

- [ ] **Step 2: Verify build**

Run:
```bash
cd Exchange_js && npx tsc --noEmit --pretty 2>&1 | head -30
```
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/modules/governance/approvals/approval-policy-change-workflow.service.ts
git commit -m "feat(governance): add ApprovalPolicyChangeWorkflowService"
```

---

### Task 5: Controller + API Endpoints

**Files:**
- Create: `src/modules/governance/approvals/approval-policy.controller.ts`

- [ ] **Step 1: Create the controller**

Create `src/modules/governance/approvals/approval-policy.controller.ts`:

```typescript
import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AdminPermissionGuard } from '../../identity/auth/admin-permission.guard';
import { ApprovalPolicyService } from './approval-policy.service';
import { ApprovalPolicyChangeWorkflowService } from './approval-policy-change-workflow.service';

@ApiTags('Approval Policies')
@Controller('admin/governance/approval-policies')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
@ApiBearerAuth()
export class ApprovalPolicyController {
  constructor(
    private readonly policyService: ApprovalPolicyService,
    private readonly workflowService: ApprovalPolicyChangeWorkflowService,
  ) {}

  private ensureAdmin(req: any) {
    const user = req.user;
    if (!user || user.type !== 'ADMIN') {
      throw new UnauthorizedException('Admin access required');
    }
    return {
      userId: user.sub,
      userNo: user.userNo,
      role: user.selectedRole || user.role,
      roleCodes: user.roleCodes || [],
    };
  }

  // ─── Policy Read ──────────────────────────────────

  @Get()
  async listPolicies() {
    return this.policyService.listV1Policies();
  }

  // ─── Change Request Operations ────────────────────

  @Post(':actionType/change-requests')
  async createChangeRequest(
    @Param('actionType') actionType: string,
    @Body() body: { proposedCheckerRoles: string[]; changeReason: string },
    @Req() req: any,
  ) {
    const actor = this.ensureAdmin(req);
    return this.workflowService.requestChange(
      actionType,
      body.proposedCheckerRoles,
      body.changeReason,
      actor,
    );
  }

  @Get('/change-requests')
  async listChangeRequests(
    @Query('skip') skip?: string,
    @Query('take') take?: string,
    @Query('status') status?: string,
  ) {
    return this.workflowService.listChangeRequests({
      skip: skip ? parseInt(skip, 10) : undefined,
      take: take ? parseInt(take, 10) : undefined,
      status,
    });
  }

  @Get('/change-requests/:id')
  async getChangeRequest(@Param('id') id: string) {
    return this.workflowService.getChangeRequestById(id);
  }
}
```

- [ ] **Step 2: Verify build**

Run:
```bash
cd Exchange_js && npx tsc --noEmit --pretty 2>&1 | head -30
```
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/modules/governance/approvals/approval-policy.controller.ts
git commit -m "feat(governance): add ApprovalPolicyController with REST endpoints"
```

---

### Task 6: Module Registration

**Files:**
- Modify: `src/modules/governance/approvals/approvals.module.ts`

- [ ] **Step 1: Register new services and controller in `ApprovalsModule`**

In `src/modules/governance/approvals/approvals.module.ts`, add imports and registrations:

Add to imports section at top:
```typescript
import { ApprovalPolicyChangeApprovalService } from './approval-policy-change-approval.service';
import { ApprovalPolicyChangeWorkflowService } from './approval-policy-change-workflow.service';
import { ApprovalPolicyController } from './approval-policy.controller';
```

Add to `@Module` decorator:
- `controllers` array: add `ApprovalPolicyController`
- `providers` array: add `ApprovalPolicyChangeApprovalService`, `ApprovalPolicyChangeWorkflowService`

The `AuditLogsModule` must be imported if not already (check — it may already be available via `PrismaModule` or global scope). If needed, add:
```typescript
import { AuditLogsModule } from '../../audit-logging/audit-logs.module';
```
and add `AuditLogsModule` to the `imports` array.

- [ ] **Step 2: Verify the server starts**

Run:
```bash
cd Exchange_js && npx ts-node -e "console.log('Module check passed')" 2>&1 | head -10
```
Or check with `npx tsc --noEmit`.

- [ ] **Step 3: Commit**

```bash
git add src/modules/governance/approvals/approvals.module.ts
git commit -m "feat(governance): register policy change services in ApprovalsModule"
```

---

### Task 7: Frontend — Approval Policies Page

**Files:**
- Create: `admin-web/src/pages/ApprovalPoliciesPage.tsx`
- Modify: `admin-web/src/rbac/permissions.ts`
- Modify: `admin-web/src/App.tsx`

- [ ] **Step 1: Add permissions**

In `admin-web/src/rbac/permissions.ts`, add:

```typescript
  // Approval Policy Management
  GOV_APPROVAL_POLICIES_READ: 'api.get.admin_governance_approval_policies',
  GOV_APPROVAL_POLICY_CHANGE_CREATE: 'api.post.admin_governance_approval_policies_actionType_change_requests',
```

- [ ] **Step 2: Create `ApprovalPoliciesPage.tsx`**

Create `admin-web/src/pages/ApprovalPoliciesPage.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Shield, Pencil, X, ArrowRight } from 'lucide-react';
import { PageTitleBar } from '../components/ui/PageTitleBar';
import { AdminBadge } from '../components/ui/AdminBadge';
import { adminFetch, AdminSessionError, getApiErrorMessage } from '../utils/adminFetch';
import { useAdminSession } from '../contexts/AdminSessionContext';
import { PERMISSIONS } from '../rbac/permissions';

interface PolicyView {
  actionType: string;
  checkerRoles: string[];
  timeoutHours: number;
  source: 'DEFAULT' | 'CUSTOMIZED';
  editable: boolean;
}

const ACTION_TYPE_LABELS: Record<string, string> = {
  ADMIN_INVITE_APPROVAL: 'Admin Invite',
  ADMIN_ROLE_BINDING_CHANGE_APPROVAL: 'Role Binding Change',
  ADMIN_SUSPENSION_APPROVAL: 'Account Suspension',
  ADMIN_REACTIVATION_APPROVAL: 'Account Reactivation',
  AUDIT_EVIDENCE_EXPORT_APPROVAL: 'Evidence Export',
  APPROVAL_POLICY_CHANGE: 'Approval Policy Change',
};

const AVAILABLE_ROLES = [
  'CISO',
  'MLRO',
  'SENIOR_MANAGEMENT_OFFICER',
  'TECH_OFFICER',
  'COMPLIANCE_OFFICER',
  'DPO',
];

export default function ApprovalPoliciesPage() {
  const navigate = useNavigate();
  const { hasAnyPermission } = useAdminSession();
  const [policies, setPolicies] = useState<PolicyView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Modal state
  const [editTarget, setEditTarget] = useState<PolicyView | null>(null);
  const [proposedRoles, setProposedRoles] = useState<string[]>([]);
  const [changeReason, setChangeReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  const canCreate = hasAnyPermission([PERMISSIONS.GOV_APPROVAL_POLICY_CHANGE_CREATE]);

  const fetchPolicies = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await adminFetch('/admin/governance/approval-policies');
      if (!res.ok) throw new Error(await getApiErrorMessage(res));
      setPolicies(await res.json());
    } catch (err: any) {
      if (err instanceof AdminSessionError) {
        navigate('/admin/login');
        return;
      }
      setError(err.message || 'Failed to load policies');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPolicies();
  }, []);

  const openEdit = (policy: PolicyView) => {
    setEditTarget(policy);
    setProposedRoles([...policy.checkerRoles]);
    setChangeReason('');
    setSubmitError('');
  };

  const closeEdit = () => {
    setEditTarget(null);
    setProposedRoles([]);
    setChangeReason('');
    setSubmitError('');
  };

  const toggleRole = (role: string) => {
    setProposedRoles((prev) =>
      prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role],
    );
  };

  const handleSubmit = async () => {
    if (!editTarget || proposedRoles.length === 0 || !changeReason.trim()) return;
    setSubmitting(true);
    setSubmitError('');
    try {
      const res = await adminFetch(
        `/admin/governance/approval-policies/${editTarget.actionType}/change-requests`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            proposedCheckerRoles: proposedRoles,
            changeReason: changeReason.trim(),
          }),
        },
      );
      if (!res.ok) throw new Error(await getApiErrorMessage(res));
      const data = await res.json();
      closeEdit();
      fetchPolicies();
      alert(`Change request submitted. Approval No: ${data.approvalNo}`);
    } catch (err: any) {
      setSubmitError(err.message || 'Submit failed');
    } finally {
      setSubmitting(false);
    }
  };

  const label = (at: string) => ACTION_TYPE_LABELS[at] || at;

  return (
    <div className="min-h-screen bg-adm-bg text-adm-t1 p-6">
      <PageTitleBar title="Approval Policies" meta="Manage checker role assignments for each approval type" />

      {error && (
        <div className="mt-4 p-3 bg-red-900/30 border border-red-700 rounded text-red-300 text-xs font-mono">
          {error}
        </div>
      )}

      <div className="mt-6 border border-adm-border rounded overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-adm-panel border-b border-adm-border text-adm-t3 uppercase tracking-wider">
              <th className="px-4 py-3 text-left font-mono font-medium">Action Type</th>
              <th className="px-4 py-3 text-left font-mono font-medium">Checker Roles</th>
              <th className="px-4 py-3 text-left font-mono font-medium">Timeout</th>
              <th className="px-4 py-3 text-left font-mono font-medium">Source</th>
              <th className="px-4 py-3 text-right font-mono font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-adm-t3">Loading...</td></tr>
            ) : policies.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-adm-t3">No policies found</td></tr>
            ) : (
              policies.map((p) => (
                <tr key={p.actionType} className="border-b border-adm-border hover:bg-adm-panel/50 transition-colors">
                  <td className="px-4 py-3 font-mono text-adm-t1">{label(p.actionType)}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1.5 flex-wrap">
                      {p.checkerRoles.map((r) => (
                        <span key={r} className="px-2 py-0.5 bg-adm-amber/10 text-adm-amber border border-adm-amber/30 rounded font-mono text-[10px]">
                          {r}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3 font-mono text-adm-t2">{p.timeoutHours}h</td>
                  <td className="px-4 py-3">
                    {p.source === 'CUSTOMIZED' ? (
                      <span className="px-2 py-0.5 bg-adm-amber/20 text-adm-amber rounded text-[10px] font-mono">Customized</span>
                    ) : (
                      <span className="px-2 py-0.5 bg-gray-700/50 text-adm-t3 rounded text-[10px] font-mono">Default</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {p.editable && canCreate ? (
                      <button
                        onClick={() => openEdit(p)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 bg-adm-panel border border-adm-border rounded text-adm-t2 hover:text-adm-amber hover:border-adm-amber/50 transition-colors text-[10px] font-mono uppercase tracking-wider"
                      >
                        <Pencil size={12} /> Edit
                      </button>
                    ) : (
                      <span className="text-adm-t3 text-[10px] font-mono" title="This policy can only be modified via code deployment">
                        <Shield size={12} className="inline mr-1 opacity-40" />Locked
                      </span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* ── Edit Modal ── */}
      {editTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-adm-bg border border-adm-border rounded-lg w-full max-w-lg mx-4 shadow-2xl">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-adm-border">
              <h3 className="font-mono text-sm font-semibold text-adm-t1">
                Modify: {label(editTarget.actionType)}
              </h3>
              <button onClick={closeEdit} className="text-adm-t3 hover:text-adm-t1">
                <X size={16} />
              </button>
            </div>

            <div className="px-5 py-5 space-y-5">
              {/* Current → Proposed */}
              <div className="flex items-center gap-3">
                <div className="flex-1">
                  <p className="font-mono text-[9px] uppercase tracking-widest text-adm-t3 mb-2">Current</p>
                  <div className="flex gap-1.5 flex-wrap">
                    {editTarget.checkerRoles.map((r) => (
                      <span key={r} className="px-2 py-0.5 bg-gray-700/50 text-adm-t3 rounded font-mono text-[10px]">{r}</span>
                    ))}
                  </div>
                </div>
                <ArrowRight size={16} className="text-adm-t3 mt-4 shrink-0" />
                <div className="flex-1">
                  <p className="font-mono text-[9px] uppercase tracking-widest text-adm-t3 mb-2">Proposed</p>
                  <div className="flex gap-1.5 flex-wrap">
                    {proposedRoles.length > 0 ? proposedRoles.map((r) => (
                      <span key={r} className="px-2 py-0.5 bg-adm-amber/10 text-adm-amber border border-adm-amber/30 rounded font-mono text-[10px]">{r}</span>
                    )) : (
                      <span className="text-adm-t3 text-[10px] font-mono">Select at least one role</span>
                    )}
                  </div>
                </div>
              </div>

              {/* Role toggles */}
              <div>
                <p className="font-mono text-[9px] uppercase tracking-widest text-adm-t3 mb-2">Available Roles</p>
                <div className="flex gap-2 flex-wrap">
                  {AVAILABLE_ROLES.map((role) => (
                    <button
                      key={role}
                      onClick={() => toggleRole(role)}
                      className={`px-3 py-1.5 rounded font-mono text-[10px] border transition-colors ${
                        proposedRoles.includes(role)
                          ? 'bg-adm-amber/20 text-adm-amber border-adm-amber/50'
                          : 'bg-adm-panel text-adm-t3 border-adm-border hover:border-adm-t3'
                      }`}
                    >
                      {role}
                    </button>
                  ))}
                </div>
              </div>

              {/* Change reason */}
              <div>
                <p className="font-mono text-[9px] uppercase tracking-widest text-adm-t3 mb-2">Change Reason</p>
                <textarea
                  value={changeReason}
                  onChange={(e) => setChangeReason(e.target.value)}
                  placeholder="Explain why this change is needed..."
                  rows={3}
                  className="w-full px-3 py-2 bg-adm-panel border border-adm-border rounded font-mono text-xs text-adm-t1 placeholder:text-adm-t3 focus:border-adm-amber focus:outline-none resize-none"
                />
              </div>

              {submitError && (
                <div className="p-2 bg-red-900/30 border border-red-700 rounded text-red-300 text-[10px] font-mono">
                  {submitError}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex justify-end gap-3 px-5 py-4 border-t border-adm-border">
              <button
                onClick={closeEdit}
                className="px-4 py-2 font-mono text-[10px] uppercase tracking-wider text-adm-t3 hover:text-adm-t1 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={submitting || proposedRoles.length === 0 || !changeReason.trim()}
                className="px-4 py-2 bg-adm-amber font-mono text-[10px] font-bold uppercase tracking-wider text-gray-950 rounded hover:opacity-90 disabled:opacity-40 transition-opacity"
              >
                {submitting ? 'Submitting...' : 'Submit for Approval'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Add route in `App.tsx`**

In `admin-web/src/App.tsx`, find the governance routes section (around line 729, near the `regulatory-gates` route) and add:

```tsx
              <Route
                path="governance/approval-policies"
                element={withPermission(<ApprovalPoliciesPage />, [
                  PERMISSIONS.GOV_APPROVAL_POLICIES_READ,
                ])}
              />
```

Add the lazy import at the top of the file with the other lazy imports:

```tsx
const ApprovalPoliciesPage = lazy(() => import('./pages/ApprovalPoliciesPage'));
```

- [ ] **Step 4: Add navigation link (if sidebar exists)**

Check the admin sidebar/navigation component and add a link for "Approval Policies" under the Governance section, pointing to `/dashboard/governance/approval-policies`.

- [ ] **Step 5: Verify frontend builds**

Run:
```bash
cd Exchange_js/admin-web && npx tsc --noEmit --pretty 2>&1 | head -20
```
Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add admin-web/src/pages/ApprovalPoliciesPage.tsx \
  admin-web/src/rbac/permissions.ts \
  admin-web/src/App.tsx
git commit -m "feat(admin-web): add Approval Policies page with edit modal"
```

---

### Task 8: Update Roadmap

**Files:**
- Modify: `doc-final/reference/roadmap.md`

- [ ] **Step 1: Mark Approval Policy Management as complete**

In `doc-final/reference/roadmap.md`, find the `Approval Policy Management` line (line 41) and change from `[ ]` to `[x]`, adding implementation details and date:

Change:
```
- [ ] Approval Policy Management（审批策略管理：展示所有审批类型各 step 的 checker 角色配置；...
```

To:
```
- [x] Approval Policy Management（审批策略管理：V1 白名单过滤展示 6 种审批类型的 checkerRoles 配置；修改 checkerRoles 需走 APPROVAL_POLICY_CHANGE 审批（CISO 审批通过后自动 upsert 生效）；APPROVAL_POLICY_CHANGE 自身的 checker 硬编码不可通过平台修改；3-Layer 架构：Domain Service + 薄审批处理器 + 工作流编排器；前端含 current→proposed diff 对比弹窗；workflowType: APPROVAL_POLICY） — **VARA + 业务**：CRM Rulebook II.B Internal Controls + Company Rulebook III Governance — 审批链本身的治理必须自洽且防篡改 ✅ 2026-05-06
```

- [ ] **Step 2: Commit**

```bash
git add doc-final/reference/roadmap.md
git commit -m "docs(roadmap): mark Approval Policy Management complete — V1 MVP 10/10"
```
