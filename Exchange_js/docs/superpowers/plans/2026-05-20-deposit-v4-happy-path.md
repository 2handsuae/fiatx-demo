# Deposit V4 Happy Path Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire end-to-end deposit happy path (client create → payin advance → KYT/TR pass → auto-approve with TB accounting) and align all frontend pages to V4 state machine.

**Architecture:** Backend adds three-gate compliance check (Gate 0: customer status → FROZEN if abnormal; Gate 1: KYT; Gate 2: TR) with auto-approval via `approveDeposit()` (which already handles TB Step 2). Frontend updates admin list/detail for V4 statuses and adds compliance gates sidebar. Client page gets tipping-off-safe mapping.

**Tech Stack:** NestJS, Prisma (SQLite), TigerBeetle, React, Tailwind CSS

**Spec:** `docs/superpowers/specs/2026-05-18-deposit-frontend-v4-alignment-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/modules/trading/deposit-transactions/deposit-transactions.service.ts` | Modify | Add 4 L1 methods for compliance gate data |
| `src/modules/trading/deposit-transactions/deposit-transactions.service.spec.ts` | Modify | Tests for L1 methods |
| `src/modules/trading/deposit-transactions/deposit-workflow.service.ts` | Modify | Gate 0 check + `checkAutoApproval()` |
| `src/modules/trading/deposit-transactions/deposit-workflow.service.spec.ts` | Create | Tests for Gate 0 + auto-approval |
| `src/modules/sumsub-ingestion/admin-sumsub-simulation.controller.ts` | Modify | Add KYT + TR simulation endpoints |
| `src/modules/sumsub-ingestion/sumsub-ingestion.module.ts` | Modify | Import DepositTransactionsModule |
| `admin-web/src/utils/transactionRootDisplay.ts` | Modify | V4 status labels |
| `admin-web/src/pages/DepositTransactionList.tsx` | Modify | V4 status badges + filter dropdown |
| `admin-web/src/pages/DepositTransactionDetail.tsx` | Modify | Two-column layout, ActionSection, compliance gates sidebar |
| `client-web/src/pages/Deposit.tsx` | Modify | Tipping-off-safe status mapping |

---

### Task 1: Backend — L1 Compliance Gate Methods

**Files:**
- Modify: `src/modules/trading/deposit-transactions/deposit-transactions.service.ts:352-431` (append before `createRandom`)
- Modify: `src/modules/trading/deposit-transactions/deposit-transactions.service.spec.ts:298-319` (append before closing `});`)

**Context:** The Prisma schema already has `kytStatus` (default `"PENDING"`), `travelRuleRequired` (default `false`), `travelRuleStatus` (default `"NOT_REQUIRED"`) on `DepositTransaction`. We add L1 methods so the workflow service (L3) doesn't write Prisma directly (Rule 5). The existing test file mocks `(prisma as any).depositTransaction.findUnique` — follow this pattern exactly.

- [ ] **Step 1: Add `customerMain` to the test's PrismaService mock**

In `deposit-transactions.service.spec.ts`, inside the `beforeEach` `useValue` for `PrismaService` (around line 23), add after the `wallet` block:

```typescript
            customerMain: {
              findUnique: jest.fn(),
            },
```

The full mock `useValue` becomes:

```typescript
          useValue: {
            depositTransaction: {
              findUnique: jest.fn(),
              findMany: jest.fn(),
              update: jest.fn(),
              create: jest.fn(),
              count: jest.fn(),
            },
            wallet: {
              findUnique: jest.fn(),
            },
            customerMain: {
              findUnique: jest.fn(),
            },
          },
```

- [ ] **Step 2: Write failing tests for the four L1 methods**

Append to `deposit-transactions.service.spec.ts`, right **before** the final closing `});` of the top-level `describe`:

