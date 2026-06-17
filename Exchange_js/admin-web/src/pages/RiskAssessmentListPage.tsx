import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { RefreshCw, Search } from 'lucide-react';
import Pagination from '../components/common/Pagination';
import { adminButtonClass } from '../components/common/adminButtonStyles';
import {
  AdminPermissionError,
  AdminSessionError,
  adminFetch,
  getApiErrorMessage,
} from '../utils/adminFetch';
import { AdminBadge } from '../components/ui/AdminBadge';
import { PageTitleBar } from '../components/ui/PageTitleBar';

/* ── Interfaces ──────────────────────────────────────────────── */

interface RiskAssessmentItem {
  id: string;
  assessmentNo?: string;
  customerId: string;
  status: string;
  triggerType: string;
  previousTier?: string | null;
  resultingTier?: string | null;
  signoffMethod?: string | null;
  recommendedAction?: string | null;
  createdAt: string;
  customer?: {
    customerNo?: string;
    email?: string;
    riskTier?: string;
  };
}

/* ── Helpers ─────────────────────────────────────────────────── */

const fmtDate = (v?: string | null): string => {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleDateString();
};

/* ── Page ────────────────────────────────────────────────────── */

const PAGE_SIZE = 30;

const RiskAssessmentListPage = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [items, setItems] = useState<RiskAssessmentItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [statusFilter, setStatusFilter] = useState(
    searchParams.get('status') || '',
  );
  const [triggerFilter, setTriggerFilter] = useState(
    searchParams.get('triggerType') || '',
  );
  const [page, setPage] = useState(0);

  const [startCraModalOpen, setStartCraModalOpen] = useState(false);
  const [startCraCustomerNo, setStartCraCustomerNo] = useState('');
  const [startCraLoading, setStartCraLoading] = useState(false);
  const [startCraError, setStartCraError] = useState('');

  const fetchAssessments = async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set('status', statusFilter);
      if (triggerFilter) params.set('triggerType', triggerFilter);
      params.set('skip', String(page * PAGE_SIZE));
      params.set('take', String(PAGE_SIZE));

      const customerId = searchParams.get('customerId');
      if (customerId) params.set('customerId', customerId);

      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/compliance/risk-assessments?${params}`,
      );
      if (!res.ok) throw new Error(await getApiErrorMessage(res, 'Failed to load assessments.'));
      const data = await res.json();
      setItems(data.items || []);
      setTotal(data.total || 0);
    } catch (e: unknown) {
      if (e instanceof AdminSessionError || e instanceof AdminPermissionError) return;
      setError(e instanceof Error ? e.message : 'Failed to load assessments.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchAssessments();
  }, [page]);

  const handleSearch = () => {
    setPage(0);
    void fetchAssessments();
  };

  const handleReset = () => {
    setStatusFilter('');
    setTriggerFilter('');
    setPage(0);
    setTimeout(() => void fetchAssessments(), 0);
  };

  const handleStartCra = async () => {
    if (!startCraCustomerNo.trim()) return;
    setStartCraLoading(true);
    setStartCraError('');
    try {
      // Resolve customerNo → customerId
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/customers?customerNo=${encodeURIComponent(startCraCustomerNo)}`,
      );
      const data = await res.json();
      const customerId = data.items?.[0]?.id;
      if (!customerId) {
        setStartCraError('Customer not found');
        return;
      }

      const trigRes = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/compliance/customers/${customerId}/risk-assessment/trigger`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: 'Manual trigger' }),
        },
      );
      if (!trigRes.ok) {
        const err = await trigRes.json();
        setStartCraError(err.message || 'Trigger failed');
        return;
      }
      setStartCraModalOpen(false);
      setStartCraCustomerNo('');
      void fetchAssessments();
    } finally {
      setStartCraLoading(false);
    }
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* ── Title bar ── */}
      <PageTitleBar
        title="Risk Assessments"
        meta={`${total} assessment${total !== 1 ? 's' : ''} · Compliance Center`}
      >
        <button
          onClick={() => setStartCraModalOpen(true)}
          className={adminButtonClass('workflowPrimary')}
        >
          + Start CRA
        </button>
        <button
          onClick={() => void fetchAssessments()}
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
          <option value="PENDING_SUMSUB_RESULT">PENDING_SUMSUB_RESULT</option>
          <option value="PENDING_PHASE1_APPROVAL">PENDING_PHASE1_APPROVAL</option>
          <option value="PENDING_MATERIAL_SUBMISSION">PENDING_MATERIAL_SUBMISSION</option>
          <option value="PENDING_PHASE2_APPROVAL">PENDING_PHASE2_APPROVAL</option>
          <option value="PENDING_SIGNATURE">PENDING_SIGNATURE</option>
          <option value="SIGNED">SIGNED</option>
          <option value="ESCALATED_TO_SUMSUB">ESCALATED_TO_SUMSUB</option>
        </select>

        <select
          value={triggerFilter}
          onChange={(e) => setTriggerFilter(e.target.value)}
          className="rounded border border-adm-border bg-adm-card px-3 py-1.5 font-mono text-[11px] text-adm-t2"
        >
          <option value="">All triggers</option>
          <option value="INITIAL_ONBOARDING">INITIAL_ONBOARDING</option>
          <option value="SCHEDULED_QUARTERLY">SCHEDULED_QUARTERLY</option>
          <option value="SUMSUB_AML_HIT">SUMSUB_AML_HIT</option>
          <option value="MLRO_MANUAL">MLRO_MANUAL</option>
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
              <th className="px-6 py-3">Assessment No</th>
              <th className="px-3 py-3">Customer</th>
              <th className="px-3 py-3">Previous Tier</th>
              <th className="px-3 py-3">Resulting Tier</th>
              <th className="px-3 py-3">Status</th>
              <th className="px-3 py-3">Signoff</th>
              <th className="px-3 py-3">Trigger</th>
              <th className="px-3 py-3">Created</th>
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
                  No risk assessments found.
                </td>
              </tr>
            )}
            {items.map((item) => (
              <tr
                key={item.id}
                className="cursor-pointer transition-colors hover:bg-adm-hover"
                onClick={() =>
                  navigate(`/admin/compliance/risk-assessments/${item.id}`)
                }
              >
                <td className="px-6 py-3 font-mono text-[11px] font-semibold text-adm-amber">
                  {item.assessmentNo || item.id.slice(0, 12)}
                </td>
                <td className="px-3 py-3 font-mono text-[11px] text-adm-amber">
                  {item.customer?.customerNo}
                </td>
                <td className="px-3 py-3">
                  {item.previousTier ? <AdminBadge value={item.previousTier} /> : <span className="font-mono text-[10px] text-adm-t3">—</span>}
                </td>
                <td className="px-3 py-3">
                  {item.resultingTier ? <AdminBadge value={item.resultingTier} /> : <span className="font-mono text-[10px] text-adm-t3">—</span>}
                </td>
                <td className="px-3 py-3">
                  <AdminBadge value={item.status} />
                </td>
                <td className="px-3 py-3 font-mono text-[10px] text-adm-t2">
                  {item.signoffMethod || '—'}
                </td>
                <td className="px-3 py-3 font-mono text-[9px] text-adm-t3">
                  {item.triggerType}
                </td>
                <td className="px-3 py-3 font-mono text-[10px] text-adm-t2">
                  {fmtDate(item.createdAt)}
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
            Showing {Math.min(items.length, PAGE_SIZE)} / {total} assessment{total !== 1 ? 's' : ''}
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

      {/* ── Start CRA Modal ── */}
      {startCraModalOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-adm-card rounded-lg border border-adm-border p-6 w-80 space-y-4">
            <h3 className="font-mono text-[13px] font-semibold text-adm-t1">Start CRA</h3>
            <div>
              <label className="block font-mono text-[11px] font-medium text-adm-t2 mb-1">Customer No</label>
              <input
                value={startCraCustomerNo}
                onChange={e => setStartCraCustomerNo(e.target.value)}
                placeholder="CU2604133584"
                className="rounded border border-adm-border bg-adm-panel px-3 py-1.5 font-mono text-[11px] text-adm-t1 w-full outline-none focus:border-adm-amber"
              />
            </div>
            {startCraError && (
              <p className="font-mono text-[11px] text-adm-red">{startCraError}</p>
            )}
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => { setStartCraModalOpen(false); setStartCraError(''); setStartCraCustomerNo(''); }}
                className={adminButtonClass('modalCancel')}
              >
                Cancel
              </button>
              <button
                onClick={() => void handleStartCra()}
                disabled={startCraLoading || !startCraCustomerNo.trim()}
                className={adminButtonClass('modalConfirm')}
              >
                {startCraLoading ? 'Creating…' : 'Start CRA'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default RiskAssessmentListPage;
