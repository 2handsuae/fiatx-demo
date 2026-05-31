# SwapFeeLevel Admin Pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add admin frontend pages + backend controller for SwapFeeLevel governance (list, detail, create, change, bind/unbind).

**Architecture:** Mirror the WithdrawalFeeLevel admin pattern. Backend controller (7 endpoints) delegates to existing workflow services. Frontend List + Detail pages follow the same layout/component patterns. TierEditor extended with `mode` prop for swap-specific item codes and rateMarkupBps.

**Tech Stack:** NestJS, React, TypeScript, Tailwind CSS

---

### Task 1: Backend Controller

**Files:**
- Create: `src/modules/trading/swap-fee-level/swap-fee-level.controller.ts`
- Modify: `src/modules/trading/swap-fee-level/swap-fee-level.module.ts`

- [ ] **Step 1: Create the controller**

Create `src/modules/trading/swap-fee-level/swap-fee-level.controller.ts`:

```typescript
import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Prisma } from '@prisma/client';
import { AdminPermissionGuard } from '../../identity/access-control/admin-permission.guard';
import { RequirePermissions } from '../../identity/access-control/require-permissions.decorator';
import { buildPermissionCode } from '../../identity/access-control/permission-code.util';
import { ApprovalActorContext } from '../../governance/approvals/constants/approval.constants';
import { SwapFeeLevelService } from './swap-fee-level.service';
import { SwapFeeLevelCreationWorkflowService } from './swap-fee-level-creation-workflow.service';
import { SwapFeeLevelChangeWorkflowService } from './swap-fee-level-change-workflow.service';
import { SwapFeeLevelBindingWorkflowService } from './swap-fee-level-binding-workflow.service';
import { SwapFeeLevelBindingService } from './swap-fee-level-binding.service';

@Controller('admin/swap-fee-levels')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
export class SwapFeeLevelController {
  constructor(
    private readonly feeLevelService: SwapFeeLevelService,
    private readonly creationWorkflowService: SwapFeeLevelCreationWorkflowService,
    private readonly changeWorkflowService: SwapFeeLevelChangeWorkflowService,
    private readonly bindingWorkflowService: SwapFeeLevelBindingWorkflowService,
    private readonly bindingService: SwapFeeLevelBindingService,
  ) {}

  private ensureAdmin(req: any) {
    if (req.user?.type !== 'ADMIN') throw new ForbiddenException('Admin access required');
  }

  private buildAdminActor(req: any): ApprovalActorContext {
    const user = req.user;
    return {
      actorType: 'ADMIN',
      userId: user.userId || user.sub,
      userNo: user.userNo,
      role: user.role,
      roleCodes: user.roleCodes || (user.role ? [user.role] : []),
    };
  }

  @Get()
  @RequirePermissions(buildPermissionCode('GET', '/admin/swap-fee-levels'))
  async findAll(
    @Query('fromAssetId') fromAssetId?: string,
    @Query('toAssetId') toAssetId?: string,
    @Query('status') status?: string,
    @Query('skip') skip?: string,
    @Query('take') take?: string,
  ) {
    const where: Prisma.SwapFeeLevelWhereInput = {};
    if (fromAssetId) where.fromAssetId = fromAssetId;
    if (toAssetId) where.toAssetId = toAssetId;
    if (status) where.status = status;
    const result = await this.feeLevelService.findAll({
      skip: skip ? parseInt(skip, 10) : undefined,
      take: take ? parseInt(take, 10) : undefined,
      where,
    });
    return { items: result.items, total: result.total };
  }

  @Get(':levelCode')
  @RequirePermissions(buildPermissionCode('GET', '/admin/swap-fee-levels/:levelCode'))
  async findOne(@Param('levelCode') levelCode: string) {
    return this.feeLevelService.findByLevelCode(levelCode);
  }

  @Post()
  @RequirePermissions(buildPermissionCode('POST', '/admin/swap-fee-levels'))
  async create(
    @Body() dto: {
      levelCode: string;
      name: string;
      fromAssetId: string;
      toAssetId: string;
      isDefault: boolean;
      tiersJson: string;
      reason: string;
    },
    @Req() req: any,
  ) {
    this.ensureAdmin(req);
    return this.creationWorkflowService.initiateCreate(dto, this.buildAdminActor(req));
  }

  @Post(':levelCode/change')
  @RequirePermissions(buildPermissionCode('POST', '/admin/swap-fee-levels/:levelCode/change'))
  async requestChange(
    @Param('levelCode') levelCode: string,
    @Body() dto: { proposedTiersJson: string; changeReason: string },
    @Req() req: any,
  ) {
    this.ensureAdmin(req);
    return this.changeWorkflowService.requestChange(
      levelCode,
      dto.proposedTiersJson,
      dto.changeReason,
      this.buildAdminActor(req),
    );
  }

  @Get(':levelCode/bindings')
  @RequirePermissions(buildPermissionCode('GET', '/admin/swap-fee-levels/:levelCode/bindings'))
  async getBindings(@Param('levelCode') levelCode: string) {
    const level = await this.feeLevelService.findByLevelCode(levelCode);
    return this.bindingService.findByLevel(level.id);
  }

  @Post('bindings/bind')
  @RequirePermissions(buildPermissionCode('POST', '/admin/swap-fee-levels/bindings'))
  async bindLevel(
    @Body() dto: { customerId: string; levelId: string },
    @Req() req: any,
  ) {
    this.ensureAdmin(req);
    return this.bindingWorkflowService.bindLevel(dto, this.buildAdminActor(req));
  }

  @Delete('bindings/unbind')
  @RequirePermissions(buildPermissionCode('DELETE', '/admin/swap-fee-levels/bindings'))
  async unbindLevel(
    @Body() dto: { customerId: string; levelId: string },
    @Req() req: any,
  ) {
    this.ensureAdmin(req);
    return this.bindingWorkflowService.unbindLevel(dto, this.buildAdminActor(req));
  }
}
```