```typescript
  describe('Compliance Gate Methods', () => {
    it('initializeComplianceGates sets travelRule fields', async () => {
      const mockRecord = { id: 'dep-1', travelRuleRequired: true, travelRuleStatus: 'PENDING' };
      ((prisma as any).depositTransaction.update as jest.Mock).mockResolvedValue(mockRecord);

      const result = await service.initializeComplianceGates('dep-1');

      expect((prisma as any).depositTransaction.update).toHaveBeenCalledWith({
        where: { id: 'dep-1' },
        data: {
          travelRuleRequired: true,
          travelRuleStatus: 'PENDING',
        },
      });
      expect(result.travelRuleStatus).toBe('PENDING');
    });

    it('updateKytStatus sets kytStatus, riskScore, and checkedAt', async () => {
      const mockRecord = { id: 'dep-1', kytStatus: 'PASSED', kytRiskScore: 15, kytCheckedAt: new Date() };
      ((prisma as any).depositTransaction.update as jest.Mock).mockResolvedValue(mockRecord);

      const result = await service.updateKytStatus('dep-1', 'PASSED', 15);

      expect((prisma as any).depositTransaction.update).toHaveBeenCalledWith({
        where: { id: 'dep-1' },
        data: expect.objectContaining({
          kytStatus: 'PASSED',
          kytRiskScore: 15,
          kytCheckedAt: expect.any(Date),
        }),
      });
      expect(result.kytStatus).toBe('PASSED');
    });

    it('updateTravelRuleStatus sets travelRuleStatus and checkedAt', async () => {
      const mockRecord = { id: 'dep-1', travelRuleStatus: 'PASSED', travelRuleCheckedAt: new Date() };
      ((prisma as any).depositTransaction.update as jest.Mock).mockResolvedValue(mockRecord);

      const result = await service.updateTravelRuleStatus('dep-1', 'PASSED');

      expect((prisma as any).depositTransaction.update).toHaveBeenCalledWith({
        where: { id: 'dep-1' },
        data: expect.objectContaining({
          travelRuleStatus: 'PASSED',
          travelRuleCheckedAt: expect.any(Date),
        }),
      });
      expect(result.travelRuleStatus).toBe('PASSED');
    });

    it('getOwnerComplianceStatus returns customer complianceStatus', async () => {
      ((prisma as any).depositTransaction.findUnique as jest.Mock).mockResolvedValue({
        id: 'dep-1',
        ownerId: 'cust-1',
      });
      ((prisma as any).customerMain.findUnique as jest.Mock).mockResolvedValue({
        id: 'cust-1',
        complianceStatus: 'ACTIVE',
      });

      const result = await service.getOwnerComplianceStatus('dep-1');

      expect(result).toBe('ACTIVE');
      expect((prisma as any).depositTransaction.findUnique).toHaveBeenCalledWith({
        where: { id: 'dep-1' },
        select: { ownerId: true },
      });
    });

    it('getOwnerComplianceStatus throws if deposit not found', async () => {
      ((prisma as any).depositTransaction.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.getOwnerComplianceStatus('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('getOwnerComplianceStatus returns UNKNOWN when customer not found', async () => {
      ((prisma as any).depositTransaction.findUnique as jest.Mock).mockResolvedValue({
        id: 'dep-1',
        ownerId: 'missing-cust',
      });
      ((prisma as any).customerMain.findUnique as jest.Mock).mockResolvedValue(null);

      const result = await service.getOwnerComplianceStatus('dep-1');

      expect(result).toBe('UNKNOWN');
    });
  });
```

Add `NotFoundException` to the imports at line 8:

```typescript
import { BadRequestException, NotFoundException } from '@nestjs/common';
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd Exchange_js && npx jest deposit-transactions.service.spec --no-coverage`
Expected: FAIL — `service.initializeComplianceGates is not a function`

- [ ] **Step 4: Implement the four methods**

