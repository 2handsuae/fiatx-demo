import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw, Search } from 'lucide-react';
import Pagination from '../components/common/Pagination';
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

interface PolicyStepConfig {
  stepNo: number;
  roles: string[];
}

function parseSteps(stepsJson?: string | null, rolesCsv?: string | null): PolicyStepConfig[] {
  if (stepsJson) {
    try {
      return JSON.parse(stepsJson);
    } catch {
      /* fallback */
    }
  }
  if (rolesCsv) {
    return rolesCsv
      .split(',')
      .filter(Boolean)
      .map((r, i) => ({ stepNo: i + 1, roles: [r.trim()] }));
  }
  return [];
}

const ACTION_TYPE_LABELS: Record<string, string> = {
  ADMIN_INVITE_APPROVAL: 'Admin Invite',
  ADMIN_ROLE_BINDING_CHANGE_APPROVAL: 'Role Binding Change',
  ADMIN_SUSPENSION_APPROVAL: 'Account Suspension',
  ADMIN_REACTIVATION_APPROVAL: 'Account Reactivation',
  AUDIT_EVIDENCE_EXPORT_APPROVAL: 'Evidence Export',
  APPROVAL_POLICY_CHANGE: 'Approval Policy Change',
};

interface ChangeRequestItem {
  id: string;
  requestNo: string;
  targetActionType: string;
  currentCheckerRoles: string;
  proposedCheckerRoles: string;
  currentStepsConfig?: string | null;
  proposedStepsConfig?: string | null;
  changeReason: string;
  status: string;
  approvalCaseId?: string | null;
  approvalCaseNo?: string | null;
  createdAt: string;
  executedAt?: string | null;
}

interface ListResponse {
  total: number;
  items: ChangeRequestItem[];
}

const fmt = (v?: string | null): string => {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString();
};

const PAGE_SIZE = 20;

export default function PolicyChangeRequestsPage() {
  const navigate = useNavigate();

  const [statusFilter, setStatusFilter] = useState('');
  const [items, setItems] = useState<ChangeRequestItem[]>([]);
  const [total, setTotal] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = async (page: number, status = statusFilter) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set('skip', String((page - 1) * PAGE_SIZE));
      params.set('take', String(PAGE_SIZE));
      if (status.trim()) params.set('status', status.trim());

      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/governance/approval-policies/change-requests?${params.toString()}`,
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

  const handleSearch = () => void fetchData(1, statusFilter);
  const handleReset = () => { setStatusFilter(''); void fetchData(1, ''); };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PageTitleBar
        title="Policy Change Requests"
        meta={`${total} request${total === 1 ? '' : 's'} · Approval Policy`}
      >
        <button
          onClick={() => void fetchData(currentPage)}
          className={adminIconButtonClass()}
          title="Refresh"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </PageTitleBar>

      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-adm-border bg-adm-panel px-5 py-2">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
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
          disabled={!statusFilter}
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
                  ['Request No', '150px'],
                  ['Target Policy', '170px'],
                  ['Change', '180px'],
                  ['Status', '130px'],
                  ['Approval No', '140px'],
                  ['Created', '150px'],
                  ['Executed', 'auto'],
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
                <td colSpan={7} className="px-4 py-10 text-center font-mono text-[11px] text-adm-t3">
                  Loading…
                </td>
              </tr>
            )}
            {!loading && items.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center font-mono text-[11px] text-adm-t3">
                  No policy change requests found.
                </td>
              </tr>
            )}
            {!loading && items.map((item) => (
              <tr
                key={item.id}
                className="cursor-pointer border-b border-adm-border transition-colors hover:bg-adm-hover"
                onClick={() => navigate(`/dashboard/governance/policy-change-requests/${item.id}`)}
              >
                <td className="px-4 py-2.5">
                  <span className="font-mono text-[11px] font-semibold text-adm-amber">
                    {item.requestNo}
                  </span>
                </td>
                <td className="px-4 py-2.5 font-mono text-[11px] text-adm-t2 whitespace-nowrap">
                  {ACTION_TYPE_LABELS[item.targetActionType] || item.targetActionType}
                </td>
                <td className="px-4 py-2.5 font-mono text-[10px] text-adm-t2">
                  {(() => {
                    const current = parseSteps(item.currentStepsConfig, item.currentCheckerRoles);
                    const proposed = parseSteps(item.proposedStepsConfig, item.proposedCheckerRoles);
                    const cRoles = new Set(current.flatMap((s) => s.roles)).size;
                    const pRoles = new Set(proposed.flatMap((s) => s.roles)).size;
                    return `${current.length}s·${cRoles}r → ${proposed.length}s·${pRoles}r`;
                  })()}
                </td>
                <td className="px-4 py-2.5">
                  <AdminBadge value={item.status} />
                </td>
                <td className="px-4 py-2.5 font-mono text-[10px] text-adm-t2 whitespace-nowrap">
                  {item.approvalCaseNo ?? '—'}
                </td>
                <td className="px-4 py-2.5 font-mono text-[10px] text-adm-t2 whitespace-nowrap">
                  {fmt(item.createdAt)}
                </td>
                <td className="px-4 py-2.5 font-mono text-[10px] text-adm-t2 whitespace-nowrap">
                  {fmt(item.executedAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="shrink-0 border-t border-adm-border bg-adm-panel px-5 py-2.5">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[10px] text-adm-t3">
            {total > 0
              ? `Showing ${items.length} / ${total} request${total === 1 ? '' : 's'}`
              : 'No requests'}
          </span>
          {total > PAGE_SIZE && (
            <Pagination
              currentPage={currentPage}
              totalItems={total}
              pageSize={PAGE_SIZE}
              onPageChange={(page) => void fetchData(page)}
            />
          )}
        </div>
      </div>
    </div>
  );
}
