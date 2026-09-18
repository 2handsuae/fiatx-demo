import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw, Search } from 'lucide-react';
import { ListFooter } from '../components/common/ListFooter';
import {
  adminButtonClass,
  adminIconButtonClass,
} from '../components/common/adminButtonStyles';
import {
  AdminPermissionError,
  AdminSessionError,
  adminFetch,
  getApiErrorMessage,
} from '../utils/adminFetch';
import { AdminBadge } from '../components/ui/AdminBadge';
import { PageTitleBar } from '../components/ui/PageTitleBar';
import { RoleRequestTabs } from '../components/ui/RoleRequestTabs';

interface RoleDefinitionModifyRequestItem {
  id: string;
  requestNo: string;
  status: string;
  createdAt: string;
  role?: { code: string; name: string } | null;
  requestedBy?: { id: string; userNo: string; email: string } | null;
}

interface ListResponse {
  total: number;
  items: RoleDefinitionModifyRequestItem[];
}

const fmt = (v?: string | null): string => {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString();
};

const PAGE_SIZE = 20;

export default function RoleDefinitionModifyRequestsPage() {
  const navigate = useNavigate();

  const [status, setStatus] = useState('');
  const [items, setItems] = useState<RoleDefinitionModifyRequestItem[]>([]);
  const [total, setTotal] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = async (page: number, nextStatus: string = status) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set('take', String(PAGE_SIZE));
      params.set('skip', String((page - 1) * PAGE_SIZE));
      if (nextStatus.trim()) params.set('status', nextStatus.trim());

      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/iam/role-definition-modify-requests?${params.toString()}`,
      );
      if (!res.ok) throw new Error(await getApiErrorMessage(res, 'Failed to load requests.'));

      const data = (await res.json()) as ListResponse;
      setItems(Array.isArray(data.items) ? data.items : []);
      setTotal(typeof data.total === 'number' ? data.total : 0);
      setCurrentPage(page);
    } catch (err) {
      if (err instanceof AdminSessionError) return;
      if (err instanceof AdminPermissionError) {
        setError('Permission denied.');
      } else {
        setError(err instanceof Error ? err.message : 'Failed to load requests.');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void fetchData(1, ''); }, []);

  const fi =
    'h-[30px] rounded border border-adm-border bg-adm-bg px-2.5 font-mono text-[11px] text-adm-t1 placeholder:text-adm-t3 outline-none focus:border-adm-amber transition-colors';

  const handleSearch = () => void fetchData(1, status);
  const handleReset = () => { setStatus(''); void fetchData(1, ''); };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PageTitleBar
        title="Role Requests"
        meta={`${total} request${total === 1 ? '' : 's'} · Identity & Access`}
      >
        <button
          onClick={() => void fetchData(currentPage)}
          className={adminIconButtonClass()}
          title="Refresh"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </PageTitleBar>

      <RoleRequestTabs active="definition" />

      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-adm-border bg-adm-panel px-5 py-2">
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className={`${fi} w-44`}
        >
          <option value="">All statuses</option>
          <option value="PENDING_APPROVAL">PENDING_APPROVAL</option>
          <option value="APPROVED">APPROVED</option>
          <option value="REJECTED">REJECTED</option>
          <option value="CANCELLED">CANCELLED</option>
          <option value="EXPIRED">EXPIRED</option>
          <option value="FAILED">FAILED</option>
        </select>
        <button onClick={handleSearch} className={adminButtonClass('listPrimary')}>
          <Search size={13} />
          Search
        </button>
        <button
          onClick={handleReset}
          disabled={!status}
          className={adminButtonClass('listSecondary')}
        >
          Reset
        </button>
      </div>

      {error && (
        <div className="shrink-0 border-b border-adm-red/20 bg-adm-red/6 px-5 py-2.5 font-mono text-[11px] text-adm-red">
          {error}
        </div>
      )}

      <div className="flex-1 overflow-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              {(
                [
                  ['Request No', '160px'],
                  ['Role', '160px'],
                  ['Submitted By', '160px'],
                  ['Status', '140px'],
                  ['Created', 'auto'],
                ] as [string, string][]
              ).map(([label, w]) => (
                <th
                  key={label}
                  style={{ width: w === 'auto' ? undefined : w }}
                  className="border-b border-adm-border bg-adm-panel px-4 py-2 text-left font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-adm-t3 whitespace-nowrap"
                >
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center font-mono text-[11px] text-adm-t3">
                  Loading…
                </td>
              </tr>
            )}
            {!loading && items.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center font-mono text-[11px] text-adm-t3">
                  No role definition modify requests found.
                </td>
              </tr>
            )}
            {!loading && items.map((item) => (
              <tr
                key={item.id}
                className="cursor-pointer border-b border-adm-border transition-colors hover:bg-adm-hover"
                onClick={() => navigate(`/admin/iam/role-definition-modify-requests/${item.requestNo}`)}
              >
                <td className="px-4 py-2.5">
                  <span className="font-mono text-[11px] font-semibold text-adm-amber">
                    {item.requestNo}
                  </span>
                </td>
                <td className="px-4 py-2.5 font-mono text-[11px] text-adm-t2 whitespace-nowrap">
                  {item.role?.code ?? '—'}
                </td>
                <td className="px-4 py-2.5 font-mono text-[11px] text-adm-t2 whitespace-nowrap">
                  {item.requestedBy?.userNo ?? '—'}
                </td>
                <td className="px-4 py-2.5">
                  <AdminBadge value={item.status} />
                </td>
                <td className="px-4 py-2.5 font-mono text-[10px] text-adm-t2 whitespace-nowrap">
                  {fmt(item.createdAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ListFooter
        filteredCount={items.length}
        total={total}
        noun="request"
        currentPage={currentPage}
        pageSize={PAGE_SIZE}
        onPageChange={(page) => void fetchData(page)}
      />
    </div>
  );
}
