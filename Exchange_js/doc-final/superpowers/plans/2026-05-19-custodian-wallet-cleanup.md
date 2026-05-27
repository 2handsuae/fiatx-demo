# Custodian Wallet Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 14 bugs and rule violations in the Custodian Wallets module — backend DTO/workflow/service fixes + frontend cleanup.

**Architecture:** Surgical edits to 8 existing files. Backend changes: DTO field rename, workflow customerNo lookup + vaultId/iban persistence, ownerNo population. Frontend changes: asset dropdown cleanup, customerNo input, detail page rule compliance, list page action column removal.

**Tech Stack:** NestJS + Prisma (backend), React + TypeScript (frontend), SQLite (dev DB)

---

### Task 1: Backend — DTO rename `ownerId` → `customerNo`

**Files:**
- Modify: `src/modules/asset-treasury/wallets/dto/create-custodian-wallet.dto.ts`

- [ ] **Step 1: Rename the DTO field**

Open `src/modules/asset-treasury/wallets/dto/create-custodian-wallet.dto.ts` and replace the `ownerId` field:

```ts
// BEFORE (lines 14-17):
  @ApiProperty({ required: false, description: 'Customer UUID — required for customer-level roles (C_DEP, C_VIBAN)' })
  @IsString()
  @IsOptional()
  ownerId?: string;

// AFTER:
  @ApiProperty({ required: false, description: 'Customer business key (e.g. CU2605130001) — required for customer-level roles (C_DEP, C_VIBAN)' })
  @IsString()
  @IsOptional()
  customerNo?: string;
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js && npx tsc --noEmit --pretty 2>&1 | head -30`

Expected: Errors in `custodian-wallet-create-workflow.service.ts` referencing `dto.ownerId` — this is correct, we fix it in Task 2.

- [ ] **Step 3: Commit**

```bash
git add src/modules/asset-treasury/wallets/dto/create-custodian-wallet.dto.ts
git commit -m "refactor(wallets): rename DTO field ownerId to customerNo"
```

---

### Task 2: Backend — `createWalletRecord` accept vaultId and iban

**Files:**
- Modify: `src/modules/asset-treasury/wallets/wallets.service.ts:299-361`

- [ ] **Step 1: Extend the dto type and wallet.create data**

In `src/modules/asset-treasury/wallets/wallets.service.ts`, find the `createWalletRecord` method (line 299). Replace the dto type and the `db.wallet.create` call:

```ts
// BEFORE dto type (lines 300-309):
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
    },

// AFTER dto type:
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
```

Then in the `db.wallet.create` data block (lines 334-345), add the two new fields:

```ts
// BEFORE (lines 334-345):
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
          },

// AFTER:
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
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js && npx tsc --noEmit --pretty 2>&1 | head -30`

Expected: Still errors from workflow (dto.ownerId), no new errors from this file.

- [ ] **Step 3: Commit**

```bash
git add src/modules/asset-treasury/wallets/wallets.service.ts
git commit -m "feat(wallets): createWalletRecord accepts vaultId and iban"
```

---

### Task 3: Backend — Workflow customerNo lookup + ownerNo + vaultId/iban + snapshot

**Files:**
- Modify: `src/modules/asset-treasury/wallets/custodian-wallet-create-workflow.service.ts`

This is the largest backend change. The `initiateCreate()` method needs 4 edits.

- [ ] **Step 1: Fix customer lookup — customerNo instead of UUID (lines 73-91)**

Replace `dto.ownerId` references with `dto.customerNo` and change the lookup:

```ts
// BEFORE (lines 73-84):
    if (ownerType === 'CUSTOMER' && !dto.ownerId) {
      throw new BadRequestException({
        code: 'OWNER_ID_REQUIRED',
        message: `ownerId is required for role ${dto.role}`,
      });
    }
    if (ownerType === 'PLATFORM' && dto.ownerId) {
      throw new BadRequestException({
        code: 'OWNER_TYPE_MISMATCH',
        message: `Role ${dto.role} is platform-level, ownerId must not be provided`,
      });
    }

// AFTER:
    if (ownerType === 'CUSTOMER' && !dto.customerNo) {
      throw new BadRequestException({
        code: 'CUSTOMER_NO_REQUIRED',
        message: `customerNo is required for role ${dto.role}`,
      });
    }
    if (ownerType === 'PLATFORM' && dto.customerNo) {
      throw new BadRequestException({
        code: 'OWNER_TYPE_MISMATCH',
        message: `Role ${dto.role} is platform-level, customerNo must not be provided`,
      });
    }
```