- [ ] **Step 2: Register controller in module**

In `src/modules/trading/swap-fee-level/swap-fee-level.module.ts`, add the controller import and registration.

Add import at top:
```typescript
import { SwapFeeLevelController } from './swap-fee-level.controller';
```

Add `controllers` array to `@Module`:

Find:
```typescript
@Module({
  imports: [PrismaModule, ApprovalsModule, AuditLogsModule, forwardRef(() => PricingCenterModule)],
  providers: [
```

Replace with:
```typescript
@Module({
  imports: [PrismaModule, ApprovalsModule, AuditLogsModule, forwardRef(() => PricingCenterModule)],
  controllers: [SwapFeeLevelController],
  providers: [
```

- [ ] **Step 3: Verify build**

Run: `cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/modules/trading/swap-fee-level/swap-fee-level.controller.ts src/modules/trading/swap-fee-level/swap-fee-level.module.ts
git commit -m "feat: add SwapFeeLevel admin controller with 7 endpoints"
```

---

### Task 2: TierEditor Extension

**Files:**
- Modify: `admin-web/src/components/pricing/TierEditor.tsx`

- [ ] **Step 1: Add `rateMarkupBps` to TierState**

Find:
```typescript
export interface TierState {
  id: string;
  name: string;
  priority: number;
  enabled: boolean;
  amountMin: string;
  amountMax: string;
  feeItems: FeeItemState[];
}
```

Replace with:
```typescript
export interface TierState {
  id: string;
  name: string;
  priority: number;
  enabled: boolean;
  amountMin: string;
  amountMax: string;
  rateMarkupBps?: string;
  feeItems: FeeItemState[];
}
```

- [ ] **Step 2: Add swap item codes constant and mode-driven selection**

Find:
```typescript
const ITEM_CODES = ['WITHDRAW_SERVICE_FEE', 'NETWORK_FEE_EST'] as const;
```

Replace with:
```typescript
const WITHDRAWAL_ITEM_CODES = ['WITHDRAW_SERVICE_FEE', 'NETWORK_FEE_EST'] as const;
const SWAP_ITEM_CODES = ['SWAP_SERVICE_FEE', 'COMPLIANCE_FEE'] as const;
```

- [ ] **Step 3: Add `mode` prop to TierEditorProps**

Find:
```typescript
interface TierEditorProps {
  tiers: TierState[];
  onChange: (tiers: TierState[]) => void;
  /** Default currency to pre-fill on new fee items (e.g. from selected asset) */
  defaultCurrency?: string;
}
```

