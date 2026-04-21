# Wave 4 AssetConfig Business Config Subject — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `ASSET_CONFIG` as the 6th business config subject so per-asset operational parameters (enabled flags, min/max amounts, fee buffer) participate in the staged → validated → published release lifecycle alongside COA, ACCT_EVENT, JOURNAL_TEMPLATE, CLEARING_TEMPLATE, and PRICING_POLICY.

**Architecture:** `ASSET_CONFIG` follows the existing config-as-code pattern: a TypeScript manifest file is the single write path; the release system tracks staged/validated/active snapshots; the admin UI is read-only and reads config items from the active release payload via the existing `GET /admin/business-config/releases/:releaseNo` endpoint. No new Prisma table is created in Wave 4 — projection is a no-op (the release snapshot is the source of truth). A Wave 5 task can add projection to a dedicated table if the deposit/withdraw flows need direct DB queries.

**Tech Stack:** NestJS 10 + TypeScript 5 + Prisma 6 (no schema changes) · React 18 + Vite

---

## File Map

| Action | Path |
|--------|------|
| Modify | `src/modules/governance/business-config/business-config.types.ts` |
| Create | `src/config/manifests/asset-config.manifest.ts` |
| Modify | `src/modules/governance/business-config/business-config.service.ts` |
| Modify | `admin-web/src/pages/BusinessConfigReleasesPage.tsx` |
| Create | `admin-web/src/pages/AssetConfigList.tsx` |
| Modify | `admin-web/src/App.tsx` |
| Modify | `admin-web/src/components/DashboardLayout.tsx` |

---

## Task 1: Add ASSET_CONFIG to the subject type enum

**Files:**
- Modify: `src/modules/governance/business-config/business-config.types.ts`

- [ ] **Step 1: Add `'ASSET_CONFIG'` to the constant array**

Open `src/modules/governance/business-config/business-config.types.ts`.

Current content (lines 1-7):
```typescript
export const BUSINESS_CONFIG_SUBJECT_TYPES = [
  'COA',
  'ACCT_EVENT',
  'JOURNAL_TEMPLATE',
  'CLEARING_TEMPLATE',
  'PRICING_POLICY',
] as const;
```

Replace with:
```typescript
export const BUSINESS_CONFIG_SUBJECT_TYPES = [
  'COA',
  'ACCT_EVENT',
  'JOURNAL_TEMPLATE',
  'CLEARING_TEMPLATE',
  'PRICING_POLICY',
  'ASSET_CONFIG',
] as const;
```

No other changes needed in this file.

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd Exchange_js && npx tsc --noEmit 2>&1 | head -20
```

Expected: no new errors from this file.

- [ ] **Step 3: Commit**

```bash
git add Exchange_js/src/modules/governance/business-config/business-config.types.ts
git commit -m "feat(business-config): add ASSET_CONFIG to subject type enum"
```

---

## Task 2: Create the AssetConfig manifest file

**Files:**
- Create: `src/config/manifests/asset-config.manifest.ts`

- [ ] **Step 1: Create the manifest**

```typescript
// src/config/manifests/asset-config.manifest.ts

export type AssetConfigManifestItem = {
  assetNo: string;
  code: string;
  type: 'FIAT' | 'CRYPTO';
  network: string;
  depositEnabled: boolean;
  withdrawEnabled: boolean;
  depositMinAmount: string;
  depositMaxAmount: string | null;
  withdrawMinAmount: string;
  withdrawMaxAmount: string | null;
  networkFeeBuffer: string | null; // null for FIAT
};

