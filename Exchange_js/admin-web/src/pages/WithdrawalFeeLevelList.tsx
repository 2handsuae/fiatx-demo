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
  asset: { id: string; code: string; type: string };
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
  assetId: string;
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

/* ── Constants ───────────────────────────────────────────────── */

const PAGE_SIZE = 20;
const STATUS_OPTIONS = ['ACTIVE', 'PENDING_APPROVAL', 'REJECTED'];
const DEFAULT_FILTERS: FilterState = { assetId: '', status: '', defaultOnly: false };

/* ── Component ───────────────────────────────────────────────── */

const WithdrawalFeeLevelList = () => {
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
    assetId: '',
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
    if (next.assetId) params.set('assetId', next.assetId);
    if (next.status) params.set('status', next.status);
    return params;
  };

  const fetchItems = async (page: number, next: FilterState = filters) => {
    const seq = ++requestSeqRef.current;
    setLoading(true);
    setError(null);
    try {
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/withdrawal-fee-levels?${buildParams(page, next).toString()}`,
      );
      if (!res.ok)
        throw new Error(await getApiErrorMessage(res, 'Failed to load fee levels.'));

      const data = (await res.json()) as FeeLevelListResponse;
      if (seq !== requestSeqRef.current) return;

      let list = Array.isArray(data.items) ? data.items : [];
      // Client-side default-only filter (backend has no such param)
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
    setCreateForm({ levelCode: '', name: '', assetId: '', isDefault: false, reason: '' });
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
    if (!createForm.assetId) {
      setCreateError('Asset is required');
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

    // Set currency from selected asset if empty
    setCreateLoading(true);
    setCreateError(null);
    try {
      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/withdrawal-fee-levels`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            levelCode: createForm.levelCode.trim(),
            name: createForm.name.trim(),
            assetId: createForm.assetId,
            isDefault: createForm.isDefault,
            tiersJson: serializeTiers(createTiers),
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

  const hasFilter = !!filters.assetId || !!filters.status || filters.defaultOnly;

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
      <PageTitleBar title="Withdrawal Fee Levels" meta={`${filters.defaultOnly ? items.length : total} levels`}>
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
          value={filters.assetId}
          onChange={(e) => updateFilter('assetId', e.target.value)}
        >
          <option value="">All assets</option>
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
              <th className={th} style={{ width: 120 }}>Asset</th>
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
                    navigate(`/admin/pricing/withdrawal-fee-levels/${l.levelCode}`)
                  }
                >
                  <td className="px-3 py-2">
                    <button
                      className={adminButtonClass('rowKeyLink')}
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(
                          `/admin/pricing/withdrawal-fee-levels/${l.levelCode}`,
                        );
                      }}
                      title={l.levelCode}
                    >
                      {l.levelCode}
                    </button>
                  </td>
                  <td className="px-3 py-2 text-adm-t1">{l.name}</td>
                  <td className="px-3 py-2">
                    <span
                      className={`inline-flex items-center rounded px-1.5 py-0.5 font-mono text-[10px] font-medium ${
                        l.asset.type === 'CRYPTO'
                          ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300'
                          : 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300'
                      }`}
                    >
                      {l.asset.code}
                    </span>
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
                Create Withdrawal Fee Level
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
                  placeholder="e.g. STD-USDT-TRON"
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
                  placeholder="e.g. Standard USDT"
                />
              </div>

              <div>
                <label className="mb-1 block font-mono text-[10px] font-semibold uppercase tracking-wider text-adm-t3">
                  Asset
                </label>
                <select
                  className="w-full rounded border border-adm-border bg-adm-bg px-3 py-2 font-mono text-[11px] text-adm-t1 focus:border-adm-amber focus:outline-none transition-colors"
                  value={createForm.assetId}
                  onChange={(e) => setCreateForm((f) => ({ ...f, assetId: e.target.value }))}
                >
                  <option value="">Select asset…</option>
                  {assets.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.code} ({a.type})
                    </option>
                  ))}
                </select>
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
                  !createForm.assetId ||
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

export default WithdrawalFeeLevelList;
