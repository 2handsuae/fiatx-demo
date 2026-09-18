# Transaction Limit Configuration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an admin-managed matrix of daily transaction limits (4 rows: BASIC/PREMIUM × WITHDRAWAL/SWAP) with MLRO→SMO two-step approval for changes, plus seed data and admin UI.

**Architecture:** New `TransactionLimitPolicy` Prisma model with a standalone NestJS module under `governance/transaction-limits/`. Workflow follows the established pattern: workflow service (submit + handle approval callback) + approval handler (extends `ApprovalHandlerBase`). Admin UI adds a list + detail page pair following the AssetList/AssetDetail pattern. Customer model gets 3 new fields.

**Tech Stack:** NestJS, Prisma, SQLite, React, Tailwind (adm-* tokens), lucide-react

---

## File Structure

### Backend (new files)

| File | Responsibility |
|------|----------------|
| `prisma/schema.prisma` | Add `TransactionLimitPolicy` model + Customer field additions |
| `src/modules/governance/transaction-limits/transaction-limits.module.ts` | NestJS module registration |
| `src/modules/governance/transaction-limits/transaction-limits.service.ts` | CRUD domain service (findAll, findByPolicyNo, updateLimitAmount) |
| `src/modules/governance/transaction-limits/transaction-limit-change-workflow.service.ts` | Workflow: requestChange + handleApprovalDecided |
| `src/modules/governance/transaction-limits/transaction-limit-change-approval.service.ts` | Approval handler extending ApprovalHandlerBase |
| `src/modules/governance/transaction-limits/transaction-limits.controller.ts` | Admin API: GET list, GET detail, PATCH propose change |
| `src/modules/governance/transaction-limits/transaction-limits-customer.controller.ts` | Customer API: GET my limits |
| `src/modules/governance/transaction-limits/dto/update-limit.dto.ts` | DTO for PATCH request |

### Backend (modify)

| File | Change |
|------|--------|
| `src/modules/audit-logging/constants/audit-actions.constant.ts` | Add TRANSACTION_LIMIT_CHANGE enums |
| `src/modules/governance/approvals/constants/approval.constants.ts` | Add TRANSACTION_LIMIT_CHANGE action type + policy |
| `src/modules/governance/governance.module.ts` | Import TransactionLimitsModule |
| `prisma/seed.business.ts` | Add seedTransactionLimitPolicies function |
| `prisma/seed.ts` | Call seedTransactionLimitPolicies |

### Frontend (new files)

| File | Responsibility |
|------|----------------|
| `admin-web/src/pages/TransactionLimitList.tsx` | List page with filter + table |
| `admin-web/src/pages/TransactionLimitDetail.tsx` | Detail page with sidebar actions + edit modal |

### Frontend (modify)

| File | Change |
|------|--------|
| `admin-web/src/App.tsx` | Add lazy imports + routes |
| `admin-web/src/components/DashboardLayout.tsx` | Add sidebar nav entry under Control Gates |
| `admin-web/src/rbac/permissions.ts` | Add TRANSACTION_LIMIT_POLICIES_READ + WRITE permissions |

---

## Task 1: Prisma Model + Migration

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add TransactionLimitPolicy model to schema.prisma**

Add this model after the existing `ApprovalCase` model (around line 780):

```prisma
// ─── Transaction Limit Policy (2026-05-16) ──────────────────
model TransactionLimitPolicy {
  id              String   @id @default(uuid())
  policyNo        String   @unique
  tradingTier     String                         // BASIC | PREMIUM
  operationType   String                         // WITHDRAWAL | SWAP
  period          String                         // DAILY
  limitAmount     Decimal
  status          String   @default("ACTIVE")    // ACTIVE | PENDING_APPROVAL
  approvalCaseId  String?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@unique([tradingTier, operationType, period])
  @@index([status])
  @@map("transaction_limit_policies")
}
```

- [ ] **Step 2: Add Customer model fields**

Find the `CustomerMain` model in `prisma/schema.prisma` (around line 180). Add these fields in the "Product" section (after the `investorTierUpdatedAt` field, before the Compliance section):

```prisma
  // Trading limits (2026-05-16)
  tradingTier              String   @default("BASIC")    // BASIC | PREMIUM
  riskLevel                String   @default("LOW")      // LOW | MEDIUM | HIGH
  sumsubVerificationLevel  Int      @default(1)           // 1 | 2
```

- [ ] **Step 3: Generate and run migration**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js && npx prisma migrate dev --name add-transaction-limit-policy
```

Expected: Migration created and applied successfully. Prisma Client regenerated.

- [ ] **Step 4: Verify Prisma Client types**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js && npx prisma generate
```

Expected: "✔ Generated Prisma Client"

- [ ] **Step 5: Commit**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js && git add prisma/schema.prisma prisma/migrations/ && git commit -m "$(cat <<'EOF'
feat: add TransactionLimitPolicy model and Customer trading fields

New model for managing daily transaction limits per trading tier and
operation type. Adds tradingTier, riskLevel, sumsubVerificationLevel
to CustomerMain.
EOF
)"
```

---

## Task 2: Audit Enums + Approval Constants

**Files:**
- Modify: `src/modules/audit-logging/constants/audit-actions.constant.ts`
- Modify: `src/modules/governance/approvals/constants/approval.constants.ts`

- [ ] **Step 1: Add audit workflow type and entity type**

In `src/modules/audit-logging/constants/audit-actions.constant.ts`, add to `AuditBusinessWorkflowTypes` (after the `ASSET_ACTIVATION` entry, around line 140):

```typescript
  // Transaction Limit Change (2026-05-16)
  TRANSACTION_LIMIT_CHANGE: 'TRANSACTION_LIMIT_CHANGE',
  // Trading Tier Upgrade (pre-registered, workflow deferred)
  TRADING_TIER_UPGRADE: 'TRADING_TIER_UPGRADE',
```

In the same file, add to `AuditEntityTypes` (in the appropriate section):

```typescript
  TRANSACTION_LIMIT_POLICY: 'TRANSACTION_LIMIT_POLICY',
```

- [ ] **Step 2: Add governance actions**

In the same file, add to `AuditGovernanceActions` (after the `ASSET_ACTIVATION` block, around line 586):

```typescript
  // Transaction Limit Change (2026-05-16)
  TRANSACTION_LIMIT_CHANGE: {
    CHANGE_REQUESTED:      'CHANGE_REQUESTED',
    APPROVAL_GRANTED:      'APPROVAL_GRANTED',
    APPROVAL_DECLINED:     'APPROVAL_DECLINED',
    APPROVAL_CANCELLED:    'APPROVAL_CANCELLED',
    APPROVAL_EXPIRED:      'APPROVAL_EXPIRED',
    CHANGE_APPLIED:        'CHANGE_APPLIED',
    CHANGE_APPLY_FAILED:   'CHANGE_APPLY_FAILED',
    CHANGE_CANCELLED:      'CHANGE_CANCELLED',
    LIMIT_POLICY_CREATED:  'LIMIT_POLICY_CREATED',
  },
```

- [ ] **Step 3: Add approval action type**

In `src/modules/governance/approvals/constants/approval.constants.ts`, add to `ApprovalActionTypes` (after the `ASSET_ACTIVATION` entry):

```typescript
  // Transaction Limit Change (2026-05-16)
  TRANSACTION_LIMIT_CHANGE: 'TRANSACTION_LIMIT_CHANGE',
