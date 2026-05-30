# Withdrawal Fee Level Admin Pages — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build two admin-web React pages (List + Detail) for the Withdrawal Fee Level feature, enabling operators to browse, create, change, and bind/unbind customers to fee levels. The backend API is already complete.

**Architecture:** Two-page pattern mirroring TransactionLimitList / TransactionLimitDetail. List page has filters, a data table, and a Create Modal with an inline Tier Editor. Detail page has a hero section, tier cards, customer bindings table, and a sidebar with actions (Edit Tiers / Bind Customer). Shared Tier Editor component used by both Create and Change modals.

**Tech Stack:** React 18, react-router-dom, Lucide icons, Tailwind CSS (admin design system classes `adm-*`), adminFetch utility, existing shared components (PageTitleBar, AdminBadge, DetailPageHeader, InfoField, Pagination).

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `admin-web/src/rbac/permissions.ts` | Add `WITHDRAWAL_FEE_LEVELS_READ` permission constant |
| Modify | `admin-web/src/App.tsx` | Register two lazy routes under `pricing/` |
| Modify | `admin-web/src/components/DashboardLayout.tsx` | Add nav entry in Pricing group |
| Create | `admin-web/src/components/pricing/TierEditor.tsx` | Shared structured tier editor component |
| Create | `admin-web/src/pages/WithdrawalFeeLevelList.tsx` | List page + Create Modal |
| Create | `admin-web/src/pages/WithdrawalFeeLevelDetail.tsx` | Detail page + Change Modal + Bind Modal + Unbind |

---

### Task 1: Permission Constant + Route Registration + Navigation

**Files:**
- Modify: `admin-web/src/rbac/permissions.ts`
- Modify: `admin-web/src/App.tsx`
- Modify: `admin-web/src/components/DashboardLayout.tsx`

- [ ] **Step 1: Add permission constant**

In `admin-web/src/rbac/permissions.ts`, add after the `WITHDRAWAL_ADDRESS_SKIP_COOLING` line (before `} as const`):

```typescript
  WITHDRAWAL_FEE_LEVELS_READ: 'api.get.admin_withdrawal_fee_levels',
```

- [ ] **Step 2: Add lazy imports in App.tsx**

In `admin-web/src/App.tsx`, add after the `TransactionLimitDetail` lazy import (line 125):

```typescript
const WithdrawalFeeLevelList = lazy(() => import('./pages/WithdrawalFeeLevelList'));
const WithdrawalFeeLevelDetail = lazy(() => import('./pages/WithdrawalFeeLevelDetail'));
```

- [ ] **Step 3: Add routes in App.tsx**

In `admin-web/src/App.tsx`, add after the `system/transaction-limits/:policyNo` route block (around line 831):

```typescript
            <Route
              path="pricing/withdrawal-fee-levels"
              element={withPermission(<WithdrawalFeeLevelList />, [PERMISSIONS.WITHDRAWAL_FEE_LEVELS_READ])}
            />
            <Route
              path="pricing/withdrawal-fee-levels/:levelCode"
              element={withPermission(<WithdrawalFeeLevelDetail />, [PERMISSIONS.WITHDRAWAL_FEE_LEVELS_READ])}
            />
```

- [ ] **Step 4: Add navigation entry in DashboardLayout.tsx**

In `admin-web/src/components/DashboardLayout.tsx`, add a new entry inside the Pricing group's `children` array, after the Quote Center entry (around line 417):

```typescript
        {
          path: '/dashboard/pricing/withdrawal-fee-levels',
          label: 'Withdrawal Fee Levels',
          icon: <Layers size={13} />,
          requiredPermissions: [PERMISSIONS.WITHDRAWAL_FEE_LEVELS_READ],
        },
```

- [ ] **Step 5: Verify compilation**

Run: `cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/admin-web && npx tsc --noEmit 2>&1 | head -20`

Expected: No errors (the new pages don't exist yet so the lazy imports will fail at runtime, but tsc won't error on dynamic imports of non-existent modules — verify this).

If TypeScript errors occur on the lazy imports, create placeholder files first:

```typescript
// admin-web/src/pages/WithdrawalFeeLevelList.tsx
export default function WithdrawalFeeLevelList() { return <div>TODO</div>; }

// admin-web/src/pages/WithdrawalFeeLevelDetail.tsx
export default function WithdrawalFeeLevelDetail() { return <div>TODO</div>; }
```

- [ ] **Step 6: Commit**

```bash
git add admin-web/src/rbac/permissions.ts admin-web/src/App.tsx admin-web/src/components/DashboardLayout.tsx
git commit -m "feat(admin): register withdrawal fee level routes, nav, and permission constant"
```

---

### Task 2: Tier Editor Component

**Files:**
- Create: `admin-web/src/components/pricing/TierEditor.tsx`

This shared component is used by both the Create Modal (Task 3) and the Change Modal (Task 5). Build it first so both modals can import it.

- [ ] **Step 1: Create the pricing directory if needed**

Run: `mkdir -p admin-web/src/components/pricing`

- [ ] **Step 2: Create TierEditor.tsx**

Create `admin-web/src/components/pricing/TierEditor.tsx`:

