# Custodian Wallets Module Cleanup

**Date:** 2026-05-19
**Scope:** 8 files, 14 change points — surgical fixes only
**Principle:** Karpathy Rule 3 — touch only what's broken, no speculative refactoring

---

## Background

Full audit of the Custodian Wallets module uncovered 5 user-reported issues + 9 additional rule violations and bugs. This spec covers the 14 actionable items. Legacy code cleanup (old `POST /wallets` route, `WalletsService.create()`, `CreateWalletDto`) is deferred to a separate task.

---

## Changes

### 1. Backend: DTO field rename — `ownerId` → `customerNo`

**File:** `src/modules/asset-treasury/wallets/dto/create-custodian-wallet.dto.ts`

- Rename field `ownerId` → `customerNo`
- Update description: `'Customer business key (e.g. CU2605130001) — required for customer-level roles (C_DEP, C_VIBAN)'`
- Type remains `@IsString() @IsOptional()`

### 2. Backend: Workflow — customerNo lookup + ownerNo + vaultId persistence

**File:** `src/modules/asset-treasury/wallets/custodian-wallet-create-workflow.service.ts`

**2a. `initiateCreate()` — customer lookup by customerNo (lines 86-91)**

Before:
```ts
const customer = await this.prisma.customerMain.findUnique({ where: { id: dto.ownerId } });
```

After:
```ts
const customer = await this.prisma.customerMain.findUnique({ where: { customerNo: dto.customerNo } });
```

Update all references from `dto.ownerId` to `dto.customerNo` and `customer.id` throughout the method.

**2b. `createWalletRecord()` call — pass ownerNo + vaultId + iban (lines 111-119)**

Before:
```ts
const wallet = (await this.walletsService.createWalletRecord({
  assetId: asset.id,
  ownerType,
  ownerId: ownerType === 'PLATFORM' ? undefined : dto.ownerId,
  walletRole: dto.role,
  status: 'PENDING_APPROVAL',
  type: walletType,
  direction,
}))!;
```

After:
```ts
const wallet = (await this.walletsService.createWalletRecord({
  assetId: asset.id,
  ownerType,
  ownerId: ownerType === 'PLATFORM' ? undefined : customer?.id,
  ownerNo: ownerType === 'PLATFORM' ? undefined : customer?.customerNo,
  walletRole: dto.role,
  status: 'PENDING_APPROVAL',
  type: walletType,
  direction,
  vaultId: dto.vaultId,
  iban: dto.iban,
}))!;
```

**2c. `objectSnapshot` — add missing fields (lines 132-138)**

Before:
```ts
objectSnapshot: {
  assetNo: dto.assetNo,
  assetCurrency: asset.currency,
  role: dto.role,
  ownerType,
  ownerId: dto.ownerId || null,
},
```

After:
```ts
objectSnapshot: {
  assetNo: dto.assetNo,
  assetCurrency: asset.currency,
  role: dto.role,
  ownerType,
  customerNo: dto.customerNo || null,
  ownerId: customer?.id || null,
  vaultId: dto.vaultId || null,
  iban: dto.iban || null,
  custodianProvider: dto.custodianProvider || null,
},
```

**2d. Duplicate check — use customer.id not dto.customerNo (lines 93-99)**

```ts
ownerId: ownerType === 'PLATFORM' ? null : customer?.id,
```

### 3. Backend: `createWalletRecord` — accept vaultId and iban

**File:** `src/modules/asset-treasury/wallets/wallets.service.ts`

Extend the `createWalletRecord` method's dto parameter to include `vaultId?` and `iban?`, and pass them into `db.wallet.create({ data: ... })`:

```ts
async createWalletRecord(
  dto: {
    assetId: string;
    ownerType: string;
    ownerId?: string;
    ownerNo?: string;
    walletRole: string;
    type: string;
    direction: string;
    status: 'PENDING_APPROVAL' | 'CREATING';
    vaultId?: string;   // NEW
    iban?: string;       // NEW
  },
  tx?: Prisma.TransactionClient,
) {
  // ... existing validation ...
  return await db.wallet.create({
    data: {
      walletNo,
      ownerType: dto.ownerType,
      ownerId: dto.ownerType === 'PLATFORM' ? null : (dto.ownerId ?? null),
      ownerNo: dto.ownerNo ?? null,
      walletRole: dto.walletRole,
      type: dto.type,
      direction: dto.direction,
      assetId: dto.assetId,
      status: dto.status,
      vaultId: dto.vaultId ?? null,   // NEW
      iban: dto.iban ?? null,          // NEW
    },
  });
}
```

### 4. Backend: Customer deposit wallet — store ownerNo

**File:** `src/modules/asset-treasury/wallets/customer-deposit-wallet.service.ts`

In `createOrReturn()`, add `ownerNo` to the `prisma.wallet.create` call (line 76-87):

Before:
```ts
const wallet = await this.prisma.wallet.create({
  data: {
    walletNo,
    ownerType: 'CUSTOMER',
    ownerId: customerId,
    type: walletType,
    direction: 'INBOUND',
    walletRole,
    assetId,
    status: WalletStatus.CREATING,
  },
});
```

