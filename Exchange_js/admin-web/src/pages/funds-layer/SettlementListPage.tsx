// admin-web/src/pages/funds-layer/SettlementListPage.tsx
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Play, RefreshCw, Search, Zap } from 'lucide-react';
import Pagination from '../../components/common/Pagination';
import {
  adminButtonClass,
  adminIconButtonClass,
} from '../../components/common/adminButtonStyles';
import { PageTitleBar } from '../../components/ui/PageTitleBar';
import { StatusPill } from '../../components/ui/StatusPill';
import {
  AdminSessionError,
  adminFetch,
  getApiErrorMessage,
} from '../../utils/adminFetch';

/* ── Types ──────────────────────────────────────────────────── */

interface SettlementItem {
  batchNo: string;
  settlementType: string | null;
  status: string;
  totalAssetCount: number | null;
  settledAssetCount: number | null;
  createdAt: string;
}

interface FilterState {
  batchNo: string;
  settlementType: string;
  status: string;
}

/* ── Constants ──────────────────────────────────────────────── */

const PAGE_SIZE = 20;

const DEFAULT_FILTERS: FilterState = {
  batchNo: '',
  settlementType: '',
  status: '',
};

/* ── Helpers ────────────────────────────────────────────────── */

const fmt = (v?: string | null): string => {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString();
};

/* ── Component ──────────────────────────────────────────────── */