export const DEFAULT_ASSET_CONFIGS: AssetConfigManifestItem[] = [
  {
    assetNo: 'AS_AED',
    code: 'AED',
    type: 'FIAT',
    network: '',
    depositEnabled: true,
    withdrawEnabled: true,
    depositMinAmount: '100',
    depositMaxAmount: null,
    withdrawMinAmount: '100',
    withdrawMaxAmount: null,
    networkFeeBuffer: null,
  },
  {
    assetNo: 'AS_USDT_TRON',
    code: 'USDT',
    type: 'CRYPTO',
    network: 'TRON',
    depositEnabled: true,
    withdrawEnabled: true,
    depositMinAmount: '10',
    depositMaxAmount: null,
    withdrawMinAmount: '10',
    withdrawMaxAmount: null,
    networkFeeBuffer: '2',
  },
  {
    assetNo: 'AS_BTC',
    code: 'BTC',
    type: 'CRYPTO',
    network: 'BITCOIN',
    depositEnabled: true,
    withdrawEnabled: true,
    depositMinAmount: '0.001',
    depositMaxAmount: null,
    withdrawMinAmount: '0.001',
    withdrawMaxAmount: null,
    networkFeeBuffer: '0.00005',
  },
];
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd Exchange_js && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors from the new file.

- [ ] **Step 3: Commit**

```bash
git add Exchange_js/src/config/manifests/asset-config.manifest.ts
git commit -m "feat(business-config): add AssetConfig manifest with default configs for AED, USDT-TRON, BTC"
```

---

## Task 3: Wire ASSET_CONFIG into the backend service

**Files:**
- Modify: `src/modules/governance/business-config/business-config.service.ts`

This task adds 5 changes to the service file:
1. Import the new manifest
2. Add `AssetConfigManifestPayload` type and union it into `ManifestPayload`
3. Add `normalizeSubjectType` alias for `ASSET_CONFIG`
4. Add ASSET_CONFIG case to `getManifestEntries()`
5. Add `validateAssetConfigRelease()` private method
6. Add `projectAssetConfig()` private method (no-op)
7. Add ASSET_CONFIG branch to `validateReleaseItems()` dispatch
8. Add ASSET_CONFIG branch to `publishRelease()` dispatch

- [ ] **Step 1: Add import at top of service (after PricingCenter import, ~line 22)**

Find this block in the imports:
```typescript
import {
  buildDefaultPricingPolicyManifest,
  PricingPolicyManifestAsset,
  PricingPolicyManifestItem,
} from '../../../config/manifests/pricing-policies.manifest';
```

Add immediately after it:
```typescript
import {
  AssetConfigManifestItem,
  DEFAULT_ASSET_CONFIGS,
} from '../../../config/manifests/asset-config.manifest';
```

- [ ] **Step 2: Add `AssetConfigManifestPayload` type and add it to the `ManifestPayload` union (~line 121)**

Find:
```typescript
type PricingPolicyManifestPayload = PricingPolicyManifestItem;
type ManifestPayload =
  | CoaManifestPayload
  | AcctEventManifestPayload
  | JournalTemplateManifestPayload
  | ClearingTemplateManifestPayload
  | PricingPolicyManifestPayload;
```

Replace with:
```typescript
type PricingPolicyManifestPayload = PricingPolicyManifestItem;
type AssetConfigManifestPayload = AssetConfigManifestItem;
type ManifestPayload =
  | CoaManifestPayload
  | AcctEventManifestPayload
  | JournalTemplateManifestPayload
  | ClearingTemplateManifestPayload
  | PricingPolicyManifestPayload
  | AssetConfigManifestPayload;
```

- [ ] **Step 3: Add `ASSET_CONFIG` alias to `normalizeSubjectType()` (~line 176)**

Find the `default` case in the switch:
```typescript
      case 'PRICING_POLICY':
      case 'PRICINGPOLICY':
      case 'PRICING':
        return 'PRICING_POLICY';
      default:
        throw new BadRequestException(`Unsupported business config subjectType: ${input}`);
```

Replace with:
```typescript
      case 'PRICING_POLICY':
      case 'PRICINGPOLICY':
      case 'PRICING':
        return 'PRICING_POLICY';
      case 'ASSET_CONFIG':
      case 'ASSETCONFIG':
        return 'ASSET_CONFIG';
      default:
        throw new BadRequestException(`Unsupported business config subjectType: ${input}`);
```

- [ ] **Step 4: Add ASSET_CONFIG case to `getManifestEntries()` (~line 294)**

Find:
```typescript
    if (subjectType === 'PRICING_POLICY') {
      return this.getPricingManifestEntries();
    }

    throw new BadRequestException(`Unsupported subjectType: ${subjectType}`);
```

