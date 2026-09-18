# Custodian Wallet Admin Frontend — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add admin frontend pages for the Custodian Wallet Create workflow so admins can create wallets end-to-end: pick asset → pick role → submit → approve → active (or retry on failure).

**Architecture:** Rename existing WalletList/WalletDetail pages to CustodianWalletList/CustodianWalletDetail with updated routes. Add a creation modal with form fields (asset, role, custodian, ownerId). Extend backend DTO to accept optional vaultId. All new status states (PENDING_APPROVAL, CREATING, FAILED) get badges and filter options.

**Tech Stack:** React 19, React Router 7, Tailwind CSS (adm-* tokens), adminFetch wrapper, NestJS + Prisma (backend DTO only)

---

## File Structure

| Action | Path | Responsibility |
|--------|------|----------------|
| Modify | `admin-web/src/components/ui/AdminBadge.tsx` | Add CREATING status mapping |
| Modify | `src/modules/asset-treasury/wallets/dto/create-custodian-wallet.dto.ts` | Add optional vaultId field |
| Modify | `src/modules/asset-treasury/wallets/custodian-adapter.interface.ts` | Add optional vaultId to CreateVaultParams |
| Modify | `src/modules/asset-treasury/wallets/mock-custodian.adapter.ts` | Use provided vaultId when present |
| Modify | `src/modules/asset-treasury/wallets/custodian-wallet-create-workflow.service.ts` | Pass vaultId through to adapter |
| Rename | `admin-web/src/pages/WalletList.tsx` → `CustodianWalletList.tsx` | Renamed + enhanced list page |
| Rename | `admin-web/src/pages/WalletDetail.tsx` → `CustodianWalletDetail.tsx` | Renamed + enhanced detail page |
| Create | `admin-web/src/pages/CustodianWalletCreateModal.tsx` | Creation modal component |
| Modify | `admin-web/src/App.tsx` | Update lazy imports and routes |
| Modify | `admin-web/src/components/DashboardLayout.tsx` | Update sidebar nav item |

---

### Task 1: Add CREATING status to AdminBadge

**Files:**
- Modify: `admin-web/src/components/ui/AdminBadge.tsx:5-20`

- [ ] **Step 1: Add CREATING to STATUS_MAP**

In `admin-web/src/components/ui/AdminBadge.tsx`, add `CREATING` to the `STATUS_MAP` object. It should map to `'pending'` (blue — same as PENDING_APPROVAL, since both are in-progress states):

```typescript
const STATUS_MAP: Record<string, BadgeVariant> = {
  SUCCESS:          'success',
  DONE:             'success',
  APPROVED:         'success',
  ACTIVE:           'active',
  FAILED:           'failed',
  ERROR:            'failed',
  REJECTED:         'rejected',
  PENDING:          'pending',
  PENDING_APPROVAL: 'pending',
  CREATING:         'pending',   // ← add this line
  DRAFT:            'info',
  READY:            'info',
  DELETED:          'deleted',
  DISABLED:         'failed',
  FROZEN:           'rejected',
};
```

- [ ] **Step 2: Verify**

Run the admin dev server and confirm the badge renders correctly by visiting any wallet list that might have CREATING status. Visual check only — no unit tests in this frontend.

```bash
cd Exchange_js && npm run dev:start
```

- [ ] **Step 3: Commit**

```bash
git add admin-web/src/components/ui/AdminBadge.tsx
git commit -m "feat(admin): add CREATING status to AdminBadge"
```

---

### Task 2: Extend backend DTO to accept optional vaultId

**Files:**
- Modify: `src/modules/asset-treasury/wallets/dto/create-custodian-wallet.dto.ts`
- Modify: `src/modules/asset-treasury/wallets/custodian-adapter.interface.ts`
- Modify: `src/modules/asset-treasury/wallets/mock-custodian.adapter.ts`
- Modify: `src/modules/asset-treasury/wallets/custodian-wallet-create-workflow.service.ts`

- [ ] **Step 1: Add vaultId to CreateCustodianWalletDto**

In `src/modules/asset-treasury/wallets/dto/create-custodian-wallet.dto.ts`, add an optional `vaultId` field:

