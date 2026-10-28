// admin-web/src/pages/ComplianceRegistersPage.tsx
// 战役甲波四 · 合规办公室骨架（Task 9）：登记册页。甲波六 T8：外包商册改成服务商准入，整体抬到独立页
// （ServiceProvidersPage.tsx，Compliance Office → Service Providers），本页只剩受托责任人（RI）册。
// 铁律⑥：列表投影零 UUID（后端 ResponsibleIndividualsService 的 toListItem 已保证）。
// 模板：RegulatoryFilingListPage.tsx 的表格 + 弹层结构。
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, RefreshCw } from 'lucide-react';
import { adminButtonClass, adminIconButtonClass } from '../components/common/adminButtonStyles';
import { PageTitleBar } from '../components/ui/PageTitleBar';
import { useAdminSession } from '../contexts/AdminSessionContext';
import { PERMISSIONS } from '../rbac/permissions';
import { AdminSessionError, adminFetch, getApiErrorMessage } from '../utils/adminFetch';

// ── RI 册 ────────────────────────────────────────────────────────────

interface RiItem {
  riNo: string;
  position: string;
  incumbentName: string;
  varaRef: string | null;
  effectiveFrom: string;
  status: string;
  pendingApprovalNo: string | null;
  createdAt: string;
}

const CreateSeatModal = ({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) => {
  const [position, setPosition] = useState('');
  const [incumbentName, setIncumbentName] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [varaRef, setVaraRef] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setPosition(''); setIncumbentName(''); setEffectiveFrom(''); setVaraRef(''); setError('');
  }, [open]);

  if (!open) return null;

  const submit = async () => {
    setError('');
    if (!position.trim()) { setError('Position is required'); return; }
    if (!incumbentName.trim()) { setError('Incumbent name is required'); return; }
    if (!effectiveFrom) { setError('Effective date is required'); return; }
    setSubmitting(true);
    try {
      const res = await adminFetch(`${import.meta.env.VITE_API_URL}/admin/responsible-individuals`, {
        method: 'POST',
        body: JSON.stringify({
          position: position.trim(), incumbentName: incumbentName.trim(),
          effectiveFrom, varaRef: varaRef.trim() || undefined,
        }),
      });
      if (!res.ok) { setError(await getApiErrorMessage(res, 'Failed to register the seat')); return; }
      onSaved();
    } catch (e) {
      if (e instanceof AdminSessionError) return;
      setError(e instanceof Error ? e.message : 'Failed to register the seat');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="w-[480px] rounded-lg border border-adm-border bg-adm-panel p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-3 text-sm font-semibold text-adm-t1">Register Responsible Individual Seat</h3>

        <label className="mb-3 block text-xs">Position
          <input value={position} onChange={(e) => setPosition(e.target.value)} className="mt-1 w-full rounded border border-adm-border bg-adm-panel px-2 py-1 text-xs" placeholder="e.g. MLRO" />
        </label>
        <label className="mb-3 block text-xs">Incumbent Name
          <input value={incumbentName} onChange={(e) => setIncumbentName(e.target.value)} className="mt-1 w-full rounded border border-adm-border bg-adm-panel px-2 py-1 text-xs" />
        </label>
        <div className="mb-3 grid grid-cols-2 gap-2">
          <label className="block text-xs">Effective From
            <input type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} className="mt-1 w-full rounded border border-adm-border bg-adm-panel px-2 py-1 text-xs" />
          </label>
          <label className="block text-xs">VARA Ref (optional)
            <input value={varaRef} onChange={(e) => setVaraRef(e.target.value)} className="mt-1 w-full rounded border border-adm-border bg-adm-panel px-2 py-1 text-xs font-mono" placeholder="VARA-RI-…" />
          </label>
        </div>

        {error && <p className="mb-2 text-xs text-adm-red">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={adminButtonClass('modalCancel')}>Cancel</button>
          <button type="button" disabled={submitting} onClick={() => void submit()} className={adminButtonClass('modalConfirm')}>
            {submitting ? 'Saving…' : 'Register'}
          </button>
        </div>
      </div>
    </div>
  );
};

