import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { X, Pencil, UserPlus } from 'lucide-react';
import { AdminSessionError, adminFetch, getApiErrorMessage } from '../utils/adminFetch';
import { adminButtonClass } from '../components/common/adminButtonStyles';
import { DetailPageHeader } from '../components/compliance/DetailPageComponents';
import { AdminBadge } from '../components/ui/AdminBadge';
import TierEditor, {
  parseTiersJson,
  serializeTiers,
  type TierState,
} from '../components/pricing/TierEditor';

/* ── Interfaces ──────────────────────────────────────────────── */

interface FeeLevelDetail {
  id: string;
  levelCode: string;
  name: string;
  asset: { id: string; code: string; type: string; decimals?: number };
  isDefault: boolean;
  tiersJson: string;
  status: string;
  configHash: string | null;
  approvalCaseNo: string | null;
  createdAt: string;
  updatedAt: string;
}

interface BindingItem {
  id: string;
  customerId: string;
  customerNo: string;
  customerName: string;
  createdAt: string;
}

/* ── Helpers ─────────────────────────────────────────────────── */

const fmt = (v?: string | null): string => {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString();
};

const truncateHash = (hash: string | null): string => {
  if (!hash) return '—';
  if (hash.length <= 16) return hash;
  return `${hash.slice(0, 8)}…${hash.slice(-5)}`;
};

/* ── Layout primitives (mirroring TransactionLimitDetail) ── */

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