```typescript
import { IsString, IsEnum, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { WalletRole } from './wallet.dto';

export class CreateCustodianWalletDto {
  @ApiProperty({ description: 'Asset operator key (e.g. AS2605130001)' })
  @IsString()
  assetNo!: string;

  @ApiProperty({ enum: WalletRole, description: 'Wallet role to assign' })
  @IsEnum(WalletRole)
  role!: WalletRole;

  @ApiProperty({ required: false, description: 'Customer UUID — required for customer-level roles (C_DEP, C_VIBAN)' })
  @IsString()
  @IsOptional()
  ownerId?: string;

  @ApiProperty({ required: false, description: 'Existing vault ID — if provided, creates address under this vault; otherwise creates a new vault' })
  @IsString()
  @IsOptional()
  vaultId?: string;
}
```

- [ ] **Step 2: Add vaultId to CreateVaultParams interface**

In `src/modules/asset-treasury/wallets/custodian-adapter.interface.ts`, add optional `vaultId`:

```typescript
import { WalletRole } from './dto/wallet.dto';

export const CUSTODIAN_ADAPTER = Symbol('CUSTODIAN_ADAPTER');

export interface CreateVaultParams {
  assetCode: string;
  network?: string;
  role: WalletRole;
  vaultId?: string;
}

export interface CreateVaultResult {
  vaultId: string;
  address?: string;
  iban?: string;
}

export interface CustodianAdapter {
  createVault(params: CreateVaultParams): Promise<CreateVaultResult>;
}
```

- [ ] **Step 3: Update MockCustodianAdapter to use provided vaultId**

In `src/modules/asset-treasury/wallets/mock-custodian.adapter.ts`, use `params.vaultId` when provided:

```typescript
import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import { CustodianAdapter, CreateVaultParams, CreateVaultResult } from './custodian-adapter.interface';

@Injectable()
export class MockCustodianAdapter implements CustodianAdapter {
  private readonly logger = new Logger(MockCustodianAdapter.name);

  async createVault(params: CreateVaultParams): Promise<CreateVaultResult> {
    this.logger.log(`[MOCK] Creating vault: asset=${params.assetCode}, role=${params.role}, existingVault=${params.vaultId ?? 'none'}`);

    const vaultId = params.vaultId ?? `mock-vault-${crypto.randomUUID().slice(0, 8)}`;

    if (params.network) {
      const address = '0x' + crypto.randomBytes(20).toString('hex');
      this.logger.log(`[MOCK] Generated crypto address: ${address}`);
      return { vaultId, address };
    }

    const iban = 'AE' + crypto.randomInt(10, 99) + 'MOCK' + crypto.randomBytes(8).toString('hex').toUpperCase();
    this.logger.log(`[MOCK] Generated IBAN: ${iban}`);
    return { vaultId, iban };
  }
}
```

- [ ] **Step 4: Pass vaultId through the workflow**

In `src/modules/asset-treasury/wallets/custodian-wallet-create-workflow.service.ts`, update the `executeCreation` method and `initiateCreate` to store and pass vaultId.

In `initiateCreate` (around line 110), add `vaultId` to the wallet creation data:

```typescript
    const wallet = await this.prisma.wallet.create({
      data: {
        walletNo,
        ownerType,
        ownerId: ownerType === 'PLATFORM' ? null : dto.ownerId,
        type: walletType,
        direction,
        walletRole: dto.role,
        assetId: asset.id,
        status: 'PENDING_APPROVAL',
        vaultId: dto.vaultId ?? null,
      },
    });
```

In `executeCreation` (around line 225), pass the stored vaultId to the adapter:

```typescript
      const result = await this.custodianAdapter.createVault({
        assetCode: wallet.asset.code,
        network: wallet.asset.network ?? undefined,
        role: wallet.walletRole as WalletRole,
        vaultId: wallet.vaultId ?? undefined,
      });
```

Similarly in `retryCreate` (around line 316):

```typescript
      const result = await this.custodianAdapter.createVault({
        assetCode: wallet.asset.code,
        network: wallet.asset.network ?? undefined,
        role: wallet.walletRole as WalletRole,
        vaultId: wallet.vaultId ?? undefined,
      });
```

- [ ] **Step 5: Verify backend compiles**

