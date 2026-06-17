import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { RefreshCw, Search } from 'lucide-react';
import Pagination from '../components/common/Pagination';
import {
  adminButtonClass,
} from '../components/common/adminButtonStyles';
import {
  AdminPermissionError,
  AdminSessionError,
  adminFetch,
  getApiErrorMessage,
} from '../utils/adminFetch';
import { AdminBadge } from '../components/ui/AdminBadge';
import { PageTitleBar } from '../components/ui/PageTitleBar';

/* ── Interfaces ──────────────────────────────────────────────── */

interface RefreshCycleItem {
  id: string;
  cycleNo: string;
  customerId: string;
  holdingId: string;
  materialType: string;
  status: string;
  stage?: string | null;
  triggerType: string;
  sumsubActionId?: string | null;
  graceExpiresAt?: string | null;
  clearedAt?: string | null;
  rejectedAt?: string | null;
  createdAt: string;
  customer?: {
    customerNo?: string;
    email?: string;
    riskTier?: string;
  };
  holding?: {
    materialType?: string;
    status?: string;
    expiresAt?: string | null;
  };
}

/* ── Helpers ─────────────────────────────────────────────────── */

const fmtDate = (v?: string | null): string => {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleDateString();
};

const MATERIAL_LABELS: Record<string, string> = {
  EMIRATES_ID: 'Emirates ID',
  LIVENESS: 'Liveness',
  PROOF_OF_ADDRESS: 'Proof of Address',
  SOURCE_OF_FUNDS: 'Source of Funds',
  SOURCE_OF_WEALTH: 'Source of Wealth',
};

/* ── Page ────────────────────────────────────────────────────── */

const PAGE_SIZE = 30;

