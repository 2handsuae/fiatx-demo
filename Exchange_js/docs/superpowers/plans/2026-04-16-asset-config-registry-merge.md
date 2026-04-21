# Asset Config Registry→Manifest Merge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the ASSET_CONFIG release the single source of truth for all asset properties (type, code, network, decimals, description, status), so that publishing a release upserts the `assets` table — eliminating the need to separately create assets via `POST /assets`.

**Architecture:** Add `decimals`, `description`, `status` to `AssetConfigManifestItem`; fill `projectAssetConfig()` to upsert the `assets` table on publish (following the existing `projectCoa()` pattern); simplify the frontend to read all asset properties from the release payload instead of making a separate `/assets` call.

**Tech Stack:** NestJS 10, Prisma 6, SQLite, React 18, TypeScript 5

---

## Files Changed

| File | Action |
|------|--------|
| `src/config/manifests/asset-config.manifest.ts` | Modify — add `decimals`, `description`, `status` to type; update 4 asset entries |
| `src/modules/governance/business-config/business-config.service.ts` | Modify — fill `projectAssetConfig()`, update `validateAssetConfigRelease()` |
| `src/modules/asset-treasury/assets/assets.controller.ts` | Modify — mark `POST /assets` as deprecated |
| `admin-web/src/pages/AssetConfigList.tsx` | Modify — drop separate `/assets` fetch, use payload `status` field |
| `admin-web/src/pages/AssetConfigDetail.tsx` | Modify — drop separate `/assets?assetNo=` fetch, use payload `decimals`/`status`/`description` |
| `admin-web/src/App.tsx` | Modify — remove the `AssetCreate` route |

---

## Task 1: Expand `AssetConfigManifestItem` type and seed data

**Files:**
- Modify: `src/config/manifests/asset-config.manifest.ts`

- [ ] **Step 1: Update the type and all 4 asset entries**

Replace the entire file contents:

```typescript
export type AssetConfigManifestItem = {
  assetNo: string;
  code: string;
  type: 'FIAT' | 'CRYPTO';
  network: string;
  decimals: number;
  description: string | null;
  status: 'ACTIVE' | 'DISABLED';
  depositEnabled: boolean;
  withdrawEnabled: boolean;
  depositMinAmount: string;
  depositMaxAmount: string | null;
  withdrawMinAmount: string;
  withdrawMaxAmount: string | null;
  minConfirmations: number | null; // null for FIAT, positive integer for CRYPTO
};

export const DEFAULT_ASSET_CONFIGS: AssetConfigManifestItem[] = [
  {
    assetNo: 'AS_USD',
    code: 'USD',
    type: 'FIAT',
    network: '',
    decimals: 2,
    description: 'United States Dollar',
    status: 'ACTIVE',
    depositEnabled: true,
    withdrawEnabled: true,
    depositMinAmount: '100',
    depositMaxAmount: null,
    withdrawMinAmount: '100',
    withdrawMaxAmount: null,
    minConfirmations: null,
  },
  {
    assetNo: 'AS_AED',
    code: 'AED',
    type: 'FIAT',
    network: '',
    decimals: 2,
    description: 'UAE Dirham',
    status: 'ACTIVE',
    depositEnabled: true,
    withdrawEnabled: true,
    depositMinAmount: '100',
    depositMaxAmount: null,
    withdrawMinAmount: '100',
    withdrawMaxAmount: null,
    minConfirmations: null,
  },
  {
    assetNo: 'AS_USDT_TRON',
    code: 'USDT',
    type: 'CRYPTO',
    network: 'TRON',
    decimals: 6,
    description: 'Tether USD on TRON network',
    status: 'ACTIVE',
    depositEnabled: true,
    withdrawEnabled: true,
    depositMinAmount: '10',
    depositMaxAmount: null,
    withdrawMinAmount: '10',
    withdrawMaxAmount: null,
    minConfirmations: 20,
  },
  {
    assetNo: 'AS_BTC',
    code: 'BTC',
    type: 'CRYPTO',
    network: 'BITCOIN',
    decimals: 8,
    description: 'Bitcoin',
    status: 'ACTIVE',
    depositEnabled: true,
    withdrawEnabled: true,
    depositMinAmount: '0.001',
    depositMaxAmount: null,
    withdrawMinAmount: '0.001',
    withdrawMaxAmount: null,
    minConfirmations: 3,
  },
];
```

- [ ] **Step 2: Verify TypeScript compiles**

Run from `Exchange_js/`:
```bash
npx tsc --noEmit
```
Expected: no errors related to `AssetConfigManifestItem`.

- [ ] **Step 3: Commit**