const SettlementListPage = () => {
  const navigate = useNavigate();

  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [items, setItems] = useState<SettlementItem[]>([]);
  const [total, setTotal] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [settling, setSettling] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const requestSeqRef = useRef(0);

  const fetchItems = async (page: number, next: FilterState = filters) => {
    const seq = ++requestSeqRef.current;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set('skip', String((page - 1) * PAGE_SIZE));
      params.set('take', String(PAGE_SIZE));
      if (next.batchNo.trim()) params.set('batchNo', next.batchNo.trim());
      if (next.settlementType.trim())
        params.set('settlementType', next.settlementType.trim());
      if (next.status) params.set('status', next.status);

      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/funds-layer/settlements?${params.toString()}`,
      );
      if (!res.ok)
        throw new Error(await getApiErrorMessage(res, 'Failed to load settlement batches.'));

      const data = await res.json();
      if (seq !== requestSeqRef.current) return;

      setItems(Array.isArray(data.items) ? data.items : []);
      setTotal(typeof data.total === 'number' ? data.total : 0);
      setCurrentPage(page);
    } catch (err) {
      if (seq !== requestSeqRef.current) return;
      if (err instanceof AdminSessionError) return;
      setError(err instanceof Error ? err.message : 'Failed to load settlement batches.');
    } finally {
      if (seq === requestSeqRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    void fetchItems(1, DEFAULT_FILTERS);
  }, []);

  const fi =
    'h-[30px] rounded border border-adm-border bg-adm-bg px-2.5 font-mono text-[11px] text-adm-t1 placeholder:text-adm-t3 outline-none focus:border-adm-amber transition-colors';

  const hasFilter = !!filters.batchNo || !!filters.settlementType || !!filters.status;

  const updateFilter = (key: keyof FilterState, value: string) =>
    setFilters((prev) => ({ ...prev, [key]: value }));

  const handleSearch = () => void fetchItems(1, filters);

  const handleReset = () => {
    setFilters(DEFAULT_FILTERS);
    void fetchItems(1, DEFAULT_FILTERS);
  };

  // Manual EOD run — nets ALL open crypto outstandings (grouped by currency)
  // into one batch, mirroring the 23:59 cron. No-op if nothing is open.
  const handleRunEod = async () => {
    setRunning(true);
    setError(null);
    try {
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/funds-layer/settlements/run`,
        { method: 'POST' },
      );
      if (!res.ok)
        throw new Error(await getApiErrorMessage(res, 'EOD settlement run failed.'));
      await fetchItems(1, DEFAULT_FILTERS);
      setFilters(DEFAULT_FILTERS);
    } catch (err) {
      if (err instanceof AdminSessionError) return;
      setError(err instanceof Error ? err.message : 'EOD settlement run failed.');
    } finally {
      setRunning(false);
    }
  };

  // Manual settle — settle + bridge-sweep, no FX reval.
  // Null batchNo means no open crypto outstandings.
  const handleManualSettle = async () => {
    if (
      !window.confirm(
        'Run manual settle (settle + bridge-sweep, no FX reval)?\nThis will net all open crypto outstandings into a new batch.',
      )
    )
      return;
    setSettling(true);
    setError(null);
    setNotice(null);
    try {
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/funds-layer/settlements/settle`,
        { method: 'POST' },
      );
      if (!res.ok)
        throw new Error(await getApiErrorMessage(res, 'Manual settle failed.'));
      const data = (await res.json()) as {
        batchNo: string | null;
        assetCount: number;
        settledZero: number;
        spawned: number;
      };
      if (data.batchNo) {
        setNotice(
          `Manual settle done — batch ${data.batchNo} (${data.assetCount} assets, ${data.settledZero} zero-settled, ${data.spawned} transfer(s) spawned)`,
        );
      } else {
        setNotice('No open crypto outstandings — nothing to settle.');
      }
      await fetchItems(1, DEFAULT_FILTERS);
      setFilters(DEFAULT_FILTERS);
    } catch (err) {
      if (err instanceof AdminSessionError) return;
      setError(err instanceof Error ? err.message : 'Manual settle failed.');
    } finally {
      setSettling(false);
    }
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* ── Title bar ── */}
      <PageTitleBar
        title="Settlement Batches"
        meta={`${total} batch${total === 1 ? '' : 'es'}`}
      >
        <button
          onClick={() => void handleRunEod()}
          disabled={running || settling}
          className={adminButtonClass('listPrimary')}
          title="Net all open crypto outstandings into a settlement batch (mirrors EOD cron)"
        >
          <Play size={13} />
          {running ? 'Running…' : 'Run EOD Settlement'}
        </button>
        <button
          onClick={() => void handleManualSettle()}
          disabled={running || settling}
          className={adminButtonClass('listSecondary')}
          title="Settle + bridge-sweep, no FX reval — manual trigger"
        >
          <Zap size={13} />
          {settling ? 'Settling…' : 'Manual Settle (no reval)'}
        </button>
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
          value={filters.batchNo}
          onChange={(e) => updateFilter('batchNo', e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          placeholder="Batch No"
          className={`${fi} w-44`}
        />
        <input
          value={filters.settlementType}
          onChange={(e) => updateFilter('settlementType', e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          placeholder="Settlement Type"
          className={`${fi} w-44`}
        />
        <input
          value={filters.status}
          onChange={(e) => updateFilter('status', e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          placeholder="Status"
          className={`${fi} w-40`}
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
      </div>

      {/* ── Notices ── */}
      {error && (
        <div className="shrink-0 border-b border-adm-red/20 bg-adm-red/6 px-5 py-2.5 font-mono text-[11px] text-adm-red">
          {error}
        </div>
      )}
      {notice && (
        <div className="shrink-0 border-b border-adm-amber/20 bg-adm-amber/6 px-5 py-2.5 font-mono text-[11px] text-adm-amber">
          {notice}
        </div>
      )}

      {/* ── Table ── */}
      <div className="flex-1 overflow-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              {(
                [
                  ['Batch No',  '200px'],
                  ['Type',      '160px'],
                  ['Status',    '130px'],
                  ['Assets',    '120px'],
                  ['Created',   '150px'],
                ] as [string, string][]
              ).map(([label, w]) => (
                <th
                  key={label}
                  style={{ width: w }}
                  className={`border-b border-adm-border bg-adm-panel px-4 py-2 font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-adm-t3 whitespace-nowrap ${label === 'Assets' ? 'text-right' : 'text-left'}`}
                >
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center font-mono text-[11px] text-adm-t3">
                  Loading…
                </td>
              </tr>
            )}
            {!loading && items.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center font-mono text-[11px] text-adm-t3">
                  No settlement batches found.
                </td>
              </tr>
            )}
            {!loading &&
              items.map((item) => (
                <tr
                  key={item.batchNo}
                  className="cursor-pointer border-b border-adm-border transition-colors hover:bg-adm-hover"
                  onClick={() => navigate(`/admin/funds/settlements/${item.batchNo}`)}
                >
                  {/* Batch No */}
                  <td className="px-4 py-2.5">
                    <span className="font-mono text-[11px] font-semibold text-adm-amber">
                      {item.batchNo}
                    </span>
                  </td>

                  {/* Type */}
                  <td className="px-4 py-2.5">
                    <span className="font-mono text-[10px] text-adm-t1">
                      {item.settlementType || '—'}
                    </span>
                  </td>

                  {/* Status */}
                  <td className="px-4 py-2.5">
                    <StatusPill value={item.status} />
                  </td>

                  {/* Assets */}
                  <td className="px-4 py-2.5 text-right">
                    <span className="font-mono text-[11px] text-adm-t1">
                      {item.settledAssetCount ?? 0} / {item.totalAssetCount ?? 0}
                    </span>
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
              ? `Showing ${items.length} / ${total} batch${total === 1 ? '' : 'es'}`
              : 'No settlement batches'}
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

export default SettlementListPage;
