import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Shield, Pencil, X, RefreshCw } from 'lucide-react';
import { PageTitleBar } from '../components/ui/PageTitleBar';
import { AdminBadge } from '../components/ui/AdminBadge';
import { adminIconButtonClass } from '../components/common/adminButtonStyles';
import {
  AdminPermissionError,
  AdminSessionError,
  adminFetch,
  getApiErrorMessage,
} from '../utils/adminFetch';
import { useAdminSession } from '../contexts/AdminSessionContext';
import { PERMISSIONS } from '../rbac/permissions';

interface PolicyStepConfig {
  stepNo: number;
  roles: string[];
}

interface PolicyView {
  actionType: string;
  steps: PolicyStepConfig[];
  checkerRoles: string[];
  timeoutHours: number;
  source: 'DEFAULT' | 'CUSTOMIZED';
  editable: boolean;
}

const ACTION_TYPE_LABELS: Record<string, string> = {
  ADMIN_INVITE_APPROVAL: 'Admin Invite',
  ADMIN_ROLE_BINDING_CHANGE_APPROVAL: 'Role Binding Change',
  ADMIN_SUSPENSION_APPROVAL: 'Account Suspension',
  ADMIN_REACTIVATION_APPROVAL: 'Account Reactivation',
  AUDIT_EVIDENCE_EXPORT_APPROVAL: 'Evidence Export',
  APPROVAL_POLICY_CHANGE: 'Approval Policy Change',
};

const AVAILABLE_ROLES = [
  'CISO',
  'MLRO',
  'SENIOR_MANAGEMENT_OFFICER',
  'TECH_OFFICER',
  'COMPLIANCE_OFFICER',
  'DPO',
];

