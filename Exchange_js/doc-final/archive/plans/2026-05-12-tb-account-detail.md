# TB Account Detail Page — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a detail page for TB Account Registry entries showing registry metadata + real-time TigerBeetle balance.

**Architecture:** One new GET endpoint in `TbAdminController` merges registry row + TB balance. One new React page `TbAccountDetail.tsx` uses Pattern B sidebar layout. List page rows become clickable links.

**Tech Stack:** NestJS (backend endpoint), React + Tailwind `adm-*` tokens (frontend), TigerBeetle `lookupBalance` (balance query)

---

### File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `src/modules/accounting/tigerbeetle/tb-admin.controller.ts` | Add `GET /admin/tb/accounts/:tbAccountId` endpoint |
| Create | `src/modules/accounting/tigerbeetle/tb-admin.controller.spec.ts` | Unit test for the new endpoint |
| Modify | `admin-web/src/App.tsx` | Add lazy import + route for detail page |
| Modify | `admin-web/src/pages/TbAccountList.tsx` | Make rows clickable, extract CODE_LABELS to shared constant |
| Create | `admin-web/src/pages/tb-account.constants.ts` | Shared `CODE_LABELS` constant |
| Create | `admin-web/src/pages/TbAccountDetail.tsx` | Detail page component |

---

### Task 1: Backend — GET /admin/tb/accounts/:tbAccountId

**Files:**
- Modify: `src/modules/accounting/tigerbeetle/tb-admin.controller.ts`
- Test: `src/modules/accounting/tigerbeetle/tb-admin.controller.spec.ts`

**Context:** The controller already has `findAccounts` and `findTransfers`. We add `findOneAccount` which calls `TbAccountRegistryService.findByTbAccountId` for the registry row, then tries `AccountingService.lookupBalance` for the TB balance. The balance call wraps in try/catch — if TB is unavailable, balance fields return null.

- [ ] **Step 1: Write the failing test**

Create file `src/modules/accounting/tigerbeetle/tb-admin.controller.spec.ts`:

```ts
import { NotFoundException } from '@nestjs/common';
import { TbAdminController } from './tb-admin.controller';

describe('TbAdminController', () => {
  let controller: TbAdminController;
  let registryService: any;
  let accountingService: any;
  let evidenceService: any;

  beforeEach(() => {
    registryService = {
      findByTbAccountId: jest.fn(),
      findAll: jest.fn(),
    };
    accountingService = {
      lookupBalance: jest.fn(),
    };
    evidenceService = {
      findAll: jest.fn(),
      findBacklog: jest.fn(),
    };
    controller = new TbAdminController(
      registryService,
      evidenceService,
      accountingService,
    );
  });

  describe('findOneAccount', () => {
    const mockRegistry = {
      tbAccountId: 'abc123def456',
      code: 10,
      ledger: 2,
      ownerType: 'SYSTEM',
      ownerUuid: null,
      ownerNo: null,
      assetCode: 'USDT',
      status: 'ACTIVE',
      description: 'CUSTODY for USDT',
      flags: 0,
      createdAt: new Date('2026-05-12T00:00:00Z'),
    };

    it('returns registry + balance when TB is available', async () => {
      registryService.findByTbAccountId.mockResolvedValue(mockRegistry);
      accountingService.lookupBalance.mockResolvedValue({
        debitsPosted: 1000n,
        creditsPosted: 5000n,
        debitsPending: 200n,
        creditsPending: 0n,
      });

      const result = await controller.findOneAccount('abc123def456');

      expect(result.tbAccountId).toBe('abc123def456');
      expect(result.code).toBe(10);
      expect(result.debitsPosted).toBe('1000');
      expect(result.creditsPosted).toBe('5000');
      expect(result.debitsPending).toBe('200');
      expect(result.creditsPending).toBe('0');
      expect(result.netBalance).toBe('4000');
    });

    it('returns registry with null balance when TB is unavailable', async () => {
      registryService.findByTbAccountId.mockResolvedValue(mockRegistry);
      accountingService.lookupBalance.mockRejectedValue(new Error('TB connection refused'));

      const result = await controller.findOneAccount('abc123def456');

      expect(result.tbAccountId).toBe('abc123def456');
      expect(result.code).toBe(10);
      expect(result.debitsPosted).toBeNull();
      expect(result.creditsPosted).toBeNull();
      expect(result.netBalance).toBeNull();
    });

    it('throws 404 when registry entry not found', async () => {
      registryService.findByTbAccountId.mockResolvedValue(null);

      await expect(controller.findOneAccount('nonexistent')).rejects.toThrow(NotFoundException);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/modules/accounting/tigerbeetle/tb-admin.controller.spec.ts --no-coverage`