const ProposeReplacementModal = ({
  open, seat, onClose, onSaved,
}: {
  open: boolean;
  seat: RiItem | null;
  onClose: () => void;
  onSaved: () => void;
}) => {
  const [newIncumbentName, setNewIncumbentName] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [reason, setReason] = useState('');
  const [varaRef, setVaraRef] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setNewIncumbentName(''); setEffectiveFrom(''); setReason(''); setVaraRef(''); setError('');
  }, [open]);

  if (!open || !seat) return null;

  const submit = async () => {
    setError('');
    if (!newIncumbentName.trim()) { setError('New incumbent name is required'); return; }
    if (!effectiveFrom) { setError('Effective date is required'); return; }
    if (!reason.trim()) { setError('Reason is required'); return; }
    setSubmitting(true);
    try {
      const res = await adminFetch(`${import.meta.env.VITE_API_URL}/admin/responsible-individuals/${encodeURIComponent(seat.riNo)}/replacement`, {
        method: 'POST',
        body: JSON.stringify({
          newIncumbentName: newIncumbentName.trim(), effectiveFrom,
          reason: reason.trim(), varaRef: varaRef.trim() || undefined,
        }),
      });
      if (!res.ok) { setError(await getApiErrorMessage(res, 'Failed to propose the replacement')); return; }
      onSaved();
    } catch (e) {
      if (e instanceof AdminSessionError) return;
      setError(e instanceof Error ? e.message : 'Failed to propose the replacement');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="w-[480px] rounded-lg border border-adm-border bg-adm-panel p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-1 text-sm font-semibold text-adm-t1">Propose Replacement</h3>
        <p className="mb-3 font-mono text-[10px] text-adm-t3">{seat.riNo} · {seat.position} · currently {seat.incumbentName}</p>

        <label className="mb-3 block text-xs">New Incumbent Name
          <input value={newIncumbentName} onChange={(e) => setNewIncumbentName(e.target.value)} className="mt-1 w-full rounded border border-adm-border bg-adm-panel px-2 py-1 text-xs" />
        </label>
        <div className="mb-3 grid grid-cols-2 gap-2">
          <label className="block text-xs">Effective From
            <input type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} className="mt-1 w-full rounded border border-adm-border bg-adm-panel px-2 py-1 text-xs" />
          </label>
          <label className="block text-xs">VARA Ref (optional)
            <input value={varaRef} onChange={(e) => setVaraRef(e.target.value)} className="mt-1 w-full rounded border border-adm-border bg-adm-panel px-2 py-1 text-xs font-mono" placeholder="VARA-RI-…" />
          </label>
        </div>
        <label className="mb-3 block text-xs">Reason
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} className="mt-1 w-full rounded border border-adm-border bg-adm-panel px-2 py-1 text-xs" placeholder="Why is this replacement being proposed?" />
        </label>

        <div className="mb-3 rounded border border-adm-amber/30 bg-adm-amber/10 px-3 py-2 font-mono text-[10px] text-adm-amber">
          This opens an approval — senior management decides.
        </div>

        {error && <p className="mb-2 text-xs text-adm-red">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={adminButtonClass('modalCancel')}>Cancel</button>
          <button type="button" disabled={submitting} onClick={() => void submit()} className={adminButtonClass('modalConfirm')}>
            {submitting ? 'Submitting…' : 'Propose Replacement'}
          </button>
        </div>
      </div>
    </div>
  );
};

const RiTab = () => {
  const { hasPermission } = useAdminSession();
  const canWrite = hasPermission(PERMISSIONS.RI_REGISTER_WRITE);
  const [items, setItems] = useState<RiItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [replaceTarget, setReplaceTarget] = useState<RiItem | null>(null);

  const fetchItems = async () => {
    setLoading(true);
    try {
      const res = await adminFetch(`${import.meta.env.VITE_API_URL}/admin/responsible-individuals`);
      if (!res.ok) { alert(await getApiErrorMessage(res, 'Failed to load responsible individual seats')); return; }
      const data = await res.json();
      setItems(Array.isArray(data) ? data : []);
    } catch (e) {
      if (e instanceof AdminSessionError) return;
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchItems();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between px-5 py-2">
        <p className="font-mono text-[10px] text-adm-t3">{items.length} seat(s)</p>
        <div className="flex items-center gap-2">
          {canWrite && (
            <button type="button" onClick={() => setShowCreate(true)} className={adminButtonClass('listPrimary')}>
              <Plus size={13} /> Register Seat
            </button>
          )}
          <button type="button" onClick={() => void fetchItems()} className={adminIconButtonClass()} title="Refresh">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-adm-panel">
            <tr className="border-b border-adm-border text-left text-adm-t3">
              {['RI No.', 'Position', 'Incumbent', 'VARA Ref', 'Effective From', 'Pending Replacement', ''].map((h) => (
                <th key={h} className="px-4 py-2 font-mono text-[10px] uppercase tracking-wide">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.riNo} className="border-b border-adm-border/60">
                <td className="px-4 py-2 font-mono text-adm-blue">{it.riNo}</td>
                <td className="px-4 py-2">{it.position}</td>
                <td className="px-4 py-2">{it.incumbentName}</td>
                <td className="px-4 py-2 font-mono">{it.varaRef ?? '—'}</td>
                <td className="px-4 py-2 font-mono">{new Date(it.effectiveFrom).toLocaleDateString()}</td>
                <td className="px-4 py-2 font-mono">
                  {it.pendingApprovalNo ? (
                    <Link to={`/admin/governance/approvals/${encodeURIComponent(it.pendingApprovalNo)}`} className="text-adm-blue hover:underline">
                      {it.pendingApprovalNo}
                    </Link>
                  ) : '—'}
                </td>
                <td className="px-4 py-2 text-right">
                  {canWrite && (
                    <button
                      type="button"
                      disabled={!!it.pendingApprovalNo}
                      onClick={() => setReplaceTarget(it)}
                      className={adminButtonClass('rowSecondaryUtility')}
                      title={it.pendingApprovalNo ? 'A replacement is already pending for this seat' : undefined}
                    >
                      Propose replacement
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {!loading && items.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-adm-t3">
                  No responsible individual seats registered yet — click "Register Seat" to add the first one
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <CreateSeatModal open={showCreate} onClose={() => setShowCreate(false)} onSaved={() => { setShowCreate(false); void fetchItems(); }} />
      <ProposeReplacementModal
        open={!!replaceTarget}
        seat={replaceTarget}
        onClose={() => setReplaceTarget(null)}
        onSaved={() => { setReplaceTarget(null); void fetchItems(); }}
      />
    </div>
  );
};

// ── 页面 ─────────────────────────────────────────────────────────────

const ComplianceRegistersPage = () => (
  <div className="flex h-full flex-col">
    <PageTitleBar
      title="Compliance Registers"
      subtitle="The VARA register of responsible individuals"
    />
    <div className="flex-1 overflow-hidden">
      <RiTab />
    </div>
  </div>
);

export default ComplianceRegistersPage;