In `deposit-transactions.service.ts`, add these methods right **before** the `createFromPayin` method (before line 306):

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

  async updateKytStatus(id: string, status: string, riskScore?: number | null) {
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

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd Exchange_js && npx jest deposit-transactions.service.spec --no-coverage`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add src/modules/trading/deposit-transactions/deposit-transactions.service.ts src/modules/trading/deposit-transactions/deposit-transactions.service.spec.ts
git commit -m "feat(deposit): add L1 compliance gate methods (initializeComplianceGates, updateKytStatus, updateTravelRuleStatus, getOwnerComplianceStatus)"
```

---

### Task 2: Backend — Gate 0 + Auto-Approval in DepositWorkflowService

**Files:**
- Modify: `src/modules/trading/deposit-transactions/deposit-workflow.service.ts:70-74` (replace `handleDepositStatusChanged`)
- Create: `src/modules/trading/deposit-transactions/deposit-workflow.service.spec.ts`

**Context:** `handleDepositStatusChanged` at line 70-74 currently only logs. We add: (1) Gate 0 check when entering COMPLIANCE_PENDING; (2) `checkAutoApproval()` that the simulation endpoints call after updating KYT/TR. The existing `approveDeposit()` at line 76 already does TB Step 2 + status → SUCCESS.

**Important:** `DepositWorkflowService` injects `DepositTransactionsService`, `PayinsService`, `AuditLogsService` (global), `AccountingService`. The constructor is at lines 31-36. We do NOT add new constructor params — we call methods on the already-injected `depositService`.

- [ ] **Step 1: Write failing tests**

Create `src/modules/trading/deposit-transactions/deposit-workflow.service.spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { DepositWorkflowService } from './deposit-workflow.service';
import { DepositTransactionsService } from './deposit-transactions.service';
import { PayinsService } from '../../asset-treasury/payins/payins.service';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import { AccountingService } from '../../accounting/tigerbeetle/accounting.service';
import { DepositStatusChangedEvent } from './events/deposit-transaction.events';
import {
  DepositTransactionStatus,
  DepositTransactionAction,
} from './dto/deposit-transaction.dto';

describe('DepositWorkflowService', () => {
  let service: DepositWorkflowService;
  let depositService: Record<string, jest.Mock>;
  let auditLogsService: Record<string, jest.Mock>;

  beforeEach(async () => {
    depositService = {
      getOwnerComplianceStatus: jest.fn(),
      initializeComplianceGates: jest.fn(),
      updateStatus: jest.fn(),
      findOne: jest.fn(),
      updateKytStatus: jest.fn(),
      updateTravelRuleStatus: jest.fn(),
      findByPayinId: jest.fn(),
      createFromPayin: jest.fn(),
    };
    auditLogsService = {
      recordSystem: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DepositWorkflowService,
        { provide: DepositTransactionsService, useValue: depositService },
        { provide: PayinsService, useValue: { findOne: jest.fn(), updateStatus: jest.fn(), linkDeposit: jest.fn() } },
        { provide: AuditLogsService, useValue: auditLogsService },
        { provide: AccountingService, useValue: { resolveTbAccountId: jest.fn(), executeTransfer: jest.fn() } },
      ],
    }).compile();

    service = module.get<DepositWorkflowService>(DepositWorkflowService);
  });

  describe('handleDepositStatusChanged — Gate 0', () => {
    it('initializes compliance gates when entering COMPLIANCE_PENDING with normal customer', async () => {
      depositService.getOwnerComplianceStatus.mockResolvedValue('ACTIVE');
      depositService.initializeComplianceGates.mockResolvedValue({});

      const event = new DepositStatusChangedEvent(
        'dep-1',
        DepositTransactionStatus.PAYIN_PENDING,
        DepositTransactionStatus.COMPLIANCE_PENDING,
        'CUSTOMER', 'cust-1', 'asset-1', '100', 'payin-1',
      );

      await service.handleDepositStatusChanged(event);

      expect(depositService.getOwnerComplianceStatus).toHaveBeenCalledWith('dep-1');
      expect(depositService.initializeComplianceGates).toHaveBeenCalledWith('dep-1');
    });

    it('freezes deposit when customer complianceStatus is FROZEN', async () => {
      depositService.getOwnerComplianceStatus.mockResolvedValue('FROZEN');

      const event = new DepositStatusChangedEvent(
        'dep-1',
        DepositTransactionStatus.PAYIN_PENDING,
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

    it('freezes deposit when customer complianceStatus is SUSPENDED', async () => {
      depositService.getOwnerComplianceStatus.mockResolvedValue('SUSPENDED');

      const event = new DepositStatusChangedEvent(
        'dep-1',
        DepositTransactionStatus.PAYIN_PENDING,
        DepositTransactionStatus.COMPLIANCE_PENDING,
        'CUSTOMER', 'cust-1', 'asset-1', '100', 'payin-1',
      );

      await service.handleDepositStatusChanged(event);

      expect(depositService.updateStatus).toHaveBeenCalledWith(
        'dep-1',
        { action: DepositTransactionAction.FREEZE },
        expect.objectContaining({
          reason: expect.stringContaining('SUSPENDED'),
        }),
      );
    });

    it('does nothing for non-COMPLIANCE_PENDING transitions', async () => {
      const event = new DepositStatusChangedEvent(
        'dep-1',
        DepositTransactionStatus.COMPLIANCE_PENDING,
        DepositTransactionStatus.SUCCESS,
        'CUSTOMER', 'cust-1', 'asset-1', '100', 'payin-1',
      );

      await service.handleDepositStatusChanged(event);

      expect(depositService.getOwnerComplianceStatus).not.toHaveBeenCalled();
    });
  });

  describe('checkAutoApproval', () => {
    it('approves when all three gates pass (COMPLIANCE_PENDING + ACTIVE + PASSED + PASSED)', async () => {
      depositService.findOne.mockResolvedValue({
        id: 'dep-1',
        depositNo: 'DEP001',
        status: DepositTransactionStatus.COMPLIANCE_PENDING,
        kytStatus: 'PASSED',
        travelRuleStatus: 'PASSED',
        ownerId: 'cust-1',
        ownerType: 'CUSTOMER',
        assetId: 'asset-1',
        amount: '100',
        payinId: 'payin-1',
        traceId: 'trace-1',
        asset: { currency: 'USDT', tbLedgerId: 2, decimals: 6 },
      });
      depositService.getOwnerComplianceStatus.mockResolvedValue('ACTIVE');
      // approveDeposit calls these internally — mock them
      depositService.updateStatus.mockResolvedValue({});

      await service.checkAutoApproval('dep-1');

      // approveDeposit is called, which internally calls depositService.findOne + updateStatus
      // We verify it was called by checking that findOne was called
      expect(depositService.findOne).toHaveBeenCalledWith('dep-1');
      expect(depositService.getOwnerComplianceStatus).toHaveBeenCalledWith('dep-1');
    });

    it('does not approve when deposit is FROZEN (even if KYT+TR passed)', async () => {
      depositService.findOne.mockResolvedValue({
        id: 'dep-1',
        status: DepositTransactionStatus.FROZEN,
        kytStatus: 'PASSED',
        travelRuleStatus: 'PASSED',
      });

      await service.checkAutoApproval('dep-1');

      expect(depositService.updateStatus).not.toHaveBeenCalled();
    });

    it('does not approve when kytStatus is PENDING', async () => {
      depositService.findOne.mockResolvedValue({
        id: 'dep-1',
        status: DepositTransactionStatus.COMPLIANCE_PENDING,
        kytStatus: 'PENDING',
        travelRuleStatus: 'PASSED',
      });

      await service.checkAutoApproval('dep-1');

      expect(depositService.getOwnerComplianceStatus).not.toHaveBeenCalled();
    });

    it('does not approve when travelRuleStatus is PENDING', async () => {
      depositService.findOne.mockResolvedValue({
        id: 'dep-1',
        status: DepositTransactionStatus.COMPLIANCE_PENDING,
        kytStatus: 'PASSED',
        travelRuleStatus: 'PENDING',
      });

      await service.checkAutoApproval('dep-1');

      expect(depositService.getOwnerComplianceStatus).not.toHaveBeenCalled();
    });

    it('does not approve when customer compliance is abnormal', async () => {
      depositService.findOne.mockResolvedValue({
        id: 'dep-1',
        status: DepositTransactionStatus.COMPLIANCE_PENDING,
        kytStatus: 'PASSED',
        travelRuleStatus: 'PASSED',
        ownerId: 'cust-1',
      });
      depositService.getOwnerComplianceStatus.mockResolvedValue('FROZEN');

      await service.checkAutoApproval('dep-1');

      expect(depositService.updateStatus).not.toHaveBeenCalled();
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd Exchange_js && npx jest deposit-workflow.service.spec --no-coverage`
Expected: FAIL — `service.checkAutoApproval is not a function`

- [ ] **Step 3: Implement Gate 0 and checkAutoApproval**

In `deposit-workflow.service.ts`, add a static set after the class declaration (after line 28, before `constructor`):

```typescript
  private static readonly ABNORMAL_COMPLIANCE = new Set([
    'FROZEN', 'SUSPENDED', 'BLOCKED', 'REJECTED',
  ]);
```

Replace the `handleDepositStatusChanged` method (lines 70-74) with:

```typescript
  @OnEvent('deposit.status.changed')
  async handleDepositStatusChanged(event: DepositStatusChangedEvent) {
    const { depositId, oldStatus, newStatus } = event;
    this.logger.log(
      `Deposit ${depositId} transitioned ${oldStatus} → ${newStatus}`,
    );

    if (newStatus === DepositTransactionStatus.COMPLIANCE_PENDING) {
      await this.runGate0(depositId);
    }
  }

  private async runGate0(depositId: string) {
    const complianceStatus =
      await this.depositService.getOwnerComplianceStatus(depositId);

    if (DepositWorkflowService.ABNORMAL_COMPLIANCE.has(complianceStatus)) {
      this.logger.warn(
        `Gate 0 FAIL: deposit ${depositId} — customer compliance status: ${complianceStatus}`,
      );
      await this.depositService.updateStatus(
        depositId,
        { action: DepositTransactionAction.FREEZE },
        {
          reason: `Customer compliance status: ${complianceStatus}`,
          actor: { actorType: 'SYSTEM', actorId: 'COMPLIANCE_GATE_0' },
        },
      );
      return;
    }

    this.logger.log(`Gate 0 PASS: deposit ${depositId}`);
    await this.depositService.initializeComplianceGates(depositId);
  }

  async checkAutoApproval(depositId: string) {
    const deposit = await this.depositService.findOne(depositId);

    if (deposit.status !== DepositTransactionStatus.COMPLIANCE_PENDING) {
      this.logger.debug(
        `Auto-approval skip: deposit ${depositId} status is ${deposit.status}`,
      );
      return;
    }

    if (deposit.kytStatus !== 'PASSED') {
      this.logger.debug(
        `Auto-approval skip: deposit ${depositId} kytStatus=${deposit.kytStatus}`,
      );
      return;
    }

    if (deposit.travelRuleStatus !== 'PASSED') {
      this.logger.debug(
        `Auto-approval skip: deposit ${depositId} travelRuleStatus=${deposit.travelRuleStatus}`,
      );
      return;
    }

    const complianceStatus =
      await this.depositService.getOwnerComplianceStatus(depositId);
    if (DepositWorkflowService.ABNORMAL_COMPLIANCE.has(complianceStatus)) {
      this.logger.warn(
        `Auto-approval skip: deposit ${depositId} customer status=${complianceStatus}`,
      );
      return;
    }

    this.logger.log(
      `All gates PASSED for deposit ${depositId} — auto-approving`,
    );
    await this.approveDeposit(depositId);
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd Exchange_js && npx jest deposit-workflow.service.spec --no-coverage`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add src/modules/trading/deposit-transactions/deposit-workflow.service.ts src/modules/trading/deposit-transactions/deposit-workflow.service.spec.ts
git commit -m "feat(deposit): add Gate 0 customer compliance check and auto-approval logic"
```

---

### Task 3: Backend — KYT + TR Simulation Endpoints + Module Wiring

**Files:**
- Modify: `src/modules/sumsub-ingestion/admin-sumsub-simulation.controller.ts:14-21` (constructor) + append endpoints
- Modify: `src/modules/sumsub-ingestion/sumsub-ingestion.module.ts:12-19` (imports)

**Context:** The simulation controller has 6 existing endpoints at `admin/sumsub/simulate`. We add 2 more: `kyt-check` and `tr-check`. The controller already injects `PrismaService` (for direct lookups) and has `ensureAdmin(req)` helper. We need `DepositTransactionsService` for L1 updates and `DepositWorkflowService` for `checkAutoApproval`. Both are exported from `DepositTransactionsModule`.

- [ ] **Step 1: Add DepositTransactionsModule to SumsubIngestionModule imports**

In `src/modules/sumsub-ingestion/sumsub-ingestion.module.ts`, add the import at the top:

```typescript
import { DepositTransactionsModule } from '../trading/deposit-transactions/deposit-transactions.module';
```

Add to the `imports` array:

```typescript
  imports: [
    PrismaModule,
    forwardRef(() => OnboardingModule),
    forwardRef(() => ClientRiskAssessmentModule),
    forwardRef(() => MaterialRefreshModule),
    forwardRef(() => TierUpgradeCaseModule),
    forwardRef(() => DepositTransactionsModule),
  ],
```

- [ ] **Step 2: Add service injections to the controller constructor**

In `admin-sumsub-simulation.controller.ts`, add imports at the top:

```typescript
import { DepositWorkflowService } from '../trading/deposit-transactions/deposit-workflow.service';
import { DepositTransactionsService } from '../trading/deposit-transactions/deposit-transactions.service';
```

Add to the constructor (after the `prisma` parameter, before the closing `{}`):

```typescript
    private readonly depositWorkflowService: DepositWorkflowService,
    private readonly depositTransactionsService: DepositTransactionsService,
```

- [ ] **Step 3: Add simulateKytCheck endpoint**

Append after the last endpoint (after line 343, before the closing `}` of the class):

```typescript
  @Post('kyt-check')
  @ApiOperation({ summary: 'Simulate KYT (Know Your Transaction) check result' })
  async simulateKytCheck(
    @Req() req: any,
    @Body() body: { txHash: string; result: 'PASS' | 'FAIL'; riskScore?: number },
  ) {
    this.ensureAdmin(req);

    if (!body.txHash || !body.result) {
      throw new BadRequestException('txHash and result (PASS|FAIL) are required');
    }
    if (!['PASS', 'FAIL'].includes(body.result)) {
      throw new BadRequestException('result must be PASS or FAIL');
    }

    const deposit = await this.prisma.depositTransaction.findFirst({
      where: { txHash: body.txHash },
    });
    if (!deposit) {
      throw new NotFoundException(`No deposit found with txHash: ${body.txHash}`);
    }

    const kytStatus = body.result === 'PASS' ? 'PASSED' : 'FAILED';
    await this.depositTransactionsService.updateKytStatus(
      deposit.id,
      kytStatus,
      body.riskScore ?? null,
    );

    await this.depositWorkflowService.checkAutoApproval(deposit.id);

    return {
      depositId: deposit.id,
      depositNo: deposit.depositNo,
      kytStatus,
      riskScore: body.riskScore ?? null,
      message: `KYT check simulated: ${kytStatus}`,
    };
  }