const RefreshCyclesPage = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [items, setItems] = useState<RefreshCycleItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [statusFilter, setStatusFilter] = useState(
    searchParams.get('status') || '',
  );
  const [materialFilter, setMaterialFilter] = useState(
    searchParams.get('materialType') || '',
  );
  const [page, setPage] = useState(0);

  const fetchCycles = async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set('status', statusFilter);
      if (materialFilter) params.set('materialType', materialFilter);
      params.set('skip', String(page * PAGE_SIZE));
      params.set('take', String(PAGE_SIZE));

      const customerId = searchParams.get('customerId');
      if (customerId) params.set('customerId', customerId);

      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/material-management/cycles?${params}`,
      );
      if (!res.ok) throw new Error(await getApiErrorMessage(res, 'Failed to load cycles.'));
      const data = await res.json();
      setItems(data.items || []);
      setTotal(data.total || 0);
    } catch (e: unknown) {
      if (e instanceof AdminSessionError || e instanceof AdminPermissionError) return;
      setError(e instanceof Error ? e.message : 'Failed to load cycles.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchCycles();
  }, [page]);

  const handleSearch = () => {
    setPage(0);
    void fetchCycles();
  };

  const handleReset = () => {
    setStatusFilter('');
    setMaterialFilter('');
    setPage(0);
    setTimeout(() => void fetchCycles(), 0);
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* ── Title bar ── */}
      <PageTitleBar
        title="Refresh Cycles"
        meta={`${total} cycle${total !== 1 ? 's' : ''} · Compliance Center`}
      >
        <button
          onClick={() => void fetchCycles()}
          className="rounded p-1.5 text-adm-t3 transition-colors hover:bg-adm-hover hover:text-adm-t1"
          title="Refresh"
        >
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
        </button>
      </PageTitleBar>

      {/* ── Filters ── */}
      <div className="shrink-0 border-b border-adm-border bg-adm-panel px-6 py-3 flex flex-wrap items-center gap-3">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded border border-adm-border bg-adm-card px-3 py-1.5 font-mono text-[11px] text-adm-t2"
        >
          <option value="">All statuses</option>
          <option value="PENDING_CUSTOMER_EVIDENCE">PENDING</option>
          <option value="CLEARED">CLEARED</option>
          <option value="REJECTED">REJECTED</option>
        </select>

        <select
          value={materialFilter}
          onChange={(e) => setMaterialFilter(e.target.value)}
          className="rounded border border-adm-border bg-adm-card px-3 py-1.5 font-mono text-[11px] text-adm-t2"
        >
          <option value="">All material types</option>
          <option value="EMIRATES_ID">Emirates ID</option>
          <option value="LIVENESS">Liveness</option>
          <option value="PROOF_OF_ADDRESS">Proof of Address</option>
          <option value="SOURCE_OF_FUNDS">Source of Funds</option>
          <option value="SOURCE_OF_WEALTH">Source of Wealth</option>
        </select>

        <button onClick={handleSearch} className={adminButtonClass('workflowPrimary')}>
          <Search size={13} /> Search
        </button>

        <button
          onClick={handleReset}
          className="font-mono text-[11px] text-adm-t3 hover:text-adm-t1"
        >
          Reset
        </button>
      </div>

      {/* ── Error ── */}
      {error && (
        <div className="shrink-0 px-6 pt-3">
          <div className="rounded border border-adm-red/30 bg-adm-red/10 px-4 py-2 font-mono text-[11px] text-adm-red">
            {error}
          </div>
        </div>
      )}

      {/* ── Table ── */}
      <div className="flex-1 overflow-auto">
        <table className="w-full">
          <thead className="sticky top-0 z-10 bg-adm-panel">
            <tr className="border-b border-adm-border text-left font-mono text-[9px] uppercase tracking-[0.1em] text-adm-t3">
              <th className="px-6 py-3">Cycle No</th>
              <th className="px-3 py-3">Customer</th>
              <th className="px-3 py-3">Material</th>
              <th className="px-3 py-3">Status</th>
              <th className="px-3 py-3">Stage</th>
              <th className="px-3 py-3">Trigger</th>
              <th className="px-3 py-3">Created</th>
              <th className="px-3 py-3">Grace</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-adm-border">
            {loading && items.length === 0 && (
              <tr>
                <td colSpan={8} className="px-6 py-8 text-center">
                  <RefreshCw size={18} className="mx-auto animate-spin text-adm-amber" />
                </td>
              </tr>
            )}
            {!loading && items.length === 0 && (
              <tr>
                <td colSpan={8} className="px-6 py-8 text-center font-mono text-[11px] text-adm-t3">
                  No refresh cycles found.
                </td>
              </tr>
            )}
            {items.map((cycle) => (
              <tr
                key={cycle.id}
                className="cursor-pointer transition-colors hover:bg-adm-hover"
                onClick={() =>
                  navigate(
                    `/admin/customers/refresh-cycles/${cycle.id}`,
                  )
                }
              >
                <td className="px-6 py-3 font-mono text-[11px] font-semibold text-adm-amber">
                  {cycle.cycleNo}
                </td>
                <td className="px-3 py-3 font-mono text-[11px] text-adm-amber">
                  {cycle.customer?.customerNo}
                </td>
                <td className="px-3 py-3 font-mono text-[10px] text-adm-t2">
                  {MATERIAL_LABELS[cycle.materialType] || cycle.materialType}
                </td>
                <td className="px-3 py-3">
                  <AdminBadge value={cycle.status} />
                </td>
                <td className="px-3 py-3 font-mono text-[10px] text-adm-t2">
                  {cycle.stage || '—'}
                </td>
                <td className="px-3 py-3 font-mono text-[9px] text-adm-t3">
                  {cycle.triggerType}
                </td>
                <td className="px-3 py-3 font-mono text-[10px] text-adm-t2">
                  {fmtDate(cycle.createdAt)}
                </td>
                <td className="px-3 py-3 font-mono text-[10px] text-adm-t2">
                  {fmtDate(cycle.graceExpiresAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Pagination ── */}
      <div className="shrink-0 border-t border-adm-border bg-adm-panel px-6 py-2">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[10px] text-adm-t3">
            Showing {Math.min(items.length, PAGE_SIZE)} / {total} cycle{total !== 1 ? 's' : ''}
          </span>
          {total > PAGE_SIZE && (
            <Pagination
              currentPage={page}
              totalItems={total}
              pageSize={PAGE_SIZE}
              onPageChange={setPage}
            />
          )}
        </div>
      </div>
    </div>
  );
};

export default RefreshCyclesPage;
