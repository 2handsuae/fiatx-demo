# Fiat Deposit Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable fiat deposit happy path end-to-end — client simulation already exists, backend compliance gates need fiat-awareness.

**Architecture:** Reuse the existing crypto deposit architecture with 3 surgical backend edits. The client-side simulation flow (Deposit.tsx → inbound-transfer-signals → PayinsService.createDetected) already handles fiat correctly. The only gaps are: (1) a walletRole guard that blocks fiat wallets, (2) compliance gate initialization that hardcodes Travel Rule as required, (3) auto-approval logic that requires Travel Rule to be PASSED.

**Tech Stack:** NestJS, Prisma, Jest, existing inbound-transfer-signals pipeline

---

## Discovery: Existing Infrastructure Already Handles Fiat Simulation

The spec originally listed 4 changes, but investigation revealed:

- **Client UI (Deposit.tsx)** — Already has a "Simulate Deposit" button on the fiat tab. It calls `buildMockInboundSignalPayload()` which generates fiat-specific data (fromIban, referenceNo). The result summary already shows fiat-specific next-step guidance.
- **Client API (inbound-transfer-signals)** — Already creates fiat payins via `PayinsService.createDetected({ type: PayinType.FIAT })`. In INTERACTIVE mode, the payin stays at DETECTED; admin then advances it with FIAT_CONFIRMED.
- **Blocking bug found** — `InboundTransferSignalsService.getCustomerDepositWalletOrThrow()` (line 555) rejects wallets where `walletRole !== WalletRole.C_DEP`, but fiat deposit wallets use `WalletRole.C_VIBAN`. This must be fixed.

**Net result: 3 backend method edits, 0 new files, 0 new endpoints, 0 frontend changes.**

---

## File Map

| File | Change | Responsibility |
|------|--------|----------------|
| `src/modules/trading/deposit-transactions/inbound-transfer-signals.service.ts` | Modify line 555 | Fix walletRole guard to accept C_VIBAN |
| `src/modules/trading/deposit-transactions/deposit-transactions.service.ts` | Modify `initializeComplianceGates()` | Set TR=NOT_REQUIRED for fiat |
| `src/modules/trading/deposit-transactions/deposit-workflow.service.ts` | Modify `checkAutoApproval()` line 126 | Accept travelRuleStatus=NOT_REQUIRED |
| `src/modules/trading/deposit-transactions/inbound-transfer-signals.service.spec.ts` | Add test | Verify C_VIBAN wallets are accepted |
| `src/modules/trading/deposit-transactions/deposit-transactions.service.spec.ts` | Add test | Verify fiat gate initialization |
| `src/modules/trading/deposit-transactions/deposit-workflow.service.spec.ts` | Add test | Verify fiat auto-approval |

---

### Task 1: Fix walletRole guard for fiat deposit wallets

**Files:**
- Modify: `src/modules/trading/deposit-transactions/inbound-transfer-signals.service.ts:552-558`
- Test: `src/modules/trading/deposit-transactions/inbound-transfer-signals.service.spec.ts`

- [ ] **Step 1: Write the failing test**

Open `src/modules/trading/deposit-transactions/inbound-transfer-signals.service.spec.ts` and add this test within the existing describe block. Locate the existing test module setup (it mocks PrismaService with wallet/asset findUnique). Add after the last existing test:

```typescript
describe('getCustomerDepositWalletOrThrow — fiat wallet role', () => {
  it('should accept C_VIBAN wallet for fiat deposit simulation', async () => {
    const mockWallet = {
      id: 'w-fiat-1',
      ownerType: 'CUSTOMER',
      ownerId: 'cust-1',
      walletRole: 'C_VIBAN',
      status: 'ACTIVE',
      assetId: 'asset-fiat-1',
      asset: { id: 'asset-fiat-1', type: 'FIAT', code: 'USD' },
    };
    (prisma as any).wallet.findUnique.mockResolvedValue(mockWallet);

    // Access private method through the service — call createForCustomer
    // which internally calls getCustomerDepositWalletOrThrow
    (prisma as any).inboundTransferSignal.create.mockResolvedValue({
      id: 'sig-1',
      signalNo: 'SIG001',
      walletId: 'w-fiat-1',
      assetId: 'asset-fiat-1',
      channelType: 'FIAT',
      amount: { toString: () => '100.00' },
      status: 'PENDING_SCAN',
    });

    const result = await service.createForCustomer('cust-1', {
      walletId: 'w-fiat-1',
      amount: '100.00',
      referenceNo: 'REF-USD-TEST',
      fromIban: 'AE07MOCK123456789012345678',
    });

    expect(result).toBeDefined();
    expect((prisma as any).wallet.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'w-fiat-1' } }),
    );
  });
});
```