Replace with:
```typescript
    if (subjectType === 'PRICING_POLICY') {
      return this.getPricingManifestEntries();
    }

    if (subjectType === 'ASSET_CONFIG') {
      return DEFAULT_ASSET_CONFIGS.map((item) => ({
        businessKey: item.assetNo,
        payload: item,
      })).sort((left, right) => left.businessKey.localeCompare(right.businessKey));
    }

    throw new BadRequestException(`Unsupported subjectType: ${subjectType}`);
```

- [ ] **Step 5: Add `validateAssetConfigRelease()` private method**

Add this method immediately before `validateReleaseItems()` (~line 707). Find the method:
```typescript
  private async validateReleaseItems(
```

Insert before it:
```typescript
  private async validateAssetConfigRelease(
    items: Array<ParsedReleaseItem<AssetConfigManifestPayload>>,
  ): Promise<string[]> {
    const issues: string[] = [];
    const activeAssets = await this.prisma.asset.findMany({
      where: { status: 'ACTIVE' },
      select: { assetNo: true },
    });
    const activeAssetNos = new Set(activeAssets.map((a) => a.assetNo));

    for (const item of items) {
      const payload = item.payload;
      if (!payload.assetNo || !payload.code || !payload.type) {
        issues.push(`AssetConfig ${item.businessKey} requires assetNo, code, and type`);
        continue;
      }
      if (!activeAssetNos.has(String(payload.assetNo))) {
        issues.push(`AssetConfig ${item.businessKey} references unknown or inactive asset: ${payload.assetNo}`);
      }
      const minDeposit = Number(payload.depositMinAmount || 0);
      if (isNaN(minDeposit) || minDeposit < 0) {
        issues.push(`AssetConfig ${item.businessKey} depositMinAmount must be a non-negative number`);
      }
      const minWithdraw = Number(payload.withdrawMinAmount || 0);
      if (isNaN(minWithdraw) || minWithdraw < 0) {
        issues.push(`AssetConfig ${item.businessKey} withdrawMinAmount must be a non-negative number`);
      }
    }
    return issues;
  }

```

- [ ] **Step 6: Add ASSET_CONFIG branch to `validateReleaseItems()` dispatch (~line 750)**

Find:
```typescript
    } else if (subjectType === 'PRICING_POLICY') {
      issues.push(
        ...(await this.validatePricingPolicyRelease(
          items as Array<ParsedReleaseItem<PricingPolicyManifestPayload>>,
        )),
      );
    }

    return {
```

Replace with:
```typescript
    } else if (subjectType === 'PRICING_POLICY') {
      issues.push(
        ...(await this.validatePricingPolicyRelease(
          items as Array<ParsedReleaseItem<PricingPolicyManifestPayload>>,
        )),
      );
    } else if (subjectType === 'ASSET_CONFIG') {
      issues.push(
        ...(await this.validateAssetConfigRelease(
          items as Array<ParsedReleaseItem<AssetConfigManifestPayload>>,
        )),
      );
    }

    return {
```

- [ ] **Step 7: Add `projectAssetConfig()` private method (no-op)**

Add this method immediately before `projectPricingPolicies()` (~line 988). Find:
```typescript
  private async projectPricingPolicies(
```

Insert before it:
```typescript
  // Wave 4: no-op projection — ASSET_CONFIG release snapshot is the source of truth.
  // Wave 5 will add projection to a dedicated table when deposit/withdraw flows need DB queries.
  private async projectAssetConfig(
    _tx: GovernanceClient,
    _items: Array<ParsedReleaseItem<AssetConfigManifestPayload>>,
  ): Promise<void> {
    // no-op
  }

```

- [ ] **Step 8: Add ASSET_CONFIG branch to `publishRelease()` dispatch (~line 1324)**

Find:
```typescript
      } else if (subjectType === 'PRICING_POLICY') {
        await this.projectPricingPolicies(
          tx,
          items as Array<ParsedReleaseItem<PricingPolicyManifestPayload>>,
        );
      }

      await tx.businessConfigRelease.updateMany({
```

