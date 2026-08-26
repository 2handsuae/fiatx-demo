# Wallet Field Cleanup — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove 10 unused/redundant fields from Wallet model, add FIAT/CRYPTO type-field validation, and clean existing data.

**Architecture:** Prisma schema field removal + migration with data cleanup SQL. Backend services stripped of direction writes, approvalCase links, and regulatory gate checks. Frontend detail page updated to remove deleted fields. Type-field validation added to createWalletRecord.

**Tech Stack:** NestJS + Prisma + SQLite (backend), React + TypeScript (admin-web)

---

### Task 1: Remove `direction` from backend

**Files:**
- Modify: `src/modules/asset-treasury/wallets/wallets.service.ts`
- Modify: `src/modules/asset-treasury/wallets/custodian-wallet-create-workflow.service.ts`
- Modify: `src/modules/asset-treasury/wallets/customer-deposit-wallet.service.ts`
- Modify: `src/modules/asset-treasury/wallets/wallets.controller.ts`
- Modify: `src/modules/asset-treasury/wallets/dto/wallet.dto.ts`
- Modify: `src/modules/trading/deposit-transactions/inbound-transfer-signals.service.ts`

- [ ] **Step 1: Remove `direction` from `createWalletRecord` DTO and create data**

In `src/modules/asset-treasury/wallets/wallets.service.ts`:

```tsx
// BEFORE (lines 66-78, the dto type):
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
      vaultId?: string;
      iban?: string;
    },

// AFTER:
  async createWalletRecord(
    dto: {
      assetId: string;
      ownerType: string;
      ownerId?: string;
      ownerNo?: string;
      walletRole: string;
      type: string;
      status: 'PENDING_APPROVAL' | 'CREATING';
      vaultId?: string;
      iban?: string;
    },
```

Also in the same file, remove `direction` from the `wallet.create` data block (line 111):

```tsx
// BEFORE (lines 103-116):
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
            vaultId: dto.vaultId ?? null,
            iban: dto.iban ?? null,
          },
        });

// AFTER:
        return await db.wallet.create({
          data: {
            walletNo,
            ownerType: dto.ownerType,
            ownerId: dto.ownerType === 'PLATFORM' ? null : (dto.ownerId ?? null),
            ownerNo: dto.ownerNo ?? null,
            walletRole: dto.walletRole,
            type: dto.type,
            assetId: dto.assetId,
            status: dto.status,
            vaultId: dto.vaultId ?? null,
            iban: dto.iban ?? null,
          },
        });
```

- [ ] **Step 2: Remove direction derivation + usage from `custodian-wallet-create-workflow.service.ts`**

```tsx
// BEFORE (lines 112-126):
    const walletType = asset.type === 'FIAT' ? 'FIAT_BANK' : 'CRYPTO_ADDRESS';
    const direction = (dto.role === WalletRole.C_DEP || dto.role === WalletRole.C_VIBAN) ? 'INBOUND' : 'BIDIRECTIONAL';

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

// AFTER:
    const walletType = asset.type === 'FIAT' ? 'FIAT_BANK' : 'CRYPTO_ADDRESS';

    const wallet = (await this.walletsService.createWalletRecord({
      assetId: asset.id,
      ownerType,
      ownerId: ownerType === 'PLATFORM' ? undefined : customer?.id,
      ownerNo: ownerType === 'PLATFORM' ? undefined : customer?.customerNo,
      walletRole: dto.role,
      status: 'PENDING_APPROVAL',
      type: walletType,
      vaultId: dto.vaultId,
      iban: dto.iban,
    }))!;
```

- [ ] **Step 3: Remove direction from `customer-deposit-wallet.service.ts`**

```tsx
// BEFORE (lines 76-88):
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

// AFTER:
    const wallet = await this.prisma.wallet.create({
      data: {
        walletNo,
        ownerType: 'CUSTOMER',
        ownerId: customerId,
        ownerNo: customer.customerNo,
        type: walletType,
        walletRole,
        assetId,
        status: WalletStatus.CREATING,
      },
    });
```

- [ ] **Step 4: Remove direction query param from `wallets.controller.ts`**

Remove the `@ApiQuery` decorator (line 63), the `@Query('direction')` param (line 74), and the filter line (line 99):