Expected: FAIL — `findOneAccount` is not a function on the controller

- [ ] **Step 3: Implement the endpoint**

Modify `src/modules/accounting/tigerbeetle/tb-admin.controller.ts` to this full content:

```ts
import { Controller, Get, Param, Query, UseGuards, NotFoundException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { AdminPermissionGuard } from 'src/modules/identity/access-control/admin-permission.guard';
import { TbAccountRegistryService } from './tb-account-registry.service';
import { TbEvidenceService } from './tb-evidence.service';
import { AccountingService } from './accounting.service';
import { hexToBigint } from './utils/tb-id.util';

@ApiTags('TB Ledger Admin')
@Controller('admin/tb')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
export class TbAdminController {
  constructor(
    private readonly tbAccountRegistryService: TbAccountRegistryService,
    private readonly tbEvidenceService: TbEvidenceService,
    private readonly accountingService: AccountingService,
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

  @Get('accounts/:tbAccountId')
  @ApiOperation({ summary: 'Get a single TB account with real-time balance' })
  async findOneAccount(@Param('tbAccountId') tbAccountId: string) {
    const registry = await this.tbAccountRegistryService.findByTbAccountId(tbAccountId);
    if (!registry) {
      throw new NotFoundException({
        code: 'TB_ACCOUNT_NOT_FOUND',
        message: `TB account ${tbAccountId} not found in registry`,
      });
    }

    let debitsPosted: string | null = null;
    let creditsPosted: string | null = null;
    let debitsPending: string | null = null;
    let creditsPending: string | null = null;
    let netBalance: string | null = null;

    try {
      const balance = await this.accountingService.lookupBalance(hexToBigint(tbAccountId));
      debitsPosted = balance.debitsPosted.toString();
      creditsPosted = balance.creditsPosted.toString();
      debitsPending = balance.debitsPending.toString();
      creditsPending = balance.creditsPending.toString();
      netBalance = (balance.creditsPosted - balance.debitsPosted).toString();
    } catch {
      // TB unavailable — balance fields stay null
    }

    return {
      ...registry,
      debitsPosted,
      creditsPosted,
      debitsPending,
      creditsPending,
      netBalance,
    };
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

Key changes from original:
- Added imports: `Param`, `NotFoundException`, `AccountingService`, `hexToBigint`
- Constructor gains `accountingService` parameter
- New `findOneAccount` method with `@Get('accounts/:tbAccountId')` (registered AFTER the list `@Get('accounts')` — NestJS matches top-down so static first)

- [ ] **Step 4: Update TigerBeetleModule to provide AccountingService to controller**

Check if `AccountingService` is already exported from `TigerBeetleModule`. If it is, the controller DI will resolve automatically. If not, ensure it's in the module's `providers` array. Read `tigerbeetle.module.ts` and verify — the controller is already registered there, and `AccountingService` is already a provider, so no changes needed.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest src/modules/accounting/tigerbeetle/tb-admin.controller.spec.ts --no-coverage`
Expected: PASS (3 tests)

- [ ] **Step 6: Run TypeScript check**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 7: Commit**

```bash
git add src/modules/accounting/tigerbeetle/tb-admin.controller.ts src/modules/accounting/tigerbeetle/tb-admin.controller.spec.ts
git commit -m "feat(admin): add GET /admin/tb/accounts/:tbAccountId endpoint with balance"
```

---

### Task 2: Frontend — Extract shared CODE_LABELS constant

**Files:**
- Create: `admin-web/src/pages/tb-account.constants.ts`
- Modify: `admin-web/src/pages/TbAccountList.tsx`

**Context:** Both TbAccountList and TbAccountDetail need the same CODE_LABELS map. Extract it to a shared file to avoid duplication.

- [ ] **Step 1: Create shared constants file**

Create `admin-web/src/pages/tb-account.constants.ts`:

```ts
export const TB_CODE_LABELS: Record<number, string> = {
  1: 'BANK',
  10: 'CUSTODY',
  100: 'CLIENT_CREDIT',
  101: 'CLIENT_AUDIT',
  110: 'TRADE_CLEARING',
  120: 'FEE_RECEIVABLE',
};

export const TB_CODE_OPTIONS = [
  { value: '', label: 'All codes' },
  { value: '1', label: '1 · BANK' },
  { value: '10', label: '10 · CUSTODY' },
  { value: '100', label: '100 · CLIENT_CREDIT' },
  { value: '101', label: '101 · CLIENT_AUDIT' },
  { value: '110', label: '110 · TRADE_CLEARING' },
  { value: '120', label: '120 · FEE_RECEIVABLE' },
];
```

- [ ] **Step 2: Update TbAccountList to import from shared file**

In `admin-web/src/pages/TbAccountList.tsx`:

Replace the local `CODE_LABELS` and `CODE_OPTIONS` definitions (lines 33-50) with imports:

```ts
import { TB_CODE_LABELS, TB_CODE_OPTIONS } from './tb-account.constants';
```

Then replace all references:
- `CODE_LABELS[row.code]` → `TB_CODE_LABELS[row.code]`
- `CODE_OPTIONS.map(...)` → `TB_CODE_OPTIONS.map(...)`

Remove the local `const CODE_LABELS` and `const CODE_OPTIONS` blocks.

- [ ] **Step 3: Run TypeScript check**

Run: `cd admin-web && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add admin-web/src/pages/tb-account.constants.ts admin-web/src/pages/TbAccountList.tsx
git commit -m "refactor(admin): extract TB code labels to shared constant"
```

---

### Task 3: Frontend — Make TbAccountList rows clickable

**Files:**
- Modify: `admin-web/src/pages/TbAccountList.tsx`

**Context:** Table rows currently have no click handler. Add `useNavigate` and `onClick` to route to the detail page.

- [ ] **Step 1: Add useNavigate import**

In `TbAccountList.tsx`, add to the import block:

```ts
import { useNavigate } from 'react-router-dom';
```

- [ ] **Step 2: Add navigate hook inside the component**

Inside the `TbAccountList` component function, after the existing state hooks:

```ts
const navigate = useNavigate();
```

- [ ] **Step 3: Make table rows clickable**

Replace the `<tr>` for each data row (the one inside `items.map`):

From:
```tsx
<tr key={row.tbAccountId} className="border-b border-adm-border transition-colors hover:bg-adm-hover">
```

To:
```tsx
<tr
  key={row.tbAccountId}
  className="border-b border-adm-border transition-colors hover:bg-adm-hover cursor-pointer"
  onClick={() => navigate(`/ledger/tb-accounts/${row.tbAccountId}`)}
>
```

- [ ] **Step 4: Run TypeScript check**

Run: `cd admin-web && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add admin-web/src/pages/TbAccountList.tsx
git commit -m "feat(admin): make TB account list rows clickable"
```

---

### Task 4: Frontend — TbAccountDetail page + route registration

**Files:**
- Create: `admin-web/src/pages/TbAccountDetail.tsx`
- Modify: `admin-web/src/App.tsx`

**Context:** New detail page following Pattern B sidebar layout. `DetailPageHeader` imported from `../components/compliance/DetailPageComponents`. Sidebar uses local `SidebarGroup`/`SidebarKV`/`Cap` components (same pattern as WalletDetail). Balance cards in the main area. Single `adminFetch` call for data.

- [ ] **Step 1: Create TbAccountDetail.tsx**

Create `admin-web/src/pages/TbAccountDetail.tsx`:

```tsx
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, RefreshCw, Copy, Check } from 'lucide-react';
import { adminIconButtonClass } from '../components/common/adminButtonStyles';
import { AdminBadge } from '../components/ui/AdminBadge';
import {
  AdminSessionError,
  adminFetch,
  getApiErrorMessage,
} from '../utils/adminFetch';
import { TB_CODE_LABELS } from './tb-account.constants';

interface TbAccountDetailData {
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
  debitsPosted: string | null;
  creditsPosted: string | null;
  debitsPending: string | null;
  creditsPending: string | null;
  netBalance: string | null;
}

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

const BalanceCard = ({
  label,
  value,
  colorClass,
}: {
  label: string;
  value: string | null;
  colorClass: string;
}) => (
  <div className="rounded border border-adm-border bg-adm-card p-4">
    <p className="font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-adm-t3">
      {label}
    </p>
    {value !== null ? (
      <p className={`mt-1.5 font-mono text-[18px] font-bold ${colorClass}`}>
        {value}
      </p>
    ) : (
      <p className="mt-1.5 font-mono text-[12px] text-adm-t3">TB unavailable</p>
    )}
  </div>
);

const formatDate = (d: string) =>
  new Date(d).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });

const TbAccountDetail = () => {
  const { tbAccountId } = useParams<{ tbAccountId: string }>();
  const navigate = useNavigate();
  const [detail, setDetail] = useState<TbAccountDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const seqRef = useRef(0);

  const fetchData = async () => {
    const seq = ++seqRef.current;
    setLoading(true);
    setError(null);
    try {
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/tb/accounts/${tbAccountId}`,
      );
      if (seq !== seqRef.current) return;
      if (!res.ok) {
        setError(await getApiErrorMessage(res, 'Failed to load TB account.'));
        return;
      }
      setDetail(await res.json());
    } catch (err) {
      if (err instanceof AdminSessionError) return;
      if (seq !== seqRef.current) return;
      setError('Failed to load TB account.');
    } finally {
      if (seq === seqRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    void fetchData();
  }, [tbAccountId]);

  const handleCopy = (text: string) => {
    void navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const codeLabel = detail ? (TB_CODE_LABELS[detail.code] ?? `CODE_${detail.code}`) : '';
  const title = detail
    ? `TB Account · ${codeLabel} · ${detail.assetCode}`
    : 'TB Account';

  const netBalanceColor = (() => {
    if (!detail?.netBalance) return '';
    return BigInt(detail.netBalance) >= 0n ? 'text-adm-green' : 'text-adm-red';
  })();

  if (loading && !detail) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex items-center gap-3 border-b border-adm-border bg-adm-panel px-5 py-3">
          <button onClick={() => navigate('/ledger/tb-accounts')} className={adminIconButtonClass()}>
            <ArrowLeft size={14} />
          </button>
          <span className="font-mono text-[11px] text-adm-t3">Loading…</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex items-center gap-3 border-b border-adm-border bg-adm-panel px-5 py-3">
          <button onClick={() => navigate('/ledger/tb-accounts')} className={adminIconButtonClass()}>
            <ArrowLeft size={14} />
          </button>
          <span className="font-mono text-[11px] text-adm-t1">{title}</span>
        </div>
        <div className="px-5 py-6 font-mono text-[11px] text-adm-red">{error}</div>
      </div>
    );
  }

  if (!detail) return null;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-adm-border bg-adm-panel px-5 py-3">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/ledger/tb-accounts')} className={adminIconButtonClass()}>
            <ArrowLeft size={14} />
          </button>
          <div>
            <p className="font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-adm-t3">
              TB Account
            </p>
            <p className="font-mono text-[13px] font-bold text-adm-amber">
              {codeLabel} · {detail.assetCode}
            </p>
          </div>
        </div>
        <button
          onClick={() => void fetchData()}
          className={adminIconButtonClass()}
          title="Refresh"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Body: main + sidebar */}
      <div className="flex flex-1 overflow-hidden">
        {/* Main area */}
        <div className="flex-1 overflow-y-auto p-5">
          <Cap>Balance</Cap>
          <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-3">
            <BalanceCard label="Debits Posted" value={detail.debitsPosted} colorClass="text-adm-amber" />
            <BalanceCard label="Credits Posted" value={detail.creditsPosted} colorClass="text-adm-blue" />
            <BalanceCard label="Debits Pending" value={detail.debitsPending} colorClass="text-adm-amber/60" />
            <BalanceCard label="Credits Pending" value={detail.creditsPending} colorClass="text-adm-blue/60" />
            <BalanceCard label="Net Balance" value={detail.netBalance} colorClass={netBalanceColor} />
          </div>
        </div>

        {/* Sidebar */}
        <div className="w-[272px] shrink-0 overflow-y-auto border-l border-adm-border bg-adm-panel px-5">
          <SidebarGroup title="Account Identity">
            <SidebarKV
              label="TB Account ID"
              mono
              value={
                <span className="inline-flex items-center gap-1">
                  <span className="truncate max-w-[120px]" title={detail.tbAccountId}>
                    {detail.tbAccountId}
                  </span>
                  <button
                    onClick={() => handleCopy(detail.tbAccountId)}
                    className="shrink-0 text-adm-t3 hover:text-adm-t1 transition-colors"
                    title="Copy"
                  >
                    {copied ? <Check size={10} /> : <Copy size={10} />}
                  </button>
                </span>
              }
            />
            <SidebarKV label="Code" mono value={`${detail.code} · ${codeLabel}`} />
            <SidebarKV label="Ledger" mono value={String(detail.ledger)} />
            <SidebarKV label="Asset" mono value={detail.assetCode} />
          </SidebarGroup>

          <SidebarGroup title="Ownership & Status">
            <SidebarKV label="Owner Type" value={<AdminBadge value={detail.ownerType} />} />
            <SidebarKV label="Owner No" mono value={detail.ownerNo} />
            <SidebarKV label="Status" value={<AdminBadge value={detail.status} />} />
            <SidebarKV label="Flags" mono value={`0x${detail.flags.toString(16).padStart(2, '0')}`} />
            <SidebarKV label="Description" value={detail.description} />
            <SidebarKV label="Created" mono value={formatDate(detail.createdAt)} />
          </SidebarGroup>
        </div>
      </div>
    </div>
  );
};

