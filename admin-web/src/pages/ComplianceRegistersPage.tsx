// admin-web/src/pages/ComplianceRegistersPage.tsx
// 战役甲波四 · 合规办公室骨架（Task 9）：两本登记册——外包供应商 / 受托责任人（RI）。
// 铁律⑥：列表投影零 UUID（后端 OutsourcingVendorsService/ResponsibleIndividualsService 的
// toListItem 已保证）。模板：RegulatoryFilingListPage.tsx 的表格 + 弹层结构；两 tab 一个页面
// （brief 明确只建这一个文件），tab 状态镜像进 URL query 供深链/刷新保留。
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Plus, RefreshCw } from 'lucide-react';
import { adminButtonClass, adminIconButtonClass } from '../components/common/adminButtonStyles';
import { PageTitleBar } from '../components/ui/PageTitleBar';
import { useAdminSession } from '../contexts/AdminSessionContext';
import { PERMISSIONS } from '../rbac/permissions';
import { AdminSessionError, adminFetch, getApiErrorMessage } from '../utils/adminFetch';

// ── 外包商册 ──────────────────────────────────────────────────────────

interface VendorItem {
  vendorNo: string;
  name: string;
  serviceDescription: string;
  criticality: 'MATERIAL' | 'NON_MATERIAL';
  contractStart: string;
  contractEnd: string | null;
  status: 'ACTIVE' | 'TERMINATED';
  notes: string | null;
  createdAt: string;
}

const CRITICALITY_LABEL: Record<string, string> = { MATERIAL: 'Material', NON_MATERIAL: 'Non-material' };

const VENDOR_STATUS_CLASS: Record<string, string> = {
  ACTIVE: 'bg-green-100 text-green-800',
  TERMINATED: 'bg-red-100 text-red-800',
};

