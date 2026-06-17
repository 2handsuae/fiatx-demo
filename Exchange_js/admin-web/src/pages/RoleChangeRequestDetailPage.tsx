import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import {
  AdminPermissionError,
  AdminSessionError,
  adminFetch,
  getApiErrorMessage,
} from '../utils/adminFetch';
import { DetailPageHeader } from '../components/compliance/DetailPageComponents';
import { AdminBadge } from '../components/ui/AdminBadge';
import { adminButtonClass } from '../components/common/adminButtonStyles';

interface RoleChangeRequest {
  id: string;
  requestNo: string;
  targetUserId: string;
  currentRoleCodes: string;
  proposedRoleCodes: string;
  changeReason: string;
  status: string;
  requestedByUserId: string;
  approvalCaseId?: string | null;
  approvalCaseNo?: string | null;
  executedAt?: string | null;
  failureReason?: string | null;
  createdAt: string;
  updatedAt: string;
  targetUser?: { id: string; userNo: string; email: string } | null;
}

const fmt = (v?: string | null): string => {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString();
};

const parseRoles = (json: string): string[] => {
  try {
    return JSON.parse(json);
  } catch {
    return [];
  }
};

export default function RoleChangeRequestDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<RoleChangeRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDetail = async () => {
    if (!id) { setError('ID required.'); setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/iam/role-change-requests/${id}`,
      );
      if (!res.ok) throw new Error(await getApiErrorMessage(res, 'Failed to load request.'));
      setData((await res.json()) as RoleChangeRequest);
    } catch (err) {
      if (err instanceof AdminSessionError) return;
      if (err instanceof AdminPermissionError) {
        setError('Permission denied.');
      } else {
        setError(err instanceof Error ? err.message : 'Failed to load request.');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void fetchDetail(); }, [id]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center gap-3">
        <RefreshCw size={24} className="animate-spin text-adm-amber" />
        <p className="font-mono text-[11px] text-adm-t3">Loading…</p>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="flex h-full flex-col overflow-hidden">
        <div className="shrink-0 border-b border-adm-border bg-adm-panel px-6 py-4 flex items-center gap-2">
          <button
            onClick={() => navigate('/dashboard/members/role-change-requests')}
            className={adminButtonClass('detailUtility')}
          >
            ← Back
          </button>
          <button onClick={() => void fetchDetail()} className={adminButtonClass('detailUtility')}>
            <RefreshCw size={13} /> Retry
          </button>
        </div>
        <div className="px-6 py-6">
          <div className="rounded-lg border border-adm-red/30 bg-adm-red/10 px-4 py-3 font-mono text-[11px] text-adm-red">
            {error}
          </div>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const currentRoles = parseRoles(data.currentRoleCodes);
  const proposedRoles = parseRoles(data.proposedRoleCodes);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <DetailPageHeader
        title="Role Change Request"
        onBack={() => navigate('/dashboard/members/role-change-requests')}
        onRefresh={() => void fetchDetail()}
        refreshing={loading}
        backLabel="Role Change Requests"
      />

      {error && (
        <div className="shrink-0 px-6 pt-3 pb-1">
          <div className="rounded border border-adm-red/30 bg-adm-red/10 px-4 py-2 font-mono text-[11px] text-adm-red">
            {error}
          </div>
        </div>
      )}

      <div className="flex min-h-0 flex-1 overflow-y-auto flex-col divide-y divide-adm-border">
        {/* Identity */}
        <section className="bg-adm-card px-6 py-5">
          <p className="font-mono text-[8.5px] font-semibold uppercase tracking-[0.16em] text-adm-t3">Request</p>
          <p className="mt-1.5 font-mono text-[19px] font-bold leading-snug text-adm-amber">
            {data.requestNo}
          </p>
          <div className="mt-2.5">
            <AdminBadge value={data.status} />
          </div>
        </section>

        {/* Details */}
        <section className="px-6 py-5">
          <p className="mb-3 font-mono text-[8.5px] font-semibold uppercase tracking-[0.16em] text-adm-t3">Details</p>
          <div className="grid grid-cols-2 gap-x-8 gap-y-4">
            <div>
              <p className="mb-1 font-mono text-[8.5px] uppercase tracking-[0.14em] text-adm-t3">Target User</p>
              <p className="font-mono text-[11px] text-adm-t2">
                {data.targetUser?.userNo || data.targetUserId.slice(0, 8)}
              </p>
              {data.targetUser?.email && (
                <p className="mt-0.5 font-mono text-[9px] text-adm-t3">{data.targetUser.email}</p>
              )}
            </div>
            <div>
              <p className="mb-1 font-mono text-[8.5px] uppercase tracking-[0.14em] text-adm-t3">Approval No</p>
              {data.approvalCaseNo ? (
                <button
                  onClick={() => navigate(`/admin/governance/approvals/${data.approvalCaseId}`)}
                  className="font-mono text-[11px] font-semibold text-adm-amber hover:opacity-75"
                >
                  {data.approvalCaseNo}
                </button>
              ) : (
                <p className="font-mono text-[10px] text-adm-t3">—</p>
              )}
            </div>
            <div>
              <p className="mb-1 font-mono text-[8.5px] uppercase tracking-[0.14em] text-adm-t3">Change Reason</p>
              <p className="font-mono text-[11px] text-adm-t2">{data.changeReason}</p>
            </div>
            <div>
              <p className="mb-1 font-mono text-[8.5px] uppercase tracking-[0.14em] text-adm-t3">Created</p>
              <p className="font-mono text-[10px] text-adm-t2">{fmt(data.createdAt)}</p>
            </div>
            {data.executedAt && (
              <div>
                <p className="mb-1 font-mono text-[8.5px] uppercase tracking-[0.14em] text-adm-t3">Executed</p>
                <p className="font-mono text-[10px] text-adm-t2">{fmt(data.executedAt)}</p>
              </div>
            )}
            {data.failureReason && (
              <div className="col-span-2">
                <p className="mb-1 font-mono text-[8.5px] uppercase tracking-[0.14em] text-adm-t3">Failure Reason</p>
                <p className="font-mono text-[10px] text-adm-red">{data.failureReason}</p>
              </div>
            )}
          </div>
        </section>

        {/* Role Comparison */}
        <section className="px-6 py-5">
          <p className="mb-3 font-mono text-[8.5px] font-semibold uppercase tracking-[0.16em] text-adm-t3">Role Comparison</p>
          <div className="grid grid-cols-2 gap-6">
            <div>
              <p className="mb-2 font-mono text-[9px] uppercase tracking-[0.12em] text-adm-t3">Current Roles</p>
              <div className="flex flex-wrap gap-1.5">
                {currentRoles.length === 0 ? (
                  <span className="font-mono text-[10px] text-adm-t3">None</span>
                ) : (
                  currentRoles.map((r) => (
                    <span
                      key={r}
                      className="inline-flex rounded border border-adm-border bg-adm-bg px-2 py-1 font-mono text-[10px] text-adm-t2"
                    >
                      {r}
                    </span>
                  ))
                )}
              </div>
            </div>
            <div>
              <p className="mb-2 font-mono text-[9px] uppercase tracking-[0.12em] text-adm-t3">Proposed Roles</p>
              <div className="flex flex-wrap gap-1.5">
                {proposedRoles.length === 0 ? (
                  <span className="font-mono text-[10px] text-adm-t3">None</span>
                ) : (
                  proposedRoles.map((r) => (
                    <span
                      key={r}
                      className="inline-flex rounded border border-adm-blue/25 bg-adm-blue/10 px-2 py-1 font-mono text-[10px] text-adm-blue"
                    >
                      {r}
                    </span>
                  ))
                )}
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