```bash
git add src/config/manifests/asset-config.manifest.ts
git commit -m "feat(asset-config): add decimals, description, status to manifest type"
```

---

## Task 2: Fill `projectAssetConfig()` and update validation in business-config.service.ts

**Files:**
- Modify: `src/modules/governance/business-config/business-config.service.ts` (lines 723–767 for validation, lines 1056–1063 for projection)

- [ ] **Step 1: Replace `projectAssetConfig()` (no-op → real implementation)**

Find and replace the entire `projectAssetConfig` method (lines ~1056–1063):

```typescript
  private async projectAssetConfig(
    tx: GovernanceClient,
    items: Array<ParsedReleaseItem<AssetConfigManifestPayload>>,
  ): Promise<void> {
    const activeAssetNos = items.map((item) => String(item.payload.assetNo));

    for (const item of items) {
      const payload = item.payload;
      const assetRecord = {
        assetNo: String(payload.assetNo),
        type: String(payload.type),
        code: String(payload.code),
        network: payload.network ? String(payload.network) : null,
        decimals: Number(payload.decimals),
        description: payload.description ? String(payload.description) : null,
        status: String(payload.status),
      };
      await tx.asset.upsert({
        where: { assetNo: String(payload.assetNo) },
        update: assetRecord,
        create: assetRecord,
      });
    }

    // Disable any assets not present in the new release
    await tx.asset.updateMany({
      where: {
        assetNo: { notIn: activeAssetNos },
        status: { not: 'DISABLED' },
      },
      data: { status: 'DISABLED' },
    });
  }
```

- [ ] **Step 2: Update `validateAssetConfigRelease()` — drop Registry dependency, add new field checks**

Find and replace the entire `validateAssetConfigRelease` method (lines ~723–767):

```typescript
  private async validateAssetConfigRelease(
    items: Array<ParsedReleaseItem<AssetConfigManifestPayload>>,
  ): Promise<string[]> {
    const issues: string[] = [];
    const VALID_TYPES = new Set(['FIAT', 'CRYPTO']);
    const VALID_STATUSES = new Set(['ACTIVE', 'DISABLED']);

    for (const item of items) {
      const payload = item.payload;

      // Required fields
      if (!payload.assetNo || !payload.code || !payload.type || payload.depositMinAmount == null || payload.withdrawMinAmount == null) {
        issues.push(`AssetConfig ${item.businessKey} requires assetNo, code, type, depositMinAmount, and withdrawMinAmount`);
        continue;
      }

      // type must be FIAT or CRYPTO
      if (!VALID_TYPES.has(String(payload.type))) {
        issues.push(`AssetConfig ${item.businessKey} type must be FIAT or CRYPTO, got: ${payload.type}`);
      }

      // status must be ACTIVE or DISABLED
      if (!VALID_STATUSES.has(String(payload.status))) {
        issues.push(`AssetConfig ${item.businessKey} status must be ACTIVE or DISABLED, got: ${payload.status}`);
      }

      // decimals must be a non-negative integer
      const decimals = Number(payload.decimals);
      if (!Number.isInteger(decimals) || decimals < 0) {
        issues.push(`AssetConfig ${item.businessKey} decimals must be a non-negative integer`);
      }

      // depositMinAmount
      const minDeposit = Number(payload.depositMinAmount);
      if (isNaN(minDeposit) || minDeposit < 0) {
        issues.push(`AssetConfig ${item.businessKey} depositMinAmount must be a non-negative number`);
      }

      // withdrawMinAmount
      const minWithdraw = Number(payload.withdrawMinAmount);
      if (isNaN(minWithdraw) || minWithdraw < 0) {
        issues.push(`AssetConfig ${item.businessKey} withdrawMinAmount must be a non-negative number`);
      }

      // minConfirmations: null for FIAT, positive integer for CRYPTO
      if (payload.type === 'FIAT') {
        if (payload.minConfirmations != null) {
          issues.push(`AssetConfig ${item.businessKey} (FIAT) minConfirmations must be null`);
        }
      } else if (payload.type === 'CRYPTO') {
        if (payload.minConfirmations == null) {
          issues.push(`AssetConfig ${item.businessKey} (CRYPTO) minConfirmations is required`);
        } else {
          const confs = Number(payload.minConfirmations);
          if (!Number.isInteger(confs) || confs < 1) {
            issues.push(`AssetConfig ${item.businessKey} minConfirmations must be a positive integer`);
          }
        }
      }
    }
    return issues;
  }
```

