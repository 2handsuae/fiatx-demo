# 资金单 Admin 列表页优化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 资金单 admin 列表页全英文 + 菜单挪到 Swap Transactions 下 + 类型 tab 改筛选栏下拉 + 列表加 External Ref 列。

**Architecture:** 纯前端(admin-web),改 2 文件:`DashboardLayout.tsx`(菜单)+ `FundsOrderList.tsx`(列表整页重写)。后端 `findAllForAdmin` 已返回 `txHash/referenceNo`,零后端改动;状态英文化复用现成 `formatFundsOrderStatusLabel(..., 'en')`,不动共享双语函数(详情页不受影响)。

**Tech Stack:** React + TypeScript + Vite + Tailwind(adm-* tokens);lucide-react 图标;无 jest(admin 页面),验证靠 `tsc --noEmit` + 渲染截图。

**执行前置:** 已在 worktree `.claude/worktrees/funds-order-list-polish/`(分支 `feat/funds-order-list-polish`,spec 已提交)。所有命令在该 worktree 的 `Exchange_js/admin-web/` 内。

---

## File Structure

| 文件 | 责任 | 动作 |
|---|---|---|
| `admin-web/src/components/DashboardLayout.tsx` | 侧边栏菜单 | 改:Funds Orders 项移到 Swap Transactions 下 + label 去中文 |
| `admin-web/src/pages/FundsOrderList.tsx` | 资金单列表页 | 整文件重写:去中文 + 删 tab + Type 筛选 + External Ref 列 |

---

## Task 1: 菜单 — Funds Orders 移到 Swap Transactions 下 + 去中文

**Files:**
- Modify: `admin-web/src/components/DashboardLayout.tsx`

- [ ] **Step 1: 在 Swap Transactions 项正下方插入 Funds Orders 项**

找到 Swap Transactions 菜单项(其后紧跟 Withdraw Quotes),把:
```tsx
        {
          path: '/admin/trading/swaps',
          label: 'Swap Transactions',
          icon: <Repeat size={13} />,
          requiredPermissions: [PERMISSIONS.SWAP_TRANSACTIONS_READ],
        },
        {
          path: '/admin/trading/withdraw-quotes',
```
替换为:
```tsx
        {
          path: '/admin/trading/swaps',
          label: 'Swap Transactions',
          icon: <Repeat size={13} />,
          requiredPermissions: [PERMISSIONS.SWAP_TRANSACTIONS_READ],
        },
        // Unified funds-orders surface (Round 2 / C6) — replaces the legacy
        // Payin Records / Payout Records / Internal Funds entries.
        {
          path: '/admin/funds-orders',
          label: 'Funds Orders',
          icon: <Activity size={13} />,
          requiredPermissions: [PERMISSIONS.FUNDS_ORDERS_READ],
        },
        {
          path: '/admin/trading/withdraw-quotes',
```

- [ ] **Step 2: 删除末尾原 Funds Orders 项(+其注释)**

删除 Swap Quotes 项之后、Trading 组 `children` 收尾 `],` 之前的旧 Funds Orders 块:
```tsx
        // Unified funds-orders surface (Round 2 / C6) — replaces the legacy
        // Payin Records / Payout Records / Internal Funds entries.
        {
          path: '/admin/funds-orders',
          label: 'Funds Orders · 资金单',
          icon: <Activity size={13} />,
          requiredPermissions: [PERMISSIONS.FUNDS_ORDERS_READ],
        },
```
(删掉这整块;其上方 Swap Quotes 项的 `},` 后直接接 `],` 收尾 children。)

- [ ] **Step 3: tsc + 语义校验**

Run(在 `admin-web/`):
```bash
npx tsc --noEmit
grep -n "Funds Orders" src/components/DashboardLayout.tsx
```
Expected: tsc 0 error;`grep` 只剩一处 `label: 'Funds Orders'`(纯英文,无 `· 资金单`),且位置在 Swap Transactions 之后、Withdraw Quotes 之前。

- [ ] **Step 4: 提交**

```bash
git add src/components/DashboardLayout.tsx
git commit -m "feat(admin-nav): move Funds Orders under Swap Transactions; drop Chinese from label"
```

---

## Task 2: 列表页整文件重写(去中文 + 删 tab + Type 筛选 + External Ref 列)

**Files:**
- Modify (整文件替换): `admin-web/src/pages/FundsOrderList.tsx`

- [ ] **Step 1: 用下面内容整体替换 `FundsOrderList.tsx`**

