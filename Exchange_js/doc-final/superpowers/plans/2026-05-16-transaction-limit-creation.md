# Transaction Limit Policy Creation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow admins to create new TransactionLimitPolicy rows via MLRO→SMO approval, following the RoleDefinitionCreate pattern.

**Architecture:** New workflow service + approval handler alongside existing change workflow. INSERT row as PENDING_APPROVAL, activate on approval, delete on rejection. Constants file for enum whitelists shared by backend validation and frontend selects.

**Tech Stack:** NestJS, Prisma, React, Tailwind (adm-* tokens)

---

## File Structure

| File | Responsibility |
|------|---------------|
| Create: `src/modules/governance/transaction-limits/constants/limit-policy.constants.ts` | Enum whitelists for tradingTier, operationType, period |
| Create: `src/modules/governance/transaction-limits/dto/create-limit-policy.dto.ts` | DTO with class-validator decorators |
| Create: `src/modules/governance/transaction-limits/transaction-limit-creation-workflow.service.ts` | Orchestration: validate → INSERT → approval → audit; callbacks |
| Create: `src/modules/governance/transaction-limits/transaction-limit-creation-approval.service.ts` | ApprovalHandlerBase extension |
| Modify: `src/modules/governance/transaction-limits/transaction-limits.service.ts` | Add `create()`, `deleteById()`, `generateNextPolicyNo()` |
| Modify: `src/modules/governance/transaction-limits/transaction-limits.controller.ts` | Add POST endpoint |
| Modify: `src/modules/governance/transaction-limits/transaction-limits.module.ts` | Register new services |
| Modify: `src/modules/audit-logging/constants/audit-actions.constant.ts` | Add TRANSACTION_LIMIT_CREATION enums |
| Modify: `src/modules/governance/approvals/constants/approval.constants.ts` | Add TRANSACTION_LIMIT_CREATION action type + policy |
| Modify: `admin-web/src/pages/TransactionLimitList.tsx` | Add Create button + modal |

---

### Task 1: Constants + Audit Enums + Approval Config

**Files:**
- Create: `src/modules/governance/transaction-limits/constants/limit-policy.constants.ts`
- Modify: `src/modules/audit-logging/constants/audit-actions.constant.ts`
- Modify: `src/modules/governance/approvals/constants/approval.constants.ts`

- [ ] **Step 1: Create enum whitelist constants**

```typescript
// src/modules/governance/transaction-limits/constants/limit-policy.constants.ts

export const TRADING_TIERS = ['BASIC', 'PREMIUM'] as const;
export type TradingTier = (typeof TRADING_TIERS)[number];

export const OPERATION_TYPES = ['WITHDRAWAL', 'SWAP'] as const;
export type OperationType = (typeof OPERATION_TYPES)[number];

export const LIMIT_PERIODS = ['DAILY', 'MONTHLY'] as const;
export type LimitPeriod = (typeof LIMIT_PERIODS)[number];
```

- [ ] **Step 2: Add audit enums**

In `src/modules/audit-logging/constants/audit-actions.constant.ts`:

Add to `AuditBusinessWorkflowTypes` (after the `TRANSACTION_LIMIT_CHANGE` line):
```typescript
  // Transaction Limit Creation (2026-05-16)
  TRANSACTION_LIMIT_CREATION: 'TRANSACTION_LIMIT_CREATION',
```

Add to `AuditGovernanceActions` (after the `TRANSACTION_LIMIT_CHANGE` block):
```typescript
  // Transaction Limit Creation (2026-05-16)
  TRANSACTION_LIMIT_CREATION: {
    CREATION_REQUESTED:     'CREATION_REQUESTED',
    APPROVAL_GRANTED:       'APPROVAL_GRANTED',
    APPROVAL_DECLINED:      'APPROVAL_DECLINED',
    APPROVAL_CANCELLED:     'APPROVAL_CANCELLED',
    APPROVAL_EXPIRED:       'APPROVAL_EXPIRED',
    CREATION_APPLIED:       'CREATION_APPLIED',
    CREATION_APPLY_FAILED:  'CREATION_APPLY_FAILED',
    CREATION_CANCELLED:     'CREATION_CANCELLED',
  },
```

- [ ] **Step 3: Add approval action type and policy**

In `src/modules/governance/approvals/constants/approval.constants.ts`:

