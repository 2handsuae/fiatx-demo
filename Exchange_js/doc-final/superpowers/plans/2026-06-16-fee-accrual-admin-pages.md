# Fee Accrual Admin Pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 admin 侧新增 fee_accruals 列表 + 详情两个页面，紧邻 Swap Outstandings 之下，复用既有页面结构作为基线。

**Architecture:** 后端新建 `fee-accruals.controller.ts` 暴露 list + detail 两个 GET endpoint（含 sibling 查询）；FeeAccrualService 加 `findAllForAdmin` / `findOneForAdmin` 方法。前端按 SwapOutstandingList/Detail 模板新建一对 React 页面、加 1 条侧边栏菜单 + 2 条路由 + 2 条 permission。所有 ID 展示用业务键（feeAccrualNo / swapNo / customerNo），不暴露 UUID。

**Tech Stack:** NestJS + Prisma + jest（后端）；React + React Router + Tailwind + Vite（前端）

**Source spec:** `doc-final/superpowers/specs/2026-06-16-fee-accrual-admin-pages-design.md`

---

## File Map

**Create:**
- `src/modules/funds-layer/domain/fee-accruals.controller.ts` — list + detail endpoint（T1）
- `src/modules/funds-layer/domain/dto/fee-accrual-query.dto.ts` — 列表 query DTO（T1）
- `src/modules/funds-layer/domain/fee-accruals.controller.spec.ts` — controller 单测（T1）
- `admin-web/src/pages/FeeAccrualList.tsx` — 列表页（T3）
- `admin-web/src/pages/FeeAccrualDetail.tsx` — 详情页（T4 + T5）

**Modify:**
- `src/modules/funds-layer/domain/fee-accrual.service.ts` — 加 `findAllForAdmin` + `findOneForAdmin`（T1）
- `src/modules/funds-layer/funds-layer.module.ts:48` — controllers 数组加 `FeeAccrualsController`（T1）
- `admin-web/src/rbac/permissions.ts` — 加 `FEE_ACCRUALS_READ` + `FEE_ACCRUAL_DETAIL_READ`（T2）
- `admin-web/src/App.tsx:18` — 加 2 lazy import（T2）
- `admin-web/src/App.tsx:384` — 加 2 routes 紧跟 Outstanding 路由（T2）
- `admin-web/src/components/DashboardLayout.tsx:401` — 加 "Fee Accruals" 侧边栏条目（T2）

**Dependency DAG:**
- T1 后端必先（前端 fetch 依赖 API）
- T2 前端骨架（permissions + 路由 + 侧边栏）—— 不依赖 T1 也能跑通 admin tsc
- T3 列表页 —— 依赖 T1（fetch）+ T2（路由/权限）
- T4 详情页 3 区 —— 依赖 T1 + T2
- T5 详情页 sibling 区 —— 依赖 T4
- T6 终验 —— 全部之后

---

## Task 1 — 后端 controller + DTO + service 方法 + sibling 查询

**Files:**
- Create: `src/modules/funds-layer/domain/fee-accruals.controller.ts`
- Create: `src/modules/funds-layer/domain/dto/fee-accrual-query.dto.ts`
- Create: `src/modules/funds-layer/domain/fee-accruals.controller.spec.ts`
- Modify: `src/modules/funds-layer/domain/fee-accrual.service.ts` (add 2 methods)
- Modify: `src/modules/funds-layer/funds-layer.module.ts:48` (register controller)
- Modify: `src/modules/identity/access-control/permissions.constant.ts` (add 2 keys if backend has perm constants)

### Pre-read

参考 `src/modules/clearing-settle/outstandings/outstandings.controller.ts`（32 行、含 list + detail 模式），fee-accrual.service.ts 现有 `accrueForSwap` / `accrueForWithdraw` / `settle` 方法、要加 2 个 admin 查询方法。

### Steps

- [ ] **Step 1: Write the failing test** — 创建 `fee-accruals.controller.spec.ts`：

```ts
import { Test, TestingModule } from '@nestjs/testing';
import { FeeAccrualsController } from './fee-accruals.controller';
import { FeeAccrualService } from './fee-accrual.service';

describe('FeeAccrualsController', () => {
  let controller: FeeAccrualsController;
  let serviceMock: { findAllForAdmin: jest.Mock; findOneForAdmin: jest.Mock };

  beforeEach(async () => {
    serviceMock = {
      findAllForAdmin: jest.fn(),
      findOneForAdmin: jest.fn(),
    };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [FeeAccrualsController],
      providers: [{ provide: FeeAccrualService, useValue: serviceMock }],
    }).compile();
    controller = module.get(FeeAccrualsController);
  });

  it('findAll forwards query to service', async () => {
    serviceMock.findAllForAdmin.mockResolvedValue({ items: [], total: 0 });
    const result = await controller.findAll({
      status: 'ACCRUED',
      page: 1,
      pageSize: 20,
    } as any);
    expect(serviceMock.findAllForAdmin).toHaveBeenCalledWith({
      status: 'ACCRUED',
      page: 1,
      pageSize: 20,
    });
    expect(result).toEqual({ items: [], total: 0 });
  });

  it('findOne returns service result including siblings', async () => {
    serviceMock.findOneForAdmin.mockResolvedValue({
      id: 'fa-1',
      feeAccrualNo: 'FAC2606160001',
      siblings: [{ id: 'fa-2', feeAccrualNo: 'FAC2606160002' }],
    });
    const result = await controller.findOne('fa-1');
    expect(serviceMock.findOneForAdmin).toHaveBeenCalledWith('fa-1');
    expect(result.siblings).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/modules/funds-layer/domain/fee-accruals.controller.spec.ts --no-coverage`