Replace with:
```typescript
      } else if (subjectType === 'PRICING_POLICY') {
        await this.projectPricingPolicies(
          tx,
          items as Array<ParsedReleaseItem<PricingPolicyManifestPayload>>,
        );
      } else if (subjectType === 'ASSET_CONFIG') {
        await this.projectAssetConfig(
          tx,
          items as Array<ParsedReleaseItem<AssetConfigManifestPayload>>,
        );
      }

      await tx.businessConfigRelease.updateMany({
```

- [ ] **Step 9: Verify TypeScript compiles**

```bash
cd Exchange_js && npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 10: Run the existing business-config tests**

```bash
cd Exchange_js && npx jest --testPathPattern="business-config" --no-coverage 2>&1 | tail -20
```

Expected: all tests pass (new code paths are not covered yet, no regressions).

- [ ] **Step 11: Commit**

```bash
git add Exchange_js/src/modules/governance/business-config/business-config.service.ts
git commit -m "feat(business-config): wire ASSET_CONFIG into service — manifest, validate, project, dispatch"
```

---

## Task 4: Add ASSET_CONFIG to BusinessConfigReleasesPage filter

**Files:**
- Modify: `admin-web/src/pages/BusinessConfigReleasesPage.tsx`

- [ ] **Step 1: Add `'ASSET_CONFIG'` to `SUBJECT_OPTIONS`**

Find (~line 65):
```typescript
const SUBJECT_OPTIONS = [
  '',
  'COA',
  'ACCT_EVENT',
  'JOURNAL_TEMPLATE',
  'CLEARING_TEMPLATE',
  'PRICING_POLICY',
];
```

Replace with:
```typescript
const SUBJECT_OPTIONS = [
  '',
  'COA',
  'ACCT_EVENT',
  'JOURNAL_TEMPLATE',
  'CLEARING_TEMPLATE',
  'PRICING_POLICY',
  'ASSET_CONFIG',
];
```

- [ ] **Step 2: Commit**

```bash
git add Exchange_js/admin-web/src/pages/BusinessConfigReleasesPage.tsx
git commit -m "feat(admin-ui): add ASSET_CONFIG to BusinessConfigReleasesPage subject filter"
```

---

## Task 5: Create AssetConfigList admin page

**Files:**
- Create: `admin-web/src/pages/AssetConfigList.tsx`

The page reads the ACTIVE ASSET_CONFIG release via two API calls:
1. `GET /admin/business-config/releases?subjectType=ASSET_CONFIG&status=ACTIVE&take=1` → get releaseNo
2. `GET /admin/business-config/releases/:releaseNo` → get release with items (each item has `payload` = parsed `AssetConfigManifestItem`)

- [ ] **Step 1: Create the page file**

```typescript
// admin-web/src/pages/AssetConfigList.tsx
import { useEffect, useState } from 'react';
import { RefreshCw, Settings } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {
  BUSINESS_CONFIG_RELEASES_PATH,
  showBusinessConfigReadOnlyAlert,
} from '../utils/businessConfigReadOnly';
import { adminFetch, getApiErrorMessage } from '../utils/adminFetch';
import { adminButtonClass, adminIconButtonClass } from '../components/common/adminButtonStyles';

interface AssetConfigItem {
  businessKey: string;
  code: string;
  type: string;
  network: string;
  depositEnabled: boolean;
  withdrawEnabled: boolean;
  depositMinAmount: string;
  depositMaxAmount: string | null;
  withdrawMinAmount: string;
  withdrawMaxAmount: string | null;
  networkFeeBuffer: string | null;
}