Add to `ApprovalActionTypes` (after `TRANSACTION_LIMIT_CHANGE`):
```typescript
  // Transaction Limit Creation (2026-05-16)
  TRANSACTION_LIMIT_CREATION: 'TRANSACTION_LIMIT_CREATION',
```

Add to `DEFAULT_APPROVAL_POLICIES` (after the `TRANSACTION_LIMIT_CHANGE` block):
```typescript
  // ─── Transaction Limit Creation (2026-05-16) ────
  [ApprovalActionTypes.TRANSACTION_LIMIT_CREATION]: {
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

Add to `V1_APPROVAL_ACTION_TYPES` array (after `ApprovalActionTypes.TRANSACTION_LIMIT_CHANGE`):
```typescript
  ApprovalActionTypes.TRANSACTION_LIMIT_CREATION,
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `npx tsc --noEmit 2>&1 | tail -5`
Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add src/modules/governance/transaction-limits/constants/limit-policy.constants.ts \
  src/modules/audit-logging/constants/audit-actions.constant.ts \
  src/modules/governance/approvals/constants/approval.constants.ts
git commit -m "feat: add constants, audit enums, and approval config for transaction limit creation"
```

---

### Task 2: Domain Service Methods

**Files:**
- Modify: `src/modules/governance/transaction-limits/transaction-limits.service.ts`

- [ ] **Step 1: Add create, deleteById, and generateNextPolicyNo methods**

Add the following methods to `TransactionLimitsService`:

```typescript
  async generateNextPolicyNo(): Promise<string> {
    const last = await this.prisma.transactionLimitPolicy.findFirst({
      orderBy: { policyNo: 'desc' },
      select: { policyNo: true },
    });
    if (!last) return 'TLP-001';
    const num = parseInt(last.policyNo.replace('TLP-', ''), 10);
    return `TLP-${String(num + 1).padStart(3, '0')}`;
  }

  async create(
    data: {
      policyNo: string;
      tradingTier: string;
      operationType: string;
      period: string;
      limitAmount: Prisma.Decimal;
      status: string;
    },
    tx?: any,
  ) {
    const db = tx ?? this.prisma;
    return db.transactionLimitPolicy.create({ data });
  }

  async deleteById(id: string, tx?: any) {
    const db = tx ?? this.prisma;
    return db.transactionLimitPolicy.delete({ where: { id } });
  }

  async findById(id: string) {
    const policy = await this.prisma.transactionLimitPolicy.findUnique({
      where: { id },
    });
    if (!policy) {
      throw new NotFoundException(`Transaction limit policy not found: ${id}`);
    }
    return policy;
  }
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit 2>&1 | tail -5`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/modules/governance/transaction-limits/transaction-limits.service.ts
git commit -m "feat: add create, deleteById, findById, generateNextPolicyNo to TransactionLimitsService"
```

---

### Task 3: DTO

**Files:**
- Create: `src/modules/governance/transaction-limits/dto/create-limit-policy.dto.ts`

- [ ] **Step 1: Create the DTO**

```typescript
// src/modules/governance/transaction-limits/dto/create-limit-policy.dto.ts

import { IsIn, IsNotEmpty, IsNumber, IsString, Min } from 'class-validator';
import {
  TRADING_TIERS,
  OPERATION_TYPES,
  LIMIT_PERIODS,
} from '../constants/limit-policy.constants';

export class CreateLimitPolicyDto {
  @IsString()
  @IsNotEmpty()
  @IsIn([...TRADING_TIERS])
  tradingTier!: string;

  @IsString()
  @IsNotEmpty()
  @IsIn([...OPERATION_TYPES])
  operationType!: string;

  @IsString()
  @IsNotEmpty()
  @IsIn([...LIMIT_PERIODS])
  period!: string;

  @IsNumber()
  @Min(0.01)
  limitAmount!: number;

  @IsString()
  @IsNotEmpty()
  reason!: string;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit 2>&1 | tail -5`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/modules/governance/transaction-limits/dto/create-limit-policy.dto.ts