After:
```ts
const wallet = await this.prisma.wallet.create({
  data: {
    walletNo,
    ownerType: 'CUSTOMER',
    ownerId: customerId,
    ownerNo: customer.customerNo,
    type: walletType,
    direction: 'INBOUND',
    walletRole,
    assetId,
    status: WalletStatus.CREATING,
  },
});
```

### 5. Frontend: CustodianWalletCreateModal — asset dropdown + customerNo

**File:** `admin-web/src/pages/CustodianWalletCreateModal.tsx`

**5a. Asset dropdown — remove assetNo (line 187)**

Before: `{a.code} ({a.type}) — {a.assetNo}`
After: `{a.code} ({a.type})`

**5b. Owner field — UUID → customerNo (lines 59, 121, 246-256)**

- State: `ownerId` → `customerNo`, `setOwnerId` → `setCustomerNo`
- Body: `body.ownerId = ownerId.trim()` → `body.customerNo = customerNo.trim()`
- Label: `"Owner ID (Customer UUID)"` → `"Customer No"`
- Placeholder: `"e.g. 550e8400-..."` → `"e.g. CU2605130001"`
- Validation message: update accordingly

### 6. Frontend: CustodianWalletDetail — 7 rule violations

**File:** `admin-web/src/pages/CustodianWalletDetail.tsx`

**6a. DetailPageHeader — remove title/subtitle (lines 293-295)**

Before:
```tsx
<DetailPageHeader
  title="CUSTODIAN WALLET"
  subtitle={wallet.walletNo}
  onBack={...}
```

After:
```tsx
<DetailPageHeader
  onBack={...}
```

**6b. Hero — remove `<Cap>` (line 325)**

Delete `<Cap>Wallet</Cap>`.

**6c. Sidebar Identity Summary — reduce to 5 fields, remove UUID (lines 516-523)**

Remove:
```tsx
<SidebarKV label="Wallet ID" value={wallet.id} mono />
```

Remaining 5: Wallet No, Status, Role, Role Name, Asset.

**6d. Sidebar Vault Info — dynamic custodian (line 528)**

Before: `<SidebarKV label="Custodian" value="HexTrust" />`
After: `<SidebarKV label="Custodian" value={wallet.type === 'FIAT_BANK' ? 'ZandBank' : 'HexTrust'} />`

**6e. Sidebar — add Lifecycle block (after Approval block)**

```tsx
<SidebarGroup title="Lifecycle">
  <SidebarKV label="Created" value={fmt(wallet.createdAt)} mono />
  <SidebarKV label="Updated" value={fmt(wallet.updatedAt)} mono />
</SidebarGroup>
```

**6f. Delete Regulatory Gate buttons (lines 485-510)**

Remove the two `isCmaWallet` gate button blocks. Also remove `canReadGate` and `canCreateGate` variables (lines 201-202) and related `PERMISSIONS` imports if no longer used.

### 7. Frontend: CustodianWalletList — balance suffix + action column

**File:** `admin-web/src/pages/CustodianWalletList.tsx`

**7a. Balance suffix — code → currency (line 378)**

Before: `{w.asset?.code}`
After: `{w.asset?.currency}`

**7b. Delete Action column (lines 300-311 header, 398-419 body)**

- Remove `['Action', '100px']` from header array
- Remove the Action `<td>` block
- Remove `handleStatusChange()` and `handleRetry()` functions (lines 152-195)
- Remove `canRetry` variable (line 81) and `PERMISSIONS.CUSTODIAN_WALLET_RETRY` import if unused elsewhere
- Update `colSpan` on loading/empty rows from 9 to 8

### 8. Documentation: Register sidebar fields

**File:** `doc-final/rules/frontend-admin.md`

Add to the Per-entity Sidebar Fields table:

```
| **CustodianWallet** | `walletNo`, `status` badge, `walletRole`, `roleName`, `asset.code` | `createdAt`, `updatedAt` |
```

---

## Out of Scope (flagged for separate task)

| Item | Description |
|---|---|
| Legacy `POST /wallets` route | `wallets.controller.ts` line 56-101 — bypasses approval, security risk |
| Legacy `WalletsService.create()` | `wallets.service.ts` lines 66-265 — old creation logic with mock address generation |
| Legacy `CreateWalletDto` | `dto/wallet.dto.ts` lines 47-123 — old DTO |
| Legacy test cases | `wallets.service.spec.ts` create() tests, `wallets.controller.spec.ts` POST tests |
| N+1 query optimization | `wallet-query.service.ts` resolveOwnerInfo |

---

## Success Criteria

1. **Asset dropdown**: shows `USDT-TRON (CRYPTO)` — no assetNo suffix
2. **Owner input**: label says "Customer No", accepts `CU2605130001` format, wallet record has `ownerNo` populated
3. **VaultId**: create crypto wallet with known vaultId → `executeCreation` passes that vaultId to adapter → adapter returns same vaultId
4. **Gate removed**: CMA wallet detail page has no Regulatory Gate buttons
5. **Detail page rules**: no title/subtitle in header, no `<Cap>` in hero, sidebar has exactly 5 identity fields + lifecycle block, no UUID displayed, custodian label matches wallet type
6. **List page**: balance shows `1,000.00 USDT` not `1,000.00 USDT-TRON`, no Action column
7. **Sidebar registered**: `frontend-admin.md` Per-entity table includes CustodianWallet row