```bash
cd Exchange_js && npx tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add src/modules/asset-treasury/wallets/dto/create-custodian-wallet.dto.ts \
        src/modules/asset-treasury/wallets/custodian-adapter.interface.ts \
        src/modules/asset-treasury/wallets/mock-custodian.adapter.ts \
        src/modules/asset-treasury/wallets/custodian-wallet-create-workflow.service.ts
git commit -m "feat(wallets): accept optional vaultId in custodian wallet create flow"
```

---

### Task 3: Rename WalletList → CustodianWalletList and update routing

This task renames the files, updates App.tsx imports/routes, and updates the DashboardLayout sidebar.

**Files:**
- Rename: `admin-web/src/pages/WalletList.tsx` → `admin-web/src/pages/CustodianWalletList.tsx`
- Rename: `admin-web/src/pages/WalletDetail.tsx` → `admin-web/src/pages/CustodianWalletDetail.tsx`
- Modify: `admin-web/src/App.tsx:30-31` (lazy imports) and `admin-web/src/App.tsx:748-754` (routes)
- Modify: `admin-web/src/components/DashboardLayout.tsx:289-294` (sidebar nav)

- [ ] **Step 1: Rename files using git mv**

```bash
cd Exchange_js
git mv admin-web/src/pages/WalletList.tsx admin-web/src/pages/CustodianWalletList.tsx
git mv admin-web/src/pages/WalletDetail.tsx admin-web/src/pages/CustodianWalletDetail.tsx
```

- [ ] **Step 2: Update lazy imports in App.tsx**

In `admin-web/src/App.tsx`, find and replace lines 30-31:

```typescript
// Before:
const WalletList = lazy(() => import('./pages/WalletList'));
const WalletDetail = lazy(() => import('./pages/WalletDetail'));

// After:
const CustodianWalletList = lazy(() => import('./pages/CustodianWalletList'));
const CustodianWalletDetail = lazy(() => import('./pages/CustodianWalletDetail'));
```

- [ ] **Step 3: Update route definitions in App.tsx**

In `admin-web/src/App.tsx`, find and replace lines 747-754:

```typescript
// Before:
            <Route
              path="treasury/wallets"
              element={withPermission(<WalletList />, [PERMISSIONS.WALLETS_READ])}
            />
            <Route
              path="treasury/wallets/:id"
              element={withPermission(<WalletDetail />, [PERMISSIONS.WALLET_DETAIL_READ])}
            />

// After:
            <Route
              path="treasury/custodian-wallets"
              element={withPermission(<CustodianWalletList />, [PERMISSIONS.WALLETS_READ])}
            />
            <Route
              path="treasury/custodian-wallets/:id"
              element={withPermission(<CustodianWalletDetail />, [PERMISSIONS.WALLET_DETAIL_READ])}
            />
```

- [ ] **Step 4: Update DashboardLayout sidebar**

In `admin-web/src/components/DashboardLayout.tsx`, find the Treasury children item for Wallets (around line 289-294) and update:

```typescript
// Before:
        {
          path: '/dashboard/treasury/wallets',
          label: 'Wallet & Account',
          icon: <Wallet size={13} />,
          requiredPermissions: [PERMISSIONS.WALLETS_READ],
        },

// After:
        {
          path: '/dashboard/treasury/custodian-wallets',
          label: 'Custodian Wallets',
          icon: <Wallet size={13} />,
          requiredPermissions: [PERMISSIONS.WALLETS_READ],
        },
```

- [ ] **Step 5: Update internal navigation references in CustodianWalletList.tsx**

In `admin-web/src/pages/CustodianWalletList.tsx`, update the row click handler (line 306):

```typescript
// Before:
onClick={() => navigate(`/dashboard/treasury/wallets/${w.id}`)}

// After:
onClick={() => navigate(`/dashboard/treasury/custodian-wallets/${w.id}`)}
```

- [ ] **Step 6: Update back navigation in CustodianWalletDetail.tsx**

In `admin-web/src/pages/CustodianWalletDetail.tsx`, update the back button (line 270):

```typescript
// Before:
onBack={() => navigate('/dashboard/treasury/wallets')}

// After:
onBack={() => navigate('/dashboard/treasury/custodian-wallets')}
```

- [ ] **Step 7: Update component export name in CustodianWalletList.tsx**

