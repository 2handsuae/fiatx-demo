// admin-web/src/pages/RegulatoryFilingListPage.tsx
// 战役甲波二 · 报送台骨架（Task 9）：报送单列表 + 手工开单入口。
// 铁律⑥：列表投影零 UUID（后端 RegulatoryFilingService.list 已保证）。
// 模板：IncidentListPage.tsx 的表格 + 弹层结构。
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, RefreshCw } from 'lucide-react';
import { adminButtonClass, adminIconButtonClass } from '../components/common/adminButtonStyles';
import { PageTitleBar } from '../components/ui/PageTitleBar';
import { StatusPill } from '../components/ui/StatusPill';
import { useAdminSession } from '../contexts/AdminSessionContext';
import { PERMISSIONS } from '../rbac/permissions';
import { AdminSessionError, adminFetch, getApiErrorMessage } from '../utils/adminFetch';
import { INCIDENT_REPORT_BASES } from '../utils/incidentStatusMap';
import {
  AUTHORITY_LABEL,
  FILING_STATUS_LABEL,
  FILING_STATUSES,
  FILING_TYPE_LABEL,
  FILING_TYPE_MIRROR,
  FILING_TYPES,
  REGULATORY_AUTHORITIES,
  REPORT_DEADLINE_TONE_CLASS,
  reportBasisClockText,
  reportDeadlineDisplay,
} from '../utils/regulatoryFilingMap';

interface Item {
  filingNo: string;
  direction: string;
  type: string;
  status: string;
  authority: string;
  ccAuthorities: string[];
  basisCode: string | null;
  incidentNo: string | null;
  title: string;
  receivedAt: string | null;
  deadlineAt: string | null;
  externalRef: string | null;
  submittedAt: string | null;
  overdueMarkedAt: string | null;
  createdAt: string;
}

/** 手工开单弹窗——受控枚举纪律（Ruling-14）：authority/basisCode/entry kind 全下拉受控，
 * 零自由文本机构（spec §9）。字段显隐按类型注册表四格（direction/requiresIncident）决定：
 * INCIDENT_REPORT 显 incidentNo + basisCode；INBOUND（REG_INFO_REQUEST_RESPONSE）显
 * receivedAt + authority；双头类（MARKET_OFFENCE_DUAL_REPORT）显 ccAuthorities 多选。 */