```

- [ ] **Step 4: Add default approval policy**

In the same file, add to `DEFAULT_APPROVAL_POLICIES` (after the `ASSET_ACTIVATION` entry, around line 380):

```typescript
  // ─── Transaction Limit Change (2026-05-16) ────
  [ApprovalActionTypes.TRANSACTION_LIMIT_CHANGE]: {
    riskLevel: ApprovalRiskLevels.HIGH,
    steps: [
      { stepNo: 1, roles: ['MLRO'] },
      { stepNo: 2, roles: ['SMO'] },
    ],
    timeoutHours: 48,
    allowCancel: true,
    allowRetry: false,
  },
```

- [ ] **Step 5: Add to V1_APPROVAL_ACTION_TYPES**

In the same file, add to the `V1_APPROVAL_ACTION_TYPES` array (after `ApprovalActionTypes.ASSET_REACTIVATION`):

```typescript
  ApprovalActionTypes.TRANSACTION_LIMIT_CHANGE,
```

- [ ] **Step 6: Verify compilation**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js && npx tsc --noEmit --pretty 2>&1 | head -30
```

Expected: No errors.

- [ ] **Step 7: Commit**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js && git add src/modules/audit-logging/constants/audit-actions.constant.ts src/modules/governance/approvals/constants/approval.constants.ts && git commit -m "$(cat <<'EOF'
feat: register audit enums and approval policy for transaction limit change

Adds TRANSACTION_LIMIT_CHANGE workflow type, entity type, governance
actions, approval action type with MLRO->SMO two-step policy (48h timeout).
Pre-registers TRADING_TIER_UPGRADE for future workflow.
EOF
)"
```

---

## Task 3: Domain Service (CRUD)

**Files:**
- Create: `src/modules/governance/transaction-limits/transaction-limits.service.ts`
- Create: `src/modules/governance/transaction-limits/dto/update-limit.dto.ts`

- [ ] **Step 1: Create DTO**

Create directory and file:

```bash
mkdir -p /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/governance/transaction-limits/dto
```

Create `src/modules/governance/transaction-limits/dto/update-limit.dto.ts`:

```typescript
import { IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class UpdateLimitDto {
  @IsNumber()
  @Min(0.01)
  limitAmount: number;

  @IsString()
  @IsNotEmpty()
  changeReason: string;
}

export class ListTransactionLimitPoliciesDto {
  @IsOptional()
  @IsString()
  tradingTier?: string;

  @IsOptional()
  @IsString()
  operationType?: string;

  @IsOptional()
  @IsString()
  skip?: string;

  @IsOptional()
  @IsString()
  take?: string;
}
```

- [ ] **Step 2: Create domain service**

Create `src/modules/governance/transaction-limits/transaction-limits.service.ts`:

```typescript
import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';

@Injectable()
export class TransactionLimitsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(params: {
    skip?: number;
    take?: number;
    where?: Prisma.TransactionLimitPolicyWhereInput;
    orderBy?: Prisma.TransactionLimitPolicyOrderByWithRelationInput;
  }) {
    const { skip, take, where, orderBy } = params;
    const [items, total] = await Promise.all([
      this.prisma.transactionLimitPolicy.findMany({
        skip,
        take,
        where,
        orderBy: orderBy ?? { policyNo: 'asc' },
      }),
      this.prisma.transactionLimitPolicy.count({ where }),
    ]);
    return { items, total };
  }

  async findByPolicyNo(policyNo: string) {
    const policy = await this.prisma.transactionLimitPolicy.findUnique({
      where: { policyNo },
    });
    if (!policy) {
      throw new NotFoundException(`Transaction limit policy ${policyNo} not found`);
    }
    return policy;
  }

  async updateLimitAmount(policyNo: string, newAmount: Prisma.Decimal) {
    return this.prisma.transactionLimitPolicy.update({
      where: { policyNo },
      data: { limitAmount: newAmount, status: 'ACTIVE' },
    });
  }

  async setStatus(policyNo: string, status: string) {
    return this.prisma.transactionLimitPolicy.update({
      where: { policyNo },
      data: { status },
    });
  }

  async findByTradingTier(tradingTier: string) {
    return this.prisma.transactionLimitPolicy.findMany({
      where: { tradingTier, status: 'ACTIVE' },
      orderBy: { operationType: 'asc' },
    });
  }
}
```

- [ ] **Step 3: Verify compilation**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js && npx tsc --noEmit --pretty 2>&1 | head -30
```

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js && git add src/modules/governance/transaction-limits/ && git commit -m "$(cat <<'EOF'
feat: add TransactionLimitsService with CRUD operations

Domain service for TransactionLimitPolicy: findAll with filtering,
findByPolicyNo, updateLimitAmount, setStatus, findByTradingTier.
EOF
)"
```

---

## Task 4: Approval Handler

**Files:**
- Create: `src/modules/governance/transaction-limits/transaction-limit-change-approval.service.ts`

- [ ] **Step 1: Create approval handler**

Create `src/modules/governance/transaction-limits/transaction-limit-change-approval.service.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import {
  AuditBusinessWorkflowTypes,
  AuditEntityTypes,
  AuditGovernanceActions,
} from '../../audit-logging/constants/audit-actions.constant';
import { ApprovalHandlerBase } from '../approvals/approval-handler.base';
import { ApprovalActionTypes } from '../approvals/constants/approval.constants';

@Injectable()
export class TransactionLimitChangeApprovalService extends ApprovalHandlerBase {
  readonly actionType = ApprovalActionTypes.TRANSACTION_LIMIT_CHANGE;
  readonly workflowType = AuditBusinessWorkflowTypes.TRANSACTION_LIMIT_CHANGE;
  readonly auditActions = {
    granted: AuditGovernanceActions.TRANSACTION_LIMIT_CHANGE.APPROVAL_GRANTED,
    declined: AuditGovernanceActions.TRANSACTION_LIMIT_CHANGE.APPROVAL_DECLINED,
    cancelled: AuditGovernanceActions.TRANSACTION_LIMIT_CHANGE.APPROVAL_CANCELLED,
    expired: AuditGovernanceActions.TRANSACTION_LIMIT_CHANGE.APPROVAL_EXPIRED,
  };
  readonly entityType = AuditEntityTypes.TRANSACTION_LIMIT_POLICY;

  constructor(auditLogsService: AuditLogsService, eventEmitter: EventEmitter2) {
    super(auditLogsService, eventEmitter);
  }
}
```

- [ ] **Step 2: Verify compilation**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js && npx tsc --noEmit --pretty 2>&1 | head -30
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js && git add src/modules/governance/transaction-limits/transaction-limit-change-approval.service.ts && git commit -m "$(cat <<'EOF'
feat: add TransactionLimitChangeApprovalService

Approval handler extending ApprovalHandlerBase for TRANSACTION_LIMIT_CHANGE
action type. Emits workflow.transaction-limit-change.decided secondary event.
EOF
)"
```

---

## Task 5: Workflow Service

**Files:**
- Create: `src/modules/governance/transaction-limits/transaction-limit-change-workflow.service.ts`

- [ ] **Step 1: Create workflow service**

Create `src/modules/governance/transaction-limits/transaction-limit-change-workflow.service.ts`:

