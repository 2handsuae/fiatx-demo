import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { X, Pencil } from 'lucide-react';
import { AdminSessionError, adminFetch, getApiErrorMessage } from '../utils/adminFetch';
import { adminButtonClass } from '../components/common/adminButtonStyles';
import { DetailPageHeader, InfoField } from '../components/compliance/DetailPageComponents';
import { AdminBadge } from '../components/ui/AdminBadge';

/* ── Types ───────────────────────────────────────────────────── */

type GateType = 'SINGLE' | 'CUMULATIVE' | 'LARGE_APPROVAL';

interface RuleDetail {
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
  approvalCaseNo: string | null;
  createdAt: string;
  updatedAt: string;
}

interface AssetOption {
  id: string;
  code: string;
  type: string;
}

/** Amount fields exposed per gate shape (change form + read-only display). */
type AmountKey = 'minAmount' | 'maxAmount' | 'defaultLimit' | 'cap' | 'threshold';

const SHAPE_AMOUNT_FIELDS: Record<
  GateType,
  { key: AmountKey; label: string; required: boolean }[]
> = {
  SINGLE: [
    { key: 'minAmount', label: 'Min Amount', required: false },
    { key: 'maxAmount', label: 'Max Amount', required: false },
  ],
  CUMULATIVE: [{ key: 'defaultLimit', label: 'Default Limit', required: true }],
  LARGE_APPROVAL: [{ key: 'threshold', label: 'Threshold', required: true }],
};

/* ── Helpers ─────────────────────────────────────────────────── */

const fmt = (v?: string | null): string => {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString();
};

const fmtAmount = (v?: string | null): string => {
  if (v == null || v === '') return '—';
  const n = parseFloat(v);
  return Number.isNaN(n)
    ? v
    : n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 8 });
};

/* ── Layout primitives ── */

const Cap = ({ children }: { children: ReactNode }) => (
  <p className="font-mono text-[8.5px] font-semibold uppercase tracking-[0.16em] text-adm-t3">
    {children}
  </p>
);

const SidebarGroup = ({ title, children }: { title: string; children: ReactNode }) => (
  <div className="border-b border-adm-border py-4 last:border-b-0">
    <Cap>{title}</Cap>
    <div className="mt-2.5 flex flex-col gap-1.5">{children}</div>
  </div>
);

const SidebarKV = ({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: ReactNode;
  mono?: boolean;
}) => {
  if (value === null || value === undefined || value === '' || value === '—') return null;
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="shrink-0 font-mono text-[9px] text-adm-t3">{label}</span>
      <span
        className={[
          'min-w-0 break-all text-right text-adm-t2',
          mono ? 'font-mono text-[10px]' : 'text-[11px]',
        ].join(' ')}
      >
        {value}
      </span>
    </div>
  );
};

/* ── Main Component ──────────────────────────────────────────── */