Replace with:
```typescript
interface TierEditorProps {
  tiers: TierState[];
  onChange: (tiers: TierState[]) => void;
  /** Default currency to pre-fill on new fee items (e.g. from selected asset) */
  defaultCurrency?: string;
  /** 'withdrawal' (default) or 'swap' — controls item codes dropdown and rateMarkupBps input */
  mode?: 'withdrawal' | 'swap';
}
```

- [ ] **Step 4: Update component to use mode**

Find:
```typescript
export default function TierEditor({ tiers, onChange, defaultCurrency = '' }: TierEditorProps) {
```

Replace with:
```typescript
export default function TierEditor({ tiers, onChange, defaultCurrency = '', mode = 'withdrawal' }: TierEditorProps) {
  const ITEM_CODES = mode === 'swap' ? SWAP_ITEM_CODES : WITHDRAWAL_ITEM_CODES;
```

- [ ] **Step 5: Add rateMarkupBps input in swap mode**

Find the amount range section (between tier header and fee items table):
```typescript
          {/* Amount range */}
          <div className="mb-2 flex items-center gap-2">
            <label className="font-mono text-[10px] text-adm-t3">Range:</label>
```

Insert **before** it:
```typescript
          {/* Rate markup (swap mode only) */}
          {mode === 'swap' && (
            <div className="mb-2 flex items-center gap-2">
              <label className="font-mono text-[10px] text-adm-t3">Rate Markup (bps):</label>
              <input
                type="number"
                className={`${fi} w-[80px]`}
                value={tier.rateMarkupBps ?? ''}
                onChange={(e) => updateTier(tierIdx, { rateMarkupBps: e.target.value })}
                placeholder="0"
              />
              {tier.rateMarkupBps && Number(tier.rateMarkupBps) > 0 && (
                <span className="font-mono text-[10px] text-adm-amber">
                  ({(Number(tier.rateMarkupBps) / 100).toFixed(2)}%)
                </span>
              )}
            </div>
          )}

          {/* Amount range */}
          <div className="mb-2 flex items-center gap-2">
            <label className="font-mono text-[10px] text-adm-t3">Range:</label>
```

(This replaces the existing `{/* Amount range */}` comment and its `<div>` opening — the rest of the amount range block stays as-is.)

- [ ] **Step 6: Update serializeTiers to include rateMarkupBps**

Find:
```typescript
      feeItems: t.feeItems.map((f, fi) => ({
```

Add `rateMarkupBps` to the serialized tier object, right before `feeItems`. Find:
```typescript
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
```

Replace with:
```typescript
    tiers: tiers.map((t, ti) => ({
      id: t.id || `TIER-${ti + 1}`,
      name: t.name,
      priority: t.priority,
      enabled: t.enabled,
      ...(t.rateMarkupBps != null && t.rateMarkupBps !== '' ? { rateMarkupBps: Number(t.rateMarkupBps) } : {}),
      conditions: {
        amountMin: t.amountMin ? Number(t.amountMin) : 0,
        amountMax: t.amountMax ? Number(t.amountMax) : null,
      },
      feeItems: t.feeItems.map((f, fi) => ({
```

- [ ] **Step 7: Update parseTiersJson to read rateMarkupBps**

Find:
```typescript
    return parsed.tiers.map((t) => ({
      id: t.id,
      name: t.name,
      priority: t.priority,
      enabled: t.enabled,
      amountMin: String(t.conditions.amountMin ?? 0),
      amountMax: t.conditions.amountMax != null ? String(t.conditions.amountMax) : '',
      feeItems: t.feeItems.map((f) => ({
```

Replace with:
```typescript
    return parsed.tiers.map((t: any) => ({
      id: t.id,
      name: t.name,
      priority: t.priority,
      enabled: t.enabled,
      amountMin: String(t.conditions.amountMin ?? 0),
      amountMax: t.conditions.amountMax != null ? String(t.conditions.amountMax) : '',
      rateMarkupBps: t.rateMarkupBps != null ? String(t.rateMarkupBps) : '',
      feeItems: t.feeItems.map((f: any) => ({
```

- [ ] **Step 8: Commit**

```bash
git add admin-web/src/components/pricing/TierEditor.tsx
git commit -m "feat: extend TierEditor with mode prop for swap item codes and rateMarkupBps"
```

---

### Task 3: Permission + Routing + Navigation Wiring

**Files:**
- Modify: `admin-web/src/rbac/permissions.ts`
- Modify: `admin-web/src/App.tsx`
- Modify: `admin-web/src/components/DashboardLayout.tsx`