```typescript
import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import {
  AuditBusinessWorkflowTypes,
  AuditEntityTypes,
  AuditGovernanceActions,
} from '../../audit-logging/constants/audit-actions.constant';
import { AuditResult } from '../../audit-logging/dto/audit-log.dto';
import { ApprovalsService } from '../approvals/approvals.service';
import { ApprovalDecidedEvent } from '../approvals/approval-handler.base';
import {
  ApprovalActionTypes,
  ApprovalActorContext,
} from '../approvals/constants/approval.constants';
import { TransactionLimitsService } from './transaction-limits.service';

const SECONDARY_EVENT = 'workflow.transaction-limit-change.decided';

@Injectable()
export class TransactionLimitChangeWorkflowService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly limitsService: TransactionLimitsService,
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

  async requestChange(
    policyNo: string,
    newAmount: number,
    changeReason: string,
    actor: ApprovalActorContext,
  ) {
    const traceId = randomUUID();

    const policy = await this.limitsService.findByPolicyNo(policyNo);

    if (policy.status === 'PENDING_APPROVAL') {
      throw new ConflictException(
        `Policy ${policyNo} already has a pending change. Wait for the current approval to complete.`,
      );
    }

    const existingPending = await this.prisma.approvalCase.findFirst({
      where: {
        actionType: ApprovalActionTypes.TRANSACTION_LIMIT_CHANGE,
        entityRef: policy.id,
        status: 'PENDING',
        deletedAt: null,
      },
    });
    if (existingPending) {
      throw new ConflictException(
        `A pending limit change approval already exists: ${existingPending.approvalNo}`,
      );
    }

    const oldAmount = policy.limitAmount;

    const approvalCase = await this.approvalsService.createAndSubmit(
      {
        actionType: ApprovalActionTypes.TRANSACTION_LIMIT_CHANGE,
        entityRef: policy.id,
        workflowType: AuditBusinessWorkflowTypes.TRANSACTION_LIMIT_CHANGE,
        workflowId: policy.id,
        workflowNo: policyNo,
        traceId,
        objectSnapshot: {
          policyId: policy.id,
          policyNo,
          tradingTier: policy.tradingTier,
          operationType: policy.operationType,
          period: policy.period,
          oldAmount: oldAmount.toString(),
          newAmount: String(newAmount),
          changeReason,
        },
      },
      {
        reason: changeReason,
        traceId,
      },
      actor,
    );

    await this.limitsService.setStatus(policyNo, 'PENDING_APPROVAL');

    await this.auditLogsService.recordByActor(
      {
        action: AuditGovernanceActions.TRANSACTION_LIMIT_CHANGE.CHANGE_REQUESTED,
        entityType: AuditEntityTypes.TRANSACTION_LIMIT_POLICY,
        entityId: policy.id,
        entityNo: policyNo,
        workflowType: AuditBusinessWorkflowTypes.TRANSACTION_LIMIT_CHANGE,
        traceId,
        result: AuditResult.SUCCESS,
        metadata: {
          tradingTier: policy.tradingTier,
          operationType: policy.operationType,
          period: policy.period,
          oldAmount: oldAmount.toString(),
          newAmount: String(newAmount),
          changeReason,
          approvalNo: approvalCase.approvalNo,
        },
        requestId: `TRANSACTION_LIMIT_CHANGE_REQUESTED_${policyNo}`,
        sourcePlatform: 'ADMIN_API',
      },
      this.toAuditActor(actor),
    );

    return {
      approvalNo: approvalCase.approvalNo,
      traceId,
      policyNo,
      status: 'PENDING_APPROVAL',
    };
  }

  @OnEvent(SECONDARY_EVENT, { async: true })
  async handleApprovalDecided(event: ApprovalDecidedEvent) {
    if (event.decision === 'APPROVED') {
      return this.executeChange(event);
    }
    // On rejection/timeout/cancel, reset status back to ACTIVE
    return this.cancelChange(event);
  }

  private async executeChange(event: ApprovalDecidedEvent) {
    try {
      const snapshot = event.metadata as Record<string, string> | undefined;
      const policyNo = snapshot?.policyNo || event.workflowNo;
      const newAmount = snapshot?.newAmount;
      const oldAmount = snapshot?.oldAmount;

      if (!policyNo || !newAmount) {
        throw new Error(`Missing policyNo or newAmount in approval snapshot`);
      }

      await this.limitsService.updateLimitAmount(
        policyNo,
        new Prisma.Decimal(newAmount),
      );

      await this.auditLogsService.recordSystem({
        action: AuditGovernanceActions.TRANSACTION_LIMIT_CHANGE.CHANGE_APPLIED,
        entityType: AuditEntityTypes.TRANSACTION_LIMIT_POLICY,
        entityId: event.entityRef,
        entityNo: policyNo,
        workflowType: AuditBusinessWorkflowTypes.TRANSACTION_LIMIT_CHANGE,
        traceId: event.traceId,
        result: AuditResult.SUCCESS,
        metadata: {
          oldAmount,
          newAmount,
          approvalId: event.approvalId,
          approvalNo: event.approvalNo,
          appliedByUserId: event.decisionByUserId,
          appliedByUserNo: event.decisionByUserNo,
        },
        requestId: `TRANSACTION_LIMIT_CHANGE_APPLIED_${policyNo}`,
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
        'Transaction limit updated successfully',
      );
    } catch (error) {
      const policyNo = (event.metadata as Record<string, string>)?.policyNo || event.workflowNo;

      await this.auditLogsService.recordSystem({
        action: AuditGovernanceActions.TRANSACTION_LIMIT_CHANGE.CHANGE_APPLY_FAILED,
        entityType: AuditEntityTypes.TRANSACTION_LIMIT_POLICY,
        entityId: event.entityRef,
        entityNo: policyNo || undefined,
        workflowType: AuditBusinessWorkflowTypes.TRANSACTION_LIMIT_CHANGE,
        traceId: event.traceId,
        result: AuditResult.FAILED,
        reason: error instanceof Error ? error.message : 'Limit change execution failed',
        metadata: { approvalId: event.approvalId },
        requestId: `TRANSACTION_LIMIT_CHANGE_APPLY_FAILED_${event.entityRef}`,
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
          error instanceof Error ? error.message : 'Limit change execution failed',
        )
        .catch(() => undefined);

      throw error;
    }
  }

  private async cancelChange(event: ApprovalDecidedEvent) {
    const snapshot = event.metadata as Record<string, string> | undefined;
    const policyNo = snapshot?.policyNo || event.workflowNo;

    if (policyNo) {
      try {
        await this.limitsService.setStatus(policyNo, 'ACTIVE');
      } catch {
        // Policy may have been deleted; ignore
      }
    }

    await this.auditLogsService.recordSystem({
      action: AuditGovernanceActions.TRANSACTION_LIMIT_CHANGE.CHANGE_CANCELLED,
      entityType: AuditEntityTypes.TRANSACTION_LIMIT_POLICY,
      entityId: event.entityRef,
      entityNo: policyNo || undefined,
      workflowType: AuditBusinessWorkflowTypes.TRANSACTION_LIMIT_CHANGE,
      traceId: event.traceId,
      result: AuditResult.SUCCESS,
      metadata: {
        decision: event.decision,
        approvalId: event.approvalId,
        approvalNo: event.approvalNo,
      },
      requestId: `TRANSACTION_LIMIT_CHANGE_CANCELLED_${event.entityRef}`,
      sourcePlatform: 'SYSTEM',
    });
  }
}
```

- [ ] **Step 2: Verify compilation**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js && npx tsc --noEmit --pretty 2>&1 | head -30
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js && git add src/modules/governance/transaction-limits/transaction-limit-change-workflow.service.ts && git commit -m "$(cat <<'EOF'
feat: add TransactionLimitChangeWorkflowService