```typescript
import { Plus, Trash2 } from 'lucide-react';
import { adminButtonClass } from '../common/adminButtonStyles';

/* ── Types ─────────────────────────────────────────────────── */

export interface FeeItemState {
  id: string;
  itemCode: string;
  calcType: string;
  value: string;
  currency: string;
  min: string;
  cap: string;
  roundingDp: number;
  roundingMode: string;
}

export interface TierState {
  id: string;
  name: string;
  priority: number;
  enabled: boolean;
  amountMin: string;
  amountMax: string;
  feeItems: FeeItemState[];
}

/* ── Defaults ──────────────────────────────────────────────── */

const ITEM_CODES = ['WITHDRAW_SERVICE_FEE', 'NETWORK_FEE_EST'] as const;
const CALC_TYPES = ['FLAT', 'PERCENT', 'PERCENT_WITH_MIN'] as const;
const ROUNDING_MODES = ['ROUND', 'CEIL', 'FLOOR'] as const;

const newFeeItem = (tierId: string, index: number): FeeItemState => ({
  id: `${tierId}-FEE-${index + 1}`,
  itemCode: ITEM_CODES[0],
  calcType: 'FLAT',
  value: '0',
  currency: '',
  min: '',
  cap: '',
  roundingDp: 6,
  roundingMode: 'ROUND',
});

export const newTier = (index: number): TierState => {
  const tierId = `TIER-${index + 1}`;
  return {
    id: tierId,
    name: index === 0 ? 'Default Tier' : `Tier ${index + 1}`,
    priority: index + 1,
    enabled: true,
    amountMin: '0',
    amountMax: '',
    feeItems: [newFeeItem(tierId, 0)],
  };
};

/* ── Serialization ─────────────────────────────────────────── */

export function serializeTiers(tiers: TierState[]): string {
  return JSON.stringify({
    tiers: tiers.map((t, ti) => ({
      id: t.id || `TIER-${ti + 1}`,
      name: t.name,
      priority: t.priority,
      enabled: t.enabled,
      conditions: {
        amountMin: t.amountMin ? Number(t.amountMin) : 0,
        amountMax: t.amountMax ? Number(t.amountMax) : null,
      },
      feeItems: t.feeItems.map((f, fi) => ({
        id: f.id || `TIER-${ti + 1}-FEE-${fi + 1}`,
        itemCode: f.itemCode,
        calcType: f.calcType,
        value: String(f.value),
        currency: f.currency,
        min: f.min ? String(f.min) : null,
        cap: f.cap ? String(f.cap) : null,
        roundingDp: f.roundingDp,
        roundingMode: f.roundingMode,
        adjustable: false,
      })),
    })),
  });
}

export function parseTiersJson(json: string): TierState[] {
  try {
    const parsed = JSON.parse(json) as {
      tiers: Array<{
        id: string;
        name: string;
        priority: number;
        enabled: boolean;
        conditions: { amountMin: number; amountMax: number | null };
        feeItems: Array<{
          id: string;
          itemCode: string;
          calcType: string;
          value: string;
          currency: string;
          min: string | null;
          cap: string | null;
          roundingDp: number;
          roundingMode: string;
        }>;
      }>;
    };
    return parsed.tiers.map((t) => ({
      id: t.id,
      name: t.name,
      priority: t.priority,
      enabled: t.enabled,
      amountMin: String(t.conditions.amountMin ?? 0),
      amountMax: t.conditions.amountMax != null ? String(t.conditions.amountMax) : '',
      feeItems: t.feeItems.map((f) => ({
        id: f.id,
        itemCode: f.itemCode,
        calcType: f.calcType,
        value: String(f.value),
        currency: f.currency,
        min: f.min ? String(f.min) : '',
        cap: f.cap ? String(f.cap) : '',
        roundingDp: f.roundingDp ?? 6,
        roundingMode: f.roundingMode ?? 'ROUND',
      })),
    }));
  } catch {
    return [newTier(0)];
  }
}

/* ── Input style ───────────────────────────────────────────── */

const fi =
  'h-[28px] rounded border border-adm-border bg-adm-bg px-2 font-mono text-[11px] text-adm-t1 placeholder:text-adm-t3 outline-none focus:border-adm-amber transition-colors';

/* ── Component ─────────────────────────────────────────────── */

interface TierEditorProps {
  tiers: TierState[];
  onChange: (tiers: TierState[]) => void;
  /** Default currency to pre-fill on new fee items (e.g. from selected asset) */
  defaultCurrency?: string;
}

export default function TierEditor({ tiers, onChange, defaultCurrency = '' }: TierEditorProps) {
  const updateTier = (idx: number, patch: Partial<TierState>) => {
    const next = tiers.map((t, i) => (i === idx ? { ...t, ...patch } : t));
    onChange(next);
  };

  const updateFeeItem = (tierIdx: number, feeIdx: number, patch: Partial<FeeItemState>) => {
    const next = tiers.map((t, ti) =>
      ti === tierIdx
        ? {
            ...t,
            feeItems: t.feeItems.map((f, fi) =>
              fi === feeIdx ? { ...f, ...patch } : f,
            ),
          }
        : t,
    );
    onChange(next);
  };

  const addFeeItem = (tierIdx: number) => {
    const tier = tiers[tierIdx];
    const item = newFeeItem(tier.id, tier.feeItems.length);
    if (defaultCurrency) item.currency = defaultCurrency;
    updateTier(tierIdx, { feeItems: [...tier.feeItems, item] });
  };

  const removeFeeItem = (tierIdx: number, feeIdx: number) => {
    const tier = tiers[tierIdx];
    if (tier.feeItems.length <= 1) return;
    updateTier(tierIdx, {
      feeItems: tier.feeItems.filter((_, i) => i !== feeIdx),
    });
  };

  const addTier = () => {
    const t = newTier(tiers.length);
    if (defaultCurrency) {
      t.feeItems = t.feeItems.map((f) => ({ ...f, currency: defaultCurrency }));
    }
    onChange([...tiers, t]);
  };

  const removeTier = (idx: number) => {
    if (tiers.length <= 1) return;
    onChange(tiers.filter((_, i) => i !== idx));
  };

  return (
    <div className="space-y-3">
      {tiers.map((tier, tierIdx) => (
        <div key={tier.id} className="rounded border border-adm-border bg-adm-bg p-3">
          {/* Tier header */}
          <div className="mb-2 flex items-center gap-2">
            <input
              className={`${fi} flex-1`}
              value={tier.name}
              onChange={(e) => updateTier(tierIdx, { name: e.target.value })}
              placeholder="Tier name"
            />
            <label className="flex items-center gap-1 font-mono text-[10px] text-adm-t3">
              Pri:
              <input
                type="number"
                className={`${fi} w-[50px]`}
                value={tier.priority}
                onChange={(e) =>
                  updateTier(tierIdx, { priority: parseInt(e.target.value) || 1 })
                }
              />
            </label>
            <label className="flex items-center gap-1 font-mono text-[10px] text-adm-t3">
              <input
                type="checkbox"
                checked={tier.enabled}
                onChange={(e) => updateTier(tierIdx, { enabled: e.target.checked })}
              />
              Enabled
            </label>
          </div>

          {/* Amount range */}
          <div className="mb-2 flex items-center gap-2">
            <label className="font-mono text-[10px] text-adm-t3">Range:</label>
            <input
              type="number"
              className={`${fi} w-[80px]`}
              value={tier.amountMin}
              onChange={(e) => updateTier(tierIdx, { amountMin: e.target.value })}
              placeholder="0"
            />
            <span className="text-adm-t3">—</span>
            <input
              type="number"
              className={`${fi} w-[80px]`}
              value={tier.amountMax}
              onChange={(e) => updateTier(tierIdx, { amountMax: e.target.value })}
              placeholder="No limit"
            />
          </div>

          {/* Fee items table */}
          <table className="w-full border-collapse text-[10px]">
            <thead>
              <tr className="bg-adm-panel font-mono text-[9px] uppercase tracking-wider text-adm-t3">
                <th className="px-1.5 py-1 text-left">Item Code</th>
                <th className="px-1.5 py-1 text-left">Calc Type</th>
                <th className="px-1.5 py-1 text-left">Value</th>
                <th className="px-1.5 py-1 text-left">Currency</th>
                <th className="px-1.5 py-1 text-left">Min</th>
                <th className="px-1.5 py-1 text-left">Cap</th>
                <th className="px-1.5 py-1 text-left">DP</th>
                <th className="px-1.5 py-1 text-left">Round</th>
                <th className="px-1.5 py-1 w-[28px]" />
              </tr>
            </thead>
            <tbody>
              {tier.feeItems.map((fee, feeIdx) => (
                <tr key={fee.id} className="border-t border-adm-border">
                  <td className="px-1 py-1">
                    <select
                      className={`${fi} w-full min-w-[140px]`}
                      value={fee.itemCode}
                      onChange={(e) => updateFeeItem(tierIdx, feeIdx, { itemCode: e.target.value })}
                    >
                      {ITEM_CODES.map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-1 py-1">
                    <select
                      className={`${fi} w-full min-w-[80px]`}
                      value={fee.calcType}
                      onChange={(e) => updateFeeItem(tierIdx, feeIdx, { calcType: e.target.value })}
                    >
                      {CALC_TYPES.map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-1 py-1">
                    <input
                      type="number"
                      step="any"
                      className={`${fi} w-[70px]`}
                      value={fee.value}
                      onChange={(e) => updateFeeItem(tierIdx, feeIdx, { value: e.target.value })}
                    />
                  </td>
                  <td className="px-1 py-1">
                    <input
                      className={`${fi} w-[60px]`}
                      value={fee.currency}
                      onChange={(e) => updateFeeItem(tierIdx, feeIdx, { currency: e.target.value })}
                      placeholder="USDT"
                    />
                  </td>
                  <td className="px-1 py-1">
                    <input
                      type="number"
                      step="any"
                      className={`${fi} w-[60px]`}
                      value={fee.min}
                      onChange={(e) => updateFeeItem(tierIdx, feeIdx, { min: e.target.value })}
                      placeholder="—"
                    />
                  </td>
                  <td className="px-1 py-1">
                    <input
                      type="number"
                      step="any"
                      className={`${fi} w-[60px]`}
                      value={fee.cap}
                      onChange={(e) => updateFeeItem(tierIdx, feeIdx, { cap: e.target.value })}
                      placeholder="—"
                    />
                  </td>
                  <td className="px-1 py-1">
                    <input
                      type="number"
                      className={`${fi} w-[40px]`}
                      value={fee.roundingDp}
                      onChange={(e) => updateFeeItem(tierIdx, feeIdx, { roundingDp: parseInt(e.target.value) || 0 })}
                    />
                  </td>
                  <td className="px-1 py-1">
                    <select
                      className={`${fi} w-[65px]`}
                      value={fee.roundingMode}
                      onChange={(e) => updateFeeItem(tierIdx, feeIdx, { roundingMode: e.target.value })}
                    >
                      {ROUNDING_MODES.map((m) => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-1 py-1">
                    {tier.feeItems.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeFeeItem(tierIdx, feeIdx)}
                        className="rounded p-0.5 text-adm-t3 hover:text-adm-danger"
                        title="Remove fee item"
                      >
                        <Trash2 size={11} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Tier actions */}
          <div className="mt-2 flex items-center justify-between">
            <button
              type="button"
              onClick={() => addFeeItem(tierIdx)}
              className="flex items-center gap-1 font-mono text-[10px] text-adm-amber hover:underline"
            >
              <Plus size={10} /> Add Fee Item
            </button>
            {tiers.length > 1 && (
              <button
                type="button"
                onClick={() => removeTier(tierIdx)}
                className="flex items-center gap-1 font-mono text-[10px] text-adm-danger hover:underline"
              >
                <Trash2 size={10} /> Remove Tier
              </button>
            )}
          </div>
        </div>
      ))}

      <button
        type="button"
        onClick={addTier}
        className={adminButtonClass('listSecondary')}
      >
        <Plus size={12} /> Add Tier
      </button>
    </div>
  );
}
```

