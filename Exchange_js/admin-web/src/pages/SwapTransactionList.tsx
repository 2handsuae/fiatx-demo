import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { RefreshCw, Search } from 'lucide-react';
import { ListFooter } from '../components/common/ListFooter';
import {
  adminButtonClass,
  adminIconButtonClass,
} from '../components/common/adminButtonStyles';
import {
  AdminSessionError,
  adminFetch,
  getApiErrorMessage,
} from '../utils/adminFetch';
import { getSwapStatusMeta, SWAP_STATUS_FILTERS } from '../utils/swapStatusMap';
import { AdminBadge } from '../components/ui/AdminBadge';
import { PageTitleBar } from '../components/ui/PageTitleBar';
import { formatAssetAmount, formatRate8 } from '../utils/number-format';
import { formatSlaRemaining } from '../utils/slaDisplay';

/* ── Types ──────────────────────────────────────────────────── */

interface SwapAsset {
  currency: string;
  code: string;
  type: string;
  decimals?: number | null;
}

interface SwapTransactionListItem {
  id: string;
  swapNo: string;
  ownerType: string;
  ownerId: string;
  ownerNo: string | null;
  status: string;
  currentStage: string | null;
  needsReview: boolean;
  fromAsset: SwapAsset;
  fromAmount: string;
  toAsset: SwapAsset;
  toAmount: string;
  netToAmount: string | null;
  spreadAmount: string | null;
  exchangeRate: string;
  createdAt: string;
  slaDeadline?: string | null;
  slaBreached?: boolean;
  customer?: {
    firstName: string | null;
    lastName: string | null;
    customerNo: string;
  } | null;
}

interface FilterState {
  swapNo: string;
  ownerNo: string;
  startDate: string;
  endDate: string;
  /** SWAP_STATUS_FILTERS[].label of the selected filter group, or '' for All. */
  statusGroup: string;
  type: string;
  needsReviewOnly: boolean;
  /** 仅看 SLA 已超时的单（前端过滤，后端暂无该查询参数）。 */
  slaBreachedOnly: boolean;
}

const PAGE_SIZE = 20;

const fmt = (v?: string | null): string => {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString();
};

/* ── Component ──────────────────────────────────────────────── */