git commit -m "feat: add CreateLimitPolicyDto with enum validation"
```

---

### Task 4: Approval Handler

**Files:**
- Create: `src/modules/governance/transaction-limits/transaction-limit-creation-approval.service.ts`

- [ ] **Step 1: Create the approval handler**

```typescript
// src/modules/governance/transaction-limits/transaction-limit-creation-approval.service.ts

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
export class TransactionLimitCreationApprovalService extends ApprovalHandlerBase {
  readonly actionType = ApprovalActionTypes.TRANSACTION_LIMIT_CREATION;
  readonly workflowType = AuditBusinessWorkflowTypes.TRANSACTION_LIMIT_CREATION;
  readonly auditActions = {
    granted: AuditGovernanceActions.TRANSACTION_LIMIT_CREATION.APPROVAL_GRANTED,
    declined: AuditGovernanceActions.TRANSACTION_LIMIT_CREATION.APPROVAL_DECLINED,
    cancelled: AuditGovernanceActions.TRANSACTION_LIMIT_CREATION.APPROVAL_CANCELLED,
    expired: AuditGovernanceActions.TRANSACTION_LIMIT_CREATION.APPROVAL_EXPIRED,
  };
  readonly entityType = AuditEntityTypes.TRANSACTION_LIMIT_POLICY;

