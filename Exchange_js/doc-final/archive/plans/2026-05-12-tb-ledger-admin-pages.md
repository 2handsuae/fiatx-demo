# TB Ledger Admin Pages — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 3 read-only list pages (TB Accounts, TB Transfers, TB Backlog) under the Accounting sidebar group to surface TigerBeetle ledger data in the admin panel.

**Architecture:** Backend adds a single `TbAdminController` with 3 GET endpoints wrapping existing `TbAccountRegistryService` and `TbEvidenceService` methods. Frontend adds 3 list pages following the CoaList pattern (4-zone layout with `adm-*` design tokens, `adminFetch`, pagination). RBAC catalog gets 3 new route entries under `ACCOUNTING_CONFIG_READ`.

**Tech Stack:** NestJS (backend controller + service methods), React + Vite (frontend pages), Prisma (ORM queries), TailwindCSS (`adm-*` design tokens)

---

## File Structure

### Backend (`src/modules/accounting/tigerbeetle/`)
- **Modify:** `tb-account-registry.service.ts` — add `findAll()` method
- **Modify:** `tb-evidence.service.ts` — add `transferType` filter to `findAll()`, rename `data` → `items`, add `findBacklog()` method
- **Create:** `tb-admin.controller.ts` — 3 GET endpoints at `/admin/tb/*`
- **Modify:** `tigerbeetle.module.ts` — register `TbAdminController`
- **Modify:** `../../../modules/identity/access-control/rbac.catalog.ts` — add 3 route entries

### Frontend (`admin-web/src/`)
- **Create:** `pages/TbAccountList.tsx`
- **Create:** `pages/TbTransferList.tsx`
- **Create:** `pages/TbBacklogList.tsx`
- **Modify:** `rbac/permissions.ts` — add `ACCOUNTING_TB_*` permission constants
- **Modify:** `components/DashboardLayout.tsx` — add 3 sidebar entries under Accounting
- **Modify:** `App.tsx` — add 3 routes under `/ledger`

---

### Task 1: Backend — Add `findAll()` to `TbAccountRegistryService`

**Files:**
- Modify: `src/modules/accounting/tigerbeetle/tb-account-registry.service.ts`

- [ ] **Step 1: Add `findAll` method to `TbAccountRegistryService`**

Open `src/modules/accounting/tigerbeetle/tb-account-registry.service.ts` and add the following method after the existing `findByTbAccountId` method:

```typescript
async findAll(filters: {
  assetCode?: string;
  ownerType?: string;
  code?: number;
  skip?: number;
  take?: number;
}) {
  const where: any = {};
  if (filters.assetCode) where.assetCode = filters.assetCode;
  if (filters.ownerType) where.ownerType = filters.ownerType;
  if (filters.code !== undefined) where.code = filters.code;

  const [items, total] = await Promise.all([
    (this.prisma as any).tbAccountRegistry.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: filters.skip ?? 0,
      take: filters.take ?? 50,
    }),
    (this.prisma as any).tbAccountRegistry.count({ where }),
  ]);

  return { items, total };
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd Exchange_js && npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No errors related to `tb-account-registry.service.ts`

- [ ] **Step 3: Commit**

```bash
git add src/modules/accounting/tigerbeetle/tb-account-registry.service.ts
git commit -m "feat(tb): add findAll() to TbAccountRegistryService for paginated account listing"
```

---

### Task 2: Backend — Extend `TbEvidenceService` with `transferType` filter and `findBacklog()`

**Files:**
- Modify: `src/modules/accounting/tigerbeetle/tb-evidence.service.ts`

- [ ] **Step 1: Add `transferType` filter to `findAll()` and rename `data` → `items`**

In `src/modules/accounting/tigerbeetle/tb-evidence.service.ts`, modify the existing `findAll` method. The current method signature is:

```typescript
async findAll(filters: {
  sourceType?: string;
  assetCode?: string;
  eventCode?: string;
  actorType?: string;
  actorId?: string;
  skip?: number;
  take?: number;
})
```

Replace the entire `findAll` method with:

```typescript
async findAll(filters: {
  sourceType?: string;
  assetCode?: string;
  eventCode?: string;
  transferType?: string;
  actorType?: string;
  actorId?: string;
  skip?: number;
  take?: number;
}) {
  const where: any = {};
  if (filters.sourceType) where.sourceType = filters.sourceType;
  if (filters.assetCode) where.assetCode = filters.assetCode;
  if (filters.eventCode) where.eventCode = filters.eventCode;
  if (filters.transferType) where.transferType = filters.transferType;
  if (filters.actorType) where.actorType = filters.actorType;
  if (filters.actorId) where.actorId = filters.actorId;

  const [items, total] = await Promise.all([
    (this.prisma as any).tbTransferEvidence.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: filters.skip ?? 0,
      take: filters.take ?? 50,
    }),
    (this.prisma as any).tbTransferEvidence.count({ where }),
  ]);

  return { items, total };
}
```

Key changes: added `transferType` filter, renamed `data` → `items`.

- [ ] **Step 2: Add `findBacklog()` method**

Add the following method after `findAll`:

```typescript
async findBacklog(filters: {
  status?: string;
  skip?: number;
  take?: number;
}) {
  const where: any = {};
  if (filters.status) where.status = filters.status;

  const [items, total] = await Promise.all([
    (this.prisma as any).tbEvidenceBacklog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: filters.skip ?? 0,
      take: filters.take ?? 50,
    }),
    (this.prisma as any).tbEvidenceBacklog.count({ where }),
  ]);

  return { items, total };
}
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd Exchange_js && npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No errors related to `tb-evidence.service.ts`