const renderBool = (v: boolean) => (
  <span
    className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
      v ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
    }`}
  >
    {v ? 'Yes' : 'No'}
  </span>
);

const AssetConfigList = () => {
  const navigate = useNavigate();
  const [items, setItems] = useState<AssetConfigItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeReleaseNo, setActiveReleaseNo] = useState<string | null>(null);

  const fetchItems = async () => {
    setLoading(true);
    setError('');
    try {
      // Step 1: find active ASSET_CONFIG release
      const listRes = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/business-config/releases?subjectType=ASSET_CONFIG&status=ACTIVE&take=1`,
      );
      if (!listRes.ok) {
        setError(await getApiErrorMessage(listRes, 'Failed to fetch asset config releases.'));
        return;
      }
      const listData = await listRes.json();
      const firstRelease = listData?.items?.[0];
      if (!firstRelease?.releaseNo) {
        setItems([]);
        setActiveReleaseNo(null);
        return;
      }
      setActiveReleaseNo(firstRelease.releaseNo);

      // Step 2: fetch release detail with items
      const detailRes = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/business-config/releases/${firstRelease.releaseNo}`,
      );
      if (!detailRes.ok) {
        setError(await getApiErrorMessage(detailRes, 'Failed to fetch asset config details.'));
        return;
      }
      const detail = await detailRes.json();
      const parsed: AssetConfigItem[] = (detail?.items ?? []).map(
        (item: { businessKey: string; payload: Record<string, unknown> }) => ({
          businessKey: item.businessKey,
          code: String(item.payload.code ?? ''),
          type: String(item.payload.type ?? ''),
          network: String(item.payload.network ?? ''),
          depositEnabled: item.payload.depositEnabled === true,
          withdrawEnabled: item.payload.withdrawEnabled === true,
          depositMinAmount: String(item.payload.depositMinAmount ?? ''),
          depositMaxAmount:
            item.payload.depositMaxAmount != null
              ? String(item.payload.depositMaxAmount)
              : null,
          withdrawMinAmount: String(item.payload.withdrawMinAmount ?? ''),
          withdrawMaxAmount:
            item.payload.withdrawMaxAmount != null
              ? String(item.payload.withdrawMaxAmount)
              : null,
          networkFeeBuffer:
            item.payload.networkFeeBuffer != null
              ? String(item.payload.networkFeeBuffer)
              : null,
        }),
      );
      setItems(parsed);
    } catch (err) {
      console.error('Failed to fetch AssetConfig', err);
      setError('Failed to fetch asset config.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchItems();
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Asset Operational Config</h1>
          <p className="text-sm text-gray-500 mt-1">
            Per-asset deposit / withdrawal parameters managed by config-as-code
          </p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => navigate(BUSINESS_CONFIG_RELEASES_PATH)}
            className={adminButtonClass('listSecondary')}
          >
            <Settings size={20} />
            <span>Open Release Center</span>
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
        Asset operational config is managed by config-as-code and Business Config Releases. This
        page shows the current ACTIVE release snapshot and is read-only.
        {activeReleaseNo && (
          <span className="ml-2 font-mono font-semibold">(Release: {activeReleaseNo})</span>
        )}
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-admin-border overflow-hidden">
        <div className="p-4 border-b border-admin-border flex justify-end">
          <button onClick={fetchItems} className={adminIconButtonClass()}>
            <RefreshCw size={20} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-admin-content-bg border-b border-admin-border">
              <tr>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider">Asset No</th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider">Code</th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider">Type</th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider">Network</th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider">Deposit</th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider">Withdraw</th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider">Dep. Min</th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider">Dep. Max</th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider">Wtd. Min</th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider">Wtd. Max</th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider">Fee Buffer</th>
                <th className="px-6 py-3 font-medium text-gray-500 uppercase tracking-wider text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-admin-border">
              {error ? (
                <tr>
                  <td colSpan={12} className="px-6 py-12 text-center text-rose-600">
                    {error}
                  </td>
                </tr>
              ) : null}
              {!error && loading ? (
                <tr>
                  <td colSpan={12} className="px-6 py-12 text-center text-gray-500">
                    <div className="flex flex-col items-center justify-center">
                      <RefreshCw className="animate-spin mb-2 text-brand-primary" size={24} />
                      Loading asset config...
                    </div>
                  </td>
                </tr>
              ) : !error && items.length === 0 ? (
                <tr>
                  <td colSpan={12} className="px-6 py-12 text-center text-gray-500">
                    No active ASSET_CONFIG release found. Run{' '}
                    <span className="font-mono text-xs bg-gray-100 px-1 rounded">
                      npm run config:stage -- --subject ASSET_CONFIG
                    </span>{' '}
                    to stage the first release.
                  </td>
                </tr>
              ) : (
                items.map((item) => (
                  <tr key={item.businessKey} className="hover:bg-gray-50 transition-colors">
                    <td className="px-6 py-4 font-mono font-medium text-gray-900">{item.businessKey}</td>
                    <td className="px-6 py-4 font-mono font-medium text-gray-900">{item.code}</td>
                    <td className="px-6 py-4">
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-800">
                        {item.type}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-gray-600">{item.network || '—'}</td>
                    <td className="px-6 py-4">{renderBool(item.depositEnabled)}</td>
                    <td className="px-6 py-4">{renderBool(item.withdrawEnabled)}</td>
                    <td className="px-6 py-4 font-mono">{item.depositMinAmount}</td>
                    <td className="px-6 py-4 font-mono">{item.depositMaxAmount ?? '—'}</td>
                    <td className="px-6 py-4 font-mono">{item.withdrawMinAmount}</td>
                    <td className="px-6 py-4 font-mono">{item.withdrawMaxAmount ?? '—'}</td>
                    <td className="px-6 py-4 font-mono">{item.networkFeeBuffer ?? '—'}</td>
                    <td className="px-6 py-4 text-right">
                      <button
                        className={adminButtonClass('rowSecondaryUtility')}
                        onClick={() => showBusinessConfigReadOnlyAlert('ASSET_CONFIG')}
                      >
                        Read-only
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default AssetConfigList;
```