export default TbAccountDetail;
```

- [ ] **Step 2: Register route and lazy import in App.tsx**

In `admin-web/src/App.tsx`:

Add lazy import after the existing `TbAccountList` import (around line 127):

```ts
const TbAccountDetail = lazy(() => import('./pages/TbAccountDetail'));
```

Add route inside the `/ledger` route group, after the `tb-accounts` list route:

```tsx
<Route
  path="tb-accounts/:tbAccountId"
  element={withPermission(<TbAccountDetail />, [PERMISSIONS.TB_ACCOUNTS_READ])}
/>
```

The `/ledger` route block should look like:

```tsx
<Route path="/ledger">
  <Route
    path="tb-accounts"
    element={withPermission(<TbAccountList />, [PERMISSIONS.TB_ACCOUNTS_READ])}
  />
  <Route
    path="tb-accounts/:tbAccountId"
    element={withPermission(<TbAccountDetail />, [PERMISSIONS.TB_ACCOUNTS_READ])}
  />
  <Route
    path="tb-transfers"
    element={withPermission(<TbTransferList />, [PERMISSIONS.TB_TRANSFERS_READ])}
  />
  <Route
    path="tb-backlog"
    element={withPermission(<TbBacklogList />, [PERMISSIONS.TB_BACKLOG_READ])}
  />
</Route>
```

- [ ] **Step 3: Run TypeScript check**

Run: `cd admin-web && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Run backend tests**

Run: `npx jest src/modules/accounting/tigerbeetle/tb-admin.controller.spec.ts --no-coverage`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add admin-web/src/pages/TbAccountDetail.tsx admin-web/src/App.tsx
git commit -m "feat(admin): add TB Account detail page with balance cards and sidebar"
```

---

### Task 5: Visual Verification

- [ ] **Step 1: Start TigerBeetle**

Run: `bash scripts/dev-tigerbeetle.sh start`
Expected: "TigerBeetle started" or "TigerBeetle already running."

- [ ] **Step 2: Restart dev server**

Run: `npm run dev:stop && npm run dev:start`
Expected: All services started on 3500/3501/3502

- [ ] **Step 3: Verify list page → detail page navigation**

Open `http://localhost:3501`, login as admin@fiatx.com / 123456, navigate to Ledger → TB Accounts.
Verify: rows show `cursor-pointer` style. Click any row → navigates to `/ledger/tb-accounts/{id}`.

- [ ] **Step 4: Verify detail page content**

On the detail page, verify:
- Header shows "TB Account" label + "{CODE_LABEL} · {assetCode}" in amber
- Back arrow returns to list
- Refresh button reloads data
- Sidebar shows Account Identity group (TB Account ID with copy button, Code, Ledger, Asset) and Ownership & Status group (Owner Type badge, Status badge, Flags in hex, Created date)
- Main area shows 5 balance cards. If TB is running, cards show numeric values. If TB is not running, cards show "TB unavailable".

- [ ] **Step 5: Verify back navigation**

Click the back arrow → returns to `/ledger/tb-accounts` list.