```tsx
// BEFORE (line 63):
  @ApiQuery({ name: 'direction', required: false, enum: WalletDirection })

// DELETE this line entirely

// BEFORE (line 74):
    @Query('direction') direction?: string,

// DELETE this line entirely

// BEFORE (line 99):
    if (direction) where.direction = direction;

// DELETE this line entirely
```

Also remove `WalletDirection` from the import (line 19):

```tsx
// BEFORE (lines 14-21):
import {
  UpdateWalletStatusDto,
  WalletStatus,
  OwnerType,
  WalletType,
  WalletDirection,
  WalletRole,
} from './dto/wallet.dto';

// AFTER:
import {
  UpdateWalletStatusDto,
  WalletStatus,
  OwnerType,
  WalletType,
  WalletRole,
} from './dto/wallet.dto';
```

- [ ] **Step 5: Delete `WalletDirection` enum from `dto/wallet.dto.ts`**

```tsx
// DELETE (lines 15-19):
export enum WalletDirection {
  INBOUND = 'INBOUND',
  OUTBOUND = 'OUTBOUND',
  BIDIRECTIONAL = 'BIDIRECTIONAL',
}
```

- [ ] **Step 6: Remove redundant direction check from `inbound-transfer-signals.service.ts`**

```tsx
// BEFORE (lines 555-562):
    if (
      wallet.ownerType !== 'CUSTOMER' ||
      wallet.ownerId !== customerId ||
      wallet.direction !== 'INBOUND' ||
      wallet.walletRole !== WalletRole.C_DEP
    ) {
      throw new ForbiddenException('Customer can only use own deposit wallet');
    }

// AFTER (delete the direction line — walletRole C_DEP already implies INBOUND):
    if (
      wallet.ownerType !== 'CUSTOMER' ||
      wallet.ownerId !== customerId ||
      wallet.walletRole !== WalletRole.C_DEP
    ) {
      throw new ForbiddenException('Customer can only use own deposit wallet');
    }
```

- [ ] **Step 7: Verify TypeScript compiles**

```bash
cd src && npx tsc --noEmit 2>&1 | head -30
```

Expected: No errors related to `direction`.

- [ ] **Step 8: Commit**

```bash
git add \
  src/modules/asset-treasury/wallets/wallets.service.ts \
  src/modules/asset-treasury/wallets/custodian-wallet-create-workflow.service.ts \
  src/modules/asset-treasury/wallets/customer-deposit-wallet.service.ts \
  src/modules/asset-treasury/wallets/wallets.controller.ts \
  src/modules/asset-treasury/wallets/dto/wallet.dto.ts \
  src/modules/trading/deposit-transactions/inbound-transfer-signals.service.ts
git commit -m "refactor(wallet): remove direction field — derived from walletRole"
```

---

### Task 2: Remove `approvalCaseId` / `approvalCaseNo` from backend

**Files:**
- Modify: `src/modules/asset-treasury/wallets/wallets.service.ts`
- Modify: `src/modules/asset-treasury/wallets/custodian-wallet-create-workflow.service.ts`

- [ ] **Step 1: Delete `linkApprovalCase` method from `wallets.service.ts`**

```tsx
// DELETE (lines 134-145):
  async linkApprovalCase(
    walletNo: string,
    caseId: string,
    caseNo: string,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const db = tx ?? this.prisma;
    await db.wallet.updateMany({
      where: { walletNo },
      data: { approvalCaseId: caseId, approvalCaseNo: caseNo },
    });
  }
```

- [ ] **Step 2: Remove linkApprovalCase call and approvalCase spread from `custodian-wallet-create-workflow.service.ts`**

Delete the `linkApprovalCase` call (line 156):

```tsx
// DELETE (line 156):
    await this.walletsService.linkApprovalCase(walletNo, approvalCase.id, approvalCase.approvalNo);
```

Simplify the return statement (line 191):

```tsx
// BEFORE (line 191):
    return { wallet: { ...wallet, approvalCaseId: approvalCase.id, approvalCaseNo: approvalCase.approvalNo }, approvalCase };

// AFTER:
    return { wallet, approvalCase };
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd src && npx tsc --noEmit 2>&1 | head -30
```

- [ ] **Step 4: Commit**