const OpenFilingModal = ({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (filingNo: string) => void }) => {
  const [type, setType] = useState<string>(FILING_TYPES[0]);
  const [title, setTitle] = useState('');
  const [incidentNo, setIncidentNo] = useState('');
  const [basisCode, setBasisCode] = useState<string>(Object.keys(INCIDENT_REPORT_BASES)[0]);
  const [receivedAt, setReceivedAt] = useState('');
  const [authority, setAuthority] = useState<string>(REGULATORY_AUTHORITIES[0]);
  const [ccAuthorities, setCcAuthorities] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setType(FILING_TYPES[0]);
    setTitle('');
    setIncidentNo('');
    setBasisCode(Object.keys(INCIDENT_REPORT_BASES)[0]);
    setReceivedAt('');
    setAuthority(REGULATORY_AUTHORITIES[0]);
    setCcAuthorities([]);
    setError('');
  }, [open]);

  if (!open) return null;

  const cfg = FILING_TYPE_MIRROR[type];
  const isDualHeaded = type === 'MARKET_OFFENCE_DUAL_REPORT';

  const toggleCc = (code: string) => {
    setCcAuthorities((prev) => (prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]));
  };

  const close = () => { onClose(); };

  const submit = async () => {
    setError('');
    if (!title.trim()) { setError('Title is required'); return; }
    if (cfg.requiresIncident && !incidentNo.trim()) { setError('Incident No is required for this filing type'); return; }
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = { type, title: title.trim() };
      if (cfg.requiresIncident) {
        body.incidentNo = incidentNo.trim();
        body.basisCode = basisCode;
      }
      if (cfg.direction === 'INBOUND') {
        body.authority = authority;
        if (receivedAt) body.receivedAt = new Date(receivedAt).toISOString();
      }
      if (isDualHeaded && ccAuthorities.length > 0) {
        body.ccAuthorities = ccAuthorities;
      }
      const res = await adminFetch(`${import.meta.env.VITE_API_URL}/admin/regulatory-filings`, {
        method: 'POST', body: JSON.stringify(body),
      });
      if (!res.ok) { setError(await getApiErrorMessage(res, 'Failed to open filing')); return; }
      const data = await res.json();
      onCreated(data.filingNo as string);
    } catch (e) {
      if (e instanceof AdminSessionError) return;
      setError(e instanceof Error ? e.message : 'Failed to open filing');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={close}>
      <div className="w-[540px] max-h-[85vh] overflow-y-auto rounded-lg border border-adm-border bg-adm-panel p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-3 text-sm font-semibold text-adm-t1">Open Filing</h3>

        <label className="mb-3 block text-xs">Type
          <select value={type} onChange={(e) => setType(e.target.value)} className="mt-1 w-full rounded border border-adm-border bg-adm-panel px-2 py-1 text-xs">
            {FILING_TYPES.map((t) => <option key={t} value={t}>{FILING_TYPE_LABEL[t]}</option>)}
          </select>
        </label>

        <label className="mb-3 block text-xs">Title
          <input value={title} onChange={(e) => setTitle(e.target.value)} className="mt-1 w-full rounded border border-adm-border bg-adm-panel px-2 py-1 text-xs" placeholder="e.g. Material Client VA discrepancy report" />
        </label>

        {cfg.requiresIncident && (
          <>
            <label className="mb-3 block text-xs">Incident No
              <input value={incidentNo} onChange={(e) => setIncidentNo(e.target.value)} className="mt-1 w-full rounded border border-adm-border bg-adm-panel px-2 py-1 text-xs font-mono" placeholder="INC-…" />
            </label>
            <label className="mb-3 block text-xs">Report Basis
              <select value={basisCode} onChange={(e) => setBasisCode(e.target.value)} className="mt-1 w-full rounded border border-adm-border bg-adm-panel px-2 py-1 text-xs">
                {Object.keys(INCIDENT_REPORT_BASES).map((code) => (
                  <option key={code} value={code}>{INCIDENT_REPORT_BASES[code].label}</option>
                ))}
              </select>
              <span className="mt-1 block font-mono text-[10px] text-adm-amber">{reportBasisClockText(basisCode)}</span>
            </label>
          </>
        )}

        {cfg.direction === 'INBOUND' && (
          <div className="mb-3 grid grid-cols-2 gap-2">
            <label className="block text-xs">Authority
              <select value={authority} onChange={(e) => setAuthority(e.target.value)} className="mt-1 w-full rounded border border-adm-border bg-adm-panel px-2 py-1 text-xs">
                {REGULATORY_AUTHORITIES.map((a) => <option key={a} value={a}>{AUTHORITY_LABEL[a]}</option>)}
              </select>
            </label>
            <label className="block text-xs">Received At (optional)
              <input type="datetime-local" value={receivedAt} onChange={(e) => setReceivedAt(e.target.value)} className="mt-1 w-full rounded border border-adm-border bg-adm-panel px-2 py-1 text-xs" />
            </label>
          </div>
        )}

        {isDualHeaded && (
          <div className="mb-3">
            <p className="mb-1 font-mono text-[9px] uppercase tracking-[0.1em] text-adm-t3">CC Authorities (optional, multi-select)</p>
            <div className="flex flex-wrap gap-2">
              {REGULATORY_AUTHORITIES.map((a) => (
                <label key={a} className="flex items-center gap-1 text-[11px]">
                  <input type="checkbox" checked={ccAuthorities.includes(a)} onChange={() => toggleCc(a)} />
                  {AUTHORITY_LABEL[a]}
                </label>
              ))}
            </div>
          </div>
        )}

        {error && <p className="mb-2 text-xs text-adm-red">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={close} className={adminButtonClass('modalCancel')}>Cancel</button>
          <button type="button" disabled={submitting} onClick={() => void submit()} className={adminButtonClass('modalConfirm')}>
            {submitting ? 'Opening…' : 'Open Filing'}
          </button>
        </div>
      </div>
    </div>
  );
};

