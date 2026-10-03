// admin-web/src/pages/DsrRequestListPage.tsx
// 战役丙波四 Task 6：资料请求（DSR）——列表。铁律⑥：列表只露 requestNo / customerNo 两个
// 业务号（后端 DsrRequestsService.listAdmin 已保证投影零 UUID）。无手工开单入口——DSR 只能
// 由客户在 client-web 提交，admin（DPO）只受理 / 生成摘要 / 办结。
// 模板：ComplaintListPage.tsx 的表格结构 + 倒计时列写法，IncidentListPage.tsx 的类型 / 状态筛选条。
import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { adminIconButtonClass } from '../components/common/adminButtonStyles';
import { PageTitleBar } from '../components/ui/PageTitleBar';
import { StatusPill } from '../components/ui/StatusPill';
import { AdminSessionError, adminFetch, getApiErrorMessage } from '../utils/adminFetch';
import { remainingClockText } from '../utils/complaintMap';
import { activeDsrClock, DSR_STATUS_LABEL, DSR_STATUSES, DSR_TYPE_LABEL, DSR_TYPES } from '../utils/dsrMap';

interface Item {
  requestNo: string;
  customerNo: string;
  type: string;
  status: string;
  submittedAt: string;
  reviewStartedAt: string | null;
  resolvedAt: string | null;
  dueAt: string;
  resolutionCode: string | null;
}

const fmt = (v?: string | null): string => {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString();
};

const DsrRequestListPage = () => {
  const navigate = useNavigate();
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('');
  const [type, setType] = useState('');

  const fetchItems = async (nextStatus = status, nextType = type) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (nextStatus) params.set('status', nextStatus);
      if (nextType) params.set('type', nextType);
      const query = params.toString();
      const res = await adminFetch(`${import.meta.env.VITE_API_URL}/admin/dsr-requests${query ? `?${query}` : ''}`);
      if (!res.ok) {
        alert(await getApiErrorMessage(res, 'Failed to load data requests'));
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
        title="Data Requests"
        subtitle="Customer requests about their own data — access, rectification, erasure; one 30-day response clock per request"
        meta={`${items.length} request(s)`}
      >
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
          {DSR_STATUSES.map((s) => <option key={s} value={s}>{DSR_STATUS_LABEL[s]}</option>)}
        </select>
        <select
          value={type}
          onChange={(e) => { setType(e.target.value); void fetchItems(status, e.target.value); }}
          className="rounded border border-adm-border bg-adm-panel px-2 py-1"
        >
          <option value="">All types</option>
          {DSR_TYPES.map((t) => <option key={t} value={t}>{DSR_TYPE_LABEL[t]}</option>)}
        </select>
      </div>

      <div className="flex-1 overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-adm-panel">
            <tr className="border-b border-adm-border text-left text-adm-t3">
              {['Request No.', 'Customer', 'Type', 'Status', 'Response Clock', 'Resolved At'].map((h) => (
                <th key={h} className="px-4 py-2 font-mono text-[10px] uppercase tracking-wide">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((it) => {
              const clock = activeDsrClock(it);
              return (
                <tr
                  key={it.requestNo}
                  onClick={() => navigate(`/admin/governance/compliance-office/dsr-requests/${encodeURIComponent(it.requestNo)}`)}
                  className={`cursor-pointer border-b border-adm-border/60 hover:bg-adm-hover/40 ${clock?.overdue ? 'bg-adm-red/10' : ''}`}
                >
                  <td className="px-4 py-2 font-mono text-adm-blue">{it.requestNo}</td>
                  <td className="px-4 py-2 font-mono">
                    <Link
                      to={`/admin/customers/${encodeURIComponent(it.customerNo)}`}
                      onClick={(e) => e.stopPropagation()}
                      className="text-adm-blue hover:underline"
                    >
                      {it.customerNo}
                    </Link>
                  </td>
                  <td className="px-4 py-2">{DSR_TYPE_LABEL[it.type] ?? it.type}</td>
                  <td className="px-4 py-2"><StatusPill value={it.status} /></td>
                  <td className="px-4 py-2">
                    {clock ? (
                      <span
                        title={`Due ${fmt(clock.deadlineAt)}`}
                        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${clock.overdue ? 'bg-adm-red/15 text-adm-red' : 'bg-adm-bg text-adm-t2'}`}
                      >
                        Respond (30d): {remainingClockText(clock.deadlineAt)}
                      </span>
                    ) : '—'}
                  </td>
                  <td className="px-4 py-2 font-mono">{fmt(it.resolvedAt)}</td>
                </tr>
              );
            })}
            {!loading && items.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-adm-t3">
                  No data requests on file — requests are submitted by customers from their portal
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default DsrRequestListPage;
