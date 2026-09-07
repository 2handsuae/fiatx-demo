// admin-web/src/pages/IncidentListPage.tsx
// 平账三期 · 事故登记：列表 + 人工登记入口（四入口之一，另三个在案子详情页，Task 12）。
// 铁律⑥：列表投影零 UUID（后端 IncidentService.list 已保证）。
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Plus, RefreshCw } from 'lucide-react';
import Pagination from '../components/common/Pagination';
import { adminButtonClass, adminIconButtonClass } from '../components/common/adminButtonStyles';
import { PageTitleBar } from '../components/ui/PageTitleBar';
import { StatusPill } from '../components/ui/StatusPill';
import { useAdminSession } from '../contexts/AdminSessionContext';
import { PERMISSIONS } from '../rbac/permissions';
import { AdminSessionError, adminFetch, getApiErrorMessage } from '../utils/adminFetch';
import {
  INCIDENT_STATUS_LABEL,
  INCIDENT_STATUSES,
  INCIDENT_TYPE_LABEL,
  INCIDENT_TYPES,
  REPORT_DEADLINE_TONE_CLASS,
  reportDeadlineDisplay,
  reportStatusLabel,
} from '../utils/incidentStatusMap';

interface Item {
  incidentNo: string;
  type: string;
  status: string;
  title: string;
  customerNo: string | null;
  assetCode: string | null;
  amount: string | null;
  sourceCaseNo: string | null;
  reportRequired: boolean;
  reportedAt: string | null;
  reportDeadlineAt: string | null;
  createdAt: string;
}

const PAGE_SIZE = 20;

/** Task 12：案子详情页三入口跳转过来的预填——业务键 only（铁律⑥）。钱包 / 账单行
 * 参考号在这份表单里没有专用字段，由调用方拼进 description（人读、可编辑），不当
 * 结构化字段传。 */
export interface NewIncidentPrefill {
  type?: string; title?: string; description?: string;
  sourceCaseNo?: string; sourceDispositionNo?: string; sourceAdvanceTransferNo?: string;
  customerNo?: string; assetCode?: string; amount?: string;
}

/** 人工登记表单（四入口的第四个：治理台空表单，类型手选，来源案号为空；
 * 另三个入口——案子定性升级 / 大额到线 / 退汇欠款——在案子详情页，通过 `prefill`
 * 带着业务键跳到这里，Task 12）。 */