- [ ] **Step 3: Compile check**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/modules/governance/business-config/business-config.service.ts
git commit -m "feat(asset-config): project assets table on publish; drop registry dependency in validation"
```

---

## Task 3: Deprecate `POST /assets` in the controller

**Files:**
- Modify: `src/modules/asset-treasury/assets/assets.controller.ts`

- [ ] **Step 1: Mark the POST endpoint as deprecated**

In `assets.controller.ts`, find the `@Post()` block and update `@ApiOperation`:

```typescript
  @Post()
  @ApiOperation({
    summary: '[DEPRECATED] Create a new asset — use ASSET_CONFIG release instead',
    deprecated: true,
  })
  create(@Body() dto: CreateAssetDto) {
    return this.service.create(dto);
  }
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/asset-treasury/assets/assets.controller.ts
git commit -m "chore(assets): deprecate POST /assets in favour of ASSET_CONFIG release"
```

---

## Task 4: Stage, validate, and publish a new ASSET_CONFIG release

This applies the expanded manifest (with decimals/description/status) and runs `projectAssetConfig()` to populate the `assets` table.

- [ ] **Step 1: Start the API server if not running**

```bash
npm run dev:start
```

- [ ] **Step 2: Stage a new ASSET_CONFIG release**

```bash
npx ts-node -e "
const { NestFactory } = require('@nestjs/core');
" 2>/dev/null || true

# Use the npm script instead:
npm run config:release:stage -- --subject ASSET_CONFIG
```

Note the new `releaseNo` from the output (e.g., `ASSET_CONFIG-REL-005`).

- [ ] **Step 3: Validate the release**

```bash
npm run config:release:validate -- --release ASSET_CONFIG-REL-005
```

Expected: `ok: true` with no issues.

- [ ] **Step 4: Check that a READY change ticket exists**

Query the DB to get a READY change ticket number:
```bash
sqlite3 /tmp/exchange_js_branch/dev.db "SELECT ticketNo FROM ChangeTicket WHERE status='READY' LIMIT 1;"
```

If none, create one via the admin UI: `http://localhost:3502/dashboard/governance/change-tickets` → New Change Ticket → Approve it.

- [ ] **Step 5: Publish the release**

```bash
npm run config:release:publish -- --release ASSET_CONFIG-REL-005 --change-ticket <ticketNo>
```

Expected: release status changes to ACTIVE; `assets` table updated.

- [ ] **Step 6: Verify assets were upserted**

```bash
sqlite3 /tmp/exchange_js_branch/dev.db "SELECT assetNo, code, type, decimals, status, description FROM Asset ORDER BY assetNo;"
```

Expected: 4 rows (AS_AED, AS_BTC, AS_USD, AS_USDT_TRON) all with `status=ACTIVE` and correct `decimals`.

---

## Task 5: Simplify `AssetConfigList.tsx` — use payload only

**Files:**
- Modify: `admin-web/src/pages/AssetConfigList.tsx`

**What changes:** The page currently makes TWO API calls (`/assets` and `/business-config/releases`), then merges them. After the merge, the manifest payload contains `status`, `decimals`, and `description`, so we only need the release payload.

- [ ] **Step 1: Rewrite the component**

Replace the entire file with the simplified version that reads all data from the ASSET_CONFIG release payload:

```tsx
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Clock, RefreshCw } from 'lucide-react';
import {
  adminButtonClass,
  adminIconButtonClass,
} from '../components/common/adminButtonStyles';
import { AdminBadge } from '../components/ui/AdminBadge';
import { PageTitleBar } from '../components/ui/PageTitleBar';
import {
  AdminSessionError,
  adminFetch,
  getApiErrorMessage,
} from '../utils/adminFetch';

/* ── Types ─────────────────────────────────────────────────────── */

interface AssetRow {
  assetNo: string;
  code: string;
  type: 'FIAT' | 'CRYPTO';
  network: string;
  decimals: number;
  description: string | null;
  status: 'ACTIVE' | 'DISABLED';
  depositEnabled: boolean;
  withdrawEnabled: boolean;
  depositMinAmount: string;
  depositMaxAmount: string | null;
  withdrawMinAmount: string;
  withdrawMaxAmount: string | null;
  minConfirmations: number | null;
}

interface FilterState {
  type: string;
  status: string;
}

/* ── Display helpers ────────────────────────────────────────────── */

const TypeBadge = ({ type }: { type: 'FIAT' | 'CRYPTO' }) => (
  <span
    className={`inline-flex items-center rounded border px-1.5 py-0.5 font-mono text-[9px] font-bold tracking-widest ${
      type === 'FIAT'
        ? 'border-adm-blue/25 bg-adm-blue/10 text-adm-blue'
        : 'border-adm-amber/25 bg-adm-amber/10 text-adm-amber'
    }`}
  >
    {type}
  </span>
);

const EnabledDot = ({ v }: { v: boolean }) => (
  <span
    className={`inline-flex items-center gap-1 font-mono text-[11px] font-medium ${
      v ? 'text-adm-green' : 'text-adm-t3'
    }`}
  >
    <span
      className={`h-1.5 w-1.5 shrink-0 rounded-full ${v ? 'bg-adm-green' : 'bg-adm-t3'}`}
    />
    {v ? 'On' : 'Off'}
  </span>
);

const AmtRange = ({ min, max }: { min: string; max: string | null }) => (
  <span className="font-mono text-[11px] text-adm-t2 tabular-nums">
    {min}
    <span className="mx-1 text-adm-t3">/</span>
    <span className={max ? 'text-adm-t2' : 'text-adm-t3'}>{max ?? '∞'}</span>
  </span>
);

const DEFAULT_FILTERS: FilterState = { type: '', status: '' };

const COLS = [
  'Asset',
  'Network',
  'Status',
  'Deposit',
  'Dep. Min / Max',
  'Withdraw',
  'Wtd. Min / Max',
  'Confirmations',
] as const;

/* ── Component ─────────────────────────────────────────────────── */

const AssetConfigList = () => {
  const navigate = useNavigate();
  const [rows, setRows] = useState<AssetRow[]>([]);
  const [releaseNo, setReleaseNo] = useState<string | null>(null);
  const [effectiveDate, setEffectiveDate] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const relListRes = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/business-config/releases?subjectType=ASSET_CONFIG&status=ACTIVE&take=1`,
      );
      if (!relListRes.ok) {
        setError(await getApiErrorMessage(relListRes, 'Failed to fetch releases.'));
        return;
      }

      const relListData = await relListRes.json();
      const firstRelease = relListData?.items?.[0];

      if (!firstRelease?.releaseNo) {
        setRows([]);
        return;
      }

      setReleaseNo(firstRelease.releaseNo);

      const detailRes = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/business-config/releases/${firstRelease.releaseNo}`,
      );
      if (!detailRes.ok) {
        setError(await getApiErrorMessage(detailRes, 'Failed to fetch release detail.'));
        return;
      }

      const detail = await detailRes.json();
      setEffectiveDate(detail.effectiveFrom ?? detail.publishedAt ?? null);

      const assets: AssetRow[] = (detail.items ?? []).map((item: { businessKey: string; payload: Record<string, unknown> }) => {
        const p = item.payload;
        return {
          assetNo: String(p.assetNo ?? item.businessKey),
          code: String(p.code ?? ''),
          type: (p.type as 'FIAT' | 'CRYPTO') ?? 'FIAT',
          network: String(p.network ?? ''),
          decimals: Number(p.decimals ?? 0),
          description: p.description ? String(p.description) : null,
          status: (p.status as 'ACTIVE' | 'DISABLED') ?? 'ACTIVE',
          depositEnabled: Boolean(p.depositEnabled),
          withdrawEnabled: Boolean(p.withdrawEnabled),
          depositMinAmount: String(p.depositMinAmount ?? ''),
          depositMaxAmount: p.depositMaxAmount != null ? String(p.depositMaxAmount) : null,
          withdrawMinAmount: String(p.withdrawMinAmount ?? ''),
          withdrawMaxAmount: p.withdrawMaxAmount != null ? String(p.withdrawMaxAmount) : null,
          minConfirmations: p.minConfirmations != null ? Number(p.minConfirmations) : null,
        };
      });

      setRows(assets);
    } catch (err) {
      if (err instanceof AdminSessionError) return;
      setError('Failed to load assets.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchData();
  }, []);

  const fi =
    'h-[30px] rounded border border-adm-border bg-adm-bg px-2.5 font-mono text-[11px] text-adm-t1 placeholder:text-adm-t3 outline-none focus:border-adm-amber transition-colors';

  const visibleRows = rows.filter((r) => {
    if (filters.type && r.type !== filters.type) return false;
    if (filters.status && r.status !== filters.status) return false;
    return true;
  });

  return (
    <div className="flex h-full flex-col overflow-hidden">

      {/* Title bar */}
      <PageTitleBar
        title="Assets"
        meta={`${rows.length} asset${rows.length === 1 ? '' : 's'} · System`}
      >
        <button
          onClick={() => navigate('/dashboard/system/asset-configs/history')}
          className={adminButtonClass('listSecondary')}
        >
          <Clock size={13} />
          Version History
        </button>
        <button
          onClick={() => void fetchData()}
          className={adminIconButtonClass()}
          title="Refresh"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </PageTitleBar>

      {/* Filter bar */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-adm-border bg-adm-panel px-5 py-2">
        <select
          value={filters.type}
          onChange={(e) => setFilters((p) => ({ ...p, type: e.target.value }))}
          className={`${fi} w-36`}
        >
          <option value="">All types</option>
          <option value="FIAT">FIAT</option>
          <option value="CRYPTO">CRYPTO</option>
        </select>
        <select
          value={filters.status}
          onChange={(e) => setFilters((p) => ({ ...p, status: e.target.value }))}
          className={`${fi} w-36`}
        >
          <option value="">All statuses</option>
          <option value="ACTIVE">ACTIVE</option>
          <option value="DISABLED">DISABLED</option>
        </select>
        {releaseNo && (
          <span className="ml-auto font-mono text-[10px] text-adm-t3">
            {releaseNo}
          </span>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="shrink-0 border-b border-adm-red/20 bg-adm-red/6 px-5 py-2.5 font-mono text-[11px] text-adm-red">
          {error}
        </div>
      )}

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <th className="w-1 border-b border-adm-border bg-adm-panel" />
              {COLS.map((label) => (
                <th
                  key={label}
                  className="border-b border-adm-border bg-adm-panel px-4 py-2 text-left font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-adm-t3 whitespace-nowrap"
                >
                  {label}
                </th>
              ))}
              <th className="w-8 border-b border-adm-border bg-adm-panel" />
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={COLS.length + 2} className="px-4 py-10 text-center font-mono text-[11px] text-adm-t3">
                  Loading…
                </td>
              </tr>
            )}
            {!loading && visibleRows.length === 0 && (
              <tr>
                <td colSpan={COLS.length + 2} className="px-4 py-10 text-center font-mono text-[11px] text-adm-t3">
                  No assets found.
                </td>
              </tr>
            )}
            {!loading && visibleRows.map((row) => (
              <tr
                key={row.assetNo}
                className="cursor-pointer border-b border-adm-border transition-colors hover:bg-adm-hover"
                onClick={() => navigate(`/dashboard/system/asset-configs/${row.assetNo}`)}
              >
                {/* Type accent strip */}
                <td className="py-3 pl-3">
                  <div
                    className={`h-5 w-0.5 rounded-full ${
                      row.type === 'CRYPTO' ? 'bg-adm-amber' : 'bg-adm-blue'
                    }`}
                  />
                </td>

                {/* Asset: type badge + code + assetNo */}
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <TypeBadge type={row.type} />
                    <span className="font-mono text-[11px] font-semibold text-adm-amber">
                      {row.code}
                    </span>
                    <span className="font-mono text-[10px] text-adm-t3">
                      {row.assetNo}
                    </span>
                  </div>
                </td>

                {/* Network */}
                <td className="px-4 py-3 font-mono text-[11px] text-adm-t2 whitespace-nowrap">
                  {row.network || <span className="text-adm-t3">—</span>}
                </td>

                {/* Status from payload */}
                <td className="px-4 py-3">
                  <AdminBadge value={row.status} />
                </td>

                {/* Deposit enabled */}
                <td className="px-4 py-3">
                  <EnabledDot v={row.depositEnabled} />
                </td>
                {/* Deposit range */}
                <td className="px-4 py-3">
                  <AmtRange min={row.depositMinAmount} max={row.depositMaxAmount} />
                </td>
                {/* Withdraw enabled */}
                <td className="px-4 py-3">
                  <EnabledDot v={row.withdrawEnabled} />
                </td>
                {/* Withdraw range */}
                <td className="px-4 py-3">
                  <AmtRange min={row.withdrawMinAmount} max={row.withdrawMaxAmount} />
                </td>
                {/* Min confirmations */}
                <td className="px-4 py-3 font-mono text-[11px] tabular-nums whitespace-nowrap">
                  {row.type === 'CRYPTO' && row.minConfirmations != null ? (
                    <span className="text-adm-t2">{row.minConfirmations}</span>
                  ) : (
                    <span className="text-adm-t3">—</span>
                  )}
                </td>

                {/* Chevron */}
                <td className="pr-4 py-3 text-right font-mono text-[12px] text-adm-t3">
                  ›
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Footer */}
      <div className="shrink-0 border-t border-adm-border bg-adm-panel px-5 py-2.5">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[10px] text-adm-t3">
            {rows.length > 0
              ? `${visibleRows.length} / ${rows.length} asset${rows.length === 1 ? '' : 's'}`
              : 'No assets'}
          </span>
          {effectiveDate && (
            <span className="font-mono text-[10px] text-adm-t3">
              Config effective{' '}
              {new Date(effectiveDate).toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
              })}
            </span>
          )}
        </div>
      </div>

    </div>
  );
};

export default AssetConfigList;
```