- [ ] **Step 4: Commit**

```bash
git add src/modules/accounting/tigerbeetle/tb-evidence.service.ts
git commit -m "feat(tb): add transferType filter to findAll, rename data→items, add findBacklog()"
```

---

### Task 3: Backend — Create `TbAdminController` and register in module

**Files:**
- Create: `src/modules/accounting/tigerbeetle/tb-admin.controller.ts`
- Modify: `src/modules/accounting/tigerbeetle/tigerbeetle.module.ts`
- Modify: `src/modules/identity/access-control/rbac.catalog.ts`

- [ ] **Step 1: Create `TbAdminController`**

Create file `src/modules/accounting/tigerbeetle/tb-admin.controller.ts`:

```typescript
import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { AdminPermissionGuard } from 'src/modules/identity/access-control/admin-permission.guard';
import { TbAccountRegistryService } from './tb-account-registry.service';
import { TbEvidenceService } from './tb-evidence.service';

@ApiTags('TB Ledger Admin')
@Controller('admin/tb')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
export class TbAdminController {
  constructor(
    private readonly tbAccountRegistryService: TbAccountRegistryService,
    private readonly tbEvidenceService: TbEvidenceService,
  ) {}

  @Get('accounts')
  @ApiOperation({ summary: 'List TB account registry entries' })
  findAccounts(
    @Query('skip') skip?: string,
    @Query('take') take?: string,
    @Query('assetCode') assetCode?: string,
    @Query('ownerType') ownerType?: string,
    @Query('code') code?: string,
  ) {
    return this.tbAccountRegistryService.findAll({
      assetCode: assetCode || undefined,
      ownerType: ownerType || undefined,
      code: code ? Number(code) : undefined,
      skip: skip ? Number(skip) : 0,
      take: take ? Number(take) : 50,
    });
  }

  @Get('transfers')
  @ApiOperation({ summary: 'List TB transfer evidence entries' })
  findTransfers(
    @Query('skip') skip?: string,
    @Query('take') take?: string,
    @Query('sourceType') sourceType?: string,
    @Query('assetCode') assetCode?: string,
    @Query('eventCode') eventCode?: string,
    @Query('transferType') transferType?: string,
  ) {
    return this.tbEvidenceService.findAll({
      sourceType: sourceType || undefined,
      assetCode: assetCode || undefined,
      eventCode: eventCode || undefined,
      transferType: transferType || undefined,
      skip: skip ? Number(skip) : 0,
      take: take ? Number(take) : 50,
    });
  }

  @Get('backlog')
  @ApiOperation({ summary: 'List TB evidence backlog entries' })
  findBacklog(
    @Query('skip') skip?: string,
    @Query('take') take?: string,
    @Query('status') status?: string,
  ) {
    return this.tbEvidenceService.findBacklog({
      status: status || undefined,
      skip: skip ? Number(skip) : 0,
      take: take ? Number(take) : 50,
    });
  }
}
```

- [ ] **Step 2: Register controller in `TigerBeetleModule`**

Open `src/modules/accounting/tigerbeetle/tigerbeetle.module.ts`. Add import and register the controller:

Current file:
```typescript
import { Module } from '@nestjs/common';
import { TigerBeetleService } from './tigerbeetle.service';
import { AccountingService } from './accounting.service';
import { TbEvidenceService } from './tb-evidence.service';
import { TbAccountRegistryService } from './tb-account-registry.service';

@Module({
  providers: [
    TigerBeetleService,
    AccountingService,
    TbEvidenceService,
    TbAccountRegistryService,
  ],
  exports: [
    AccountingService,
    TbEvidenceService,
    TbAccountRegistryService,
  ],
})
export class TigerBeetleModule {}
```

