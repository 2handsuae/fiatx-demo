# Deposit V4 Happy Path Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire end-to-end deposit happy path simulation (client create → payin advance → KYT/TR pass → auto-approve with TB accounting) and align all frontend pages to V4 state machine.

**Architecture:** Backend adds three-gate compliance check (Gate 0: customer status, Gate 1: KYT, Gate 2: TR) with auto-approval when all pass. Frontend updates admin list/detail pages to two-column layout with V4 statuses and compliance gates sidebar. Client page gets tipping-off-safe status mapping.

**Tech Stack:** NestJS, Prisma, TigerBeetle, React, Tailwind CSS

**Spec:** `docs/superpowers/specs/2026-05-18-deposit-frontend-v4-alignment-design.md`

---

### Task 1: Backend — L1 Compliance Gate Methods in DepositTransactionsService

**Files:**
- Modify: `src/modules/trading/deposit-transactions/deposit-transactions.service.ts`
- Modify: `src/modules/trading/deposit-transactions/deposit-transactions.service.spec.ts`

**Context:** The Prisma model already has `kytStatus` (default `"PENDING"`) and `travelRuleStatus` (default `"NOT_REQUIRED"`). We need L1 methods to update these fields so the L3 workflow service can call them (Rule 5: workflow must not write Prisma directly).

- [ ] **Step 1: Write failing tests for compliance gate methods**

Add to `deposit-transactions.service.spec.ts`:

```typescript
describe('Compliance Gate Methods', () => {
  it('initializeComplianceGates sets travelRule fields', async () => {
    const mockRecord = { id: 'dep-1', status: 'COMPLIANCE_PENDING' };
    (prisma.depositTransaction.findUnique as jest.Mock).mockResolvedValue(mockRecord);
    (prisma.depositTransaction.update as jest.Mock).mockImplementation(({ data }) =>
      Promise.resolve({ ...mockRecord, ...data }),
    );

    const result = await service.initializeComplianceGates('dep-1');

    expect(prisma.depositTransaction.update).toHaveBeenCalledWith({
      where: { id: 'dep-1' },
      data: {
        travelRuleRequired: true,
        travelRuleStatus: 'PENDING',
      },
    });
    expect(result.travelRuleStatus).toBe('PENDING');
  });

  it('updateKytStatus sets kytStatus and kytCheckedAt', async () => {
    const mockRecord = { id: 'dep-1', kytStatus: 'PENDING' };
    (prisma.depositTransaction.findUnique as jest.Mock).mockResolvedValue(mockRecord);
    (prisma.depositTransaction.update as jest.Mock).mockImplementation(({ data }) =>
      Promise.resolve({ ...mockRecord, ...data }),
    );

    const result = await service.updateKytStatus('dep-1', 'PASSED', 15);

    expect(prisma.depositTransaction.update).toHaveBeenCalledWith({
      where: { id: 'dep-1' },
      data: expect.objectContaining({
        kytStatus: 'PASSED',
        kytRiskScore: 15,
        kytCheckedAt: expect.any(Date),
      }),
    });
  });

  it('updateTravelRuleStatus sets travelRuleStatus and travelRuleCheckedAt', async () => {
    const mockRecord = { id: 'dep-1', travelRuleStatus: 'PENDING' };
    (prisma.depositTransaction.findUnique as jest.Mock).mockResolvedValue(mockRecord);
    (prisma.depositTransaction.update as jest.Mock).mockImplementation(({ data }) =>
      Promise.resolve({ ...mockRecord, ...data }),
    );

    const result = await service.updateTravelRuleStatus('dep-1', 'PASSED');

    expect(prisma.depositTransaction.update).toHaveBeenCalledWith({
      where: { id: 'dep-1' },
      data: expect.objectContaining({
        travelRuleStatus: 'PASSED',
        travelRuleCheckedAt: expect.any(Date),
      }),
    });
  });

  it('getOwnerComplianceStatus returns customer complianceStatus', async () => {
    const mockDeposit = { id: 'dep-1', ownerId: 'cust-1' };
    const mockCustomer = { id: 'cust-1', complianceStatus: 'ACTIVE' };
    (prisma.depositTransaction.findUnique as jest.Mock).mockResolvedValue(mockDeposit);
    (prisma.customerMain.findUnique as jest.Mock).mockResolvedValue(mockCustomer);

    const result = await service.getOwnerComplianceStatus('dep-1');

    expect(result).toBe('ACTIVE');
  });

  it('getOwnerComplianceStatus throws if deposit not found', async () => {
    (prisma.depositTransaction.findUnique as jest.Mock).mockResolvedValue(null);

    await expect(service.getOwnerComplianceStatus('nonexistent')).rejects.toThrow(
      NotFoundException,
    );
  });
});
```

Note: The prisma mock in `beforeEach` needs `customerMain: { findUnique: jest.fn() }` if not already present.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd Exchange_js && npx jest deposit-transactions.service.spec --no-coverage`
Expected: FAIL — methods not defined

- [ ] **Step 3: Implement the four methods**

Add to `deposit-transactions.service.ts`:

```typescript
async initializeComplianceGates(id: string) {
  return (this.prisma as any).depositTransaction.update({
    where: { id },
    data: {
      travelRuleRequired: true,
      travelRuleStatus: 'PENDING',
    },
  });
}