Expected: FAIL — controller file does not exist.

- [ ] **Step 3: Create the DTO** — `src/modules/funds-layer/domain/dto/fee-accrual-query.dto.ts`:

```ts
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsIn, IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class FeeAccrualQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsString() q?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() feeAccrualNo?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() sourceNo?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() ownerNo?: string;
  @ApiPropertyOptional({ enum: ['ACCRUED', 'LOCKED', 'SETTLED'] })
  @IsOptional() @IsIn(['ACCRUED', 'LOCKED', 'SETTLED'])
  status?: 'ACCRUED' | 'LOCKED' | 'SETTLED';
  @ApiPropertyOptional({ enum: ['SWAP_FEE', 'WITHDRAW_FEE'] })
  @IsOptional() @IsIn(['SWAP_FEE', 'WITHDRAW_FEE'])
  category?: 'SWAP_FEE' | 'WITHDRAW_FEE';
  @ApiPropertyOptional({ enum: ['SERVICE_FEE', 'SPREAD'] })
  @IsOptional() @IsIn(['SERVICE_FEE', 'SPREAD'])
  feeKind?: 'SERVICE_FEE' | 'SPREAD';
  @ApiPropertyOptional() @IsOptional() @IsString() assetCode?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() startDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() endDate?: string;
  @ApiPropertyOptional({ default: 1 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page?: number = 1;
  @ApiPropertyOptional({ default: 20 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  pageSize?: number = 20;
}
```

- [ ] **Step 4: Create the controller** — `src/modules/funds-layer/domain/fee-accruals.controller.ts`:

```ts
import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminPermissionGuard } from 'src/modules/identity/access-control/admin-permission.guard';
import { FeeAccrualService } from './fee-accrual.service';
import { FeeAccrualQueryDto } from './dto/fee-accrual-query.dto';

@ApiTags('Admin - Fee Accruals')
@Controller('admin/reconciliation/fee-accruals')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
@ApiBearerAuth()
export class FeeAccrualsController {
  constructor(private readonly service: FeeAccrualService) {}

  @Get()
  @ApiOperation({ summary: 'List fee accruals for reconciliation' })
  findAll(@Query() query: FeeAccrualQueryDto) {
    return this.service.findAllForAdmin(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get fee accrual detail with siblings' })
  findOne(@Param('id') id: string) {
    return this.service.findOneForAdmin(id);
  }
}
```

- [ ] **Step 5: Add findAllForAdmin + findOneForAdmin to FeeAccrualService**

In `src/modules/funds-layer/domain/fee-accrual.service.ts`, append two methods at end of the class (before the closing `}`):

```ts
  async findAllForAdmin(query: any) {
    const where: any = {};
    if (query.feeAccrualNo) where.feeAccrualNo = { contains: query.feeAccrualNo };
    if (query.sourceNo) where.sourceNo = { contains: query.sourceNo };
    if (query.ownerNo) where.ownerNo = { contains: query.ownerNo };
    if (query.status) where.status = query.status;
    if (query.category) where.category = query.category;
    if (query.feeKind) where.feeKind = query.feeKind;
    if (query.assetCode) where.assetCode = query.assetCode;
    if (query.q) where.feeAccrualNo = { startsWith: query.q };
    if (query.startDate || query.endDate) {
      where.createdAt = {};
      if (query.startDate) where.createdAt.gte = new Date(query.startDate);
      if (query.endDate) where.createdAt.lte = new Date(query.endDate);
    }
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const [items, total] = await Promise.all([
      (this.prisma as any).feeAccrual.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          settlementBatch: { select: { id: true, batchNo: true } },
          settledByTransfer: { select: { id: true, internalTxNo: true } },
        },
      }),
      (this.prisma as any).feeAccrual.count({ where }),
    ]);
    return { items, total };
  }

  async findOneForAdmin(id: string) {
    const row = await (this.prisma as any).feeAccrual.findUnique({
      where: { id },
      include: {
        settlementBatch: { select: { id: true, batchNo: true } },
        settledByTransfer: { select: { id: true, internalTxNo: true } },
        closedByInternalFund: { select: { id: true, internalFundNo: true } },
      },
    });
    if (!row) return null;
    const siblings = await (this.prisma as any).feeAccrual.findMany({
      where: {
        sourceType: row.sourceType,
        sourceId: row.sourceId,
        NOT: { id: row.id },
      },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        feeAccrualNo: true,
        feeKind: true,
        amount: true,
        assetCode: true,
        status: true,
        createdAt: true,
      },
    });
    return { ...row, siblings };
  }
```

> 注：`closedByInternalFund` 关系名按 Prisma schema 实际名为准；若 schema 里没建关系字段（只有 `closedByInternalFundId` 列），把 include 那行删掉、controller 返回原样 + 业务键。Step 6 验证。