const RegulatoryFilingListPage = () => {
  const navigate = useNavigate();
  const { hasPermission } = useAdminSession();
  const canWrite = hasPermission(PERMISSIONS.REG_FILING_WRITE);
  const [items, setItems] = useState<Item[]>([]);
  const [status, setStatus] = useState('');
  const [type, setType] = useState('');
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);

  const fetchItems = async (nextStatus = status, nextType = type) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (nextStatus) params.set('status', nextStatus);
      if (nextType) params.set('type', nextType);
      const qs = params.toString();
      const res = await adminFetch(`${import.meta.env.VITE_API_URL}/admin/regulatory-filings${qs ? `?${qs}` : ''}`);
      if (!res.ok) {
        alert(await getApiErrorMessage(res, 'Failed to load regulatory filings'));
        return;
      }
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
      <PageTitleBar
        title="Regulatory Filings"
        subtitle="The compliance desk's filing tracker — incident reports, regulator correspondence, and standing notifications, all on one clock"
        meta={`${items.length} filing(s)`}
      >
        {canWrite && (
          <button type="button" onClick={() => setShowNew(true)} className={adminButtonClass('listPrimary')}>
            <Plus size={13} /> Open Filing
          </button>
        )}
        <button type="button" onClick={() => void fetchItems()} className={adminIconButtonClass()} title="Refresh">
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
        </button>
      </PageTitleBar>

      <div className="flex gap-2 border-b border-adm-border px-5 py-2 text-xs">
        <select
          value={status}
          onChange={(e) => { setStatus(e.target.value); void fetchItems(e.target.value, type); }}
          className="rounded border border-adm-border bg-adm-panel px-2 py-1"
        >
          <option value="">All statuses</option>
          {FILING_STATUSES.map((s) => <option key={s} value={s}>{FILING_STATUS_LABEL[s]}</option>)}
        </select>
        <select
          value={type}
          onChange={(e) => { setType(e.target.value); void fetchItems(status, e.target.value); }}
          className="rounded border border-adm-border bg-adm-panel px-2 py-1"
        >
          <option value="">All types</option>
          {FILING_TYPES.map((t) => <option key={t} value={t}>{FILING_TYPE_LABEL[t]}</option>)}
        </select>
      </div>

      <div className="flex-1 overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-adm-panel">
            <tr className="border-b border-adm-border text-left text-adm-t3">
              {['Filing No.', 'Type', 'Direction', 'Authority', 'Status', 'Deadline', 'Incident'].map((h) => (
                <th key={h} className="px-4 py-2 font-mono text-[10px] uppercase tracking-wide">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((it) => {
              const deadline = reportDeadlineDisplay(it.deadlineAt, it.submittedAt, it.overdueMarkedAt, it.basisCode);
              return (
                <tr
                  key={it.filingNo}
                  onClick={() => navigate(`/admin/governance/regulatory-filings/${encodeURIComponent(it.filingNo)}`)}
                  className={`cursor-pointer border-b border-adm-border/60 hover:bg-adm-hover/40 ${it.overdueMarkedAt ? 'bg-adm-red/10' : ''}`}
                >
                  <td className="px-4 py-2 font-mono text-adm-blue">{it.filingNo}</td>
                  <td className="px-4 py-2">{FILING_TYPE_LABEL[it.type] ?? it.type}</td>
                  <td className="px-4 py-2">{it.direction === 'INBOUND' ? 'Inbound' : 'Outbound'}</td>
                  <td className="px-4 py-2">{AUTHORITY_LABEL[it.authority] ?? it.authority}</td>
                  <td className="px-4 py-2"><StatusPill value={it.status} /></td>
                  <td className="px-4 py-2">
                    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${REPORT_DEADLINE_TONE_CLASS[deadline.tone]}`}>
                      {deadline.text}
                    </span>
                  </td>
                  <td className="px-4 py-2 font-mono">
                    {it.incidentNo ? (
                      <Link
                        to={`/admin/governance/incidents/${encodeURIComponent(it.incidentNo)}`}
                        onClick={(e) => e.stopPropagation()}
                        className="text-adm-blue hover:underline"
                      >
                        {it.incidentNo}
                      </Link>
                    ) : '—'}
                  </td>
                </tr>
              );
            })}
            {!loading && items.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-adm-t3">
                  No regulatory filings yet — filings open automatically when an incident assessment requires reporting, or click "Open Filing" to open one manually
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <OpenFilingModal
        open={showNew}
        onClose={() => setShowNew(false)}
        onCreated={(filingNo) => { setShowNew(false); navigate(`/admin/governance/regulatory-filings/${encodeURIComponent(filingNo)}`); }}
      />
    </div>
  );
};

export default RegulatoryFilingListPage;
