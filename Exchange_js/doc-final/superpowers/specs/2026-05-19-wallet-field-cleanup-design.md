# Wallet Field Cleanup

**Date:** 2026-05-19
**Scope:** Delete 10 unused/redundant fields from Wallet model, add FIAT/CRYPTO field validation, clean existing data

---

## Background

Analysis of all 24 Wallet scalar fields revealed 10 that are unused, redundant, or premature. Additionally, FIAT-specific fields (`iban`, `bankName`, `accountName`) and CRYPTO-specific fields (`address`, `vaultId`) have no type-level enforcement — a FIAT wallet can end up with a `vaultId` (confirmed mock bug) or a CRYPTO wallet could theoretically have an `iban`.

---

## Change 1: Delete 10 Fields from Prisma Schema

Remove from `prisma/schema.prisma` Wallet model:

| # | Field | Reason |
|---|---|---|
| 1 | `direction` | Derived from `walletRole` — C_DEP/C_VIBAN are INBOUND, rest BIDIRECTIONAL. No independent value. |
| 2 | `memo` | Placeholder for XRP/XLM destination tags. Never populated. Re-add when needed. |
| 3 | `counterpartyVasp` | Travel Rule concept. Only used in WithdrawalAddress module, never in Wallet. |
| 4 | `bankAccount` | All NULL across all wallets. No code writes to it. |
| 5 | `bankCode` | All NULL across all wallets. No code writes to it. |
| 6 | `beneficiaryName` | All NULL across all wallets. Only WithdrawalAddress uses this concept. |
| 7 | `approvalCaseId` | Traceability link to approval. Can be reverse-queried from ApprovalCase.entityId. |
| 8 | `approvalCaseNo` | Display companion to approvalCaseId. Removed together. |
| 9 | `regulatoryEnablementStatus` | Regulatory gate enablement. Not needed now — re-add when regulatory gates are implemented. |
| 10 | `regulatoryEnabledAt` | Timestamp companion to regulatoryEnablementStatus. Removed together. |

Generate a Prisma migration that drops these 10 columns.

---

## Change 2: Remove Backend References

### 2a. `direction` — replace with role-based derivation

**wallets.service.ts** `createWalletRecord`:
- Remove `direction` from DTO type and from `wallet.create` data

**custodian-wallet-create-workflow.service.ts**:
- Delete `const direction = ...` derivation (line 113)
- Remove `direction` from `createWalletRecord` call (line 123)

**customer-deposit-wallet.service.ts**:
- Remove `direction: 'INBOUND'` from `createWalletRecord` call (line 83)

**wallets.controller.ts**:
- Remove `@Query('direction') direction?: string` parameter (line 74)
- Remove `if (direction) where.direction = direction;` filter (line 99)

**inbound-transfer-signals.service.ts** (line 558):
- Replace `wallet.direction !== 'INBOUND'` with `wallet.walletRole !== WalletRole.C_DEP`
- The existing check already has `wallet.walletRole !== WalletRole.C_DEP` on line 561, so simply delete the `wallet.direction !== 'INBOUND' ||` line — it's redundant.

### 2b. `approvalCaseId` / `approvalCaseNo`

**wallets.service.ts**:
- Delete entire `linkApprovalCase` method (lines 134-145)

**custodian-wallet-create-workflow.service.ts** (line 194):
- Remove `approvalCaseId` and `approvalCaseNo` from the returned wallet spread. Change:
  `{ wallet: { ...wallet, approvalCaseId: approvalCase.id, approvalCaseNo: approvalCase.approvalNo }, approvalCase }`
  to: `{ wallet, approvalCase }`
- Delete the `linkApprovalCase` call that precedes the return (if any)

### 2c. `regulatoryEnablementStatus` / `regulatoryEnabledAt`

**internal-transaction-workflow.service.ts**:
- Delete `ensureRegulatorEnabledCustBankWallet` private method
- Delete both call sites (fromWallet + toWallet checks)

**outstanding-settlements.service.ts**:
- Delete `ensureRegulatorEnabledCustBankWallet` method and its call site

**pool-settlement-batches.service.ts**:
- Delete `ensureRegulatorEnabledCustBankWallet` method and its call site

**safeguarding-reconciliation.service.ts**:
- Delete the regulatory status check line

**regulatory-gates.service.ts** (lines 975-981):
- Delete the `wallet.update` block that writes `regulatoryEnablementStatus: 'EFFECTIVE'`
- Keep the rest of the regulatory gate logic intact (it operates on RegulatoryGateItem, not wallet)