async updateKytStatus(id: string, status: string, riskScore?: number) {
  return (this.prisma as any).depositTransaction.update({
    where: { id },
    data: {
      kytStatus: status,
      kytRiskScore: riskScore ?? null,
      kytCheckedAt: new Date(),
    },
  });
}

async updateTravelRuleStatus(id: string, status: string) {
  return (this.prisma as any).depositTransaction.update({
    where: { id },
    data: {
      travelRuleStatus: status,
      travelRuleCheckedAt: new Date(),
    },
  });
}

async getOwnerComplianceStatus(depositId: string): Promise<string> {
  const deposit = await (this.prisma as any).depositTransaction.findUnique({
    where: { id: depositId },
    select: { ownerId: true },
  });
  if (!deposit) throw new NotFoundException('Deposit transaction not found');

  const customer = await (this.prisma as any).customerMain.findUnique({
    where: { id: deposit.ownerId },
    select: { complianceStatus: true },
  });
  return customer?.complianceStatus || 'UNKNOWN';
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd Exchange_js && npx jest deposit-transactions.service.spec --no-coverage`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add src/modules/trading/deposit-transactions/deposit-transactions.service.ts src/modules/trading/deposit-transactions/deposit-transactions.service.spec.ts
git commit -m "feat(deposit): add L1 compliance gate methods (kyt, travelRule, ownerStatus)"
```

---

### Task 2: Backend — Gate 0 + Auto-Approval in DepositWorkflowService

**Files:**
- Modify: `src/modules/trading/deposit-transactions/deposit-workflow.service.ts`
- Create: `src/modules/trading/deposit-transactions/deposit-workflow.service.spec.ts`

**Context:** `handleDepositStatusChanged` (line 70) currently only logs. Add Gate 0 check when entering COMPLIANCE_PENDING, and `checkAutoApproval` called after each gate event. `approveDeposit(depositId)` already exists (line 76) with TB Step 2.

- [ ] **Step 1: Write failing tests**

Create `deposit-workflow.service.spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { DepositWorkflowService } from './deposit-workflow.service';
import { DepositTransactionsService } from './deposit-transactions.service';
import { PayinsService } from '../../asset-treasury/payins/payins.service';
import { AuditLogsService } from '../../governance/audit-logs/audit-logs.service';
import { AccountingService } from '../../accounting/tigerbeetle/accounting.service';
import { DepositStatusChangedEvent } from './events/deposit-transaction.events';
import {
  DepositTransactionStatus,
  DepositTransactionAction,
} from './dto/deposit-transaction.dto';

describe('DepositWorkflowService', () => {
  let service: DepositWorkflowService;
  let depositService: jest.Mocked<Partial<DepositTransactionsService>>;
  let auditLogsService: jest.Mocked<Partial<AuditLogsService>>;

  beforeEach(async () => {
    depositService = {
      getOwnerComplianceStatus: jest.fn(),
      initializeComplianceGates: jest.fn(),
      updateStatus: jest.fn(),
      findOne: jest.fn(),
      updateKytStatus: jest.fn(),
      updateTravelRuleStatus: jest.fn(),
      findByPayinId: jest.fn(),
    };
    auditLogsService = {
      recordSystem: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DepositWorkflowService,
        { provide: DepositTransactionsService, useValue: depositService },
        { provide: PayinsService, useValue: { updateStatus: jest.fn() } },
        { provide: AuditLogsService, useValue: auditLogsService },
        { provide: AccountingService, useValue: { createTransfers: jest.fn().mockResolvedValue({}) } },
      ],
    }).compile();

    service = module.get<DepositWorkflowService>(DepositWorkflowService);
  });

  describe('handleDepositStatusChanged — Gate 0', () => {
    it('initializes compliance gates when entering COMPLIANCE_PENDING with normal customer', async () => {
      depositService.getOwnerComplianceStatus!.mockResolvedValue('ACTIVE');
      depositService.initializeComplianceGates!.mockResolvedValue({});

      const event = new DepositStatusChangedEvent(
        'dep-1', DepositTransactionStatus.PAYIN_PENDING,
        DepositTransactionStatus.COMPLIANCE_PENDING,
        'CUSTOMER', 'cust-1', 'asset-1', '100', 'payin-1',
      );

      await service.handleDepositStatusChanged(event);

      expect(depositService.getOwnerComplianceStatus).toHaveBeenCalledWith('dep-1');
      expect(depositService.initializeComplianceGates).toHaveBeenCalledWith('dep-1');
    });

    it('freezes deposit when customer complianceStatus is FROZEN', async () => {
      depositService.getOwnerComplianceStatus!.mockResolvedValue('FROZEN');

      const event = new DepositStatusChangedEvent(
        'dep-1', DepositTransactionStatus.PAYIN_PENDING,
        DepositTransactionStatus.COMPLIANCE_PENDING,
        'CUSTOMER', 'cust-1', 'asset-1', '100', 'payin-1',
      );

      await service.handleDepositStatusChanged(event);

      expect(depositService.updateStatus).toHaveBeenCalledWith(
        'dep-1',
        { action: DepositTransactionAction.FREEZE },
        expect.objectContaining({
          reason: expect.stringContaining('FROZEN'),
        }),
      );
      expect(depositService.initializeComplianceGates).not.toHaveBeenCalled();
    });

    it('does nothing for non-COMPLIANCE_PENDING transitions', async () => {
      const event = new DepositStatusChangedEvent(
        'dep-1', DepositTransactionStatus.COMPLIANCE_PENDING,
        DepositTransactionStatus.SUCCESS,
        'CUSTOMER', 'cust-1', 'asset-1', '100', 'payin-1',
      );

      await service.handleDepositStatusChanged(event);

      expect(depositService.getOwnerComplianceStatus).not.toHaveBeenCalled();
    });
  });

  describe('checkAutoApproval', () => {
    it('approves when all three gates pass', async () => {
      depositService.findOne!.mockResolvedValue({
        id: 'dep-1',
        status: DepositTransactionStatus.COMPLIANCE_PENDING,
        kytStatus: 'PASSED',
        travelRuleStatus: 'PASSED',
        ownerId: 'cust-1',
        ownerType: 'CUSTOMER',
        assetId: 'asset-1',
        amount: '100',
        payinId: 'payin-1',
      });
      depositService.getOwnerComplianceStatus!.mockResolvedValue('ACTIVE');

      await service.checkAutoApproval('dep-1');

      expect(depositService.updateStatus).toHaveBeenCalled();
    });

    it('does not approve when deposit is FROZEN', async () => {
      depositService.findOne!.mockResolvedValue({
        id: 'dep-1',
        status: DepositTransactionStatus.FROZEN,
        kytStatus: 'PASSED',
        travelRuleStatus: 'PASSED',
      });

      await service.checkAutoApproval('dep-1');

      expect(depositService.updateStatus).not.toHaveBeenCalled();
    });

    it('does not approve when kytStatus is PENDING', async () => {
      depositService.findOne!.mockResolvedValue({
        id: 'dep-1',
        status: DepositTransactionStatus.COMPLIANCE_PENDING,
        kytStatus: 'PENDING',
        travelRuleStatus: 'PASSED',
      });

      await service.checkAutoApproval('dep-1');

      expect(depositService.updateStatus).not.toHaveBeenCalled();
    });

    it('does not approve when customer compliance is abnormal', async () => {
      depositService.findOne!.mockResolvedValue({
        id: 'dep-1',
        status: DepositTransactionStatus.COMPLIANCE_PENDING,
        kytStatus: 'PASSED',
        travelRuleStatus: 'PASSED',
        ownerId: 'cust-1',
      });
      depositService.getOwnerComplianceStatus!.mockResolvedValue('FROZEN');

      await service.checkAutoApproval('dep-1');

      expect(depositService.updateStatus).not.toHaveBeenCalled();
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd Exchange_js && npx jest deposit-workflow.service.spec --no-coverage`
Expected: FAIL — methods not yet implemented

- [ ] **Step 3: Implement Gate 0 and checkAutoApproval**

Modify `deposit-workflow.service.ts`. Replace the existing `handleDepositStatusChanged` (line 70-74):

```typescript
private static readonly ABNORMAL_COMPLIANCE = new Set([
  'FROZEN', 'SUSPENDED', 'BLOCKED', 'REJECTED',
]);

@OnEvent('deposit.status.changed')
async handleDepositStatusChanged(event: DepositStatusChangedEvent) {
  this.logger.log(
    `Deposit ${event.depositId} status changed: ${event.oldStatus} → ${event.newStatus}`,
  );

  if (event.newStatus === DepositTransactionStatus.COMPLIANCE_PENDING) {
    await this.runGate0(event.depositId);
  }
}

private async runGate0(depositId: string) {
  const complianceStatus =
    await this.depositService.getOwnerComplianceStatus(depositId);

  if (
    DepositWorkflowService.ABNORMAL_COMPLIANCE.has(complianceStatus)
  ) {
    this.logger.warn(
      `Gate 0 FAIL: deposit ${depositId} — customer compliance status: ${complianceStatus}`,
    );
    await this.depositService.updateStatus(depositId, {
      action: DepositTransactionAction.FREEZE,
    }, {
      reason: `Customer compliance status: ${complianceStatus}`,
      actor: { actorType: 'SYSTEM', actorId: 'COMPLIANCE_GATE_0' },
    });
    return;
  }

  this.logger.log(`Gate 0 PASS: deposit ${depositId}`);
  await this.depositService.initializeComplianceGates(depositId);
}

async checkAutoApproval(depositId: string) {
  const deposit = await this.depositService.findOne(depositId);

  if (deposit.status !== DepositTransactionStatus.COMPLIANCE_PENDING) {
    this.logger.debug(`Auto-approval skip: deposit ${depositId} status is ${deposit.status}`);
    return;
  }

  if (deposit.kytStatus !== 'PASSED') {
    this.logger.debug(`Auto-approval skip: deposit ${depositId} kytStatus=${deposit.kytStatus}`);
    return;
  }

  if (deposit.travelRuleStatus !== 'PASSED') {
    this.logger.debug(`Auto-approval skip: deposit ${depositId} travelRuleStatus=${deposit.travelRuleStatus}`);
    return;
  }

  const complianceStatus =
    await this.depositService.getOwnerComplianceStatus(depositId);
  if (DepositWorkflowService.ABNORMAL_COMPLIANCE.has(complianceStatus)) {
    this.logger.warn(`Auto-approval skip: deposit ${depositId} customer status=${complianceStatus}`);
    return;
  }

  this.logger.log(`All gates PASSED for deposit ${depositId} — auto-approving`);
  await this.approveDeposit(depositId);
}
```

Also ensure `findOne` returns `kytStatus` and `travelRuleStatus` — check that the `findOne` method in `deposit-transactions.service.ts` includes these fields (they should be returned automatically since they're model fields, not relations).

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd Exchange_js && npx jest deposit-workflow.service.spec --no-coverage`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add src/modules/trading/deposit-transactions/deposit-workflow.service.ts src/modules/trading/deposit-transactions/deposit-workflow.service.spec.ts
git commit -m "feat(deposit): add Gate 0 customer compliance check and auto-approval logic"
```

---

### Task 3: Backend — KYT + TR Simulation Endpoints

**Files:**
- Modify: `src/modules/sumsub-ingestion/admin-sumsub-simulation.controller.ts`

**Context:** The controller (at `admin/sumsub/simulate`) already has 6 simulation endpoints. Add 2 more for KYT and TR. The controller injects `PrismaService` which can find deposits by txHash. It also needs `DepositWorkflowService` for `checkAutoApproval`.

- [ ] **Step 1: Add DepositWorkflowService and DepositTransactionsService imports and injection**

Add to imports at top of file:

```typescript
import { DepositWorkflowService } from '../trading/deposit-transactions/deposit-workflow.service';
import { DepositTransactionsService } from '../trading/deposit-transactions/deposit-transactions.service';
```

Add to constructor:

```typescript
private readonly depositWorkflowService: DepositWorkflowService,
private readonly depositTransactionsService: DepositTransactionsService,
```

Ensure these services are available in the module's providers (check `sumsub-ingestion.module.ts` — may need to import the deposit module).

- [ ] **Step 2: Add simulateKytCheck endpoint**

Add after the last endpoint (around line 343):

```typescript
@Post('kyt-check')
@ApiOperation({ summary: 'Simulate KYT (Know Your Transaction) check result' })
async simulateKytCheck(@Req() req: any, @Body() body: any) {
  this.ensureAdmin(req);
  const { txHash, result, riskScore } = body;

  if (!txHash || !result) {
    throw new BadRequestException('txHash and result (PASS|FAIL) are required');
  }
  if (!['PASS', 'FAIL'].includes(result)) {
    throw new BadRequestException('result must be PASS or FAIL');
  }

  const deposit = await (this.prisma as any).depositTransaction.findFirst({
    where: { txHash },
  });
  if (!deposit) {
    throw new NotFoundException(`No deposit found with txHash: ${txHash}`);
  }

  const kytStatus = result === 'PASS' ? 'PASSED' : 'FAILED';
  await this.depositTransactionsService.updateKytStatus(
    deposit.id,
    kytStatus,
    riskScore ?? null,
  );

  await this.depositWorkflowService.checkAutoApproval(deposit.id);

  return {
    depositId: deposit.id,
    depositNo: deposit.depositNo,
    kytStatus,
    riskScore: riskScore ?? null,
    message: `KYT check simulated: ${kytStatus}`,
  };
}
```

- [ ] **Step 3: Add simulateTrCheck endpoint**

```typescript
@Post('tr-check')
@ApiOperation({ summary: 'Simulate Travel Rule (TR) check result' })
async simulateTrCheck(@Req() req: any, @Body() body: any) {
  this.ensureAdmin(req);
  const { txHash, result } = body;

  if (!txHash || !result) {
    throw new BadRequestException('txHash and result (PASS|FAIL) are required');
  }
  if (!['PASS', 'FAIL'].includes(result)) {
    throw new BadRequestException('result must be PASS or FAIL');
  }

  const deposit = await (this.prisma as any).depositTransaction.findFirst({
    where: { txHash },
  });
  if (!deposit) {
    throw new NotFoundException(`No deposit found with txHash: ${txHash}`);
  }

  const trStatus = result === 'PASS' ? 'PASSED' : 'FAILED';
  await this.depositTransactionsService.updateTravelRuleStatus(
    deposit.id,
    trStatus,
  );

  await this.depositWorkflowService.checkAutoApproval(deposit.id);

  return {
    depositId: deposit.id,
    depositNo: deposit.depositNo,
    travelRuleStatus: trStatus,
    message: `Travel Rule check simulated: ${trStatus}`,
  };
}
```

- [ ] **Step 4: Add BadRequestException and NotFoundException to imports if not present**

Check the imports at line 2. Add `BadRequestException` and `NotFoundException` if missing:

```typescript
import { Controller, Post, Body, Req, UseGuards, Inject, BadRequestException, NotFoundException } from '@nestjs/common';
```

- [ ] **Step 5: Update module imports if needed**

Check `src/modules/sumsub-ingestion/sumsub-ingestion.module.ts` — ensure it imports the deposit trading module or provides `DepositWorkflowService` and `DepositTransactionsService`. If not, add the necessary import:

```typescript
imports: [
  // ... existing imports
  forwardRef(() => DepositTransactionsModule),
],
```

- [ ] **Step 6: Verify backend compiles**

Run: `cd Exchange_js && npx tsc --noEmit 2>&1 | head -30`
Expected: No errors (or only pre-existing ones)

- [ ] **Step 7: Commit**

```bash
git add src/modules/sumsub-ingestion/
git commit -m "feat(simulation): add KYT and Travel Rule check simulation endpoints"
```

---

### Task 4: Frontend — Shared Utilities V4 Update

**Files:**
- Modify: `admin-web/src/utils/transactionRootDisplay.ts`

**Context:** `TRANSACTION_ROOT_STATUS_LABELS` (line 1) maps status strings to display labels. Missing V4 statuses ACTION_PENDING, EXPIRED, CONFISCATED, FROZEN. Still has UNDER_REVIEW.

- [ ] **Step 1: Update TRANSACTION_ROOT_STATUS_LABELS**

Replace the existing status label map (around lines 1-10) to include all 9 V4 statuses:

```typescript
const TRANSACTION_ROOT_STATUS_LABELS: Record<string, string> = {
  PAYIN_PENDING: 'Payin Pending',
  COMPLIANCE_PENDING: 'Compliance Pending',
  ACTION_PENDING: 'Action Pending',
  SUCCESS: 'Success',
  FROZEN: 'Frozen',
  REJECTED: 'Rejected',
  FAILED: 'Failed',
  EXPIRED: 'Expired',
  CONFISCATED: 'Confiscated',
};
```

Remove `UNDER_REVIEW: 'Under Review'` if present.

- [ ] **Step 2: Verify no compile errors**

Run: `cd Exchange_js/admin-web && npx tsc --noEmit 2>&1 | head -20`

- [ ] **Step 3: Commit**

```bash
git add admin-web/src/utils/transactionRootDisplay.ts
git commit -m "feat(admin): update transactionRootDisplay with V4 deposit statuses"
```

---

### Task 5: Frontend — Admin List Page V4 Update

**Files:**
- Modify: `admin-web/src/pages/DepositTransactionList.tsx`

**Context:** Status badge map (line 196) and filter dropdown (line 296) reference UNDER_REVIEW and are missing ACTION_PENDING, EXPIRED, CONFISCATED, FROZEN.

- [ ] **Step 1: Update renderStatusBadge color map**

Replace the `colors` object inside `renderStatusBadge` (around line 197):

```typescript
const colors: Record<string, string> = {
  PAYIN_PENDING: 'bg-blue-100 text-blue-800',
  COMPLIANCE_PENDING: 'bg-purple-100 text-purple-800',
  ACTION_PENDING: 'bg-amber-100 text-amber-800',
  SUCCESS: 'bg-green-100 text-green-800',
  REJECTED: 'bg-red-100 text-red-800',
  FAILED: 'bg-orange-100 text-orange-800',
  EXPIRED: 'bg-gray-100 text-gray-800',
  FROZEN: 'bg-cyan-100 text-cyan-800',
  CONFISCATED: 'bg-red-200 text-red-900',
};
```

- [ ] **Step 2: Update filter dropdown options**

Replace the status `<select>` options (around line 296):

```tsx
<option value="">All Status</option>
<option value="PAYIN_PENDING">Payin Pending</option>
<option value="COMPLIANCE_PENDING">Compliance Pending</option>
<option value="ACTION_PENDING">Action Pending</option>
<option value="SUCCESS">Success</option>
<option value="FROZEN">Frozen</option>
<option value="REJECTED">Rejected</option>
<option value="FAILED">Failed</option>
<option value="EXPIRED">Expired</option>
<option value="CONFISCATED">Confiscated</option>
```

- [ ] **Step 3: Commit**

```bash
git add admin-web/src/pages/DepositTransactionList.tsx
git commit -m "feat(admin): update deposit list page with V4 statuses"
```

---

### Task 6: Frontend — Admin Deposit Detail Page Rewrite

**Files:**
- Modify: `admin-web/src/pages/DepositTransactionDetail.tsx`

**Context:** Current page is single-column, references UNDER_REVIEW in 8+ places, shows UUIDs, no ActionSection. Rewrite to two-column layout following SwapTransactionDetail pattern. This is the largest frontend task.

**Reference patterns:**
- Two-column layout: `SwapTransactionDetail.tsx` overall structure
- ActionSection: `SwapTransactionDetail.tsx` lines 149-167 (availableActions), 114-147 (handleAction), 344-367 (JSX)
- SimulationRail: `PayinDetail.tsx` pattern (lower priority)

- [ ] **Step 1: Update all status color helpers**

Replace `getStatusColor` and `getStatusBadgeStyle` functions (around lines 589-613) with V4 statuses:

```typescript
const getStatusColor = (status: string) => {
  switch (status) {
    case 'SUCCESS': return 'bg-green-500';
    case 'FAILED': return 'bg-orange-500';
    case 'REJECTED': return 'bg-red-500';
    case 'CONFISCATED': return 'bg-red-700';
    case 'COMPLIANCE_PENDING': return 'bg-purple-500';
    case 'ACTION_PENDING': return 'bg-amber-500';
    case 'FROZEN': return 'bg-cyan-500';
    case 'PAYIN_PENDING': return 'bg-blue-500';
    case 'EXPIRED': return 'bg-gray-400';
    default: return 'bg-gray-300';
  }
};

const getStatusBadgeStyle = (status: string) => {
  switch (status) {
    case 'SUCCESS': return 'bg-green-50 text-green-700 border-green-200';
    case 'FAILED': return 'bg-orange-50 text-orange-700 border-orange-200';
    case 'REJECTED': return 'bg-red-50 text-red-700 border-red-200';
    case 'CONFISCATED': return 'bg-red-100 text-red-800 border-red-300';
    case 'COMPLIANCE_PENDING': return 'bg-purple-50 text-purple-700 border-purple-200';
    case 'ACTION_PENDING': return 'bg-amber-50 text-amber-700 border-amber-200';
    case 'FROZEN': return 'bg-cyan-50 text-cyan-700 border-cyan-200';
    case 'PAYIN_PENDING': return 'bg-blue-50 text-blue-700 border-blue-200';
    case 'EXPIRED': return 'bg-gray-50 text-gray-700 border-gray-200';
    default: return 'bg-gray-50 text-gray-700 border-gray-200';
  }
};
```

- [ ] **Step 2: Remove all UNDER_REVIEW references**

Search and replace throughout the file:
- Remove `UNDER_REVIEW` from badge color maps
- Update `getNextStepLabel` — remove UNDER_REVIEW case
- Update `getProjectedFinalStates` — remove UNDER_REVIEW references
- Update any conditional renders that check for UNDER_REVIEW

- [ ] **Step 3: Convert to two-column layout**

Replace the main return JSX with two-column structure. The overall pattern:

```tsx
<div className="flex gap-6">
  {/* Main body */}
  <div className="flex-1 space-y-6">
    {/* Hero Zone */}
    <div className="bg-white rounded-lg border border-admin-border p-6">
      <div className="flex items-center gap-4">
        <h1 className="text-2xl font-bold text-gray-900">{data.depositNo}</h1>
        {renderStatusBadge(data.status)}
      </div>
      <div className="mt-4 flex items-baseline gap-2">
        <span className="text-3xl font-semibold">{formatAssetAmount(data.amount, data.asset?.decimals)}</span>
        <span className="text-lg text-gray-500">{data.asset?.code}</span>
        <span className="ml-2 px-2 py-0.5 rounded text-xs bg-gray-100 text-gray-600">
          {data.type || 'crypto'}
        </span>
      </div>
    </div>

    {/* Core Context */}
    <DetailCard title="Transaction Details" icon={<Info size={18} />} columns={2}>
      {/* ownerNo, ownerType, compliance status, wallets — NO UUIDs */}
    </DetailCard>

    {/* Process / Timeline */}
    <DetailCard title="Audit Trail" icon={<Activity size={18} />} columns={1}>
      <StatusTimeline historyJson={data.statusHistory} />
    </DetailCard>

    {/* Technical Detail */}
    <DetailCard title="Technical" icon={<Hash size={18} />} columns={2}>
      {/* txHash, addresses, payinNo (clickable), traceId */}
    </DetailCard>
  </div>

  {/* Sidebar — 272px */}
  <div className="w-[272px] shrink-0 space-y-4">
    {/* ActionSection */}
    {availableActions.length > 0 && (
      <ActionSection title="Workflow Actions">
        {/* buttons */}
      </ActionSection>
    )}

    {/* Compliance Gates */}
    <div className="bg-white rounded-lg border border-admin-border p-4">
      <h3 className="text-sm font-medium text-gray-500 mb-3">Compliance Gates</h3>
      <div className="space-y-2">
        <GateBadge label="Customer" status={data.customer?.complianceStatus} />
        <GateBadge label="KYT" status={data.kytStatus} />
        <GateBadge label="Travel Rule" status={data.travelRuleStatus} />
      </div>
    </div>

    {/* Identity Summary */}
    <div className="bg-white rounded-lg border border-admin-border p-4">
      <h3 className="text-sm font-medium text-gray-500 mb-3">Identity</h3>
      {/* ownerNo, ownerType, compliance/onboarding badges */}
    </div>

    {/* Lifecycle */}
    <div className="bg-white rounded-lg border border-admin-border p-4">
      <h3 className="text-sm font-medium text-gray-500 mb-3">Lifecycle</h3>
      {/* createdAt, completedAt, duration */}
    </div>
  </div>
</div>
```

- [ ] **Step 4: Add ActionSection logic**

Add `availableActions` useMemo and `handleAction` following SwapTransactionDetail pattern:

```typescript
interface WorkflowAction {
  action: string;
  label: string;
  variant: 'workflowPrimary' | 'workflowSecondary' | 'workflowNegative';
}

const availableActions = useMemo<WorkflowAction[]>(() => {
  if (!data) return [];
  switch (data.status) {
    case 'ACTION_PENDING':
      return [
        { action: 'expire', label: 'Expire', variant: 'workflowSecondary' },
      ];
    case 'FROZEN':
      return [
        { action: 'approve', label: 'Release Funds', variant: 'workflowPrimary' },
        { action: 'confiscate', label: 'Confiscate', variant: 'workflowNegative' },
      ];
    default:
      return [];
  }
}, [data]);

const handleAction = async (action: string, reason?: string) => {
  if (!id) return;
  setIsSubmitting(true);
  setError('');
  try {
    const response = await adminFetch(
      `${import.meta.env.VITE_API_URL}/deposit-transactions/${id}/status`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, reason }),
      },
    );
    if (!response.ok) {
      setError(await getApiErrorMessage(response, 'Action failed.'));
      return;
    }
    const result = await response.json();
    setData((prev: any) => (prev ? { ...prev, ...result } : result));
    setIsReasonModalOpen(false);
  } catch (error) {
    if (error instanceof AdminSessionError) return;
    setError(error instanceof Error ? error.message : 'Action failed.');
  } finally {
    setIsSubmitting(false);
  }
};
```

- [ ] **Step 5: Add GateBadge helper component**

```typescript
const GateBadge = ({ label, status }: { label: string; status?: string | null }) => {
  const s = status || 'PENDING';
  const style =
    s === 'PASSED' || s === 'ACTIVE' || s === 'APPROVED'
      ? 'bg-green-50 text-green-700'
      : s === 'FAILED' || s === 'FROZEN' || s === 'SUSPENDED'
        ? 'bg-red-50 text-red-700'
        : 'bg-gray-50 text-gray-500';
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-gray-500">{label}</span>
      <span className={`px-2 py-0.5 rounded text-xs font-medium ${style}`}>{s}</span>
    </div>
  );
};
```

- [ ] **Step 6: Add reason modal for confiscate action**

Follow the reject modal pattern from SwapTransactionDetail. Add state and modal:

```typescript
const [isReasonModalOpen, setIsReasonModalOpen] = useState(false);
const [reasonText, setReasonText] = useState('');
const [pendingAction, setPendingAction] = useState('');
```

When confiscate is clicked, set `pendingAction = 'confiscate'` and open modal. On confirm, call `handleAction(pendingAction, reasonText)`.

- [ ] **Step 7: Remove DetailPageHeader title/subtitle**

Ensure `DetailPageHeader` has no `title` or `subtitle` props — only back navigation. depositNo is displayed in the Hero Zone.

- [ ] **Step 8: Ensure API response includes kytStatus and travelRuleStatus**

Check `deposit-transactions.service.ts` `findOne()` — the Prisma query should already return these fields since they're direct model columns (not relations). Verify by checking the response shape.

- [ ] **Step 9: Commit**

```bash
git add admin-web/src/pages/DepositTransactionDetail.tsx
git commit -m "feat(admin): rewrite deposit detail page — two-column layout, ActionSection, compliance gates"
```

---

### Task 7: Frontend — Client Deposit Page Tipping-Off Safe Mapping

**Files:**
- Modify: `client-web/src/pages/Deposit.tsx`

**Context:** `renderStatusBadge` (line 301) has stale statuses (UNDER_REVIEW, HELD, CREATED, PAYIN_LINKED). Replace with tipping-off-safe V4 mapping. Customer sees 6 states: Processing, Completed, Declined, Failed, Expired, Contact Support.

- [ ] **Step 1: Create customer status mapping function**

Add before `renderStatusBadge`:

```typescript
const getCustomerFacingStatus = (internalStatus: string): { label: string; color: string } => {
  switch (internalStatus) {
    case 'PAYIN_PENDING':
    case 'COMPLIANCE_PENDING':
    case 'ACTION_PENDING':
    case 'FROZEN':
      return { label: 'Processing', color: 'bg-blue-500/20 text-blue-400' };
    case 'SUCCESS':
      return { label: 'Completed', color: 'bg-fx-sage/20 text-fx-sage' };
    case 'REJECTED':
      return { label: 'Declined', color: 'bg-rose-500/20 text-rose-400' };
    case 'FAILED':
      return { label: 'Failed', color: 'bg-fx-rust/20 text-fx-rust' };
    case 'EXPIRED':
      return { label: 'Expired', color: 'bg-fx-dust/20 text-fx-dust' };
    case 'CONFISCATED':
      return { label: 'Contact Support', color: 'bg-rose-500/20 text-rose-400' };
    default:
      return { label: 'Processing', color: 'bg-fx-dust/20 text-fx-dust' };
  }
};
```

- [ ] **Step 2: Update renderStatusBadge to use customer-facing mapping**

Replace `renderStatusBadge` (lines 301-319):

```typescript
const renderStatusBadge = (status: string) => {
  const { label, color } = getCustomerFacingStatus(status);
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${color}`}>
      {label}
    </span>
  );
};
```

- [ ] **Step 3: Remove stale status references**

Search for any remaining references to UNDER_REVIEW, HELD, CREATED, PAYIN_LINKED in the deposit status context and remove/update them.

- [ ] **Step 4: Commit**

```bash
git add client-web/src/pages/Deposit.tsx
git commit -m "feat(client): apply tipping-off-safe status mapping for deposit page"
```

---

### Task 8: E2E Happy Path Verification

**Files:** None (live API testing)

**Context:** Verify the full happy path works end-to-end by calling APIs in sequence.

- [ ] **Step 1: Start the dev stack**

```bash
cd Exchange_js && npm run dev:start
```

Wait for backend on port 3500, admin on 3501, client on 3502.

- [ ] **Step 2: Get auth tokens**

```bash
# Admin token
ADMIN_TOKEN=$(curl -s http://localhost:3500/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@exchange.com","password":"admin123"}' | jq -r '.access_token')

# Customer token (use existing test customer)
CUST_TOKEN=$(curl -s http://localhost:3500/auth/customer/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"test@example.com","password":"test123"}' | jq -r '.access_token')
```

- [ ] **Step 3: Simulate deposit creation (client-side)**

```bash
# Create inbound transfer signal
SIGNAL=$(curl -s http://localhost:3500/deposit-transactions/my/inbound-signals \
  -H "Authorization: Bearer $CUST_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"assetId":"<ASSET_ID>","amount":"100","txHash":"0xTEST_HAPPY_PATH_'$(date +%s)'"}')
echo "$SIGNAL" | jq .

# Scan for signals
curl -s http://localhost:3500/deposit-transactions/my/inbound-signals/scan \
  -H "Authorization: Bearer $CUST_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"assetId":"<ASSET_ID>"}' | jq .
```

- [ ] **Step 4: Advance payin to CLEARED (admin)**

```bash
# Find the payin
PAYIN_ID=$(curl -s "http://localhost:3500/admin/treasury/payins?take=1" \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq -r '.items[0].id')

# Advance to CLEARED
curl -s "http://localhost:3500/admin/treasury/payins/$PAYIN_ID/mock-event" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"event":"CHAIN_CONFIRMED"}' | jq .

curl -s "http://localhost:3500/admin/treasury/payins/$PAYIN_ID/mock-event" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"event":"FIAT_CONFIRMED"}' | jq .
```

- [ ] **Step 5: Verify deposit is COMPLIANCE_PENDING with gates initialized**

```bash
# Find deposit
DEPOSIT=$(curl -s "http://localhost:3500/deposit-transactions?take=1" \
  -H "Authorization: Bearer $ADMIN_TOKEN")
echo "$DEPOSIT" | jq '.items[0] | {status, kytStatus, travelRuleStatus}'
```

Expected: `{ "status": "COMPLIANCE_PENDING", "kytStatus": "PENDING", "travelRuleStatus": "PENDING" }`

- [ ] **Step 6: Simulate KYT check PASS**

```bash
TX_HASH=$(echo "$DEPOSIT" | jq -r '.items[0].txHash')
curl -s "http://localhost:3500/admin/sumsub/simulate/kyt-check" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"txHash\":\"$TX_HASH\",\"result\":\"PASS\",\"riskScore\":10}" | jq .
```

- [ ] **Step 7: Simulate TR check PASS**

```bash
curl -s "http://localhost:3500/admin/sumsub/simulate/tr-check" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"txHash\":\"$TX_HASH\",\"result\":\"PASS\"}" | jq .
```

- [ ] **Step 8: Verify deposit is SUCCESS**

```bash
DEPOSIT_ID=$(echo "$DEPOSIT" | jq -r '.items[0].id')
curl -s "http://localhost:3500/deposit-transactions/$DEPOSIT_ID" \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq '{status, kytStatus, travelRuleStatus, completedAt}'
```

Expected: `{ "status": "SUCCESS", "kytStatus": "PASSED", "travelRuleStatus": "PASSED", "completedAt": "<timestamp>" }`

- [ ] **Step 9: Verify frontend pages display correctly**

Open in browser:
1. `http://localhost:3501` — Admin deposit list: verify V4 status badges render correctly
2. Click on the deposit — Admin detail: verify two-column layout, compliance gates show PASSED
3. `http://localhost:3502` — Client deposit history: verify shows "Completed" (not internal status)

- [ ] **Step 10: Commit verification notes**

```bash
git commit --allow-empty -m "test: verify deposit V4 happy path E2E — all gates pass, TB accounting complete"
```