- [ ] **Step 6: Confirm prisma schema relations**

Run:
```bash
grep -A20 "model FeeAccrual" prisma/schema.prisma | head -30
```

Expected: 至少看到 `settlementBatch` 和 `settledByTransfer` 关系。如果 `closedByInternalFund` 没有关系字段，从 Step 5 的 include 删掉那一行。

- [ ] **Step 7: Register controller in funds-layer.module.ts**

Read `src/modules/funds-layer/funds-layer.module.ts:48` 的 controllers 数组：

```ts
controllers: [
  /* ... existing ... */
],
```

加上 `FeeAccrualsController`。Import 在顶部加：

```ts
import { FeeAccrualsController } from './domain/fee-accruals.controller';
```

- [ ] **Step 8: Run tests to verify pass**

Run:
```
npx jest src/modules/funds-layer/domain/fee-accruals.controller.spec.ts --no-coverage
```

Expected: PASS（2 tests）。

Run also full funds-layer jest:
```
npx jest src/modules/funds-layer --no-coverage 2>&1 | tail -5
```

Expected: 全过。

- [ ] **Step 9: Build check**

Run: `npm run build 2>&1 | tail -5`

Expected: no TS errors.

- [ ] **Step 10: Commit**

```bash
git add src/modules/funds-layer/domain/fee-accruals.controller.ts \
        src/modules/funds-layer/domain/fee-accruals.controller.spec.ts \
        src/modules/funds-layer/domain/dto/fee-accrual-query.dto.ts \
        src/modules/funds-layer/domain/fee-accrual.service.ts \
        src/modules/funds-layer/funds-layer.module.ts
git commit -m "feat(funds-layer): admin fee-accruals controller with sibling lookup

- GET /api/admin/reconciliation/fee-accruals  (list + filters + pagination)
- GET /api/admin/reconciliation/fee-accruals/:id  (detail + siblings)
- Adds FeeAccrualService.findAllForAdmin / findOneForAdmin
- Sibling query: same sourceType+sourceId, exclude self, asc by createdAt
- AuthGuard('jwt') + AdminPermissionGuard (perms wired by T2)"
```

---

## Task 2 — 前端 permissions + 路由 + 侧边栏

**Files:**
- Modify: `admin-web/src/rbac/permissions.ts` (add 2 keys)
- Modify: `admin-web/src/App.tsx:17-18` (add lazy imports) + `:383` (add 2 routes)
- Modify: `admin-web/src/components/DashboardLayout.tsx:402` (add sidebar entry)

**Depends on:** none (frontend skeleton, can land before T1 backend).

### Steps

- [ ] **Step 1: Add permission keys**

Read `admin-web/src/rbac/permissions.ts`. Find `OUTSTANDINGS_READ` / `OUTSTANDING_DETAIL_READ` constants. Add immediately after:

```ts
FEE_ACCRUALS_READ: 'fee_accruals:read',
FEE_ACCRUAL_DETAIL_READ: 'fee_accrual_detail:read',
```

> 如果 PERMISSIONS 用大写 SNAKE_CASE 值（如 `OUTSTANDINGS_READ`: `'OUTSTANDINGS_READ'`），用相同风格 `'FEE_ACCRUALS_READ'` / `'FEE_ACCRUAL_DETAIL_READ'`。Read 文件先确认。

- [ ] **Step 2: Add lazy imports in App.tsx**

`admin-web/src/App.tsx:17-18` 附近现有：

```tsx
const SwapOutstandingList = lazy(() => import('./pages/SwapOutstandingList'));
const SwapOutstandingDetail = lazy(() => import('./pages/SwapOutstandingDetail'));
```

在它们后面追加：

```tsx
const FeeAccrualList = lazy(() => import('./pages/FeeAccrualList'));
const FeeAccrualDetail = lazy(() => import('./pages/FeeAccrualDetail'));
```

- [ ] **Step 3: Add 2 routes in App.tsx**

`admin-web/src/App.tsx:379-384` 现有：

```tsx
<Route
  path="reconciliation/outstandings"
  element={withPermission(<SwapOutstandingList />, [PERMISSIONS.OUTSTANDINGS_READ])}
/>
<Route
  path="reconciliation/outstandings/:id"
  element={withPermission(<SwapOutstandingDetail />, [PERMISSIONS.OUTSTANDING_DETAIL_READ])}
/>
```

在它们后面追加：

```tsx
<Route
  path="reconciliation/fee-accruals"
  element={withPermission(<FeeAccrualList />, [PERMISSIONS.FEE_ACCRUALS_READ])}
/>
<Route
  path="reconciliation/fee-accruals/:id"
  element={withPermission(<FeeAccrualDetail />, [PERMISSIONS.FEE_ACCRUAL_DETAIL_READ])}
/>
```

- [ ] **Step 4: Add sidebar entry in DashboardLayout.tsx**

`admin-web/src/components/DashboardLayout.tsx:399-404` 现有：

```tsx
{
  path: '/dashboard/reconciliation/outstandings',
  label: 'Swap Outstandings',
  icon: <ClipboardList size={13} />,
  requiredPermissions: [PERMISSIONS.OUTSTANDINGS_READ],
},
```

在该对象后追加：