Add import for the controller and a `controllers` array:

```typescript
import { Module } from '@nestjs/common';
import { TigerBeetleService } from './tigerbeetle.service';
import { AccountingService } from './accounting.service';
import { TbEvidenceService } from './tb-evidence.service';
import { TbAccountRegistryService } from './tb-account-registry.service';
import { TbAdminController } from './tb-admin.controller';

@Module({
  controllers: [TbAdminController],
  providers: [
    TigerBeetleService,
    AccountingService,
    TbEvidenceService,
    TbAccountRegistryService,
  ],
  exports: [
    AccountingService,
    TbEvidenceService,
    TbAccountRegistryService,
  ],
})
export class TigerBeetleModule {}
```

- [ ] **Step 3: Add route entries to RBAC catalog**

Open `src/modules/identity/access-control/rbac.catalog.ts`. Find the accounting config section (around line 589-602, after `route('GET', '/clearing-templates/:id', ...)`). Add these 3 route entries:

```typescript
  // TB Ledger (read-only)
  route('GET', '/admin/tb/accounts', 'List TB account registry', ['ACCOUNTING_CONFIG_READ']),
  route('GET', '/admin/tb/transfers', 'List TB transfer evidence', ['ACCOUNTING_CONFIG_READ']),
  route('GET', '/admin/tb/backlog', 'List TB evidence backlog', ['ACCOUNTING_CONFIG_READ']),
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `cd Exchange_js && npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/modules/accounting/tigerbeetle/tb-admin.controller.ts \
        src/modules/accounting/tigerbeetle/tigerbeetle.module.ts \
        src/modules/identity/access-control/rbac.catalog.ts
git commit -m "feat(tb): add TbAdminController with 3 read-only endpoints for TB ledger pages"
```

---

### Task 4: Frontend — Add permissions, sidebar entries, and routes

**Files:**
- Modify: `admin-web/src/rbac/permissions.ts`
- Modify: `admin-web/src/components/DashboardLayout.tsx`
- Modify: `admin-web/src/App.tsx`

- [ ] **Step 1: Add TB permission constants**

Open `admin-web/src/rbac/permissions.ts`. Find the `ACCOUNTING_CONFIG_READ` entry (currently defined as `COA_READ: 'api.get.coa'`). After the `CLEARING_LINE_DETAIL_READ` entry at the end of the PERMISSIONS object, add:

```typescript
  TB_ACCOUNTS_READ: 'api.get.admin_tb_accounts',
  TB_TRANSFERS_READ: 'api.get.admin_tb_transfers',
  TB_BACKLOG_READ: 'api.get.admin_tb_backlog',
```

- [ ] **Step 2: Add sidebar entries under Accounting group**

Open `admin-web/src/components/DashboardLayout.tsx`. Find the Accounting group's `children` array (around line 265). It currently ends with the "Balance History" entry. After that entry, add 3 new items. You will need to import the `Database` icon from `lucide-react`.

Add this import at the top (merge with existing lucide-react import):
```typescript
import { Database } from 'lucide-react';
```

Then add these 3 children after the Balance History entry:

```typescript
        {
          path: '/ledger/tb-accounts',
          label: 'TB Accounts',
          icon: <Database size={13} />,
          requiredPermissions: [PERMISSIONS.TB_ACCOUNTS_READ],
        },
        {
          path: '/ledger/tb-transfers',
          label: 'TB Transfers',
          icon: <Database size={13} />,
          requiredPermissions: [PERMISSIONS.TB_TRANSFERS_READ],
        },
        {
          path: '/ledger/tb-backlog',
          label: 'TB Backlog',
          icon: <Database size={13} />,
          requiredPermissions: [PERMISSIONS.TB_BACKLOG_READ],
        },
```

- [ ] **Step 3: Add route registrations**

Open `admin-web/src/App.tsx`. Find the `/ledger` route group (around line 991). After the `balance-history` route (last route in the ledger group, before the closing `</Route>` for `/ledger`), add lazy imports at the top of the file and route entries.

Add these lazy imports alongside other page imports (look for existing `React.lazy` imports near the top):

```typescript
const TbAccountList = React.lazy(() => import('./pages/TbAccountList'));
const TbTransferList = React.lazy(() => import('./pages/TbTransferList'));
const TbBacklogList = React.lazy(() => import('./pages/TbBacklogList'));
```

Then add these 3 routes inside the `/ledger` parent route, after the `balance-history` route:

```typescript
            <Route
              path="tb-accounts"
              element={withPermission(<TbAccountList />, [PERMISSIONS.TB_ACCOUNTS_READ])}
            />
            <Route
              path="tb-transfers"
              element={withPermission(<TbTransferList />, [PERMISSIONS.TB_TRANSFERS_READ])}
            />
            <Route
              path="tb-backlog"
              element={withPermission(<TbBacklogList />, [PERMISSIONS.TB_BACKLOG_READ])}
            />