```bash
git add \
  src/modules/asset-treasury/wallets/wallets.service.ts \
  src/modules/asset-treasury/wallets/custodian-wallet-create-workflow.service.ts
git commit -m "refactor(wallet): remove approvalCaseId/No — reverse-query from ApprovalCase"
```

---

### Task 3: Remove regulatory gate checks from backend

**Files:**
- Modify: `src/modules/asset-treasury/internal-transaction-workflow/internal-transaction-workflow.service.ts`
- Modify: `src/modules/clearing-settle/outstanding-settlements/outstanding-settlements.service.ts`
- Modify: `src/modules/clearing-settle/pool-settlement-batches/pool-settlement-batches.service.ts`
- Modify: `src/modules/clearing-settle/safeguarding-reconciliation/safeguarding-reconciliation.service.ts`
- Modify: `src/modules/governance/regulatory-gates/regulatory-gates.service.ts`

- [ ] **Step 1: Delete `ensureRegulatorEnabledCustBankWallet` + call sites from `internal-transaction-workflow.service.ts`**

Delete the private method (lines 102-119):

```tsx
// DELETE:
  private ensureRegulatorEnabledCustBankWallet(wallet: {
    walletRole?: string | null;
    walletNo?: string | null;
    regulatoryEnablementStatus?: string | null;
  }) {
    if (wallet.walletRole !== WalletRole.C_CMA) {
      return;
    }
    if (
      String(wallet.regulatoryEnablementStatus || '')
        .trim()
        .toUpperCase() !== 'EFFECTIVE'
    ) {
      throw new BadRequestException(
        `C_CMA wallet ${wallet.walletNo || 'UNKNOWN'} is not regulator-enabled`,
      );
    }
  }
```

Delete the two call sites (lines 254-255):

```tsx
// DELETE:
      this.ensureRegulatorEnabledCustBankWallet(fromWallet);
      this.ensureRegulatorEnabledCustBankWallet(toWallet);
```

- [ ] **Step 2: Delete `ensureRegulatorEnabledCustBankWallet` + call site from `outstanding-settlements.service.ts`**

Delete the private method (lines 68-85):

```tsx
// DELETE:
  private ensureRegulatorEnabledCustBankWallet(wallet: {
    walletRole?: string | null;
    walletNo?: string | null;
    regulatoryEnablementStatus?: string | null;
  }) {
    if (String(wallet.walletRole || '').trim().toUpperCase() !== WalletRole.C_CMA) {
      return;
    }
    if (
      String(wallet.regulatoryEnablementStatus || '')
        .trim()
        .toUpperCase() !== 'EFFECTIVE'
    ) {
      throw new BadRequestException(
        `C_CMA wallet ${wallet.walletNo || 'UNKNOWN'} is not regulator-enabled`,
      );
    }
  }
```

Delete the call site (line 277):

```tsx
// DELETE:
    this.ensureRegulatorEnabledCustBankWallet(wallet);
```

- [ ] **Step 3: Delete `ensureRegulatorEnabledCustBankWallet` + call site from `pool-settlement-batches.service.ts`**

Delete the private method (lines 181-199):

```tsx
// DELETE:
  private ensureRegulatorEnabledCustBankWallet(wallet: {
    walletRole?: string | null;
    walletNo?: string | null;
    regulatoryEnablementStatus?: string | null;
  }) {
    if (String(wallet.walletRole || '').trim().toUpperCase() !== WalletRoleEnum.C_CMA) {
      return;
    }

    if (
      String(wallet.regulatoryEnablementStatus || '')
        .trim()
        .toUpperCase() !== 'EFFECTIVE'
    ) {
      throw new BadRequestException(
        `C_CMA wallet ${wallet.walletNo || 'UNKNOWN'} is not regulator-enabled`,
      );
    }
  }
```

Delete the call site (line 290):

```tsx
// DELETE:
    this.ensureRegulatorEnabledCustBankWallet(wallet);
```

- [ ] **Step 4: Delete regulatory check from `safeguarding-reconciliation.service.ts`**

Delete lines 1535-1543:

```tsx
// DELETE:
    if (
      String(wallet.regulatoryEnablementStatus || '')
        .trim()
        .toUpperCase() !== 'EFFECTIVE'
    ) {
      throw new BadRequestException(
        'C_CMA wallet must be regulator-enabled before statement import',
      );
    }
```