```ts
// BEFORE (lines 86-91):
    if (ownerType === 'CUSTOMER' && dto.ownerId) {
      const customer = await this.prisma.customerMain.findUnique({ where: { id: dto.ownerId } });
      if (!customer) {
        throw new NotFoundException({ code: 'CUSTOMER_NOT_FOUND', message: `Customer ${dto.ownerId} not found` });
      }
    }

// AFTER:
    let customer: { id: string; customerNo: string } | null = null;
    if (ownerType === 'CUSTOMER' && dto.customerNo) {
      customer = await this.prisma.customerMain.findUnique({
        where: { customerNo: dto.customerNo },
        select: { id: true, customerNo: true },
      });
      if (!customer) {
        throw new NotFoundException({ code: 'CUSTOMER_NOT_FOUND', message: `Customer ${dto.customerNo} not found` });
      }
    }
```

- [ ] **Step 2: Fix duplicate check — use customer.id (lines 93-99)**

```ts
// BEFORE (lines 93-99):
    const existingCount = await this.prisma.wallet.count({
      where: {
        walletRole: dto.role,
        assetId: asset.id,
        ownerType,
        ownerId: ownerType === 'PLATFORM' ? null : dto.ownerId,
      },
    });

// AFTER:
    const existingCount = await this.prisma.wallet.count({
      where: {
        walletRole: dto.role,
        assetId: asset.id,
        ownerType,
        ownerId: ownerType === 'PLATFORM' ? null : customer?.id,
      },
    });
```

- [ ] **Step 3: Fix createWalletRecord call — pass ownerNo + vaultId + iban (lines 111-119)**

```ts
// BEFORE (lines 111-119):
    const wallet = (await this.walletsService.createWalletRecord({
      assetId: asset.id,
      ownerType,
      ownerId: ownerType === 'PLATFORM' ? undefined : dto.ownerId,
      walletRole: dto.role,
      status: 'PENDING_APPROVAL',
      type: walletType,
      direction,
    }))!;

// AFTER:
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

- [ ] **Step 4: Fix objectSnapshot — add missing fields (lines 132-138)**

```ts
// BEFORE (lines 132-138):
          objectSnapshot: {
            assetNo: dto.assetNo,
            assetCurrency: asset.currency,
            role: dto.role,
            ownerType,
            ownerId: dto.ownerId || null,
          },

// AFTER:
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

- [ ] **Step 5: Fix audit metadata — ownerId reference (line 137 in metadata block)**

Find the audit `metadata` block around line 166:

```ts
// BEFORE:
        metadata: {
          assetNo: dto.assetNo,
          assetCurrency: asset.currency,
          role: dto.role,
          ownerType,
          approvalNo: approvalCase.approvalNo,
        },

// AFTER:
        metadata: {
          assetNo: dto.assetNo,
          assetCurrency: asset.currency,
          role: dto.role,
          ownerType,
          customerNo: dto.customerNo || null,
          approvalNo: approvalCase.approvalNo,
        },
```

- [ ] **Step 6: Verify TypeScript compiles clean**

Run: `cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js && npx tsc --noEmit --pretty 2>&1 | head -30`

Expected: No errors. All `dto.ownerId` references replaced. `customer` variable declared before use.

- [ ] **Step 7: Commit**

```bash
git add src/modules/asset-treasury/wallets/custodian-wallet-create-workflow.service.ts
git commit -m "fix(wallets): workflow uses customerNo, stores ownerNo/vaultId/iban"
```

---

### Task 4: Backend — Customer deposit wallet store ownerNo

**Files:**
- Modify: `src/modules/asset-treasury/wallets/customer-deposit-wallet.service.ts:76-87`

- [ ] **Step 1: Add ownerNo to wallet.create call**

In `src/modules/asset-treasury/wallets/customer-deposit-wallet.service.ts`, find the `prisma.wallet.create` call inside `createOrReturn()` (line 76):

```ts
// BEFORE (lines 76-87):
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

// AFTER:
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

- [ ] **Step 2: Verify TypeScript compiles clean**

Run: `cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js && npx tsc --noEmit --pretty 2>&1 | head -30`

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/modules/asset-treasury/wallets/customer-deposit-wallet.service.ts
git commit -m "fix(wallets): customer deposit wallet stores ownerNo"
```

---

### Task 5: Frontend — CustodianWalletCreateModal cleanup

**Files:**
- Modify: `admin-web/src/pages/CustodianWalletCreateModal.tsx`

- [ ] **Step 1: Remove assetNo from dropdown (line 187)**