```

- [ ] **Step 4: Commit**

```bash
git add admin-web/src/rbac/permissions.ts \
        admin-web/src/components/DashboardLayout.tsx \
        admin-web/src/App.tsx
git commit -m "feat(admin): add TB permissions, sidebar entries, and route registrations"
```

---

### Task 5: Frontend — Create `TbAccountList.tsx`

**Files:**
- Create: `admin-web/src/pages/TbAccountList.tsx`

- [ ] **Step 1: Create the TB Accounts list page**

Create file `admin-web/src/pages/TbAccountList.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { adminIconButtonClass } from '../components/common/adminButtonStyles';
import { AdminBadge } from '../components/ui/AdminBadge';
import { PageTitleBar } from '../components/ui/PageTitleBar';
import Pagination from '../components/common/Pagination';
import {
  AdminSessionError,
  adminFetch,
  getApiErrorMessage,
} from '../utils/adminFetch';

interface TbAccountRow {
  tbAccountId: string;
  code: number;
  ledger: number;
  ownerType: string;
  ownerUuid: string | null;
  ownerNo: string | null;
  assetCode: string;
  status: string;
  description: string | null;
  flags: number;
  createdAt: string;
}

interface FilterState {
  assetCode: string;
  ownerType: string;
  code: string;
}

const CODE_LABELS: Record<number, string> = {
  1: 'BANK',
  10: 'CUSTODY',
  100: 'CLIENT_CREDIT',
  101: 'CLIENT_AUDIT',
  110: 'TRADE_CLEARING',
  120: 'FEE_RECEIVABLE',
};

const CODE_OPTIONS = [
  { value: '', label: 'All codes' },
  { value: '1', label: '1 · BANK' },
  { value: '10', label: '10 · CUSTODY' },
  { value: '100', label: '100 · CLIENT_CREDIT' },
  { value: '101', label: '101 · CLIENT_AUDIT' },
  { value: '110', label: '110 · TRADE_CLEARING' },
  { value: '120', label: '120 · FEE_RECEIVABLE' },
];

const DEFAULT_FILTERS: FilterState = { assetCode: '', ownerType: '', code: '' };
const PAGE_SIZE = 50;