const SwapTransactionList = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [items, setItems] = useState<SwapTransactionListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // 客户详情页 → 三域交易跳转（第二幕波一）：深链 ?ownerNo= 初始化过滤，铁律⑥。
  const [filters, setFilters] = useState<FilterState>(() => ({
    swapNo: '',
    ownerNo: searchParams.get('ownerNo')?.trim() ?? '',
    startDate: '',
    endDate: '',
    statusGroup: '',
    type: '',
    needsReviewOnly: false,
    slaBreachedOnly: false,
  }));

  const hasFilters = useMemo(
    () =>
      !!filters.swapNo.trim() ||
      !!filters.ownerNo.trim() ||
      !!filters.startDate ||
      !!filters.endDate ||
      !!filters.statusGroup ||
      !!filters.type ||
      filters.needsReviewOnly ||
      filters.slaBreachedOnly,
    [filters],
  );

  const fetchData = async (pageNum = page, overrides?: Partial<FilterState>) => {
    setLoading(true);
    setError('');
    try {
      const f = { ...filters, ...overrides };
      const params = new URLSearchParams();
      params.set('skip', String((pageNum - 1) * PAGE_SIZE));
      params.set('take', String(PAGE_SIZE));
      if (f.swapNo.trim()) params.set('swapNo', f.swapNo.trim());
      // 铁律⑥：过滤参数用客户业务键 ownerNo，不用内部 ownerId（此前误将该
      // 文本框的值塞进 ownerId 参数，从未真正生效——见 SwapTransactionQueryDto）。
      if (f.ownerNo.trim()) params.set('ownerNo', f.ownerNo.trim());
      if (f.startDate) params.set('startDate', f.startDate);
      if (f.endDate) params.set('endDate', f.endDate);

      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/swap-transactions?${params.toString()}`,
      );
      if (!res.ok) {
        throw new Error(await getApiErrorMessage(res, 'Failed to fetch swap transactions'));
      }
      const body = await res.json();
      setItems(body.items ?? []);
      setTotal(body.total ?? 0);
    } catch (err) {
      if (err instanceof AdminSessionError) return;
      console.error('Failed to fetch swap transactions', err);
      setError('Failed to load swap transactions.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchData(1);
  }, []);

  const handleSearch = () => {
    setPage(1);
    void fetchData(1);
  };

  const handleReset = () => {
    const empty: FilterState = {
      swapNo: '',
      ownerNo: '',
      startDate: '',
      endDate: '',
      statusGroup: '',
      type: '',
      needsReviewOnly: false,
      slaBreachedOnly: false,
    };
    setFilters(empty);
    setPage(1);
    void fetchData(1, empty);
  };

  const handlePageChange = (p: number) => {
    setPage(p);
    void fetchData(p);
  };

  // Backend `status` query param only accepts a single SwapTransactionStatus
  // enum value (no comma-separated list support like the deposit endpoint),
  // so a multi-status filter group (e.g. "In progress") can't be sent as a
  // query param without a 400. Same as `needsReview` / `slaBreached`: apply
  // client-side over the current page only — this does not search the full
  // table, just what's loaded.
  const visibleItems = useMemo(
    () =>
      items
        .filter((it) => (filters.needsReviewOnly ? it.needsReview : true))
        .filter((it) =>
          filters.slaBreachedOnly
            ? formatSlaRemaining(it.slaDeadline, it.slaBreached).tone === 'breached'
            : true,
        )
        .filter((it) => {
          if (!filters.statusGroup) return true;
          const group = SWAP_STATUS_FILTERS.find((f) => f.label === filters.statusGroup);
          return group ? group.statuses.includes(it.status) : true;
        })
        // 与充值/提现同为**页内过滤**（后端 DTO 没有 type 字段）——刻意对齐现状，
        // 不在本批扩后端。兑换一笔单有买卖两侧资产，任一命中即算。
        // ⚠️ 语义提醒：后端只禁 FIAT↔FIAT（swap-transactions.service.ts），所以每笔兑换
        //    至少有一条 crypto 腿 —— 「任一命中」下选 Crypto 恒 100% 命中、筛不掉任何行；
        //    只有 Fiat 有效（能排掉 crypto↔crypto）。刻意与另两域对齐的语义，不是 bug。
        .filter((it) =>
          filters.type
            ? [it.fromAsset.type, it.toAsset.type].some(
                (t) => t?.toUpperCase() === filters.type.toUpperCase(),
              )
            : true,
        ),
    [items, filters.needsReviewOnly, filters.slaBreachedOnly, filters.statusGroup, filters.type],
  );

  const fi =
    'h-[30px] rounded border border-adm-border bg-adm-bg px-2.5 font-mono text-[11px] text-adm-t1 placeholder:text-adm-t3 outline-none focus:border-adm-amber transition-colors';

  return (
    <div className="flex h-full flex-col">
      <PageTitleBar title="Swap Transactions" meta={`${total} swap${total === 1 ? '' : 's'}`}>
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
          value={filters.swapNo}
          onChange={(e) => setFilters((f) => ({ ...f, swapNo: e.target.value }))}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          placeholder="Swap No"
          className={`${fi} w-40`}
        />
        <input
          value={filters.ownerNo}
          onChange={(e) => setFilters((f) => ({ ...f, ownerNo: e.target.value }))}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          placeholder="Owner No"
          className={`${fi} w-36`}
        />
        <select
          value={filters.statusGroup}
          onChange={(e) => setFilters((f) => ({ ...f, statusGroup: e.target.value }))}
          className={`${fi} w-40`}
        >
          <option value="">All status</option>
          {SWAP_STATUS_FILTERS.map((f) => (
            <option key={f.label} value={f.label}>{f.label}</option>
          ))}
        </select>
        <select
          value={filters.type}
          onChange={(e) => setFilters((f) => ({ ...f, type: e.target.value }))}
          className={`${fi} w-32`}
        >
          <option value="">All types</option>
          <option value="CRYPTO">Crypto</option>
          <option value="FIAT">Fiat</option>
        </select>
        <input
          type="date"
          value={filters.startDate}
          onChange={(e) => setFilters((f) => ({ ...f, startDate: e.target.value }))}
          className={`${fi} w-36`}
          title="Start Date"
        />
        <input
          type="date"
          value={filters.endDate}
          onChange={(e) => setFilters((f) => ({ ...f, endDate: e.target.value }))}
          className={`${fi} w-36`}
          title="End Date"
        />
        <button onClick={handleSearch} className={adminButtonClass('listPrimary')}>
          <Search size={13} />
          Search
        </button>
        <button
          onClick={handleReset}
          className={adminButtonClass('listSecondary')}
          disabled={!hasFilters || loading}
        >
          Reset
        </button>
        {/* 前端过滤，只对当前页生效（后端暂无 slaBreached 查询参数）——同下 needsReviewOnly 的局限。
            与充值/提现列表同顺序（SLA breached only 在前）——三域并排对齐,见 D1 A4 顺序对齐。 */}
        <label
          className="ml-2 inline-flex cursor-pointer items-center gap-1.5 font-mono text-[11px] text-adm-t2"
          title="仅过滤当前页已加载的行，不是全库筛选"
        >
          <input
            type="checkbox"
            checked={filters.slaBreachedOnly}
            onChange={(e) =>
              setFilters((f) => ({ ...f, slaBreachedOnly: e.target.checked }))
            }
            className="h-3.5 w-3.5 accent-adm-red"
          />
          SLA breached only (this page)
        </label>
        <label className="ml-2 inline-flex cursor-pointer items-center gap-1.5 font-mono text-[11px] text-adm-t2">
          <input
            type="checkbox"
            checked={filters.needsReviewOnly}
            onChange={(e) =>
              setFilters((f) => ({ ...f, needsReviewOnly: e.target.checked }))
            }
            className="h-3.5 w-3.5 accent-adm-red"
          />
          Needs review only
        </label>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              {(
                [
                  ['Swap No',     '160px'],
                  ['Owner',       '150px'],
                  ['Sell (From)', '150px'],
                  ['Buy (Net)',   '150px'],
                  ['Rate',        '120px'],
                  ['Spread',      '120px'],
                  ['Status',      '120px'],
                  ['Stage',       '110px'],
                  ['SLA',         '100px'],
                  ['Review',      '80px'],
                  ['Created',     '150px'],
                ] as [string, string][]
              ).map(([label, w]) => (
                <th
                  key={label}
                  style={{ width: w }}
                  className="border-b border-adm-border bg-adm-panel px-4 py-2 font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-adm-t3 whitespace-nowrap text-left"
                >
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {error ? (
              <tr>
                <td colSpan={11} className="px-4 py-10 text-center font-mono text-[11px] text-adm-red">
                  {error}
                </td>
              </tr>
            ) : loading && items.length === 0 ? (
              <tr>
                <td colSpan={11} className="px-4 py-10 text-center font-mono text-[11px] text-adm-t3">
                  <RefreshCw className="mx-auto mb-2 animate-spin text-adm-amber" size={20} />
                  Loading…
                </td>
              </tr>
            ) : visibleItems.length === 0 ? (
              <tr>
                <td colSpan={11} className="px-4 py-10 text-center font-mono text-[11px] text-adm-t3">
                  No swap transactions found.
                </td>
              </tr>
            ) : (
              visibleItems.map((item) => (
                <tr
                  key={item.id}
                  className="cursor-pointer border-b border-adm-border transition-colors hover:bg-adm-hover"
                  onClick={() => navigate(`/admin/trading/swaps/${item.id}`)}
                >
                  <td className="px-4 py-2.5">
                    <span className="font-mono text-[11px] font-semibold text-adm-amber">
                      {item.swapNo}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="font-mono text-[11px] text-adm-blue">
                      {item.customer?.customerNo || item.ownerNo || '—'}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 font-mono text-[11px] text-adm-red">
                    {formatAssetAmount(item.fromAmount, item.fromAsset.decimals)}{' '}
                    {item.fromAsset.currency}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-[11px] text-adm-green">
                    {formatAssetAmount(item.netToAmount ?? item.toAmount, item.toAsset.decimals)}{' '}
                    {item.toAsset.currency}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-[10px] text-adm-t2">
                    {formatRate8(item.exchangeRate)}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-[10px] text-adm-t2">
                    {item.spreadAmount
                      ? `${formatAssetAmount(item.spreadAmount, item.toAsset.decimals)} ${item.toAsset.currency}`
                      : '—'}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${getSwapStatusMeta(item.status).badgeClass}`}>
                      {getSwapStatusMeta(item.status).label}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 font-mono text-[10px] text-adm-t2">
                    {item.currentStage ?? '—'}
                  </td>
                  <td className="px-4 py-2.5">
                    {(() => {
                      const sla = formatSlaRemaining(item.slaDeadline, item.slaBreached);
                      return (
                        <span className={sla.tone === 'breached' ? 'font-medium text-red-600' : 'text-gray-600'}>
                          {sla.text}
                        </span>
                      );
                    })()}
                  </td>
                  <td className="px-4 py-2.5">
                    {item.needsReview ? <AdminBadge value="NEEDS_REVIEW" /> : <span className="text-adm-t3">—</span>}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-[10px] text-adm-t2 whitespace-nowrap">
                    {fmt(item.createdAt)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* ── Footer ──（三域共用 ListFooter：一条边框、一个计数、恒显示。
          此前是「手写页脚套 Pagination」，Pagination 自己也是一整条页脚 → 超过一页时
          两条 border-t 叠一起、两个 Showing 并排；见 ListFooter 的 JSDoc）── */}
      <ListFooter
        filteredCount={visibleItems.length}
        total={total}
        noun="swap"
        currentPage={page}
        pageSize={PAGE_SIZE}
        onPageChange={handlePageChange}
      />
    </div>
  );
};

export default SwapTransactionList;