- [ ] **Step 1: Add permission constant**

In `admin-web/src/rbac/permissions.ts`, add the swap fee level permission.

Find:
```typescript
  WITHDRAWAL_FEE_LEVELS_READ: 'api.get.admin_withdrawal_fee_levels',
```

Add after it:
```typescript
  SWAP_FEE_LEVELS_READ: 'api.get.admin_swap_fee_levels',
```

- [ ] **Step 2: Add lazy imports in App.tsx**

In `admin-web/src/App.tsx`, add lazy imports.

Find:
```typescript
const WithdrawalFeeLevelList = lazy(() => import('./pages/WithdrawalFeeLevelList'));
const WithdrawalFeeLevelDetail = lazy(() => import('./pages/WithdrawalFeeLevelDetail'));
```

Add after:
```typescript
const SwapFeeLevelList = lazy(() => import('./pages/SwapFeeLevelList'));
const SwapFeeLevelDetail = lazy(() => import('./pages/SwapFeeLevelDetail'));
```

- [ ] **Step 3: Add routes in App.tsx**

Find:
```typescript
            <Route
              path="pricing/withdrawal-fee-levels/:levelCode"
              element={withPermission(<WithdrawalFeeLevelDetail />, [PERMISSIONS.WITHDRAWAL_FEE_LEVELS_READ])}
            />
```

Add after:
```typescript
            <Route
              path="pricing/swap-fee-levels"
              element={withPermission(<SwapFeeLevelList />, [PERMISSIONS.SWAP_FEE_LEVELS_READ])}
            />
            <Route
              path="pricing/swap-fee-levels/:levelCode"
              element={withPermission(<SwapFeeLevelDetail />, [PERMISSIONS.SWAP_FEE_LEVELS_READ])}
            />
```

- [ ] **Step 4: Add navigation menu entry**

In `admin-web/src/components/DashboardLayout.tsx`, add the Swap Fee Levels nav entry in the Pricing section.

Find:
```typescript
        {
          path: '/dashboard/pricing/withdrawal-fee-levels',
          label: 'Withdrawal Fee Levels',
          icon: <Layers size={13} />,
          requiredPermissions: [PERMISSIONS.WITHDRAWAL_FEE_LEVELS_READ],
        },
```

Add after:
```typescript
        {
          path: '/dashboard/pricing/swap-fee-levels',
          label: 'Swap Fee Levels',
          icon: <Repeat size={13} />,
          requiredPermissions: [PERMISSIONS.SWAP_FEE_LEVELS_READ],
        },
```