const TbAccountList = () => {
  const [items, setItems] = useState<TbAccountRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const requestSeqRef = useRef(0);

  const fetchData = async (overridePage?: number) => {
    const seq = ++requestSeqRef.current;
    setLoading(true);
    setError(null);
    try {
      const p = overridePage ?? page;
      const params = new URLSearchParams();
      params.set('skip', String((p - 1) * PAGE_SIZE));
      params.set('take', String(PAGE_SIZE));
      if (filters.assetCode) params.set('assetCode', filters.assetCode);
      if (filters.ownerType) params.set('ownerType', filters.ownerType);
      if (filters.code) params.set('code', filters.code);

      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/tb/accounts?${params}`,
      );
      if (seq !== requestSeqRef.current) return;
      if (!res.ok) {
        setError(await getApiErrorMessage(res, 'Failed to fetch TB accounts.'));
        return;
      }
      const data = await res.json();
      setItems(data.items ?? []);
      setTotal(data.total ?? 0);
    } catch (err) {
      if (err instanceof AdminSessionError) return;
      if (seq !== requestSeqRef.current) return;
      setError('Failed to load TB accounts.');
    } finally {
      if (seq === requestSeqRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    void fetchData();
  }, [page]);

  const applyFilters = () => {
    setPage(1);
    void fetchData(1);
  };

  const fi =
    'h-[30px] rounded border border-adm-border bg-adm-bg px-2.5 font-mono text-[11px] text-adm-t1 placeholder:text-adm-t3 outline-none focus:border-adm-amber transition-colors';

  const formatDate = (d: string) =>
    new Date(d).toLocaleString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: false,
    });

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PageTitleBar
        title="TB Accounts"
        meta={`${total} account${total === 1 ? '' : 's'} · TigerBeetle Registry`}
      >
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
        <input
          placeholder="Asset code…"
          value={filters.assetCode}
          onChange={(e) => setFilters((p) => ({ ...p, assetCode: e.target.value }))}
          onKeyDown={(e) => e.key === 'Enter' && applyFilters()}
          className={`${fi} w-28`}
        />
        <select
          value={filters.ownerType}
          onChange={(e) => { setFilters((p) => ({ ...p, ownerType: e.target.value })); }}
          className={`${fi} w-36`}
        >
          <option value="">All owners</option>
          <option value="SYSTEM">SYSTEM</option>
          <option value="CUSTOMER">CUSTOMER</option>
          <option value="LP">LP</option>
        </select>
        <select
          value={filters.code}
          onChange={(e) => { setFilters((p) => ({ ...p, code: e.target.value })); }}
          className={`${fi} w-48`}
        >
          {CODE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <button
          onClick={applyFilters}
          className="h-[30px] rounded border border-adm-amber/30 bg-adm-amber/10 px-3 font-mono text-[11px] font-semibold text-adm-amber hover:bg-adm-amber/20 transition-colors"
        >
          Apply
        </button>
      </div>

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
              {['TB Account ID', 'Code', 'Ledger', 'Owner', 'Asset', 'Status', 'Created'].map((h) => (
                <th
                  key={h}
                  className="border-b border-adm-border bg-adm-panel px-4 py-2 text-left font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-adm-t3 whitespace-nowrap"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && items.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center font-mono text-[11px] text-adm-t3">Loading…</td>
              </tr>
            )}
            {!loading && items.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center font-mono text-[11px] text-adm-t3">No accounts found.</td>
              </tr>
            )}
            {items.map((row) => (
              <tr key={row.tbAccountId} className="border-b border-adm-border transition-colors hover:bg-adm-hover">
                <td className="px-4 py-3 font-mono text-[11px] text-adm-t1 max-w-[200px] truncate" title={row.tbAccountId}>
                  {row.tbAccountId}
                </td>
                <td className="px-4 py-3">
                  <span className="inline-flex items-center gap-1.5 font-mono text-[11px]">
                    <span className="text-adm-t1 font-semibold">{row.code}</span>
                    <span className="text-adm-t3">·</span>
                    <span className="text-adm-amber text-[10px]">{CODE_LABELS[row.code] ?? '?'}</span>
                  </span>
                </td>
                <td className="px-4 py-3 font-mono text-[11px] text-adm-t2">{row.ledger}</td>
                <td className="px-4 py-3">
                  <AdminBadge value={row.ownerType} />
                  {row.ownerNo && (
                    <div className="mt-0.5 font-mono text-[10px] text-adm-t3 truncate max-w-[120px]" title={row.ownerNo}>
                      {row.ownerNo}
                    </div>
                  )}
                </td>
                <td className="px-4 py-3 font-mono text-[11px] font-semibold text-adm-t1">{row.assetCode}</td>
                <td className="px-4 py-3"><AdminBadge value={row.status} /></td>
                <td className="px-4 py-3 font-mono text-[11px] text-adm-t3 whitespace-nowrap">{formatDate(row.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Footer */}
      <div className="shrink-0 border-t border-adm-border bg-adm-panel px-5 py-2">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[10px] text-adm-t3">
            {total > 0 ? `Showing ${items.length} / ${total} accounts` : 'No accounts'}
          </span>
          <Pagination
            currentPage={page}
            totalItems={total}
            pageSize={PAGE_SIZE}
            onPageChange={setPage}
          />
        </div>
      </div>
    </div>
  );
};

export default TbAccountList;
```

- [ ] **Step 2: Verify frontend compiles**

Run: `cd Exchange_js/admin-web && npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No errors related to `TbAccountList.tsx`

- [ ] **Step 3: Commit**

```bash
git add admin-web/src/pages/TbAccountList.tsx
git commit -m "feat(admin): add TbAccountList page for TB account registry"
```

---

### Task 6: Frontend — Create `TbTransferList.tsx`

**Files:**
- Create: `admin-web/src/pages/TbTransferList.tsx`

- [ ] **Step 1: Create the TB Transfers list page**

Create file `admin-web/src/pages/TbTransferList.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { adminIconButtonClass } from '../components/common/adminButtonStyles';
import { AdminBadge } from '../components/ui/AdminBadge';
import { PageTitleBar } from '../components/ui/PageTitleBar';
import Pagination from '../components/common/Pagination';
import {
  AdminSessionError,
  adminFetch,
  getApiErrorMessage,
} from '../utils/adminFetch';

interface TbTransferRow {
  tbTransferId: string;
  sourceType: string;
  sourceNo: string;
  eventCode: string;
  debitCode: string;
  creditCode: string;
  amount: string;
  assetCode: string;
  transferType: string;
  traceId: string;
  actorType: string;
  actorId: string;
  memo: string | null;
  pendingId: string | null;
  createdAt: string;
}

interface FilterState {
  sourceType: string;
  assetCode: string;
  eventCode: string;
  transferType: string;
}

const DEFAULT_FILTERS: FilterState = { sourceType: '', assetCode: '', eventCode: '', transferType: '' };
const PAGE_SIZE = 50;

const TbTransferList = () => {
  const [items, setItems] = useState<TbTransferRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const requestSeqRef = useRef(0);

  const fetchData = async (overridePage?: number) => {
    const seq = ++requestSeqRef.current;
    setLoading(true);
    setError(null);
    try {
      const p = overridePage ?? page;
      const params = new URLSearchParams();
      params.set('skip', String((p - 1) * PAGE_SIZE));
      params.set('take', String(PAGE_SIZE));
      if (filters.sourceType) params.set('sourceType', filters.sourceType);
      if (filters.assetCode) params.set('assetCode', filters.assetCode);
      if (filters.eventCode) params.set('eventCode', filters.eventCode);
      if (filters.transferType) params.set('transferType', filters.transferType);

      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/tb/transfers?${params}`,
      );
      if (seq !== requestSeqRef.current) return;
      if (!res.ok) {
        setError(await getApiErrorMessage(res, 'Failed to fetch TB transfers.'));
        return;
      }
      const data = await res.json();
      setItems(data.items ?? []);
      setTotal(data.total ?? 0);
    } catch (err) {
      if (err instanceof AdminSessionError) return;
      if (seq !== requestSeqRef.current) return;
      setError('Failed to load TB transfers.');
    } finally {
      if (seq === requestSeqRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    void fetchData();
  }, [page]);

  const applyFilters = () => {
    setPage(1);
    void fetchData(1);
  };

  const fi =
    'h-[30px] rounded border border-adm-border bg-adm-bg px-2.5 font-mono text-[11px] text-adm-t1 placeholder:text-adm-t3 outline-none focus:border-adm-amber transition-colors';

  const formatDate = (d: string) =>
    new Date(d).toLocaleString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: false,
    });

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PageTitleBar
        title="TB Transfers"
        meta={`${total} transfer${total === 1 ? '' : 's'} · TigerBeetle Evidence`}
      >
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
          value={filters.sourceType}
          onChange={(e) => setFilters((p) => ({ ...p, sourceType: e.target.value }))}
          className={`${fi} w-36`}
        >
          <option value="">All sources</option>
          <option value="DEPOSIT">DEPOSIT</option>
          <option value="WITHDRAWAL">WITHDRAWAL</option>
          <option value="SWAP">SWAP</option>
          <option value="INTERNAL">INTERNAL</option>
          <option value="FEE">FEE</option>
        </select>
        <input
          placeholder="Asset code…"
          value={filters.assetCode}
          onChange={(e) => setFilters((p) => ({ ...p, assetCode: e.target.value }))}
          onKeyDown={(e) => e.key === 'Enter' && applyFilters()}
          className={`${fi} w-28`}
        />
        <input
          placeholder="Event code…"
          value={filters.eventCode}
          onChange={(e) => setFilters((p) => ({ ...p, eventCode: e.target.value }))}
          onKeyDown={(e) => e.key === 'Enter' && applyFilters()}
          className={`${fi} w-36`}
        />
        <select
          value={filters.transferType}
          onChange={(e) => setFilters((p) => ({ ...p, transferType: e.target.value }))}
          className={`${fi} w-40`}
        >
          <option value="">All types</option>
          <option value="POSTED">POSTED</option>
          <option value="PENDING">PENDING</option>
          <option value="POST_PENDING">POST_PENDING</option>
          <option value="VOID_PENDING">VOID_PENDING</option>
          <option value="CORRECTING">CORRECTING</option>
        </select>
        <button
          onClick={applyFilters}
          className="h-[30px] rounded border border-adm-amber/30 bg-adm-amber/10 px-3 font-mono text-[11px] font-semibold text-adm-amber hover:bg-adm-amber/20 transition-colors"
        >
          Apply
        </button>
      </div>

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
              {['Transfer ID', 'Source', 'Event', 'Debit → Credit', 'Amount', 'Asset', 'Type', 'Created'].map((h) => (
                <th
                  key={h}
                  className="border-b border-adm-border bg-adm-panel px-4 py-2 text-left font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-adm-t3 whitespace-nowrap"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && items.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center font-mono text-[11px] text-adm-t3">Loading…</td>
              </tr>
            )}
            {!loading && items.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center font-mono text-[11px] text-adm-t3">No transfers found.</td>
              </tr>
            )}
            {items.map((row) => (
              <tr key={row.tbTransferId} className="border-b border-adm-border transition-colors hover:bg-adm-hover">
                <td className="px-4 py-3 font-mono text-[11px] text-adm-t1 max-w-[180px] truncate" title={row.tbTransferId}>
                  {row.tbTransferId}
                </td>
                <td className="px-4 py-3">
                  <AdminBadge value={row.sourceType} />
                  <div className="mt-0.5 font-mono text-[10px] text-adm-t3 truncate max-w-[140px]" title={row.sourceNo}>
                    {row.sourceNo}
                  </div>
                </td>
                <td className="px-4 py-3 font-mono text-[11px] text-adm-t2">{row.eventCode}</td>
                <td className="px-4 py-3 font-mono text-[11px] text-adm-t1">
                  <span>{row.debitCode}</span>
                  <span className="mx-1 text-adm-t3">→</span>
                  <span>{row.creditCode}</span>
                </td>
                <td className="px-4 py-3 font-mono text-[11px] text-adm-t1 text-right tabular-nums">{row.amount}</td>
                <td className="px-4 py-3 font-mono text-[11px] font-semibold text-adm-t1">{row.assetCode}</td>
                <td className="px-4 py-3"><AdminBadge value={row.transferType} /></td>
                <td className="px-4 py-3 font-mono text-[11px] text-adm-t3 whitespace-nowrap">{formatDate(row.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Footer */}
      <div className="shrink-0 border-t border-adm-border bg-adm-panel px-5 py-2">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[10px] text-adm-t3">
            {total > 0 ? `Showing ${items.length} / ${total} transfers` : 'No transfers'}
          </span>
          <Pagination
            currentPage={page}
            totalItems={total}
            pageSize={PAGE_SIZE}
            onPageChange={setPage}
          />
        </div>
      </div>
    </div>
  );
};

export default TbTransferList;
```

- [ ] **Step 2: Verify frontend compiles**

Run: `cd Exchange_js/admin-web && npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No errors related to `TbTransferList.tsx`

- [ ] **Step 3: Commit**

```bash
git add admin-web/src/pages/TbTransferList.tsx
git commit -m "feat(admin): add TbTransferList page for TB transfer evidence"
```

---

### Task 7: Frontend — Create `TbBacklogList.tsx`

**Files:**
- Create: `admin-web/src/pages/TbBacklogList.tsx`

- [ ] **Step 1: Create the TB Backlog list page**

Create file `admin-web/src/pages/TbBacklogList.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { adminIconButtonClass } from '../components/common/adminButtonStyles';
import { AdminBadge } from '../components/ui/AdminBadge';
import { PageTitleBar } from '../components/ui/PageTitleBar';
import Pagination from '../components/common/Pagination';
import {
  AdminSessionError,
  adminFetch,
  getApiErrorMessage,
} from '../utils/adminFetch';

interface TbBacklogRow {
  id: string;
  tbTransferId: string;
  transferData: string;
  evidenceData: string;
  errorMessage: string;
  retryCount: number;
  status: string;
  createdAt: string;
  resolvedAt: string | null;
}

interface FilterState {
  status: string;
}

const DEFAULT_FILTERS: FilterState = { status: '' };
const PAGE_SIZE = 50;

const TbBacklogList = () => {
  const [items, setItems] = useState<TbBacklogRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const requestSeqRef = useRef(0);

  const fetchData = async (overridePage?: number) => {
    const seq = ++requestSeqRef.current;
    setLoading(true);
    setError(null);
    try {
      const p = overridePage ?? page;
      const params = new URLSearchParams();
      params.set('skip', String((p - 1) * PAGE_SIZE));
      params.set('take', String(PAGE_SIZE));
      if (filters.status) params.set('status', filters.status);

      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/tb/backlog?${params}`,
      );
      if (seq !== requestSeqRef.current) return;
      if (!res.ok) {
        setError(await getApiErrorMessage(res, 'Failed to fetch TB backlog.'));
        return;
      }
      const data = await res.json();
      setItems(data.items ?? []);
      setTotal(data.total ?? 0);
    } catch (err) {
      if (err instanceof AdminSessionError) return;
      if (seq !== requestSeqRef.current) return;
      setError('Failed to load TB backlog.');
    } finally {
      if (seq === requestSeqRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    void fetchData();
  }, [page]);

  const applyFilters = () => {
    setPage(1);
    void fetchData(1);
  };

  const fi =
    'h-[30px] rounded border border-adm-border bg-adm-bg px-2.5 font-mono text-[11px] text-adm-t1 placeholder:text-adm-t3 outline-none focus:border-adm-amber transition-colors';

  const formatDate = (d: string | null) => {
    if (!d) return '—';
    return new Date(d).toLocaleString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: false,
    });
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PageTitleBar
        title="TB Backlog"
        meta={`${total} entr${total === 1 ? 'y' : 'ies'} · Evidence Backlog`}
      >
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
          value={filters.status}
          onChange={(e) => setFilters((p) => ({ ...p, status: e.target.value }))}
          className={`${fi} w-36`}
        >
          <option value="">All statuses</option>
          <option value="PENDING">PENDING</option>
          <option value="RESOLVED">RESOLVED</option>
          <option value="FAILED">FAILED</option>
        </select>
        <button
          onClick={applyFilters}
          className="h-[30px] rounded border border-adm-amber/30 bg-adm-amber/10 px-3 font-mono text-[11px] font-semibold text-adm-amber hover:bg-adm-amber/20 transition-colors"
        >
          Apply
        </button>
      </div>

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
              {['Transfer ID', 'Error', 'Retries', 'Status', 'Created', 'Resolved'].map((h) => (
                <th
                  key={h}
                  className="border-b border-adm-border bg-adm-panel px-4 py-2 text-left font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-adm-t3 whitespace-nowrap"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && items.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center font-mono text-[11px] text-adm-t3">Loading…</td>
              </tr>
            )}
            {!loading && items.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center font-mono text-[11px] text-adm-t3">No backlog entries found.</td>
              </tr>
            )}
            {items.map((row) => (
              <tr key={row.id} className="border-b border-adm-border transition-colors hover:bg-adm-hover">
                <td className="px-4 py-3 font-mono text-[11px] text-adm-t1 max-w-[200px] truncate" title={row.tbTransferId}>
                  {row.tbTransferId}
                </td>
                <td className="px-4 py-3 font-mono text-[11px] text-adm-red max-w-[300px] truncate" title={row.errorMessage}>
                  {row.errorMessage}
                </td>
                <td className="px-4 py-3 font-mono text-[11px] text-adm-t2 text-center">{row.retryCount}</td>
                <td className="px-4 py-3"><AdminBadge value={row.status} /></td>
                <td className="px-4 py-3 font-mono text-[11px] text-adm-t3 whitespace-nowrap">{formatDate(row.createdAt)}</td>
                <td className="px-4 py-3 font-mono text-[11px] text-adm-t3 whitespace-nowrap">{formatDate(row.resolvedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Footer */}
      <div className="shrink-0 border-t border-adm-border bg-adm-panel px-5 py-2">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[10px] text-adm-t3">
            {total > 0 ? `Showing ${items.length} / ${total} entries` : 'No entries'}
          </span>
          <Pagination
            currentPage={page}
            totalItems={total}
            pageSize={PAGE_SIZE}
            onPageChange={setPage}
          />
        </div>
      </div>
    </div>
  );
};

export default TbBacklogList;
```

- [ ] **Step 2: Verify frontend compiles**

Run: `cd Exchange_js/admin-web && npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No errors related to `TbBacklogList.tsx`

- [ ] **Step 3: Commit**

```bash
git add admin-web/src/pages/TbBacklogList.tsx
git commit -m "feat(admin): add TbBacklogList page for TB evidence backlog"
```

---

### Task 8: Smoke Test — Start dev stack and verify pages render

**Files:** None (verification only)

- [ ] **Step 1: Start the dev stack**

Run: `cd Exchange_js && npm run dev:start`
Wait for backend (port 3500) and admin-web (port 3501) to be ready.

- [ ] **Step 2: Verify backend endpoints respond**

```bash
# Get auth token first
TOKEN=$(curl -s http://localhost:3500/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@fiatx.com","password":"123456"}' | jq -r '.accessToken')

# Test all 3 endpoints
curl -s -H "Authorization: Bearer $TOKEN" "http://localhost:3500/admin/tb/accounts?take=2" | jq '.total'
curl -s -H "Authorization: Bearer $TOKEN" "http://localhost:3500/admin/tb/transfers?take=2" | jq '.total'
curl -s -H "Authorization: Bearer $TOKEN" "http://localhost:3500/admin/tb/backlog?take=2" | jq '.total'
```

Expected: Each returns a number (0 or more). No 401/403/500 errors.

- [ ] **Step 3: Verify pages load in browser**

Open browser and navigate to:
1. `http://localhost:3501/ledger/tb-accounts` — should show TB Accounts page with table
2. `http://localhost:3501/ledger/tb-transfers` — should show TB Transfers page with table
3. `http://localhost:3501/ledger/tb-backlog` — should show TB Backlog page with table

Verify sidebar shows all 3 entries under Accounting group.

- [ ] **Step 4: Commit (if any fixes were needed)**

If smoke testing revealed issues that required fixes, commit those fixes now.
