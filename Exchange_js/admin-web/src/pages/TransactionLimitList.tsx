import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, RefreshCw } from 'lucide-react';
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

/* ── Interfaces ──────────────────────────────────────────────── */

interface PolicyItem {
  id: string;
  policyNo: string;
  tradingTier: string;
  operationType: string;
  period: string;
  limitAmount: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

interface PolicyListResponse {
  total: number;
  items: PolicyItem[];
}

interface FilterState {
  tradingTier: string;
  operationType: string;
}

/* ── Helpers ─────────────────────────────────────────────────── */

const fmt = (v?: string | null): string => {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString();
};

const fmtAmount = (v?: string | null): string => {
  if (!v) return '—';
  const n = parseFloat(v);
  return Number.isNaN(n) ? v : n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
};

/* ── Constants ───────────────────────────────────────────────── */

const PAGE_SIZE = 20;

const DEFAULT_FILTERS: FilterState = {
  tradingTier: '',
  operationType: '',
};

/* ── Component ───────────────────────────────────────────────── */

const TransactionLimitList = () => {
  const navigate = useNavigate();

  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [items, setItems] = useState<PolicyItem[]>([]);
  const [total, setTotal] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createForm, setCreateForm] = useState({
    tradingTier: 'BASIC',
    operationType: 'WITHDRAWAL',
    period: 'DAILY',
    limitAmount: '',
    reason: '',
  });
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Dynamic trading tiers
  const [availableTiers, setAvailableTiers] = useState<string[]>(['BASIC', 'PREMIUM']);
  const [showNewTierInput, setShowNewTierInput] = useState(false);
  const [newTierName, setNewTierName] = useState('');

  const requestSeqRef = useRef(0);

