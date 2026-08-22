// admin-web/src/pages/DepositTransactionList.tsx
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw, Search } from 'lucide-react';
import Pagination from '../components/common/Pagination';
import {
  adminButtonClass,
  adminIconButtonClass,
} from '../components/common/adminButtonStyles';
import { formatAssetAmount } from '../utils/number-format';
import {
  AdminSessionError,
  adminFetch,
  getApiErrorMessage,
} from '../utils/adminFetch';
import { formatTransactionTypeLabel } from '../utils/transactionRootDisplay';
import { DEPOSIT_STATUS_FILTERS, getDepositStatusMeta } from '../utils/depositStatusMap';
import { formatSlaRemaining } from '../utils/slaDisplay';
import { PageTitleBar } from '../components/ui/PageTitleBar';
import { AdminBadge } from '../components/ui/AdminBadge';

/* ── Interfaces ──────────────────────────────────────────────── */

interface DepositItem {
  id: string;
  depositNo: string;
  ownerNo: string | null;
  ownerId: string;
  ownerType: string;
  status: string;
  amount: string;
  type?: string | null;
  asset: { code: string; type: string; decimals?: number };
  createdAt: string;
  limitHoldReason?: string | null;
  slaDeadline?: string | null;
  slaBreached?: boolean;
  needsReview?: boolean;
}

interface FilterState {
  depositNo: string;
  ownerNo: string;
  /** DEPOSIT_STATUS_FILTERS[].label of the selected filter group, or '' for All. */
  status: string;
  type: string;
  startDate: string;
  endDate: string;
  needsReviewOnly: boolean;
  /** 仅看 SLA 已超时的单（前端过滤，后端暂无该查询参数）。 */
  slaBreachedOnly: boolean;
}

/* ── Constants ───────────────────────────────────────────────── */

const PAGE_SIZE = 20;

const DEFAULT_FILTERS: FilterState = {
  depositNo: '',
  ownerNo: '',
  status: '',
  type: '',
  startDate: '',
  endDate: '',
  needsReviewOnly: false,
  slaBreachedOnly: false,
};

/* ── Helpers ─────────────────────────────────────────────────── */

const fmt = (v?: string | null): string => {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString();
};

/* ── Component ───────────────────────────────────────────────── */