---

## Change 3: FIAT/CRYPTO Field Type Validation

Add validation in `wallets.service.ts` `createWalletRecord`, after the asset lookup and before the `wallet.create`:

```typescript
// Type-field consistency
if (dto.type === 'CRYPTO_ADDRESS') {
  if (dto.iban || dto.bankName || dto.accountName) {
    throw new BadRequestException('CRYPTO_ADDRESS wallet must not have FIAT fields (iban, bankName, accountName)');
  }
} else if (dto.type === 'FIAT_BANK') {
  if (dto.address || dto.vaultId) {
    throw new BadRequestException('FIAT_BANK wallet must not have CRYPTO fields (address, vaultId)');
  }
}
```

Also update `createWalletRecord` DTO type to accept the optional FIAT/CRYPTO fields that are currently passed inline:
- Add: `address?: string`, `bankName?: string`, `accountName?: string`
- Already has: `vaultId?: string`, `iban?: string`

And write them in the `wallet.create` data block:
```typescript
address: dto.address ?? null,
bankName: dto.bankName ?? null,
accountName: dto.accountName ?? null,
```

---

## Change 4: Frontend Sync

**CustodianWalletDetail.tsx**:
- Remove `direction` InfoField from DETAILS section
- Remove `approvalCaseId` and `approvalCaseNo` from WalletDetailData interface
- Remove conditional Approval Case InfoField (with clickable link) from DETAILS section

**CustodianWalletList.tsx**: No change needed — these fields aren't shown in the list.

---

## Change 5: Data Cleanup Migration

In the same migration that drops columns, first clean data:

```sql
-- Clean FIAT wallets with mock vaultId
UPDATE wallets SET vaultId = NULL WHERE type = 'FIAT_BANK' AND vaultId IS NOT NULL;
```

The 10 dropped columns handle themselves — dropping the column removes the data.

---

## Files Changed

| File | Change |
|---|---|
| `prisma/schema.prisma` | Drop 10 fields from Wallet model |
| `prisma/migrations/xxx` | Data cleanup + column drops |
| `src/modules/asset-treasury/wallets/wallets.service.ts` | Delete `linkApprovalCase`, remove `direction` from DTO/create, add type-field validation |
| `src/modules/asset-treasury/wallets/custodian-wallet-create-workflow.service.ts` | Delete direction derivation, delete approvalCase spread |
| `src/modules/asset-treasury/wallets/customer-deposit-wallet.service.ts` | Remove direction from create call |
| `src/modules/asset-treasury/wallets/wallets.controller.ts` | Remove direction query param |
| `src/modules/trading/deposit-transactions/inbound-transfer-signals.service.ts` | Delete direction check (redundant with role check) |
| `src/modules/asset-treasury/internal-transaction-workflow/internal-transaction-workflow.service.ts` | Delete regulatory gate check method + calls |
| `src/modules/clearing-settle/outstanding-settlements/outstanding-settlements.service.ts` | Delete regulatory gate check method + calls |
| `src/modules/clearing-settle/pool-settlement-batches/pool-settlement-batches.service.ts` | Delete regulatory gate check method + calls |
| `src/modules/clearing-settle/safeguarding-reconciliation/safeguarding-reconciliation.service.ts` | Delete regulatory check line |
| `src/modules/governance/regulatory-gates/regulatory-gates.service.ts` | Delete wallet status write block |
| `admin-web/src/pages/CustodianWalletDetail.tsx` | Remove direction + Approval Case display |

---

## Success Criteria

1. Prisma schema Wallet model has exactly 14 scalar fields remaining: `id`, `walletNo`, `ownerType`, `ownerId`, `ownerNo`, `type`, `walletRole`, `assetId`, `address`, `status`, `mockBalance`, `createdAt`, `updatedAt`, `vaultId` + 3 optional FIAT fields (`iban`, `bankName`, `accountName`)
2. Creating a FIAT_BANK wallet with `address` or `vaultId` throws BadRequestException
3. Creating a CRYPTO_ADDRESS wallet with `iban`, `bankName`, or `accountName` throws BadRequestException
4. No FIAT_BANK wallet in DB has a non-null `vaultId`
5. Backend compiles with no TypeScript errors
6. All existing functionality (deposit signals, internal transactions, settlements) works without direction/regulatory checks