```

- [ ] **Step 4: Add simulateTrCheck endpoint**

Append right after the `simulateKytCheck` method:

```typescript
  @Post('tr-check')
  @ApiOperation({ summary: 'Simulate Travel Rule (TR) check result' })
  async simulateTrCheck(
    @Req() req: any,
    @Body() body: { txHash: string; result: 'PASS' | 'FAIL' },
  ) {
    this.ensureAdmin(req);

    if (!body.txHash || !body.result) {
      throw new BadRequestException('txHash and result (PASS|FAIL) are required');
    }
    if (!['PASS', 'FAIL'].includes(body.result)) {
      throw new BadRequestException('result must be PASS or FAIL');
    }

    const deposit = await this.prisma.depositTransaction.findFirst({
      where: { txHash: body.txHash },
    });
    if (!deposit) {
      throw new NotFoundException(`No deposit found with txHash: ${body.txHash}`);
    }

    const trStatus = body.result === 'PASS' ? 'PASSED' : 'FAILED';
    await this.depositTransactionsService.updateTravelRuleStatus(
      deposit.id,
      trStatus,
    );

    await this.depositWorkflowService.checkAutoApproval(deposit.id);

    return {
      depositId: deposit.id,
      depositNo: (deposit as any).depositNo,
      travelRuleStatus: trStatus,
      message: `Travel Rule check simulated: ${trStatus}`,
    };
  }