export default function WithdrawalFeeLevelDetail() {
  const { levelCode } = useParams<{ levelCode: string }>();
  const navigate = useNavigate();

  const [level, setLevel] = useState<FeeLevelDetail | null>(null);
  const [bindings, setBindings] = useState<BindingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  /* ── Change Modal state ── */
  const [showChangeModal, setShowChangeModal] = useState(false);
  const [changeTiers, setChangeTiers] = useState<TierState[]>([]);
  const [changeReason, setChangeReason] = useState('');
  const [changeLoading, setChangeLoading] = useState(false);
  const [changeError, setChangeError] = useState<string | null>(null);

  /* ── Bind Modal state ── */
  const [showBindModal, setShowBindModal] = useState(false);
  const [bindCustomerId, setBindCustomerId] = useState('');
  const [bindLoading, setBindLoading] = useState(false);
  const [bindError, setBindError] = useState<string | null>(null);

  /* ── Technical section ── */
  const [showRawJson, setShowRawJson] = useState(false);

  /* ── Fetch ── */

  const fetchDetail = async () => {
    if (!levelCode) return;
    setLoading(true);
    setError(null);
    try {
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/withdrawal-fee-levels/${levelCode}`,
      );
      if (!res.ok)
        throw new Error(await getApiErrorMessage(res, 'Failed to load level detail.'));
      setLevel(await res.json());
    } catch (err) {
      if (err instanceof AdminSessionError) return;
      setError(err instanceof Error ? err.message : 'Failed to load level detail.');
    } finally {
      setLoading(false);
    }
  };

  const fetchBindings = async () => {
    if (!levelCode) return;
    try {
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/withdrawal-fee-levels/${levelCode}/bindings`,
      );
      if (res.ok) {
        const data = (await res.json()) as BindingItem[] | { items: BindingItem[] };
        setBindings(Array.isArray(data) ? data : Array.isArray((data as { items: BindingItem[] }).items) ? (data as { items: BindingItem[] }).items : []);
      }
    } catch {
      /* ignore binding fetch errors */
    }
  };

  useEffect(() => {
    void fetchDetail();
    void fetchBindings();
  }, [levelCode]);

  useEffect(() => {
    if (!notice) return undefined;
    const t = window.setTimeout(() => setNotice((c) => (c === notice ? null : c)), 4000);
    return () => window.clearTimeout(t);
  }, [notice]);

  /* ── Change (Edit Tiers) ── */

  const openChangeModal = () => {
    if (!level) return;
    setChangeTiers(parseTiersJson(level.tiersJson));
    setChangeReason('');
    setChangeError(null);
    setShowChangeModal(true);
  };

  const handleChangeSubmit = async () => {
    if (!levelCode) return;
    if (!changeReason.trim()) {
      setChangeError('Change reason is required');
      return;
    }
    if (changeTiers.length === 0 || changeTiers.some((t) => t.feeItems.length === 0)) {
      setChangeError('At least 1 tier with 1 fee item is required');
      return;
    }

    setChangeLoading(true);
    setChangeError(null);
    try {
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/withdrawal-fee-levels/${levelCode}/change`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            proposedTiersJson: serializeTiers(changeTiers),
            changeReason: changeReason.trim(),
          }),
        },
      );
      if (!res.ok)
        throw new Error(await getApiErrorMessage(res, 'Failed to submit change'));
      const data = (await res.json()) as { approvalNo?: string };
      setShowChangeModal(false);
      setNotice(
        `Tier change submitted for approval${data.approvalNo ? ` (${data.approvalNo})` : ''}.`,
      );
      void fetchDetail();
    } catch (err) {
      if (err instanceof AdminSessionError) return;
      setChangeError(err instanceof Error ? err.message : 'Failed to submit change.');
    } finally {
      setChangeLoading(false);
    }
  };

  /* ── Bind Customer ── */

  const openBindModal = () => {
    setBindCustomerId('');
    setBindError(null);
    setShowBindModal(true);
  };

  const handleBindSubmit = async () => {
    if (!level) return;
    if (!bindCustomerId.trim()) {
      setBindError('Customer ID is required');
      return;
    }

    setBindLoading(true);
    setBindError(null);
    try {
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/withdrawal-fee-levels/bindings/bind`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            customerId: bindCustomerId.trim(),
            levelId: level.id,
          }),
        },
      );
      if (!res.ok) throw new Error(await getApiErrorMessage(res, 'Failed to bind customer'));
      setShowBindModal(false);
      setNotice('Customer bound successfully.');
      void fetchBindings();
    } catch (err) {
      if (err instanceof AdminSessionError) return;
      setBindError(err instanceof Error ? err.message : 'Failed to bind customer.');
    } finally {
      setBindLoading(false);
    }
  };

  /* ── Unbind Customer ── */

  const handleUnbind = async (customerId: string) => {
    if (!level) return;
    if (!window.confirm('Unbind this customer from the fee level?')) return;

    try {
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/withdrawal-fee-levels/bindings/unbind`,
        {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ customerId, levelId: level.id }),
        },
      );
      if (!res.ok) throw new Error(await getApiErrorMessage(res, 'Failed to unbind'));
      setNotice('Customer unbound successfully.');
      void fetchBindings();
    } catch (err) {
      if (err instanceof AdminSessionError) return;
      setError(err instanceof Error ? err.message : 'Failed to unbind customer.');
    }
  };

  /* ── Parse tiers for display ── */

  const parsedTiers = level
    ? (() => {
        try {
          return (
            JSON.parse(level.tiersJson) as {
              tiers: Array<{
                id: string;
                name: string;
                enabled: boolean;
                conditions: { amountMin: number; amountMax: number | null };
                feeItems: Array<{
                  id: string;
                  itemCode: string;
                  calcType: string;
                  value: string;
                  min: string | null;
                  max: string | null;
                }>;
              }>;
            }
          ).tiers;
        } catch {
          return [];
        }
      })()
    : [];

  /* ── Loading / Error states ── */

  if (loading && !level) {
    return (
      <div className="flex min-h-[320px] flex-col items-center justify-center">
        <div className="animate-spin rounded-full h-6 w-6 border-2 border-adm-amber border-t-transparent" />
        <p className="mt-3 font-mono text-[11px] text-adm-t3">Loading level…</p>
      </div>
    );
  }

  if (!level) {
    return (
      <div className="space-y-4 rounded border border-adm-red/30 bg-adm-red/10 p-8 text-center">
        <div className="font-mono text-[11px] text-adm-red">
          {error || 'Level not found'}
        </div>
        <div className="flex items-center justify-center gap-3">
          <button
            onClick={() => navigate('/admin/pricing/withdrawal-fee-levels')}
            className={adminButtonClass('detailUtility')}
          >
            Back to Levels
          </button>
          <button onClick={() => void fetchDetail()} className={adminButtonClass('detailUtility')}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* ── Header ── */}
      <DetailPageHeader
        onBack={() => navigate('/admin/pricing/withdrawal-fee-levels')}
        onRefresh={() => {
          void fetchDetail();
          void fetchBindings();
        }}
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
            <div className="flex items-center gap-3">
              <p className="font-mono text-[19px] font-bold leading-snug text-adm-amber">
                {level.levelCode}
              </p>
              <AdminBadge value={level.status} />
              {level.isDefault && (
                <span className="inline-flex items-center rounded bg-blue-100 px-1.5 py-0.5 font-mono text-[10px] font-medium text-blue-800 dark:bg-blue-900/30 dark:text-blue-300">
                  DEFAULT
                </span>
              )}
            </div>
            <p className="mt-1 text-[13px] text-adm-t1">{level.name}</p>
            <p className="mt-0.5 font-mono text-[11px] text-adm-t3">
              Asset: {level.asset.code} ({level.asset.type}) · {parsedTiers.length} tier
              {parsedTiers.length !== 1 ? 's' : ''}
            </p>
          </section>

          {/* ② Fee Tiers */}
          <section className="px-6 py-5">
            <Cap>Fee Tiers</Cap>
            <div className="mt-3 space-y-3">
              {parsedTiers.map((tier) => (
                <div
                  key={tier.id}
                  className="rounded-lg border border-adm-border bg-adm-panel"
                >
                  {/* Tier header */}
                  <div className="flex items-center justify-between border-b border-adm-border/50 px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className="text-[12px] font-semibold text-adm-t1">
                        {tier.name}
                      </span>
                      <span className="font-mono text-[10px] text-adm-t3">
                        #{tier.id}
                      </span>
                    </div>
                    <div className="font-mono text-[10px] text-adm-t3">
                      <span className={tier.enabled ? 'text-adm-green' : 'text-adm-red'}>
                        {tier.enabled ? 'Enabled' : 'Disabled'}
                      </span>
                    </div>
                  </div>
                  {/* Tier body */}
                  <div className="px-4 py-3">
                    <p className="mb-2 font-mono text-[10px] text-adm-t3">
                      Amount Range:{' '}
                      <strong className="text-adm-t1">
                        {tier.conditions.amountMin ?? 0}
                      </strong>{' '}
                      —{' '}
                      <strong className="text-adm-t1">
                        {tier.conditions.amountMax ?? '∞'}
                      </strong>
                    </p>
                    <table className="w-full border-collapse text-[11px]">
                      <thead>
                        <tr className="bg-adm-card font-mono text-[9px] uppercase tracking-wider text-adm-t3">
                          <th className="px-2 py-1.5 text-left font-medium">Fee Item</th>
                          <th className="px-2 py-1.5 text-left font-medium">Calc Type</th>
                          <th className="px-2 py-1.5 text-right font-medium">Value</th>
                          <th className="px-2 py-1.5 text-right font-medium">Min</th>
                          <th className="px-2 py-1.5 text-right font-medium">Max</th>
                        </tr>
                      </thead>
                      <tbody>
                        {tier.feeItems.map((fee) => (
                          <tr
                            key={fee.id}
                            className="border-t border-adm-border/50"
                          >
                            <td className="px-2 py-1.5 font-medium text-adm-t1">
                              {fee.itemCode}
                            </td>
                            <td className="px-2 py-1.5">
                              <span className="inline-block rounded bg-adm-card px-1.5 py-0.5 font-mono text-[10px] text-adm-t2">
                                {fee.calcType}
                              </span>
                            </td>
                            <td className="px-2 py-1.5 text-right font-mono text-adm-t1">
                              {fee.value}
                            </td>
                            <td className="px-2 py-1.5 text-right text-adm-t3">
                              {fee.min ?? '—'}
                            </td>
                            <td className="px-2 py-1.5 text-right text-adm-t3">
                              {fee.max ?? '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* ③ Customer Bindings */}
          <section className="px-6 py-5">
            <Cap>Customer Bindings ({bindings.length})</Cap>
            <div className="mt-3">
              {bindings.length === 0 ? (
                <p className="font-mono text-[11px] text-adm-t3">
                  No customers bound to this level
                </p>
              ) : (
                <div className="rounded-lg border border-adm-border bg-adm-panel">
                  <table className="w-full border-collapse text-[11px]">
                    <thead>
                      <tr className="bg-adm-card font-mono text-[9px] uppercase tracking-wider text-adm-t3">
                        <th className="px-3 py-2 text-left font-medium">Customer No</th>
                        <th className="px-3 py-2 text-left font-medium">Name</th>
                        <th className="px-3 py-2 text-left font-medium">Bound At</th>
                        <th className="px-3 py-2 text-right font-medium">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bindings.map((b) => (
                        <tr key={b.id} className="border-t border-adm-border/50">
                          <td className="px-3 py-2 font-mono text-adm-amber">
                            {b.customerNo}
                          </td>
                          <td className="px-3 py-2 text-adm-t1">{b.customerName}</td>
                          <td className="px-3 py-2 font-mono text-[10px] text-adm-t3">
                            {fmt(b.createdAt)}
                          </td>
                          <td className="px-3 py-2 text-right">
                            <button
                              onClick={() => void handleUnbind(b.customerId)}
                              className="rounded border border-adm-danger px-2 py-0.5 font-mono text-[10px] text-adm-danger hover:bg-adm-danger/10"
                            >
                              Unbind
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </section>

          {/* ④ Technical (Raw JSON) */}
          <section className="px-6 py-4">
            <button
              onClick={() => setShowRawJson(!showRawJson)}
              className="font-mono text-[9px] font-semibold uppercase tracking-[0.16em] text-adm-t3 hover:text-adm-t1"
            >
              {showRawJson ? '▼' : '▶'} Technical (Raw JSON)
            </button>
            {showRawJson && (
              <pre className="mt-2 overflow-auto rounded bg-gray-900 p-3 font-mono text-[11px] text-gray-100 max-h-96">
                {JSON.stringify(level, null, 2)}
              </pre>
            )}
          </section>
        </div>

        {/* ════ RIGHT SIDEBAR ════ */}
        <div className="w-[272px] min-w-[272px] overflow-y-auto border-l border-adm-border bg-adm-panel px-4 py-1">
          {/* Actions */}
          {level.status === 'ACTIVE' && (
            <div className="border-b border-adm-border py-4">
              <Cap>Actions</Cap>
              <div className="mt-2.5 flex flex-col gap-2">
                <button onClick={openChangeModal} className={adminButtonClass('workflowPrimary')}>
                  <Pencil size={13} />
                  Edit Tiers
                </button>
                <button onClick={openBindModal} className={adminButtonClass('listSecondary')}>
                  <UserPlus size={13} />
                  Bind Customer
                </button>
                <p className="text-center font-mono text-[10px] text-adm-t3">
                  Edit Tiers requires MLRO → SMO approval
                </p>
              </div>
            </div>
          )}

          {/* Identity */}
          <SidebarGroup title="Identity">
            <SidebarKV label="Level Code" value={level.levelCode} mono />
            <SidebarKV label="Status" value={<AdminBadge value={level.status} />} />
            <SidebarKV
              label="Asset"
              value={`${level.asset.code} (${level.asset.type})`}
            />
            <SidebarKV label="Default" value={level.isDefault ? 'Yes' : 'No'} />
            <SidebarKV label="Config Hash" value={truncateHash(level.configHash)} mono />
            <SidebarKV
              label="Approval"
              value={
                level.approvalCaseNo ? (
                  <button
                    onClick={() =>
                      navigate(
                        `/admin/governance/approvals/${level.approvalCaseNo}`,
                      )
                    }
                    className="font-mono text-[10px] text-adm-amber hover:underline"
                  >
                    {level.approvalCaseNo}
                  </button>
                ) : (
                  '—'
                )
              }
            />
          </SidebarGroup>

          {/* Lifecycle */}
          <SidebarGroup title="Lifecycle">
            <SidebarKV label="Created" value={fmt(level.createdAt)} mono />
            <SidebarKV label="Updated" value={fmt(level.updatedAt)} mono />
          </SidebarGroup>
        </div>
      </div>

      {/* ════ Change Modal (Edit Tiers) ════ */}
      {showChangeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-4xl max-h-[85vh] overflow-y-auto rounded-xl border border-adm-border bg-adm-panel shadow-xl">
            {/* Header */}
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-adm-border bg-adm-card px-5 py-4">
              <div>
                <p className="font-mono text-[11px] font-semibold text-adm-t1">
                  Edit Tiers
                </p>
                <p className="mt-1 font-mono text-[9px] text-adm-t3">
                  {level.levelCode} · {level.asset.code}
                </p>
              </div>
              <button
                onClick={() => setShowChangeModal(false)}
                className="rounded p-1 text-adm-t3 hover:bg-adm-hover hover:text-adm-t1"
              >
                <X size={15} />
              </button>
            </div>

            {/* Body */}
            <div className="px-5 py-4 space-y-3">
              <div className="rounded border border-adm-amber/30 bg-adm-amber/10 px-3 py-2.5 font-mono text-[10px] text-adm-amber leading-relaxed">
                This will submit a tier change request for MLRO → SMO approval. The current
                configuration remains in effect until the change is approved.
              </div>

              {changeError && (
                <div className="rounded border border-adm-danger/30 bg-adm-danger/5 px-3 py-2 font-mono text-[11px] text-adm-danger">
                  {changeError}
                </div>
              )}

              <div>
                <label className="mb-1 block font-mono text-[10px] font-semibold uppercase tracking-wider text-adm-t3">
                  Proposed Tiers
                </label>
                <TierEditor
                  tiers={changeTiers}
                  onChange={setChangeTiers}
                />
              </div>

              <div>
                <label className="mb-1 block font-mono text-[10px] font-semibold uppercase tracking-wider text-adm-t3">
                  Change Reason
                </label>
                <textarea
                  value={changeReason}
                  onChange={(e) => setChangeReason(e.target.value)}
                  rows={3}
                  placeholder="Describe why these tiers should be changed…"
                  className="w-full rounded border border-adm-border bg-adm-bg px-3 py-2 font-mono text-[10px] text-adm-t2 placeholder:text-adm-t3 focus:border-adm-amber focus:outline-none resize-none transition-colors"
                />
              </div>
            </div>

            {/* Footer */}
            <div className="sticky bottom-0 flex justify-end gap-2 border-t border-adm-border bg-adm-card px-5 py-4">
              <button
                onClick={() => setShowChangeModal(false)}
                className={adminButtonClass('modalCancel')}
              >
                Cancel
              </button>
              <button
                onClick={() => void handleChangeSubmit()}
                disabled={changeLoading || !changeReason.trim()}
                className={adminButtonClass('modalConfirm')}
              >
                {changeLoading ? 'Submitting…' : 'Submit for Approval'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ════ Bind Customer Modal ════ */}
      {showBindModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-xl border border-adm-border bg-adm-panel shadow-xl">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-adm-border bg-adm-card px-5 py-4">
              <p className="font-mono text-[11px] font-semibold text-adm-t1">
                Bind Customer
              </p>
              <button
                onClick={() => setShowBindModal(false)}
                className="rounded p-1 text-adm-t3 hover:bg-adm-hover hover:text-adm-t1"
              >
                <X size={15} />
              </button>
            </div>

            {/* Body */}
            <div className="px-5 py-4 space-y-3">
              {bindError && (
                <div className="rounded border border-adm-danger/30 bg-adm-danger/5 px-3 py-2 font-mono text-[11px] text-adm-danger">
                  {bindError}
                </div>
              )}

              <div>
                <label className="mb-1 block font-mono text-[10px] font-semibold uppercase tracking-wider text-adm-t3">
                  Customer ID
                </label>
                <input
                  type="text"
                  value={bindCustomerId}
                  onChange={(e) => setBindCustomerId(e.target.value)}
                  placeholder="Enter customer UUID"
                  className="w-full rounded border border-adm-border bg-adm-bg px-3 py-2 font-mono text-[11px] text-adm-t1 placeholder:text-adm-t3 focus:border-adm-amber focus:outline-none transition-colors"
                  autoFocus
                />
              </div>
            </div>

            {/* Footer */}
            <div className="flex justify-end gap-2 border-t border-adm-border bg-adm-card px-5 py-4">
              <button
                onClick={() => setShowBindModal(false)}
                className={adminButtonClass('modalCancel')}
              >
                Cancel
              </button>
              <button
                onClick={() => void handleBindSubmit()}
                disabled={bindLoading || !bindCustomerId.trim()}
                className={adminButtonClass('modalConfirm')}
              >
                {bindLoading ? 'Binding…' : 'Bind'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