```tsx
// BEFORE (line 186-188):
              <option key={a.assetNo} value={a.assetNo}>
                {a.code} ({a.type}) — {a.assetNo}
              </option>

// AFTER:
              <option key={a.assetNo} value={a.assetNo}>
                {a.code} ({a.type})
              </option>
```

- [ ] **Step 2: Rename state from ownerId to customerNo (line 59)**

```tsx
// BEFORE (line 59):
  const [ownerId, setOwnerId] = useState('');

// AFTER:
  const [customerNo, setCustomerNo] = useState('');
```

- [ ] **Step 3: Update validation (line 116)**

```tsx
// BEFORE (line 116):
    if (needsOwnerId && !ownerId.trim()) { setError('Owner ID is required for this role.'); return; }

// AFTER:
    if (needsOwnerId && !customerNo.trim()) { setError('Customer No is required for this role.'); return; }
```

- [ ] **Step 4: Update body construction (line 123)**

```tsx
// BEFORE (line 123):
      if (needsOwnerId && ownerId.trim()) body.ownerId = ownerId.trim();

// AFTER:
      if (needsOwnerId && customerNo.trim()) body.customerNo = customerNo.trim();
```

- [ ] **Step 5: Update Owner field label, placeholder, and onChange (lines 246-256)**

```tsx
// BEFORE (lines 246-256):
          {needsOwnerId && (
            <div>
              <label className={labelCls}>Owner ID (Customer UUID)</label>
              <input
                type="text"
                value={ownerId}
                onChange={(e) => setOwnerId(e.target.value)}
                placeholder="e.g. 550e8400-e29b-41d4-a716-446655440000"
                className={inputCls}
              />
            </div>
          )}

// AFTER:
          {needsOwnerId && (
            <div>
              <label className={labelCls}>Customer No</label>
              <input
                type="text"
                value={customerNo}
                onChange={(e) => setCustomerNo(e.target.value)}
                placeholder="e.g. CU2605130001"
                className={inputCls}
              />
            </div>
          )}
```

- [ ] **Step 6: Verify frontend compiles**

Run: `cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/admin-web && npx tsc --noEmit --pretty 2>&1 | head -20`

Expected: No errors.

- [ ] **Step 7: Commit**

```bash
git add admin-web/src/pages/CustodianWalletCreateModal.tsx
git commit -m "fix(admin): create modal uses customerNo, removes assetNo from dropdown"
```

---

### Task 6: Frontend — CustodianWalletDetail rule compliance

**Files:**
- Modify: `admin-web/src/pages/CustodianWalletDetail.tsx`

- [ ] **Step 1: Remove title/subtitle from DetailPageHeader (lines 293-295)**

```tsx
// BEFORE (lines 293-296):
      <DetailPageHeader
        title="CUSTODIAN WALLET"
        subtitle={wallet.walletNo}
        onBack={() => navigate('/dashboard/treasury/custodian-wallets')}

// AFTER:
      <DetailPageHeader
        onBack={() => navigate('/dashboard/treasury/custodian-wallets')}
```

- [ ] **Step 2: Remove `<Cap>` from Hero section (line 325)**

```tsx
// BEFORE (lines 324-326):
          <section className="bg-adm-card px-6 py-5">
            <Cap>Wallet</Cap>
            <p className="mt-1.5 font-mono text-[19px] font-bold leading-snug text-adm-amber">

// AFTER:
          <section className="bg-adm-card px-6 py-5">
            <p className="mt-1.5 font-mono text-[19px] font-bold leading-snug text-adm-amber">
```

- [ ] **Step 3: Remove Regulatory Gate buttons and related variables (lines 201-202, 485-510)**

Remove the permission variables:

```tsx
// DELETE these two lines (201-202):
  const canReadGate = hasAnyPermission([PERMISSIONS.GOV_REGULATORY_GATE_DETAIL_READ]);
  const canCreateGate = hasAnyPermission([PERMISSIONS.GOV_REGULATORY_GATE_CREATE]);
```

Remove `canReadGate` and `canCreateGate` from the `showActions` condition (line 288):

```tsx
// BEFORE (line 288):
  const showActions = canToggleStatus || isFailed || (isDepositWallet && canCreateCollection) || (isCmaWallet && (canReadGate || canCreateGate));

// AFTER:
  const showActions = canToggleStatus || isFailed || (isDepositWallet && canCreateCollection);
```

Delete the two gate button blocks inside the Actions sidebar (lines 485-510):