Note: the exact mock setup depends on how the existing spec file is structured. If `createForCustomer` requires additional mocks (e.g., trading eligibility check), match the existing patterns in the file. The test must verify that a wallet with `walletRole: 'C_VIBAN'` does NOT throw ForbiddenException.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/modules/trading/deposit-transactions/inbound-transfer-signals.service.spec.ts --testNamePattern="C_VIBAN" -v`

Expected: FAIL — ForbiddenException because current code only allows `C_DEP`.

- [ ] **Step 3: Implement the fix**

In `src/modules/trading/deposit-transactions/inbound-transfer-signals.service.ts`, change line 552-558 from:

```typescript
    if (
      wallet.ownerType !== 'CUSTOMER' ||
      wallet.ownerId !== customerId ||
      wallet.walletRole !== WalletRole.C_DEP
    ) {
      throw new ForbiddenException('Customer can only use own deposit wallet');
    }
```

to:

```typescript
    const DEPOSIT_WALLET_ROLES = new Set([WalletRole.C_DEP, WalletRole.C_VIBAN]);
    if (
      wallet.ownerType !== 'CUSTOMER' ||
      wallet.ownerId !== customerId ||
      !DEPOSIT_WALLET_ROLES.has(wallet.walletRole as WalletRole)
    ) {
      throw new ForbiddenException('Customer can only use own deposit wallet');
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/modules/trading/deposit-transactions/inbound-transfer-signals.service.spec.ts --testNamePattern="C_VIBAN" -v`

Expected: PASS

- [ ] **Step 5: Run all existing inbound-signal tests to check for regressions**

Run: `npx jest src/modules/trading/deposit-transactions/inbound-transfer-signals.service.spec.ts -v`

Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/modules/trading/deposit-transactions/inbound-transfer-signals.service.ts src/modules/trading/deposit-transactions/inbound-transfer-signals.service.spec.ts
git commit -m "fix(deposit): accept C_VIBAN wallet role for fiat deposit simulation"
```

---

### Task 2: Make `initializeComplianceGates()` asset-type aware

**Files:**
- Modify: `src/modules/trading/deposit-transactions/deposit-transactions.service.ts:306-314`
- Test: `src/modules/trading/deposit-transactions/deposit-transactions.service.spec.ts`

- [ ] **Step 1: Write two failing tests**

Open `src/modules/trading/deposit-transactions/deposit-transactions.service.spec.ts` and add a new describe block after the existing tests:

```typescript
describe('initializeComplianceGates', () => {
  it('sets travelRuleRequired=true and travelRuleStatus=PENDING for CRYPTO asset', async () => {
    ((prisma as any).depositTransaction.findUnique as jest.Mock).mockResolvedValue({
      id: 'dep-crypto-1',
      assetId: 'asset-btc',
      asset: { id: 'asset-btc', type: 'CRYPTO', code: 'BTC' },
    });
    ((prisma as any).depositTransaction.update as jest.Mock).mockResolvedValue({});

    await service.initializeComplianceGates('dep-crypto-1');

    expect((prisma as any).depositTransaction.update).toHaveBeenCalledWith({
      where: { id: 'dep-crypto-1' },
      data: {
        travelRuleRequired: true,
        travelRuleStatus: 'PENDING',
      },
    });
  });

  it('sets travelRuleRequired=false and travelRuleStatus=NOT_REQUIRED for FIAT asset', async () => {
    ((prisma as any).depositTransaction.findUnique as jest.Mock).mockResolvedValue({
      id: 'dep-fiat-1',
      assetId: 'asset-usd',
      asset: { id: 'asset-usd', type: 'FIAT', code: 'USD' },
    });
    ((prisma as any).depositTransaction.update as jest.Mock).mockResolvedValue({});

    await service.initializeComplianceGates('dep-fiat-1');

    expect((prisma as any).depositTransaction.update).toHaveBeenCalledWith({
      where: { id: 'dep-fiat-1' },
      data: {
        travelRuleRequired: false,
        travelRuleStatus: 'NOT_REQUIRED',
      },
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/modules/trading/deposit-transactions/deposit-transactions.service.spec.ts --testNamePattern="initializeComplianceGates" -v`

Expected: FAIL — the FIAT test fails because current code hardcodes `travelRuleRequired: true`.

- [ ] **Step 3: Implement the change**

In `src/modules/trading/deposit-transactions/deposit-transactions.service.ts`, replace the `initializeComplianceGates` method (lines 306-314):

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
```

with:

```typescript
  async initializeComplianceGates(id: string) {
    const deposit = await (this.prisma as any).depositTransaction.findUnique({
      where: { id },
      include: { asset: true },
    });
    const isCrypto = deposit?.asset?.type === 'CRYPTO';

    return (this.prisma as any).depositTransaction.update({
      where: { id },
      data: {
        travelRuleRequired: isCrypto,
        travelRuleStatus: isCrypto ? 'PENDING' : 'NOT_REQUIRED',
      },
    });
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/modules/trading/deposit-transactions/deposit-transactions.service.spec.ts --testNamePattern="initializeComplianceGates" -v`

Expected: Both CRYPTO and FIAT tests PASS

- [ ] **Step 5: Run all deposit-transactions service tests**

Run: `npx jest src/modules/trading/deposit-transactions/deposit-transactions.service.spec.ts -v`

Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/modules/trading/deposit-transactions/deposit-transactions.service.ts src/modules/trading/deposit-transactions/deposit-transactions.service.spec.ts
git commit -m "feat(deposit): make initializeComplianceGates asset-type aware for fiat"
```

---

### Task 3: Make `checkAutoApproval()` accept travelRuleStatus=NOT_REQUIRED

**Files:**
- Modify: `src/modules/trading/deposit-transactions/deposit-workflow.service.ts:126-131`
- Test: `src/modules/trading/deposit-transactions/deposit-workflow.service.spec.ts`

- [ ] **Step 1: Write the failing test**

Open `src/modules/trading/deposit-transactions/deposit-workflow.service.spec.ts`. Add a new test inside the existing `describe('checkAutoApproval', ...)` block, after the existing tests:

```typescript
    it('approves fiat deposit when kytStatus=PASSED and travelRuleStatus=NOT_REQUIRED', async () => {
      depositService.findOne.mockResolvedValue({
        id: 'dep-fiat-1',
        depositNo: 'DEP-FIAT-001',
        status: DepositTransactionStatus.COMPLIANCE_PENDING,
        kytStatus: 'PASSED',
        travelRuleStatus: 'NOT_REQUIRED',
        ownerId: 'cust-1',
        ownerType: 'CUSTOMER',
        assetId: 'asset-usd',
        amount: '500',
        payinId: 'payin-fiat-1',
        traceId: 'trace-fiat-1',
        asset: { currency: 'USD', tbLedgerId: 3, decimals: 2 },
      });
      depositService.getOwnerComplianceStatus.mockResolvedValue('ACTIVE');
      depositService.updateStatus.mockResolvedValue({});

      await service.checkAutoApproval('dep-fiat-1');

      expect(depositService.findOne).toHaveBeenCalledWith('dep-fiat-1');
      expect(depositService.getOwnerComplianceStatus).toHaveBeenCalledWith('dep-fiat-1');
    });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/modules/trading/deposit-transactions/deposit-workflow.service.spec.ts --testNamePattern="NOT_REQUIRED" -v`

Expected: FAIL — `getOwnerComplianceStatus` is NOT called because current code skips when `travelRuleStatus !== 'PASSED'`.

- [ ] **Step 3: Implement the change**

In `src/modules/trading/deposit-transactions/deposit-workflow.service.ts`, change line 126-131 from:

```typescript
    if (deposit.travelRuleStatus !== 'PASSED') {
      this.logger.debug(
        `Auto-approval skip: deposit ${depositId} travelRuleStatus=${deposit.travelRuleStatus}`,
      );
      return;
    }
```

to:

```typescript
    if (deposit.travelRuleStatus !== 'PASSED' && deposit.travelRuleStatus !== 'NOT_REQUIRED') {
      this.logger.debug(
        `Auto-approval skip: deposit ${depositId} travelRuleStatus=${deposit.travelRuleStatus}`,
      );
      return;
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/modules/trading/deposit-transactions/deposit-workflow.service.spec.ts --testNamePattern="NOT_REQUIRED" -v`

Expected: PASS

- [ ] **Step 5: Run all deposit-workflow tests to check for regressions**

Run: `npx jest src/modules/trading/deposit-transactions/deposit-workflow.service.spec.ts -v`

Expected: All tests PASS (existing crypto tests still pass — they use `travelRuleStatus: 'PASSED'` which still works)

- [ ] **Step 6: Commit**

```bash
git add src/modules/trading/deposit-transactions/deposit-workflow.service.ts src/modules/trading/deposit-transactions/deposit-workflow.service.spec.ts
git commit -m "feat(deposit): accept travelRuleStatus=NOT_REQUIRED in auto-approval for fiat"
```

---

### Task 4: Run full test suite and verify

- [ ] **Step 1: Run all deposit-related tests**

Run: `npx jest src/modules/trading/deposit-transactions/ -v`

Expected: All tests PASS

- [ ] **Step 2: Run payin tests to verify no regressions**

Run: `npx jest src/modules/asset-treasury/payins/ -v`

Expected: All tests PASS

- [ ] **Step 3: Run full project test suite**

Run: `npx jest --passWithNoTests`

Expected: No new failures
