// admin-web/src/pages/LpProfileList.tsx
// 战役乙波一 Task 7：LP 档案列表。模板：InternalTransferList.tsx（结构/fetch 写法）。铁律⑥：投影零 UUID。
// 甲波六 T5：档案即「尽调申请」——Register 弹层退役，按钮跳申请页（/admin/lp-profiles/new）；
// 状态列走 partnerStatusMap（员工看不到内部枚举），加状态筛选（合规官就靠它当「待评估队列」）。
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, RefreshCw } from 'lucide-react';
import { adminButtonClass, adminIconButtonClass } from '../components/common/adminButtonStyles';
import { PageTitleBar } from '../components/ui/PageTitleBar';
import { PartnerStatusPill } from '../components/ui/PartnerStatusPill';
import { useAdminSession } from '../contexts/AdminSessionContext';
import { PERMISSIONS } from '../rbac/permissions';
import { AdminSessionError, adminFetch, getApiErrorMessage } from '../utils/adminFetch';
import { LP_STATUS_FILTER_ORDER, PARTNER_STATUS_META } from '../utils/partnerStatusMap';

interface Item {
  lpNo: string;
  name: string;
  registeredIn: string;
  status: string;
  agreementRef: string;
  createdAt: string;
}

const LpProfileList = () => {
  const navigate = useNavigate();
  const { hasPermission } = useAdminSession();
  const canCreate = hasPermission(PERMISSIONS.LP_PROFILE_CREATE);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('');

  const fetchItems = async () => {
    setLoading(true);
    try {
      const res = await adminFetch(`${import.meta.env.VITE_API_URL}/admin/lp-profiles`);
      if (!res.ok) { alert(await getApiErrorMessage(res, 'Failed to load LP profiles')); return; }
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

  const visible = status ? items.filter((it) => it.status === status) : items;

  return (
    <div className="flex h-full flex-col">
      <PageTitleBar
        title="LP Register"
        subtitle="Liquidity provider applications — filed by treasury, assessed by compliance, then approved (high risk: CFO, then senior management)"
        meta={status ? `${visible.length} of ${items.length} LP(s)` : `${items.length} LP(s)`}
      >
        {canCreate && (
          <button type="button" onClick={() => navigate('/admin/lp-profiles/new')} className={adminButtonClass('listPrimary')}>
            <Plus size={13} /> Register LP
          </button>
        )}
        <button type="button" onClick={() => void fetchItems()} className={adminIconButtonClass()} title="Refresh">
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
        </button>
      </PageTitleBar>

      <div className="flex gap-2 border-b border-adm-border px-5 py-2 text-xs">
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="rounded border border-adm-border bg-adm-panel px-2 py-1"
          aria-label="Filter by status"
        >
          <option value="">All statuses</option>
          {LP_STATUS_FILTER_ORDER.map((s) => (
            <option key={s} value={s}>
              {PARTNER_STATUS_META[s].label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex-1 overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-adm-panel">
            <tr className="border-b border-adm-border text-left text-adm-t3">
              {['LP No.', 'Name', 'Status', 'Registered In', 'Agreement Ref', 'Created At'].map((h) => (
                <th key={h} className="px-4 py-2 font-mono text-[10px] uppercase tracking-wide">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((it) => (
              <tr
                key={it.lpNo}
                onClick={() => navigate(`/admin/lp-profiles/${encodeURIComponent(it.lpNo)}`)}
                className="cursor-pointer border-b border-adm-border/60 hover:bg-adm-hover/40"
              >
                <td className="px-4 py-2 font-mono text-adm-blue">{it.lpNo}</td>
                <td className="px-4 py-2">{it.name}</td>
                <td className="px-4 py-2">
                  <PartnerStatusPill status={it.status} />
                </td>
                <td className="px-4 py-2 text-adm-t2">{it.registeredIn}</td>
                <td className="px-4 py-2 font-mono">{it.agreementRef}</td>
                <td className="px-4 py-2 font-mono text-adm-t3">
                  {new Date(it.createdAt).toLocaleString()}
                </td>
              </tr>
            ))}
            {!loading && visible.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-adm-t3">
                  {items.length === 0
                    ? 'No liquidity providers registered yet — click "Register LP" to file the first application'
                    : 'No liquidity providers in this status'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default LpProfileList;