export default function ApprovalPoliciesPage() {
  const navigate = useNavigate();
  const { hasAnyPermission } = useAdminSession();
  const [policies, setPolicies] = useState<PolicyView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Modal state
  const [editTarget, setEditTarget] = useState<PolicyView | null>(null);
  const [proposedSteps, setProposedSteps] = useState<PolicyStepConfig[]>([]);
  const [changeReason, setChangeReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  const canCreate = hasAnyPermission([PERMISSIONS.GOV_APPROVAL_POLICY_CHANGE_CREATE]);

  const fetchPolicies = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminFetch(`${import.meta.env.VITE_API_URL}/admin/governance/approval-policies`);
      if (!res.ok) throw new Error(await getApiErrorMessage(res, 'Failed to load policies.'));
      setPolicies(await res.json());
    } catch (err) {
      if (err instanceof AdminSessionError) return;
      if (err instanceof AdminPermissionError) {
        setError('Permission denied.');
      } else {
        setError(err instanceof Error ? err.message : 'Failed to load policies.');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void fetchPolicies(); }, []);

  const openEdit = (policy: PolicyView) => {
    setEditTarget(policy);
    setProposedSteps(policy.steps.map((s) => ({ stepNo: s.stepNo, roles: [...s.roles] })));
    setChangeReason('');
    setSubmitError('');
  };

  const closeEdit = () => {
    setEditTarget(null);
    setProposedSteps([]);
    setChangeReason('');
    setSubmitError('');
  };

  const toggleStepRole = (stepIdx: number, role: string) => {
    setProposedSteps((prev) =>
      prev.map((step, idx) => {
        if (idx !== stepIdx) return step;
        const roles = step.roles.includes(role)
          ? step.roles.filter((r) => r !== role)
          : [...step.roles, role];
        return { ...step, roles };
      }),
    );
  };

  const addStep = () => {
    setProposedSteps((prev) => [...prev, { stepNo: prev.length + 1, roles: [] }]);
  };

  const removeStep = (stepIdx: number) => {
    setProposedSteps((prev) =>
      prev
        .filter((_, idx) => idx !== stepIdx)
        .map((step, idx) => ({ ...step, stepNo: idx + 1 })),
    );
  };

  const isStepsValid = proposedSteps.length > 0 && proposedSteps.every((s) => s.roles.length > 0);

  const handleSubmit = async () => {
    if (!editTarget || !isStepsValid || !changeReason.trim()) return;
    setSubmitting(true);
    setSubmitError('');
    try {
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/governance/approval-policies/${editTarget.actionType}/change-requests`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            proposedSteps,
            changeReason: changeReason.trim(),
          }),
        },
      );
      if (!res.ok) throw new Error(await getApiErrorMessage(res, 'Submit failed.'));
      const data = await res.json();
      closeEdit();
      navigate(`/dashboard/governance/policy-change-requests/${data.id}`);
    } catch (err) {
      if (err instanceof AdminSessionError) return;
      setSubmitError(err instanceof Error ? err.message : 'Submit failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const label = (at: string) => ACTION_TYPE_LABELS[at] || at;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PageTitleBar
        title="Approval Policies"
        meta={`${policies.length} polic${policies.length === 1 ? 'y' : 'ies'} · Control Gates`}
      >
        <button
          onClick={() => void fetchPolicies()}
          className={adminIconButtonClass()}
          title="Refresh"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </PageTitleBar>

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
                  ['Action Type', '200px'],
                  ['Steps', 'auto'],
                  ['Timeout', '80px'],
                  ['Source', '110px'],
                  ['Actions', '100px'],
                ] as [string, string][]
              ).map(([col, w]) => (
                <th
                  key={col}
                  style={{ width: w === 'auto' ? undefined : w }}
                  className="border-b border-adm-border bg-adm-panel px-4 py-2 text-left font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-adm-t3 whitespace-nowrap"
                >
                  {col}
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
            {!loading && policies.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center font-mono text-[11px] text-adm-t3">
                  No policies found.
                </td>
              </tr>
            )}
            {!loading && policies.map((p) => (
              <tr
                key={p.actionType}
                className="border-b border-adm-border transition-colors hover:bg-adm-hover"
              >
                <td className="px-4 py-2.5 font-mono text-[11px] font-semibold text-adm-t1">
                  {label(p.actionType)}
                </td>
                <td className="px-4 py-2.5">
                  <div className="space-y-1">
                    {p.steps.map((step) => (
                      <div key={step.stepNo} className="flex items-center gap-1.5">
                        <span className="font-mono text-[9px] text-adm-t3 shrink-0">
                          S{step.stepNo}
                        </span>
                        <div className="flex flex-wrap gap-1">
                          {step.roles.map((r) => (
                            <span
                              key={r}
                              className="inline-flex rounded border border-adm-amber/25 bg-adm-amber/10 px-1.5 py-0.5 font-mono text-[9px] text-adm-amber"
                            >
                              {r}
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </td>
                <td className="px-4 py-2.5 font-mono text-[10px] text-adm-t2">
                  {p.timeoutHours}h
                </td>
                <td className="px-4 py-2.5">
                  <AdminBadge value={p.source} />
                </td>
                <td className="px-4 py-2.5 text-right">
                  {p.editable && canCreate ? (
                    <button
                      onClick={() => openEdit(p)}
                      className="inline-flex items-center gap-1 rounded border border-adm-border bg-adm-bg px-2 py-1 font-mono text-[9px] text-adm-t2 transition-colors hover:border-adm-amber/50 hover:text-adm-amber"
                    >
                      <Pencil size={11} /> Edit
                    </button>
                  ) : (
                    <span className="inline-flex items-center gap-1 font-mono text-[9px] text-adm-t3">
                      <Shield size={11} className="opacity-40" />Locked
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Edit Modal ── */}
      {editTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-lg mx-4 rounded-lg border border-adm-border bg-adm-bg shadow-2xl max-h-[85vh] flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-adm-border px-5 py-4 shrink-0">
              <h3 className="font-mono text-sm font-semibold text-adm-t1">
                Modify: {label(editTarget.actionType)}
              </h3>
              <button onClick={closeEdit} className="text-adm-t3 hover:text-adm-t1 transition-colors">
                <X size={16} />
              </button>
            </div>

            <div className="flex-1 overflow-auto space-y-5 px-5 py-5">
              {/* Current Configuration */}
              <div>
                <p className="mb-2 font-mono text-[8.5px] font-semibold uppercase tracking-[0.14em] text-adm-t3">
                  Current Configuration
                </p>
                <div className="space-y-1">
                  {editTarget.steps.map((step) => (
                    <div key={step.stepNo} className="flex items-center gap-1.5">
                      <span className="font-mono text-[9px] text-adm-t3 shrink-0">
                        Step {step.stepNo}:
                      </span>
                      <div className="flex flex-wrap gap-1">
                        {step.roles.map((r) => (
                          <span
                            key={r}
                            className="inline-flex rounded border border-adm-amber/25 bg-adm-amber/10 px-2 py-1 font-mono text-[10px] text-adm-amber"
                          >
                            {r}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Proposed Configuration */}
              <div>
                <p className="mb-2 font-mono text-[8.5px] font-semibold uppercase tracking-[0.14em] text-adm-t3">
                  Proposed Configuration
                </p>
                <div className="space-y-4">
                  {proposedSteps.map((step, stepIdx) => (
                    <div key={stepIdx} className="rounded border border-adm-border bg-adm-panel p-3">
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-mono text-[10px] font-semibold text-adm-t2">
                          Step {step.stepNo}
                        </span>
                        {proposedSteps.length > 1 && (
                          <button
                            onClick={() => removeStep(stepIdx)}
                            className="text-adm-t3 hover:text-adm-red transition-colors"
                            title="Remove step"
                          >
                            <X size={12} />
                          </button>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {AVAILABLE_ROLES.map((role) => (
                          <button
                            key={role}
                            onClick={() => toggleStepRole(stepIdx, role)}
                            className={`rounded border px-3 py-1.5 font-mono text-[10px] transition-colors ${
                              step.roles.includes(role)
                                ? 'border-adm-amber/50 bg-adm-amber/20 text-adm-amber'
                                : 'border-adm-border bg-adm-bg text-adm-t3 hover:border-adm-t3'
                            }`}
                          >
                            {role}
                          </button>
                        ))}
                      </div>
                      {step.roles.length === 0 && (
                        <p className="mt-2 font-mono text-[10px] text-adm-red">Select at least one role</p>
                      )}
                    </div>
                  ))}
                  <button
                    onClick={addStep}
                    className="w-full rounded border border-dashed border-adm-border px-3 py-2 font-mono text-[10px] text-adm-t3 transition-colors hover:border-adm-amber hover:text-adm-amber"
                  >
                    + Add Step
                  </button>
                </div>
              </div>

              {/* Change reason */}
              <div>
                <p className="mb-2 font-mono text-[8.5px] font-semibold uppercase tracking-[0.14em] text-adm-t3">
                  Change Reason
                </p>
                <textarea
                  value={changeReason}
                  onChange={(e) => setChangeReason(e.target.value)}
                  placeholder="Explain why this change is needed…"
                  rows={3}
                  className="w-full resize-none rounded border border-adm-border bg-adm-panel px-3 py-2 font-mono text-xs text-adm-t1 placeholder:text-adm-t3 outline-none focus:border-adm-amber"
                />
              </div>

              {submitError && (
                <div className="rounded border border-adm-red/30 bg-adm-red/10 px-3 py-2 font-mono text-[10px] text-adm-red">
                  {submitError}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex justify-end gap-3 border-t border-adm-border px-5 py-4 shrink-0">
              <button
                onClick={closeEdit}
                className="rounded px-4 py-2 font-mono text-[10px] uppercase tracking-wider text-adm-t3 transition-colors hover:text-adm-t1"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={submitting || !isStepsValid || !changeReason.trim()}
                className="rounded bg-adm-amber px-4 py-2 font-mono text-[10px] font-bold uppercase tracking-wider text-adm-bg transition-opacity hover:opacity-90 disabled:opacity-40"
              >
                {submitting ? 'Submitting…' : 'Submit for Approval'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
