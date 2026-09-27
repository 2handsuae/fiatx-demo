// admin-web/src/pages/ComplianceObligationListPage.tsx
// 战役甲波四 · 合规办公室骨架（Task 9）：周期义务（合规日历）列表——登记/改描述性字段/
// 启停 ＋ ⚡ Fast-forward due。铁律⑥：列表投影零 UUID（后端 ComplianceObligationsService
// .toListItem 已保证）。模板：RegulatoryFilingListPage.tsx 的表格 + 弹层结构。
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Plus, RefreshCw, Zap } from 'lucide-react';
import { adminButtonClass, adminIconButtonClass } from '../components/common/adminButtonStyles';
import { PageTitleBar } from '../components/ui/PageTitleBar';
import { useAdminSession } from '../contexts/AdminSessionContext';
import { PERMISSIONS } from '../rbac/permissions';
import { AdminSessionError, adminFetch, getApiErrorMessage } from '../utils/adminFetch';
import { useSimulationMode } from '../utils/simulationMode';
import { AUTHORITY_LABEL, REGULATORY_AUTHORITIES } from '../utils/regulatoryFilingMap';

interface Item {
  obligationNo: string;
  name: string;
  description: string | null;
  frequency: string;
  authority: string;
  basisNote: string;
  leadBusinessDays: number;
  nextDueAt: string;
  status: string;
  lastFilingNo: string | null;
  createdAt: string;
}

const FREQUENCIES = ['MONTHLY', 'QUARTERLY', 'SEMIANNUAL', 'ANNUAL'] as const;
const FREQUENCY_LABEL: Record<string, string> = {
  MONTHLY: 'Monthly', QUARTERLY: 'Quarterly', SEMIANNUAL: 'Semi-annual', ANNUAL: 'Annual',
};

const STATUS_PILL_CLASS: Record<string, string> = {
  ACTIVE: 'bg-green-100 text-green-800',
  DISABLED: 'bg-gray-100 text-gray-600',
};

/** 建/改共用表单——nextDueAt 只在建档时可填（服务层 update 不接受它，各管各的，
 * 见 compliance-office.constants.ts UpdateObligationDto 头注释）。 */