```tsx
// DELETE (lines 485-510):
                {isCmaWallet && wallet.regulatoryGateSummary && canReadGate && (
                  <button
                    onClick={() => navigate(`/dashboard/governance/regulatory-gates/${wallet.regulatoryGateSummary!.gateId}`)}
                    className={adminButtonClass('detailUtility')}
                  >
                    <Link2 size={13} />
                    View Regulatory Gate
                  </button>
                )}
                {isCmaWallet && !wallet.regulatoryGateSummary && canCreateGate && (
                  <button
                    onClick={() => {
                      const p = new URLSearchParams({
                        gateType: 'CLIENT_BANK_ACCOUNT_ENABLEMENT',
                        subjectType: 'WALLET',
                        subjectId: wallet.id,
                        subjectNo: wallet.walletNo,
                      });
                      navigate(`/dashboard/governance/regulatory-gates/create?${p.toString()}`);
                    }}
                    className={adminButtonClass('workflowPrimary')}
                  >
                    <Plus size={13} />
                    Create Regulatory Gate
                  </button>
                )}
```

Also remove `isCmaWallet` variable (line 199) if it's no longer used anywhere else in the file. Check first — if only used for gate buttons, delete it.

Remove unused imports: if `Plus` from `lucide-react` is no longer used elsewhere, remove it from the import line.

- [ ] **Step 4: Remove Wallet ID from sidebar, keep 5 fields (line 522)**

```tsx
// DELETE this line (522):
            <SidebarKV label="Wallet ID" value={wallet.id} mono />
```

Remaining sidebar Quick Reference fields:
```tsx
          <SidebarGroup title="Quick Reference">
            <SidebarKV label="Wallet No" value={wallet.walletNo} mono />
            <SidebarKV label="Status" value={<AdminBadge value={wallet.status} />} />
            <SidebarKV label="Role" value={wallet.walletRole} mono />
            <SidebarKV label="Role Name" value={WALLET_ROLE_LABEL[wallet.walletRole] || wallet.walletRole} />
            <SidebarKV label="Asset" value={wallet.asset.code} />
          </SidebarGroup>
```

- [ ] **Step 5: Dynamic custodian in Vault Info (line 528)**

```tsx
// BEFORE (line 528):
            <SidebarKV label="Custodian" value="HexTrust" />

// AFTER:
            <SidebarKV label="Custodian" value={wallet.type === 'FIAT_BANK' ? 'ZandBank' : 'HexTrust'} />
```

- [ ] **Step 6: Add Lifecycle sidebar block (after Approval block, before closing `</div>` of sidebar)**

Find the Approval `SidebarGroup` block (lines 532-549). After its closing tag, add:

```tsx
          {/* Lifecycle */}
          <SidebarGroup title="Lifecycle">
            <SidebarKV label="Created" value={fmt(wallet.createdAt)} mono />
            <SidebarKV label="Updated" value={fmt(wallet.updatedAt)} mono />
          </SidebarGroup>
```

- [ ] **Step 7: Verify frontend compiles**

Run: `cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/admin-web && npx tsc --noEmit --pretty 2>&1 | head -20`

Expected: No errors. Confirm no unused variable warnings for removed items.

- [ ] **Step 8: Commit**

```bash
git add admin-web/src/pages/CustodianWalletDetail.tsx
git commit -m "fix(admin): wallet detail page rule compliance — header, hero, sidebar, gate removal"
```

---

### Task 7: Frontend — CustodianWalletList balance suffix + action column removal

**Files:**
- Modify: `admin-web/src/pages/CustodianWalletList.tsx`

- [ ] **Step 1: Fix balance suffix — code → currency (line 378)**

```tsx
// BEFORE (line 378):
                    <span className="ml-1 font-mono text-[9px] text-adm-t3">{w.asset?.code}</span>

// AFTER:
                    <span className="ml-1 font-mono text-[9px] text-adm-t3">{w.asset?.currency}</span>
```

- [ ] **Step 2: Remove Action column header (lines 300-311)**

Remove `['Action', '100px'],` from the header array:

```tsx
// BEFORE (lines 300-311):
              {(
                [
                  ['Wallet No',  '160px'],
                  ['Role',       '100px'],
                  ['Owner',      '140px'],
                  ['Asset',      '100px'],
                  ['Balance',    '130px'],
                  ['Status',     '90px'],
                  ['Vault',      '110px'],
                  ['Updated',    '150px'],
                  ['Action',     '100px'],
                ] as [string, string][]

// AFTER:
              {(
                [
                  ['Wallet No',  '160px'],
                  ['Role',       '100px'],
                  ['Owner',      '140px'],
                  ['Asset',      '100px'],
                  ['Balance',    '130px'],
                  ['Status',     '90px'],
                  ['Vault',      '110px'],
                  ['Updated',    '150px'],
                ] as [string, string][]
```