Workflow service for limit policy changes: requestChange creates approval
case (MLRO->SMO), handleApprovalDecided applies or cancels change.
Full audit logging at every lifecycle stage.
EOF
)"
```

---

## Task 6: Admin API Controller

**Files:**
- Create: `src/modules/governance/transaction-limits/transaction-limits.controller.ts`

- [ ] **Step 1: Create admin controller**

Create `src/modules/governance/transaction-limits/transaction-limits.controller.ts`:

```typescript
import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Prisma } from '@prisma/client';
import { AdminPermissionGuard, RequirePermissions, buildPermissionCode } from '../../identity/auth/admin-permission.guard';
import { ApprovalActorContext } from '../approvals/constants/approval.constants';
import { TransactionLimitsService } from './transaction-limits.service';
import { TransactionLimitChangeWorkflowService } from './transaction-limit-change-workflow.service';
import { UpdateLimitDto } from './dto/update-limit.dto';

@Controller('admin/transaction-limit-policies')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
export class TransactionLimitsController {
  constructor(
    private readonly limitsService: TransactionLimitsService,
    private readonly workflowService: TransactionLimitChangeWorkflowService,
  ) {}

  private ensureAdmin(req: any) {
    if (req.user?.userType !== 'ADMIN') {
      throw new ForbiddenException('Admin access required');
    }
  }

  private buildAdminActor(req: any): ApprovalActorContext {
    const user = req.user;
    return {
      actorType: 'ADMIN',
      userId: user.userId || user.sub,
      userNo: user.userNo,
      role: user.role,
      roleCodes: user.roleCodes || (user.role ? [user.role] : []),
    };
  }

  @Get()
  @RequirePermissions(buildPermissionCode('GET', '/admin/transaction-limit-policies'))
  async findAll(
    @Query('tradingTier') tradingTier?: string,
    @Query('operationType') operationType?: string,
    @Query('skip') skip?: string,
    @Query('take') take?: string,
  ) {
    const where: Prisma.TransactionLimitPolicyWhereInput = {};
    if (tradingTier) where.tradingTier = tradingTier;
    if (operationType) where.operationType = operationType;

    return this.limitsService.findAll({
      skip: skip ? parseInt(skip, 10) : undefined,
      take: take ? parseInt(take, 10) : undefined,
      where,
    });
  }

  @Get(':policyNo')
  @RequirePermissions(buildPermissionCode('GET', '/admin/transaction-limit-policies/:policyNo'))
  async findOne(@Param('policyNo') policyNo: string) {
    return this.limitsService.findByPolicyNo(policyNo);
  }

  @Patch(':policyNo')
  @RequirePermissions(buildPermissionCode('PATCH', '/admin/transaction-limit-policies/:policyNo'))
  async proposeChange(
    @Param('policyNo') policyNo: string,
    @Body() dto: UpdateLimitDto,
    @Req() req: any,
  ) {
    this.ensureAdmin(req);
    return this.workflowService.requestChange(
      policyNo,
      dto.limitAmount,
      dto.changeReason,
      this.buildAdminActor(req),
    );
  }
}
```

- [ ] **Step 2: Verify compilation**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js && npx tsc --noEmit --pretty 2>&1 | head -30
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js && git add src/modules/governance/transaction-limits/transaction-limits.controller.ts && git commit -m "$(cat <<'EOF'
feat: add TransactionLimitsController (admin API)

GET /admin/transaction-limit-policies (list with filtering)
GET /admin/transaction-limit-policies/:policyNo (detail)
PATCH /admin/transaction-limit-policies/:policyNo (propose change)
EOF
)"
```

---

## Task 7: Customer API Controller

**Files:**
- Create: `src/modules/governance/transaction-limits/transaction-limits-customer.controller.ts`

- [ ] **Step 1: Create customer controller**

Create `src/modules/governance/transaction-limits/transaction-limits-customer.controller.ts`:

```typescript
import {
  Controller,
  Get,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { TransactionLimitsService } from './transaction-limits.service';

@Controller('customer/my/trading-limits')
@UseGuards(AuthGuard('jwt'))
export class TransactionLimitsCustomerController {
  constructor(
    private readonly limitsService: TransactionLimitsService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  async getMyLimits(@Req() req: any) {
    const customerId = req.user?.userId || req.user?.sub;
    const customer = await this.prisma.customerMain.findUnique({
      where: { id: customerId },
      select: { tradingTier: true },
    });

    const tradingTier = customer?.tradingTier || 'BASIC';
    const policies = await this.limitsService.findByTradingTier(tradingTier);

    return {
      tradingTier,
      limits: policies.map((p) => ({
        policyNo: p.policyNo,
        operationType: p.operationType,
        period: p.period,
        limitAmount: p.limitAmount.toString(),
      })),
    };
  }
}
```

- [ ] **Step 2: Verify compilation**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js && npx tsc --noEmit --pretty 2>&1 | head -30
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js && git add src/modules/governance/transaction-limits/transaction-limits-customer.controller.ts && git commit -m "$(cat <<'EOF'
feat: add customer API for viewing trading limits

GET /customer/my/trading-limits returns the active limit policies
matching the customer's current tradingTier.
EOF
)"
```

---

## Task 8: NestJS Module Registration

**Files:**
- Create: `src/modules/governance/transaction-limits/transaction-limits.module.ts`
- Modify: `src/modules/governance/governance.module.ts`

- [ ] **Step 1: Create module file**

Create `src/modules/governance/transaction-limits/transaction-limits.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../core/prisma/prisma.module';
import { ApprovalsModule } from '../approvals/approvals.module';
import { AuditLogsModule } from '../../audit-logging/audit-logs.module';
import { TransactionLimitsService } from './transaction-limits.service';
import { TransactionLimitChangeWorkflowService } from './transaction-limit-change-workflow.service';
import { TransactionLimitChangeApprovalService } from './transaction-limit-change-approval.service';
import { TransactionLimitsController } from './transaction-limits.controller';
import { TransactionLimitsCustomerController } from './transaction-limits-customer.controller';

@Module({
  imports: [PrismaModule, ApprovalsModule, AuditLogsModule],
  controllers: [TransactionLimitsController, TransactionLimitsCustomerController],
  providers: [
    TransactionLimitsService,
    TransactionLimitChangeWorkflowService,
    TransactionLimitChangeApprovalService,
  ],
  exports: [TransactionLimitsService],
})
export class TransactionLimitsModule {}
```

- [ ] **Step 2: Register in governance module**

In `src/modules/governance/governance.module.ts`, add the import:

Add at top of file:
```typescript
import { TransactionLimitsModule } from './transaction-limits/transaction-limits.module';
```

Add `TransactionLimitsModule` to the `imports` array:
```typescript
@Global()
@Module({
  imports: [
    ApprovalsModule,
    BusinessConfigModule,
    GovernanceRegistriesModule,
    RegulatoryGatesModule,
    TransactionLimitsModule,
  ],
  exports: [ApprovalsModule],
})
export class GovernanceModule {}
```

- [ ] **Step 3: Verify compilation**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js && npx tsc --noEmit --pretty 2>&1 | head -30
```

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js && git add src/modules/governance/transaction-limits/transaction-limits.module.ts src/modules/governance/governance.module.ts && git commit -m "$(cat <<'EOF'
feat: register TransactionLimitsModule in governance

