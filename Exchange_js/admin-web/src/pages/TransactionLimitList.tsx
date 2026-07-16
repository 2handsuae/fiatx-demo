import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, RefreshCw, X } from 'lucide-react';
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

/* ── Types ───────────────────────────────────────────────────── */

type GateType = 'SINGLE' | 'CUMULATIVE' | 'LARGE_APPROVAL';

interface AssetOption {
  id: string;
  code: string;
  type: string;
}

interface RuleItem {
  id: string;
  ruleNo: string;
  gateType: GateType;
  operationType: string;
  assetId: string | null;
  tradingTier: string | null;
  period: string | null;
  minAmount: string | null;
  maxAmount: string | null;
  defaultLimit: string | null;
  cap: string | null;
  threshold: string | null;
  status: string;
  approvalCaseId: string | null;
  createdAt: string;
  updatedAt: string;
}

/* ── Constants ───────────────────────────────────────────────── */

const GATE_TABS: { key: GateType; label: string }[] = [
  { key: 'SINGLE', label: 'Single' },
  { key: 'CUMULATIVE', label: 'Cumulative' },
  { key: 'LARGE_APPROVAL', label: 'Large Approval' },
];

const OPERATION_OPTIONS = ['WITHDRAWAL', 'SWAP'];
const TIER_OPTIONS = ['BASIC', 'PREMIUM'];
const PERIOD_OPTIONS = ['DAILY', 'MONTHLY'];

/* ── Helpers ─────────────────────────────────────────────────── */

const fmtAmount = (v?: string | null): string => {
  if (v == null || v === '') return '—';
  const n = parseFloat(v);
  return Number.isNaN(n)
    ? v
    : n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 8 });
};

interface CreateFormState {
  operationType: string;
  assetId: string;
  tradingTier: string;
  period: string;
  minAmount: string;
  maxAmount: string;
  defaultLimit: string;
  cap: string;
  threshold: string;
  reason: string;
}

const EMPTY_CREATE_FORM: CreateFormState = {
  operationType: 'WITHDRAWAL',
  assetId: '',
  tradingTier: 'BASIC',
  period: 'DAILY',
  minAmount: '',
  maxAmount: '',
  defaultLimit: '',
  cap: '',
  threshold: '',
  reason: '',
};

/* ── Component ───────────────────────────────────────────────── */

