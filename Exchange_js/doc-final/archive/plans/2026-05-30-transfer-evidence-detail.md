# Transfer Evidence Detail Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only detail page for `TbTransferEvidence` records, with a backend endpoint and admin frontend page.

**Architecture:** One new GET endpoint in the existing `TbAdminController`, one new React page following the two-column detail page pattern, one RBAC route registration, and a list page update to add row navigation.

**Tech Stack:** NestJS + Prisma (backend), React + Tailwind + Lucide (frontend)

---

## File Map

| Action | File | Responsibility |
|--------|------|---------------|
| Modify | `src/modules/accounting/tigerbeetle/tb-admin.controller.ts` | Add `GET transfers/:tbTransferId` endpoint |
| Modify | `src/modules/accounting/tigerbeetle/tb-admin.controller.spec.ts` | Add tests for the new endpoint |
| Modify | `src/modules/identity/access-control/rbac.catalog.ts` | Register parameterized route |
| Create | `admin-web/src/pages/TransferEvidenceDetail.tsx` | Detail page component |
| Modify | `admin-web/src/pages/TransferEvidenceList.tsx` | Add row click → navigate to detail |
| Modify | `admin-web/src/rbac/permissions.ts` | Add detail permission constant |
| Modify | `admin-web/src/App.tsx` | Add detail route |

---

### Task 1: Backend — Controller endpoint + test

**Files:**
- Modify: `src/modules/accounting/tigerbeetle/tb-admin.controller.ts`
- Modify: `src/modules/accounting/tigerbeetle/tb-admin.controller.spec.ts`

- [ ] **Step 1: Write the failing tests**

Add a `findOneTransfer` describe block to the existing spec file `src/modules/accounting/tigerbeetle/tb-admin.controller.spec.ts`. Insert after the closing `});` of the `findOneAccount` describe block (after line 86):

```typescript
  describe('findOneTransfer', () => {
    const mockEvidence = {
      tbTransferId: 'aabb00112233',
      sourceType: 'DEPOSIT',
      sourceNo: 'DEP2605120001',
      eventCode: 'EVT_DEPOSIT_SUCCESS',
      debitCode: 'L.CLIENT_CREDIT',
      creditCode: 'A.CUSTODY',
      amount: '1000.00',
      assetCode: 'USDT',
      transferType: 'POSTED',
      traceId: '550e8400-e29b-41d4-a716-446655440000',
      actorType: 'SYSTEM',
      actorId: 'SYSTEM',
      memo: null,
      pendingId: null,
      createdAt: new Date('2026-05-30T10:00:00Z'),
    };

    it('returns evidence when found', async () => {
      evidenceService.findOne = jest.fn().mockResolvedValue(mockEvidence);

      const result = await controller.findOneTransfer('aabb00112233');

      expect(result.tbTransferId).toBe('aabb00112233');
      expect(result.sourceType).toBe('DEPOSIT');
      expect(evidenceService.findOne).toHaveBeenCalledWith('aabb00112233');
    });

    it('throws 404 when evidence not found', async () => {
      evidenceService.findOne = jest.fn().mockResolvedValue(null);

      await expect(controller.findOneTransfer('nonexistent')).rejects.toThrow(NotFoundException);
    });
  });
```

Also update the `evidenceService` mock in `beforeEach` (line 19-21) — add `findOne`:

```typescript
    evidenceService = {
      findAll: jest.fn(),
      findOne: jest.fn(),
    };
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest --no-coverage src/modules/accounting/tigerbeetle/tb-admin.controller.spec.ts`

Expected: FAIL — `controller.findOneTransfer is not a function`

- [ ] **Step 3: Implement the endpoint**

In `src/modules/accounting/tigerbeetle/tb-admin.controller.ts`, add this method after the `findTransfers` method (after line 116, before the closing `}`):

```typescript
  @Get('transfers/:tbTransferId')
  @ApiOperation({ summary: 'Get a single TB transfer evidence record' })
  async findOneTransfer(@Param('tbTransferId') tbTransferId: string) {
    const evidence = await this.tbEvidenceService.findOne(tbTransferId);
    if (!evidence) {
      throw new NotFoundException({
        code: 'TRANSFER_EVIDENCE_NOT_FOUND',
        message: `Transfer evidence ${tbTransferId} not found`,
      });
    }
    return evidence;
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest --no-coverage src/modules/accounting/tigerbeetle/tb-admin.controller.spec.ts`