(The `Repeat` icon is already imported in DashboardLayout — it's used by the Swap Config entry.)

- [ ] **Step 5: Commit**

```bash
git add admin-web/src/rbac/permissions.ts admin-web/src/App.tsx admin-web/src/components/DashboardLayout.tsx
git commit -m "feat: add SwapFeeLevel routes, permission, and nav menu entry"
```

---

### Task 4: SwapFeeLevelList Page

**Files:**
- Create: `admin-web/src/pages/SwapFeeLevelList.tsx`

- [ ] **Step 1: Create the list page**

Create `admin-web/src/pages/SwapFeeLevelList.tsx`:

```typescript
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, RefreshCw, X } from 'lucide-react';
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
  type: string;
}

interface FeeLevelItem {
  id: string;
  levelCode: string;
  name: string;
  fromAsset: { id: string; code: string; type: string };
  toAsset: { id: string; code: string; type: string };
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
  fromAssetId: string;
  toAssetId: string;
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

const assetBadge = (asset: { code: string; type: string }) => (
  <span
    className={`inline-flex items-center rounded px-1.5 py-0.5 font-mono text-[10px] font-medium ${
      asset.type === 'CRYPTO'
        ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300'
        : 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300'
    }`}
  >
    {asset.code}
  </span>
);

/* ── Constants ───────────────────────────────────────────────── */

const PAGE_SIZE = 20;
const STATUS_OPTIONS = ['ACTIVE', 'PENDING_APPROVAL', 'REJECTED'];
const DEFAULT_FILTERS: FilterState = { fromAssetId: '', toAssetId: '', status: '', defaultOnly: false };

/* ── Component ───────────────────────────────────────────────── */

const SwapFeeLevelList = () => {
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
    fromAssetId: '',
    toAssetId: '',
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
        `${import.meta.env.VITE_API_URL}/assets?status=ACTIVE&take=200`,
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
    if (next.fromAssetId) params.set('fromAssetId', next.fromAssetId);
    if (next.toAssetId) params.set('toAssetId', next.toAssetId);
    if (next.status) params.set('status', next.status);
    return params;
  };

  const fetchItems = async (page: number, next: FilterState = filters) => {
    const seq = ++requestSeqRef.current;
    setLoading(true);
    setError(null);
    try {
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/swap-fee-levels?${buildParams(page, next).toString()}`,
      );
      if (!res.ok)
        throw new Error(await getApiErrorMessage(res, 'Failed to load fee levels.'));

      const data = (await res.json()) as FeeLevelListResponse;
      if (seq !== requestSeqRef.current) return;

      let list = Array.isArray(data.items) ? data.items : [];
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
    setCreateForm({ levelCode: '', name: '', fromAssetId: '', toAssetId: '', isDefault: false, reason: '' });
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
    if (!createForm.fromAssetId) {
      setCreateError('From Asset is required');
      return;
    }
    if (!createForm.toAssetId) {
      setCreateError('To Asset is required');
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

    const selectedToAsset = assets.find((a) => a.id === createForm.toAssetId);
    const currency = selectedToAsset?.code?.split('-')[0] || '';
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
        `${import.meta.env.VITE_API_URL}/admin/swap-fee-levels`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            levelCode: createForm.levelCode.trim(),
            name: createForm.name.trim(),
            fromAssetId: createForm.fromAssetId,
            toAssetId: createForm.toAssetId,
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

  const hasFilter = !!filters.fromAssetId || !!filters.toAssetId || !!filters.status || filters.defaultOnly;

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
      <PageTitleBar title="Swap Fee Levels" meta={`${filters.defaultOnly ? items.length : total} levels`}>
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
          value={filters.fromAssetId}
          onChange={(e) => updateFilter('fromAssetId', e.target.value)}
        >
          <option value="">All From Assets</option>
          {assets.map((a) => (
            <option key={a.id} value={a.id}>
              {a.code}
            </option>
          ))}
        </select>

        <select
          className={`${fi} w-[150px]`}
          value={filters.toAssetId}
          onChange={(e) => updateFilter('toAssetId', e.target.value)}
        >
          <option value="">All To Assets</option>
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
              <th className={th} style={{ width: 160 }}>Pair</th>
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
                    navigate(`/dashboard/pricing/swap-fee-levels/${l.levelCode}`)
                  }
                >
                  <td className="px-3 py-2">
                    <button
                      className={adminButtonClass('rowKeyLink')}
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(
                          `/dashboard/pricing/swap-fee-levels/${l.levelCode}`,
                        );
                      }}
                      title={l.levelCode}
                    >
                      {l.levelCode}
                    </button>
                  </td>
                  <td className="px-3 py-2 text-adm-t1">{l.name}</td>
                  <td className="px-3 py-2">
                    {assetBadge(l.fromAsset)}
                    <span className="mx-1 text-adm-t3">→</span>
                    {assetBadge(l.toAsset)}
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
          Showing {items.length} / {filters.defaultOnly ? items.length : total} levels
          {filters.defaultOnly ? ' (default only)' : ''}
        </span>
        {!filters.defaultOnly && (
          <Pagination
            currentPage={currentPage}
            totalItems={total}
            pageSize={PAGE_SIZE}
            onPageChange={(p: number) => void fetchItems(p, filters)}
          />
        )}
      </div>

      {/* ════ Create Level Modal ════ */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-4xl max-h-[85vh] overflow-y-auto rounded-xl border border-adm-border bg-adm-panel shadow-xl">
            {/* Header */}
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-adm-border bg-adm-card px-5 py-4">
              <p className="font-mono text-[11px] font-semibold text-adm-t1">
                Create Swap Fee Level
              </p>
              <button
                onClick={closeCreateModal}
                className="rounded p-1 text-adm-t3 hover:bg-adm-hover hover:text-adm-t1"
              >
                <X size={15} />
              </button>
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
                  className="w-full rounded border border-adm-border bg-adm-bg px-3 py-2 font-mono text-[11px] text-adm-t1 placeholder:text-adm-t3 focus:border-adm-amber focus:outline-none transition-colors uppercase"
                  value={createForm.levelCode}
                  onChange={(e) =>
                    setCreateForm((f) => ({
                      ...f,
                      levelCode: e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ''),
                    }))
                  }
                  placeholder="e.g. SWP-USDT-AED"
                />
              </div>

              <div>
                <label className="mb-1 block font-mono text-[10px] font-semibold uppercase tracking-wider text-adm-t3">
                  Name
                </label>
                <input
                  className="w-full rounded border border-adm-border bg-adm-bg px-3 py-2 font-mono text-[11px] text-adm-t1 placeholder:text-adm-t3 focus:border-adm-amber focus:outline-none transition-colors"
                  value={createForm.name}
                  onChange={(e) => setCreateForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. Standard USDT to AED"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block font-mono text-[10px] font-semibold uppercase tracking-wider text-adm-t3">
                    From Asset
                  </label>
                  <select
                    className="w-full rounded border border-adm-border bg-adm-bg px-3 py-2 font-mono text-[11px] text-adm-t1 focus:border-adm-amber focus:outline-none transition-colors"
                    value={createForm.fromAssetId}
                    onChange={(e) => setCreateForm((f) => ({ ...f, fromAssetId: e.target.value }))}
                  >
                    <option value="">Select From Asset…</option>
                    {assets.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.code} ({a.type})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block font-mono text-[10px] font-semibold uppercase tracking-wider text-adm-t3">
                    To Asset
                  </label>
                  <select
                    className="w-full rounded border border-adm-border bg-adm-bg px-3 py-2 font-mono text-[11px] text-adm-t1 focus:border-adm-amber focus:outline-none transition-colors"
                    value={createForm.toAssetId}
                    onChange={(e) => setCreateForm((f) => ({ ...f, toAssetId: e.target.value }))}
                  >
                    <option value="">Select To Asset…</option>
                    {assets.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.code} ({a.type})
                      </option>
                    ))}
                  </select>
                </div>
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
                    assets.find((a) => a.id === createForm.toAssetId)?.code?.split('-')[0] || ''
                  }
                  mode="swap"
                />
              </div>

              <div>
                <label className="mb-1 block font-mono text-[10px] font-semibold uppercase tracking-wider text-adm-t3">
                  Reason
                </label>
                <textarea
                  className="w-full rounded border border-adm-border bg-adm-bg px-3 py-2 font-mono text-[10px] text-adm-t2 placeholder:text-adm-t3 focus:border-adm-amber focus:outline-none resize-none transition-colors"
                  rows={3}
                  value={createForm.reason}
                  onChange={(e) => setCreateForm((f) => ({ ...f, reason: e.target.value }))}
                  placeholder="Why is this level needed?"
                />
              </div>
            </div>
            {/* Footer */}
            <div className="sticky bottom-0 flex justify-end gap-2 border-t border-adm-border bg-adm-card px-5 py-4">
              <button onClick={closeCreateModal} className={adminButtonClass('modalCancel')}>
                Cancel
              </button>
              <button
                onClick={handleCreateSubmit}
                disabled={
                  createLoading ||
                  !createForm.levelCode ||
                  !createForm.name ||
                  !createForm.fromAssetId ||
                  !createForm.toAssetId ||
                  !createForm.reason.trim()
                }
                className={adminButtonClass('modalConfirm')}
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