NestJS module with all providers (service, workflow, approval handler)
and controllers (admin + customer). Imported by GovernanceModule.
EOF
)"
```

---

## Task 9: Seed Script

**Files:**
- Modify: `prisma/seed.business.ts`
- Modify: `prisma/seed.ts`

- [ ] **Step 1: Add seed function**

In `prisma/seed.business.ts`, add the following function (at the end of the file, before any final export):

```typescript
export async function seedTransactionLimitPolicies(prisma: PrismaClient): Promise<void> {
  const policies = [
    { policyNo: 'TLP-001', tradingTier: 'BASIC',   operationType: 'WITHDRAWAL', period: 'DAILY', limitAmount: 30000 },
    { policyNo: 'TLP-002', tradingTier: 'BASIC',   operationType: 'SWAP',       period: 'DAILY', limitAmount: 100000 },
    { policyNo: 'TLP-003', tradingTier: 'PREMIUM',  operationType: 'WITHDRAWAL', period: 'DAILY', limitAmount: 150000 },
    { policyNo: 'TLP-004', tradingTier: 'PREMIUM',  operationType: 'SWAP',       period: 'DAILY', limitAmount: 500000 },
  ];

  for (const p of policies) {
    await prisma.transactionLimitPolicy.upsert({
      where: {
        tradingTier_operationType_period: {
          tradingTier: p.tradingTier,
          operationType: p.operationType,
          period: p.period,
        },
      },
      update: {
        policyNo: p.policyNo,
        limitAmount: p.limitAmount,
      },
      create: {
        policyNo: p.policyNo,
        tradingTier: p.tradingTier,
        operationType: p.operationType,
        period: p.period,
        limitAmount: p.limitAmount,
        status: 'ACTIVE',
      },
    });
  }

  console.log(`  ✔ Seeded ${policies.length} transaction limit policies`);
}
```

- [ ] **Step 2: Call seed function from main seed**

In `prisma/seed.ts`, find the main seed function and add the call. Import at the top:

```typescript
import { seedTransactionLimitPolicies } from './seed.business';
```

Add the call in the appropriate section (after other business data seeds):

```typescript
await seedTransactionLimitPolicies(prisma);
```

- [ ] **Step 3: Run seed to verify**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js && npx prisma db seed 2>&1 | tail -10
```

Expected: Output includes "✔ Seeded 4 transaction limit policies"

- [ ] **Step 4: Verify data**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js && npx prisma studio &
```

Or use sqlite3 directly:

```bash
sqlite3 /tmp/exchange_js_branch/dev.db "SELECT policyNo, tradingTier, operationType, period, limitAmount, status FROM transaction_limit_policies ORDER BY policyNo;"
```

Expected:
```
TLP-001|BASIC|WITHDRAWAL|DAILY|30000|ACTIVE
TLP-002|BASIC|SWAP|DAILY|100000|ACTIVE
TLP-003|PREMIUM|WITHDRAWAL|DAILY|150000|ACTIVE
TLP-004|PREMIUM|SWAP|DAILY|500000|ACTIVE
```

- [ ] **Step 5: Commit**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js && git add prisma/seed.business.ts prisma/seed.ts && git commit -m "$(cat <<'EOF'
feat: seed 4 transaction limit policies (BASIC/PREMIUM x WITHDRAWAL/SWAP)

Initial daily limits in AED: BASIC withdrawal 30k, swap 100k;
PREMIUM withdrawal 150k, swap 500k. Uses upsert for idempotency.
EOF
)"
```

---

## Task 10: Frontend Permissions + Route Registration

**Files:**
- Modify: `admin-web/src/rbac/permissions.ts`
- Modify: `admin-web/src/App.tsx`
- Modify: `admin-web/src/components/DashboardLayout.tsx`

- [ ] **Step 1: Add permission constants**

In `admin-web/src/rbac/permissions.ts`, add these entries to the `PERMISSIONS` object:

```typescript
  TRANSACTION_LIMIT_POLICIES_READ: 'api.get.admin_transaction_limit_policies',
  TRANSACTION_LIMIT_POLICIES_WRITE: 'api.patch.admin_transaction_limit_policies',
```

- [ ] **Step 2: Add lazy imports in App.tsx**

In `admin-web/src/App.tsx`, add these lazy imports (in the lazy import section, around line 128):

```typescript
const TransactionLimitList = lazy(() => import('./pages/TransactionLimitList'));
const TransactionLimitDetail = lazy(() => import('./pages/TransactionLimitDetail'));
```

- [ ] **Step 3: Add routes in App.tsx**

In `admin-web/src/App.tsx`, add routes in the system section (after the `system/asset-configs/:assetNo` route, before `treasury/withdrawal-addresses`):

```tsx
            <Route
              path="system/transaction-limits"
              element={withPermission(<TransactionLimitList />, [PERMISSIONS.TRANSACTION_LIMIT_POLICIES_READ])}
            />
            <Route
              path="system/transaction-limits/:policyNo"
              element={withPermission(<TransactionLimitDetail />, [PERMISSIONS.TRANSACTION_LIMIT_POLICIES_READ])}
            />
```

- [ ] **Step 4: Add sidebar nav entry**

In `admin-web/src/components/DashboardLayout.tsx`, add a "Transaction Limits" entry in the **Control Gates** section (after the "Approval Policies" entry, around line 157). First check the lucide-react imports at the top of the file and add `Gauge` if not already imported:

```typescript
import { Gauge } from 'lucide-react';
```

Then add the nav item:

```typescript
        {
          path: '/dashboard/system/transaction-limits',
          label: 'Transaction Limits',
          icon: <Gauge size={13} />,
          requiredPermissions: [PERMISSIONS.TRANSACTION_LIMIT_POLICIES_READ],
        },
```

- [ ] **Step 5: Verify frontend compiles**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/admin-web && npx tsc --noEmit --pretty 2>&1 | head -20
```

Note: This may show errors for the missing page components (TransactionLimitList/Detail). That's expected — they're created in the next tasks.

- [ ] **Step 6: Commit**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js && git add admin-web/src/rbac/permissions.ts admin-web/src/App.tsx admin-web/src/components/DashboardLayout.tsx && git commit -m "$(cat <<'EOF'
feat: register transaction limit routes, permissions, and sidebar nav

Adds TRANSACTION_LIMIT_POLICIES_READ/WRITE permissions, lazy imports,
routes under system/transaction-limits, and Control Gates sidebar entry.
EOF
)"
```

---

## Task 11: Transaction Limit List Page

**Files:**
- Create: `admin-web/src/pages/TransactionLimitList.tsx`

- [ ] **Step 1: Create list page**