const NewIncidentModal = ({ open, prefill, onClose, onCreated }: { open: boolean; prefill?: NewIncidentPrefill; onClose: () => void; onCreated: (incidentNo: string) => void }) => {
  const [type, setType] = useState<string>('MANUAL');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [sourceCaseNo, setSourceCaseNo] = useState('');
  const [sourceDispositionNo, setSourceDispositionNo] = useState('');
  const [sourceAdvanceTransferNo, setSourceAdvanceTransferNo] = useState('');
  const [customerNo, setCustomerNo] = useState('');
  const [assetCode, setAssetCode] = useState('');
  const [amount, setAmount] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Task 12：每次打开都按 prefill 重新灌一遍字段——同一个弹层实例在案子页跳转
  // 之间复用，不重置就会把上一次的预填带进下一次打开。
  useEffect(() => {
    if (!open) return;
    setType(prefill?.type ?? 'MANUAL');
    setTitle(prefill?.title ?? '');
    setDescription(prefill?.description ?? '');
    setSourceCaseNo(prefill?.sourceCaseNo ?? '');
    setSourceDispositionNo(prefill?.sourceDispositionNo ?? '');
    setSourceAdvanceTransferNo(prefill?.sourceAdvanceTransferNo ?? '');
    setCustomerNo(prefill?.customerNo ?? '');
    setAssetCode(prefill?.assetCode ?? '');
    setAmount(prefill?.amount ?? '');
    setError('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, prefill]);

  if (!open) return null;

  const reset = () => {
    setType('MANUAL'); setTitle(''); setDescription('');
    setSourceCaseNo(''); setSourceDispositionNo(''); setSourceAdvanceTransferNo('');
    setCustomerNo(''); setAssetCode(''); setAmount(''); setError('');
  };

  const close = () => { reset(); onClose(); };

  const submit = async () => {
    setError('');
    if (!title.trim() || !description.trim()) { setError('Title and description are required'); return; }
    if ((type === 'UNAUTHORIZED_OUTFLOW' || type === 'LARGE_UNEXPLAINED') && !sourceCaseNo.trim()) {
      setError('This type requires a source case number'); return;
    }
    if (type === 'UNAUTHORIZED_OUTFLOW' && !sourceDispositionNo.trim()) {
      setError('Unauthorized outflow requires a source disposition line number'); return;
    }
    if (type === 'CLIENT_SHORTFALL' && (!customerNo.trim() || !amount.trim())) {
      setError('Client shortfall requires a customer number and amount'); return;
    }
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = { type, title: title.trim(), description: description.trim() };
      if (sourceCaseNo.trim()) body.sourceCaseNo = sourceCaseNo.trim();
      if (sourceDispositionNo.trim()) body.sourceDispositionNo = sourceDispositionNo.trim();
      if (sourceAdvanceTransferNo.trim()) body.sourceAdvanceTransferNo = sourceAdvanceTransferNo.trim();
      if (customerNo.trim()) body.customerNo = customerNo.trim();
      if (assetCode.trim()) body.assetCode = assetCode.trim();
      if (amount.trim()) body.amount = amount.trim();
      const res = await adminFetch(`${import.meta.env.VITE_API_URL}/admin/incidents`, {
        method: 'POST', body: JSON.stringify(body),
      });
      if (!res.ok) { setError(await getApiErrorMessage(res, 'Registration failed')); return; }
      const data = await res.json();
      reset();
      onCreated(data.incidentNo as string);
    } catch (e) {
      if (e instanceof AdminSessionError) return;
      setError(e instanceof Error ? e.message : 'Registration failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={close}>
      <div className="w-[560px] max-h-[85vh] overflow-y-auto rounded-lg border border-adm-border bg-adm-panel p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-3 text-sm font-semibold text-adm-t1">Register Incident</h3>

        <label className="mb-3 block text-xs">Type
          <select value={type} onChange={(e) => setType(e.target.value)} className="mt-1 w-full rounded border border-adm-border bg-adm-panel px-2 py-1 text-xs">
            {INCIDENT_TYPES.map((t) => <option key={t} value={t}>{INCIDENT_TYPE_LABEL[t]}</option>)}
          </select>
        </label>

        <label className="mb-3 block text-xs">Title
          <input value={title} onChange={(e) => setTitle(e.target.value)} className="mt-1 w-full rounded border border-adm-border bg-adm-panel px-2 py-1 text-xs" placeholder="e.g. Customer wallet ghost OUT" />
        </label>

        <label className="mb-3 block text-xs">Description
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className="mt-1 w-full rounded border border-adm-border bg-adm-panel px-2 py-1 text-xs" placeholder="What happened" />
        </label>

        {(type === 'UNAUTHORIZED_OUTFLOW' || type === 'LARGE_UNEXPLAINED') && (
          <label className="mb-3 block text-xs">Source Case No
            <input value={sourceCaseNo} onChange={(e) => setSourceCaseNo(e.target.value)} className="mt-1 w-full rounded border border-adm-border bg-adm-panel px-2 py-1 text-xs font-mono" placeholder="CASE-…" />
          </label>
        )}
        {type === 'UNAUTHORIZED_OUTFLOW' && (
          <label className="mb-3 block text-xs">Source Disposition Line No
            <input value={sourceDispositionNo} onChange={(e) => setSourceDispositionNo(e.target.value)} className="mt-1 w-full rounded border border-adm-border bg-adm-panel px-2 py-1 text-xs font-mono" placeholder="DISP-…" />
          </label>
        )}
        {type === 'CLIENT_SHORTFALL' && (
          <label className="mb-3 block text-xs">Source Advance Transfer No (optional, if one already exists)
            <input value={sourceAdvanceTransferNo} onChange={(e) => setSourceAdvanceTransferNo(e.target.value)} className="mt-1 w-full rounded border border-adm-border bg-adm-panel px-2 py-1 text-xs font-mono" placeholder="TRF-…" />
          </label>
        )}

        <div className="mb-3 grid grid-cols-3 gap-2">
          <label className="block text-xs">Customer No{type === 'CLIENT_SHORTFALL' ? '*' : ' (optional)'}
            <input value={customerNo} onChange={(e) => setCustomerNo(e.target.value)} className="mt-1 w-full rounded border border-adm-border bg-adm-panel px-2 py-1 text-xs font-mono" />
          </label>
          <label className="block text-xs">Asset (optional)
            <input value={assetCode} onChange={(e) => setAssetCode(e.target.value)} className="mt-1 w-full rounded border border-adm-border bg-adm-panel px-2 py-1 text-xs font-mono" />
          </label>
          <label className="block text-xs">Amount{type === 'CLIENT_SHORTFALL' ? '*' : ' (optional)'}
            <input value={amount} onChange={(e) => setAmount(e.target.value)} className="mt-1 w-full rounded border border-adm-border bg-adm-panel px-2 py-1 text-xs font-mono" />
          </label>
        </div>

        {error && <p className="mb-2 text-xs text-adm-red">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={close} className={adminButtonClass('modalCancel')}>Cancel</button>
          <button type="button" disabled={submitting} onClick={() => void submit()} className={adminButtonClass('modalConfirm')}>
            {submitting ? 'Submitting…' : 'Register'}
          </button>
        </div>
      </div>
    </div>
  );
};

const IncidentListPage = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { hasPermission } = useAdminSession();
  const canWrite = hasPermission(PERMISSIONS.INCIDENT_WRITE);
  const [items, setItems] = useState<Item[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [type, setType] = useState('');
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  // Task 12：案子详情页三入口带 query 跳过来的预填——存在 type 就当作是跳转
  // 过来的，直接开弹层，不用再让人自己点「登记事故」。
  const [newPrefill, setNewPrefill] = useState<NewIncidentPrefill | undefined>(undefined);

  useEffect(() => {
    const qType = searchParams.get('type');
    if (!qType) return;
    setNewPrefill({
      type: qType,
      title: searchParams.get('title') ?? undefined,
      description: searchParams.get('description') ?? undefined,
      sourceCaseNo: searchParams.get('sourceCaseNo') ?? undefined,
      sourceDispositionNo: searchParams.get('sourceDispositionNo') ?? undefined,
      sourceAdvanceTransferNo: searchParams.get('sourceAdvanceTransferNo') ?? undefined,
      customerNo: searchParams.get('customerNo') ?? undefined,
      assetCode: searchParams.get('assetCode') ?? undefined,
      amount: searchParams.get('amount') ?? undefined,
    });
    setShowNew(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchItems = async (nextPage = page, nextStatus = status, nextType = type) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        skip: String((nextPage - 1) * PAGE_SIZE),
        take: String(PAGE_SIZE),
      });
      if (nextStatus) params.set('status', nextStatus);
      if (nextType) params.set('type', nextType);
      const res = await adminFetch(`${import.meta.env.VITE_API_URL}/admin/incidents?${params.toString()}`);
      if (!res.ok) {
        alert(await getApiErrorMessage(res, 'Failed to load incidents'));
        return;
      }
      const data = await res.json();
      setItems(data.items ?? []);
      setTotal(data.total ?? 0);
      setPage(nextPage);
    } catch (e) {
      if (e instanceof AdminSessionError) return;
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchItems(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex h-full flex-col">
      <PageTitleBar
        title="Incident Register"
        subtitle="How incidents get accounted for — investigation, assessment, remediation, and regulatory reporting on record; zero accounting impact"
        meta={`${total} incident(s)`}
      >
        {canWrite && (
          <button type="button" onClick={() => { setNewPrefill(undefined); setShowNew(true); }} className={adminButtonClass('listPrimary')}>
            <Plus size={13} /> Register Incident
          </button>
        )}
        <button type="button" onClick={() => void fetchItems(page)} className={adminIconButtonClass()} title="Refresh">
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
        </button>
      </PageTitleBar>

      <div className="flex gap-2 border-b border-adm-border px-5 py-2 text-xs">
        <select
          value={status}
          onChange={(e) => { setStatus(e.target.value); void fetchItems(1, e.target.value, type); }}
          className="rounded border border-adm-border bg-adm-panel px-2 py-1"
        >
          <option value="">All statuses</option>
          {INCIDENT_STATUSES.map((s) => <option key={s} value={s}>{INCIDENT_STATUS_LABEL[s]}</option>)}
        </select>
        <select
          value={type}
          onChange={(e) => { setType(e.target.value); void fetchItems(1, status, e.target.value); }}
          className="rounded border border-adm-border bg-adm-panel px-2 py-1"
        >
          <option value="">All types</option>
          {INCIDENT_TYPES.map((t) => <option key={t} value={t}>{INCIDENT_TYPE_LABEL[t]}</option>)}
        </select>
      </div>

      <div className="flex-1 overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-adm-panel">
            <tr className="border-b border-adm-border text-left text-adm-t3">
              {['No.', 'Type', 'Status', 'Amount', 'Source Case', 'Report Status', 'Deadline'].map((h) => (
                <th key={h} className="px-4 py-2 font-mono text-[10px] uppercase tracking-wide">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((it) => {
              const deadline = reportDeadlineDisplay(it.reportDeadlineAt, it.reportedAt);
              return (
                <tr
                  key={it.incidentNo}
                  onClick={() => navigate(`/admin/governance/incidents/${encodeURIComponent(it.incidentNo)}`)}
                  className="cursor-pointer border-b border-adm-border/60 hover:bg-adm-hover/40"
                >
                  <td className="px-4 py-2 font-mono text-adm-blue">{it.incidentNo}</td>
                  <td className="px-4 py-2">{INCIDENT_TYPE_LABEL[it.type] ?? it.type}</td>
                  <td className="px-4 py-2"><StatusPill value={it.status} /></td>
                  <td className="px-4 py-2 font-mono">{it.amount != null ? `${it.amount} ${it.assetCode ?? ''}` : '—'}</td>
                  <td className="px-4 py-2 font-mono">{it.sourceCaseNo ?? '—'}</td>
                  <td className="px-4 py-2">{reportStatusLabel(it.reportRequired, it.reportedAt)}</td>
                  <td className="px-4 py-2">
                    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${REPORT_DEADLINE_TONE_CLASS[deadline.tone]}`}>
                      {deadline.text}
                    </span>
                  </td>
                </tr>
              );
            })}
            {!loading && items.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-adm-t3">
                  No incidents yet — escalate from a reconciliation case's disposition, or click "Register Incident" to register one manually
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Pagination currentPage={page} totalItems={total} pageSize={PAGE_SIZE} onPageChange={(p) => void fetchItems(p)} />

      <NewIncidentModal
        open={showNew}
        prefill={newPrefill}
        onClose={() => setShowNew(false)}
        onCreated={(incidentNo) => { setShowNew(false); navigate(`/admin/governance/incidents/${encodeURIComponent(incidentNo)}`); }}
      />
    </div>
  );
};

export default IncidentListPage;