```

- [ ] **Step 5: Verify backend compiles**

Run: `cd Exchange_js && npx tsc --noEmit 2>&1 | head -30`
Expected: No new errors

- [ ] **Step 6: Commit**

```bash
git add src/modules/sumsub-ingestion/admin-sumsub-simulation.controller.ts src/modules/sumsub-ingestion/sumsub-ingestion.module.ts
git commit -m "feat(simulation): add KYT and Travel Rule check simulation endpoints"
```

---

### Task 4: Frontend — Shared Utilities V4 Update

**Files:**
- Modify: `admin-web/src/utils/transactionRootDisplay.ts:1-8`

**Context:** `TRANSACTION_ROOT_STATUS_LABELS` has `UNDER_REVIEW` and `PENDING_COMPLIANCE` but is missing V4 statuses: `ACTION_PENDING`, `EXPIRED`, `CONFISCATED`, `FROZEN`. The `formatStatusLabel` fallback (line 40-44) auto-formats any `UPPER_CASE` to `Title Case`, so only add entries where we want a custom label.

- [ ] **Step 1: Update TRANSACTION_ROOT_STATUS_LABELS**

Replace lines 1-8 of `transactionRootDisplay.ts`:

```typescript
const TRANSACTION_ROOT_STATUS_LABELS: Record<string, string> = {
  PAYIN_PENDING: 'Payin Pending',
  COMPLIANCE_PENDING: 'Compliance Pending',
  ACTION_PENDING: 'Action Pending',
  PAYOUT_PENDING: 'Payout Pending',
  SEEN_IN_MEMPOOL: 'Seen In Mempool',
};
```

This removes `PENDING_COMPLIANCE` (duplicate), `UNDER_REVIEW` (stale). `SUCCESS`, `REJECTED`, `FAILED`, `EXPIRED`, `FROZEN`, `CONFISCATED` are not listed because the fallback `formatStatusLabel` handles them correctly as single words.

- [ ] **Step 2: Verify frontend compiles**

Run: `cd Exchange_js/admin-web && npx tsc --noEmit 2>&1 | head -20`

- [ ] **Step 3: Commit**

```bash
git add admin-web/src/utils/transactionRootDisplay.ts
git commit -m "feat(admin): update transactionRootDisplay with V4 deposit statuses"
```

---

### Task 5: Frontend — Admin List Page V4 Update

**Files:**
- Modify: `admin-web/src/pages/DepositTransactionList.tsx:196-202` (badge colors) + `296-304` (filter options)

- [ ] **Step 1: Update status badge color map**

Replace the `colors` object inside `renderStatusBadge` (around lines 196-202):

```typescript
      PAYIN_PENDING: 'bg-blue-100 text-blue-800',
      COMPLIANCE_PENDING: 'bg-purple-100 text-purple-800',
      ACTION_PENDING: 'bg-amber-100 text-amber-800',
      SUCCESS: 'bg-green-100 text-green-800',
      FROZEN: 'bg-cyan-100 text-cyan-800',
      REJECTED: 'bg-red-100 text-red-800',
      FAILED: 'bg-orange-100 text-orange-800',
      EXPIRED: 'bg-gray-100 text-gray-800',
      CONFISCATED: 'bg-red-200 text-red-900',
