// admin-web/src/pages/ServiceProvidersPage.tsx
// 甲波六 T8：服务商列表——从 Compliance Registers 的 Vendors tab 抬出来的独立页（Compliance Office 组）。
// 运营点 Apply 进申请页；合规官 / CISO / CFO / 高管靠状态筛选当各自的待办队列。
// 铁律⑥：投影零 UUID；状态与重大性一律经词表（partnerStatusMap），员工看不到内部枚举（R11）。
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, RefreshCw } from 'lucide-react';
import { adminButtonClass, adminIconButtonClass } from '../components/common/adminButtonStyles';
import { PageTitleBar } from '../components/ui/PageTitleBar';
import { MaterialityPill, PartnerStatusPill } from '../components/ui/PartnerStatusPill';
import { useAdminSession } from '../contexts/AdminSessionContext';
import { PERMISSIONS } from '../rbac/permissions';
import { AdminSessionError, adminFetch, getApiErrorMessage } from '../utils/adminFetch';
import { PARTNER_STATUS_META, SERVICE_PROVIDERS_PATH, VENDOR_STATUS_FILTER_ORDER } from '../utils/partnerStatusMap';

interface Item {
  vendorNo: string;
  name: string;
  serviceDescription: string;
  criticality: string;
  status: string;
  contractStart: string;
  contractEnd: string | null;
}

/** 合同日在库里是 UTC 零点；截前 10 位原样显示，不让本地时区把日期推一天。 */
const dateOnly = (iso: string | null): string => (iso ? iso.slice(0, 10) : '—');

const ServiceProvidersPage = () => {
  const navigate = useNavigate();
  const { hasPermission } = useAdminSession();
  const canApply = hasPermission(PERMISSIONS.VENDOR_APPLY);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('');

  const fetchItems = async () => {
    setLoading(true);
    try {
      const res = await adminFetch(`${import.meta.env.VITE_API_URL}/admin/outsourcing-vendors`);
      if (!res.ok) { alert(await getApiErrorMessage(res, 'Failed to load service providers')); return; }
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
        title="Service Providers"
        subtitle="Outsourced service providers — applied for by operations, assessed by compliance, then approved (material ones also need a CISO assessment and a VARA notification)"
        meta={status ? `${visible.length} of ${items.length} provider(s)` : `${items.length} provider(s)`}
      >
        {canApply && (
          <button type="button" onClick={() => navigate(`${SERVICE_PROVIDERS_PATH}/new`)} className={adminButtonClass('listPrimary')}>
            <Plus size={13} /> Apply
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
          {VENDOR_STATUS_FILTER_ORDER.map((s) => (
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
              {['Provider No.', 'Name', 'Service', 'Materiality', 'Status', 'Contract Start', 'Contract End'].map((h) => (
                <th key={h} className="px-4 py-2 font-mono text-[10px] uppercase tracking-wide">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((it) => (
              <tr
                key={it.vendorNo}
                onClick={() => navigate(`${SERVICE_PROVIDERS_PATH}/${encodeURIComponent(it.vendorNo)}`)}
                className="cursor-pointer border-b border-adm-border/60 hover:bg-adm-hover/40"
              >
                <td className="px-4 py-2 font-mono text-adm-blue">{it.vendorNo}</td>
                <td className="px-4 py-2">{it.name}</td>
                <td className="max-w-[280px] truncate px-4 py-2 text-adm-t2" title={it.serviceDescription}>{it.serviceDescription}</td>
                <td className="px-4 py-2"><MaterialityPill criticality={it.criticality} /></td>
                <td className="px-4 py-2"><PartnerStatusPill status={it.status} /></td>
                <td className="px-4 py-2 font-mono">{dateOnly(it.contractStart)}</td>
                <td className="px-4 py-2 font-mono">{dateOnly(it.contractEnd)}</td>
              </tr>
            ))}
            {!loading && visible.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-adm-t3">
                  {items.length === 0
                    ? 'No service providers yet — click "Apply" to file the first application'
                    : 'No service providers in this status'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default ServiceProvidersPage;
