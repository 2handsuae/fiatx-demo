// admin-web/src/pages/IncidentListPage.tsx
// 平账三期 · 事故登记：列表 + 人工登记入口（四入口之一，另三个在案子详情页，Task 12）。
// 铁律⑥：列表投影零 UUID（后端 IncidentService.list 已保证）。
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
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

/** 人工登记表单（四入口的第四个：治理台空表单，类型手选，来源案号为空）。
 * 另三个入口（案子定性升级 / 大额到线 / 退汇欠款）在案子详情页，Task 12。 */
const NewIncidentModal = ({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (incidentNo: string) => void }) => {
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

  if (!open) return null;

  const reset = () => {
    setType('MANUAL'); setTitle(''); setDescription('');
    setSourceCaseNo(''); setSourceDispositionNo(''); setSourceAdvanceTransferNo('');
    setCustomerNo(''); setAssetCode(''); setAmount(''); setError('');
  };

  const close = () => { reset(); onClose(); };

  const submit = async () => {
    setError('');
    if (!title.trim() || !description.trim()) { setError('标题与说明必填'); return; }
    if ((type === 'UNAUTHORIZED_OUTFLOW' || type === 'LARGE_UNEXPLAINED') && !sourceCaseNo.trim()) {
      setError('该类型必须带来源案号'); return;
    }
    if (type === 'UNAUTHORIZED_OUTFLOW' && !sourceDispositionNo.trim()) {
      setError('未授权转出必须带来源定性行号'); return;
    }
    if (type === 'CLIENT_SHORTFALL' && (!customerNo.trim() || !amount.trim())) {
      setError('退汇欠款必须带客户号与金额'); return;
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
      if (!res.ok) { setError(await getApiErrorMessage(res, '登记失败')); return; }
      const data = await res.json();
      reset();
      onCreated(data.incidentNo as string);
    } catch (e) {
      if (e instanceof AdminSessionError) return;
      setError(e instanceof Error ? e.message : '登记失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={close}>
      <div className="w-[560px] max-h-[85vh] overflow-y-auto rounded-lg border border-adm-border bg-adm-panel p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-3 text-sm font-semibold text-adm-t1">登记事故</h3>

        <label className="mb-3 block text-xs">类型
          <select value={type} onChange={(e) => setType(e.target.value)} className="mt-1 w-full rounded border border-adm-border bg-adm-panel px-2 py-1 text-xs">
            {INCIDENT_TYPES.map((t) => <option key={t} value={t}>{INCIDENT_TYPE_LABEL[t]}</option>)}
          </select>
        </label>

        <label className="mb-3 block text-xs">标题
          <input value={title} onChange={(e) => setTitle(e.target.value)} className="mt-1 w-full rounded border border-adm-border bg-adm-panel px-2 py-1 text-xs" placeholder="例：客户钱包幽灵 OUT" />
        </label>

        <label className="mb-3 block text-xs">说明
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className="mt-1 w-full rounded border border-adm-border bg-adm-panel px-2 py-1 text-xs" placeholder="发生了什么" />
        </label>

        {(type === 'UNAUTHORIZED_OUTFLOW' || type === 'LARGE_UNEXPLAINED') && (
          <label className="mb-3 block text-xs">来源案号
            <input value={sourceCaseNo} onChange={(e) => setSourceCaseNo(e.target.value)} className="mt-1 w-full rounded border border-adm-border bg-adm-panel px-2 py-1 text-xs font-mono" placeholder="CASE-…" />
          </label>
        )}
        {type === 'UNAUTHORIZED_OUTFLOW' && (
          <label className="mb-3 block text-xs">来源定性行号
            <input value={sourceDispositionNo} onChange={(e) => setSourceDispositionNo(e.target.value)} className="mt-1 w-full rounded border border-adm-border bg-adm-panel px-2 py-1 text-xs font-mono" placeholder="DISP-…" />
          </label>
        )}
        {type === 'CLIENT_SHORTFALL' && (
          <label className="mb-3 block text-xs">来源垫款单号（选填，若已存在）
            <input value={sourceAdvanceTransferNo} onChange={(e) => setSourceAdvanceTransferNo(e.target.value)} className="mt-1 w-full rounded border border-adm-border bg-adm-panel px-2 py-1 text-xs font-mono" placeholder="TRF-…" />
          </label>
        )}

        <div className="mb-3 grid grid-cols-3 gap-2">
          <label className="block text-xs">客户号{type === 'CLIENT_SHORTFALL' ? '*' : '（选填）'}
            <input value={customerNo} onChange={(e) => setCustomerNo(e.target.value)} className="mt-1 w-full rounded border border-adm-border bg-adm-panel px-2 py-1 text-xs font-mono" />
          </label>
          <label className="block text-xs">资产（选填）
            <input value={assetCode} onChange={(e) => setAssetCode(e.target.value)} className="mt-1 w-full rounded border border-adm-border bg-adm-panel px-2 py-1 text-xs font-mono" />
          </label>
          <label className="block text-xs">金额{type === 'CLIENT_SHORTFALL' ? '*' : '（选填）'}
            <input value={amount} onChange={(e) => setAmount(e.target.value)} className="mt-1 w-full rounded border border-adm-border bg-adm-panel px-2 py-1 text-xs font-mono" />
          </label>
        </div>

        {error && <p className="mb-2 text-xs text-adm-red">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={close} className={adminButtonClass('modalCancel')}>取消</button>
          <button type="button" disabled={submitting} onClick={() => void submit()} className={adminButtonClass('modalConfirm')}>
            {submitting ? '提交中…' : '登记'}
          </button>
        </div>
      </div>
    </div>
  );
};

const IncidentListPage = () => {
  const navigate = useNavigate();
  const { hasPermission } = useAdminSession();
  const canWrite = hasPermission(PERMISSIONS.INCIDENT_WRITE);
  const [items, setItems] = useState<Item[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [type, setType] = useState('');
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);

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
        title="Incident Register · 事故登记"
        subtitle="出了事怎么交代——调查、定损、善后、监管通报留痕，零账务"
        meta={`${total} incident(s)`}
      >
        {canWrite && (
          <button type="button" onClick={() => setShowNew(true)} className={adminButtonClass('listPrimary')}>
            <Plus size={13} /> 登记事故
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
              {['单号', '类型', '状态', '金额', '来源案号', '通报状态', '时限倒计时'].map((h) => (
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
                  还没有事故——从对账案子定性升级，或点「登记事故」人工登记
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Pagination currentPage={page} totalItems={total} pageSize={PAGE_SIZE} onPageChange={(p) => void fetchItems(p)} />

      <NewIncidentModal
        open={showNew}
        onClose={() => setShowNew(false)}
        onCreated={(incidentNo) => { setShowNew(false); navigate(`/admin/governance/incidents/${encodeURIComponent(incidentNo)}`); }}
      />
    </div>
  );
};

export default IncidentListPage;