In `admin-web/src/pages/CustodianWalletList.tsx`, update the component name and default export:

```typescript
// Before (line 73):
const WalletList = () => {

// After:
const CustodianWalletList = () => {

// Before (line 394):
export default WalletList;

// After:
export default CustodianWalletList;
```

- [ ] **Step 8: Verify dev server starts without errors**

```bash
cd Exchange_js && npm run dev:start
```

Visit `http://localhost:3501/dashboard/treasury/custodian-wallets` and confirm the page loads.

- [ ] **Step 9: Commit**

```bash
cd Exchange_js
git add admin-web/src/pages/CustodianWalletList.tsx \
        admin-web/src/pages/CustodianWalletDetail.tsx \
        admin-web/src/App.tsx \
        admin-web/src/components/DashboardLayout.tsx
git commit -m "refactor(admin): rename Wallet pages to CustodianWallet, update routes"
```

---

### Task 4: Enhance CustodianWalletList — status filters, Vault ID column, Retry button

**Files:**
- Modify: `admin-web/src/pages/CustodianWalletList.tsx`

- [ ] **Step 1: Update the page title**

In `admin-web/src/pages/CustodianWalletList.tsx`, update the PageTitleBar (around line 176-178):

```typescript
// Before:
      <PageTitleBar
        title="Wallets"
        meta={`${total} wallet${total === 1 ? '' : 's'} · Treasury`}
      >

// After:
      <PageTitleBar
        title="Custodian Wallets"
        meta={`${total} wallet${total === 1 ? '' : 's'} · Treasury`}
      >
```

- [ ] **Step 2: Add new status options to the status filter dropdown**

In `admin-web/src/pages/CustodianWalletList.tsx`, update the status `<select>` (around line 226-235):

```typescript
        <select
          value={filters.status}
          onChange={(e) => updateFilter('status', e.target.value)}
          className={`${fi} w-36`}
        >
          <option value="">All status</option>
          <option value="PENDING_APPROVAL">PENDING_APPROVAL</option>
          <option value="CREATING">CREATING</option>
          <option value="ACTIVE">ACTIVE</option>
          <option value="FAILED">FAILED</option>
          <option value="DISABLED">DISABLED</option>
          <option value="FROZEN">FROZEN</option>
        </select>
```

Note: width increased from `w-28` to `w-36` to fit the longer status names.

- [ ] **Step 3: Add imports for the create button and retry**

At the top of `admin-web/src/pages/CustodianWalletList.tsx`, update imports:

```typescript
// Before (line 3):
import { RefreshCw, Search } from 'lucide-react';

// After:
import { RefreshCw, Search, Plus, RotateCcw } from 'lucide-react';
```

Add permission imports:

```typescript
// Before (line 16):
import { WalletRoleBadge, WALLET_ROLE_OPTIONS } from '../utils/walletRole.util';

// After:
import { WalletRoleBadge, WALLET_ROLE_OPTIONS } from '../utils/walletRole.util';
import { useAdminSession } from '../contexts/AdminSessionContext';
import { PERMISSIONS } from '../rbac/permissions';
```

- [ ] **Step 4: Add permission checks and modal state inside the component**

After `const navigate = useNavigate();` (line 74), add:

```typescript
  const { hasAnyPermission } = useAdminSession();
  const canCreate = hasAnyPermission([PERMISSIONS.CUSTODIAN_WALLET_CREATE]);
  const canRetry = hasAnyPermission([PERMISSIONS.CUSTODIAN_WALLET_RETRY]);
  const [showCreateModal, setShowCreateModal] = useState(false);
```

- [ ] **Step 5: Add retry handler**

After the `handleStatusChange` function (after line 168), add:

```typescript
  const handleRetry = async (walletNo: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm(`Retry vault creation for wallet ${walletNo}?`)) return;
    try {
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/custodian-wallets/${walletNo}/retry`,
        { method: 'POST' },
      );
      if (!res.ok) {
        setError(await getApiErrorMessage(res, 'Retry failed.'));
        return;
      }
      void fetchItems(currentPage);
    } catch (err) {
      if (err instanceof AdminSessionError) return;
      setError(err instanceof Error ? err.message : 'Retry failed.');
    }
  };