export default function TransactionLimitDetail() {
  const { ruleNo } = useParams<{ ruleNo: string }>();
  const navigate = useNavigate();

  const [rule, setRule] = useState<RuleDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [assetCode, setAssetCode] = useState<string | null>(null);

  /* ── Change modal state ── */
  const [showChangeModal, setShowChangeModal] = useState(false);
  const [changeAmounts, setChangeAmounts] = useState<Record<string, string>>({});
  const [changeReason, setChangeReason] = useState('');
  const [changeLoading, setChangeLoading] = useState(false);
  const [changeError, setChangeError] = useState<string | null>(null);

  /* ── Fetch ── */

  const fetchDetail = async () => {
    if (!ruleNo) return;
    setLoading(true);
    setError(null);
    try {
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/transaction-limit-rules/${ruleNo}`,
      );
      if (!res.ok) throw new Error(await getApiErrorMessage(res, 'Failed to load rule detail.'));
      const data = (await res.json()) as RuleDetail;
      setRule(data);

      // Resolve asset code (SINGLE shape) — never surface the raw assetId UUID.
      if (data.assetId) {
        try {
          const aRes = await adminFetch(
            `${import.meta.env.VITE_API_URL}/assets/${data.assetId}`,
          );
          if (aRes.ok) {
            const asset = (await aRes.json()) as AssetOption;
            setAssetCode(asset.code ?? null);
          }
        } catch {
          /* ignore — display falls back to '—' */
        }
      } else {
        setAssetCode(null);
      }
    } catch (err) {
      if (err instanceof AdminSessionError) return;
      setError(err instanceof Error ? err.message : 'Failed to load rule detail.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchDetail();
  }, [ruleNo]);

  useEffect(() => {
    if (!notice) return undefined;
    const t = window.setTimeout(() => setNotice((c) => (c === notice ? null : c)), 4000);
    return () => window.clearTimeout(t);
  }, [notice]);

  /* ── Change (Edit amounts) ── */

  const amountFields = rule ? SHAPE_AMOUNT_FIELDS[rule.gateType] : [];
  const amountUnit = rule?.gateType === 'SINGLE' ? assetCode ?? 'native' : 'AED';

  const openChangeModal = () => {
    if (!rule) return;
    const seed: Record<string, string> = {};
    for (const f of SHAPE_AMOUNT_FIELDS[rule.gateType]) {
      const v = rule[f.key];
      seed[f.key] = v != null ? String(v) : '';
    }
    setChangeAmounts(seed);
    setChangeReason('');
    setChangeError(null);
    setShowChangeModal(true);
  };

  const changed = (() => {
    if (!rule) return false;
    return SHAPE_AMOUNT_FIELDS[rule.gateType].some((f) => {
      const input = (changeAmounts[f.key] ?? '').trim();
      const current = rule[f.key];
      if (input === '') return false;
      const n = parseFloat(input);
      if (Number.isNaN(n)) return false;
      if (current == null) return true;
      return n !== parseFloat(String(current));
    });
  })();

  const handleChangeSubmit = async () => {
    if (!ruleNo || !rule) return;
    if (!changeReason.trim()) {
      setChangeError('Change reason is required');
      return;
    }
    if (!changed) {
      setChangeError('Change at least one amount field');
      return;
    }

    const body: Record<string, unknown> = { reason: changeReason.trim() };
    for (const f of SHAPE_AMOUNT_FIELDS[rule.gateType]) {
      const input = (changeAmounts[f.key] ?? '').trim();
      if (input === '') continue;
      const n = parseFloat(input);
      if (!Number.isNaN(n)) body[f.key] = n;
    }

    setChangeLoading(true);
    setChangeError(null);
    try {
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/transaction-limit-rules/${ruleNo}/change`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      );
      if (!res.ok) throw new Error(await getApiErrorMessage(res, 'Failed to submit change'));
      const data = (await res.json()) as { approvalNo?: string };
      setShowChangeModal(false);
      setNotice(
        `Change submitted for approval${data.approvalNo ? ` (${data.approvalNo})` : ''}.`,
      );
      void fetchDetail();
    } catch (err) {
      if (err instanceof AdminSessionError) return;
      setChangeError(err instanceof Error ? err.message : 'Failed to submit change.');
    } finally {
      setChangeLoading(false);
    }
  };

  /* ── Loading / Error states ── */

  if (loading && !rule) {
    return (
      <div className="flex min-h-[320px] flex-col items-center justify-center">
        <div className="animate-spin rounded-full h-6 w-6 border-2 border-adm-amber border-t-transparent" />
        <p className="mt-3 font-mono text-[11px] text-adm-t3">Loading rule…</p>
      </div>
    );
  }

  if (!rule) {
    return (
      <div className="space-y-4 rounded border border-adm-red/30 bg-adm-red/10 p-8 text-center">
        <div className="font-mono text-[11px] text-adm-red">{error || 'Rule not found'}</div>
        <div className="flex items-center justify-center gap-3">
          <button
            onClick={() => navigate('/admin/assets/transaction-limits')}
            className={adminButtonClass('detailUtility')}
          >
            Back to Limits
          </button>
          <button onClick={() => void fetchDetail()} className={adminButtonClass('detailUtility')}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  const gateLabel =
    rule.gateType === 'LARGE_APPROVAL' ? 'LARGE APPROVAL' : rule.gateType;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* ── Header ── */}
      <DetailPageHeader
        onBack={() => navigate('/admin/assets/transaction-limits')}
        onRefresh={() => void fetchDetail()}
        refreshing={loading}
      />

      {/* ── Inline notices ── */}
      {(notice || error) && (
        <div className="shrink-0 px-6 pt-3 pb-1 space-y-2">
          {notice && (
            <div className="rounded border border-adm-green/30 bg-adm-green/10 px-4 py-2 font-mono text-[11px] text-adm-green">
              {notice}
            </div>
          )}
          {error && (
            <div className="rounded border border-adm-red/30 bg-adm-red/10 px-4 py-2 font-mono text-[11px] text-adm-red">
              {error}
            </div>
          )}
        </div>
      )}

      {/* ── Body: two-column layout ── */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* ════ LEFT MAIN ════ */}
        <div className="flex min-w-0 flex-1 flex-col divide-y divide-adm-border overflow-y-auto">
          {/* ① Hero */}
          <section className="bg-adm-card px-6 py-5">
            <p className="mt-1.5 font-mono text-[19px] font-bold leading-snug text-adm-amber">
              {rule.ruleNo}
            </p>
            <div className="mt-2.5 flex items-center gap-2">
              <AdminBadge value={gateLabel} />
              <AdminBadge value={rule.operationType} />
              <AdminBadge value={rule.status} />
            </div>
          </section>

          {/* ② Configuration */}
          <section className="px-6 py-5">
            <Cap>Limit Configuration</Cap>
            <div className="mt-3 grid grid-cols-2 gap-x-8 gap-y-4">
              {rule.gateType === 'SINGLE' && (
                <>
                  <InfoField label="Asset" value={assetCode ?? '—'} />
                  <InfoField label="Operation Type" value={rule.operationType} />
                  <InfoField
                    label={`Min Amount${assetCode ? ` (${assetCode})` : ''}`}
                    value={fmtAmount(rule.minAmount)}
                    mono
                  />
                  <InfoField
                    label={`Max Amount${assetCode ? ` (${assetCode})` : ''}`}
                    value={fmtAmount(rule.maxAmount)}
                    mono
                  />
                </>
              )}
              {rule.gateType === 'CUMULATIVE' && (
                <>
                  <InfoField label="Trading Tier" value={rule.tradingTier ?? '—'} />
                  <InfoField label="Period" value={rule.period ?? '—'} />
                  <InfoField label="Operation Type" value={rule.operationType} />
                  <InfoField label="Default Limit (AED)" value={fmtAmount(rule.defaultLimit)} mono />
                </>
              )}
              {rule.gateType === 'LARGE_APPROVAL' && (
                <>
                  <InfoField label="Operation Type" value={rule.operationType} />
                  <InfoField label="Threshold (AED)" value={fmtAmount(rule.threshold)} mono />
                </>
              )}
            </div>
          </section>
        </div>

        {/* ════ RIGHT SIDEBAR ════ */}
        <div className="w-[272px] min-w-[272px] overflow-y-auto border-l border-adm-border bg-adm-panel px-4 py-1">
          {/* Actions */}
          {rule.status === 'ACTIVE' && (
            <div className="border-b border-adm-border py-4">
              <Cap>Actions</Cap>
              <div className="mt-2.5 flex flex-col gap-2">
                <button onClick={openChangeModal} className={adminButtonClass('workflowPrimary')}>
                  <Pencil size={13} />
                  Change Amounts
                </button>
                <p className="text-center font-mono text-[10px] text-adm-t3">
                  Requires OPS_OFFICER approval
                </p>
              </div>
            </div>
          )}

          {/* Identity */}
          <SidebarGroup title="Identity">
            <SidebarKV label="Rule No" value={rule.ruleNo} mono />
            <SidebarKV label="Gate Type" value={gateLabel} />
            <SidebarKV label="Operation" value={rule.operationType} />
            <SidebarKV label="Asset" value={rule.gateType === 'SINGLE' ? assetCode ?? '—' : '—'} />
            <SidebarKV label="Trading Tier" value={rule.tradingTier ?? '—'} />
            <SidebarKV label="Period" value={rule.period ?? '—'} />
            <SidebarKV label="Status" value={<AdminBadge value={rule.status} />} />
            <SidebarKV
              label="Approval"
              value={
                rule.approvalCaseNo ? (
                  <button
                    onClick={() =>
                      navigate(`/admin/governance/approvals/${rule.approvalCaseNo}`)
                    }
                    className="font-mono text-[10px] text-adm-amber hover:underline"
                  >
                    {rule.approvalCaseNo}
                  </button>
                ) : (
                  '—'
                )
              }
            />
          </SidebarGroup>

          {/* Lifecycle */}
          <SidebarGroup title="Lifecycle">
            <SidebarKV label="Created" value={fmt(rule.createdAt)} mono />
            <SidebarKV label="Updated" value={fmt(rule.updatedAt)} mono />
          </SidebarGroup>
        </div>
      </div>

      {/* ════ Change Modal ════ */}
      {showChangeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md overflow-hidden rounded-xl border border-adm-border bg-adm-panel shadow-xl">
            <div className="flex items-center justify-between border-b border-adm-border bg-adm-card px-5 py-4">
              <div>
                <p className="font-mono text-[11px] font-semibold text-adm-t1">Change Amounts</p>
                <p className="mt-1 font-mono text-[9px] text-adm-t3">
                  {rule.ruleNo} · {gateLabel} · {rule.operationType}
                </p>
              </div>
              <button
                onClick={() => setShowChangeModal(false)}
                className="rounded p-1 text-adm-t3 hover:bg-adm-hover hover:text-adm-t1"
              >
                <X size={15} />
              </button>
            </div>

            <div className="px-5 py-4 space-y-3">
              <div className="rounded border border-adm-amber/30 bg-adm-amber/10 px-3 py-2.5 font-mono text-[10px] text-adm-amber leading-relaxed">
                This submits an amount change for OPS_OFFICER approval. The current rule
                remains in effect until the change is approved.
              </div>

              {changeError && (
                <div className="rounded border border-adm-danger/30 bg-adm-danger/5 px-3 py-2 font-mono text-[11px] text-adm-danger">
                  {changeError}
                </div>
              )}

              {amountFields.map((f) => (
                <div key={f.key}>
                  <label className="mb-1 block font-mono text-[10px] font-semibold uppercase tracking-wider text-adm-t3">
                    {f.label} ({amountUnit})
                    {!f.required && <span className="normal-case text-adm-t3"> — optional</span>}
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={changeAmounts[f.key] ?? ''}
                    onChange={(e) =>
                      setChangeAmounts((prev) => ({ ...prev, [f.key]: e.target.value }))
                    }
                    placeholder={
                      rule[f.key] != null ? `current: ${fmtAmount(rule[f.key])}` : 'not set'
                    }
                    className="w-full rounded border border-adm-border bg-adm-bg px-3 py-2 font-mono text-[11px] text-adm-t1 placeholder:text-adm-t3 focus:border-adm-amber focus:outline-none transition-colors"
                  />
                </div>
              ))}

              <div>
                <label className="mb-1 block font-mono text-[10px] font-semibold uppercase tracking-wider text-adm-t3">
                  Reason for Change
                </label>
                <textarea
                  value={changeReason}
                  onChange={(e) => setChangeReason(e.target.value)}
                  rows={3}
                  placeholder="Describe why these amounts should change…"
                  className="w-full rounded border border-adm-border bg-adm-bg px-3 py-2 font-mono text-[10px] text-adm-t2 placeholder:text-adm-t3 focus:border-adm-amber focus:outline-none resize-none transition-colors"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 border-t border-adm-border bg-adm-card px-5 py-4">
              <button
                onClick={() => setShowChangeModal(false)}
                className={adminButtonClass('modalCancel')}
              >
                Cancel
              </button>
              <button
                onClick={() => void handleChangeSubmit()}
                disabled={changeLoading || !changeReason.trim() || !changed}
                className={adminButtonClass('modalConfirm')}
              >
                {changeLoading ? 'Submitting…' : 'Submit for Approval'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