Expected: all 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/modules/accounting/tigerbeetle/tb-admin.controller.ts src/modules/accounting/tigerbeetle/tb-admin.controller.spec.ts
git commit -m "feat(accounting): add GET /admin/tb/transfers/:tbTransferId endpoint"
```

---

### Task 2: RBAC route registration

**Files:**
- Modify: `src/modules/identity/access-control/rbac.catalog.ts`

- [ ] **Step 1: Add the route registration**

In `rbac.catalog.ts`, find line 581:

```typescript
  route('GET', '/admin/tb/transfers', 'List TB transfer evidence', ['ACCOUNTING_CONFIG_READ']),
```

Insert immediately after it:

```typescript
  route('GET', '/admin/tb/transfers/:tbTransferId', 'Get TB transfer evidence detail', ['ACCOUNTING_CONFIG_READ']),
```

- [ ] **Step 2: Verify TypeScript compilation**

Run: `npx tsc --noEmit 2>&1 | head -5`

Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/modules/identity/access-control/rbac.catalog.ts
git commit -m "feat(rbac): register GET /admin/tb/transfers/:tbTransferId route"
```

---

### Task 3: Frontend — Permission constant + route

**Files:**
- Modify: `admin-web/src/rbac/permissions.ts`
- Modify: `admin-web/src/App.tsx`

- [ ] **Step 1: Add permission constant**

In `admin-web/src/rbac/permissions.ts`, find line 202:

```typescript
  TB_TRANSFERS_READ: 'api.get.admin_tb_transfers',
```

Insert immediately after it:

```typescript
  TB_TRANSFER_DETAIL_READ: 'api.get.admin_tb_transfers_*',
```

- [ ] **Step 2: Add lazy import and route in App.tsx**

In `admin-web/src/App.tsx`, find the `TransferEvidenceList` lazy import (line 121):

```typescript
const TransferEvidenceList = lazy(() => import('./pages/TransferEvidenceList'));
```

Insert immediately after it:

```typescript
const TransferEvidenceDetail = lazy(() => import('./pages/TransferEvidenceDetail'));
```

Then find the transfers route (lines 896-899):

```tsx
            <Route
              path="transfers"
              element={withPermission(<TransferEvidenceList />, [PERMISSIONS.TB_TRANSFERS_READ])}
            />
```

Insert immediately after it (before the `</Route>` on line 900):

```tsx
            <Route
              path="transfers/:tbTransferId"
              element={withPermission(<TransferEvidenceDetail />, [PERMISSIONS.TB_TRANSFER_DETAIL_READ])}
            />
```

- [ ] **Step 3: Commit**

```bash
git add admin-web/src/rbac/permissions.ts admin-web/src/App.tsx
git commit -m "feat(admin): add TransferEvidenceDetail route and permission"
```

---

### Task 4: Frontend — Detail page component

**Files:**
- Create: `admin-web/src/pages/TransferEvidenceDetail.tsx`

- [ ] **Step 1: Create the detail page**

Create `admin-web/src/pages/TransferEvidenceDetail.tsx`:

```tsx
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Copy, Check } from 'lucide-react';
import { AdminBadge } from '../components/ui/AdminBadge';
import {
  AdminSessionError,
  adminFetch,
  getApiErrorMessage,
} from '../utils/adminFetch';
import { adminButtonClass } from '../components/common/adminButtonStyles';
import { DetailPageHeader, InfoField } from '../components/compliance/DetailPageComponents';
import { copyToClipboard } from '../utils/clipboard';

/* ── Interfaces ──────────────────────────────────────────────── */

interface TransferEvidenceData {
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

/* ── Layout primitives ──────────────────────────────────────── */

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

/* ── Helpers ─────────────────────────────────────────────────── */

const formatDate = (d: string) =>
  new Date(d).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });

const SOURCE_ROUTES: Record<string, string> = {
  DEPOSIT: '/exchange/deposit-transactions',
  WITHDRAWAL: '/exchange/withdraw-transactions',
  SWAP: '/exchange/swap-transactions',
  INTERNAL: '/exchange/internal-transactions',
};

function buildSourceLink(sourceType: string, sourceNo: string): string | null {
  const base = SOURCE_ROUTES[sourceType];
  return base ? `${base}/${sourceNo}` : null;
}

/* ── Main Component ──────────────────────────────────────────── */

export default function TransferEvidenceDetail() {
  const { tbTransferId } = useParams<{ tbTransferId: string }>();
  const navigate = useNavigate();

  const [detail, setDetail] = useState<TransferEvidenceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const seqRef = useRef(0);

  const fetchData = async () => {
    if (!tbTransferId) return;
    const seq = ++seqRef.current;
    setLoading(true);
    setError(null);
    try {
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/tb/transfers/${tbTransferId}`,
      );
      if (seq !== seqRef.current) return;
      if (!res.ok) {
        setError(await getApiErrorMessage(res, 'Failed to load transfer evidence.'));
        return;
      }
      setDetail(await res.json());
    } catch (err) {
      if (err instanceof AdminSessionError) return;
      if (seq !== seqRef.current) return;
      setError('Failed to load transfer evidence.');
    } finally {
      if (seq === seqRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    void fetchData();
  }, [tbTransferId]);

  const handleCopy = (text: string, field: string) => {
    copyToClipboard(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const CopyBtn = ({ text, field }: { text: string; field: string }) => (
    <button
      onClick={() => handleCopy(text, field)}
      className="shrink-0 text-adm-t3 hover:text-adm-t1 transition-colors"
      title="Copy"
    >
      {copiedField === field ? <Check size={10} /> : <Copy size={10} />}
    </button>
  );

  /* ── Loading state ── */

  if (loading && !detail) {
    return (
      <div className="flex min-h-[320px] flex-col items-center justify-center gap-4">
        <div className="animate-spin rounded-full h-6 w-6 border-2 border-adm-amber border-t-transparent" />
        <p className="mt-1 font-mono text-[11px] text-adm-t3">Loading transfer evidence…</p>
        <button onClick={() => navigate('/ledger/transfers')} className={adminButtonClass('detailUtility')}>
          ← Back to Transfers
        </button>
      </div>
    );
  }

  /* ── Error state ── */

  if (!detail) {
    return (
      <div className="space-y-4 rounded border border-adm-red/30 bg-adm-red/10 p-8 text-center">
        <div className="font-mono text-[11px] text-adm-red">{error || 'Transfer evidence not found'}</div>
        <div className="flex items-center justify-center gap-3">
          <button onClick={() => navigate('/ledger/transfers')} className={adminButtonClass('detailUtility')}>
            Back to Transfers
          </button>
          <button onClick={() => void fetchData()} className={adminButtonClass('detailUtility')}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  const sourceLink = buildSourceLink(detail.sourceType, detail.sourceNo);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* ── Header ── */}
      <DetailPageHeader
        backLabel="Transfer Evidence"
        onBack={() => navigate('/ledger/transfers')}
        onRefresh={() => void fetchData()}
        refreshing={loading}
      />

      {/* ── Body: two-column layout ── */}
      <div className="flex min-h-0 flex-1 overflow-hidden">

        {/* ════ LEFT MAIN ════ */}
        <div className="flex min-w-0 flex-1 flex-col divide-y divide-adm-border overflow-y-auto">

          {/* ① Hero — Amount + Type */}
          <section className="bg-adm-card px-6 py-5">
            <p className="font-mono text-[19px] font-bold leading-snug text-adm-amber">
              {detail.amount} <span className="text-[14px] text-adm-t2">{detail.assetCode}</span>
            </p>
            <div className="mt-3 flex items-center gap-4">
              <div>
                <div className="font-mono text-[9px] uppercase tracking-[0.1em] text-adm-t3">Transfer Type</div>
                <div className="mt-1"><AdminBadge value={detail.transferType} /></div>
              </div>
            </div>
          </section>

          {/* ② Source Info */}
          <section className="px-6 py-5">
            <Cap>Source Info</Cap>
            <div className="mt-3 grid grid-cols-2 gap-x-8 gap-y-4">
              <InfoField label="Source Type" value={detail.sourceType} />
              <InfoField
                label="Source No"
                value={
                  sourceLink ? (
                    <Link to={sourceLink} className="font-mono text-[11px] text-adm-amber hover:underline">
                      {detail.sourceNo}
                    </Link>
                  ) : (
                    detail.sourceNo
                  )
                }
                mono
              />
              <InfoField label="Event Code" value={detail.eventCode} mono />
            </div>
          </section>

          {/* ③ Accounting Entry */}
          <section className="px-6 py-5">
            <Cap>Accounting Entry</Cap>
            <div className="mt-3 grid grid-cols-2 gap-x-8 gap-y-4">
              <InfoField label="Debit" value={detail.debitCode} mono />
              <InfoField label="Credit" value={detail.creditCode} mono />
              <InfoField label="Amount" value={detail.amount} mono />
              <InfoField label="Asset" value={detail.assetCode} />
            </div>
          </section>

          {/* ④ Actor & Trace */}
          <section className="px-6 py-5">
            <Cap>Actor &amp; Trace</Cap>
            <div className="mt-3 grid grid-cols-2 gap-x-8 gap-y-4">
              <InfoField label="Actor Type" value={detail.actorType} />
              <InfoField label="Actor ID" value={detail.actorId} mono />
              <InfoField
                label="Trace ID"
                value={
                  <span className="inline-flex items-center gap-1">
                    <span className="font-mono text-[11px]">{detail.traceId}</span>
                    <CopyBtn text={detail.traceId} field="traceId" />
                  </span>
                }
              />
              <InfoField label="Memo" value={detail.memo ?? '—'} />
            </div>
          </section>

        </div>

        {/* ════ RIGHT SIDEBAR ════ */}
        <div className="w-[272px] min-w-[272px] overflow-y-auto border-l border-adm-border bg-adm-panel px-4 py-1">

          <SidebarGroup title="Identity">
            <SidebarKV
              label="Transfer ID"
              mono
              value={
                <span className="inline-flex items-center gap-1">
                  <span className="truncate max-w-[100px]" title={detail.tbTransferId}>
                    {detail.tbTransferId}
                  </span>
                  <CopyBtn text={detail.tbTransferId} field="tbTransferId" />
                </span>
              }
            />
            <SidebarKV label="Type" value={<AdminBadge value={detail.transferType} />} />
            <SidebarKV label="Pending ID" value={detail.pendingId ?? '—'} mono />
          </SidebarGroup>

          <SidebarGroup title="Lifecycle">
            <SidebarKV label="Created" value={formatDate(detail.createdAt)} mono />
          </SidebarGroup>

        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify frontend compiles**

Run: `cd admin-web && npx tsc --noEmit 2>&1 | head -5`

Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add admin-web/src/pages/TransferEvidenceDetail.tsx
git commit -m "feat(admin): add TransferEvidenceDetail page"
```

---

### Task 5: Frontend — List page row click navigation

**Files:**
- Modify: `admin-web/src/pages/TransferEvidenceList.tsx`

- [ ] **Step 1: Add navigation import and handler**

In `admin-web/src/pages/TransferEvidenceList.tsx`, add `useNavigate` to the react-router import. Find line 1:

```tsx
import { useEffect, useRef, useState } from 'react';
```

Add after existing imports (after line 11):

```tsx
import { useNavigate } from 'react-router-dom';
```

Then inside the component function (after line 60, after `const requestSeqRef = useRef(0);`), add:

```tsx
  const navigate = useNavigate();
```

- [ ] **Step 2: Make table rows clickable**

Find the `<tr>` for each row (line 262-264):

```tsx
              <tr
                key={row.tbTransferId}
                className="border-b border-adm-border transition-colors hover:bg-adm-hover"
              >
```

Replace with:

```tsx
              <tr
                key={row.tbTransferId}
                onClick={() => navigate(`/ledger/transfers/${row.tbTransferId}`)}
                className="border-b border-adm-border transition-colors hover:bg-adm-hover cursor-pointer"
              >
```

- [ ] **Step 3: Verify frontend compiles**

Run: `cd admin-web && npx tsc --noEmit 2>&1 | head -5`

Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add admin-web/src/pages/TransferEvidenceList.tsx
git commit -m "feat(admin): add row click navigation in TransferEvidenceList"
```

---

### Task 6: Final verification

- [ ] **Step 1: Run backend tests**

Run: `npx jest --no-coverage src/modules/accounting/tigerbeetle/tb-admin.controller.spec.ts`

Expected: all 5 tests PASS

- [ ] **Step 2: Run full TypeScript check (backend + frontend)**

Run: `npx tsc --noEmit && cd admin-web && npx tsc --noEmit`

Expected: no errors in either

- [ ] **Step 3: Final commit (if any unstaged changes remain)**

Verify with `git status` — all changes should already be committed.