```

- [ ] **Step 6: Add "Create Wallet" button in the title bar**

Update the PageTitleBar children (the area around line 179-187):

```typescript
      <PageTitleBar
        title="Custodian Wallets"
        meta={`${total} wallet${total === 1 ? '' : 's'} · Treasury`}
      >
        {canCreate && (
          <button
            onClick={() => setShowCreateModal(true)}
            className={adminButtonClass('listPrimary')}
          >
            <Plus size={13} />
            Create Wallet
          </button>
        )}
        <button
          onClick={() => void fetchItems(currentPage)}
          className={adminIconButtonClass()}
          title="Refresh"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </PageTitleBar>
```

- [ ] **Step 7: Add Vault ID column to the table header and body**

Update the table header array (around line 261-271) — add `['Vault', '110px']` after `['Status', '90px']`:

```typescript
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
              ).map(([label, w]) => (
```

Update the colSpan values from `8` to `9` in the loading and empty rows:

```typescript
            {loading && (
              <tr>
                <td colSpan={9} className="px-4 py-10 text-center font-mono text-[11px] text-adm-t3">
                  Loading…
                </td>
              </tr>
            )}
            {!loading && items.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-10 text-center font-mono text-[11px] text-adm-t3">
                  No wallets found.
                </td>
              </tr>
            )}
```

Add the Vault ID cell after the Status cell (after `<AdminBadge value={w.status} />`):

```typescript
                  {/* Vault */}
                  <td className="px-4 py-2.5">
                    <span className="font-mono text-[10px] text-adm-t2">
                      {(w as any).vaultId || '—'}
                    </span>
                  </td>
```

- [ ] **Step 8: Add Retry button to the Action column**

Update the Action cell (around line 352-363). Replace the existing action column content:

```typescript
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

- [ ] **Step 9: Add WalletItem interface field and modal import**

Update the `WalletItem` interface (around line 21-36) to include `vaultId`:

```typescript
interface WalletItem {
  id: string;
  walletNo: string | null;
  walletRole: string;
  surfaceCategory?: string;
  ownerType: string;
  ownerId: string | null;
  ownerNo: string | null;
  ownerName?: string | null;
  type: string;
  direction: string;
  balance: string;
  asset: { code: string; type: string; network?: string | null; decimals?: number };
  status: string;
  vaultId?: string | null;
  updatedAt: string;
}
```

Add the modal import at the top of the file (after the existing imports):

```typescript
import CustodianWalletCreateModal from './CustodianWalletCreateModal';
```

- [ ] **Step 10: Render the create modal**

Before the closing `</div>` of the component's return (before line 390), add:

```typescript
      {showCreateModal && (
        <CustodianWalletCreateModal
          onClose={() => setShowCreateModal(false)}
          onCreated={() => {
            setShowCreateModal(false);
            void fetchItems(1);
          }}
        />
      )}
```

- [ ] **Step 11: Commit**

```bash
cd Exchange_js
git add admin-web/src/pages/CustodianWalletList.tsx
git commit -m "feat(admin): enhance CustodianWalletList with status filters, vault column, retry, create button"
```

---

### Task 5: Create CustodianWalletCreateModal

**Files:**
- Create: `admin-web/src/pages/CustodianWalletCreateModal.tsx`

- [ ] **Step 1: Create the modal component file**

Create `admin-web/src/pages/CustodianWalletCreateModal.tsx` with the following content:

```tsx
import { useEffect, useState } from 'react';
import { AlertCircle } from 'lucide-react';
import {
  adminButtonClass,
} from '../components/common/adminButtonStyles';
import {
  AdminSessionError,
  adminFetch,
  getApiErrorMessage,
} from '../utils/adminFetch';
import { WALLET_ROLE_OPTIONS } from '../utils/walletRole.util';

/* ── Role → Asset type filter ── */

const ROLE_ASSET_TYPE: Record<string, string[]> = {
  C_DEP:   ['CRYPTO'],
  C_VIBAN: ['FIAT'],
  C_MAIN:  ['CRYPTO'],
  C_OUT:   ['CRYPTO'],
  C_CMA:   ['FIAT'],
  F_LIQ:   ['CRYPTO', 'FIAT'],
  F_OPS:   ['CRYPTO', 'FIAT'],
};

const ROLE_OWNER_TYPE: Record<string, string> = {
  C_DEP:   'CUSTOMER',
  C_VIBAN: 'CUSTOMER',
  C_MAIN:  'PLATFORM',
  C_OUT:   'PLATFORM',
  C_CMA:   'PLATFORM',
  F_LIQ:   'PLATFORM',
  F_OPS:   'PLATFORM',
};

/* ── Interfaces ── */

interface AssetOption {
  id: string;
  assetNo: string;
  code: string;
  type: string;
  status: string;
}

interface Props {
  onClose: () => void;
  onCreated: () => void;
}

/* ── Component ── */

export default function CustodianWalletCreateModal({ onClose, onCreated }: Props) {
  const [assets, setAssets] = useState<AssetOption[]>([]);
  const [assetsLoading, setAssetsLoading] = useState(true);

  const [assetNo, setAssetNo] = useState('');
  const [role, setRole] = useState('');
  const [ownerId, setOwnerId] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  /* ── Fetch assets on mount ── */

  useEffect(() => {
    const fetchAssets = async () => {
      try {
        const res = await adminFetch(`${import.meta.env.VITE_API_URL}/assets?take=200`);
        if (!res.ok) return;
        const data = await res.json();
        const items = (data.items ?? data) as AssetOption[];
        setAssets(items.filter((a) => a.status === 'PROVISIONING' || a.status === 'ACTIVE'));
      } catch {
        // ignore — user will see empty dropdown
      } finally {
        setAssetsLoading(false);
      }
    };
    void fetchAssets();
  }, []);

  /* ── Derived state ── */

  const selectedAsset = assets.find((a) => a.assetNo === assetNo);
  const filteredRoles = selectedAsset
    ? WALLET_ROLE_OPTIONS.filter((r) => ROLE_ASSET_TYPE[r]?.includes(selectedAsset.type))
    : WALLET_ROLE_OPTIONS;

  const needsOwnerId = role ? ROLE_OWNER_TYPE[role] === 'CUSTOMER' : false;

  /* ── Reset role when asset changes and role becomes invalid ── */

  useEffect(() => {
    if (role && !filteredRoles.includes(role)) {
      setRole('');
    }
  }, [assetNo]);

  /* ── Submit ── */

  const handleSubmit = async () => {
    setError('');

    if (!assetNo) { setError('Please select an asset.'); return; }
    if (!role) { setError('Please select a role.'); return; }
    if (needsOwnerId && !ownerId.trim()) { setError('Owner ID is required for this role.'); return; }

    setSubmitting(true);
    try {
      const body: Record<string, string> = { assetNo, role };
      if (needsOwnerId && ownerId.trim()) body.ownerId = ownerId.trim();

      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/custodian-wallets`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      );

      if (!res.ok) {
        setError(await getApiErrorMessage(res, 'Failed to create wallet.'));
        return;
      }

      onCreated();
    } catch (err) {
      if (err instanceof AdminSessionError) return;
      setError(err instanceof Error ? err.message : 'Failed to create wallet.');
    } finally {
      setSubmitting(false);
    }
  };

  /* ── Input styles ── */

  const inputCls =
    'w-full h-[34px] rounded border border-adm-border bg-adm-bg px-2.5 font-mono text-[11px] text-adm-t1 placeholder:text-adm-t3 outline-none focus:border-adm-amber transition-colors';
  const labelCls = 'block font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-adm-t3 mb-1.5';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-xl border border-adm-border bg-white shadow-xl">

        {/* Header */}
        <div className="border-b border-adm-border px-6 py-4">
          <h2 className="text-lg font-semibold text-adm-t1">Create Custodian Wallet</h2>
          <p className="mt-1 text-sm text-adm-t3">Submit a wallet creation request for approval.</p>
        </div>

        {/* Body */}
        <div className="space-y-4 px-6 py-5">

          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-adm-red/20 bg-adm-red/6 px-3 py-2 text-sm text-adm-red">
              <AlertCircle size={16} className="mt-0.5 shrink-0" />
              <span className="font-mono text-[11px]">{error}</span>
            </div>
          )}

          {/* Asset */}
          <div>
            <label className={labelCls}>Asset</label>
            <select
              value={assetNo}
              onChange={(e) => setAssetNo(e.target.value)}
              className={inputCls}
              disabled={assetsLoading}
            >
              <option value="">{assetsLoading ? 'Loading assets…' : 'Select an asset'}</option>
              {assets.map((a) => (
                <option key={a.assetNo} value={a.assetNo}>
                  {a.code} ({a.type}) — {a.assetNo}
                </option>
              ))}
            </select>
          </div>

          {/* Role */}
          <div>
            <label className={labelCls}>Wallet Role</label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className={inputCls}
              disabled={!assetNo}
            >
              <option value="">Select a role</option>
              {filteredRoles.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>

          {/* Custodian Provider (display-only) */}
          <div>
            <label className={labelCls}>Custodian Provider</label>
            <select value="HEXTRUST" disabled className={inputCls}>
              <option value="HEXTRUST">HexTrust</option>
            </select>
          </div>

          {/* Owner ID (conditional) */}
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

        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 border-t border-adm-border px-6 py-4">
          <button
            onClick={onClose}
            disabled={submitting}
            className={adminButtonClass('modalCancel')}
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className={adminButtonClass('modalConfirm')}
          >
            {submitting ? 'Submitting…' : 'Submit for Approval'}
          </button>
        </div>

      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify the modal renders**

Visit `http://localhost:3501/dashboard/treasury/custodian-wallets`, click "Create Wallet", confirm:
- Asset dropdown loads and shows assets
- Role dropdown filters based on selected asset type
- Custodian Provider shows HexTrust (disabled)
- Owner ID appears only for C_DEP / C_VIBAN roles
- Submit creates wallet and closes modal on success
- Error messages display on failure

- [ ] **Step 3: Commit**

```bash
cd Exchange_js
git add admin-web/src/pages/CustodianWalletCreateModal.tsx
git commit -m "feat(admin): add CustodianWalletCreateModal with asset/role/owner fields"
```

---

### Task 6: Enhance CustodianWalletDetail — vault info, approval link, retry button

**Files:**
- Modify: `admin-web/src/pages/CustodianWalletDetail.tsx`

- [ ] **Step 1: Add vaultId and approval fields to the WalletDetailData interface**

In `admin-web/src/pages/CustodianWalletDetail.tsx`, update the `WalletDetailData` interface (around line 16-58) to add missing fields:

```typescript
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
  regulatoryGateSummary?: {
    gateId: string;
    gateNo: string;
    gateType: string;
    gateResult: string;
  } | null;

  createdAt: string;
  updatedAt: string;

  asset: {
    code: string;
    type: string;
    network: string | null;
    decimals?: number;
  };
}
```

- [ ] **Step 2: Add RotateCcw import and retry permission check**

Update the imports at the top of the file:

```typescript
// Before (line 3):
import { Repeat, Link2, Plus } from 'lucide-react';

// After:
import { Repeat, Link2, Plus, RotateCcw } from 'lucide-react';
```

- [ ] **Step 3: Add retry handler and permission**

Inside the component function, after `const canCreateGate = ...` (around line 197), add:

```typescript
  const canRetry = hasAnyPermission([PERMISSIONS.CUSTODIAN_WALLET_RETRY]);
```

After the `handleCreateCollection` function (after line 257), add:

```typescript
  const handleRetryCreation = async () => {
    if (!wallet.walletNo || !window.confirm(`Retry vault creation for wallet ${wallet.walletNo}?`)) return;
    try {
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/custodian-wallets/${wallet.walletNo}/retry`,
        { method: 'POST' },
      );
      if (!res.ok) {
        setError(await getApiErrorMessage(res, 'Retry failed.'));
        return;
      }
      setNotice('Vault creation retried successfully.');
      void fetchWallet();
    } catch (err) {
      if (err instanceof AdminSessionError) return;
      setError(err instanceof Error ? err.message : 'Retry failed.');
    }
  };
