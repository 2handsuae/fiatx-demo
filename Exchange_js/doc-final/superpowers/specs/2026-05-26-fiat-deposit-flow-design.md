# Fiat Deposit Flow — MVP Design

> **Scope:** Fiat deposit happy path end-to-end — client simulation entry, fiat payin lifecycle, deposit compliance gates, auto-approval
> **Goal:** Reuse crypto deposit architecture with minimal divergence. 2 backend method edits + 1 new client API endpoint + 1 client UI entry.

---

## Design Decisions

1. **Reuse webhook simulation pipeline** — Fiat deposits use the same Sumsub ingestion pipeline (`kytCheckSimulated` eventType) as crypto. No new compliance infrastructure.
2. **KYT-only compliance gate** — Fiat has no Travel Rule (banks handle via SWIFT MT103). `travelRuleRequired=false`, `travelRuleStatus=NOT_REQUIRED` at gate initialization.
3. **Preserve DETECTED stage** — Fiat Payin starts at DETECTED (bank notification received), then transitions to CONFIRMED. Two-step separation preserves orchestration semantics: DETECTED creates DepositTransaction, CONFIRMED triggers TB accounting + compliance.
4. **Client-side simulation trigger** — Initial fiat payin creation is triggered from the client fiat deposit page ("simulate bank transfer"), not from admin.
5. **Fiat KYT = AML transaction monitoring** — Sumsub provides rule-based AML transaction monitoring for fiat (not blockchain analysis). The simulated KYT check represents this real compliance need.

---

## Research Context

| Question | Finding |
|----------|---------|
| Does fiat have a DETECTED pre-stage? | No. Bank VIBAN integrations (camt.054 / provider webhook) deliver a single credit notification = funds already booked. No "pending" pre-notification. DETECTED is retained as simulation semantics for orchestration separation. |
| Does Sumsub provide fiat KYT? | Yes. Sumsub offers rule-based AML transaction monitoring for fiat: velocity checks, amount thresholds, counterparty screening, pattern analysis. Different from crypto blockchain analytics but same compliance purpose. |
| Does Travel Rule apply to fiat? | No. FATF Travel Rule applies to virtual asset transfers between VASPs. Bank-to-bank fiat transfers comply via existing SWIFT MT103/MT202 messaging. |

---

## State Machine Comparison

### Payin

| Stage | Crypto | Fiat |
|-------|--------|------|
| DETECTED | On-chain mempool detection | Bank credit notification (simulated from client) |
| CONFIRMING | Waiting for block confirmations | N/A (fiat has no confirmation waiting) |
| CONFIRMED | Enough confirmations reached | Bank confirms credit (admin mock FIAT_CONFIRMED) |
| CLEARED | Deposit workflow has consumed this payin | Same |
| FAILED | Dropped from mempool | Bank rejects/reverses (admin mock FIAT_FAILED) |

### Deposit (identical for both — no changes)

```
PAYIN_PENDING → COMPLIANCE_PENDING → SUCCESS
                                   → ACTION_PENDING → SUCCESS / REJECTED / EXPIRED / FROZEN
                                   → FROZEN → SUCCESS / CONFISCATED
                                   → REJECTED
                                   → FAILED
```

### Compliance Gate Initialization

| Gate | Crypto | Fiat |
|------|--------|------|
| Gate 0: Customer compliance | Same | Same |
| Gate 1: KYT | kytStatus = PENDING | kytStatus = PENDING |
| Gate 2: Travel Rule | travelRuleRequired = true, travelRuleStatus = PENDING | travelRuleRequired = false, travelRuleStatus = NOT_REQUIRED |

### Auto-Approval Condition

| Gate | Crypto | Fiat |
|------|--------|------|
| kytStatus | must be PASSED | must be PASSED |
| travelRuleStatus | must be PASSED | must be PASSED **or** NOT_REQUIRED |
| Customer compliance | must not be abnormal | must not be abnormal |

---

## End-to-End Happy Path