```tsx
// admin-web/src/pages/FundsOrderList.tsx
//
// Unified funds-orders admin list (Round 2 / C6). Replaces the three legacy
// surfaces (Payin Records, Payout Records, Internal Funds). One table with a
// Type filter (All / Deposit / Withdraw / Swap) in the filter bar driving the
// ?parent= query. English-only surface.
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Copy, RefreshCw, Search } from 'lucide-react';
import Pagination from '../components/common/Pagination';
import {
  adminButtonClass,
  adminIconButtonClass,
} from '../components/common/adminButtonStyles';
import { PageTitleBar } from '../components/ui/PageTitleBar';
import {
  AdminSessionError,
  adminFetch,
  getApiErrorMessage,
} from '../utils/adminFetch';
import { formatAssetAmount } from '../utils/number-format';
import {
  formatFundsOrderStatusLabel,
  getFundsOrderStatusTone,
} from '../utils/fundsOrderStatusMap';

/* ── Types ──────────────────────────────────────────────────── */

type ParentType = 'all' | 'deposit' | 'withdraw' | 'swap';

interface FundsOrderItem {
  fundsOrderNo: string;
  status: string;
  amount: string;
  legSeq?: number | null;
  createdAt: string;
  asset?: { code?: string; currency?: string; decimals?: number; type?: string };
  depositNo?: string | null;
  withdrawNo?: string | null;
  swapNo?: string | null;
  txHash?: string | null;
  referenceNo?: string | null;
}

/* ── Constants ──────────────────────────────────────────────── */

const PAGE_SIZE = 20;

// funds_orders status enum — src/modules/funds-orders/dto/funds-order.dto.ts
const FUNDS_ORDER_STATUSES = [
  'CREATED',
  'SUBMITTED',
  'CONFIRMING',
  'CONFIRMED',
  'CLEARED',
  'FAILED',
  'TIMEOUT',
];

const PARENT_TYPES: Array<{ key: ParentType; label: string }> = [
  { key: 'all', label: 'All types' },
  { key: 'deposit', label: 'Deposit' },
  { key: 'withdraw', label: 'Withdraw' },
  { key: 'swap', label: 'Swap' },
];

/* ── Helpers ────────────────────────────────────────────────── */

// Which parent business no + kind applies to this row.
const parentOf = (
  item: FundsOrderItem,
): { kind: string; no: string | null } => {
  if (item.depositNo) return { kind: 'Deposit', no: item.depositNo };
  if (item.withdrawNo) return { kind: 'Withdraw', no: item.withdrawNo };
  if (item.swapNo) return { kind: 'Swap', no: item.swapNo };
  return { kind: '—', no: null };
};

// externalRef by asset type — mirrors backend FundsOrderService.resolveExternalRef
// (crypto → txHash, fiat → referenceNo).
const resolveExternalRef = (item: FundsOrderItem): string | null => {
  const fiat = String(item.asset?.type || '').toUpperCase() === 'FIAT';
  return (fiat ? item.referenceNo : item.txHash) || null;
};

/* ── Component ──────────────────────────────────────────────── */

const FundsOrderList = () => {
  const navigate = useNavigate();

  const [parentType, setParentType] = useState<ParentType>('all');
  const [status, setStatus] = useState('');
  const [fundsOrderNo, setFundsOrderNo] = useState('');
  const [items, setItems] = useState<FundsOrderItem[]>([]);
  const [total, setTotal] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const requestSeqRef = useRef(0);

  const fetchItems = async (
    page: number,
    nextType: ParentType = parentType,
    nextStatus: string = status,
    nextNo: string = fundsOrderNo,
  ) => {
    const seq = ++requestSeqRef.current;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set('skip', String((page - 1) * PAGE_SIZE));
      params.set('take', String(PAGE_SIZE));
      if (nextType !== 'all') params.set('parent', nextType);
      if (nextStatus.trim()) params.set('status', nextStatus.trim());
      if (nextNo.trim()) params.set('fundsOrderNo', nextNo.trim());

      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/funds-orders?${params.toString()}`,
      );
      if (!res.ok)
        throw new Error(await getApiErrorMessage(res, 'Failed to load funds orders.'));

      const data = await res.json();
      if (seq !== requestSeqRef.current) return;

      setItems(Array.isArray(data.items) ? data.items : []);
      setTotal(typeof data.total === 'number' ? data.total : 0);
      setCurrentPage(page);
    } catch (err) {
      if (seq !== requestSeqRef.current) return;
      if (err instanceof AdminSessionError) return;
      setError(err instanceof Error ? err.message : 'Failed to load funds orders.');
    } finally {
      if (seq === requestSeqRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    void fetchItems(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fi =
    'h-[30px] rounded border border-adm-border bg-adm-bg px-2.5 font-mono text-[11px] text-adm-t1 placeholder:text-adm-t3 outline-none focus:border-adm-amber transition-colors';

  const hasFilter = !!status || !!fundsOrderNo || parentType !== 'all';

  const handleSearch = () => void fetchItems(1, parentType, status, fundsOrderNo);

  const handleReset = () => {
    setParentType('all');
    setStatus('');
    setFundsOrderNo('');
    void fetchItems(1, 'all', '', '');
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* ── Title bar ── */}
      <PageTitleBar
        title="Funds Orders"
        meta={`${total} order${total === 1 ? '' : 's'}`}
      >
        <button
          onClick={() => void fetchItems(currentPage)}
          className={adminIconButtonClass()}
          title="Refresh"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </PageTitleBar>

      {/* ── Filter bar ── */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-adm-border bg-adm-panel px-5 py-2">
        <input
          value={fundsOrderNo}
          onChange={(e) => setFundsOrderNo(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          placeholder="Funds Order No"
          className={`${fi} w-48`}
        />
        <select
          value={parentType}
          onChange={(e) => setParentType(e.target.value as ParentType)}
          className={`${fi} w-36`}
        >
          {PARENT_TYPES.map((t) => (
            <option key={t.key} value={t.key}>{t.label}</option>
          ))}
        </select>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className={`${fi} w-40`}
        >
          <option value="">All status</option>
          {FUNDS_ORDER_STATUSES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <button onClick={handleSearch} className={adminButtonClass('listPrimary')}>
          <Search size={13} />
          Search
        </button>
        <button
          onClick={handleReset}
          disabled={!hasFilter}
          className={adminButtonClass('listSecondary')}
        >
          Reset
        </button>
      </div>

      {/* ── Notices ── */}
      {error && (
        <div className="shrink-0 border-b border-adm-red/20 bg-adm-red/6 px-5 py-2.5 font-mono text-[11px] text-adm-red">
          {error}
        </div>
      )}

      {/* ── Table ── */}
      <div className="flex-1 overflow-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              {(
                [
                  ['Funds Order No', '190px'],
                  ['Status',         '150px'],
                  ['Parent',         '190px'],
                  ['External Ref',   '200px'],
                  ['Asset',          '90px'],
                  ['Amount',         '150px'],
                  ['Leg',            '60px'],
                  ['Created',        '150px'],
                ] as [string, string][]
              ).map(([label, w]) => (
                <th
                  key={label}
                  style={{ width: w }}
                  className={`border-b border-adm-border bg-adm-panel px-4 py-2 font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-adm-t3 whitespace-nowrap ${label === 'Amount' ? 'text-right' : 'text-left'}`}
                >
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center font-mono text-[11px] text-adm-t3">
                  Loading…
                </td>
              </tr>
            )}
            {!loading && items.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center font-mono text-[11px] text-adm-t3">
                  No funds orders found.
                </td>
              </tr>
            )}
            {!loading &&
              items.map((item) => {
                const parent = parentOf(item);
                const externalRef = resolveExternalRef(item);
                return (
                  <tr
                    key={item.fundsOrderNo}
                    className="cursor-pointer border-b border-adm-border transition-colors hover:bg-adm-hover"
                    onClick={() => navigate('/admin/funds-orders/' + item.fundsOrderNo)}
                  >
                    {/* Funds Order No */}
                    <td className="px-4 py-2.5">
                      <span className="font-mono text-[11px] font-semibold text-adm-amber">
                        {item.fundsOrderNo}
                      </span>
                    </td>

                    {/* Status — English, asset-type aware */}
                    <td className="px-4 py-2.5">
                      <span
                        className={`inline-block rounded border px-2 py-0.5 font-mono text-[10px] ${getFundsOrderStatusTone(item.status)}`}
                      >
                        {formatFundsOrderStatusLabel(item.status, item.asset?.type, 'en')}
                      </span>
                    </td>

                    {/* Parent business no */}
                    <td className="px-4 py-2.5">
                      {parent.no ? (
                        <span className="font-mono text-[10px] text-adm-t2">
                          <span className="text-adm-t3">{parent.kind}</span>{' '}
                          {parent.no}
                        </span>
                      ) : (
                        <span className="font-mono text-[10px] text-adm-t3">—</span>
                      )}
                    </td>

                    {/* External Ref — crypto txHash / fiat referenceNo */}
                    <td className="px-4 py-2.5">
                      {externalRef ? (
                        <span className="inline-flex items-center gap-1.5">
                          <span
                            className="font-mono text-[10px] text-adm-t2"
                            title={externalRef}
                          >
                            {externalRef.length > 14
                              ? `${externalRef.slice(0, 14)}…`
                              : externalRef}
                          </span>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              void navigator.clipboard?.writeText(externalRef);
                            }}
                            className="text-adm-t3 transition-colors hover:text-adm-amber"
                            title="Copy"
                          >
                            <Copy size={11} />
                          </button>
                        </span>
                      ) : (
                        <span className="font-mono text-[10px] text-adm-t3">—</span>
                      )}
                    </td>

                    {/* Asset */}
                    <td className="px-4 py-2.5 font-mono text-[10px] text-adm-t1">
                      {item.asset?.code || item.asset?.currency || '—'}
                    </td>

                    {/* Amount */}
                    <td className="px-4 py-2.5 text-right">
                      <span className="font-mono text-[11px] text-adm-t1">
                        {formatAssetAmount(item.amount, item.asset?.decimals)}{' '}
                        {item.asset?.code || item.asset?.currency || ''}
                      </span>
                    </td>

                    {/* Leg */}
                    <td className="px-4 py-2.5 font-mono text-[10px] text-adm-t2">
                      {item.legSeq != null ? item.legSeq : '—'}
                    </td>

                    {/* Created */}
                    <td className="px-4 py-2.5 font-mono text-[10px] text-adm-t2 whitespace-nowrap">
                      {new Date(item.createdAt).toLocaleString()}
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>

      {/* ── Footer ── */}
      <div className="shrink-0 border-t border-adm-border bg-adm-panel px-5 py-2.5">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[10px] text-adm-t3">
            {total > 0
              ? `Showing ${items.length} / ${total} order${total === 1 ? '' : 's'}`
              : 'No orders'}
          </span>
          {total > PAGE_SIZE && (
            <Pagination
              currentPage={currentPage}
              totalItems={total}
              pageSize={PAGE_SIZE}
              onPageChange={(page) => void fetchItems(page)}
            />
          )}
        </div>
      </div>
    </div>
  );
};

export default FundsOrderList;
```

- [ ] **Step 2: tsc + 无中文校验**

Run(在 `admin-web/`):
```bash
npx tsc --noEmit
grep -nP '[\x{4e00}-\x{9fff}]' src/pages/FundsOrderList.tsx || echo "NO_CHINESE"
```
Expected: tsc 0 error;中文校验输出 `NO_CHINESE`(整文件无中文)。

- [ ] **Step 3: 提交**

```bash
git add src/pages/FundsOrderList.tsx
git commit -m "feat(admin-funds-orders): English-only list; type tab -> filter dropdown; add External Ref column"
```

---

## Task 3: 渲染验证(UI 改动必须眼见为实)

**Files:** 无(验证)

> admin-web 无 jest;UI 正确性靠渲染截图(项目铁律:UI 声称完成前须渲染验证)。前端为纯改动、API 不变,可让 worktree 的 admin 指向**已在跑的 main 后端(3000)**做轻量验证(仅需 admin-web 依赖)。

- [ ] **Step 1: 起 worktree 的 admin(指向 main 后端 3000,避免起整套 self 栈)**

```bash
cd <worktree>/Exchange_js/admin-web
[ -d node_modules ] || npm install    # 首次需装依赖
VITE_API_URL=http://localhost:3000 ~/.nvm/versions/node/v20.20.2/bin/node ./node_modules/.bin/vite --port 3401 --strictPort
```
(后台起;3401 避开 main 的 3001 与并行 worktree。)

- [ ] **Step 2: 注入 admin 登录态 + 导航到资金单列表,截图**

用 preview 工具打开 `http://localhost:3401`,`preview_eval` 注入 token(`fetch('http://localhost:3000/auth/login',{admin@fiatx.com/123456}) → localStorage['admin_token']`),导航 `/admin/funds-orders`,`preview_screenshot`。

- [ ] **Step 3: 逐条核对四诉求(截图 + snapshot)**
  - 侧边栏 Trading 组:**Funds Orders 紧跟 Swap Transactions 下方**,label 纯英文。
  - 列表页**无中文**:标题 `Funds Orders`、状态英文(如 `Cleared`/`Settled`)、列头英文。
  - **无顶部类型 tab**;筛选栏有 **Type 下拉**(All types/Deposit/Withdraw/Swap);选 Swap + Search → 只剩 swap 单。
  - **External Ref 列**存在:crypto 单显 `0x…`、fiat 单显 `ZB…`、无号显 `—`;点复制按钮不跳转详情。
  - `preview_console_logs` 无报错。

- [ ] **Step 4: 停 admin 预览进程**(验完清理,不留僵尸)。

---

## 完成判定(对齐 spec §4)
- □ `tsc --noEmit`(admin-web)0 error。
- □ `FundsOrderList.tsx` 无中文(grep 输出 NO_CHINESE);菜单 label 纯英文。
- □ 渲染截图证实:菜单位置、列表全英文、Type 筛选可用、External Ref 列正确(crypto/fiat/—)。
- □ 详情页 / 后端 / 共享 util **零改动**(`git diff --name-only main..HEAD` 只含 `DashboardLayout.tsx` + `FundsOrderList.tsx` + 本 spec/plan)。