- [ ] **Step 3: Remove Action column body (lines 398-419)**

Delete the entire Action `<td>` block:

```tsx
// DELETE (lines 398-419):
                  {/* Action */}
                  <td className="px-4 py-2.5" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center gap-2">
                      {w.status === 'FAILED' && canRetry && w.walletNo && (
                        <button
                          onClick={(e) => void handleRetry(w.walletNo!, e)}
                          className={adminButtonClass('rowSecondaryUtility')}
                        >
                          <RotateCcw size={11} />
                          Retry
                        </button>
                      )}
                      {statusActionLabel && (
                        <button
                          onClick={() => void handleStatusChange(w)}
                          className={adminButtonClass('rowSecondaryUtility')}
                        >
                          {statusActionLabel}
                        </button>
                      )}
                    </div>
                  </td>
```

- [ ] **Step 4: Remove `statusActionLabel` variable (line 340)**

```tsx
// DELETE (line 340):
              const statusActionLabel = w.status === 'ACTIVE' ? 'Disable' : w.status === 'DISABLED' ? 'Enable' : null;
```

- [ ] **Step 5: Remove `handleStatusChange` and `handleRetry` functions (lines 152-195)**

Delete the entire `handleStatusChange` function (lines 152-176) and `handleRetry` function (lines 178-195).

- [ ] **Step 6: Remove `canRetry` variable and unused imports (line 81)**

```tsx
// DELETE (line 81):
  const canRetry = hasAnyPermission([PERMISSIONS.CUSTODIAN_WALLET_RETRY]);
```

Check if `PERMISSIONS.CUSTODIAN_WALLET_RETRY` is still used elsewhere in the file. If not, it can stay in the import (it's a namespace import). Remove `RotateCcw` from the lucide-react import if no longer used:

```tsx
// BEFORE (line 3):
import { RefreshCw, Search, Plus, RotateCcw } from 'lucide-react';

// AFTER:
import { RefreshCw, Search, Plus } from 'lucide-react';
```

- [ ] **Step 7: Update colSpan on loading/empty rows from 9 to 8 (lines 326, 333)**

```tsx
// BEFORE (line 326):
                <td colSpan={9} className="px-4 py-10 text-center font-mono text-[11px] text-adm-t3">

// AFTER:
                <td colSpan={8} className="px-4 py-10 text-center font-mono text-[11px] text-adm-t3">
```

Do the same for the empty-state row (line 333): change `colSpan={9}` to `colSpan={8}`.

- [ ] **Step 8: Verify frontend compiles**

Run: `cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/admin-web && npx tsc --noEmit --pretty 2>&1 | head -20`

Expected: No errors.

- [ ] **Step 9: Commit**

```bash
git add admin-web/src/pages/CustodianWalletList.tsx
git commit -m "fix(admin): wallet list uses currency suffix, removes action column"
```

---

### Task 8: Documentation — Register sidebar fields

**Files:**
- Modify: `doc-final/rules/frontend-admin.md`

- [ ] **Step 1: Add CustodianWallet to Per-entity Sidebar Fields table**

Open `doc-final/rules/frontend-admin.md`. Find the Per-entity Sidebar Fields table (around line 149). Add a new row after the last entry (currently **Asset**):

```md
| **CustodianWallet** | `walletNo`, `status` badge, `walletRole`, `roleName`, `asset.code` | `createdAt`, `updatedAt` |
```

The table should now look like:

```md
| Entity | Identity Summary fields | Lifecycle fields |
|---|---|---|
| **Approval** | `riskLevel`, `checkerRoles`, `createdByUserNo` | `submittedAt`, `timeoutAt`, `updatedAt` |
| **PlatformMember** | primary `role`, MFA status, account `status` badge | `createdAt`, `lastLoginAt`, `mfaEnabledAt` |
| **Role** | account `status` badge, domain count, permission count | (none — entity has no timestamp fields) |
| **AuditLog** | `triggerType`, `entityType`, `actorType` | `retainedUntil`, `archivedAt`, `createdAt`, `updatedAt` |
| **EvidencePackage** | account `status` badge, `exportMode`, `itemCount`, `exportedByNo` | `createdAt`, `updatedAt` |
| **Asset** | `assetNo`, `status` badge, `code`, `type` | `createdAt`, `updatedAt` |
| **CustodianWallet** | `walletNo`, `status` badge, `walletRole`, `roleName`, `asset.code` | `createdAt`, `updatedAt` |
```

- [ ] **Step 2: Commit**

```bash
git add doc-final/rules/frontend-admin.md
git commit -m "docs: register CustodianWallet sidebar fields in frontend-admin rules"
```