- [ ] **Step 2: Commit**

```bash
git add admin-web/src/pages/AssetConfigList.tsx
git commit -m "refactor(admin): AssetConfigList reads all data from release payload only"
```

---

## Task 6: Update `AssetConfigDetail.tsx` — use payload for registry fields

**Files:**
- Modify: `admin-web/src/pages/AssetConfigDetail.tsx`

**What changes:** Currently fetches `/assets?assetNo=...` separately to get `decimals`, `status`, `description`. After the merge these fields live in the payload. Remove the secondary fetch and the `RegistryInfo` type; read from payload directly.

- [ ] **Step 1: Remove the `RegistryInfo` type and `/assets` fetch; add new payload fields**

Replace the file (preserving the two-panel layout structure):

```tsx
import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { DetailPageHeader } from '../components/compliance/DetailPageComponents';
import { AdminBadge } from '../components/ui/AdminBadge';
import {
  AdminSessionError,
  adminFetch,
  getApiErrorMessage,
} from '../utils/adminFetch';

/* ── Types ─────────────────────────────────────────────────────── */

interface AssetPayload {
  assetNo: string;
  code: string;
  type: 'FIAT' | 'CRYPTO';
  network: string;
  decimals: number;
  description: string | null;
  status: 'ACTIVE' | 'DISABLED';
  depositEnabled: boolean;
  withdrawEnabled: boolean;
  depositMinAmount: string;
  depositMaxAmount: string | null;
  withdrawMinAmount: string;
  withdrawMaxAmount: string | null;
  minConfirmations: number | null;
}

interface ReleaseContext {
  releaseNo: string;
  publishedAt: string | null;
  effectiveFrom: string | null;
}

/* ── Local layout primitives ─────────────────────────────────────── */

const Cap = ({ children }: { children: ReactNode }) => (
  <p className="font-mono text-[8.5px] font-semibold uppercase tracking-[0.16em] text-adm-t3">
    {children}
  </p>
);

const FieldGrid = ({ children, cols = 2 }: { children: ReactNode; cols?: 1 | 2 }) => (
  <div
    className={[
      'grid gap-x-8 gap-y-4',
      cols === 1 ? 'grid-cols-1' : 'grid-cols-2',
    ].join(' ')}
  >
    {children}
  </div>
);

const Field = ({
  label,
  value,
  mono = false,
  amber = false,
  full = false,
}: {
  label: string;
  value?: string | null;
  mono?: boolean;
  amber?: boolean;
  full?: boolean;
}) => {
  if (value === null || value === undefined || value === '') return null;
  return (
    <div className={full ? 'col-span-2' : ''}>
      <p className="mb-1 font-mono text-[8.5px] uppercase tracking-[0.14em] text-adm-t3">
        {label}
      </p>
      <p
        className={[
          'break-all leading-relaxed',
          mono ? 'font-mono text-[10px]' : 'text-[11px]',
          amber ? 'font-semibold text-adm-amber' : 'text-adm-t2',
        ].join(' ')}
      >
        {value}
      </p>
    </div>
  );
};

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
  value?: ReactNode;
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

const TypeBadge = ({ type }: { type: 'FIAT' | 'CRYPTO' }) => (
  <span
    className={`inline-flex items-center rounded border px-1.5 py-0.5 font-mono text-[9px] font-bold tracking-widest ${
      type === 'FIAT'
        ? 'border-adm-blue/25 bg-adm-blue/10 text-adm-blue'
        : 'border-adm-amber/25 bg-adm-amber/10 text-adm-amber'
    }`}
  >
    {type}
  </span>
);

/* ── Helpers ─────────────────────────────────────────────────────── */

const fmtDate = (v?: string | null): string => {
  if (!v) return '—';
  const d = new Date(Number(v));
  if (Number.isNaN(d.getTime())) {
    const d2 = new Date(v);
    return Number.isNaN(d2.getTime()) ? v : d2.toLocaleString();
  }
  return d.toLocaleString();
};

/* ── Component ─────────────────────────────────────────────────── */

const AssetConfigDetail = () => {
  const { assetNo } = useParams<{ assetNo: string }>();
  const navigate = useNavigate();

  const [payload, setPayload] = useState<AssetPayload | null>(null);
  const [release, setRelease] = useState<ReleaseContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const relListRes = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/business-config/releases?subjectType=ASSET_CONFIG&status=ACTIVE&take=1`,
      );

      if (!relListRes.ok)
        throw new Error(await getApiErrorMessage(relListRes, 'Failed to fetch releases.'));

      const listData = await relListRes.json();
      const first = listData?.items?.[0];
      if (!first?.releaseNo) throw new Error('No active ASSET_CONFIG release found.');

      const detailRes = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/business-config/releases/${first.releaseNo}`,
      );
      if (!detailRes.ok)
        throw new Error(await getApiErrorMessage(detailRes, 'Failed to fetch release detail.'));

      const detail = await detailRes.json();
      const item = detail.items?.find(
        (i: { businessKey: string }) => i.businessKey === assetNo,
      );
      if (!item) throw new Error(`Asset "${assetNo}" not found in current release.`);

      setPayload(item.payload as AssetPayload);
      setRelease({
        releaseNo: detail.releaseNo,
        publishedAt: detail.publishedAt ?? null,
        effectiveFrom: detail.effectiveFrom ?? null,
      });
    } catch (err) {
      if (err instanceof AdminSessionError) return;
      setError(err instanceof Error ? err.message : 'Failed to load asset.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchData();
  }, [assetNo]);

  /* ── Loading stub ── */
  if (loading && !payload) {
    return (
      <div className="flex h-full items-center justify-center gap-3">
        <p className="font-mono text-[11px] text-adm-t3">Loading…</p>
      </div>
    );
  }

  /* ── Error stub ── */
  if (error && !payload) {
    return (
      <div className="flex h-full flex-col overflow-hidden">
        <div className="shrink-0 border-b border-adm-border bg-adm-panel px-6 py-4 flex items-center gap-2">
          <button
            onClick={() => navigate('/dashboard/system/asset-configs')}
            className="inline-flex items-center gap-1.5 rounded border border-adm-border bg-adm-panel px-3 py-1.5 font-mono text-[11px] text-adm-t2 hover:bg-adm-hover"
          >
            ← Assets
          </button>
        </div>
        <div className="px-6 py-6">
          <div className="rounded-lg border border-adm-red/30 bg-adm-red/10 px-4 py-3 font-mono text-[11px] text-adm-red">
            {error}
          </div>
        </div>
      </div>
    );
  }

  if (!payload) return null;

  const isCrypto = payload.type === 'CRYPTO';
  const effectiveDate = release?.effectiveFrom ?? release?.publishedAt;

  return (
    <div className="flex h-full flex-col overflow-hidden">

      {/* ── Sticky header ── */}
      <DetailPageHeader
        title="Asset · Operational Config"
        subtitle={`${payload.code}${payload.network ? ` · ${payload.network}` : ''}`}
        onBack={() => navigate('/dashboard/system/asset-configs')}
        onRefresh={() => void fetchData()}
        refreshing={loading}
        backLabel="Assets"
      />

      {/* ── Inline error (after data loaded) ── */}
      {error && (
        <div className="shrink-0 px-6 pt-3 pb-1">
          <div className="rounded border border-adm-red/30 bg-adm-red/10 px-4 py-2 font-mono text-[11px] text-adm-red">
            {error}
          </div>
        </div>
      )}

      {/* ── Body ── */}
      <div className="flex min-h-0 flex-1 overflow-hidden">

        {/* ════ LEFT MAIN ════ */}
        <div className="flex min-w-0 flex-1 flex-col divide-y divide-adm-border overflow-y-auto">

          {/* ① Identity */}
          <section className="bg-adm-card px-6 py-5">
            <Cap>Asset</Cap>
            <div className="mt-1.5 flex items-baseline gap-2">
              <p className="font-mono text-[19px] font-bold leading-snug text-adm-amber">
                {payload.code}
              </p>
              {payload.network && (
                <span className="font-mono text-[13px] text-adm-t3">
                  · {payload.network}
                </span>
              )}
            </div>
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              <TypeBadge type={payload.type} />
              <AdminBadge value={payload.status} />
            </div>
            <div className="mt-4 border-t border-adm-border pt-4">
              <p className="font-mono text-[11px] text-adm-t2">{payload.assetNo}</p>
              {payload.description && (
                <p className="mt-1 font-mono text-[10px] text-adm-t3">{payload.description}</p>
              )}
            </div>
          </section>

          {/* ② Deposit */}
          <section className="px-6 py-5">
            <Cap>Deposit</Cap>
            <div className="mt-3">
              <FieldGrid>
                <Field
                  label="Enabled"
                  value={payload.depositEnabled ? 'Yes' : 'No'}
                  amber={payload.depositEnabled}
                />
                <Field
                  label="Min Amount"
                  value={`${payload.depositMinAmount} ${payload.code}`}
                  mono
                />
                <Field
                  label="Max Amount"
                  value={payload.depositMaxAmount ? `${payload.depositMaxAmount} ${payload.code}` : 'No limit'}
                  mono
                />
              </FieldGrid>
            </div>
          </section>

          {/* ③ Withdrawal */}
          <section className="px-6 py-5">
            <Cap>Withdrawal</Cap>
            <div className="mt-3">
              <FieldGrid>
                <Field
                  label="Enabled"
                  value={payload.withdrawEnabled ? 'Yes' : 'No'}
                  amber={payload.withdrawEnabled}
                />
                <Field
                  label="Min Amount"
                  value={`${payload.withdrawMinAmount} ${payload.code}`}
                  mono
                />
                <Field
                  label="Max Amount"
                  value={payload.withdrawMaxAmount ? `${payload.withdrawMaxAmount} ${payload.code}` : 'No limit'}
                  mono
                />
              </FieldGrid>
            </div>
          </section>

          {/* ④ Blockchain (CRYPTO only) */}
          {isCrypto && (
            <section className="px-6 py-5">
              <Cap>Blockchain</Cap>
              <div className="mt-3">
                <FieldGrid>
                  <Field
                    label="Min Confirmations"
                    value={
                      payload.minConfirmations != null
                        ? `${payload.minConfirmations} blocks`
                        : '—'
                    }
                    mono
                  />
                </FieldGrid>
              </div>
            </section>
          )}

        </div>

        {/* ════ RIGHT SIDEBAR ════ */}
        <div className="w-[272px] min-w-[272px] overflow-y-auto border-l border-adm-border bg-adm-panel px-4 py-1">

          {/* Release */}
          {release && (
            <SidebarGroup title="Release">
              <SidebarKV label="Release No"   value={release.releaseNo}            mono />
              <SidebarKV label="Effective"    value={fmtDate(effectiveDate)}       mono />
              <SidebarKV label="Published"    value={fmtDate(release.publishedAt)} mono />
            </SidebarGroup>
          )}

          {/* Asset Properties */}
          <SidebarGroup title="Properties">
            <SidebarKV label="Decimals" value={String(payload.decimals)} mono />
          </SidebarGroup>

          {/* Navigation */}
          <SidebarGroup title="History">
            <button
              onClick={() => navigate('/dashboard/system/asset-configs/history')}
              className="text-left font-mono text-[10px] text-adm-amber underline transition-opacity hover:opacity-75"
            >
              View all versions →
            </button>
          </SidebarGroup>

        </div>
      </div>

    </div>
  );
};

export default AssetConfigDetail;
```