- [ ] **Step 5: Delete wallet regulatory write from `regulatory-gates.service.ts`**

Delete lines 971-982 (the `else if` block that writes to wallet):

```tsx
// BEFORE (lines 971-982):
    } else if (
      updated.gateType === RegulatoryGateTypes.CLIENT_BANK_ACCOUNT_ENABLEMENT &&
      updated.walletId
    ) {
      await this.prisma.wallet.update({
        where: { id: updated.walletId },
        data: {
          regulatoryEnablementStatus: 'EFFECTIVE',
          regulatoryEnabledAt: effectiveAt,
        },
      });
    }

// AFTER:
    }
```

Also remove `regulatoryEnablementStatus` and `regulatoryEnabledAt` from the wallet projection (lines 319-320):

```tsx
// BEFORE (lines 314-321):
      wallet: row.wallet
        ? {
            id: row.wallet.id,
            walletNo: row.wallet.walletNo,
            walletRole: row.wallet.walletRole,
            regulatoryEnablementStatus: row.wallet.regulatoryEnablementStatus,
            regulatoryEnabledAt: row.wallet.regulatoryEnabledAt,
          }
        : null,

// AFTER:
      wallet: row.wallet
        ? {
            id: row.wallet.id,
            walletNo: row.wallet.walletNo,
            walletRole: row.wallet.walletRole,
          }
        : null,
```

- [ ] **Step 6: Verify TypeScript compiles**

```bash
cd src && npx tsc --noEmit 2>&1 | head -30
```

- [ ] **Step 7: Commit**

```bash
git add \
  src/modules/asset-treasury/internal-transaction-workflow/internal-transaction-workflow.service.ts \
  src/modules/clearing-settle/outstanding-settlements/outstanding-settlements.service.ts \
  src/modules/clearing-settle/pool-settlement-batches/pool-settlement-batches.service.ts \
  src/modules/clearing-settle/safeguarding-reconciliation/safeguarding-reconciliation.service.ts \
  src/modules/governance/regulatory-gates/regulatory-gates.service.ts
git commit -m "refactor(wallet): remove regulatoryEnablementStatus/At — re-add when needed"
```

---

### Task 4: Add FIAT/CRYPTO type-field validation

**Files:**
- Modify: `src/modules/asset-treasury/wallets/wallets.service.ts`

- [ ] **Step 1: Expand `createWalletRecord` DTO to accept FIAT/CRYPTO-specific fields + add validation**

```tsx
// BEFORE (lines 66-78, after Task 1 changes):
  async createWalletRecord(
    dto: {
      assetId: string;
      ownerType: string;
      ownerId?: string;
      ownerNo?: string;
      walletRole: string;
      type: string;
      status: 'PENDING_APPROVAL' | 'CREATING';
      vaultId?: string;
      iban?: string;
    },
    tx?: Prisma.TransactionClient,
  ) {

// AFTER:
  async createWalletRecord(
    dto: {
      assetId: string;
      ownerType: string;
      ownerId?: string;
      ownerNo?: string;
      walletRole: string;
      type: string;
      status: 'PENDING_APPROVAL' | 'CREATING';
      // CRYPTO-specific
      address?: string;
      vaultId?: string;
      // FIAT-specific
      iban?: string;
      bankName?: string;
      accountName?: string;
    },
    tx?: Prisma.TransactionClient,
  ) {
```

Add the type-field validation after the asset status check (after line 98), before the `for` loop:

```tsx
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

Update the `wallet.create` data block to include the new optional fields:

```tsx
// BEFORE (after Task 1 changes):
        return await db.wallet.create({
          data: {
            walletNo,
            ownerType: dto.ownerType,
            ownerId: dto.ownerType === 'PLATFORM' ? null : (dto.ownerId ?? null),
            ownerNo: dto.ownerNo ?? null,
            walletRole: dto.walletRole,
            type: dto.type,
            assetId: dto.assetId,
            status: dto.status,
            vaultId: dto.vaultId ?? null,
            iban: dto.iban ?? null,
          },
        });

