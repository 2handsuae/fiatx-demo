// admin-web/src/pages/FundsOrderList.tsx
//
// Unified funds-orders admin list (Round 2 / C6). Replaces the three legacy
// surfaces (Payin Records, Payout Records, Internal Funds). One table with a
// parent tab (全部 / 充值 / 提现 / 兑换) that drives the ?parent= filter.
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw, Search } from 'lucide-react';
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
  formatFundsOrderStatusBilingual,
  getFundsOrderStatusTone,
} from '../utils/fundsOrderStatusMap';

/* ── Types ──────────────────────────────────────────────────── */

type ParentTab = 'all' | 'deposit' | 'withdraw' | 'swap';

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

const TABS: Array<{ key: ParentTab; label: string }> = [
  { key: 'all', label: '全部 · All' },
  { key: 'deposit', label: '充值 · Deposit' },
  { key: 'withdraw', label: '提现 · Withdraw' },
  { key: 'swap', label: '兑换 · Swap' },
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

/* ── Component ──────────────────────────────────────────────── */

const FundsOrderList = () => {
  const navigate = useNavigate();

  const [tab, setTab] = useState<ParentTab>('all');
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
    nextTab: ParentTab = tab,
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
      if (nextTab !== 'all') params.set('parent', nextTab);
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

  const switchTab = (next: ParentTab) => {
    setTab(next);
    void fetchItems(1, next);
  };

  const fi =
    'h-[30px] rounded border border-adm-border bg-adm-bg px-2.5 font-mono text-[11px] text-adm-t1 placeholder:text-adm-t3 outline-none focus:border-adm-amber transition-colors';

  const hasFilter = !!status || !!fundsOrderNo;

  const handleSearch = () => void fetchItems(1, tab, status, fundsOrderNo);

  const handleReset = () => {
    setStatus('');
    setFundsOrderNo('');
    void fetchItems(1, tab, '', '');
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* ── Title bar ── */}
      <PageTitleBar
        title="Funds Orders · 资金单"
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

      {/* ── Parent tabs ── */}
      <div className="flex shrink-0 items-center gap-1 border-b border-adm-border bg-adm-panel px-5 pt-2">
        {TABS.map((t) => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => switchTab(t.key)}
              className={`rounded-t px-3 py-1.5 font-mono text-[11px] transition-colors ${
                active
                  ? 'border-b-2 border-adm-amber font-semibold text-adm-amber'
                  : 'border-b-2 border-transparent text-adm-t3 hover:text-adm-t1'
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </div>

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
                <td colSpan={7} className="px-4 py-10 text-center font-mono text-[11px] text-adm-t3">
                  Loading…
                </td>
              </tr>
            )}
            {!loading && items.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center font-mono text-[11px] text-adm-t3">
                  No funds orders found.
                </td>
              </tr>
            )}
            {!loading &&
              items.map((item) => {
                const parent = parentOf(item);
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

                    {/* Status — bilingual, asset-type aware */}
                    <td className="px-4 py-2.5">
                      <span
                        className={`inline-block rounded border px-2 py-0.5 font-mono text-[10px] ${getFundsOrderStatusTone(item.status)}`}
                      >
                        {formatFundsOrderStatusBilingual(item.status, item.asset?.type)}
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