const VendorModal = ({
  mode, initial, open, onClose, onSaved,
}: {
  mode: 'create' | 'edit';
  initial?: Partial<VendorItem> & { vendorNo?: string };
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) => {
  const [name, setName] = useState('');
  const [serviceDescription, setServiceDescription] = useState('');
  const [criticality, setCriticality] = useState<'MATERIAL' | 'NON_MATERIAL'>('MATERIAL');
  const [contractStart, setContractStart] = useState('');
  const [contractEnd, setContractEnd] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setName(initial?.name ?? '');
    setServiceDescription(initial?.serviceDescription ?? '');
    setCriticality(initial?.criticality ?? 'MATERIAL');
    setContractStart(initial?.contractStart ? initial.contractStart.slice(0, 10) : '');
    setContractEnd(initial?.contractEnd ? initial.contractEnd.slice(0, 10) : '');
    setNotes(initial?.notes ?? '');
    setError('');
  }, [open, initial]);

  if (!open) return null;

  const submit = async () => {
    setError('');
    if (!name.trim()) { setError('Name is required'); return; }
    if (!serviceDescription.trim()) { setError('Service description is required'); return; }
    if (mode === 'create' && !contractStart) { setError('Contract start date is required'); return; }
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        name: name.trim(),
        serviceDescription: serviceDescription.trim(),
        criticality,
        contractEnd: contractEnd || undefined,
        notes: notes.trim() || undefined,
      };
      let res;
      if (mode === 'create') {
        body.contractStart = contractStart;
        res = await adminFetch(`${import.meta.env.VITE_API_URL}/admin/outsourcing-vendors`, {
          method: 'POST', body: JSON.stringify(body),
        });
      } else {
        if (contractStart) body.contractStart = contractStart;
        res = await adminFetch(`${import.meta.env.VITE_API_URL}/admin/outsourcing-vendors/${encodeURIComponent(initial!.vendorNo!)}`, {
          method: 'PATCH', body: JSON.stringify(body),
        });
      }
      if (!res.ok) { setError(await getApiErrorMessage(res, 'Failed to save the vendor')); return; }
      onSaved();
    } catch (e) {
      if (e instanceof AdminSessionError) return;
      setError(e instanceof Error ? e.message : 'Failed to save the vendor');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="w-[540px] max-h-[85vh] overflow-y-auto rounded-lg border border-adm-border bg-adm-panel p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-3 text-sm font-semibold text-adm-t1">{mode === 'create' ? 'Register Vendor' : 'Update Vendor'}</h3>

        <label className="mb-3 block text-xs">Name
          <input value={name} onChange={(e) => setName(e.target.value)} className="mt-1 w-full rounded border border-adm-border bg-adm-panel px-2 py-1 text-xs" placeholder="e.g. Sumsub" />
        </label>

        <label className="mb-3 block text-xs">Service Description
          <textarea value={serviceDescription} onChange={(e) => setServiceDescription(e.target.value)} rows={2} className="mt-1 w-full rounded border border-adm-border bg-adm-panel px-2 py-1 text-xs" placeholder="e.g. KYC/AML identity verification and screening" />
        </label>

        <div className="mb-3 grid grid-cols-2 gap-2">
          <label className="block text-xs">Criticality
            <select value={criticality} onChange={(e) => setCriticality(e.target.value as 'MATERIAL' | 'NON_MATERIAL')} className="mt-1 w-full rounded border border-adm-border bg-adm-panel px-2 py-1 text-xs">
              <option value="MATERIAL">Material</option>
              <option value="NON_MATERIAL">Non-material</option>
            </select>
          </label>
          <label className="block text-xs">Contract Start{mode === 'create' ? '' : ' (optional)'}
            <input type="date" value={contractStart} onChange={(e) => setContractStart(e.target.value)} className="mt-1 w-full rounded border border-adm-border bg-adm-panel px-2 py-1 text-xs" />
          </label>
        </div>

        <label className="mb-3 block text-xs">Contract End (optional)
          <input type="date" value={contractEnd} onChange={(e) => setContractEnd(e.target.value)} className="mt-1 w-full rounded border border-adm-border bg-adm-panel px-2 py-1 text-xs" />
        </label>

        <label className="mb-3 block text-xs">Notes (optional)
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="mt-1 w-full rounded border border-adm-border bg-adm-panel px-2 py-1 text-xs" />
        </label>

        {error && <p className="mb-2 text-xs text-adm-red">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={adminButtonClass('modalCancel')}>Cancel</button>
          <button type="button" disabled={submitting} onClick={() => void submit()} className={adminButtonClass('modalConfirm')}>
            {submitting ? 'Saving…' : mode === 'create' ? 'Register' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
};

const TerminateVendorModal = ({
  open, vendor, onClose, onConfirmed,
}: {
  open: boolean;
  vendor: VendorItem | null;
  onClose: () => void;
  onConfirmed: () => void;
}) => {
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) { setNotes(''); setError(''); }
  }, [open]);

  if (!open || !vendor) return null;

  const confirm = async () => {
    setSubmitting(true);
    setError('');
    try {
      const res = await adminFetch(`${import.meta.env.VITE_API_URL}/admin/outsourcing-vendors/${encodeURIComponent(vendor.vendorNo)}/terminate`, {
        method: 'POST', body: JSON.stringify({ notes: notes.trim() || undefined }),
      });
      if (!res.ok) { setError(await getApiErrorMessage(res, 'Failed to terminate the vendor')); return; }
      onConfirmed();
    } catch (e) {
      if (e instanceof AdminSessionError) return;
      setError(e instanceof Error ? e.message : 'Failed to terminate the vendor');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="w-[440px] rounded-lg border border-adm-border bg-adm-panel p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-2 text-sm font-semibold text-adm-t1">Terminate Vendor</h3>
        <p className="mb-3 text-xs text-adm-t2">
          This will terminate <span className="font-mono text-adm-blue">{vendor.vendorNo}</span> ({vendor.name}). This cannot be undone — there is no path back to ACTIVE.
        </p>
        <label className="mb-3 block text-xs">Notes (optional)
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="mt-1 w-full rounded border border-adm-border bg-adm-panel px-2 py-1 text-xs" />
        </label>
        {error && <p className="mb-2 text-xs text-adm-red">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={adminButtonClass('modalCancel')}>Cancel</button>
          <button type="button" disabled={submitting} onClick={() => void confirm()} className={adminButtonClass('workflowNegative')}>
            {submitting ? 'Working…' : 'Confirm Termination'}
          </button>
        </div>
      </div>
    </div>
  );
};

const VendorsTab = () => {
  const { hasPermission } = useAdminSession();
  const canWrite = hasPermission(PERMISSIONS.VENDOR_REGISTER_WRITE);
  const [items, setItems] = useState<VendorItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState<{ mode: 'create' | 'edit'; item?: VendorItem } | null>(null);
  const [terminateTarget, setTerminateTarget] = useState<VendorItem | null>(null);

  const fetchItems = async () => {
    setLoading(true);
    try {
      const res = await adminFetch(`${import.meta.env.VITE_API_URL}/admin/outsourcing-vendors`);
      if (!res.ok) { alert(await getApiErrorMessage(res, 'Failed to load outsourcing vendors')); return; }
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
        <p className="font-mono text-[10px] text-adm-t3">{items.length} vendor(s)</p>
        <div className="flex items-center gap-2">
          {canWrite && (
            <button type="button" onClick={() => setShowModal({ mode: 'create' })} className={adminButtonClass('listPrimary')}>
              <Plus size={13} /> Register Vendor
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
              {['Vendor No.', 'Name', 'Service', 'Criticality', 'Contract Start', 'Contract End', 'Status', ''].map((h) => (
                <th key={h} className="px-4 py-2 font-mono text-[10px] uppercase tracking-wide">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.vendorNo} className="border-b border-adm-border/60">
                <td className="px-4 py-2 font-mono text-adm-blue">{it.vendorNo}</td>
                <td className="px-4 py-2">{it.name}</td>
                <td className="px-4 py-2 max-w-[280px] truncate" title={it.serviceDescription}>{it.serviceDescription}</td>
                <td className="px-4 py-2">{CRITICALITY_LABEL[it.criticality] ?? it.criticality}</td>
                <td className="px-4 py-2 font-mono">{new Date(it.contractStart).toLocaleDateString()}</td>
                <td className="px-4 py-2 font-mono">{it.contractEnd ? new Date(it.contractEnd).toLocaleDateString() : '—'}</td>
                <td className="px-4 py-2">
                  <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${VENDOR_STATUS_CLASS[it.status]}`}>
                    {it.status}
                  </span>
                </td>
                <td className="px-4 py-2 text-right">
                  {canWrite && (
                    <div className="flex items-center justify-end gap-2">
                      <button type="button" onClick={() => setShowModal({ mode: 'edit', item: it })} className={adminButtonClass('rowSecondaryUtility')}>
                        Edit
                      </button>
                      {it.status === 'ACTIVE' && (
                        <button type="button" onClick={() => setTerminateTarget(it)} className={adminButtonClass('rowSecondaryUtility')}>
                          Terminate
                        </button>
                      )}
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {!loading && items.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-adm-t3">
                  No outsourcing vendors registered yet — click "Register Vendor" to add the first one
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <VendorModal
        mode={showModal?.mode ?? 'create'}
        initial={showModal?.item}
        open={!!showModal}
        onClose={() => setShowModal(null)}
        onSaved={() => { setShowModal(null); void fetchItems(); }}
      />
      <TerminateVendorModal
        open={!!terminateTarget}
        vendor={terminateTarget}
        onClose={() => setTerminateTarget(null)}
        onConfirmed={() => { setTerminateTarget(null); void fetchItems(); }}
      />
    </div>
  );
};

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

// ── 页面（两 tab）────────────────────────────────────────────────────

const TABS = [
  { key: 'vendors', label: 'Outsourcing Vendors' },
  { key: 'ri', label: 'Responsible Individuals' },
] as const;

const ComplianceRegistersPage = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeParam = searchParams.get('tab');
  const active = activeParam === 'ri' ? 'ri' : 'vendors';

  return (
    <div className="flex h-full flex-col">
      <PageTitleBar
        title="Compliance Registers"
        subtitle="The two VARA registers — outsourcing vendors and responsible individuals"
      />

      <div className="flex shrink-0 items-center gap-1 border-b border-adm-border bg-adm-panel px-5 pt-2">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setSearchParams(tab.key === 'vendors' ? {} : { tab: tab.key })}
            className={[
              'rounded-t border border-b-0 px-3 py-1.5 font-mono text-[11px] font-semibold transition-colors',
              tab.key === active
                ? 'border-adm-border bg-adm-bg text-adm-amber'
                : 'border-transparent text-adm-t3 hover:text-adm-t2',
            ].join(' ')}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-hidden">
        {active === 'vendors' ? <VendorsTab /> : <RiTab />}
      </div>
    </div>
  );
};

export default ComplianceRegistersPage;