// AFTER:
        return await db.wallet.create({
          data: {
            walletNo,
            ownerType: dto.ownerType,
            ownerId: dto.ownerType === 'PLATFORM' ? null : (dto.ownerId ?? null),
            ownerNo: dto.ownerNo ?? null,
            walletRole: dto.walletRole,
            type: dto.type,
            assetId: dto.assetId,
            status: dto.status,
            address: dto.address ?? null,
            vaultId: dto.vaultId ?? null,
            iban: dto.iban ?? null,
            bankName: dto.bankName ?? null,
            accountName: dto.accountName ?? null,
          },
        });
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd src && npx tsc --noEmit 2>&1 | head -30
```

- [ ] **Step 3: Commit**

```bash
git add src/modules/asset-treasury/wallets/wallets.service.ts
git commit -m "feat(wallet): add FIAT/CRYPTO type-field validation in createWalletRecord"
```

---

### Task 5: Prisma schema + migration + data cleanup

**Files:**
- Modify: `prisma/schema.prisma`
- Create: migration via `npx prisma migrate dev`

- [ ] **Step 1: Remove 10 fields from Wallet model in `prisma/schema.prisma`**

Delete these lines from the Wallet model (lines 1364, 1368-1371, 1374-1375, 1379-1380, 1382-1383):

```prisma
// DELETE these lines:
  direction                                String
  memo                                     String?
  bankAccount                              String?
  bankCode                                 String?
  regulatoryEnablementStatus               String                          @default("PENDING")
  regulatoryEnabledAt                      DateTime?
  beneficiaryName                          String?
  counterpartyVasp                         String?
  approvalCaseId                           String?
  approvalCaseNo                           String?