Create `admin-web/src/pages/TransactionLimitList.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import Pagination from '../components/common/Pagination';
import {
  adminButtonClass,
  adminIconButtonClass,
} from '../components/common/adminButtonStyles';
import {
  AdminSessionError,
  adminFetch,
  getApiErrorMessage,
} from '../utils/adminFetch';
import { AdminBadge } from '../components/ui/AdminBadge';
import { PageTitleBar } from '../components/ui/PageTitleBar';

/* ── Interfaces ──────────────────────────────────────────────── */

interface PolicyItem {
  id: string;
  policyNo: string;
  tradingTier: string;
  operationType: string;
  period: string;
  limitAmount: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

interface PolicyListResponse {
  total: number;
  items: PolicyItem[];
}

interface FilterState {
  tradingTier: string;
  operationType: string;
}

/* ── Helpers ─────────────────────────────────────────────────── */

const fmt = (v?: string | null): string => {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString();
};

const fmtAmount = (v?: string | null): string => {
  if (!v) return '—';
  const n = parseFloat(v);
  return Number.isNaN(n) ? v : n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
};

/* ── Constants ───────────────────────────────────────────────── */

const PAGE_SIZE = 20;

const DEFAULT_FILTERS: FilterState = {
  tradingTier: '',
  operationType: '',
};

/* ── Component ───────────────────────────────────────────────── */

const TransactionLimitList = () => {
  const navigate = useNavigate();

  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [items, setItems] = useState<PolicyItem[]>([]);
  const [total, setTotal] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const requestSeqRef = useRef(0);

  /* ── Data fetching ── */

  const buildParams = (page: number, next: FilterState) => {
    const params = new URLSearchParams();
    params.set('skip', String((page - 1) * PAGE_SIZE));
    params.set('take', String(PAGE_SIZE));
    if (next.tradingTier) params.set('tradingTier', next.tradingTier);
    if (next.operationType) params.set('operationType', next.operationType);
    return params;
  };

  const fetchItems = async (page: number, next: FilterState = filters) => {
    const seq = ++requestSeqRef.current;
    setLoading(true);
    setError(null);
    try {
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/transaction-limit-policies?${buildParams(page, next).toString()}`,
      );
      if (!res.ok) throw new Error(await getApiErrorMessage(res, 'Failed to load policies.'));

      const data = (await res.json()) as PolicyListResponse;
      if (seq !== requestSeqRef.current) return;
      setItems(Array.isArray(data.items) ? data.items : []);
      setTotal(typeof data.total === 'number' ? data.total : 0);
      setCurrentPage(page);
    } catch (err) {
      if (seq !== requestSeqRef.current) return;
      if (err instanceof AdminSessionError) return;
      setError(err instanceof Error ? err.message : 'Failed to load policies.');
    } finally {
      if (seq === requestSeqRef.current) setLoading(false);
    }
  };

  useEffect(() => { void fetchItems(1, DEFAULT_FILTERS); }, []);

  /* ── Input style ── */
  const fi =
    'h-[30px] rounded border border-adm-border bg-adm-bg px-2.5 font-mono text-[11px] text-adm-t1 placeholder:text-adm-t3 outline-none focus:border-adm-amber transition-colors';

  const hasFilter = !!filters.tradingTier || !!filters.operationType;

  const updateFilter = (key: keyof FilterState, value: string) =>
    setFilters((prev) => ({ ...prev, [key]: value }));

  const handleSearch = () => void fetchItems(1, filters);

  const handleReset = () => {
    setFilters(DEFAULT_FILTERS);
    void fetchItems(1, DEFAULT_FILTERS);
  };

  /* ── Table header style ── */
  const th =
    'px-3 py-2 text-left font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-adm-t3';

  /* ── Render ── */

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* ─── Zone 1: Title ─── */}
      <PageTitleBar
        title="Transaction Limits"
        subtitle={`${total} policies · Daily Limits`}
      />

      {/* ─── Error banner ─── */}
      {error && (
        <div className="shrink-0 border-b border-adm-border bg-adm-danger/5 px-4 py-2 font-mono text-[11px] text-adm-danger">
          {error}
        </div>
      )}

      {/* ─── Zone 2: Filter bar ─── */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-adm-border px-4 py-2">
        <select
          className={`${fi} w-[130px]`}
          value={filters.tradingTier}
          onChange={(e) => updateFilter('tradingTier', e.target.value)}
        >
          <option value="">All tiers</option>
          <option value="BASIC">BASIC</option>
          <option value="PREMIUM">PREMIUM</option>
        </select>
        <select
          className={`${fi} w-[150px]`}
          value={filters.operationType}
          onChange={(e) => updateFilter('operationType', e.target.value)}
        >
          <option value="">All operations</option>
          <option value="WITHDRAWAL">WITHDRAWAL</option>
          <option value="SWAP">SWAP</option>
        </select>

        <button onClick={handleSearch} className={adminButtonClass('listPrimary')}>
          Search
        </button>
        <button
          onClick={handleReset}
          disabled={!hasFilter}
          className={adminButtonClass('listSecondary')}
        >
          Reset
        </button>

        <button
          onClick={() => void fetchItems(currentPage, filters)}
          className={adminIconButtonClass()}
          title="Refresh"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* ─── Zone 3: Table ─── */}
      <div className="flex-1 overflow-y-auto">
        <table className="w-full border-collapse text-[11px]">
          <thead className="sticky top-0 z-10 bg-adm-panel">
            <tr className="border-b border-adm-border">
              <th className={th} style={{ width: 110 }}>Policy No</th>
              <th className={th} style={{ width: 100 }}>Trading Tier</th>
              <th className={th} style={{ width: 120 }}>Operation</th>
              <th className={th} style={{ width: 80 }}>Period</th>
              <th className={th} style={{ width: 140 }}>Limit (AED)</th>
              <th className={th} style={{ width: 80 }}>Status</th>
              <th className={th} style={{ width: 140 }}>Updated</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && !loading ? (
              <tr>
                <td colSpan={7} className="px-3 py-12 text-center text-[11px] text-adm-t3">
                  No policies found
                </td>
              </tr>
            ) : (
              items.map((p) => (
                <tr
                  key={p.id}
                  className="cursor-pointer border-b border-adm-border hover:bg-adm-hover"
                  onClick={() => navigate(`/dashboard/system/transaction-limits/${p.policyNo}`)}
                >
                  <td className="px-3 py-2">
                    <button
                      className={adminButtonClass('rowKeyLink')}
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(`/dashboard/system/transaction-limits/${p.policyNo}`);
                      }}
                      title={p.policyNo}
                    >
                      {p.policyNo}
                    </button>
                  </td>
                  <td className="px-3 py-2">
                    <AdminBadge value={p.tradingTier} />
                  </td>
                  <td className="px-3 py-2">
                    <AdminBadge value={p.operationType} />
                  </td>
                  <td className="px-3 py-2 font-mono text-adm-t2">
                    {p.period}
                  </td>
                  <td className="px-3 py-2 font-mono text-adm-t1 font-semibold">
                    {fmtAmount(p.limitAmount)}
                  </td>
                  <td className="px-3 py-2">
                    <AdminBadge value={p.status} />
                  </td>
                  <td className="px-3 py-2 font-mono text-[10px] text-adm-t2">
                    {fmt(p.updatedAt)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* ─── Zone 4: Footer ─── */}
      <div className="flex shrink-0 items-center justify-between border-t border-adm-border px-4 py-2 text-[10px] text-adm-t3">
        <span>
          Showing {items.length} / {total} policies
        </span>
        <Pagination
          currentPage={currentPage}
          totalItems={total}
          pageSize={PAGE_SIZE}
          onPageChange={(p: number) => void fetchItems(p, filters)}
        />
      </div>
    </div>
  );
};

export default TransactionLimitList;
```

- [ ] **Step 2: Verify frontend compiles**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/admin-web && npx tsc --noEmit --pretty 2>&1 | head -20
```

Expected: No errors (or only errors from the still-missing TransactionLimitDetail).

- [ ] **Step 3: Commit**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js && git add admin-web/src/pages/TransactionLimitList.tsx && git commit -m "$(cat <<'EOF'
feat: add TransactionLimitList page