  /* ── Fetch available tiers ── */
  const fetchTiers = async () => {
    try {
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/transaction-limit-policies/trading-tiers`,
      );
      if (res.ok) {
        const tiers = (await res.json()) as string[];
        if (Array.isArray(tiers) && tiers.length > 0) setAvailableTiers(tiers);
      }
    } catch { /* ignore */ }
  };

  /* ── Data fetching ── */

  const buildParams = (page: number, next: FilterState) => {
    const params = new URLSearchParams();
    params.set('skip', String((page - 1) * PAGE_SIZE));
    params.set('take', String(PAGE_SIZE));
    if (next.tradingTier) params.set('tradingTier', next.tradingTier);
    if (next.operationType) params.set('operationType', next.operationType);
    return params;
  };

  const fetchItems = async (page: number, next: FilterState = filters) => {
    const seq = ++requestSeqRef.current;
    setLoading(true);
    setError(null);
    try {
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/transaction-limit-policies?${buildParams(page, next).toString()}`,
      );
      if (!res.ok) throw new Error(await getApiErrorMessage(res, 'Failed to load policies.'));

      const data = (await res.json()) as PolicyListResponse;
      if (seq !== requestSeqRef.current) return;
      setItems(Array.isArray(data.items) ? data.items : []);
      setTotal(typeof data.total === 'number' ? data.total : 0);
      setCurrentPage(page);
    } catch (err) {
      if (seq !== requestSeqRef.current) return;
      if (err instanceof AdminSessionError) return;
      setError(err instanceof Error ? err.message : 'Failed to load policies.');
    } finally {
      if (seq === requestSeqRef.current) setLoading(false);
    }
  };

  useEffect(() => { void fetchItems(1, DEFAULT_FILTERS); void fetchTiers(); }, []);

  /* ── Create modal handlers ── */

  const openCreateModal = () => {
    setCreateForm({ tradingTier: 'BASIC', operationType: 'WITHDRAWAL', period: 'DAILY', limitAmount: '', reason: '' });
    setCreateError(null);
    setShowCreateModal(true);
  };
  const closeCreateModal = () => setShowCreateModal(false);

  const handleCreateSubmit = async () => {
    const amt = parseFloat(createForm.limitAmount);
    if (!amt || amt <= 0) { setCreateError('Amount must be > 0'); return; }
    if (!createForm.reason.trim()) { setCreateError('Reason is required'); return; }

    setCreateLoading(true);
    setCreateError(null);
    try {
      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/transaction-limit-policies`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tradingTier: createForm.tradingTier,
            operationType: createForm.operationType,
            period: createForm.period,
            limitAmount: amt,
            reason: createForm.reason.trim(),
          }),
        },
      );
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setCreateError((data as { message?: string }).message || 'Failed to submit');
        return;
      }
      const res = await response.json() as { approvalNo?: string };
      closeCreateModal();
      setNotice(`Policy creation submitted — approval ${res.approvalNo}`);
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

  const hasFilter = !!filters.tradingTier || !!filters.operationType;

  const updateFilter = (key: keyof FilterState, value: string) =>
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
      <PageTitleBar
        title="Transaction Limits"
        meta={`${total} policies · Daily Limits`}
      >
        <button onClick={openCreateModal} className={adminButtonClass('listPrimary')}>
          <Plus size={13} />
          Create Policy
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
          className={`${fi} w-[130px]`}
          value={filters.tradingTier}
          onChange={(e) => updateFilter('tradingTier', e.target.value)}
        >
          <option value="">All tiers</option>
          {availableTiers.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <select
          className={`${fi} w-[150px]`}
          value={filters.operationType}
          onChange={(e) => updateFilter('operationType', e.target.value)}
        >
          <option value="">All operations</option>
          <option value="WITHDRAWAL">WITHDRAWAL</option>
          <option value="SWAP">SWAP</option>
        </select>

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
              <th className={th} style={{ width: 110 }}>Policy No</th>
              <th className={th} style={{ width: 100 }}>Trading Tier</th>
              <th className={th} style={{ width: 120 }}>Operation</th>
              <th className={th} style={{ width: 80 }}>Period</th>
              <th className={th} style={{ width: 140 }}>Limit (AED)</th>
              <th className={th} style={{ width: 80 }}>Status</th>
              <th className={th} style={{ width: 140 }}>Updated</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && !loading ? (
              <tr>
                <td colSpan={7} className="px-3 py-12 text-center text-[11px] text-adm-t3">
                  No policies found
                </td>
              </tr>
            ) : (
              items.map((p) => (
                <tr
                  key={p.id}
                  className="cursor-pointer border-b border-adm-border hover:bg-adm-hover"
                  onClick={() => navigate(`/admin/assets/transaction-limits/${p.policyNo}`)}
                >
                  <td className="px-3 py-2">
                    <button
                      className={adminButtonClass('rowKeyLink')}
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(`/admin/assets/transaction-limits/${p.policyNo}`);
                      }}
                      title={p.policyNo}
                    >
                      {p.policyNo}
                    </button>
                  </td>
                  <td className="px-3 py-2">
                    <AdminBadge value={p.tradingTier} />
                  </td>
                  <td className="px-3 py-2">
                    <AdminBadge value={p.operationType} />
                  </td>
                  <td className="px-3 py-2 font-mono text-adm-t2">
                    {p.period}
                  </td>
                  <td className="px-3 py-2 font-mono text-adm-t1 font-semibold">
                    {fmtAmount(p.limitAmount)}
                  </td>
                  <td className="px-3 py-2">
                    <AdminBadge value={p.status} />
                  </td>
                  <td className="px-3 py-2 font-mono text-[10px] text-adm-t2">
                    {fmt(p.updatedAt)}
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
          Showing {items.length} / {total} policies
        </span>
        <Pagination
          currentPage={currentPage}
          totalItems={total}
          pageSize={PAGE_SIZE}
          onPageChange={(p: number) => void fetchItems(p, filters)}
        />
      </div>

      {/* ════ Create Policy Modal ════ */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-md rounded-lg border border-adm-border bg-adm-bg shadow-xl">
            {/* Header */}
            <div className="border-b border-adm-border px-5 py-3">
              <h2 className="font-mono text-sm font-semibold text-adm-t1">Create Limit Policy</h2>
            </div>
            {/* Body */}
            <div className="space-y-3 px-5 py-4">
              {createError && (
                <div className="rounded border border-adm-danger/30 bg-adm-danger/5 px-3 py-2 font-mono text-[11px] text-adm-danger">
                  {createError}
                </div>
              )}
              <div>
                <label className="mb-1 block font-mono text-[10px] font-semibold uppercase tracking-wider text-adm-t3">Trading Tier</label>
                {!showNewTierInput ? (
                  <select
                    className="w-full rounded border border-adm-border bg-adm-bg px-3 py-1.5 font-mono text-xs text-adm-t1"
                    value={createForm.tradingTier}
                    onChange={(e) => {
                      if (e.target.value === '__NEW__') {
                        setShowNewTierInput(true);
                        setNewTierName('');
                      } else {
                        setCreateForm((f) => ({ ...f, tradingTier: e.target.value }));
                      }
                    }}
                  >
                    {availableTiers.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                    <option value="__NEW__">+ Create New Tier...</option>
                  </select>
                ) : (
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      className="flex-1 rounded border border-adm-border bg-adm-bg px-3 py-1.5 font-mono text-xs text-adm-t1 uppercase"
                      value={newTierName}
                      onChange={(e) => setNewTierName(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ''))}
                      placeholder="e.g. VIP"
                      autoFocus
                    />
                    <button
                      type="button"
                      className={adminButtonClass('listPrimary')}
                      disabled={!newTierName.trim()}
                      onClick={() => {
                        const tier = newTierName.trim();
                        if (tier) {
                          if (!availableTiers.includes(tier)) {
                            setAvailableTiers((prev) => [...prev, tier].sort());
                          }
                          setCreateForm((f) => ({ ...f, tradingTier: tier }));
                          setShowNewTierInput(false);
                          setNewTierName('');
                        }
                      }}
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      className={adminButtonClass('listSecondary')}
                      onClick={() => { setShowNewTierInput(false); setNewTierName(''); }}
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>
              <div>
                <label className="mb-1 block font-mono text-[10px] font-semibold uppercase tracking-wider text-adm-t3">Operation Type</label>
                <select
                  className="w-full rounded border border-adm-border bg-adm-bg px-3 py-1.5 font-mono text-xs text-adm-t1"
                  value={createForm.operationType}
                  onChange={(e) => setCreateForm((f) => ({ ...f, operationType: e.target.value }))}
                >
                  <option value="WITHDRAWAL">WITHDRAWAL</option>
                  <option value="SWAP">SWAP</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block font-mono text-[10px] font-semibold uppercase tracking-wider text-adm-t3">Period</label>
                <select
                  className="w-full rounded border border-adm-border bg-adm-bg px-3 py-1.5 font-mono text-xs text-adm-t1"
                  value={createForm.period}
                  onChange={(e) => setCreateForm((f) => ({ ...f, period: e.target.value }))}
                >
                  <option value="DAILY">DAILY</option>
                  <option value="MONTHLY">MONTHLY</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block font-mono text-[10px] font-semibold uppercase tracking-wider text-adm-t3">Limit Amount (AED)</label>
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  className="w-full rounded border border-adm-border bg-adm-bg px-3 py-1.5 font-mono text-xs text-adm-t1"
                  value={createForm.limitAmount}
                  onChange={(e) => setCreateForm((f) => ({ ...f, limitAmount: e.target.value }))}
                  placeholder="e.g. 50000"
                />
              </div>
              <div>
                <label className="mb-1 block font-mono text-[10px] font-semibold uppercase tracking-wider text-adm-t3">Reason</label>
                <textarea
                  className="w-full rounded border border-adm-border bg-adm-bg px-3 py-1.5 font-mono text-xs text-adm-t1"
                  rows={2}
                  value={createForm.reason}
                  onChange={(e) => setCreateForm((f) => ({ ...f, reason: e.target.value }))}
                  placeholder="Why is this policy needed?"
                />
              </div>
            </div>
            {/* Footer */}
            <div className="flex justify-end gap-2 border-t border-adm-border px-5 py-3">
              <button onClick={closeCreateModal} className={adminButtonClass('modalCancel')}>
                Cancel
              </button>
              <button
                onClick={handleCreateSubmit}
                disabled={createLoading || !createForm.limitAmount || !createForm.reason.trim()}
                className={adminButtonClass('workflowPrimary')}
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

export default TransactionLimitList;