```

- [ ] **Step 4: Update showActions to include FAILED retry**

Update the `showActions` derived state (around line 262):

```typescript
// Before:
  const showActions = canToggleStatus || (isDepositWallet && canCreateCollection) || (isCmaWallet && (canReadGate || canCreateGate));

// After:
  const isFailed = wallet.status === 'FAILED';
  const showActions = canToggleStatus || isFailed || (isDepositWallet && canCreateCollection) || (isCmaWallet && (canReadGate || canCreateGate));
```

- [ ] **Step 5: Add Retry button to the Actions sidebar**

In the Actions sidebar section (around line 421-477), add the retry button at the top of the actions list, right after `<Cap>Actions</Cap>` and before the existing status toggle buttons:

```typescript
          {showActions && (
            <div className="border-b border-adm-border py-4">
              <Cap>Actions</Cap>
              <div className="mt-2.5 flex flex-col gap-2">
                {isFailed && canRetry && (
                  <button
                    onClick={() => void handleRetryCreation()}
                    className={adminButtonClass('workflowPrimary')}
                  >
                    <RotateCcw size={13} />
                    Retry Creation
                  </button>
                )}
                {canToggleStatus && wallet.status === 'ACTIVE' && (
```

(The rest of the Actions section remains unchanged.)

- [ ] **Step 6: Add Vault Info sidebar group**

After the "Quick Reference" SidebarGroup (around line 488), add a new Vault Info group:

```typescript
          {/* Vault Info */}
          <SidebarGroup title="Vault Info">
            <SidebarKV label="Vault ID" value={wallet.vaultId} mono />
            <SidebarKV label="Custodian" value="HexTrust" />
          </SidebarGroup>

          {/* Approval Info */}
          {wallet.approvalCaseNo && (
            <SidebarGroup title="Approval">
              <SidebarKV
                label="Case No"
                value={
                  wallet.approvalCaseId ? (
                    <button
                      onClick={() => navigate(`/dashboard/governance/approvals/${wallet.approvalCaseId}`)}
                      className="font-mono text-[10px] text-adm-amber underline"
                    >
                      {wallet.approvalCaseNo}
                    </button>
                  ) : (
                    wallet.approvalCaseNo
                  )
                }
              />
            </SidebarGroup>
          )}
```

- [ ] **Step 7: Update the header subtitle**

Update the DetailPageHeader (around line 267-273):

```typescript
// Before:
      <DetailPageHeader
        title="WALLET"
        subtitle={wallet.walletNo}

// After:
      <DetailPageHeader
        title="CUSTODIAN WALLET"
        subtitle={wallet.walletNo}
```

- [ ] **Step 8: Verify the detail page**

Visit a wallet detail page at `http://localhost:3501/dashboard/treasury/custodian-wallets/<id>`. Confirm:
- Header says "CUSTODIAN WALLET"
- Back button navigates to the custodian wallets list
- Vault Info sidebar shows vaultId (or "—" if null)
- Approval section shows approval case link (if applicable)
- For FAILED wallets, "Retry Creation" button appears and works

- [ ] **Step 9: Commit**

```bash
cd Exchange_js
git add admin-web/src/pages/CustodianWalletDetail.tsx
git commit -m "feat(admin): add vault info, approval link, retry button to CustodianWalletDetail"
```

---

## Self-Review Checklist

| Spec Requirement | Task |
|------------------|------|
| Page rename WalletList → CustodianWalletList | Task 3 |
| Page rename WalletDetail → CustodianWalletDetail | Task 3 |
| Route update to `/dashboard/treasury/custodian-wallets` | Task 3 |
| Sidebar label "Custodian Wallets" | Task 3 |
| CREATING status badge (blue) | Task 1 |
| Status filter options (PENDING_APPROVAL, CREATING, FAILED) | Task 4 |
| Vault ID column in list | Task 4 |
| "+ Create Wallet" button with CUSTODIAN_WALLET_CREATE permission | Task 4 |
| Creation modal with asset, role, custodian, ownerId | Task 5 |
| Role filtered by asset type | Task 5 |
| Owner ID conditional on customer role | Task 5 |
| POST /admin/custodian-wallets on submit | Task 5 |
| Retry button in list for FAILED (CUSTODIAN_WALLET_RETRY permission) | Task 4 |
| Retry button in detail for FAILED | Task 6 |
| Vault Info sidebar in detail | Task 6 |
| Approval case link in detail sidebar | Task 6 |
| Backend DTO vaultId extension | Task 2 |
| Mock adapter uses provided vaultId | Task 2 |