  constructor(auditLogsService: AuditLogsService, eventEmitter: EventEmitter2) {
    super(auditLogsService, eventEmitter);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/governance/transaction-limits/transaction-limit-creation-approval.service.ts
git commit -m "feat: add TransactionLimitCreationApprovalService"
```

---

### Task 5: Workflow Service

**Files:**
- Create: `src/modules/governance/transaction-limits/transaction-limit-creation-workflow.service.ts`

- [ ] **Step 1: Create the workflow service**

```typescript
// src/modules/governance/transaction-limits/transaction-limit-creation-workflow.service.ts

import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
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
import {
  ApprovalActionTypes,
  ApprovalActorContext,
} from '../approvals/constants/approval.constants';
import { TransactionLimitsService } from './transaction-limits.service';
import {
  TRADING_TIERS,
  OPERATION_TYPES,
  LIMIT_PERIODS,
} from './constants/limit-policy.constants';

const SECONDARY_EVENT = 'workflow.transaction-limit-creation.decided';

const SYSTEM_ACTOR: ApprovalActorContext = {
  actorType: 'ADMIN',
  userId: 'SYSTEM',
  userNo: 'SYSTEM',
  role: 'SYSTEM',
  roleCodes: ['SYSTEM'],
};

@Injectable()
export class TransactionLimitCreationWorkflowService {
  private readonly logger = new Logger(TransactionLimitCreationWorkflowService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly limitsService: TransactionLimitsService,
    private readonly approvalsService: ApprovalsService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  async initiateCreate(
    dto: {
      tradingTier: string;
      operationType: string;
      period: string;
      limitAmount: number;
      reason: string;
    },
    actor: ApprovalActorContext,
  ) {
    const { tradingTier, operationType, period, limitAmount, reason } = dto;

    // Validate enum fields
    if (!TRADING_TIERS.includes(tradingTier as any)) {
      throw new BadRequestException(`Invalid tradingTier: ${tradingTier}. Must be one of: ${TRADING_TIERS.join(', ')}`);
    }
    if (!OPERATION_TYPES.includes(operationType as any)) {
      throw new BadRequestException(`Invalid operationType: ${operationType}. Must be one of: ${OPERATION_TYPES.join(', ')}`);
    }
    if (!LIMIT_PERIODS.includes(period as any)) {
      throw new BadRequestException(`Invalid period: ${period}. Must be one of: ${LIMIT_PERIODS.join(', ')}`);
    }
    if (limitAmount <= 0) {
      throw new BadRequestException('limitAmount must be greater than 0');
    }
    if (!reason?.trim()) {
      throw new BadRequestException('reason is required');
    }

    // Check uniqueness: no existing row (ACTIVE or PENDING_APPROVAL) for this combo
    const existing = await this.prisma.transactionLimitPolicy.findFirst({
      where: { tradingTier, operationType, period },
    });
    if (existing) {
      throw new BadRequestException(
        `A policy for [${tradingTier}, ${operationType}, ${period}] already exists (${existing.policyNo}, status: ${existing.status})`,
      );
    }

    // Generate policyNo
    const policyNo = await this.limitsService.generateNextPolicyNo();

    // INSERT with PENDING_APPROVAL
    const policy = await this.limitsService.create({
      policyNo,
      tradingTier,
      operationType,
      period,
      limitAmount: new Prisma.Decimal(limitAmount),
      status: 'PENDING_APPROVAL',
    });

    // Create approval case
    const traceId = crypto.randomUUID();
    let approvalCase: any;
    try {
      approvalCase = await this.approvalsService.createAndSubmit(
        {
          actionType: ApprovalActionTypes.TRANSACTION_LIMIT_CREATION,
          entityRef: policy.id,
          workflowType: AuditBusinessWorkflowTypes.TRANSACTION_LIMIT_CREATION,
          workflowId: policy.id,
          workflowNo: policyNo,
          traceId,
          objectSnapshot: {
            policyId: policy.id,
            policyNo,
            tradingTier,
            operationType,
            period,
            limitAmount: String(limitAmount),
            reason,
          },
        },
        {
          reason,
          traceId,
        },
        actor,
      );
    } catch (err) {
      // Rollback: delete the inserted row
      await this.limitsService.deleteById(policy.id);
      throw err;
    }

    // Link approval case to policy
    await this.prisma.transactionLimitPolicy.update({
      where: { id: policy.id },
      data: { approvalCaseId: approvalCase.id },
    });

    // Audit
    await this.auditLogsService.recordByActor(
      {
        action: AuditGovernanceActions.TRANSACTION_LIMIT_CREATION.CREATION_REQUESTED,
        entityType: AuditEntityTypes.TRANSACTION_LIMIT_POLICY,
        entityId: policy.id,
        entityNo: policyNo,
        workflowType: AuditBusinessWorkflowTypes.TRANSACTION_LIMIT_CREATION,
        traceId,
        result: AuditResult.SUCCESS,
        metadata: {
          tradingTier,
          operationType,
          period,
          limitAmount: String(limitAmount),
          reason,
          approvalNo: approvalCase.approvalNo,
        },
        requestId: `TRANSACTION_LIMIT_CREATION_REQUESTED_${policyNo}`,
        sourcePlatform: 'ADMIN_API',
      },
      {
        actorType: 'ADMIN',
        actorId: actor.userId,
        actorNo: actor.userNo,
        actorRole: actor.role || actor.roleCodes[0] || 'UNKNOWN',
      },
    );

    return {
      policyNo,
      approvalNo: approvalCase.approvalNo,
      status: 'PENDING_APPROVAL',
    };
  }

  @OnEvent(SECONDARY_EVENT, { async: true })
  async onDecided(payload: any) {
    const decision = payload?.decision;
    const approvalId = payload?.approvalId;
    const entityRef = payload?.entityRef;

    if (!approvalId || !entityRef) {
      this.logger.warn('Transaction limit creation decided event missing approvalId or entityRef');
      return;
    }

    if (decision === 'APPROVED') {
      await this.executeActivation(approvalId, entityRef, payload);
    } else {
      await this.executeCancellation(approvalId, entityRef, decision, payload);
    }
  }

  private async executeActivation(approvalId: string, policyId: string, event: any) {
    try {
      const policy = await this.prisma.transactionLimitPolicy.findUnique({
        where: { id: policyId },
      });
      if (!policy || policy.status !== 'PENDING_APPROVAL') {
        this.logger.warn(`Policy ${policyId} not found or not in PENDING_APPROVAL status`);
        await this.approvalsService.markExecutionResult(
          approvalId,
          false,
          SYSTEM_ACTOR,
          'Policy not found or wrong status',
        );
        return;
      }

      // Activate
      await this.prisma.transactionLimitPolicy.update({
        where: { id: policy.id },
        data: { status: 'ACTIVE', approvalCaseId: null },
      });

      await this.approvalsService.markExecutionResult(
        approvalId,
        true,
        SYSTEM_ACTOR,
        `Policy ${policy.policyNo} activated successfully`,
      );

      await this.auditLogsService.recordSystem({
        action: AuditGovernanceActions.TRANSACTION_LIMIT_CREATION.CREATION_APPLIED,
        entityType: AuditEntityTypes.TRANSACTION_LIMIT_POLICY,
        entityId: policy.id,
        entityNo: policy.policyNo,
        workflowType: AuditBusinessWorkflowTypes.TRANSACTION_LIMIT_CREATION,
        traceId: event?.traceId,
        result: AuditResult.SUCCESS,
        metadata: {
          tradingTier: policy.tradingTier,
          operationType: policy.operationType,
          period: policy.period,
          limitAmount: policy.limitAmount.toString(),
        },
        requestId: `TRANSACTION_LIMIT_CREATION_APPLIED_${policy.policyNo}`,
        sourcePlatform: 'SYSTEM',
      });

      this.logger.log(`Policy ${policy.policyNo} activated`);
    } catch (err: any) {
      this.logger.error(`Failed to activate policy ${policyId}: ${err.message}`);
      await this.approvalsService.markExecutionResult(
        approvalId,
        false,
        SYSTEM_ACTOR,
        err.message,
      );

      await this.auditLogsService.recordSystem({
        action: AuditGovernanceActions.TRANSACTION_LIMIT_CREATION.CREATION_APPLY_FAILED,
        entityType: AuditEntityTypes.TRANSACTION_LIMIT_POLICY,
        entityId: policyId,
        workflowType: AuditBusinessWorkflowTypes.TRANSACTION_LIMIT_CREATION,
        traceId: event?.traceId,
        result: AuditResult.FAILED,
        metadata: { error: err.message },
        requestId: `TRANSACTION_LIMIT_CREATION_APPLY_FAILED_${policyId}`,
        sourcePlatform: 'SYSTEM',
      });
    }
  }

  private async executeCancellation(
    approvalId: string,
    policyId: string,
    decision: string,
    event: any,
  ) {
    try {
      const policy = await this.prisma.transactionLimitPolicy.findUnique({
        where: { id: policyId },
      });
      if (!policy) {
        this.logger.warn(`Policy ${policyId} not found for cancellation`);
        return;
      }

      // Physical delete
      await this.prisma.transactionLimitPolicy.delete({ where: { id: policy.id } });

      await this.auditLogsService.recordSystem({
        action: AuditGovernanceActions.TRANSACTION_LIMIT_CREATION.CREATION_CANCELLED,
        entityType: AuditEntityTypes.TRANSACTION_LIMIT_POLICY,
        entityId: policy.id,
        entityNo: policy.policyNo,
        workflowType: AuditBusinessWorkflowTypes.TRANSACTION_LIMIT_CREATION,
        traceId: event?.traceId,
        result: AuditResult.SUCCESS,
        metadata: { decision },
        requestId: `TRANSACTION_LIMIT_CREATION_CANCELLED_${policy.policyNo}`,
        sourcePlatform: 'SYSTEM',
      });

      this.logger.log(`Policy ${policy.policyNo} creation cancelled (${decision}), row deleted`);
    } catch (err: any) {
      this.logger.error(`Failed to cancel policy creation ${policyId}: ${err.message}`);
    }
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit 2>&1 | tail -5`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/modules/governance/transaction-limits/transaction-limit-creation-workflow.service.ts
git commit -m "feat: add TransactionLimitCreationWorkflowService"
```

---

### Task 6: Controller Endpoint + Module Wiring

**Files:**
- Modify: `src/modules/governance/transaction-limits/transaction-limits.controller.ts`
- Modify: `src/modules/governance/transaction-limits/transaction-limits.module.ts`

- [ ] **Step 1: Add POST endpoint to controller**

Add import at the top of `transaction-limits.controller.ts`:
```typescript
import { Post } from '@nestjs/common';
import { TransactionLimitCreationWorkflowService } from './transaction-limit-creation-workflow.service';
import { CreateLimitPolicyDto } from './dto/create-limit-policy.dto';
```

Update constructor to inject the creation workflow:
```typescript
  constructor(
    private readonly limitsService: TransactionLimitsService,
    private readonly workflowService: TransactionLimitChangeWorkflowService,
    private readonly creationWorkflowService: TransactionLimitCreationWorkflowService,
  ) {}
```

Add the POST endpoint (before the PATCH handler):
```typescript
  @Post()
  @RequirePermissions(buildPermissionCode('POST', '/admin/transaction-limit-policies'))
  async create(
    @Body() dto: CreateLimitPolicyDto,
    @Req() req: any,
  ) {
    this.ensureAdmin(req);
    return this.creationWorkflowService.initiateCreate(
      {
        tradingTier: dto.tradingTier,
        operationType: dto.operationType,
        period: dto.period,
        limitAmount: dto.limitAmount,
        reason: dto.reason,
      },
      this.buildAdminActor(req),
    );
  }
```

- [ ] **Step 2: Register new services in module**

Update `transaction-limits.module.ts`:

Add imports:
```typescript
import { TransactionLimitCreationWorkflowService } from './transaction-limit-creation-workflow.service';
import { TransactionLimitCreationApprovalService } from './transaction-limit-creation-approval.service';
```

Add to `providers` array:
```typescript
    TransactionLimitCreationWorkflowService,
    TransactionLimitCreationApprovalService,
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit 2>&1 | tail -5`
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add src/modules/governance/transaction-limits/transaction-limits.controller.ts \
  src/modules/governance/transaction-limits/transaction-limits.module.ts
git commit -m "feat: add POST endpoint and wire creation services in module"
```

---

### Task 7: Frontend — Create Button + Modal

**Files:**
- Modify: `admin-web/src/pages/TransactionLimitList.tsx`

- [ ] **Step 1: Add create modal state and submit handler**

Add to the imports section at the top:
```typescript
import { Plus } from 'lucide-react';
```

Add state variables inside the component (after existing state):
```typescript
  /* ── Create modal state ── */
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createForm, setCreateForm] = useState({
    tradingTier: 'BASIC',
    operationType: 'WITHDRAWAL',
    period: 'DAILY',
    limitAmount: '',
    reason: '',
  });
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const openCreateModal = () => {
    setCreateForm({ tradingTier: 'BASIC', operationType: 'WITHDRAWAL', period: 'DAILY', limitAmount: '', reason: '' });
    setCreateError(null);
    setShowCreateModal(true);
  };
  const closeCreateModal = () => setShowCreateModal(false);

  const handleCreateSubmit = async () => {
    const amt = parseFloat(createForm.limitAmount);
    if (!amt || amt <= 0) { setCreateError('Amount must be > 0'); return; }
    if (!createForm.reason.trim()) { setCreateError('Reason is required'); return; }

    setCreateLoading(true);
    setCreateError(null);
    try {
      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/transaction-limit-policies`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tradingTier: createForm.tradingTier,
            operationType: createForm.operationType,
            period: createForm.period,
            limitAmount: amt,
            reason: createForm.reason.trim(),
          }),
        },
      );
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setCreateError(data.message || 'Failed to submit');
        return;
      }
      const res = await response.json();
      closeCreateModal();
      setNotice(`Policy creation submitted — approval ${res.approvalNo}`);
      fetchData();
    } catch (err: any) {
      setCreateError(err.message || 'Request failed');
    } finally {
      setCreateLoading(false);
    }
  };
```

- [ ] **Step 2: Add Create button to PageTitleBar**

Replace the `<PageTitleBar>` self-closing tag with children:
```tsx
      <PageTitleBar
        title="Transaction Limits"
        meta={`${total} policies · Daily Limits`}
      >
        <button onClick={openCreateModal} className={adminButtonClass('listPrimary')}>
          <Plus size={13} />
          Create Policy
        </button>
      </PageTitleBar>
```

Make sure `adminButtonClass` is imported (check existing imports — it should already be imported from the button utility).

- [ ] **Step 3: Add the Create Modal JSX**

Add before the closing `</div>` of the component (after the pagination section):
```tsx
      {/* ════ Create Policy Modal ════ */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-md rounded-lg border border-adm-border bg-adm-bg shadow-xl">
            {/* Header */}
            <div className="border-b border-adm-border px-5 py-3">
              <h2 className="font-mono text-sm font-semibold text-adm-t1">Create Limit Policy</h2>
            </div>
            {/* Body */}
            <div className="space-y-3 px-5 py-4">
              {createError && (
                <div className="rounded border border-adm-danger/30 bg-adm-danger/5 px-3 py-2 font-mono text-[11px] text-adm-danger">
                  {createError}
                </div>
              )}
              <div>
                <label className="mb-1 block font-mono text-[10px] font-semibold uppercase tracking-wider text-adm-t3">Trading Tier</label>
                <select
                  className="w-full rounded border border-adm-border bg-adm-bg px-3 py-1.5 font-mono text-xs text-adm-t1"
                  value={createForm.tradingTier}
                  onChange={(e) => setCreateForm((f) => ({ ...f, tradingTier: e.target.value }))}
                >
                  <option value="BASIC">BASIC</option>
                  <option value="PREMIUM">PREMIUM</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block font-mono text-[10px] font-semibold uppercase tracking-wider text-adm-t3">Operation Type</label>
                <select
                  className="w-full rounded border border-adm-border bg-adm-bg px-3 py-1.5 font-mono text-xs text-adm-t1"
                  value={createForm.operationType}
                  onChange={(e) => setCreateForm((f) => ({ ...f, operationType: e.target.value }))}
                >
                  <option value="WITHDRAWAL">WITHDRAWAL</option>
                  <option value="SWAP">SWAP</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block font-mono text-[10px] font-semibold uppercase tracking-wider text-adm-t3">Period</label>
                <select
                  className="w-full rounded border border-adm-border bg-adm-bg px-3 py-1.5 font-mono text-xs text-adm-t1"
                  value={createForm.period}
                  onChange={(e) => setCreateForm((f) => ({ ...f, period: e.target.value }))}
                >
                  <option value="DAILY">DAILY</option>
                  <option value="MONTHLY">MONTHLY</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block font-mono text-[10px] font-semibold uppercase tracking-wider text-adm-t3">Limit Amount (AED)</label>
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  className="w-full rounded border border-adm-border bg-adm-bg px-3 py-1.5 font-mono text-xs text-adm-t1"
                  value={createForm.limitAmount}
                  onChange={(e) => setCreateForm((f) => ({ ...f, limitAmount: e.target.value }))}
                  placeholder="e.g. 50000"
                />
              </div>
              <div>
                <label className="mb-1 block font-mono text-[10px] font-semibold uppercase tracking-wider text-adm-t3">Reason</label>
                <textarea
                  className="w-full rounded border border-adm-border bg-adm-bg px-3 py-1.5 font-mono text-xs text-adm-t1"
                  rows={2}
                  value={createForm.reason}
                  onChange={(e) => setCreateForm((f) => ({ ...f, reason: e.target.value }))}
                  placeholder="Why is this policy needed?"
                />
              </div>
            </div>
            {/* Footer */}
            <div className="flex justify-end gap-2 border-t border-adm-border px-5 py-3">
              <button onClick={closeCreateModal} className={adminButtonClass('modalCancel')}>
                Cancel
              </button>
              <button
                onClick={handleCreateSubmit}
                disabled={createLoading || !createForm.limitAmount || !createForm.reason.trim()}
                className={adminButtonClass('workflowPrimary')}
              >
                {createLoading ? 'Submitting…' : 'Submit for Approval'}
              </button>
            </div>
          </div>
        </div>
      )}
```

- [ ] **Step 4: Verify frontend TypeScript compiles**

Run: `cd admin-web && npx tsc --noEmit 2>&1 | tail -5`
Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add admin-web/src/pages/TransactionLimitList.tsx
git commit -m "feat: add Create Policy button and modal to TransactionLimitList"
```

---

### Task 8: E2E Smoke Test

- [ ] **Step 1: Restart backend and verify POST endpoint**

```bash
# Kill and restart
npm run dev:start

# Login
TOKEN=$(curl -s -X POST http://localhost:3500/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@fiatx.com","password":"123456"}' | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

# Test: Create a MONTHLY policy
curl -s -X POST http://localhost:3500/admin/transaction-limit-policies \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"tradingTier":"BASIC","operationType":"WITHDRAWAL","period":"MONTHLY","limitAmount":100000,"reason":"Add monthly limit for basic tier"}' | python3 -m json.tool
```

Expected: `{ "policyNo": "TLP-005", "approvalNo": "APR...", "status": "PENDING_APPROVAL" }`

- [ ] **Step 2: Verify duplicate rejection**

```bash
curl -s -X POST http://localhost:3500/admin/transaction-limit-policies \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"tradingTier":"BASIC","operationType":"WITHDRAWAL","period":"MONTHLY","limitAmount":200000,"reason":"Duplicate test"}' | python3 -m json.tool
```

Expected: 400 error with message about existing policy

- [ ] **Step 3: Verify invalid enum rejection**

```bash
curl -s -X POST http://localhost:3500/admin/transaction-limit-policies \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"tradingTier":"VIP","operationType":"WITHDRAWAL","period":"DAILY","limitAmount":50000,"reason":"Bad tier test"}' | python3 -m json.tool
```

Expected: 400 error (class-validator IsIn rejection)

- [ ] **Step 4: Verify list shows PENDING_APPROVAL row**

```bash
curl -s http://localhost:3500/admin/transaction-limit-policies \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

Expected: 5 items total, one with `status: "PENDING_APPROVAL"`

- [ ] **Step 5: Verify audit log written**

```bash
sqlite3 /tmp/exchange_js_branch/dev.db "
SELECT action, entityNo, result FROM audit_log_events
WHERE workflowType = 'TRANSACTION_LIMIT_CREATION'
ORDER BY rowid DESC LIMIT 5;"
```

Expected: `CREATION_REQUESTED | TLP-005 | SUCCESS`
