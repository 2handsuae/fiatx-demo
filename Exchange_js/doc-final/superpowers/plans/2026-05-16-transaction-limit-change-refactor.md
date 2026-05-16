# Transaction Limit Change Workflow Refactoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the Transaction Limit Change workflow from entity-mutation pattern to request-record pattern, keeping `TransactionLimitPolicy.status` unchanged during approval.

**Architecture:** New `TransactionLimitChangeRequest` Prisma model stores proposed changes. Workflow service is fully rewritten to INSERT a request row, create approval, then on approval execute with conflict detection. Controller replaces PATCH with POST .../change.

**Tech Stack:** NestJS, Prisma, SQLite, React

---

## File Structure

| File | Responsibility |
|------|---------------|
| Modify: `prisma/schema.prisma` | Add `TransactionLimitChangeRequest` model |
| Modify: `src/modules/governance/transaction-limits/transaction-limits.service.ts` | Add `generateNextRequestNo()`, `findChangeRequestById()` |
| Rewrite: `src/modules/governance/transaction-limits/transaction-limit-change-workflow.service.ts` | Full rewrite to request-record pattern |
| Modify: `src/modules/governance/transaction-limits/transaction-limits.controller.ts` | Replace PATCH with POST .../change |
| Modify: `admin-web/src/pages/TransactionLimitDetail.tsx` | Change API call from PATCH to POST |

---

### Task 1: Prisma Migration — Add TransactionLimitChangeRequest Model

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add the new model to schema.prisma**

Add after the `TransactionLimitPolicy` model:

```prisma
model TransactionLimitChangeRequest {
  id                String    @id @default(uuid())
  requestNo         String    @unique @default("TEMP")
  policyId          String
  policyNo          String
  currentAmount     Decimal
  proposedAmount    Decimal
  changeReason      String
  status            String    @default("PENDING_APPROVAL")
  requestedByUserId String
  approvalCaseId    String?
  approvalCaseNo    String?
  executedAt        DateTime?
  failureReason     String?
  createdAt         DateTime  @default(now())
  updatedAt         DateTime  @updatedAt

  @@index([policyId, status])
  @@map("transaction_limit_change_requests")
}
```

- [ ] **Step 2: Generate and apply migration**

Run:
```bash
npx prisma migrate dev --name add_transaction_limit_change_request
```

Expected: Migration created and applied successfully.

- [ ] **Step 3: Verify Prisma client generation**

Run: `npx prisma generate`
Expected: "Generated Prisma Client"

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat: add TransactionLimitChangeRequest Prisma model and migration"
```

---

### Task 2: Domain Service — Add Request Helper Methods

**Files:**
- Modify: `src/modules/governance/transaction-limits/transaction-limits.service.ts`

- [ ] **Step 1: Add generateNextRequestNo and findChangeRequestById methods**

Add the following methods to `TransactionLimitsService`:

```typescript
  async generateNextRequestNo(): Promise<string> {
    const last = await this.prisma.transactionLimitChangeRequest.findFirst({
      orderBy: { requestNo: 'desc' },
      select: { requestNo: true },
    });
    if (!last || last.requestNo === 'TEMP') return 'TLC-001';
    const num = parseInt(last.requestNo.replace('TLC-', ''), 10);
    return `TLC-${String(num + 1).padStart(3, '0')}`;
  }

  async findChangeRequestById(id: string) {
    const request = await this.prisma.transactionLimitChangeRequest.findUnique({
      where: { id },
    });
    if (!request) {
      throw new NotFoundException(`Transaction limit change request not found: ${id}`);
    }
    return request;
  }
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit 2>&1 | tail -20`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/modules/governance/transaction-limits/transaction-limits.service.ts
git commit -m "feat: add generateNextRequestNo and findChangeRequestById to TransactionLimitsService"
```

---

### Task 3: Rewrite TransactionLimitChangeWorkflowService

**Files:**
- Rewrite: `src/modules/governance/transaction-limits/transaction-limit-change-workflow.service.ts`

- [ ] **Step 1: Replace the entire file content**

Replace the full content of `transaction-limit-change-workflow.service.ts` with:

```typescript
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
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

const SECONDARY_EVENT = 'workflow.transaction-limit-change.decided';

const SYSTEM_ACTOR: ApprovalActorContext = {
  actorType: 'ADMIN',
  userId: 'SYSTEM',
  userNo: 'SYSTEM',
  role: 'SYSTEM',
  roleCodes: ['SYSTEM'],
};

@Injectable()
export class TransactionLimitChangeWorkflowService {
  private readonly logger = new Logger(TransactionLimitChangeWorkflowService.name);

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
    limitAmount: number,
    changeReason: string,
    actor: ApprovalActorContext,
  ) {
    // 1. Find policy, verify it exists and is ACTIVE
    const policy = await this.limitsService.findByPolicyNo(policyNo);

    if (policy.status !== 'ACTIVE') {
      throw new ConflictException(
        `Policy ${policyNo} is not ACTIVE (current status: ${policy.status}). Cannot submit a change request.`,
      );
    }

    // 2. Validate input
    if (limitAmount <= 0) {
      throw new BadRequestException('limitAmount must be greater than 0');
    }
    if (!changeReason?.trim()) {
      throw new BadRequestException('changeReason is required');
    }
    if (new Prisma.Decimal(limitAmount).equals(policy.limitAmount)) {
      throw new BadRequestException('New amount is the same as current amount');
    }

    // 3. Check no pending request for same policyId
    const existingPending = await this.prisma.transactionLimitChangeRequest.findFirst({
      where: {
        policyId: policy.id,
        status: 'PENDING_APPROVAL',
      },
    });
    if (existingPending) {
      throw new ConflictException(
        `A pending change request already exists for ${policyNo}: ${existingPending.requestNo}`,
      );
    }

    // 4. Generate requestNo
    const requestNo = await this.limitsService.generateNextRequestNo();

    // 5. INSERT TransactionLimitChangeRequest
    const request = await this.prisma.transactionLimitChangeRequest.create({
      data: {
        requestNo,
        policyId: policy.id,
        policyNo: policy.policyNo,
        currentAmount: policy.limitAmount,
        proposedAmount: new Prisma.Decimal(limitAmount),
        changeReason: changeReason.trim(),
        status: 'PENDING_APPROVAL',
        requestedByUserId: actor.userId,
      },
    });

    // 6. Create approval case (entityRef = request.id)
    const traceId = crypto.randomUUID();
    let approvalCase: any;
    try {
      approvalCase = await this.approvalsService.createAndSubmit(
        {
          actionType: ApprovalActionTypes.TRANSACTION_LIMIT_CHANGE,
          entityRef: request.id,
          workflowType: AuditBusinessWorkflowTypes.TRANSACTION_LIMIT_CHANGE,
          workflowId: request.id,
          workflowNo: requestNo,
          traceId,
          objectSnapshot: {
            requestId: request.id,
            requestNo,
            policyId: policy.id,
            policyNo: policy.policyNo,
            tradingTier: policy.tradingTier,
            operationType: policy.operationType,
            period: policy.period,
            currentAmount: policy.limitAmount.toString(),
            proposedAmount: String(limitAmount),
            changeReason: changeReason.trim(),
          },
        },
        {
          reason: changeReason.trim(),
          traceId,
        },
        actor,
      );
    } catch (err) {
      // Rollback: delete the request row
      await this.prisma.transactionLimitChangeRequest.delete({ where: { id: request.id } });
      throw err;
    }

    // 7. Link approval case to request
    await this.prisma.transactionLimitChangeRequest.update({
      where: { id: request.id },
      data: {
        approvalCaseId: approvalCase.id,
        approvalCaseNo: approvalCase.approvalNo,
      },
    });

    // 8. Audit CHANGE_REQUESTED
    await this.auditLogsService.recordByActor(
      {
        action: AuditGovernanceActions.TRANSACTION_LIMIT_CHANGE.CHANGE_REQUESTED,
        entityType: AuditEntityTypes.TRANSACTION_LIMIT_POLICY,
        entityId: request.id,
        entityNo: requestNo,
        workflowType: AuditBusinessWorkflowTypes.TRANSACTION_LIMIT_CHANGE,
        traceId,
        result: AuditResult.SUCCESS,
        metadata: {
          policyId: policy.id,
          policyNo: policy.policyNo,
          tradingTier: policy.tradingTier,
          operationType: policy.operationType,
          period: policy.period,
          currentAmount: policy.limitAmount.toString(),
          proposedAmount: String(limitAmount),
          changeReason: changeReason.trim(),
          approvalNo: approvalCase.approvalNo,
        },
        requestId: `TRANSACTION_LIMIT_CHANGE_REQUESTED_${requestNo}`,
        sourcePlatform: 'ADMIN_API',
      },
      this.toAuditActor(actor),
    );

    return {
      requestNo,
      policyNo: policy.policyNo,
      approvalNo: approvalCase.approvalNo,
      status: 'PENDING_APPROVAL',
    };
  }

  @OnEvent(SECONDARY_EVENT, { async: true })
  async handleApprovalDecided(event: any) {
    const decision = event?.decision;
    const approvalId = event?.approvalId;
    const entityRef = event?.entityRef;

    if (!approvalId || !entityRef) {
      this.logger.warn('Transaction limit change decided event missing approvalId or entityRef');
      return;
    }

    if (decision === 'APPROVED') {
      await this.executeChange(approvalId, entityRef, event);
    } else {
      await this.cancelChange(approvalId, entityRef, decision, event);
    }
  }

  private async executeChange(approvalId: string, requestId: string, event: any) {
    try {
      // 1. Load request, verify PENDING_APPROVAL
      const request = await this.prisma.transactionLimitChangeRequest.findUnique({
        where: { id: requestId },
      });
      if (!request || request.status !== 'PENDING_APPROVAL') {
        this.logger.warn(`Change request ${requestId} not found or not PENDING_APPROVAL`);
        await this.approvalsService.markExecutionResult(
          approvalId,
          false,
          SYSTEM_ACTOR,
          'Change request not found or wrong status',
        );
        return;
      }

      // 2. Load policy
      const policy = await this.prisma.transactionLimitPolicy.findUnique({
        where: { id: request.policyId },
      });
      if (!policy) {
        await this.prisma.transactionLimitChangeRequest.update({
          where: { id: request.id },
          data: { status: 'APPROVED', failureReason: 'Policy no longer exists' },
        });
        await this.approvalsService.markExecutionResult(
          approvalId,
          false,
          SYSTEM_ACTOR,
          'Policy no longer exists',
        );
        return;
      }

      // 3. Conflict check: currentAmount snapshot vs actual
      if (!request.currentAmount.equals(policy.limitAmount)) {
        const reason = `Conflict: policy limit was changed since request submission (expected ${request.currentAmount}, actual ${policy.limitAmount})`;
        await this.prisma.transactionLimitChangeRequest.update({
          where: { id: request.id },
          data: { status: 'APPROVED', failureReason: reason },
        });
        await this.approvalsService.markExecutionResult(
          approvalId,
          false,
          SYSTEM_ACTOR,
          reason,
        );
        await this.auditLogsService.recordSystem({
          action: AuditGovernanceActions.TRANSACTION_LIMIT_CHANGE.CHANGE_APPLY_FAILED,
          entityType: AuditEntityTypes.TRANSACTION_LIMIT_POLICY,
          entityId: request.id,
          entityNo: request.requestNo,
          workflowType: AuditBusinessWorkflowTypes.TRANSACTION_LIMIT_CHANGE,
          traceId: event?.traceId,
          result: AuditResult.FAILED,
          reason,
          metadata: {
            policyId: request.policyId,
            policyNo: request.policyNo,
            expectedAmount: request.currentAmount.toString(),
            actualAmount: policy.limitAmount.toString(),
          },
          requestId: `TRANSACTION_LIMIT_CHANGE_APPLY_FAILED_${request.requestNo}`,
          sourcePlatform: 'SYSTEM',
        });
        this.logger.warn(`Change request ${request.requestNo} failed: ${reason}`);
        return;
      }

      // 4. Apply change — update policy limitAmount (NO status change)
      await this.prisma.transactionLimitPolicy.update({
        where: { id: policy.id },
        data: { limitAmount: request.proposedAmount },
      });

      // 5. Mark request as executed
      await this.prisma.transactionLimitChangeRequest.update({
        where: { id: request.id },
        data: { status: 'APPROVED', executedAt: new Date() },
      });

      // 6. Mark execution result
      await this.approvalsService.markExecutionResult(
        approvalId,
        true,
        SYSTEM_ACTOR,
        `Policy ${request.policyNo} limit updated to ${request.proposedAmount}`,
      );

      // 7. Audit CHANGE_APPLIED
      await this.auditLogsService.recordSystem({
        action: AuditGovernanceActions.TRANSACTION_LIMIT_CHANGE.CHANGE_APPLIED,
        entityType: AuditEntityTypes.TRANSACTION_LIMIT_POLICY,
        entityId: request.id,
        entityNo: request.requestNo,
        workflowType: AuditBusinessWorkflowTypes.TRANSACTION_LIMIT_CHANGE,
        traceId: event?.traceId,
        result: AuditResult.SUCCESS,
        metadata: {
          policyId: request.policyId,
          policyNo: request.policyNo,
          oldAmount: request.currentAmount.toString(),
          newAmount: request.proposedAmount.toString(),
          approvalId,
          approvalNo: event?.approvalNo,
        },
        requestId: `TRANSACTION_LIMIT_CHANGE_APPLIED_${request.requestNo}`,
        sourcePlatform: 'SYSTEM',
      });

      this.logger.log(`Change request ${request.requestNo} executed: ${request.policyNo} limit → ${request.proposedAmount}`);
    } catch (err: any) {
      this.logger.error(`Failed to execute change request ${requestId}: ${err.message}`);

      // Try to mark as failed
      try {
        await this.prisma.transactionLimitChangeRequest.update({
          where: { id: requestId },
          data: { status: 'APPROVED', failureReason: err.message },
        });
      } catch { /* ignore */ }

      await this.approvalsService
        .markExecutionResult(approvalId, false, SYSTEM_ACTOR, err.message)
        .catch(() => undefined);

      await this.auditLogsService.recordSystem({
        action: AuditGovernanceActions.TRANSACTION_LIMIT_CHANGE.CHANGE_APPLY_FAILED,
        entityType: AuditEntityTypes.TRANSACTION_LIMIT_POLICY,
        entityId: requestId,
        workflowType: AuditBusinessWorkflowTypes.TRANSACTION_LIMIT_CHANGE,
        traceId: event?.traceId,
        result: AuditResult.FAILED,
        reason: err.message,
        metadata: { approvalId },
        requestId: `TRANSACTION_LIMIT_CHANGE_APPLY_FAILED_${requestId}`,
        sourcePlatform: 'SYSTEM',
      });
    }
  }

  private async cancelChange(
    approvalId: string,
    requestId: string,
    decision: string,
    event: any,
  ) {
    try {
      const request = await this.prisma.transactionLimitChangeRequest.findUnique({
        where: { id: requestId },
      });
      if (!request) {
        this.logger.warn(`Change request ${requestId} not found for cancellation`);
        return;
      }

      // Update request status
      const newStatus = decision === 'REJECTED' ? 'REJECTED' : 'CANCELLED';
      await this.prisma.transactionLimitChangeRequest.update({
        where: { id: request.id },
        data: { status: newStatus },
      });

      // Audit
      await this.auditLogsService.recordSystem({
        action: AuditGovernanceActions.TRANSACTION_LIMIT_CHANGE.CHANGE_CANCELLED,
        entityType: AuditEntityTypes.TRANSACTION_LIMIT_POLICY,
        entityId: request.id,
        entityNo: request.requestNo,
        workflowType: AuditBusinessWorkflowTypes.TRANSACTION_LIMIT_CHANGE,
        traceId: event?.traceId,
        result: AuditResult.SUCCESS,
        metadata: {
          decision,
          policyId: request.policyId,
          policyNo: request.policyNo,
          approvalId,
          approvalNo: event?.approvalNo,
        },
        requestId: `TRANSACTION_LIMIT_CHANGE_CANCELLED_${request.requestNo}`,
        sourcePlatform: 'SYSTEM',
      });

      this.logger.log(`Change request ${request.requestNo} cancelled (${decision})`);
    } catch (err: any) {
      this.logger.error(`Failed to cancel change request ${requestId}: ${err.message}`);
    }
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit 2>&1 | tail -20`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/modules/governance/transaction-limits/transaction-limit-change-workflow.service.ts
git commit -m "refactor: rewrite TransactionLimitChangeWorkflowService to request-record pattern"
```

---

### Task 4: Controller — Replace PATCH with POST .../change

**Files:**
- Modify: `src/modules/governance/transaction-limits/transaction-limits.controller.ts`

- [ ] **Step 1: Replace the PATCH endpoint with POST .../change**

In `transaction-limits.controller.ts`, replace the PATCH handler:

Remove:
```typescript
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
```

Replace with:
```typescript
  @Post(':policyNo/change')
  @RequirePermissions(buildPermissionCode('POST', '/admin/transaction-limit-policies/:policyNo/change'))
  async requestChange(
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
```

Also remove `Patch` from the `@nestjs/common` import (it's no longer used). Keep `Post` which was added in the creation task.

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit 2>&1 | tail -20`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/modules/governance/transaction-limits/transaction-limits.controller.ts
git commit -m "refactor: replace PATCH endpoint with POST /:policyNo/change"
```

---

### Task 5: Frontend — Update Detail Page API Call

**Files:**
- Modify: `admin-web/src/pages/TransactionLimitDetail.tsx`

- [ ] **Step 1: Change the API call from PATCH to POST .../change**

In `TransactionLimitDetail.tsx`, find the `handleSubmitEdit` function. Change:

```typescript
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/transaction-limit-policies/${policyNo}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ limitAmount: amount, changeReason: changeReason.trim() }),
        },
      );