```

The remaining Wallet model scalar fields should be:

```prisma
model Wallet {
  id                                       String                          @id @default(uuid())
  walletNo                                 String?                         @unique
  ownerType                                String
  ownerId                                  String?
  ownerNo                                  String?
  type                                     String
  walletRole                               String                          @default("GENERAL")
  assetId                                  String
  address                                  String?
  bankName                                 String?
  status                                   String                          @default("ACTIVE")
  mockBalance                              Decimal                         @default(0)
  createdAt                                DateTime                        @default(now()) @map("created_at")
  updatedAt                                DateTime                        @updatedAt @map("updated_at")
  accountName                              String?
  iban                                     String?
  vaultId                                  String?
  // ... relations unchanged ...
```

- [ ] **Step 2: Create data cleanup migration SQL**

Before running `prisma migrate dev`, first clean FIAT wallets with mock vaultId directly:

```bash
sqlite3 /tmp/exchange_js_branch/dev.db "UPDATE wallets SET vaultId = NULL WHERE type = 'FIAT_BANK' AND vaultId IS NOT NULL;"
```

- [ ] **Step 3: Generate and apply Prisma migration**

```bash
npx prisma migrate dev --name remove-wallet-redundant-fields
```

Expected: Migration created, 10 columns dropped. Prisma client regenerated.

- [ ] **Step 4: Verify migration applied**

```bash
sqlite3 /tmp/exchange_js_branch/dev.db ".schema wallets" | tr ',' '\n'
```

Expected: No `direction`, `memo`, `bankAccount`, `bankCode`, `regulatoryEnablementStatus`, `regulatoryEnabledAt`, `beneficiaryName`, `counterpartyVasp`, `approvalCaseId`, `approvalCaseNo` columns.

Verify FIAT vaultId cleanup:

```bash
sqlite3 /tmp/exchange_js_branch/dev.db "SELECT COUNT(*) FROM wallets WHERE type='FIAT_BANK' AND vaultId IS NOT NULL;"
```

Expected: `0`

- [ ] **Step 5: Verify TypeScript compiles with new Prisma client**

```bash
cd src && npx tsc --noEmit 2>&1 | head -30
```

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "schema(wallet): drop 10 redundant fields + clean FIAT vaultId data"
```

---

### Task 6: Frontend — remove deleted fields from detail page

**Files:**
- Modify: `admin-web/src/pages/CustodianWalletDetail.tsx`

- [ ] **Step 1: Remove deleted fields from `WalletDetailData` interface**

```tsx
// BEFORE (lines 16-43, relevant parts):
interface WalletDetailData {
  id: string;
  walletNo: string;
  walletRole: string;
  surfaceCategory?: string;
  ownerType: string;
  ownerId: string | null;
  ownerNo: string | null;
  ownerName?: string | null;
  type: string;
  direction: string;
  assetId: string;
  balance: string;

  address: string | null;
  memo: string | null;
  beneficiaryName: string | null;
  counterpartyVasp: string | null;

  bankName: string | null;
  bankAccount: string | null;
  bankCode: string | null;
  accountName: string | null;
  iban: string | null;

  vaultId: string | null;
  approvalCaseId: string | null;
  approvalCaseNo: string | null;

  status: string;

// AFTER:
interface WalletDetailData {
  id: string;
  walletNo: string;
  walletRole: string;
  surfaceCategory?: string;
  ownerType: string;
  ownerId: string | null;
  ownerNo: string | null;
  ownerName?: string | null;
  type: string;
  assetId: string;
  balance: string;

  address: string | null;

  bankName: string | null;
  accountName: string | null;
  iban: string | null;

  vaultId: string | null;

  status: string;
```

- [ ] **Step 2: Remove Direction and Approval Case from DETAILS section**

```tsx
// BEFORE (lines 334-362):
            <div className="mt-3 grid grid-cols-2 gap-x-8 gap-y-4">
              <InfoField label="Owner" value={ownerLabel} mono />
              <InfoField label="Owner Type" value={wallet.ownerType} />
              <InfoField label="Owner No" value={wallet.ownerNo} mono accent />
              <InfoField label="Direction" value={wallet.direction} />
              <InfoField label="Asset" value={wallet.asset.code} />
              <InfoField label="Network" value={wallet.asset.network || '—'} />
              <InfoField label="Vault ID" value={wallet.vaultId} mono />
              <InfoField
                label="Custodian"
                value={wallet.type === 'FIAT_BANK' ? 'ZandBank' : 'HexTrust'}
              />
              {wallet.approvalCaseNo && (
                <InfoField
                  label="Approval Case"
                  value={
                    wallet.approvalCaseId ? (
                      <button
                        onClick={() => navigate(`/dashboard/control-gates/approvals/${wallet.approvalCaseId}`)}
                        className="font-mono text-[10px] text-adm-amber underline"
                      >
                        {wallet.approvalCaseNo}
                      </button>
                    ) : (
                      wallet.approvalCaseNo
                    )
                  }
                />
              )}
            </div>

// AFTER:
            <div className="mt-3 grid grid-cols-2 gap-x-8 gap-y-4">
              <InfoField label="Owner" value={ownerLabel} mono />
              <InfoField label="Owner Type" value={wallet.ownerType} />
              <InfoField label="Owner No" value={wallet.ownerNo} mono accent />
              <InfoField label="Asset" value={wallet.asset.code} />
              <InfoField label="Network" value={wallet.asset.network || '—'} />
              <InfoField label="Vault ID" value={wallet.vaultId} mono />
              <InfoField
                label="Custodian"
                value={wallet.type === 'FIAT_BANK' ? 'ZandBank' : 'HexTrust'}
              />
            </div>
```

- [ ] **Step 3: Verify frontend compiles**

```bash
cd admin-web && npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 4: Commit**

```bash
git add admin-web/src/pages/CustodianWalletDetail.tsx
git commit -m "fix(admin): remove direction + approvalCase from wallet detail page"
```

---

### Task 7: Final verification

- [ ] **Step 1: Start services and verify**

```bash
npm run dev:start
```

- [ ] **Step 2: Verify API returns wallets without deleted fields**

```bash
curl -s http://localhost:3500/wallets?take=1 -H "Authorization: Bearer $TOKEN" | jq '.items[0] | keys'
```

Expected: No `direction`, `memo`, `counterpartyVasp`, `beneficiaryName`, `bankAccount`, `bankCode`, `approvalCaseId`, `approvalCaseNo`, `regulatoryEnablementStatus`, `regulatoryEnabledAt` keys.

- [ ] **Step 3: Verify admin detail page loads**

Open `http://localhost:3501/dashboard/treasury/custodian-wallets` and click any wallet. Confirm:
- No "Direction" field in DETAILS section
- No "Approval Case" field in DETAILS section
- All other fields display correctly

- [ ] **Step 4: Verify data integrity — no FIAT wallet has vaultId**

```bash
sqlite3 /tmp/exchange_js_branch/dev.db "SELECT walletNo, type, vaultId FROM wallets WHERE type='FIAT_BANK';"
```

Expected: All vaultId = NULL for FIAT_BANK rows.