```tsx
{
  path: '/dashboard/reconciliation/fee-accruals',
  label: 'Fee Accruals',
  icon: <ClipboardList size={13} />,
  requiredPermissions: [PERMISSIONS.FEE_ACCRUALS_READ],
},
```

- [ ] **Step 5: Create placeholder pages so lazy imports compile**

Create minimal `admin-web/src/pages/FeeAccrualList.tsx`:
```tsx
const FeeAccrualList = () => <div className="p-4">Fee Accrual List (T3)</div>;
export default FeeAccrualList;
```

Create minimal `admin-web/src/pages/FeeAccrualDetail.tsx`:
```tsx
const FeeAccrualDetail = () => <div className="p-4">Fee Accrual Detail (T4)</div>;
export default FeeAccrualDetail;
```

> These placeholders let T2 land independently. T3/T4 replace the file bodies.

- [ ] **Step 6: TSC check**

Run:
```
cd admin-web && npx tsc --noEmit 2>&1 | tail -5
```

Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add admin-web/src/rbac/permissions.ts \
        admin-web/src/App.tsx \
        admin-web/src/components/DashboardLayout.tsx \
        admin-web/src/pages/FeeAccrualList.tsx \
        admin-web/src/pages/FeeAccrualDetail.tsx
git commit -m "feat(admin): scaffold Fee Accrual routes + permissions + sidebar

- 2 new perms (FEE_ACCRUALS_READ, FEE_ACCRUAL_DETAIL_READ)
- 2 routes under /dashboard/reconciliation/fee-accruals[/:id]
- Sidebar entry under Reconciliation group, after Swap Outstandings
- Placeholder page bodies; T3/T4 fill them in"
```

---

## Task 3 — 列表页 `FeeAccrualList.tsx`

**Files:**
- Modify: `admin-web/src/pages/FeeAccrualList.tsx` (replace placeholder with full implementation)

**Depends on:** T1 (API), T2 (route + permission + placeholder).

### Pre-read

`admin-web/src/pages/SwapOutstandingList.tsx` (~300 行) 是 1:1 复用模板。复用：`adminFetch` / `Pagination` / `PageTitleBar` / `AdminBadge` / `adminButtonClass` / `adminIconButtonClass` / `formatAssetAmount`。

### Steps

- [ ] **Step 1: Replace `FeeAccrualList.tsx` body**

```tsx
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw, Search } from 'lucide-react';
import Pagination from '../components/common/Pagination';
import { adminButtonClass, adminIconButtonClass } from '../components/common/adminButtonStyles';
import { PageTitleBar } from '../components/ui/PageTitleBar';
import { AdminBadge } from '../components/ui/AdminBadge';
import { AdminSessionError, adminFetch, getApiErrorMessage } from '../utils/adminFetch';
import { formatAssetAmount } from '../utils/number-format';

interface FeeAccrualListItem {
  id: string;
  feeAccrualNo: string | null;
  sourceType: string;
  sourceNo: string | null;
  ownerNo: string | null;
  feeKind: 'SERVICE_FEE' | 'SPREAD';
  category: 'SWAP_FEE' | 'WITHDRAW_FEE';
  assetCode: string | null;
  amount: string;
  status: 'ACCRUED' | 'LOCKED' | 'SETTLED';
  settlementBatch: { id: string; batchNo: string | null } | null;
  settledByTransfer: { id: string; internalTxNo: string | null } | null;
  createdAt: string;
}

interface FilterState {
  feeAccrualNo: string;
  sourceNo: string;
  ownerNo: string;
  status: string;
  category: string;
  feeKind: string;
  assetCode: string;
  startDate: string;
  endDate: string;
}

const PAGE_SIZE = 20;
const DEFAULT_FILTERS: FilterState = {
  feeAccrualNo: '', sourceNo: '', ownerNo: '',
  status: '', category: '', feeKind: '', assetCode: '',
  startDate: '', endDate: '',
};

const STATUS_BADGE: Record<string, 'gray' | 'blue' | 'green'> = {
  ACCRUED: 'gray', LOCKED: 'blue', SETTLED: 'green',
};

const fmtDate = (v?: string | null): string => {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString();
};