- [ ] **Step 2: Commit**

```bash
git add admin-web/src/pages/AssetConfigDetail.tsx
git commit -m "refactor(admin): AssetConfigDetail reads decimals/status/description from release payload"
```

---

## Task 7: Remove `AssetCreate` route from `App.tsx`

**Files:**
- Modify: `admin-web/src/App.tsx` (lines ~40 and ~835–838)

- [ ] **Step 1: Remove the lazy import and the route**

In `App.tsx`:

1. Remove the lazy import (line ~40):
```typescript
// DELETE this line:
const AssetCreate = lazy(() => import('./pages/AssetCreate'));
```

2. Remove the route block (lines ~835–838):
```typescript
// DELETE this block:
<Route
  path="system/assets/create"
  element={withPermission(<AssetCreate />, [PERMISSIONS.ASSETS_CREATE])}
/>
```

- [ ] **Step 2: Verify no TypeScript errors**

```bash
cd admin-web && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add admin-web/src/App.tsx
git commit -m "chore(admin): remove deprecated AssetCreate route"
```

---

## Self-Review

### Spec Coverage

| Requirement | Task(s) |
|-------------|---------|
| Add decimals/description/status to manifest type | Task 1 |
| Fill `projectAssetConfig()` to upsert `assets` table | Task 2 |
| Validation no longer requires Registry cross-check | Task 2 |
| Validate new fields (decimals, status) | Task 2 |
| Apply new release (upsert existing assets) | Task 4 |
| Deprecate POST /assets | Task 3 |
| AssetConfigList uses payload only | Task 5 |
| AssetConfigDetail uses payload for decimals/status/description | Task 6 |
| Remove AssetCreate route | Task 7 |

### No Placeholder Check

All code blocks contain complete, working implementations. No "TBD" or "TODO" markers.

### Type Consistency

- `AssetConfigManifestItem` (Task 1) adds: `decimals: number`, `description: string | null`, `status: 'ACTIVE' | 'DISABLED'`
- `projectAssetConfig()` (Task 2) reads: `payload.decimals`, `payload.description`, `payload.status` — matches
- `AssetRow` (Task 5) includes: `decimals`, `description`, `status` — matches payload type
- `AssetPayload` (Task 6) includes: `decimals`, `description`, `status` — matches manifest type
- All `assetNo` references use `String(payload.assetNo)` for safety

### Ordering Note

Task 4 (apply new release via scripts) must run after Tasks 1–3 are deployed (API server restarted). Tasks 5–7 are frontend-only and can run in parallel with Tasks 1–3.
