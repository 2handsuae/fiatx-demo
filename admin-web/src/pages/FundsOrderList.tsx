// admin-web/src/pages/FundsOrderList.tsx
//
// Unified funds-orders admin list (Round 2 / C6). Replaces the three legacy
// surfaces (Payin Records, Payout Records, Internal Funds). One table with a
// Type filter (All / Deposit / Withdraw / Swap) in the filter bar driving the
// ?parent= query. English-only surface.
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Copy, RefreshCw, Search } from 'lucide-react';
import { ListFooter } from '../components/common/ListFooter';
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

type ParentType = 'all' | 'deposit' | 'withdraw' | 'swap' | 'internal-transfer' | 'lp-exchange';

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
  // 平账二期：第四种父键——内部划转单
  transferNo?: string | null;
  // 战役乙波一 T8（改派项 R11a）：第五种父键——LP 兑换单。
  exchangeNo?: string | null;
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
  { key: 'internal-transfer', label: 'Internal transfer' },
  { key: 'lp-exchange', label: 'LP exchange' },
];

/* ── Helpers ────────────────────────────────────────────────── */

// Which parent business no + kind applies to this row.
const parentOf = (
  item: FundsOrderItem,
): { kind: string; no: string | null } => {
  if (item.depositNo) return { kind: 'Deposit', no: item.depositNo };
  if (item.withdrawNo) return { kind: 'Withdraw', no: item.withdrawNo };
  if (item.swapNo) return { kind: 'Swap', no: item.swapNo };
  if (item.transferNo) return { kind: 'Internal transfer', no: item.transferNo };
  if (item.exchangeNo) return { kind: 'LP exchange', no: item.exchangeNo };
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
                        {formatFundsOrderStatusLabel(item.status, item.asset?.type)}
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
      <ListFooter
        filteredCount={items.length}
        total={total}
        noun="order"
        currentPage={currentPage}
        pageSize={PAGE_SIZE}
        onPageChange={(page) => void fetchItems(page)}
      />
    </div>
  );
};

export default FundsOrderList;
