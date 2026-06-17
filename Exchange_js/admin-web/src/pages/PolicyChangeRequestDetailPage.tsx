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

interface PolicyChangeRequest {
  id: string;
  requestNo: string;
  targetActionType: string;
  currentCheckerRoles: string;
  proposedCheckerRoles: string;
  currentStepsConfig?: string | null;
  proposedStepsConfig?: string | null;
  changeReason: string;
  status: string;
  requestedByUserId: string;
  approvalCaseId?: string | null;
  approvalCaseNo?: string | null;
  executedAt?: string | null;
  failureReason?: string | null;
  createdAt: string;
  updatedAt: string;
}

const fmt = (v?: string | null): string => {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString();
};

export default function PolicyChangeRequestDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<PolicyChangeRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDetail = async () => {
    if (!id) { setError('ID required.'); setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/governance/approval-policies/change-requests/${id}`,
      );
      if (!res.ok) throw new Error(await getApiErrorMessage(res, 'Failed to load request.'));
      setData((await res.json()) as PolicyChangeRequest);
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
            onClick={() => navigate('/dashboard/governance/policy-change-requests')}
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

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <DetailPageHeader
        title="Policy Change Request"
        onBack={() => navigate('/dashboard/governance/policy-change-requests')}
        onRefresh={() => void fetchDetail()}
        refreshing={loading}
        backLabel="Policy Change Requests"
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
              <p className="mb-1 font-mono text-[8.5px] uppercase tracking-[0.14em] text-adm-t3">Target Policy</p>
              <p className="font-mono text-[11px] text-adm-t2">
                {ACTION_TYPE_LABELS[data.targetActionType] || data.targetActionType}
              </p>
              <p className="mt-0.5 font-mono text-[9px] text-adm-t3">{data.targetActionType}</p>
            </div>
            <div>
              <p className="mb-1 font-mono text-[8.5px] uppercase tracking-[0.14em] text-adm-t3">Approval Case</p>
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
            <div className="col-span-2">
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
          <p className="mb-3 font-mono text-[8.5px] font-semibold uppercase tracking-[0.16em] text-adm-t3">Checker Role Comparison</p>
              {/* Step Configuration Comparison */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="mb-2 font-mono text-[8.5px] font-semibold uppercase tracking-[0.14em] text-adm-t3">
                    Current Configuration
                  </p>
                  <div className="space-y-1">
                    {parseSteps(data.currentStepsConfig, data.currentCheckerRoles).map((step) => (
                      <div key={step.stepNo} className="flex items-center gap-1.5">
                        <span className="font-mono text-[9px] text-adm-t3 shrink-0">S{step.stepNo}</span>
                        <div className="flex flex-wrap gap-1">
                          {step.roles.map((r) => (
                            <span key={r} className="inline-flex rounded border border-adm-border bg-adm-panel px-1.5 py-0.5 font-mono text-[9px] text-adm-t2">
                              {r}
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="mb-2 font-mono text-[8.5px] font-semibold uppercase tracking-[0.14em] text-adm-t3">
                    Proposed Configuration
                  </p>
                  <div className="space-y-1">
                    {parseSteps(data.proposedStepsConfig, data.proposedCheckerRoles).map((step) => (
                      <div key={step.stepNo} className="flex items-center gap-1.5">
                        <span className="font-mono text-[9px] text-adm-amber shrink-0">S{step.stepNo}</span>
                        <div className="flex flex-wrap gap-1">
                          {step.roles.map((r) => (
                            <span key={r} className="inline-flex rounded border border-adm-amber/25 bg-adm-amber/10 px-1.5 py-0.5 font-mono text-[9px] text-adm-amber">
                              {r}
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
        </section>
      </div>
    </div>
  );
}