const ObligationModal = ({
  mode, initial, open, onClose, onSaved,
}: {
  mode: 'create' | 'edit';
  initial?: Partial<Item> & { obligationNo?: string };
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [frequency, setFrequency] = useState<string>(FREQUENCIES[0]);
  const [authority, setAuthority] = useState<string>(REGULATORY_AUTHORITIES[0]);
  const [basisNote, setBasisNote] = useState('');
  const [leadBusinessDays, setLeadBusinessDays] = useState('5');
  const [nextDueAt, setNextDueAt] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setName(initial?.name ?? '');
    setDescription(initial?.description ?? '');
    setFrequency(initial?.frequency ?? FREQUENCIES[0]);
    setAuthority(initial?.authority ?? REGULATORY_AUTHORITIES[0]);
    setBasisNote(initial?.basisNote ?? '');
    setLeadBusinessDays(initial?.leadBusinessDays != null ? String(initial.leadBusinessDays) : '5');
    setNextDueAt('');
    setError('');
  }, [open, initial]);

  if (!open) return null;

  const submit = async () => {
    setError('');
    if (!name.trim()) { setError('Name is required'); return; }
    if (!basisNote.trim()) { setError('Basis note is required'); return; }
    if (mode === 'create' && !nextDueAt) { setError('Next due date is required'); return; }
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        name: name.trim(),
        description: description.trim() || undefined,
        frequency,
        authority,
        basisNote: basisNote.trim(),
        leadBusinessDays: leadBusinessDays ? Number(leadBusinessDays) : undefined,
      };
      let res;
      if (mode === 'create') {
        body.nextDueAt = new Date(nextDueAt).toISOString();
        res = await adminFetch(`${import.meta.env.VITE_API_URL}/admin/compliance-obligations`, {
          method: 'POST', body: JSON.stringify(body),
        });
      } else {
        res = await adminFetch(`${import.meta.env.VITE_API_URL}/admin/compliance-obligations/${encodeURIComponent(initial!.obligationNo!)}`, {
          method: 'PATCH', body: JSON.stringify(body),
        });
      }
      if (!res.ok) { setError(await getApiErrorMessage(res, 'Failed to save the obligation')); return; }
      onSaved();
    } catch (e) {
      if (e instanceof AdminSessionError) return;
      setError(e instanceof Error ? e.message : 'Failed to save the obligation');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="w-[540px] max-h-[85vh] overflow-y-auto rounded-lg border border-adm-border bg-adm-panel p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-3 text-sm font-semibold text-adm-t1">{mode === 'create' ? 'Register Obligation' : 'Update Obligation'}</h3>

        <label className="mb-3 block text-xs">Name
          <input value={name} onChange={(e) => setName(e.target.value)} className="mt-1 w-full rounded border border-adm-border bg-adm-panel px-2 py-1 text-xs" placeholder="e.g. VARA Monthly Regulatory Return" />
        </label>

        <label className="mb-3 block text-xs">Description (optional)
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className="mt-1 w-full rounded border border-adm-border bg-adm-panel px-2 py-1 text-xs" />
        </label>

        <div className="mb-3 grid grid-cols-2 gap-2">
          <label className="block text-xs">Frequency
            <select value={frequency} onChange={(e) => setFrequency(e.target.value)} className="mt-1 w-full rounded border border-adm-border bg-adm-panel px-2 py-1 text-xs">
              {FREQUENCIES.map((f) => <option key={f} value={f}>{FREQUENCY_LABEL[f]}</option>)}
            </select>
          </label>
          <label className="block text-xs">Authority
            <select value={authority} onChange={(e) => setAuthority(e.target.value)} className="mt-1 w-full rounded border border-adm-border bg-adm-panel px-2 py-1 text-xs">
              {REGULATORY_AUTHORITIES.map((a) => <option key={a} value={a}>{AUTHORITY_LABEL[a]}</option>)}
            </select>
          </label>
        </div>

        <label className="mb-3 block text-xs">Basis Note (rulebook citation)
          <input value={basisNote} onChange={(e) => setBasisNote(e.target.value)} className="mt-1 w-full rounded border border-adm-border bg-adm-panel px-2 py-1 text-xs" placeholder="e.g. CRM Rulebook Part I, Rule I.H.1" />
        </label>

        <div className="mb-3 grid grid-cols-2 gap-2">
          <label className="block text-xs">Lead Business Days
            <input type="number" min={0} value={leadBusinessDays} onChange={(e) => setLeadBusinessDays(e.target.value)} className="mt-1 w-full rounded border border-adm-border bg-adm-panel px-2 py-1 text-xs" />
          </label>
          {mode === 'create' && (
            <label className="block text-xs">Next Due At
              <input type="datetime-local" value={nextDueAt} onChange={(e) => setNextDueAt(e.target.value)} className="mt-1 w-full rounded border border-adm-border bg-adm-panel px-2 py-1 text-xs" />
            </label>
          )}
        </div>

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

const StatusConfirmModal = ({
  open, obligationNo, from, to, onClose, onConfirmed,
}: {
  open: boolean;
  obligationNo: string | null;
  from: string;
  to: string;
  onClose: () => void;
  onConfirmed: () => void;
}) => {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  if (!open || !obligationNo) return null;

  const confirm = async () => {
    setSubmitting(true);
    setError('');
    try {
      const res = await adminFetch(`${import.meta.env.VITE_API_URL}/admin/compliance-obligations/${encodeURIComponent(obligationNo)}/status`, {
        method: 'POST', body: JSON.stringify({ to }),
      });
      if (!res.ok) { setError(await getApiErrorMessage(res, 'Failed to change obligation status')); return; }
      onConfirmed();
    } catch (e) {
      if (e instanceof AdminSessionError) return;
      setError(e instanceof Error ? e.message : 'Failed to change obligation status');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="w-[420px] rounded-lg border border-adm-border bg-adm-panel p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-2 text-sm font-semibold text-adm-t1">{to === 'DISABLED' ? 'Disable Obligation' : 'Enable Obligation'}</h3>
        <p className="mb-3 text-xs text-adm-t2">
          {obligationNo} — {from} → {to}. {to === 'DISABLED' ? 'The clock wall will stop tracking this obligation.' : 'The clock wall will resume tracking this obligation.'}
        </p>
        {error && <p className="mb-2 text-xs text-adm-red">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={adminButtonClass('modalCancel')}>Cancel</button>
          <button type="button" disabled={submitting} onClick={() => void confirm()} className={adminButtonClass('modalConfirm')}>
            {submitting ? 'Working…' : 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  );
};

const ComplianceObligationListPage = () => {
  const { hasPermission } = useAdminSession();
  const { enabled: simEnabled } = useSimulationMode();
  const canWrite = hasPermission(PERMISSIONS.OBLIGATION_WRITE);
  const canSimulate = hasPermission(PERMISSIONS.DEMO_CLOCK_WRITE);
  const [searchParams] = useSearchParams();
  const highlight = searchParams.get('highlight');

  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState<{ mode: 'create' | 'edit'; item?: Item } | null>(null);
  const [statusTarget, setStatusTarget] = useState<Item | null>(null);
  const [simulatingNo, setSimulatingNo] = useState<string | null>(null);
  const [simError, setSimError] = useState('');
  const rowRefs = useRef<Map<string, HTMLTableRowElement>>(new Map());

  const fetchItems = async () => {
    setLoading(true);
    try {
      const res = await adminFetch(`${import.meta.env.VITE_API_URL}/admin/compliance-obligations`);
      if (!res.ok) { alert(await getApiErrorMessage(res, 'Failed to load compliance obligations')); return; }
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

  useEffect(() => {
    if (!highlight) return;
    const el = rowRefs.current.get(highlight);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [highlight, items]);

  const handleFastForwardDue = async (obligationNo: string) => {
    setSimulatingNo(obligationNo);
    setSimError('');
    try {
      const res = await adminFetch(`${import.meta.env.VITE_API_URL}/admin/compliance-obligations/${encodeURIComponent(obligationNo)}/simulate-due`, {
        method: 'POST',
      });
      if (!res.ok) { setSimError(await getApiErrorMessage(res, 'Failed to fast-forward this obligation')); return; }
      await fetchItems();
    } catch (e) {
      if (e instanceof AdminSessionError) return;
      setSimError(e instanceof Error ? e.message : 'Failed to fast-forward this obligation');
    } finally {
      setSimulatingNo(null);
    }
  };

  const canFastForward = useMemo(() => simEnabled && canSimulate, [simEnabled, canSimulate]);

  return (
    <div className="flex h-full flex-col">
      <PageTitleBar
        title="Compliance Obligations"
        subtitle="The periodic-obligation calendar — periodic regulatory returns and their recurring due dates"
        meta={`${items.length} obligation(s)`}
      >
        {canWrite && (
          <button type="button" onClick={() => setShowModal({ mode: 'create' })} className={adminButtonClass('listPrimary')}>
            <Plus size={13} /> Register Obligation
          </button>
        )}
        <button type="button" onClick={() => void fetchItems()} className={adminIconButtonClass()} title="Refresh">
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
        </button>
      </PageTitleBar>

      {simError && (
        <div className="shrink-0 border-b border-adm-border bg-adm-red/10 px-5 py-2 text-xs text-adm-red">{simError}</div>
      )}

      <div className="flex-1 overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-adm-panel">
            <tr className="border-b border-adm-border text-left text-adm-t3">
              {['Obligation No.', 'Name', 'Frequency', 'Authority', 'Next Due', 'Last Filing', 'Status', ''].map((h) => (
                <th key={h} className="px-4 py-2 font-mono text-[10px] uppercase tracking-wide">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr
                key={it.obligationNo}
                ref={(el) => { if (el) rowRefs.current.set(it.obligationNo, el); }}
                className={`border-b border-adm-border/60 ${highlight === it.obligationNo ? 'bg-adm-amber/15' : ''}`}
              >
                <td className="px-4 py-2 font-mono text-adm-blue">{it.obligationNo}</td>
                <td className="px-4 py-2">{it.name}</td>
                <td className="px-4 py-2">{FREQUENCY_LABEL[it.frequency] ?? it.frequency}</td>
                <td className="px-4 py-2">{AUTHORITY_LABEL[it.authority] ?? it.authority}</td>
                <td className="px-4 py-2 font-mono">{new Date(it.nextDueAt).toLocaleString()}</td>
                <td className="px-4 py-2 font-mono">
                  {it.lastFilingNo ? (
                    <Link to={`/admin/governance/regulatory-filings/${encodeURIComponent(it.lastFilingNo)}`} className="text-adm-blue hover:underline">
                      {it.lastFilingNo}
                    </Link>
                  ) : '—'}
                </td>
                <td className="px-4 py-2">
                  <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${STATUS_PILL_CLASS[it.status] ?? 'bg-gray-100 text-gray-600'}`}>
                    {it.status}
                  </span>
                </td>
                <td className="px-4 py-2 text-right">
                  <div className="flex items-center justify-end gap-2">
                    {canFastForward && it.status === 'ACTIVE' && (
                      <button
                        type="button"
                        disabled={simulatingNo === it.obligationNo}
                        onClick={() => void handleFastForwardDue(it.obligationNo)}
                        className="inline-flex items-center gap-1 rounded border border-amber-300 px-2 py-1 font-mono text-[10px] text-amber-700 hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-50"
                        title="Fast-forward this obligation's next due date to now (demo only)"
                      >
                        <Zap size={11} />
                        {simulatingNo === it.obligationNo ? 'Working…' : 'Fast-forward due'}
                      </button>
                    )}
                    {canWrite && (
                      <>
                        <button type="button" onClick={() => setShowModal({ mode: 'edit', item: it })} className={adminButtonClass('rowSecondaryUtility')}>
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => setStatusTarget(it)}
                          className={adminButtonClass('rowSecondaryUtility')}
                        >
                          {it.status === 'ACTIVE' ? 'Disable' : 'Enable'}
                        </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {!loading && items.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-adm-t3">
                  No compliance obligations registered yet — click "Register Obligation" to add the first one
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <ObligationModal
        mode={showModal?.mode ?? 'create'}
        initial={showModal?.item}
        open={!!showModal}
        onClose={() => setShowModal(null)}
        onSaved={() => { setShowModal(null); void fetchItems(); }}
      />

      <StatusConfirmModal
        open={!!statusTarget}
        obligationNo={statusTarget?.obligationNo ?? null}
        from={statusTarget?.status ?? ''}
        to={statusTarget?.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE'}
        onClose={() => setStatusTarget(null)}
        onConfirmed={() => { setStatusTarget(null); void fetchItems(); }}
      />
    </div>
  );
};

export default ComplianceObligationListPage;