const DepositTransactionList = () => {
  const navigate = useNavigate();

  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [items, setItems] = useState<DepositItem[]>([]);
  const [total, setTotal] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const requestSeqRef = useRef(0);

  /* ── Data fetching ── */

  const fetchItems = async (page: number, next: FilterState = filters) => {
    const seq = ++requestSeqRef.current;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set('skip', String((page - 1) * PAGE_SIZE));
      params.set('take', String(PAGE_SIZE));
      if (next.depositNo.trim()) params.set('depositNo', next.depositNo.trim());
      if (next.ownerNo.trim()) params.set('ownerNo', next.ownerNo.trim());
      if (next.status) {
        const group = DEPOSIT_STATUS_FILTERS.find((f) => f.label === next.status);
        if (group) params.set('status', group.statuses.join(','));
      }
      if (next.startDate) params.set('startDate', next.startDate);
      if (next.endDate) params.set('endDate', next.endDate);

      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/deposit-transactions?${params.toString()}`,
      );
      if (!res.ok) throw new Error(await getApiErrorMessage(res, 'Failed to load deposits.'));

      const data = await res.json();
      if (seq !== requestSeqRef.current) return;

      let filtered = Array.isArray(data.items) ? data.items : [];
      if (next.type) {
        filtered = filtered.filter(
          (i: DepositItem) => (i.type || i.asset.type)?.toUpperCase() === next.type.toUpperCase(),
        );
      }
      setItems(filtered);
      setTotal(typeof data.total === 'number' ? data.total : 0);
      setCurrentPage(page);
    } catch (err) {
      if (seq !== requestSeqRef.current) return;
      if (err instanceof AdminSessionError) return;
      setError(err instanceof Error ? err.message : 'Failed to load deposits.');
    } finally {
      if (seq === requestSeqRef.current) setLoading(false);
    }
  };

  useEffect(() => { void fetchItems(1, DEFAULT_FILTERS); }, []);

  /* ── Filter helpers ── */

  const fi =
    'h-[30px] rounded border border-adm-border bg-adm-bg px-2.5 font-mono text-[11px] text-adm-t1 placeholder:text-adm-t3 outline-none focus:border-adm-amber transition-colors';

  const hasFilter =
    !!filters.depositNo || !!filters.ownerNo || !!filters.status ||
    !!filters.type || !!filters.startDate || !!filters.endDate ||
    filters.needsReviewOnly || filters.slaBreachedOnly;

  const updateFilter = (key: keyof FilterState, value: string) =>
    setFilters((prev) => ({ ...prev, [key]: value }));

  const handleSearch = () => void fetchItems(1, filters);

  const handleReset = () => {
    setFilters(DEFAULT_FILTERS);
    void fetchItems(1, DEFAULT_FILTERS);
  };

  // Backend has no `needsReview` / `slaBreached` query filter yet; apply
  // client-side over the current page only (same known limitation as
  // needsReviewOnly on the swap list).
  const visibleItems = useMemo(
    () =>
      items
        .filter((it) => (filters.needsReviewOnly ? it.needsReview : true))
        .filter((i) =>
          filters.slaBreachedOnly
            ? formatSlaRemaining(i.slaDeadline, i.slaBreached).tone === 'breached'
            : true,
        ),
    [items, filters.needsReviewOnly, filters.slaBreachedOnly],
  );

  /* ── Render ── */

  return (
    <div className="flex h-full flex-col overflow-hidden">

      {/* ── Title bar ── */}
      <PageTitleBar
        title="Deposit Transactions"
        meta={`${total} deposit${total === 1 ? '' : 's'}`}
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
          value={filters.depositNo}
          onChange={(e) => updateFilter('depositNo', e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          placeholder="Deposit No"
          className={`${fi} w-40`}
        />
        <input
          value={filters.ownerNo}
          onChange={(e) => updateFilter('ownerNo', e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          placeholder="Owner No"
          className={`${fi} w-36`}
        />
        <select
          value={filters.status}
          onChange={(e) => updateFilter('status', e.target.value)}
          className={`${fi} w-40`}
        >
          <option value="">All</option>
          {DEPOSIT_STATUS_FILTERS.map((f) => (
            <option key={f.label} value={f.label}>{f.label}</option>
          ))}
        </select>
        <select
          value={filters.type}
          onChange={(e) => updateFilter('type', e.target.value)}
          className={`${fi} w-32`}
        >
          <option value="">All types</option>
          <option value="CRYPTO">Crypto</option>
          <option value="FIAT">Fiat</option>
        </select>
        <input
          type="date"
          value={filters.startDate}
          onChange={(e) => updateFilter('startDate', e.target.value)}
          className={`${fi} w-36`}
        />
        <input
          type="date"
          value={filters.endDate}
          onChange={(e) => updateFilter('endDate', e.target.value)}
          className={`${fi} w-36`}
        />
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
        {/* 前端过滤，只对当前页生效（后端暂无 slaBreached 查询参数）——与下方 needsReviewOnly 同类局限 */}
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
                  ['Deposit No', '160px'],
                  ['Status',     '130px'],
                  ['Amount',     '140px'],
                  ['Type',       '90px'],
                  ['Owner',      '130px'],
                  ['SLA',        '100px'],
                  ['Review',     '80px'],
                  ['Created',    '150px'],
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
            {!loading && visibleItems.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center font-mono text-[11px] text-adm-t3">
                  No deposits found.
                </td>
              </tr>
            )}
            {!loading && visibleItems.map((item) => (
              <tr
                key={item.id}
                className="cursor-pointer border-b border-adm-border transition-colors hover:bg-adm-hover"
                onClick={() => navigate(`/admin/trading/deposits/${item.id}`)}
              >
                {/* Deposit No */}
                <td className="px-4 py-2.5">
                  <span className="font-mono text-[11px] font-semibold text-adm-amber">
                    {item.depositNo}
                  </span>
                </td>

                {/* Status */}
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-1.5">
                    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${getDepositStatusMeta(item.status).badgeClass}`}>
                      {getDepositStatusMeta(item.status).label}
                    </span>
                    {item.limitHoldReason === 'BELOW_MIN' && <AdminBadge value="BELOW MIN" dot={false} />}
                  </div>
                </td>

                {/* Amount */}
                <td className="px-4 py-2.5 text-right">
                  <span className="font-mono text-[11px] text-adm-t1">
                    {formatAssetAmount(item.amount, item.asset.decimals)} {item.asset.code}
                  </span>
                </td>

                {/* Type */}
                <td className="px-4 py-2.5">
                  <span className={`font-mono text-[10px] font-semibold ${(item.type || item.asset.type)?.toUpperCase() === 'CRYPTO' ? 'text-adm-amber' : 'text-adm-blue'}`}>
                    {formatTransactionTypeLabel(item.type || item.asset.type)}
                  </span>
                </td>

                {/* Owner */}
                <td className="px-4 py-2.5">
                  <span className="font-mono text-[11px] text-adm-blue">{item.ownerNo || '—'}</span>
                </td>

                {/* SLA */}
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

                {/* Review */}
                <td className="px-4 py-2.5">
                  {item.needsReview ? <AdminBadge value="NEEDS_REVIEW" /> : <span className="text-adm-t3">—</span>}
                </td>

                {/* Created */}
                <td className="px-4 py-2.5 font-mono text-[10px] text-adm-t2 whitespace-nowrap">
                  {fmt(item.createdAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Footer ── */}
      <div className="shrink-0 border-t border-adm-border bg-adm-panel px-5 py-2.5">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[10px] text-adm-t3">
            {total > 0
              ? `Showing ${visibleItems.length} / ${total} deposit${total === 1 ? '' : 's'}`
              : 'No deposits'}
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

export default DepositTransactionList;