Admin list page with tradingTier/operationType filters, paginated table
showing policy no, tier, operation, period, limit amount, status.
EOF
)"
```

---

## Task 12: Transaction Limit Detail Page

**Files:**
- Create: `admin-web/src/pages/TransactionLimitDetail.tsx`

- [ ] **Step 1: Create detail page**

Create `admin-web/src/pages/TransactionLimitDetail.tsx`:

```tsx
import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { X, Pencil } from 'lucide-react';
import { AdminSessionError, adminFetch, getApiErrorMessage } from '../utils/adminFetch';
import { adminButtonClass } from '../components/common/adminButtonStyles';
import { DetailPageHeader, InfoField } from '../components/compliance/DetailPageComponents';
import { AdminBadge } from '../components/ui/AdminBadge';

/* ── Interfaces ──────────────────────────────────────────────── */

interface PolicyDetailData {
  id: string;
  policyNo: string;
  tradingTier: string;
  operationType: string;
  period: string;
  limitAmount: string;
  status: string;
  approvalCaseId: string | null;
  createdAt: string;
  updatedAt: string;
}

/* ── Helpers ─────────────────────────────────────────────────── */

const fmt = (v?: string | null): string => {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString();
};

const fmtAmount = (v?: string | null): string => {
  if (!v) return '—';
  const n = parseFloat(v);
  return Number.isNaN(n) ? v : n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
};

/* ── Layout primitives ── */

const Cap = ({ children }: { children: ReactNode }) => (
  <p className="font-mono text-[8.5px] font-semibold uppercase tracking-[0.16em] text-adm-t3">
    {children}
  </p>
);

const SidebarGroup = ({ title, children }: { title: string; children: ReactNode }) => (
  <div className="border-b border-adm-border py-4 last:border-b-0">
    <Cap>{title}</Cap>
    <div className="mt-2.5 flex flex-col gap-1.5">{children}</div>
  </div>
);

const SidebarKV = ({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: ReactNode;
  mono?: boolean;
}) => {
  if (value === null || value === undefined || value === '' || value === '—') return null;
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="shrink-0 font-mono text-[9px] text-adm-t3">{label}</span>
      <span
        className={[
          'min-w-0 break-all text-right text-adm-t2',
          mono ? 'font-mono text-[10px]' : 'text-[11px]',
        ].join(' ')}
      >
        {value}
      </span>
    </div>
  );
};

/* ── Main Component ──────────────────────────────────────────── */