```

To:

```typescript
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/transaction-limit-policies/${policyNo}/change`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ limitAmount: amount, changeReason: changeReason.trim() }),
        },
      );
```

- [ ] **Step 2: Verify frontend TypeScript compiles**

Run: `cd admin-web && npx tsc --noEmit 2>&1 | tail -20`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add admin-web/src/pages/TransactionLimitDetail.tsx
git commit -m "refactor: update detail page to use POST .../change endpoint"
```

---

### Task 6: E2E Smoke Test

- [ ] **Step 1: Restart backend and verify POST endpoint works**

```bash
# Kill and restart
lsof -ti:3500 | xargs kill -9 2>/dev/null
npx nest start --watch &
sleep 10

# Login
TOKEN=$(curl -s -X POST http://localhost:3500/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@fiatx.com","password":"123456"}' | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

# Test: Submit a change request
curl -s -X POST http://localhost:3500/admin/transaction-limit-policies/TLP-002/change \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"limitAmount":150000,"changeReason":"Increase basic swap daily limit"}' | python3 -m json.tool
```

Expected: `{ "requestNo": "TLC-001", "policyNo": "TLP-002", "approvalNo": "APR...", "status": "PENDING_APPROVAL" }`

- [ ] **Step 2: Verify policy status did NOT change**

```bash
curl -s http://localhost:3500/admin/transaction-limit-policies/TLP-002 \
  -H "Authorization: Bearer $TOKEN" | python3 -c "
import sys, json
p = json.load(sys.stdin)
assert p['status'] == 'ACTIVE', f'Expected ACTIVE, got {p[\"status\"]}'
print(f'✓ Policy status is ACTIVE (limitAmount={p[\"limitAmount\"]})')
"
```

Expected: `✓ Policy status is ACTIVE (limitAmount=100000)`

- [ ] **Step 3: Verify duplicate rejection**

```bash
curl -s -X POST http://localhost:3500/admin/transaction-limit-policies/TLP-002/change \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"limitAmount":200000,"changeReason":"Another change"}' | python3 -m json.tool
```

Expected: 409 error — "A pending change request already exists for TLP-002: TLC-001"

- [ ] **Step 4: Verify old PATCH endpoint is gone**

```bash
curl -s -X PATCH http://localhost:3500/admin/transaction-limit-policies/TLP-003 \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"limitAmount":200000,"changeReason":"Should fail"}' | python3 -m json.tool
```

Expected: 404 — "Cannot PATCH /admin/transaction-limit-policies/TLP-003"

- [ ] **Step 5: Verify request record exists in DB**

```bash
sqlite3 /tmp/exchange_js_main/dev.db "SELECT \"requestNo\", \"policyNo\", \"currentAmount\", \"proposedAmount\", status FROM transaction_limit_change_requests ORDER BY rowid DESC LIMIT 3;"
```

Expected: `TLC-001 | TLP-002 | 100000 | 150000 | PENDING_APPROVAL`

- [ ] **Step 6: Verify audit log**

```bash
sqlite3 /tmp/exchange_js_main/dev.db "SELECT action, \"entityNo\", result FROM audit_log_events WHERE \"workflowType\" = 'TRANSACTION_LIMIT_CHANGE' ORDER BY rowid DESC LIMIT 5;"
```

Expected: `CHANGE_REQUESTED | TLC-001 | SUCCESS`