const FeeAccrualList = () => {
  const navigate = useNavigate();
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [items, setItems] = useState<FeeAccrualListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestSeqRef = useRef(0);

  const fetchItems = async (page: number, next: FilterState = filters) => {
    const seq = ++requestSeqRef.current;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('pageSize', String(PAGE_SIZE));
      Object.entries(next).forEach(([k, v]) => { if (v) params.set(k, v); });
      const res = await adminFetch(`/api/admin/reconciliation/fee-accruals?${params}`);
      if (seq !== requestSeqRef.current) return;
      const data = await res.json();
      setItems(data.items ?? []);
      setTotal(data.total ?? 0);
      setCurrentPage(page);
    } catch (e) {
      if (e instanceof AdminSessionError) return;
      setError(getApiErrorMessage(e));
    } finally {
      if (seq === requestSeqRef.current) setLoading(false);
    }
  };

  useEffect(() => { fetchItems(1); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const onSearch = () => fetchItems(1, filters);
  const onReset = () => { setFilters(DEFAULT_FILTERS); fetchItems(1, DEFAULT_FILTERS); };

  return (
    <div className="space-y-4">
      <PageTitleBar
        title="Fee Accruals"
        actions={
          <button className={adminIconButtonClass} onClick={() => fetchItems(currentPage)} aria-label="Refresh">
            <RefreshCw size={14} />
          </button>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2 p-3 rounded-md bg-slate-50">
        <input className="border rounded px-2 py-1 text-sm" placeholder="Accrual No"
               value={filters.feeAccrualNo}
               onChange={e => setFilters({ ...filters, feeAccrualNo: e.target.value })} />
        <input className="border rounded px-2 py-1 text-sm" placeholder="Source No"
               value={filters.sourceNo}
               onChange={e => setFilters({ ...filters, sourceNo: e.target.value })} />
        <input className="border rounded px-2 py-1 text-sm" placeholder="Owner No"
               value={filters.ownerNo}
               onChange={e => setFilters({ ...filters, ownerNo: e.target.value })} />
        <select className="border rounded px-2 py-1 text-sm" value={filters.status}
                onChange={e => setFilters({ ...filters, status: e.target.value })}>
          <option value="">All Status</option>
          <option value="ACCRUED">ACCRUED</option>
          <option value="LOCKED">LOCKED</option>
          <option value="SETTLED">SETTLED</option>
        </select>
        <select className="border rounded px-2 py-1 text-sm" value={filters.category}
                onChange={e => setFilters({ ...filters, category: e.target.value })}>
          <option value="">All Category</option>
          <option value="SWAP_FEE">SWAP_FEE</option>
          <option value="WITHDRAW_FEE">WITHDRAW_FEE</option>
        </select>
        <select className="border rounded px-2 py-1 text-sm" value={filters.feeKind}
                onChange={e => setFilters({ ...filters, feeKind: e.target.value })}>
          <option value="">All Kind</option>
          <option value="SERVICE_FEE">SERVICE_FEE</option>
          <option value="SPREAD">SPREAD</option>
        </select>
        <input className="border rounded px-2 py-1 text-sm" placeholder="Asset Code"
               value={filters.assetCode}
               onChange={e => setFilters({ ...filters, assetCode: e.target.value })} />
        <input type="date" className="border rounded px-2 py-1 text-sm"
               value={filters.startDate}
               onChange={e => setFilters({ ...filters, startDate: e.target.value })} />
        <input type="date" className="border rounded px-2 py-1 text-sm"
               value={filters.endDate}
               onChange={e => setFilters({ ...filters, endDate: e.target.value })} />
        <div className="col-span-full flex gap-2 justify-end">
          <button className={adminButtonClass} onClick={onSearch}>
            <Search size={14} /> Search
          </button>
          <button className={adminButtonClass} onClick={onReset}>Reset</button>
        </div>
      </div>

      {error && <div className="p-3 rounded bg-rose-50 text-rose-800 text-sm">{error}</div>}

      <div className="border rounded-md overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50">
            <tr>
              {['Accrual No','Source','Category','Fee Kind','Owner','Amount','Status','Batch','Transfer','Created']
                .map(h => <th key={h} className="px-3 py-2 text-left font-medium">{h}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading && (
              <tr><td colSpan={10} className="p-4 text-center text-slate-500">Loading...</td></tr>
            )}
            {!loading && items.length === 0 && (
              <tr><td colSpan={10} className="p-4 text-center text-slate-500">No accruals.</td></tr>
            )}
            {!loading && items.map(r => (
              <tr key={r.id}
                  className="hover:bg-slate-50 cursor-pointer"
                  onClick={() => navigate(`/dashboard/reconciliation/fee-accruals/${r.id}`)}>
                <td className="px-3 py-2 font-mono">{r.feeAccrualNo ?? '—'}</td>
                <td className="px-3 py-2">{r.sourceType} {r.sourceNo ?? '—'}</td>
                <td className="px-3 py-2"><AdminBadge color="blue">{r.category}</AdminBadge></td>
                <td className="px-3 py-2"><AdminBadge color="amber">{r.feeKind}</AdminBadge></td>
                <td className="px-3 py-2">{r.ownerNo ?? '—'}</td>
                <td className="px-3 py-2 text-right">
                  {formatAssetAmount(r.amount, undefined)} {r.assetCode ?? ''}
                </td>
                <td className="px-3 py-2">
                  <AdminBadge color={STATUS_BADGE[r.status] ?? 'gray'}>{r.status}</AdminBadge>
                </td>
                <td className="px-3 py-2">{r.settlementBatch?.batchNo ?? '—'}</td>
                <td className="px-3 py-2">{r.settledByTransfer?.internalTxNo ?? '—'}</td>
                <td className="px-3 py-2">{fmtDate(r.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Pagination
        currentPage={currentPage}
        totalItems={total}
        pageSize={PAGE_SIZE}
        onPageChange={(p) => fetchItems(p)}
      />
    </div>
  );
};

export default FeeAccrualList;
```

> 注：`AdminBadge` 的 `color` prop 真实值由 grep 既有用法（如 `SwapOutstandingList.tsx`）确认 —— 如果支持值集是 `['slate','blue','amber','green','rose']`，按既有调色板对齐。

- [ ] **Step 2: TSC check**

Run: `cd admin-web && npx tsc --noEmit 2>&1 | tail -5`

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add admin-web/src/pages/FeeAccrualList.tsx
git commit -m "feat(admin): Fee Accrual list page (filters + pagination + badges)"
```

---

## Task 4 — 详情页 `FeeAccrualDetail.tsx` 的 3 个非 sibling 区

**Files:**
- Modify: `admin-web/src/pages/FeeAccrualDetail.tsx` (replace placeholder, sibling 区在 T5 加)

**Depends on:** T1 (detail API), T2 (route).

### Steps

- [ ] **Step 1: Replace `FeeAccrualDetail.tsx` body** with Identity + Settlement linkage + Traceability zones (sibling 区在 T5 加 TODO 行作为锚点):

```tsx
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Copy } from 'lucide-react';
import { AdminSessionError, adminFetch, getApiErrorMessage } from '../utils/adminFetch';
import { AdminBadge } from '../components/ui/AdminBadge';
import { adminButtonClass, adminIconButtonClass } from '../components/common/adminButtonStyles';
import { formatAssetAmount } from '../utils/number-format';

interface FeeAccrualDetail {
  id: string;
  feeAccrualNo: string | null;
  sourceType: string;
  sourceId: string;
  sourceNo: string | null;
  ownerType: string;
  ownerId: string;
  ownerNo: string | null;
  feeKind: 'SERVICE_FEE' | 'SPREAD';
  category: 'SWAP_FEE' | 'WITHDRAW_FEE';
  assetCode: string | null;
  amount: string;
  status: 'ACCRUED' | 'LOCKED' | 'SETTLED';
  lockedAt: string | null;
  closedAt: string | null;
  closedByInternalFundId: string | null;
  createdAt: string;
  updatedAt: string;
  originTraceId: string | null;
  settlementBatch: { id: string; batchNo: string | null } | null;
  settledByTransfer: { id: string; internalTxNo: string | null } | null;
  closedByInternalFund: { id: string; internalFundNo: string | null } | null;
  siblings: Array<{
    id: string; feeAccrualNo: string | null;
    feeKind: 'SERVICE_FEE' | 'SPREAD';
    amount: string; assetCode: string | null;
    status: 'ACCRUED' | 'LOCKED' | 'SETTLED';
    createdAt: string;
  }>;
}

const STATUS_BADGE: Record<string, 'gray' | 'blue' | 'green'> = {
  ACCRUED: 'gray', LOCKED: 'blue', SETTLED: 'green',
};

const fmtDate = (v?: string | null): string => {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString();
};

// Pure helper: maps sourceType to admin route prefix (T5 will use for siblings too).
function sourceDetailPath(sourceType: string, sourceId: string): string {
  switch (sourceType) {
    case 'SWAP': return `/dashboard/trading/swap-transactions/${sourceId}`;
    case 'WITHDRAW': return `/dashboard/trading/withdraw-transactions/${sourceId}`;
    default: return `#`;
  }
}

const FeeAccrualDetail = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<FeeAccrualDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    adminFetch(`/api/admin/reconciliation/fee-accruals/${id}`)
      .then(r => r.json()).then(setData)
      .catch(e => { if (!(e instanceof AdminSessionError)) setError(getApiErrorMessage(e)); })
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <div className="p-4 text-slate-500">Loading...</div>;
  if (error) return <div className="p-4 text-rose-700">{error}</div>;
  if (!data) return <div className="p-4 text-slate-500">Not found.</div>;

  const Field = ({ label, value }: { label: string; value: React.ReactNode }) => (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-slate-500">{label}</span>
      <span className="text-sm">{value}</span>
    </div>
  );

  const Link = ({ to, children }: { to: string; children: React.ReactNode }) => (
    <button className="text-blue-600 hover:underline" onClick={() => navigate(to)}>
      {children}
    </button>
  );

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center gap-3">
        <button className={adminIconButtonClass} onClick={() => navigate(-1)} aria-label="Back">
          <ArrowLeft size={14} />
        </button>
        <h1 className="text-lg font-semibold font-mono">Accrual {data.feeAccrualNo ?? data.id}</h1>
        <AdminBadge color={STATUS_BADGE[data.status] ?? 'gray'}>{data.status}</AdminBadge>
      </div>

      {/* § 1. Identity */}
      <section className="border rounded-md p-4">
        <h2 className="text-sm font-medium mb-3 text-slate-700">Identity</h2>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Accrual No" value={<span className="font-mono">{data.feeAccrualNo ?? '—'}</span>} />
          <Field label="Category" value={<AdminBadge color="blue">{data.category}</AdminBadge>} />
          <Field label="Fee Kind" value={<AdminBadge color="amber">{data.feeKind}</AdminBadge>} />
          <Field label="Amount" value={<>{formatAssetAmount(data.amount, undefined)} {data.assetCode ?? ''}</>} />
          <Field label="Owner" value={
            data.ownerNo
              ? <Link to={`/dashboard/customers/${data.ownerId}`}>{data.ownerNo}</Link>
              : '—'
          } />
          <Field label="Source" value={
            data.sourceNo
              ? <Link to={sourceDetailPath(data.sourceType, data.sourceId)}>{data.sourceType} {data.sourceNo}</Link>
              : '—'
          } />
        </div>
      </section>

      {/* § 2. Settlement linkage */}
      <section className="border rounded-md p-4">
        <h2 className="text-sm font-medium mb-3 text-slate-700">Settlement Linkage</h2>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Status" value={<AdminBadge color={STATUS_BADGE[data.status] ?? 'gray'}>{data.status}</AdminBadge>} />
          <Field label="Locked At" value={fmtDate(data.lockedAt)} />
          <Field label="Closed At" value={fmtDate(data.closedAt)} />
          <div />
          <Field label="Settlement Batch" value={
            data.settlementBatch
              ? <Link to={`/dashboard/reconciliation/outstanding-settlements/${data.settlementBatch.id}`}>
                  {data.settlementBatch.batchNo ?? '—'}
                </Link>
              : '—'
          } />
          <Field label="Settled By Transfer" value={
            data.settledByTransfer
              ? <Link to={`/dashboard/treasury/internal-transactions/${data.settledByTransfer.id}`}>
                  {data.settledByTransfer.internalTxNo ?? '—'}
                </Link>
              : '—'
          } />
          <Field label="Closed By Fund" value={
            data.closedByInternalFund
              ? <Link to={`/dashboard/treasury/internal-funds/${data.closedByInternalFund.id}`}>
                  {data.closedByInternalFund.internalFundNo ?? '—'}
                </Link>
              : '—'
          } />
        </div>
      </section>

      {/* § 3. Traceability */}
      <section className="border rounded-md p-4">
        <h2 className="text-sm font-medium mb-3 text-slate-700">Traceability</h2>
        <div className="flex items-center gap-2">
          <code className="text-xs bg-slate-50 px-2 py-1 rounded font-mono">
            {data.originTraceId ?? '—'}
          </code>
          {data.originTraceId && (
            <button
              className={adminIconButtonClass}
              onClick={() => navigator.clipboard.writeText(data.originTraceId!)}
              aria-label="Copy traceId"
            >
              <Copy size={12} />
            </button>
          )}
        </div>
      </section>

      {/* § 4. Sibling Accruals — T5 will populate */}
      <section className="border rounded-md p-4">
        <h2 className="text-sm font-medium mb-3 text-slate-700">
          Sibling Accruals ({data.siblings.length})
        </h2>
        <div className="text-sm text-slate-500">(populated by T5)</div>
      </section>
    </div>
  );
};

export default FeeAccrualDetail;
```

> 路由路径假设：`/dashboard/trading/swap-transactions/:id`、`/dashboard/customers/:id`、`/dashboard/treasury/internal-transactions/:id`、`/dashboard/treasury/internal-funds/:id`、`/dashboard/reconciliation/outstanding-settlements/:id`。**实际路径用 grep App.tsx 确认**：
> ```bash
> grep -nE "path=.*swap-transactions/:id|path=.*customers/:id|path=.*internal-transactions/:id|path=.*internal-funds/:id" admin-web/src/App.tsx
> ```
> 任何不匹配的路径在该 step 修正成 grep 出的真实路径。

- [ ] **Step 2: TSC check**

Run: `cd admin-web && npx tsc --noEmit 2>&1 | tail -5`

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add admin-web/src/pages/FeeAccrualDetail.tsx
git commit -m "feat(admin): Fee Accrual detail page (Identity + Linkage + Traceability)

- 3 zones: Identity / Settlement Linkage / Traceability
- All ID navigation via React Router (no <a href>)
- originTraceId with copy-to-clipboard button
- Siblings section is placeholder; T5 fills it in"
```

---

## Task 5 — 详情页 Sibling 区

**Files:**
- Modify: `admin-web/src/pages/FeeAccrualDetail.tsx` (replace § 4 sibling placeholder)

**Depends on:** T4 (detail page skeleton).

### Steps

- [ ] **Step 1: Replace § 4 Sibling Accruals section in `FeeAccrualDetail.tsx`**

Find:
```tsx
      {/* § 4. Sibling Accruals — T5 will populate */}
      <section className="border rounded-md p-4">
        <h2 className="text-sm font-medium mb-3 text-slate-700">
          Sibling Accruals ({data.siblings.length})
        </h2>
        <div className="text-sm text-slate-500">(populated by T5)</div>
      </section>
```

Replace with:
```tsx
      {/* § 4. Sibling Accruals */}
      <section className="border rounded-md p-4">
        <h2 className="text-sm font-medium mb-3 text-slate-700">
          Sibling Accruals ({data.siblings.length})
        </h2>
        {data.siblings.length === 0 ? (
          <div className="text-sm text-slate-500">No other accruals from this source.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm divide-y divide-slate-200">
              <thead className="bg-slate-50">
                <tr>
                  {['Accrual No','Fee Kind','Amount','Status','Created'].map(h =>
                    <th key={h} className="px-3 py-2 text-left font-medium">{h}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.siblings.map(s => (
                  <tr key={s.id}
                      className="hover:bg-slate-50 cursor-pointer"
                      onClick={() => navigate(`/dashboard/reconciliation/fee-accruals/${s.id}`)}>
                    <td className="px-3 py-2 font-mono">{s.feeAccrualNo ?? '—'}</td>
                    <td className="px-3 py-2"><AdminBadge color="amber">{s.feeKind}</AdminBadge></td>
                    <td className="px-3 py-2 text-right">
                      {formatAssetAmount(s.amount, undefined)} {s.assetCode ?? ''}
                    </td>
                    <td className="px-3 py-2">
                      <AdminBadge color={STATUS_BADGE[s.status] ?? 'gray'}>{s.status}</AdminBadge>
                    </td>
                    <td className="px-3 py-2">{fmtDate(s.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
```

- [ ] **Step 2: TSC check**

Run: `cd admin-web && npx tsc --noEmit 2>&1 | tail -5`

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add admin-web/src/pages/FeeAccrualDetail.tsx
git commit -m "feat(admin): Fee Accrual detail Sibling Accruals section

- Table of same-source accruals (exclude self)
- Row click navigates to sibling detail
- Empty state when 0 siblings"
```

---

## Task 6 — 终验：build + tsc + 启动 admin + 渲染截图

**Files:** N/A (verification only)

**Depends on:** T1-T5 全完成。

### Steps

- [ ] **Step 1: 全栈 jest + build + admin tsc**

Run:
```
npx jest --no-coverage 2>&1 | tail -5
npm run build 2>&1 | tail -3
cd admin-web && npx tsc --noEmit 2>&1 | tail -3
```

Expected: 全 0 failed / 0 errors.

- [ ] **Step 2: 确认 backend 3500 + admin 3501 都在跑**

Run:
```bash
for p in 3500 3501 3502 3503; do
  pid=$(lsof -ti:$p | head -1)
  echo "  $p : ${pid:-EMPTY}"
done
```

如果 3500 不在：
```bash
nohup npm run start:dev > logs/backend-restart.log 2>&1 &
sleep 8
```

如果 3501 不在：
```bash
cd admin-web && nohup npm run dev > ../logs/admin-restart.log 2>&1 &
sleep 5
```

- [ ] **Step 3: 准备 demo 数据**

DB 已有 10 笔 AED→USDT swap、20 行 fee_accruals。Run:
```bash
sqlite3 /tmp/exchange_js_branch/dev.db "SELECT COUNT(*) FROM fee_accruals;"
```

Expected: ≥ 19。若为 0，run:
```bash
DATABASE_URL="file:/tmp/exchange_js_branch/dev.db" TB_ADDRESS=127.0.0.1:3503 \
  node -r ts-node/register -r tsconfig-paths/register scripts/sim-swaps-on-existing.ts
```

- [ ] **Step 4: 渲染验证（preview）**

Use preview-server tools to capture:
1. `/dashboard/reconciliation/fee-accruals` 列表页 — 截图、确认表格至少 1 行、过滤器有效
2. 进入一条 accrual 详情 — 截图、确认 4 区都渲染
3. 详情页跳转链路 — 至少点 1 个 sourceNo 跳 swap 详情、1 个 batch 跳 batch 详情
4. originTraceId 复制按钮 — 点击、看是否 toast 或样式 feedback

> 实施时按 CLAUDE.md 红线："声称前端统一/完成前必须 preview 渲染+截图比对视觉原子，curl 200/tsc 不算数"。

- [ ] **Step 5: SQL 验证后端 query**

```bash
curl -s "http://localhost:3500/api/admin/reconciliation/fee-accruals?page=1&pageSize=5" \
  -H "Authorization: Bearer $TOKEN" | jq '.items | length, .total'
```

Expected: 5 items returned (假设至少 5 行 accrual)。

- [ ] **Step 6: Final commit (if any tweaks)**

如 Step 4 截图发现样式问题、补丁 + commit。否则收尾、无新 commit。

---

## Self-Review (post-write)

### Spec coverage

| Spec § | Covered by |
|---|---|
| § 3 后端 API（list + detail + sibling） | T1 |
| § 4 列表页 10 列 + 过滤器 | T3 |
| § 5 详情页 4 区 | T4 (1-3 区) + T5 (sibling 区) |
| § 6 侧边栏 + 路由 + 权限 | T2 |
| § 7 红线（业务键展示 / navigate / 复用样式 / 只读 / 权限门控） | 各任务步骤中说明 |
| § 10 验收（jest/build/tsc/截图/跳转/copy）| T6 |

无遗漏。

### Placeholder scan

- T4 路径假设 "实际路径用 grep App.tsx 确认"——这是验证 step 不是占位符
- T1 Step 5 prisma 关系名 "按 schema 为准"——同上验证 step
- T1 Step 6 显式 grep 命令
- 无 TODO/TBD/"implement later"

### Type consistency

- `FeeAccrualListItem` / `FeeAccrualDetail` 字段名一致
- `STATUS_BADGE` map 在 T3 + T4 + T5 完全相同
- `sourceDetailPath` 只在 T4 定义、T5 不用（sibling 用 fee-accrual 内部路径）
- 后端 endpoint 路径 `/api/admin/reconciliation/fee-accruals[/:id]` 全栈一致

### Dependency DAG

```
T1 (后端) ─┐
           ├─→ T3 (列表)
T2 (前端骨架)──┴─→ T4 (详情骨架) ──→ T5 (sibling)
                                          ↓
                              T6 (全栈终验)
```

无循环。T1 + T2 可并行；T3 + T4 都依赖 T1 + T2；T5 依赖 T4；T6 在最后。