```

Remove `UNDER_REVIEW: 'bg-yellow-100 text-yellow-800'`.

- [ ] **Step 2: Update filter dropdown options**

Replace the status `<option>` elements (around lines 298-304):

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
git commit -m "feat(admin): update deposit list page with V4 statuses and filter options"
```

---

### Task 6: Frontend — Admin Deposit Detail Page Update

**Files:**
- Modify: `admin-web/src/pages/DepositTransactionDetail.tsx`

**Context:** The page is 616 lines, single-column layout. The interface (lines 39-143) already has `kytStatus`, `travelRuleStatus`, compliance gate fields. The main changes: (1) replace UNDER_REVIEW with V4 statuses in all color/logic helpers; (2) convert to two-column layout with sidebar; (3) add ActionSection + GateBadge. This is the largest task.

**Reference patterns:**
- ActionSection: `SwapTransactionDetail.tsx` lines 149-167 (`availableActions`), 114-147 (`handleAction`)
- Two-column: `<div className="flex gap-6"><div className="flex-1">...main...</div><div className="w-[272px] shrink-0">...sidebar...</div></div>`

- [ ] **Step 1: Update renderStatusBadge color map (line 183-198)**

Replace the `colors` object:

```typescript
  const renderStatusBadge = (status: string) => {
    const colors: Record<string, string> = {
      PAYIN_PENDING: 'bg-blue-100 text-blue-800',
      COMPLIANCE_PENDING: 'bg-purple-100 text-purple-800',
      ACTION_PENDING: 'bg-amber-100 text-amber-800',
      FROZEN: 'bg-cyan-100 text-cyan-800',
      SUCCESS: 'bg-green-100 text-green-800',
      REJECTED: 'bg-red-100 text-red-800',
      FAILED: 'bg-orange-100 text-orange-800',
      EXPIRED: 'bg-gray-100 text-gray-800',
      CONFISCATED: 'bg-red-200 text-red-900',
    };
    return (
      <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${colors[status] || 'bg-gray-100 text-gray-800'}`}>
        {formatStatusLabel(status)}
      </span>
    );
  };
```

- [ ] **Step 2: Update getStatusColor and getStatusBadgeStyle helpers (lines 590-613)**

Replace both functions at the bottom of the file:

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

- [ ] **Step 3: Remove all UNDER_REVIEW references**

Search and replace throughout the file. Specific locations:

1. `getNextStepLabel` (line 223): Remove `if (detail.status === 'UNDER_REVIEW') return 'Alert or case resolution';`
2. `getProjectedFinalStates` (line 244): Replace `'SUCCESS or UNDER_REVIEW'` with `'SUCCESS or FROZEN'`
3. `renderStatusBadge` (already done in step 1): `UNDER_REVIEW` removed from colors map
4. Line 497: Change `data.status === 'UNDER_REVIEW'` to `data.status === 'ACTION_PENDING'` (or remove the condition entirely if it controls a section that's no longer relevant)

- [ ] **Step 4: Add state variables for ActionSection**

Add after the existing state declarations (after `useSimulationMode()` on line 151):

```typescript
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [actionError, setActionError] = useState('');
  const [isReasonModalOpen, setIsReasonModalOpen] = useState(false);
  const [reasonText, setReasonText] = useState('');
  const [pendingAction, setPendingAction] = useState('');