export default SwapFeeLevelList;
```

- [ ] **Step 2: Commit**

```bash
git add admin-web/src/pages/SwapFeeLevelList.tsx
git commit -m "feat: add SwapFeeLevelList admin page"
```

---

### Task 5: SwapFeeLevelDetail Page

**Files:**
- Create: `admin-web/src/pages/SwapFeeLevelDetail.tsx`

- [ ] **Step 1: Create the detail page**

Create `admin-web/src/pages/SwapFeeLevelDetail.tsx`:

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
  fromAsset: { id: string; code: string; type: string };
  toAsset: { id: string; code: string; type: string };
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

/* ── Layout primitives ── */

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

export default function SwapFeeLevelDetail() {
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
        `${import.meta.env.VITE_API_URL}/admin/swap-fee-levels/${levelCode}`,
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
        `${import.meta.env.VITE_API_URL}/admin/swap-fee-levels/${levelCode}/bindings`,
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
        `${import.meta.env.VITE_API_URL}/admin/swap-fee-levels/${levelCode}/change`,
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
        `${import.meta.env.VITE_API_URL}/admin/swap-fee-levels/bindings/bind`,
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
        `${import.meta.env.VITE_API_URL}/admin/swap-fee-levels/bindings/unbind`,
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
                rateMarkupBps?: number;
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
            onClick={() => navigate('/dashboard/pricing/swap-fee-levels')}
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
        onBack={() => navigate('/dashboard/pricing/swap-fee-levels')}
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
              Pair: {level.fromAsset.code} ({level.fromAsset.type}) → {level.toAsset.code} ({level.toAsset.type}) · {parsedTiers.length} tier
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
                    <div className="mb-2 flex items-center gap-6">
                      <p className="font-mono text-[10px] text-adm-t3">
                        Amount Range:{' '}
                        <strong className="text-adm-t1">
                          {tier.conditions.amountMin ?? 0}
                        </strong>{' '}
                        —{' '}
                        <strong className="text-adm-t1">
                          {tier.conditions.amountMax ?? '∞'}
                        </strong>
                      </p>
                      {tier.rateMarkupBps != null && (
                        <p className="font-mono text-[10px]">
                          <span className="text-adm-t3">Rate Markup: </span>
                          <strong className="rounded bg-adm-amber/20 px-1.5 py-0.5 text-adm-amber">
                            {tier.rateMarkupBps} bps ({(tier.rateMarkupBps / 100).toFixed(2)}%)
                          </strong>
                        </p>
                      )}
                    </div>
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
              label="From Asset"
              value={`${level.fromAsset.code} (${level.fromAsset.type})`}
            />
            <SidebarKV
              label="To Asset"
              value={`${level.toAsset.code} (${level.toAsset.type})`}
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
          <div className="w-full max-w-4xl max-h-[85vh] overflow-y-auto rounded-xl border border-adm-border bg-adm-panel shadow-xl">
            {/* Header */}
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-adm-border bg-adm-card px-5 py-4">
              <div>
                <p className="font-mono text-[11px] font-semibold text-adm-t1">
                  Edit Tiers
                </p>
                <p className="mt-1 font-mono text-[9px] text-adm-t3">
                  {level.levelCode} · {level.fromAsset.code} → {level.toAsset.code}
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
                  defaultCurrency={level.toAsset.code.split('-')[0]}
                  mode="swap"
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

- [ ] **Step 2: Commit**

```bash
git add admin-web/src/pages/SwapFeeLevelDetail.tsx
git commit -m "feat: add SwapFeeLevelDetail admin page"
```

---

### Task 6: End-to-End Verification

**Files:**
- No code changes — verification only

- [ ] **Step 1: Verify backend build compiles clean**

Run: `cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js && npx tsc --noEmit --pretty 2>&1 | tail -5`
Expected: No errors.

- [ ] **Step 2: Verify all files exist**

Run:
```bash
ls -la src/modules/trading/swap-fee-level/swap-fee-level.controller.ts
ls -la admin-web/src/pages/SwapFeeLevelList.tsx
ls -la admin-web/src/pages/SwapFeeLevelDetail.tsx
```
Expected: All 3 files exist.

- [ ] **Step 3: Verify controller is registered in module**

Run: `grep "SwapFeeLevelController" src/modules/trading/swap-fee-level/swap-fee-level.module.ts`
Expected: Shows controller import and `controllers: [SwapFeeLevelController]`.

- [ ] **Step 4: Verify routes are in App.tsx**

Run: `grep "swap-fee-levels" admin-web/src/App.tsx`
Expected: Shows both route paths (`pricing/swap-fee-levels` and `pricing/swap-fee-levels/:levelCode`).

- [ ] **Step 5: Verify permission constant exists**

Run: `grep "SWAP_FEE_LEVELS_READ" admin-web/src/rbac/permissions.ts`
Expected: Shows `SWAP_FEE_LEVELS_READ: 'api.get.admin_swap_fee_levels'`.

- [ ] **Step 6: Verify nav menu entry**

Run: `grep "Swap Fee Levels" admin-web/src/components/DashboardLayout.tsx`
Expected: Shows the nav menu label.

- [ ] **Step 7: Verify TierEditor supports mode prop**

Run: `grep "mode.*swap\|SWAP_ITEM_CODES\|rateMarkupBps" admin-web/src/components/pricing/TierEditor.tsx`
Expected: Shows mode prop, swap item codes, and rateMarkupBps references.