- [ ] **Step 2: Verify TypeScript compiles (frontend)**

```bash
cd Exchange_js/admin-web && npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors in the new file.

- [ ] **Step 3: Commit**

```bash
git add Exchange_js/admin-web/src/pages/AssetConfigList.tsx
git commit -m "feat(admin-ui): add AssetConfigList page reading from active ASSET_CONFIG release"
```

---

## Task 6: Add route and nav link

**Files:**
- Modify: `admin-web/src/App.tsx`
- Modify: `admin-web/src/components/DashboardLayout.tsx`

- [ ] **Step 1: Add lazy import in App.tsx (after `CoaList` import, ~line 47)**

Find:
```typescript
const CoaList = lazy(() => import('./pages/CoaList'));
```

Add immediately after:
```typescript
const AssetConfigList = lazy(() => import('./pages/AssetConfigList'));
```

- [ ] **Step 2: Add route in App.tsx (after `system/assets/create` route, ~line 830)**

Find:
```typescript
            <Route
              path="system/assets/create"
              element={withPermission(<AssetCreate />, [PERMISSIONS.ASSETS_CREATE])}
            />
            <Route
              path="system/acct-events"
```

Replace with:
```typescript
            <Route
              path="system/assets/create"
              element={withPermission(<AssetCreate />, [PERMISSIONS.ASSETS_CREATE])}
            />
            <Route
              path="system/asset-configs"
              element={withPermission(<AssetConfigList />, [PERMISSIONS.ASSETS_READ])}
            />
            <Route
              path="system/acct-events"