```

- [ ] **Step 5: Add availableActions and handleAction**

Add after the `handleCopy` function (after line 181):

```typescript
  interface WorkflowAction {
    action: string;
    label: string;
    variant: 'workflowPrimary' | 'workflowSecondary' | 'workflowNegative';
  }

  const availableActions: WorkflowAction[] = (() => {
    if (!data) return [];
    switch (data.status) {
      case 'ACTION_PENDING':
        return [
          { action: 'expire', label: 'Expire', variant: 'workflowSecondary' as const },
        ];
      case 'FROZEN':
        return [
          { action: 'approve', label: 'Release Funds', variant: 'workflowPrimary' as const },
          { action: 'confiscate', label: 'Confiscate', variant: 'workflowNegative' as const },
        ];
      default:
        return [];
    }
  })();

  const handleAction = async (action: string, reason?: string) => {
    if (!id) return;
    setIsSubmitting(true);
    setActionError('');
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
        setActionError(await getApiErrorMessage(response, 'Action failed.'));
        return;
      }
      await fetchData(); // Reload full data
      setIsReasonModalOpen(false);
      setReasonText('');
      setPendingAction('');
    } catch (error) {
      if (error instanceof AdminSessionError) return;
      setActionError(error instanceof Error ? error.message : 'Action failed.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const onActionClick = (action: string) => {
    if (action === 'confiscate') {
      setPendingAction(action);
      setIsReasonModalOpen(true);
    } else {
      handleAction(action);
    }
  };
```

- [ ] **Step 6: Add GateBadge helper component**

Add before the `getStatusColor` function at the bottom of the file:

```typescript
const GateBadge = ({ label, status }: { label: string; status?: string | null }) => {
  const s = status || 'PENDING';
  const style =
    s === 'PASSED' || s === 'ACTIVE' || s === 'APPROVED' || s === 'CLEAR'
      ? 'bg-green-50 text-green-700'
      : s === 'FAILED' || s === 'FROZEN' || s === 'SUSPENDED' || s === 'BLOCKED' || s === 'REJECTED'
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

- [ ] **Step 7: Add Compliance Gates + ActionSection + Identity + Lifecycle sidebar**

In the main return JSX, wrap the existing content in a two-column flex container. After the main content `<div>`, add a sidebar `<div className="w-[272px] shrink-0 space-y-4">`. The sidebar contains:

```tsx
    {/* Sidebar — 272px */}
    <div className="w-[272px] shrink-0 space-y-4">
      {/* ActionSection */}
      {availableActions.length > 0 && (
        <div className="bg-white rounded-lg border border-admin-border p-4">
          <h3 className="text-sm font-medium text-gray-500 mb-3">Workflow Actions</h3>
          {actionError && <p className="text-red-600 text-xs mb-2">{actionError}</p>}
          <div className="space-y-2">
            {availableActions.map((wa) => (
              <button
                key={wa.action}
                onClick={() => onActionClick(wa.action)}
                disabled={isSubmitting}
                className={`w-full px-3 py-2 rounded text-sm font-medium transition-colors ${
                  wa.variant === 'workflowPrimary'
                    ? 'bg-green-600 text-white hover:bg-green-700'
                    : wa.variant === 'workflowNegative'
                      ? 'bg-red-600 text-white hover:bg-red-700'
                      : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                } disabled:opacity-50`}
              >
                {isSubmitting ? 'Processing...' : wa.label}
              </button>
            ))}
          </div>
        </div>
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

      {/* Identity */}
      <div className="bg-white rounded-lg border border-admin-border p-4">
        <h3 className="text-sm font-medium text-gray-500 mb-3">Identity</h3>
        <div className="space-y-1 text-sm">
          {data.ownerNo && (
            <div className="flex justify-between">
              <span className="text-gray-500">Owner</span>
              <button
                onClick={() => navigate(`/customers/${data.ownerId}`)}
                className="text-brand-primary hover:underline"
              >
                {data.ownerNo}
              </button>
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-gray-500">Type</span>
            <span>{data.ownerType}</span>
          </div>
        </div>
      </div>

      {/* Lifecycle */}
      <div className="bg-white rounded-lg border border-admin-border p-4">
        <h3 className="text-sm font-medium text-gray-500 mb-3">Lifecycle</h3>
        <div className="space-y-1 text-sm">
          <div className="flex justify-between">
            <span className="text-gray-500">Created</span>
            <span>{new Date(data.createdAt).toLocaleString()}</span>
          </div>
          {data.completedAt && (
            <div className="flex justify-between">
              <span className="text-gray-500">Completed</span>
              <span>{new Date(data.completedAt).toLocaleString()}</span>
            </div>
          )}
        </div>
      </div>
    </div>
```

Add a reason modal at the end of the return JSX (before the closing fragment):

```tsx
      {/* Reason Modal */}
      {isReasonModalOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-[400px] shadow-xl">
            <h3 className="text-lg font-bold mb-4">Reason Required</h3>
            <textarea
              className="w-full border rounded p-2 text-sm mb-4"
              rows={3}
              placeholder="Enter reason for this action..."
              value={reasonText}
              onChange={(e) => setReasonText(e.target.value)}
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => { setIsReasonModalOpen(false); setReasonText(''); setPendingAction(''); }}
                className="px-4 py-2 border rounded text-sm"
              >
                Cancel
              </button>
              <button
                onClick={() => handleAction(pendingAction, reasonText)}
                disabled={isSubmitting || !reasonText.trim()}
                className="px-4 py-2 bg-red-600 text-white rounded text-sm disabled:opacity-50"
              >
                {isSubmitting ? 'Processing...' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
```

- [ ] **Step 8: Commit**

```bash
git add admin-web/src/pages/DepositTransactionDetail.tsx
git commit -m "feat(admin): update deposit detail — V4 statuses, compliance gates sidebar, ActionSection"
```

---

### Task 7: Frontend — Client Deposit Page Tipping-Off Safe Mapping

**Files:**
- Modify: `client-web/src/pages/Deposit.tsx:298-319` (renderStatusBadge) + `699-704` (filter dropdown)

**Context:** `renderStatusBadge` at line 298 has stale statuses (UNDER_REVIEW, HELD, PAYIN_LINKED). Replace with tipping-off-safe mapping. Customer sees 6 states: Processing, Completed, Declined, Failed, Expired, Contact Support. The filter dropdown also needs updating.

- [ ] **Step 1: Add customer-facing status mapping function**

Add right before `renderStatusBadge` (before line 298):

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

- [ ] **Step 2: Replace renderStatusBadge to use customer-facing mapping**

Replace lines 298-319:

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

- [ ] **Step 3: Update filter dropdown options (around lines 699-704)**

Replace status filter options to show customer-facing labels:

```tsx
                            <option value="">All Status</option>
                            <option value="PAYIN_PENDING">Processing</option>
                            <option value="SUCCESS">Completed</option>
                            <option value="REJECTED">Declined</option>
                            <option value="FAILED">Failed</option>
                            <option value="EXPIRED">Expired</option>
```

Remove `COMPLIANCE_PENDING` and `UNDER_REVIEW` from the dropdown — customer should not see these internal statuses.

- [ ] **Step 4: Remove stale status references**

Search for `PAYIN_LINKED`, `HELD`, `UNDER_REVIEW` in the file and remove them from any remaining badge/color maps.

- [ ] **Step 5: Commit**

```bash
git add client-web/src/pages/Deposit.tsx
git commit -m "feat(client): apply tipping-off-safe status mapping for deposit page"
```

---

### Task 8: E2E Happy Path Verification

**Files:** None (live API testing + visual check)

**Context:** Verify the full happy path: client create → payin advance → KYT PASS → TR PASS → auto-approve → SUCCESS with TB accounting.

- [ ] **Step 1: Start the dev stack**

```bash
cd Exchange_js && npm run dev:start
```

Wait for: backend on port 3500, admin on 3501, client on 3502.

- [ ] **Step 2: Get auth tokens**

```bash
ADMIN_TOKEN=$(curl -s http://localhost:3500/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@exchange.com","password":"admin123"}' | jq -r '.access_token')
echo "Admin token: ${ADMIN_TOKEN:0:20}..."
```

- [ ] **Step 3: Create a deposit via random generator (or use existing simulation)**

```bash
curl -s http://localhost:3500/deposit-transactions/random \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -X POST | jq '.[0] | {id, depositNo, status, txHash}'
```

Note the `id` and `txHash` from the output.

- [ ] **Step 4: Advance deposit from PAYIN_PENDING to COMPLIANCE_PENDING**

```bash
DEPOSIT_ID="<id from step 3>"
curl -s "http://localhost:3500/deposit-transactions/$DEPOSIT_ID/status" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -X PATCH \
  -d '{"action":"payin_confirmed"}' | jq '{status, kytStatus, travelRuleStatus}'
```

Expected: `{ "status": "COMPLIANCE_PENDING" }` — kytStatus/travelRuleStatus may still be their defaults until Gate 0 runs (it's event-driven).

- [ ] **Step 5: Verify Gate 0 ran (check compliance gates were initialized)**

```bash
curl -s "http://localhost:3500/deposit-transactions/$DEPOSIT_ID" \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq '{status, kytStatus, travelRuleStatus, travelRuleRequired}'
```

Expected: `{ "status": "COMPLIANCE_PENDING", "kytStatus": "PENDING", "travelRuleStatus": "PENDING", "travelRuleRequired": true }`

- [ ] **Step 6: Simulate KYT check PASS**

```bash
TX_HASH="<txHash from step 3>"
curl -s "http://localhost:3500/admin/sumsub/simulate/kyt-check" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"txHash\":\"$TX_HASH\",\"result\":\"PASS\",\"riskScore\":10}" | jq .
```

Expected: `{ "kytStatus": "PASSED", "message": "KYT check simulated: PASSED" }`

- [ ] **Step 7: Verify deposit is still COMPLIANCE_PENDING (TR not yet passed)**

```bash
curl -s "http://localhost:3500/deposit-transactions/$DEPOSIT_ID" \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq '{status, kytStatus, travelRuleStatus}'
```

Expected: `{ "status": "COMPLIANCE_PENDING", "kytStatus": "PASSED", "travelRuleStatus": "PENDING" }`

- [ ] **Step 8: Simulate TR check PASS**

```bash
curl -s "http://localhost:3500/admin/sumsub/simulate/tr-check" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"txHash\":\"$TX_HASH\",\"result\":\"PASS\"}" | jq .
```

Expected: `{ "travelRuleStatus": "PASSED", "message": "Travel Rule check simulated: PASSED" }`

- [ ] **Step 9: Verify deposit is SUCCESS**

```bash
curl -s "http://localhost:3500/deposit-transactions/$DEPOSIT_ID" \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq '{status, kytStatus, travelRuleStatus, completedAt}'
```

Expected: `{ "status": "SUCCESS", "kytStatus": "PASSED", "travelRuleStatus": "PASSED", "completedAt": "<timestamp>" }`

- [ ] **Step 10: Verify frontend pages display correctly**

Open in browser:
1. `http://localhost:3501` → Admin deposit list: V4 status badges render
2. Click the deposit → Admin detail: compliance gates sidebar shows all PASSED
3. `http://localhost:3502` → Client deposit list: shows "Completed" (not internal status)

- [ ] **Step 11: Commit verification note**

```bash
git commit --allow-empty -m "test: verify deposit V4 happy path E2E — all gates pass, auto-approval works"
```