```
1. Customer → Client Web 法币充值页
   → 选择法币资产 (e.g. USD) + 输入金额
   → 点击 "模拟银行到账"
   → POST /client/deposits/simulate-fiat-payin { assetId, amount }

2. Backend → PayinsService 创建 Fiat Payin (DETECTED)
   → emit payin.created
   → DepositWorkflowService.handlePayinCreated()
   → orchestratePayinDetected(): 创建 DepositTransaction (PAYIN_PENDING)

3. Admin → Payin Detail 页面
   → 触发 mock event FIAT_CONFIRMED
   → Payin DETECTED → CONFIRMED
   → emit payin.status.changed

4. DepositWorkflowService.handlePayinStatusChanged()
   → orchestratePayinConfirmed():
     → TB Step 1: CUSTODY → CLIENT_AUDIT
     → Deposit PAYIN_PENDING → COMPLIANCE_PENDING
     → Payin CONFIRMED → CLEARED

5. DepositWorkflowService.handleDepositStatusChanged()
   → runGate0(): check customer complianceStatus
   → PASS → initializeComplianceGates()
     → asset.type=FIAT → kytStatus=PENDING, travelRuleRequired=false, travelRuleStatus=NOT_REQUIRED

6. Admin → Sumsub Simulation 面板
   → POST /admin/sumsub/simulate/kyt-check { depositNo, result: PASS, riskScore: 0.1 }
   → SumsubIngestionService → updateKytStatus(PASSED) → checkAutoApproval()

7. checkAutoApproval():
   → kytStatus=PASSED ✓
   → travelRuleStatus=NOT_REQUIRED ✓ (新: 接受 NOT_REQUIRED)
   → customer OK ✓
   → approveDeposit()

8. approveDeposit():
   → TB Step 2: CLIENT_AUDIT → CLIENT_CREDIT
   → Deposit COMPLIANCE_PENDING → SUCCESS
```

---

## Code Changes

### Change 1: `initializeComplianceGates()` — asset-type aware

**File:** `src/modules/trading/deposit-transactions/deposit-transactions.service.ts`
**Method:** `initializeComplianceGates()` (line ~306)

Before:
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

After:
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

### Change 2: `checkAutoApproval()` — accept NOT_REQUIRED

**File:** `src/modules/trading/deposit-transactions/deposit-workflow.service.ts`
**Method:** `checkAutoApproval()` (line ~126)

Before:
```typescript
if (deposit.travelRuleStatus !== 'PASSED') {
```

After:
```typescript
if (deposit.travelRuleStatus !== 'PASSED' && deposit.travelRuleStatus !== 'NOT_REQUIRED') {
```

### Change 3: Client fiat payin simulation endpoint

**File:** New or existing client deposits controller
**Endpoint:** `POST /client/deposits/simulate-fiat-payin`

Input:
```typescript
{
  assetId: string;   // must be a FIAT asset
  amount: string;    // decimal string
}
```

Logic:
1. Get authenticated customer
2. Validate asset exists and asset.type === 'FIAT'
3. Find customer's fiat wallet for this asset (or fail)
4. Call `PayinsService.createFiatPayin()` (or equivalent) with:
   - type: FIAT
   - status: DETECTED
   - toWalletId: customer's wallet
   - amount
   - fromIban: simulated sender IBAN (e.g. `SIM_IBAN_${timestamp}`)
   - referenceNo: generated
   - ownerId: customer.id
5. Return created payin summary (payinNo, status, amount)

### Change 4: Client Web — fiat deposit simulation UI

**Location:** Client fiat deposit page

UI elements:
- Asset selector (filtered to FIAT assets only)
- Amount input
- "模拟银行到账" / "Simulate Bank Transfer" button
- Success feedback showing created deposit info

---

## Abnormal Branches (all pre-existing, zero new code)

| Scenario | Handling |
|----------|----------|
| Payin FIAT_FAILED mock event | `orchestratePayinFailed()` → Deposit FAILED |
| Gate 0: customer compliance abnormal | Deposit FREEZE |
| KYT check result = FAIL | kytStatus=FAILED → checkAutoApproval() won't fire → stays COMPLIANCE_PENDING for admin manual action |
| Admin manual FREEZE | Existing action on COMPLIANCE_PENDING / ACTION_PENDING |
| Admin manual REJECT | Existing action on COMPLIANCE_PENDING / ACTION_PENDING |
| FROZEN → APPROVE | Existing: admin can approve from FROZEN (TB Step 2 + SUCCESS) |
| FROZEN → CONFISCATE | Existing: admin confiscates (CONFISCATED terminal state) |

---

## Not In Scope

- Real bank VIBAN integration (production webhook receiver)
- Real Sumsub KYT integration for fiat (production webhook)
- Client deposit history page (existing or separate task)
- Fiat withdrawal flow (separate V4 item)