const TransactionLimitList = () => {
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useState<GateType>('SINGLE');
  const [items, setItems] = useState<RuleItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [assets, setAssets] = useState<AssetOption[]>([]);

  /* ── Create modal state ── */
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createForm, setCreateForm] = useState<CreateFormState>(EMPTY_CREATE_FORM);
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const requestSeqRef = useRef(0);

  /* ── Fetch assets (for code lookup + Single create dropdown) ── */
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

  const assetCodeById = useMemo(() => {
    const map = new Map<string, string>();
    assets.forEach((a) => map.set(a.id, a.code));
    return map;
  }, [assets]);

  /* ── Data fetching (list endpoint returns a bare array) ── */
  const fetchItems = async (gateType: GateType) => {
    const seq = ++requestSeqRef.current;
    setLoading(true);
    setError(null);
    try {
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/transaction-limit-rules?gateType=${gateType}`,
      );
      if (!res.ok) throw new Error(await getApiErrorMessage(res, 'Failed to load rules.'));

      const data = (await res.json()) as RuleItem[];
      if (seq !== requestSeqRef.current) return;
      setItems(Array.isArray(data) ? data : []);
    } catch (err) {
      if (seq !== requestSeqRef.current) return;
      if (err instanceof AdminSessionError) return;
      setError(err instanceof Error ? err.message : 'Failed to load rules.');
    } finally {
      if (seq === requestSeqRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    void fetchItems(activeTab);
  }, [activeTab]);

  useEffect(() => {
    void fetchAssets();
  }, []);

  useEffect(() => {
    if (!notice) return undefined;
    const t = window.setTimeout(() => setNotice((c) => (c === notice ? null : c)), 4000);
    return () => window.clearTimeout(t);
  }, [notice]);

  /* ── Create modal handlers ── */
  const openCreateModal = () => {
    setCreateForm(EMPTY_CREATE_FORM);
    setCreateError(null);
    setShowCreateModal(true);
  };
  const closeCreateModal = () => setShowCreateModal(false);

  const buildCreatePayload = (): Record<string, unknown> | string => {
    const f = createForm;
    if (!f.reason.trim()) return 'Reason is required';

    const num = (v: string): number | undefined => {
      if (v.trim() === '') return undefined;
      const n = parseFloat(v);
      return Number.isNaN(n) ? undefined : n;
    };

    const base: Record<string, unknown> = {
      gateType: activeTab,
      operationType: f.operationType,
      reason: f.reason.trim(),
    };

    if (activeTab === 'SINGLE') {
      if (!f.assetId) return 'Asset is required';
      const minAmount = num(f.minAmount);
      const maxAmount = num(f.maxAmount);
      if (minAmount === undefined && maxAmount === undefined)
        return 'At least one of Min / Max is required';
      base.assetId = f.assetId;
      if (minAmount !== undefined) base.minAmount = minAmount;
      if (maxAmount !== undefined) base.maxAmount = maxAmount;
    } else if (activeTab === 'CUMULATIVE') {
      const defaultLimit = num(f.defaultLimit);
      const cap = num(f.cap);
      if (defaultLimit === undefined) return 'Default Limit (AED) is required';
      base.tradingTier = f.tradingTier;
      base.period = f.period;
      base.defaultLimit = defaultLimit;
      if (cap !== undefined) base.cap = cap;
    } else {
      const threshold = num(f.threshold);
      if (threshold === undefined) return 'Threshold (AED) is required';
      base.threshold = threshold;
    }
    return base;
  };

  const handleCreateSubmit = async () => {
    const payload = buildCreatePayload();
    if (typeof payload === 'string') {
      setCreateError(payload);
      return;
    }

    setCreateLoading(true);
    setCreateError(null);
    try {
      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/transaction-limit-rules`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
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
        `Submitted for approval${res.approvalNo ? ` — ${res.approvalNo}` : ''}`,
      );
      void fetchItems(activeTab);
    } catch (err: unknown) {
      setCreateError(err instanceof Error ? err.message : 'Request failed');
    } finally {
      setCreateLoading(false);
    }
  };

  const updateForm = (key: keyof CreateFormState, value: string) =>
    setCreateForm((prev) => ({ ...prev, [key]: value }));

  /* ── Styles ── */
  const th =
    'px-3 py-2 text-left font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-adm-t3';
  const fieldInput =
    'w-full rounded border border-adm-border bg-adm-bg px-3 py-2 font-mono text-[11px] text-adm-t1 placeholder:text-adm-t3 focus:border-adm-amber focus:outline-none transition-colors';
  const fieldLabel =
    'mb-1 block font-mono text-[10px] font-semibold uppercase tracking-wider text-adm-t3';

  const colCount =
    activeTab === 'SINGLE' ? 6 : activeTab === 'CUMULATIVE' ? 7 : 4;

  /* ── Row ── */
  const goDetail = (ruleNo: string) =>
    navigate(`/admin/assets/transaction-limits/${ruleNo}`);

  const ruleNoCell = (r: RuleItem) => (
    <td className="px-3 py-2">
      <button
        className={adminButtonClass('rowKeyLink')}
        onClick={(e) => {
          e.stopPropagation();
          goDetail(r.ruleNo);
        }}
        title={r.ruleNo}
      >
        {r.ruleNo}
      </button>
    </td>
  );

  /* ── Render ── */
  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* ─── Zone 1: Title ─── */}
      <PageTitleBar
        title="Transaction Limits"
        meta={`${items.length} ${activeTab.toLowerCase().replace('_', ' ')} rule${items.length === 1 ? '' : 's'}`}
      >
        <button onClick={openCreateModal} className={adminButtonClass('listPrimary')}>
          <Plus size={13} />
          Create Rule
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

      {/* ─── Zone 2: Tabs ─── */}
      <div className="flex shrink-0 items-center gap-1 border-b border-adm-border px-4">
        {GATE_TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={`relative px-3 py-2.5 font-mono text-[11px] transition-colors ${
              activeTab === t.key ? 'text-adm-amber' : 'text-adm-t3 hover:text-adm-t1'
            }`}
          >
            {t.label}
            {activeTab === t.key && (
              <span className="absolute inset-x-0 -bottom-px h-0.5 bg-adm-amber" />
            )}
          </button>
        ))}
        <button
          onClick={() => void fetchItems(activeTab)}
          className={`${adminIconButtonClass()} ml-auto`}
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
              <th className={th} style={{ width: 150 }}>Rule No</th>
              <th className={th} style={{ width: 120 }}>Operation</th>
              {activeTab === 'SINGLE' && (
                <>
                  <th className={th} style={{ width: 120 }}>Asset</th>
                  <th className={th} style={{ width: 140 }}>Min</th>
                  <th className={th} style={{ width: 140 }}>Max</th>
                </>
              )}
              {activeTab === 'CUMULATIVE' && (
                <>
                  <th className={th} style={{ width: 100 }}>Tier</th>
                  <th className={th} style={{ width: 90 }}>Period</th>
                  <th className={th} style={{ width: 150 }}>Default Limit (AED)</th>
                  <th className={th} style={{ width: 140 }}>Cap (AED)</th>
                </>
              )}
              {activeTab === 'LARGE_APPROVAL' && (
                <th className={th} style={{ width: 160 }}>Threshold (AED)</th>
              )}
              <th className={th} style={{ width: 120 }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && !loading ? (
              <tr>
                <td colSpan={colCount} className="px-3 py-12 text-center text-[11px] text-adm-t3">
                  No rules found
                </td>
              </tr>
            ) : (
              items.map((r) => (
                <tr
                  key={r.id}
                  className="cursor-pointer border-b border-adm-border hover:bg-adm-hover"
                  onClick={() => goDetail(r.ruleNo)}
                >
                  {ruleNoCell(r)}
                  <td className="px-3 py-2">
                    <AdminBadge value={r.operationType} />
                  </td>
                  {activeTab === 'SINGLE' && (
                    <>
                      <td className="px-3 py-2 font-mono text-adm-t1">
                        {r.assetId ? assetCodeById.get(r.assetId) ?? '—' : '—'}
                      </td>
                      <td className="px-3 py-2 font-mono text-adm-t1">{fmtAmount(r.minAmount)}</td>
                      <td className="px-3 py-2 font-mono text-adm-t1">{fmtAmount(r.maxAmount)}</td>
                    </>
                  )}
                  {activeTab === 'CUMULATIVE' && (
                    <>
                      <td className="px-3 py-2">
                        {r.tradingTier ? <AdminBadge value={r.tradingTier} /> : '—'}
                      </td>
                      <td className="px-3 py-2 font-mono text-adm-t2">{r.period ?? '—'}</td>
                      <td className="px-3 py-2 font-mono text-adm-t1 font-semibold">
                        {fmtAmount(r.defaultLimit)}
                      </td>
                      <td className="px-3 py-2 font-mono text-adm-t2">{fmtAmount(r.cap)}</td>
                    </>
                  )}
                  {activeTab === 'LARGE_APPROVAL' && (
                    <td className="px-3 py-2 font-mono text-adm-t1 font-semibold">
                      {fmtAmount(r.threshold)}
                    </td>
                  )}
                  <td className="px-3 py-2">
                    <AdminBadge value={r.status} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* ─── Zone 4: Footer ─── */}
      <div className="flex shrink-0 items-center justify-between border-t border-adm-border px-4 py-2 text-[10px] text-adm-t3">
        <span>Showing {items.length} rules</span>
      </div>

      {/* ════ Create Rule Modal ════ */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md overflow-hidden rounded-xl border border-adm-border bg-adm-panel shadow-xl">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-adm-border bg-adm-card px-5 py-4">
              <div>
                <p className="font-mono text-[11px] font-semibold text-adm-t1">
                  Create {GATE_TABS.find((t) => t.key === activeTab)?.label} Rule
                </p>
                <p className="mt-1 font-mono text-[9px] text-adm-t3">
                  Submitted to OPS_OFFICER approval before it takes effect
                </p>
              </div>
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
                <label className={fieldLabel}>Operation Type</label>
                <select
                  className={fieldInput}
                  value={createForm.operationType}
                  onChange={(e) => updateForm('operationType', e.target.value)}
                >
                  {OPERATION_OPTIONS.map((o) => (
                    <option key={o} value={o}>{o}</option>
                  ))}
                </select>
              </div>

              {activeTab === 'SINGLE' && (
                <>
                  <div>
                    <label className={fieldLabel}>Asset</label>
                    <select
                      className={fieldInput}
                      value={createForm.assetId}
                      onChange={(e) => updateForm('assetId', e.target.value)}
                    >
                      <option value="">Select asset…</option>
                      {assets.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.code} ({a.type})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={fieldLabel}>Min Amount</label>
                      <input
                        type="number"
                        min="0"
                        step="any"
                        className={fieldInput}
                        value={createForm.minAmount}
                        onChange={(e) => updateForm('minAmount', e.target.value)}
                        placeholder="native units"
                      />
                    </div>
                    <div>
                      <label className={fieldLabel}>Max Amount</label>
                      <input
                        type="number"
                        min="0"
                        step="any"
                        className={fieldInput}
                        value={createForm.maxAmount}
                        onChange={(e) => updateForm('maxAmount', e.target.value)}
                        placeholder="native units"
                      />
                    </div>
                  </div>
                </>
              )}

              {activeTab === 'CUMULATIVE' && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={fieldLabel}>Trading Tier</label>
                      <select
                        className={fieldInput}
                        value={createForm.tradingTier}
                        onChange={(e) => updateForm('tradingTier', e.target.value)}
                      >
                        {TIER_OPTIONS.map((o) => (
                          <option key={o} value={o}>{o}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className={fieldLabel}>Period</label>
                      <select
                        className={fieldInput}
                        value={createForm.period}
                        onChange={(e) => updateForm('period', e.target.value)}
                      >
                        {PERIOD_OPTIONS.map((o) => (
                          <option key={o} value={o}>{o}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={fieldLabel}>Default Limit (AED)</label>
                      <input
                        type="number"
                        min="0"
                        step="any"
                        className={fieldInput}
                        value={createForm.defaultLimit}
                        onChange={(e) => updateForm('defaultLimit', e.target.value)}
                        placeholder="e.g. 50000"
                      />
                    </div>
                    <div>
                      <label className={fieldLabel}>Cap (AED, optional)</label>
                      <input
                        type="number"
                        min="0"
                        step="any"
                        className={fieldInput}
                        value={createForm.cap}
                        onChange={(e) => updateForm('cap', e.target.value)}
                        placeholder="optional"
                      />
                    </div>
                  </div>
                </>
              )}

              {activeTab === 'LARGE_APPROVAL' && (
                <div>
                  <label className={fieldLabel}>Threshold (AED)</label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    className={fieldInput}
                    value={createForm.threshold}
                    onChange={(e) => updateForm('threshold', e.target.value)}
                    placeholder="e.g. 100000"
                  />
                </div>
              )}

              <div>
                <label className={fieldLabel}>Reason</label>
                <textarea
                  className={`${fieldInput} resize-none`}
                  rows={3}
                  value={createForm.reason}
                  onChange={(e) => updateForm('reason', e.target.value)}
                  placeholder="Why is this rule needed?"
                />
              </div>
            </div>

            {/* Footer */}
            <div className="flex justify-end gap-2 border-t border-adm-border bg-adm-card px-5 py-4">
              <button onClick={closeCreateModal} className={adminButtonClass('modalCancel')}>
                Cancel
              </button>
              <button
                onClick={() => void handleCreateSubmit()}
                disabled={createLoading || !createForm.reason.trim()}
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

export default TransactionLimitList;