```

- [ ] **Step 3: Add nav item in DashboardLayout.tsx**

Find the "Infrastructure Domain" section (~line 444). The current first child is "Assets Config" → `/dashboard/system/assets`. Add "Asset Operational Config" immediately after it:

Find:
```typescript
        {
          path: '/dashboard/system/assets',
          label: 'Assets Config',
          icon: <Coins size={13} />,
          requiredPermissions: [PERMISSIONS.ASSETS_READ],
        },
        {
          path: '/ledger/coa',
```

Replace with:
```typescript
        {
          path: '/dashboard/system/assets',
          label: 'Assets Config',
          icon: <Coins size={13} />,
          requiredPermissions: [PERMISSIONS.ASSETS_READ],
        },
        {
          path: '/dashboard/system/asset-configs',
          label: 'Asset Operational Config',
          icon: <Settings size={13} />,
          requiredPermissions: [PERMISSIONS.ASSETS_READ],
        },
        {
          path: '/ledger/coa',
```

Note: `Settings` is already imported from lucide-react in `DashboardLayout.tsx` (check imports — if not present, add it to the import list alongside the other icons at the top of the file).

- [ ] **Step 4: Verify Settings icon import in DashboardLayout.tsx**

Check line 1-37 of `DashboardLayout.tsx`. If `Settings` is not in the lucide-react import, add it:

```typescript
import {
  // ... existing icons ...
  Settings,
} from 'lucide-react';
```

- [ ] **Step 5: Verify TypeScript compiles (frontend)**

```bash
cd Exchange_js/admin-web && npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add Exchange_js/admin-web/src/App.tsx Exchange_js/admin-web/src/components/DashboardLayout.tsx
git commit -m "feat(admin-ui): add system/asset-configs route and nav entry for AssetConfigList"
```

---

## Task 7: Smoke test end-to-end

- [ ] **Step 1: Start the stack**

```bash
cd Exchange_js && npm run dev:start
```

- [ ] **Step 2: Stage the ASSET_CONFIG release**

```bash
cd Exchange_js && npx ts-node -r tsconfig-paths/register scripts/config-release-stage.ts --subject ASSET_CONFIG
```

Expected output: JSON with `"subjectType": "ASSET_CONFIG"`, `"status": "DRAFT"`, `"itemCount": 3`.

Note the `releaseNo` (e.g., `ASSET_CONFIG-REL-001`).

- [ ] **Step 3: Validate the release**

```bash
cd Exchange_js && npx ts-node -r tsconfig-paths/register scripts/config-release-validate.ts --releaseNo ASSET_CONFIG-REL-001
```

Expected: `"ok": true`, no issues.

- [ ] **Step 4: Check the Release Center UI**

Open admin UI at http://localhost:3502 → Login → System → Business Config Releases.
Filter by Subject: `ASSET_CONFIG`. Verify the DRAFT release appears with 3 items.

- [ ] **Step 5: Check AssetConfigList UI (before publish)**

Navigate to System → Asset Operational Config.
Expected: empty state message with hint to run `config:stage`.

Wait — the release was staged (DRAFT) but not published (ACTIVE). Expected message: "No active ASSET_CONFIG release found."

- [ ] **Step 6: Publish the release (needs a READY change ticket)**

If a READY change ticket exists (e.g., `CT-001`):
```bash
cd Exchange_js && npx ts-node -r tsconfig-paths/register scripts/config-release-publish.ts --releaseNo ASSET_CONFIG-REL-001 --changeTicketRef CT-001
```

Or create one via the admin UI first.

Expected after publish: release status `ACTIVE`.

- [ ] **Step 7: Verify AssetConfigList shows data**

Refresh the Asset Operational Config page.
Expected: 3 rows — AS_AED (AED/FIAT), AS_USDT_TRON (USDT/TRON/CRYPTO), AS_BTC (BTC/BITCOIN/CRYPTO).
Each row shows depositEnabled, withdrawEnabled, min amounts, networkFeeBuffer.

- [ ] **Step 8: Commit (no code change — smoke test only)**

```bash
# no commit needed for smoke test
```

---

## Self-Review

**Spec coverage check:**
- [x] `ASSET_CONFIG` added to types enum → Task 1
- [x] Manifest file with 3 default assets → Task 2
- [x] `normalizeSubjectType` alias → Task 3 Step 3
- [x] `getManifestEntries` dispatch → Task 3 Step 4
- [x] `validateAssetConfigRelease` (checks asset existence, non-negative amounts) → Task 3 Step 5
- [x] `validateReleaseItems` dispatch → Task 3 Step 6
- [x] `projectAssetConfig` no-op → Task 3 Step 7
- [x] `publishRelease` dispatch → Task 3 Step 8
- [x] `BusinessConfigReleasesPage` SUBJECT_OPTIONS → Task 4
- [x] `AssetConfigList` page (reads from release API) → Task 5
- [x] Route `system/asset-configs` → Task 6
- [x] Nav link "Asset Operational Config" → Task 6

**Gaps:** None identified.

**Placeholder scan:** All code steps show complete, runnable code.

**Type consistency:** `AssetConfigManifestItem` in manifest matches `AssetConfigManifestPayload` alias in service; `AssetConfigItem` interface in UI matches fields in manifest.