export default function TransactionLimitDetail() {
  const { policyNo } = useParams<{ policyNo: string }>();
  const navigate = useNavigate();

  const [policy, setPolicy] = useState<PolicyDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [showEditModal, setShowEditModal] = useState(false);
  const [newAmount, setNewAmount] = useState('');
  const [changeReason, setChangeReason] = useState('');
  const [submittingEdit, setSubmittingEdit] = useState(false);

  const fetchDetail = async () => {
    if (!policyNo) return;
    setLoading(true);
    setError(null);
    try {
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/transaction-limit-policies/${policyNo}`,
      );
      if (!res.ok) throw new Error(await getApiErrorMessage(res, 'Failed to load policy detail.'));
      setPolicy(await res.json());
    } catch (err) {
      if (err instanceof AdminSessionError) return;
      setError(err instanceof Error ? err.message : 'Failed to load policy detail.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void fetchDetail(); }, [policyNo]);

  useEffect(() => {
    if (!notice) return undefined;
    const t = window.setTimeout(() => setNotice((c) => (c === notice ? null : c)), 4000);
    return () => window.clearTimeout(t);
  }, [notice]);

  /* ── Edit Limit action ── */

  const handleSubmitEdit = async () => {
    if (!policyNo || !newAmount.trim() || !changeReason.trim()) return;
    const amount = parseFloat(newAmount);
    if (Number.isNaN(amount) || amount <= 0) return;

    setSubmittingEdit(true);
    try {
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/transaction-limit-policies/${policyNo}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ limitAmount: amount, changeReason: changeReason.trim() }),
        },
      );
      if (!res.ok) throw new Error(await getApiErrorMessage(res, 'Failed to submit limit change'));
      const data = await res.json();
      setShowEditModal(false);
      setNewAmount('');
      setChangeReason('');
      setNotice(`Limit change submitted for approval (${data.approvalNo}).`);
      void fetchDetail();
    } catch (err) {
      if (err instanceof AdminSessionError) return;
      setError(err instanceof Error ? err.message : 'Failed to submit limit change.');
    } finally {
      setSubmittingEdit(false);
    }
  };

  /* ── Loading / Error states ── */

  if (loading && !policy) {
    return (
      <div className="flex min-h-[320px] flex-col items-center justify-center">
        <div className="animate-spin rounded-full h-6 w-6 border-2 border-adm-amber border-t-transparent" />
        <p className="mt-3 font-mono text-[11px] text-adm-t3">Loading policy…</p>
      </div>
    );
  }

  if (!policy) {
    return (
      <div className="space-y-4 rounded border border-adm-red/30 bg-adm-red/10 p-8 text-center">
        <div className="font-mono text-[11px] text-adm-red">{error || 'Policy not found'}</div>
        <div className="flex items-center justify-center gap-3">
          <button onClick={() => navigate('/dashboard/system/transaction-limits')} className={adminButtonClass('detailUtility')}>
            Back to Limits
          </button>
          <button onClick={() => void fetchDetail()} className={adminButtonClass('detailUtility')}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* ── Header ── */}
      <DetailPageHeader
        onBack={() => navigate('/dashboard/system/transaction-limits')}
        onRefresh={() => void fetchDetail()}
        refreshing={loading}
      />

      {/* ── Inline notices ── */}
      {(notice || error) && (
        <div className="shrink-0 px-6 pt-3 pb-1 space-y-2">
          {notice && (
            <div className="rounded border border-adm-green/30 bg-adm-green/10 px-4 py-2 font-mono text-[11px] text-adm-green">
              {notice}
            </div>
          )}
          {error && (
            <div className="rounded border border-adm-red/30 bg-adm-red/10 px-4 py-2 font-mono text-[11px] text-adm-red">
              {error}
            </div>
          )}
        </div>
      )}

      {/* ── Body: two-column layout ── */}
      <div className="flex min-h-0 flex-1 overflow-hidden">

        {/* ════ LEFT MAIN ════ */}
        <div className="flex min-w-0 flex-1 flex-col divide-y divide-adm-border overflow-y-auto">

          {/* ① Hero */}
          <section className="bg-adm-card px-6 py-5">
            <p className="mt-1.5 font-mono text-[19px] font-bold leading-snug text-adm-amber">
              {policy.policyNo}
            </p>
            <div className="mt-2.5 flex items-center gap-2">
              <AdminBadge value={policy.tradingTier} />
              <AdminBadge value={policy.operationType} />
              <AdminBadge value={policy.period} />
              <AdminBadge value={policy.status} />
            </div>
          </section>

          {/* ② Core Context */}
          <section className="px-6 py-5">
            <Cap>Limit Configuration</Cap>
            <div className="mt-3 grid grid-cols-2 gap-x-8 gap-y-4">
              <InfoField label="Daily Limit (AED)" value={fmtAmount(policy.limitAmount)} mono />
              <InfoField label="Status" value={<AdminBadge value={policy.status} />} />
              <InfoField label="Trading Tier" value={policy.tradingTier} />
              <InfoField label="Operation Type" value={policy.operationType} />
              <InfoField label="Period" value={policy.period} />
            </div>
          </section>

        </div>

        {/* ════ RIGHT SIDEBAR ════ */}
        <div className="w-[272px] min-w-[272px] overflow-y-auto border-l border-adm-border bg-adm-panel px-4 py-1">

          {/* Actions */}
          {policy.status === 'ACTIVE' && (
            <div className="border-b border-adm-border py-4">
              <Cap>Actions</Cap>
              <div className="mt-2.5 flex flex-col gap-2">
                <button
                  onClick={() => {
                    setNewAmount('');
                    setChangeReason('');
                    setShowEditModal(true);
                  }}
                  className={adminButtonClass('workflowPrimary')}
                >
                  <Pencil size={13} />
                  Edit Limit
                </button>
              </div>
            </div>
          )}

          {/* Identity Summary */}
          <SidebarGroup title="Identity">
            <SidebarKV label="Trading Tier" value={policy.tradingTier} />
            <SidebarKV label="Operation" value={policy.operationType} />
            <SidebarKV label="Period" value={policy.period} />
          </SidebarGroup>

          {/* Lifecycle */}
          <SidebarGroup title="Lifecycle">
            <SidebarKV label="Created" value={fmt(policy.createdAt)} mono />
            <SidebarKV label="Updated" value={fmt(policy.updatedAt)} mono />
          </SidebarGroup>

        </div>
      </div>

      {/* ════ Edit Limit Modal ════ */}
      {showEditModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md overflow-hidden rounded-xl border border-adm-border bg-adm-panel shadow-xl">

            <div className="flex items-center justify-between border-b border-adm-border bg-adm-card px-5 py-4">
              <div>
                <p className="font-mono text-[11px] font-semibold text-adm-t1">
                  Edit Limit
                </p>
                <p className="mt-1 font-mono text-[9px] text-adm-t3">
                  {policy.policyNo} · {policy.tradingTier} · {policy.operationType}
                </p>
              </div>
              <button
                onClick={() => setShowEditModal(false)}
                className="rounded p-1 text-adm-t3 hover:bg-adm-hover hover:text-adm-t1"
              >
                <X size={15} />
              </button>
            </div>

            <div className="px-5 py-4 space-y-3">
              <div className="rounded border border-adm-amber/30 bg-adm-amber/10 px-3 py-2.5 font-mono text-[10px] text-adm-amber leading-relaxed">
                This will submit a limit change request for MLRO → SMO approval.
                The current limit remains in effect until the change is approved.
              </div>

              <div>
                <p className="mb-1.5 font-mono text-[8.5px] uppercase tracking-[0.14em] text-adm-t3">
                  Current Limit (AED)
                </p>
                <p className="font-mono text-[13px] font-semibold text-adm-t1">
                  {fmtAmount(policy.limitAmount)}
                </p>
              </div>

              <div>
                <p className="mb-1.5 font-mono text-[8.5px] uppercase tracking-[0.14em] text-adm-t3">
                  New Limit (AED)
                </p>
                <input
                  type="number"
                  min="0.01"
                  step="any"
                  value={newAmount}
                  onChange={(e) => setNewAmount(e.target.value)}
                  placeholder="Enter new limit amount"
                  className="w-full rounded border border-adm-border bg-adm-bg px-3 py-2 font-mono text-[11px] text-adm-t1 placeholder:text-adm-t3 focus:border-adm-amber focus:outline-none transition-colors"
                  autoFocus
                />
              </div>

              <div>
                <p className="mb-1.5 font-mono text-[8.5px] uppercase tracking-[0.14em] text-adm-t3">
                  Reason for Change
                </p>
                <textarea
                  value={changeReason}
                  onChange={(e) => setChangeReason(e.target.value)}
                  rows={3}
                  placeholder="Describe why this limit should be changed…"
                  className="w-full rounded border border-adm-border bg-adm-bg px-3 py-2 font-mono text-[10px] text-adm-t2 placeholder:text-adm-t3 focus:border-adm-amber focus:outline-none resize-none transition-colors"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 border-t border-adm-border bg-adm-card px-5 py-4">
              <button onClick={() => setShowEditModal(false)} className={adminButtonClass('modalCancel')}>
                Cancel
              </button>
              <button
                onClick={() => void handleSubmitEdit()}
                disabled={submittingEdit || !newAmount.trim() || !changeReason.trim() || parseFloat(newAmount) <= 0}
                className={adminButtonClass('modalConfirm')}
              >
                {submittingEdit ? 'Submitting…' : 'Submit for Approval'}
              </button>
            </div>

          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify frontend compiles**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/admin-web && npx tsc --noEmit --pretty 2>&1 | head -20
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js && git add admin-web/src/pages/TransactionLimitDetail.tsx && git commit -m "$(cat <<'EOF'
feat: add TransactionLimitDetail page with edit limit modal

Two-column detail layout with hero (policyNo amber), core context,
sidebar (actions/identity/lifecycle). Edit Limit modal with current
value display, new amount input, reason textarea. Follows
PlatformMemberDetailPage modal pattern.
EOF
)"
```

---

## Task 13: Roadmap Update

**Files:**
- Modify: `doc-final/reference/roadmap.md`

- [ ] **Step 1: Add Trading Tier Upgrade workflow entry**

Find the V3 section in `doc-final/reference/roadmap.md` and add a new workflow entry after the Transaction Limit Configuration item:

```markdown
- **Trading Tier Upgrade（交易层级升级审批）**: Customer requests upgrade from BASIC → PREMIUM. Pre-check: `riskLevel ≠ HIGH` (auto-reject if HIGH). Approval: MLRO → SMO, `timeoutHours: 48`. On approval: `customer.tradingTier = "PREMIUM"`, customer subject to PREMIUM limit group.
```

- [ ] **Step 2: Commit**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js && git add doc-final/reference/roadmap.md && git commit -m "$(cat <<'EOF'
docs: add Trading Tier Upgrade workflow to roadmap

New V3+ workflow entry: customer-initiated BASIC->PREMIUM upgrade
with risk level veto and MLRO->SMO approval.
EOF
)"
```

---

## Task 14: End-to-End Smoke Test

- [ ] **Step 1: Start backend**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js && npm run dev:start
```

Wait for all services to be ready on ports 3500, 3501, 3502.

- [ ] **Step 2: Verify seed data via API**

```bash
curl -s http://localhost:3500/admin/transaction-limit-policies | jq .
```

Expected: JSON with `{ items: [...4 policies...], total: 4 }`.

- [ ] **Step 3: Verify single policy lookup**

```bash
curl -s http://localhost:3500/admin/transaction-limit-policies/TLP-001 | jq .
```

Expected: JSON with `policyNo: "TLP-001"`, `tradingTier: "BASIC"`, `operationType: "WITHDRAWAL"`, `limitAmount: "30000"`.

- [ ] **Step 4: Verify frontend loads**

Open `http://localhost:3501` in browser, navigate to Control Gates → Transaction Limits. Verify:
- Table shows 4 rows
- Clicking a row navigates to detail page
- Detail page shows hero with policyNo in amber
- "Edit Limit" button visible in sidebar when status is ACTIVE

- [ ] **Step 5: Verify approval policy seeded**

```bash
sqlite3 /tmp/exchange_js_branch/dev.db "SELECT actionType, checkerRoles, timeoutHours FROM approval_action_policies WHERE actionType = 'TRANSACTION_LIMIT_CHANGE';"
```

Expected: `TRANSACTION_LIMIT_CHANGE|MLRO,SMO|48`

Documentation updated: Implementation plan for Transaction Limit Configuration workflow.