- [ ] **Step 3: Verify compilation**

Run: `cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/admin-web && npx tsc --noEmit 2>&1 | head -20`

Expected: No errors related to TierEditor.tsx.

- [ ] **Step 4: Commit**

```bash
git add admin-web/src/components/pricing/TierEditor.tsx
git commit -m "feat(admin): add TierEditor component for withdrawal fee level forms"
```

---

### Task 3: WithdrawalFeeLevelList Page

**Files:**
- Create: `admin-web/src/pages/WithdrawalFeeLevelList.tsx`

Mirrors `TransactionLimitList.tsx` pattern: PageTitleBar → Filter bar → Table → Footer → Create Modal.

- [ ] **Step 1: Create WithdrawalFeeLevelList.tsx**

Create `admin-web/src/pages/WithdrawalFeeLevelList.tsx`:

```typescript
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, RefreshCw } from 'lucide-react';
import Pagination from '../components/common/Pagination';
import {
  adminButtonClass,
  adminIconButtonClass,
} from '../components/common/adminButtonStyles';
import {
  AdminSessionError,
  adminFetch,
  getApiErrorMessage,
} from '../utils/adminFetch';
import { AdminBadge } from '../components/ui/AdminBadge';
import { PageTitleBar } from '../components/ui/PageTitleBar';
import TierEditor, {
  newTier,
  serializeTiers,
  type TierState,
} from '../components/pricing/TierEditor';

/* ── Interfaces ──────────────────────────────────────────────── */

interface AssetOption {
  id: string;
  code: string;
  assetType: string;
}

interface FeeLevelItem {
  id: string;
  levelCode: string;
  name: string;
  asset: { id: string; code: string; assetType: string };
  isDefault: boolean;
  tiersJson: string;
  status: string;
  updatedAt: string;
}

interface FeeLevelListResponse {
  total: number;
  items: FeeLevelItem[];
}

interface FilterState {
  assetId: string;
  status: string;
  defaultOnly: boolean;
}

/* ── Helpers ─────────────────────────────────────────────────── */

const fmt = (v?: string | null): string => {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString();
};

const countTiers = (json: string): number => {
  try {
    return (JSON.parse(json) as { tiers: unknown[] }).tiers.length;
  } catch {
    return 0;
  }
};

/* ── Constants ───────────────────────────────────────────────── */

const PAGE_SIZE = 20;
const STATUS_OPTIONS = ['ACTIVE', 'PENDING_APPROVAL', 'REJECTED'];
const DEFAULT_FILTERS: FilterState = { assetId: '', status: '', defaultOnly: false };

/* ── Component ───────────────────────────────────────────────── */

const WithdrawalFeeLevelList = () => {
  const navigate = useNavigate();

  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [items, setItems] = useState<FeeLevelItem[]>([]);
  const [total, setTotal] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [assets, setAssets] = useState<AssetOption[]>([]);

  /* ── Create modal state ── */
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createForm, setCreateForm] = useState({
    levelCode: '',
    name: '',
    assetId: '',
    isDefault: false,
    reason: '',
  });
  const [createTiers, setCreateTiers] = useState<TierState[]>([newTier(0)]);
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const requestSeqRef = useRef(0);

  /* ── Fetch assets for filter & create ── */
  const fetchAssets = async () => {
    try {
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/assets?status=ACTIVE&take=200`,
      );
      if (res.ok) {
        const data = (await res.json()) as { items: AssetOption[] };
        if (Array.isArray(data.items)) setAssets(data.items);
      }
    } catch {
      /* ignore */
    }
  };

  /* ── Data fetching ── */
  const buildParams = (page: number, next: FilterState) => {
    const params = new URLSearchParams();
    params.set('skip', String((page - 1) * PAGE_SIZE));
    params.set('take', String(PAGE_SIZE));
    if (next.assetId) params.set('assetId', next.assetId);
    if (next.status) params.set('status', next.status);
    return params;
  };

  const fetchItems = async (page: number, next: FilterState = filters) => {
    const seq = ++requestSeqRef.current;
    setLoading(true);
    setError(null);
    try {
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/withdrawal-fee-levels?${buildParams(page, next).toString()}`,
      );
      if (!res.ok)
        throw new Error(await getApiErrorMessage(res, 'Failed to load fee levels.'));

      const data = (await res.json()) as FeeLevelListResponse;
      if (seq !== requestSeqRef.current) return;

      let list = Array.isArray(data.items) ? data.items : [];
      // Client-side default-only filter (backend has no such param)
      if (next.defaultOnly) list = list.filter((l) => l.isDefault);

      setItems(list);
      setTotal(typeof data.total === 'number' ? data.total : 0);
      setCurrentPage(page);
    } catch (err) {
      if (seq !== requestSeqRef.current) return;
      if (err instanceof AdminSessionError) return;
      setError(err instanceof Error ? err.message : 'Failed to load fee levels.');
    } finally {
      if (seq === requestSeqRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    void fetchItems(1, DEFAULT_FILTERS);
    void fetchAssets();
  }, []);

  /* ── Create modal handlers ── */
  const openCreateModal = () => {
    setCreateForm({ levelCode: '', name: '', assetId: '', isDefault: false, reason: '' });
    setCreateTiers([newTier(0)]);
    setCreateError(null);
    setShowCreateModal(true);
  };

  const closeCreateModal = () => setShowCreateModal(false);

  const handleCreateSubmit = async () => {
    if (!createForm.levelCode.trim()) {
      setCreateError('Level Code is required');
      return;
    }
    if (!createForm.name.trim()) {
      setCreateError('Name is required');
      return;
    }
    if (!createForm.assetId) {
      setCreateError('Asset is required');
      return;
    }
    if (!createForm.reason.trim()) {
      setCreateError('Reason is required');
      return;
    }
    if (createTiers.length === 0 || createTiers.some((t) => t.feeItems.length === 0)) {
      setCreateError('At least 1 tier with 1 fee item is required');
      return;
    }

    // Set currency from selected asset if empty
    const selectedAsset = assets.find((a) => a.id === createForm.assetId);
    const currency = selectedAsset?.code?.split('-')[0] || '';
    const tiersWithCurrency = createTiers.map((t) => ({
      ...t,
      feeItems: t.feeItems.map((f) => ({
        ...f,
        currency: f.currency || currency,
      })),
    }));

    setCreateLoading(true);
    setCreateError(null);
    try {
      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/withdrawal-fee-levels`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            levelCode: createForm.levelCode.trim(),
            name: createForm.name.trim(),
            assetId: createForm.assetId,
            isDefault: createForm.isDefault,
            tiersJson: serializeTiers(tiersWithCurrency),
            reason: createForm.reason.trim(),
          }),
        },
      );
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { message?: string };
        setCreateError(data.message || 'Failed to submit');
        return;
      }
      const res = (await response.json()) as { approvalNo?: string };
      closeCreateModal();
      setNotice(
        `Level creation submitted${res.approvalNo ? ` — approval ${res.approvalNo}` : ''}`,
      );
      setTimeout(() => setNotice(null), 4000);
      void fetchItems(currentPage, filters);
    } catch (err: unknown) {
      setCreateError(err instanceof Error ? err.message : 'Request failed');
    } finally {
      setCreateLoading(false);
    }
  };

  /* ── Input style ── */
  const fi =
    'h-[30px] rounded border border-adm-border bg-adm-bg px-2.5 font-mono text-[11px] text-adm-t1 placeholder:text-adm-t3 outline-none focus:border-adm-amber transition-colors';

  const hasFilter = !!filters.assetId || !!filters.status || filters.defaultOnly;

  const updateFilter = (key: keyof FilterState, value: string | boolean) =>
    setFilters((prev) => ({ ...prev, [key]: value }));

  const handleSearch = () => void fetchItems(1, filters);

  const handleReset = () => {
    setFilters(DEFAULT_FILTERS);
    void fetchItems(1, DEFAULT_FILTERS);
  };

  /* ── Table header style ── */
  const th =
    'px-3 py-2 text-left font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-adm-t3';

  /* ── Render ── */
  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* ─── Zone 1: Title ─── */}
      <PageTitleBar title="Withdrawal Fee Levels" meta={`${total} levels`}>
        <button onClick={openCreateModal} className={adminButtonClass('listPrimary')}>
          <Plus size={13} />
          Create Level
        </button>
      </PageTitleBar>

      {/* ─── Error banner ─── */}
      {error && (
        <div className="shrink-0 border-b border-adm-border bg-adm-danger/5 px-4 py-2 font-mono text-[11px] text-adm-danger">
          {error}
        </div>
      )}

      {/* ─── Notice toast ─── */}
      {notice && (
        <div className="shrink-0 border-b border-adm-border bg-adm-amber/5 px-4 py-2 font-mono text-[11px] text-adm-amber">
          {notice}
        </div>
      )}

      {/* ─── Zone 2: Filter bar ─── */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-adm-border px-4 py-2">
        <select
          className={`${fi} w-[150px]`}
          value={filters.assetId}
          onChange={(e) => updateFilter('assetId', e.target.value)}
        >
          <option value="">All assets</option>
          {assets.map((a) => (
            <option key={a.id} value={a.id}>
              {a.code}
            </option>
          ))}
        </select>

        <select
          className={`${fi} w-[160px]`}
          value={filters.status}
          onChange={(e) => updateFilter('status', e.target.value)}
        >
          <option value="">All statuses</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>

        <label className="flex items-center gap-1 font-mono text-[10px] text-adm-t2">
          <input
            type="checkbox"
            checked={filters.defaultOnly}
            onChange={(e) => updateFilter('defaultOnly', e.target.checked)}
          />
          Default Only
        </label>

        <button onClick={handleSearch} className={adminButtonClass('listPrimary')}>
          Search
        </button>
        <button
          onClick={handleReset}
          disabled={!hasFilter}
          className={adminButtonClass('listSecondary')}
        >
          Reset
        </button>

        <button
          onClick={() => void fetchItems(currentPage, filters)}
          className={adminIconButtonClass()}
          title="Refresh"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* ─── Zone 3: Table ─── */}
      <div className="flex-1 overflow-y-auto">
        <table className="w-full border-collapse text-[11px]">
          <thead className="sticky top-0 z-10 bg-adm-panel">
            <tr className="border-b border-adm-border">
              <th className={th} style={{ width: 140 }}>Level Code</th>
              <th className={th} style={{ width: 130 }}>Name</th>
              <th className={th} style={{ width: 120 }}>Asset</th>
              <th className={th} style={{ width: 60 }}>Default</th>
              <th className={th} style={{ width: 50 }}>Tiers</th>
              <th className={th} style={{ width: 120 }}>Status</th>
              <th className={th} style={{ width: 140 }}>Updated</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && !loading ? (
              <tr>
                <td colSpan={7} className="px-3 py-12 text-center text-[11px] text-adm-t3">
                  No fee levels found
                </td>
              </tr>
            ) : (
              items.map((l) => (
                <tr
                  key={l.id}
                  className="cursor-pointer border-b border-adm-border hover:bg-adm-hover"
                  onClick={() =>
                    navigate(`/dashboard/pricing/withdrawal-fee-levels/${l.levelCode}`)
                  }
                >
                  <td className="px-3 py-2">
                    <button
                      className={adminButtonClass('rowKeyLink')}
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(
                          `/dashboard/pricing/withdrawal-fee-levels/${l.levelCode}`,
                        );
                      }}
                      title={l.levelCode}
                    >
                      {l.levelCode}
                    </button>
                  </td>
                  <td className="px-3 py-2 text-adm-t1">{l.name}</td>
                  <td className="px-3 py-2">
                    <span
                      className={`inline-flex items-center rounded px-1.5 py-0.5 font-mono text-[10px] font-medium ${
                        l.asset.assetType === 'CRYPTO'
                          ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300'
                          : 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300'
                      }`}
                    >
                      {l.asset.code}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-center">
                    {l.isDefault ? '✅' : '—'}
                  </td>
                  <td className="px-3 py-2 font-mono text-adm-t2 text-center">
                    {countTiers(l.tiersJson)}
                  </td>
                  <td className="px-3 py-2">
                    <AdminBadge value={l.status} />
                  </td>
                  <td className="px-3 py-2 font-mono text-[10px] text-adm-t2">
                    {fmt(l.updatedAt)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* ─── Zone 4: Footer ─── */}
      <div className="flex shrink-0 items-center justify-between border-t border-adm-border px-4 py-2 text-[10px] text-adm-t3">
        <span>
          Showing {items.length} / {total} levels
        </span>
        <Pagination
          currentPage={currentPage}
          totalItems={total}
          pageSize={PAGE_SIZE}
          onPageChange={(p: number) => void fetchItems(p, filters)}
        />
      </div>

      {/* ════ Create Level Modal ════ */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded-lg border border-adm-border bg-adm-bg shadow-xl">
            {/* Header */}
            <div className="sticky top-0 z-10 border-b border-adm-border bg-adm-bg px-5 py-3">
              <h2 className="font-mono text-sm font-semibold text-adm-t1">
                Create Withdrawal Fee Level
              </h2>
            </div>
            {/* Body */}
            <div className="space-y-3 px-5 py-4">
              {createError && (
                <div className="rounded border border-adm-danger/30 bg-adm-danger/5 px-3 py-2 font-mono text-[11px] text-adm-danger">
                  {createError}
                </div>
              )}

              <div>
                <label className="mb-1 block font-mono text-[10px] font-semibold uppercase tracking-wider text-adm-t3">
                  Level Code
                </label>
                <input
                  className="w-full rounded border border-adm-border bg-adm-bg px-3 py-1.5 font-mono text-xs text-adm-t1 uppercase"
                  value={createForm.levelCode}
                  onChange={(e) =>
                    setCreateForm((f) => ({
                      ...f,
                      levelCode: e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ''),
                    }))
                  }
                  placeholder="e.g. STD-USDT-TRON"
                />
              </div>

              <div>
                <label className="mb-1 block font-mono text-[10px] font-semibold uppercase tracking-wider text-adm-t3">
                  Name
                </label>
                <input
                  className="w-full rounded border border-adm-border bg-adm-bg px-3 py-1.5 font-mono text-xs text-adm-t1"
                  value={createForm.name}
                  onChange={(e) => setCreateForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. Standard USDT"
                />
              </div>

              <div>
                <label className="mb-1 block font-mono text-[10px] font-semibold uppercase tracking-wider text-adm-t3">
                  Asset
                </label>
                <select
                  className="w-full rounded border border-adm-border bg-adm-bg px-3 py-1.5 font-mono text-xs text-adm-t1"
                  value={createForm.assetId}
                  onChange={(e) => setCreateForm((f) => ({ ...f, assetId: e.target.value }))}
                >
                  <option value="">Select asset…</option>
                  {assets.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.code} ({a.assetType})
                    </option>
                  ))}
                </select>
              </div>

              <label className="flex items-center gap-2 font-mono text-[11px] text-adm-t1">
                <input
                  type="checkbox"
                  checked={createForm.isDefault}
                  onChange={(e) =>
                    setCreateForm((f) => ({ ...f, isDefault: e.target.checked }))
                  }
                />
                Is Default Level
              </label>

              <div>
                <label className="mb-1 block font-mono text-[10px] font-semibold uppercase tracking-wider text-adm-t3">
                  Fee Tiers
                </label>
                <TierEditor
                  tiers={createTiers}
                  onChange={setCreateTiers}
                  defaultCurrency={
                    assets.find((a) => a.id === createForm.assetId)?.code?.split('-')[0] || ''
                  }
                />
              </div>

              <div>
                <label className="mb-1 block font-mono text-[10px] font-semibold uppercase tracking-wider text-adm-t3">
                  Reason
                </label>
                <textarea
                  className="w-full rounded border border-adm-border bg-adm-bg px-3 py-1.5 font-mono text-xs text-adm-t1"
                  rows={2}
                  value={createForm.reason}
                  onChange={(e) => setCreateForm((f) => ({ ...f, reason: e.target.value }))}
                  placeholder="Why is this level needed?"
                />
              </div>
            </div>
            {/* Footer */}
            <div className="sticky bottom-0 flex justify-end gap-2 border-t border-adm-border bg-adm-bg px-5 py-3">
              <button onClick={closeCreateModal} className={adminButtonClass('modalCancel')}>
                Cancel
              </button>
              <button
                onClick={handleCreateSubmit}
                disabled={
                  createLoading ||
                  !createForm.levelCode ||
                  !createForm.name ||
                  !createForm.assetId ||
                  !createForm.reason.trim()
                }
                className={adminButtonClass('workflowPrimary')}
              >
                {createLoading ? 'Submitting…' : 'Submit for Approval'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default WithdrawalFeeLevelList;
```

- [ ] **Step 2: Verify compilation**

Run: `cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/admin-web && npx tsc --noEmit 2>&1 | head -20`

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add admin-web/src/pages/WithdrawalFeeLevelList.tsx
git commit -m "feat(admin): add WithdrawalFeeLevelList page with filters, table, and create modal"
```

---

### Task 4: WithdrawalFeeLevelDetail Page

**Files:**
- Create: `admin-web/src/pages/WithdrawalFeeLevelDetail.tsx`

Mirrors `TransactionLimitDetail.tsx` pattern: DetailPageHeader → notices → two-column (main + 272px sidebar). Main has Hero, Fee Tiers cards, Customer Bindings table, and a Technical collapsible section. Sidebar has Actions, Identity, and Lifecycle groups. Includes Change Modal (Edit Tiers) and Bind Modal.

- [ ] **Step 1: Create WithdrawalFeeLevelDetail.tsx**

Create `admin-web/src/pages/WithdrawalFeeLevelDetail.tsx`:

```typescript
import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { X, Pencil, UserPlus } from 'lucide-react';
import { AdminSessionError, adminFetch, getApiErrorMessage } from '../utils/adminFetch';
import { adminButtonClass } from '../components/common/adminButtonStyles';
import { DetailPageHeader } from '../components/compliance/DetailPageComponents';
import { AdminBadge } from '../components/ui/AdminBadge';
import TierEditor, {
  parseTiersJson,
  serializeTiers,
  type TierState,
} from '../components/pricing/TierEditor';

/* ── Interfaces ──────────────────────────────────────────────── */

interface FeeLevelDetail {
  id: string;
  levelCode: string;
  name: string;
  asset: { id: string; code: string; assetType: string; decimals?: number };
  isDefault: boolean;
  tiersJson: string;
  status: string;
  configHash: string | null;
  approvalCaseNo: string | null;
  createdAt: string;
  updatedAt: string;
}

interface BindingItem {
  id: string;
  customerId: string;
  customerNo: string;
  customerName: string;
  createdAt: string;
}

/* ── Helpers ─────────────────────────────────────────────────── */

const fmt = (v?: string | null): string => {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString();
};

const truncateHash = (hash: string | null): string => {
  if (!hash) return '—';
  if (hash.length <= 16) return hash;
  return `${hash.slice(0, 8)}…${hash.slice(-5)}`;
};

/* ── Layout primitives (mirroring TransactionLimitDetail) ── */

const Cap = ({ children }: { children: ReactNode }) => (
  <p className="font-mono text-[8.5px] font-semibold uppercase tracking-[0.16em] text-adm-t3">
    {children}
  </p>
);

const SidebarGroup = ({ title, children }: { title: string; children: ReactNode }) => (
  <div className="border-b border-adm-border py-4 last:border-b-0">
    <Cap>{title}</Cap>
    <div className="mt-2.5 flex flex-col gap-1.5">{children}</div>
  </div>
);

const SidebarKV = ({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: ReactNode;
  mono?: boolean;
}) => {
  if (value === null || value === undefined || value === '' || value === '—') return null;
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="shrink-0 font-mono text-[9px] text-adm-t3">{label}</span>
      <span
        className={[
          'min-w-0 break-all text-right text-adm-t2',
          mono ? 'font-mono text-[10px]' : 'text-[11px]',
        ].join(' ')}
      >
        {value}
      </span>
    </div>
  );
};

/* ── Main Component ──────────────────────────────────────────── */

export default function WithdrawalFeeLevelDetail() {
  const { levelCode } = useParams<{ levelCode: string }>();
  const navigate = useNavigate();

  const [level, setLevel] = useState<FeeLevelDetail | null>(null);
  const [bindings, setBindings] = useState<BindingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  /* ── Change Modal state ── */
  const [showChangeModal, setShowChangeModal] = useState(false);
  const [changeTiers, setChangeTiers] = useState<TierState[]>([]);
  const [changeReason, setChangeReason] = useState('');
  const [changeLoading, setChangeLoading] = useState(false);
  const [changeError, setChangeError] = useState<string | null>(null);

  /* ── Bind Modal state ── */
  const [showBindModal, setShowBindModal] = useState(false);
  const [bindCustomerId, setBindCustomerId] = useState('');
  const [bindLoading, setBindLoading] = useState(false);
  const [bindError, setBindError] = useState<string | null>(null);

  /* ── Technical section ── */
  const [showRawJson, setShowRawJson] = useState(false);

  /* ── Fetch ── */

  const fetchDetail = async () => {
    if (!levelCode) return;
    setLoading(true);
    setError(null);
    try {
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/withdrawal-fee-levels/${levelCode}`,
      );
      if (!res.ok)
        throw new Error(await getApiErrorMessage(res, 'Failed to load level detail.'));
      setLevel(await res.json());
    } catch (err) {
      if (err instanceof AdminSessionError) return;
      setError(err instanceof Error ? err.message : 'Failed to load level detail.');
    } finally {
      setLoading(false);
    }
  };

  const fetchBindings = async () => {
    if (!levelCode) return;
    try {
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/withdrawal-fee-levels/${levelCode}/bindings`,
      );
      if (res.ok) {
        const data = (await res.json()) as BindingItem[] | { items: BindingItem[] };
        setBindings(Array.isArray(data) ? data : Array.isArray((data as { items: BindingItem[] }).items) ? (data as { items: BindingItem[] }).items : []);
      }
    } catch {
      /* ignore binding fetch errors */
    }
  };

  useEffect(() => {
    void fetchDetail();
    void fetchBindings();
  }, [levelCode]);

  useEffect(() => {
    if (!notice) return undefined;
    const t = window.setTimeout(() => setNotice((c) => (c === notice ? null : c)), 4000);
    return () => window.clearTimeout(t);
  }, [notice]);

  /* ── Change (Edit Tiers) ── */

  const openChangeModal = () => {
    if (!level) return;
    setChangeTiers(parseTiersJson(level.tiersJson));
    setChangeReason('');
    setChangeError(null);
    setShowChangeModal(true);
  };

  const handleChangeSubmit = async () => {
    if (!levelCode) return;
    if (!changeReason.trim()) {
      setChangeError('Change reason is required');
      return;
    }
    if (changeTiers.length === 0 || changeTiers.some((t) => t.feeItems.length === 0)) {
      setChangeError('At least 1 tier with 1 fee item is required');
      return;
    }

    setChangeLoading(true);
    setChangeError(null);
    try {
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/withdrawal-fee-levels/${levelCode}/change`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            proposedTiersJson: serializeTiers(changeTiers),
            changeReason: changeReason.trim(),
          }),
        },
      );
      if (!res.ok)
        throw new Error(await getApiErrorMessage(res, 'Failed to submit change'));
      const data = (await res.json()) as { approvalNo?: string };
      setShowChangeModal(false);
      setNotice(
        `Tier change submitted for approval${data.approvalNo ? ` (${data.approvalNo})` : ''}.`,
      );
      void fetchDetail();
    } catch (err) {
      if (err instanceof AdminSessionError) return;
      setChangeError(err instanceof Error ? err.message : 'Failed to submit change.');
    } finally {
      setChangeLoading(false);
    }
  };

  /* ── Bind Customer ── */

  const openBindModal = () => {
    setBindCustomerId('');
    setBindError(null);
    setShowBindModal(true);
  };

  const handleBindSubmit = async () => {
    if (!level) return;
    if (!bindCustomerId.trim()) {
      setBindError('Customer ID is required');
      return;
    }

    setBindLoading(true);
    setBindError(null);
    try {
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/withdrawal-fee-levels/bindings/bind`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            customerId: bindCustomerId.trim(),
            levelId: level.id,
          }),
        },
      );
      if (!res.ok) throw new Error(await getApiErrorMessage(res, 'Failed to bind customer'));
      setShowBindModal(false);
      setNotice('Customer bound successfully.');
      void fetchBindings();
    } catch (err) {
      if (err instanceof AdminSessionError) return;
      setBindError(err instanceof Error ? err.message : 'Failed to bind customer.');
    } finally {
      setBindLoading(false);
    }
  };

  /* ── Unbind Customer ── */

  const handleUnbind = async (customerId: string) => {
    if (!level) return;
    if (!window.confirm('Unbind this customer from the fee level?')) return;

    try {
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/withdrawal-fee-levels/bindings/unbind`,
        {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ customerId, levelId: level.id }),
        },
      );
      if (!res.ok) throw new Error(await getApiErrorMessage(res, 'Failed to unbind'));
      setNotice('Customer unbound successfully.');
      void fetchBindings();
    } catch (err) {
      if (err instanceof AdminSessionError) return;
      setError(err instanceof Error ? err.message : 'Failed to unbind customer.');
    }
  };

  /* ── Parse tiers for display ── */

  const parsedTiers = level
    ? (() => {
        try {
          return (
            JSON.parse(level.tiersJson) as {
              tiers: Array<{
                id: string;
                name: string;
                priority: number;
                enabled: boolean;
                conditions: { amountMin: number; amountMax: number | null };
                feeItems: Array<{
                  id: string;
                  itemCode: string;
                  calcType: string;
                  value: string;
                  currency: string;
                  min: string | null;
                  cap: string | null;
                }>;
              }>;
            }
          ).tiers;
        } catch {
          return [];
        }
      })()
    : [];

  /* ── Loading / Error states ── */

  if (loading && !level) {
    return (
      <div className="flex min-h-[320px] flex-col items-center justify-center">
        <div className="animate-spin rounded-full h-6 w-6 border-2 border-adm-amber border-t-transparent" />
        <p className="mt-3 font-mono text-[11px] text-adm-t3">Loading level…</p>
      </div>
    );
  }

  if (!level) {
    return (
      <div className="space-y-4 rounded border border-adm-red/30 bg-adm-red/10 p-8 text-center">
        <div className="font-mono text-[11px] text-adm-red">
          {error || 'Level not found'}
        </div>
        <div className="flex items-center justify-center gap-3">
          <button
            onClick={() => navigate('/dashboard/pricing/withdrawal-fee-levels')}
            className={adminButtonClass('detailUtility')}
          >
            Back to Levels
          </button>
          <button onClick={() => void fetchDetail()} className={adminButtonClass('detailUtility')}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* ── Header ── */}
      <DetailPageHeader
        onBack={() => navigate('/dashboard/pricing/withdrawal-fee-levels')}
        onRefresh={() => {
          void fetchDetail();
          void fetchBindings();
        }}
        refreshing={loading}
      />

      {/* ── Inline notices ── */}
      {(notice || error) && (
        <div className="shrink-0 px-6 pt-3 pb-1 space-y-2">
          {notice && (
            <div className="rounded border border-adm-green/30 bg-adm-green/10 px-4 py-2 font-mono text-[11px] text-adm-green">
              {notice}
            </div>
          )}
          {error && (
            <div className="rounded border border-adm-red/30 bg-adm-red/10 px-4 py-2 font-mono text-[11px] text-adm-red">
              {error}
            </div>
          )}
        </div>
      )}

      {/* ── Body: two-column layout ── */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* ════ LEFT MAIN ════ */}
        <div className="flex min-w-0 flex-1 flex-col divide-y divide-adm-border overflow-y-auto">
          {/* ① Hero */}
          <section className="bg-adm-card px-6 py-5">
            <div className="flex items-center gap-3">
              <p className="font-mono text-[19px] font-bold leading-snug text-adm-amber">
                {level.levelCode}
              </p>
              <AdminBadge value={level.status} />
              {level.isDefault && (
                <span className="inline-flex items-center rounded bg-blue-100 px-1.5 py-0.5 font-mono text-[10px] font-medium text-blue-800 dark:bg-blue-900/30 dark:text-blue-300">
                  DEFAULT
                </span>
              )}
            </div>
            <p className="mt-1 text-[13px] text-adm-t1">{level.name}</p>
            <p className="mt-0.5 font-mono text-[11px] text-adm-t3">
              Asset: {level.asset.code} ({level.asset.assetType}) · {parsedTiers.length} tier
              {parsedTiers.length !== 1 ? 's' : ''}
            </p>
          </section>

          {/* ② Fee Tiers */}
          <section className="px-6 py-5">
            <Cap>Fee Tiers</Cap>
            <div className="mt-3 space-y-3">
              {parsedTiers.map((tier) => (
                <div
                  key={tier.id}
                  className="rounded-lg border border-adm-border bg-adm-panel"
                >
                  {/* Tier header */}
                  <div className="flex items-center justify-between border-b border-adm-border/50 px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className="text-[12px] font-semibold text-adm-t1">
                        {tier.name}
                      </span>
                      <span className="font-mono text-[10px] text-adm-t3">
                        #{tier.id}
                      </span>
                    </div>
                    <div className="font-mono text-[10px] text-adm-t3">
                      Priority: {tier.priority} ·{' '}
                      <span className={tier.enabled ? 'text-adm-green' : 'text-adm-red'}>
                        {tier.enabled ? 'Enabled' : 'Disabled'}
                      </span>
                    </div>
                  </div>
                  {/* Tier body */}
                  <div className="px-4 py-3">
                    <p className="mb-2 font-mono text-[10px] text-adm-t3">
                      Amount Range:{' '}
                      <strong className="text-adm-t1">
                        {tier.conditions.amountMin ?? 0}
                      </strong>{' '}
                      —{' '}
                      <strong className="text-adm-t1">
                        {tier.conditions.amountMax ?? '∞'}
                      </strong>
                    </p>
                    <table className="w-full border-collapse text-[11px]">
                      <thead>
                        <tr className="bg-adm-card font-mono text-[9px] uppercase tracking-wider text-adm-t3">
                          <th className="px-2 py-1.5 text-left font-medium">Fee Item</th>
                          <th className="px-2 py-1.5 text-left font-medium">Calc Type</th>
                          <th className="px-2 py-1.5 text-right font-medium">Value</th>
                          <th className="px-2 py-1.5 text-left font-medium">Currency</th>
                          <th className="px-2 py-1.5 text-right font-medium">Min</th>
                          <th className="px-2 py-1.5 text-right font-medium">Cap</th>
                        </tr>
                      </thead>
                      <tbody>
                        {tier.feeItems.map((fee) => (
                          <tr
                            key={fee.id}
                            className="border-t border-adm-border/50"
                          >
                            <td className="px-2 py-1.5 font-medium text-adm-t1">
                              {fee.itemCode}
                            </td>
                            <td className="px-2 py-1.5">
                              <span className="inline-block rounded bg-adm-card px-1.5 py-0.5 font-mono text-[10px] text-adm-t2">
                                {fee.calcType}
                              </span>
                            </td>
                            <td className="px-2 py-1.5 text-right font-mono text-adm-t1">
                              {fee.value}
                            </td>
                            <td className="px-2 py-1.5 text-adm-t2">{fee.currency}</td>
                            <td className="px-2 py-1.5 text-right text-adm-t3">
                              {fee.min ?? '—'}
                            </td>
                            <td className="px-2 py-1.5 text-right text-adm-t3">
                              {fee.cap ?? '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* ③ Customer Bindings */}
          <section className="px-6 py-5">
            <Cap>Customer Bindings ({bindings.length})</Cap>
            <div className="mt-3">
              {bindings.length === 0 ? (
                <p className="font-mono text-[11px] text-adm-t3">
                  No customers bound to this level
                </p>
              ) : (
                <div className="rounded-lg border border-adm-border bg-adm-panel">
                  <table className="w-full border-collapse text-[11px]">
                    <thead>
                      <tr className="bg-adm-card font-mono text-[9px] uppercase tracking-wider text-adm-t3">
                        <th className="px-3 py-2 text-left font-medium">Customer No</th>
                        <th className="px-3 py-2 text-left font-medium">Name</th>
                        <th className="px-3 py-2 text-left font-medium">Bound At</th>
                        <th className="px-3 py-2 text-right font-medium">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bindings.map((b) => (
                        <tr key={b.id} className="border-t border-adm-border/50">
                          <td className="px-3 py-2 font-mono text-adm-amber">
                            {b.customerNo}
                          </td>
                          <td className="px-3 py-2 text-adm-t1">{b.customerName}</td>
                          <td className="px-3 py-2 font-mono text-[10px] text-adm-t3">
                            {fmt(b.createdAt)}
                          </td>
                          <td className="px-3 py-2 text-right">
                            <button
                              onClick={() => void handleUnbind(b.customerId)}
                              className="rounded border border-adm-danger px-2 py-0.5 font-mono text-[10px] text-adm-danger hover:bg-adm-danger/10"
                            >
                              Unbind
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </section>

          {/* ④ Technical (Raw JSON) */}
          <section className="px-6 py-4">
            <button
              onClick={() => setShowRawJson(!showRawJson)}
              className="font-mono text-[9px] font-semibold uppercase tracking-[0.16em] text-adm-t3 hover:text-adm-t1"
            >
              {showRawJson ? '▼' : '▶'} Technical (Raw JSON)
            </button>
            {showRawJson && (
              <pre className="mt-2 overflow-auto rounded bg-gray-900 p-3 font-mono text-[11px] text-gray-100 max-h-96">
                {JSON.stringify(level, null, 2)}
              </pre>
            )}
          </section>
        </div>

        {/* ════ RIGHT SIDEBAR ════ */}
        <div className="w-[272px] min-w-[272px] overflow-y-auto border-l border-adm-border bg-adm-panel px-4 py-1">
          {/* Actions */}
          {level.status === 'ACTIVE' && (
            <div className="border-b border-adm-border py-4">
              <Cap>Actions</Cap>
              <div className="mt-2.5 flex flex-col gap-2">
                <button onClick={openChangeModal} className={adminButtonClass('workflowPrimary')}>
                  <Pencil size={13} />
                  Edit Tiers
                </button>
                <button onClick={openBindModal} className={adminButtonClass('listSecondary')}>
                  <UserPlus size={13} />
                  Bind Customer
                </button>
                <p className="text-center font-mono text-[10px] text-adm-t3">
                  Edit Tiers requires MLRO → SMO approval
                </p>
              </div>
            </div>
          )}

          {/* Identity */}
          <SidebarGroup title="Identity">
            <SidebarKV label="Level Code" value={level.levelCode} mono />
            <SidebarKV label="Status" value={<AdminBadge value={level.status} />} />
            <SidebarKV
              label="Asset"
              value={`${level.asset.code} (${level.asset.assetType})`}
            />
            <SidebarKV label="Default" value={level.isDefault ? 'Yes' : 'No'} />
            <SidebarKV label="Config Hash" value={truncateHash(level.configHash)} mono />
            <SidebarKV
              label="Approval"
              value={
                level.approvalCaseNo ? (
                  <button
                    onClick={() =>
                      navigate(
                        `/dashboard/control-gates/approvals/${level.approvalCaseNo}`,
                      )
                    }
                    className="font-mono text-[10px] text-adm-amber hover:underline"
                  >
                    {level.approvalCaseNo}
                  </button>
                ) : (
                  '—'
                )
              }
            />
          </SidebarGroup>

          {/* Lifecycle */}
          <SidebarGroup title="Lifecycle">
            <SidebarKV label="Created" value={fmt(level.createdAt)} mono />
            <SidebarKV label="Updated" value={fmt(level.updatedAt)} mono />
          </SidebarGroup>
        </div>
      </div>

      {/* ════ Change Modal (Edit Tiers) ════ */}
      {showChangeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded-xl border border-adm-border bg-adm-panel shadow-xl">
            {/* Header */}
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-adm-border bg-adm-card px-5 py-4">
              <div>
                <p className="font-mono text-[11px] font-semibold text-adm-t1">
                  Edit Tiers
                </p>
                <p className="mt-1 font-mono text-[9px] text-adm-t3">
                  {level.levelCode} · {level.asset.code}
                </p>
              </div>
              <button
                onClick={() => setShowChangeModal(false)}
                className="rounded p-1 text-adm-t3 hover:bg-adm-hover hover:text-adm-t1"
              >
                <X size={15} />
              </button>
            </div>

            {/* Body */}
            <div className="px-5 py-4 space-y-3">
              <div className="rounded border border-adm-amber/30 bg-adm-amber/10 px-3 py-2.5 font-mono text-[10px] text-adm-amber leading-relaxed">
                This will submit a tier change request for MLRO → SMO approval. The current
                configuration remains in effect until the change is approved.
              </div>

              {changeError && (
                <div className="rounded border border-adm-danger/30 bg-adm-danger/5 px-3 py-2 font-mono text-[11px] text-adm-danger">
                  {changeError}
                </div>
              )}

              <div>
                <label className="mb-1 block font-mono text-[10px] font-semibold uppercase tracking-wider text-adm-t3">
                  Proposed Tiers
                </label>
                <TierEditor
                  tiers={changeTiers}
                  onChange={setChangeTiers}
                  defaultCurrency={level.asset.code.split('-')[0]}
                />
              </div>

              <div>
                <label className="mb-1 block font-mono text-[10px] font-semibold uppercase tracking-wider text-adm-t3">
                  Change Reason
                </label>
                <textarea
                  value={changeReason}
                  onChange={(e) => setChangeReason(e.target.value)}
                  rows={3}
                  placeholder="Describe why these tiers should be changed…"
                  className="w-full rounded border border-adm-border bg-adm-bg px-3 py-2 font-mono text-[10px] text-adm-t2 placeholder:text-adm-t3 focus:border-adm-amber focus:outline-none resize-none transition-colors"
                />
              </div>
            </div>

            {/* Footer */}
            <div className="sticky bottom-0 flex justify-end gap-2 border-t border-adm-border bg-adm-card px-5 py-4">
              <button
                onClick={() => setShowChangeModal(false)}
                className={adminButtonClass('modalCancel')}
              >
                Cancel
              </button>
              <button
                onClick={() => void handleChangeSubmit()}
                disabled={changeLoading || !changeReason.trim()}
                className={adminButtonClass('modalConfirm')}
              >
                {changeLoading ? 'Submitting…' : 'Submit for Approval'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ════ Bind Customer Modal ════ */}
      {showBindModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-xl border border-adm-border bg-adm-panel shadow-xl">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-adm-border bg-adm-card px-5 py-4">
              <p className="font-mono text-[11px] font-semibold text-adm-t1">
                Bind Customer
              </p>
              <button
                onClick={() => setShowBindModal(false)}
                className="rounded p-1 text-adm-t3 hover:bg-adm-hover hover:text-adm-t1"
              >
                <X size={15} />
              </button>
            </div>

            {/* Body */}
            <div className="px-5 py-4 space-y-3">
              {bindError && (
                <div className="rounded border border-adm-danger/30 bg-adm-danger/5 px-3 py-2 font-mono text-[11px] text-adm-danger">
                  {bindError}
                </div>
              )}

              <div>
                <label className="mb-1 block font-mono text-[10px] font-semibold uppercase tracking-wider text-adm-t3">
                  Customer ID
                </label>
                <input
                  type="text"
                  value={bindCustomerId}
                  onChange={(e) => setBindCustomerId(e.target.value)}
                  placeholder="Enter customer UUID"
                  className="w-full rounded border border-adm-border bg-adm-bg px-3 py-2 font-mono text-[11px] text-adm-t1 placeholder:text-adm-t3 focus:border-adm-amber focus:outline-none transition-colors"
                  autoFocus
                />
              </div>
            </div>

            {/* Footer */}
            <div className="flex justify-end gap-2 border-t border-adm-border bg-adm-card px-5 py-4">
              <button
                onClick={() => setShowBindModal(false)}
                className={adminButtonClass('modalCancel')}
              >
                Cancel
              </button>
              <button
                onClick={() => void handleBindSubmit()}
                disabled={bindLoading || !bindCustomerId.trim()}
                className={adminButtonClass('modalConfirm')}
              >
                {bindLoading ? 'Binding…' : 'Bind'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify compilation**

Run: `cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/admin-web && npx tsc --noEmit 2>&1 | head -20`

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add admin-web/src/pages/WithdrawalFeeLevelDetail.tsx
git commit -m "feat(admin): add WithdrawalFeeLevelDetail page with tier cards, bindings, change/bind modals"
```

---

### Task 5: Visual Verification

Verify the pages render correctly and interact with the running backend.

- [ ] **Step 1: Start the admin-web dev server**

Run: `cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/admin-web && npx vite --port 3501 &`

Wait for it to be ready.

- [ ] **Step 2: Verify list page loads**

Open `http://localhost:3501/dashboard/pricing/withdrawal-fee-levels` in a browser (after logging in).

Expected:
- Page title "Withdrawal Fee Levels" visible
- Filter bar with Asset dropdown, Status dropdown, Default Only checkbox
- Table with 7 columns (Level Code, Name, Asset, Default, Tiers, Status, Updated)
- If backend is running on 3500 with existing data, rows appear
- Navigation sidebar shows "Withdrawal Fee Levels" under Pricing group

- [ ] **Step 3: Verify Create Modal**

Click "+ Create Level" button.

Expected:
- Modal opens with fields: Level Code, Name, Asset (dropdown), Is Default (checkbox), Fee Tiers (TierEditor), Reason
- TierEditor shows one default tier with one fee item
- "Add Fee Item" and "Add Tier" buttons work
- "Remove Tier" and trash icon for fee items work
- Submit button disabled when required fields are empty

- [ ] **Step 4: Verify detail page loads**

Click on a level code in the table (or navigate directly to `/dashboard/pricing/withdrawal-fee-levels/STD-USDT-TRON`).

Expected:
- Hero section: levelCode in amber mono + status badge + DEFAULT tag (if default) + name + asset info
- Fee Tiers section: tier cards with name, priority, enabled status, amount range, fee items table
- Customer Bindings section: table or "No customers bound" message
- Sidebar: Actions (Edit Tiers + Bind Customer), Identity, Lifecycle
- Technical section: collapsible raw JSON

- [ ] **Step 5: Verify Edit Tiers Modal**

Click "Edit Tiers" in sidebar.

Expected:
- Modal opens pre-populated with current tier data
- TierEditor shows current tiers/fee items
- Change Reason textarea present
- Submit disabled until reason is entered

- [ ] **Step 6: Verify Bind Customer Modal**

Click "Bind Customer" in sidebar.

Expected:
- Modal opens with Customer ID text input
- Submit calls POST /bindings/bind
- Success refreshes bindings list

- [ ] **Step 7: Commit (if any fixes were needed)**

If any fixes were made during verification:

```bash
git add -A
git commit -m "fix(admin): address visual verification findings for withdrawal fee level pages"
```

---

## Self-Review Checklist

| Spec Section | Task | Status |
|---|---|---|
| §2 Page Structure (two-page mode) | Tasks 3, 4 | ✅ |
| §3 WithdrawalFeeLevelList (layout, columns, filters, API, create modal) | Task 3 | ✅ |
| §4 WithdrawalFeeLevelDetail (layout, sections, sidebar, API, change/bind modals) | Task 4 | ✅ |
| §5 Tier Editor Component | Task 2 | ✅ |
| §6.1 Routes (App.tsx) | Task 1 | ✅ |
| §6.2 Navigation (DashboardLayout.tsx) | Task 1 | ✅ |
| §6.3 Permissions | Task 1 | ✅ |
| §7 Status Badge Colors | Covered — AdminBadge already maps ACTIVE/PENDING_APPROVAL/REJECTED | ✅ |
| §8 Error Handling | Tasks 3, 4 — error banners, modal error display, 404 state | ✅ |
| §9 Out of Scope items | Not implemented (correct) | ✅ |
