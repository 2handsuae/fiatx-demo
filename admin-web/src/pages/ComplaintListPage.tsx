// admin-web/src/pages/ComplaintListPage.tsx
// 战役甲波五 Task 9：投诉工作流骨架——列表。铁律⑥：列表投影零 UUID（后端
// ComplaintsService.listAdmin 已保证，行只有 complaintNo/ownerCustomerNo/
// escalatedIncidentNo 三个业务号字段）。模板：RegulatoryFilingListPage.tsx 的表格结构；
// 无手工开单入口——投诉只能由客户在 client-web 提交，admin 只受理/调查/裁决/升级。
import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { adminIconButtonClass } from '../components/common/adminButtonStyles';
import { PageTitleBar } from '../components/ui/PageTitleBar';
import { StatusPill } from '../components/ui/StatusPill';
import { AdminSessionError, adminFetch, getApiErrorMessage } from '../utils/adminFetch';
import { activeComplaintClock, COMPLAINT_CATEGORY_LABEL, remainingClockText } from '../utils/complaintMap';

interface Item {
  complaintNo: string;
  ownerCustomerNo: string;
  category: string;
  relatedOrderNo: string | null;
  subject: string;
  currentStatus: string;
  submittedAt: string;
  ackDeadlineAt: string;
  acknowledgedAt: string | null;
  resolveDeadlineAt: string;
  extendedAt: string | null;
  resolvedAt: string | null;
  escalatedIncidentNo: string | null;
}

const ComplaintListPage = () => {
  const navigate = useNavigate();
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchItems = async () => {
    setLoading(true);
    try {
      const res = await adminFetch(`${import.meta.env.VITE_API_URL}/admin/complaints`);
      if (!res.ok) {
        alert(await getApiErrorMessage(res, 'Failed to load complaints'));
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
        title="Complaints"
        subtitle="Customer complaint handling — receipt, investigation, resolution and escalation, one clock per file"
        meta={`${items.length} complaint(s)`}
      >
        <button type="button" onClick={() => void fetchItems()} className={adminIconButtonClass()} title="Refresh">
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
        </button>
      </PageTitleBar>

      <div className="flex-1 overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-adm-panel">
            <tr className="border-b border-adm-border text-left text-adm-t3">
              {['Complaint No.', 'Customer', 'Category', 'Subject', 'Status', 'Clock', 'Escalated'].map((h) => (
                <th key={h} className="px-4 py-2 font-mono text-[10px] uppercase tracking-wide">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((it) => {
              const clock = activeComplaintClock(it);
              return (
                <tr
                  key={it.complaintNo}
                  onClick={() => navigate(`/admin/governance/complaints/${encodeURIComponent(it.complaintNo)}`)}
                  className={`cursor-pointer border-b border-adm-border/60 hover:bg-adm-hover/40 ${clock?.overdue ? 'bg-adm-red/10' : ''}`}
                >
                  <td className="px-4 py-2 font-mono text-adm-blue">{it.complaintNo}</td>
                  <td className="px-4 py-2 font-mono">
                    <Link
                      to={`/admin/customers/${encodeURIComponent(it.ownerCustomerNo)}`}
                      onClick={(e) => e.stopPropagation()}
                      className="text-adm-blue hover:underline"
                    >
                      {it.ownerCustomerNo}
                    </Link>
                  </td>
                  <td className="px-4 py-2">{COMPLAINT_CATEGORY_LABEL[it.category] ?? it.category}</td>
                  <td className="px-4 py-2">{it.subject}</td>
                  <td className="px-4 py-2"><StatusPill value={it.currentStatus} /></td>
                  <td className="px-4 py-2">
                    {clock ? (
                      <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${clock.overdue ? 'bg-red-100 text-red-800' : 'bg-gray-100 text-gray-700'}`}>
                        {clock.label}: {remainingClockText(clock.deadlineAt)}
                      </span>
                    ) : '—'}
                  </td>
                  <td className="px-4 py-2 font-mono">
                    {it.escalatedIncidentNo ? (
                      <Link
                        to={`/admin/governance/incidents/${encodeURIComponent(it.escalatedIncidentNo)}`}
                        onClick={(e) => e.stopPropagation()}
                        className="text-adm-blue hover:underline"
                      >
                        {it.escalatedIncidentNo}
                      </Link>
                    ) : '—'}
                  </td>
                </tr>
              );
            })}
            {!loading && items.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-adm-t3">
                  No complaints on file yet — complaints are submitted by customers from their portal
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default ComplaintListPage;
