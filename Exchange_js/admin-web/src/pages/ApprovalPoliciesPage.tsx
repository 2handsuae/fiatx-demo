import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Shield, Pencil, X, ArrowRight } from 'lucide-react';
import { PageTitleBar } from '../components/ui/PageTitleBar';
import { adminFetch, AdminSessionError, getApiErrorMessage } from '../utils/adminFetch';
import { useAdminSession } from '../contexts/AdminSessionContext';
import { PERMISSIONS } from '../rbac/permissions';

interface PolicyView {
  actionType: string;
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
  const [error, setError] = useState('');

  // Modal state
  const [editTarget, setEditTarget] = useState<PolicyView | null>(null);
  const [proposedRoles, setProposedRoles] = useState<string[]>([]);
  const [changeReason, setChangeReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  const canCreate = hasAnyPermission([PERMISSIONS.GOV_APPROVAL_POLICY_CHANGE_CREATE]);

  const fetchPolicies = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await adminFetch(`${import.meta.env.VITE_API_URL}/admin/governance/approval-policies`);
      if (!res.ok) throw new Error(await getApiErrorMessage(res));
      setPolicies(await res.json());
    } catch (err: any) {
      if (err instanceof AdminSessionError) {
        navigate('/admin/login');
        return;
      }
      setError(err.message || 'Failed to load policies');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPolicies();
  }, []);

  const openEdit = (policy: PolicyView) => {
    setEditTarget(policy);
    setProposedRoles([...policy.checkerRoles]);
    setChangeReason('');
    setSubmitError('');
  };

  const closeEdit = () => {
    setEditTarget(null);
    setProposedRoles([]);
    setChangeReason('');
    setSubmitError('');
  };

  const toggleRole = (role: string) => {
    setProposedRoles((prev) =>
      prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role],
    );
  };

  const handleSubmit = async () => {
    if (!editTarget || proposedRoles.length === 0 || !changeReason.trim()) return;
    setSubmitting(true);
    setSubmitError('');
    try {
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/governance/approval-policies/${editTarget.actionType}/change-requests`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            proposedCheckerRoles: proposedRoles,
            changeReason: changeReason.trim(),
          }),
        },
      );
      if (!res.ok) throw new Error(await getApiErrorMessage(res));
      const data = await res.json();
      closeEdit();
      fetchPolicies();
      alert(`Change request submitted. Approval No: ${data.approvalNo}`);
    } catch (err: any) {
      setSubmitError(err.message || 'Submit failed');
    } finally {
      setSubmitting(false);
    }
  };

  const label = (at: string) => ACTION_TYPE_LABELS[at] || at;

  return (
    <div className="min-h-screen bg-adm-bg text-adm-t1 p-6">
      <PageTitleBar title="Approval Policies" meta="Manage checker role assignments for each approval type" />

      {error && (
        <div className="mt-4 p-3 bg-red-900/30 border border-red-700 rounded text-red-300 text-xs font-mono">
          {error}
        </div>
      )}

      <div className="mt-6 border border-adm-border rounded overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-adm-panel border-b border-adm-border text-adm-t3 uppercase tracking-wider">
              <th className="px-4 py-3 text-left font-mono font-medium">Action Type</th>
              <th className="px-4 py-3 text-left font-mono font-medium">Checker Roles</th>
              <th className="px-4 py-3 text-left font-mono font-medium">Timeout</th>
              <th className="px-4 py-3 text-left font-mono font-medium">Source</th>
              <th className="px-4 py-3 text-right font-mono font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-adm-t3">Loading...</td></tr>
            ) : policies.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-adm-t3">No policies found</td></tr>
            ) : (
              policies.map((p) => (
                <tr key={p.actionType} className="border-b border-adm-border hover:bg-adm-panel/50 transition-colors">
                  <td className="px-4 py-3 font-mono text-adm-t1">{label(p.actionType)}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1.5 flex-wrap">
                      {p.checkerRoles.map((r) => (
                        <span key={r} className="px-2 py-0.5 bg-adm-amber/10 text-adm-amber border border-adm-amber/30 rounded font-mono text-[10px]">
                          {r}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3 font-mono text-adm-t2">{p.timeoutHours}h</td>
                  <td className="px-4 py-3">
                    {p.source === 'CUSTOMIZED' ? (
                      <span className="px-2 py-0.5 bg-adm-amber/20 text-adm-amber rounded text-[10px] font-mono">Customized</span>
                    ) : (
                      <span className="px-2 py-0.5 bg-gray-700/50 text-adm-t3 rounded text-[10px] font-mono">Default</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {p.editable && canCreate ? (
                      <button
                        onClick={() => openEdit(p)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 bg-adm-panel border border-adm-border rounded text-adm-t2 hover:text-adm-amber hover:border-adm-amber/50 transition-colors text-[10px] font-mono uppercase tracking-wider"
                      >
                        <Pencil size={12} /> Edit
                      </button>
                    ) : (
                      <span className="text-adm-t3 text-[10px] font-mono" title="This policy can only be modified via code deployment">
                        <Shield size={12} className="inline mr-1 opacity-40" />Locked
                      </span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* ── Edit Modal ── */}
      {editTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-adm-bg border border-adm-border rounded-lg w-full max-w-lg mx-4 shadow-2xl">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-adm-border">
              <h3 className="font-mono text-sm font-semibold text-adm-t1">
                Modify: {label(editTarget.actionType)}
              </h3>
              <button onClick={closeEdit} className="text-adm-t3 hover:text-adm-t1">
                <X size={16} />
              </button>
            </div>

            <div className="px-5 py-5 space-y-5">
              {/* Current → Proposed */}
              <div className="flex items-center gap-3">
                <div className="flex-1">
                  <p className="font-mono text-[9px] uppercase tracking-widest text-adm-t3 mb-2">Current</p>
                  <div className="flex gap-1.5 flex-wrap">
                    {editTarget.checkerRoles.map((r) => (
                      <span key={r} className="px-2 py-0.5 bg-gray-700/50 text-adm-t3 rounded font-mono text-[10px]">{r}</span>
                    ))}
                  </div>
                </div>
                <ArrowRight size={16} className="text-adm-t3 mt-4 shrink-0" />
                <div className="flex-1">
                  <p className="font-mono text-[9px] uppercase tracking-widest text-adm-t3 mb-2">Proposed</p>
                  <div className="flex gap-1.5 flex-wrap">
                    {proposedRoles.length > 0 ? proposedRoles.map((r) => (
                      <span key={r} className="px-2 py-0.5 bg-adm-amber/10 text-adm-amber border border-adm-amber/30 rounded font-mono text-[10px]">{r}</span>
                    )) : (
                      <span className="text-adm-t3 text-[10px] font-mono">Select at least one role</span>
                    )}
                  </div>
                </div>
              </div>

              {/* Role toggles */}
              <div>
                <p className="font-mono text-[9px] uppercase tracking-widest text-adm-t3 mb-2">Available Roles</p>
                <div className="flex gap-2 flex-wrap">
                  {AVAILABLE_ROLES.map((role) => (
                    <button
                      key={role}
                      onClick={() => toggleRole(role)}
                      className={`px-3 py-1.5 rounded font-mono text-[10px] border transition-colors ${
                        proposedRoles.includes(role)
                          ? 'bg-adm-amber/20 text-adm-amber border-adm-amber/50'
                          : 'bg-adm-panel text-adm-t3 border-adm-border hover:border-adm-t3'
                      }`}
                    >
                      {role}
                    </button>
                  ))}
                </div>
              </div>

              {/* Change reason */}
              <div>
                <p className="font-mono text-[9px] uppercase tracking-widest text-adm-t3 mb-2">Change Reason</p>
                <textarea
                  value={changeReason}
                  onChange={(e) => setChangeReason(e.target.value)}
                  placeholder="Explain why this change is needed..."
                  rows={3}
                  className="w-full px-3 py-2 bg-adm-panel border border-adm-border rounded font-mono text-xs text-adm-t1 placeholder:text-adm-t3 focus:border-adm-amber focus:outline-none resize-none"
                />
              </div>

              {submitError && (
                <div className="p-2 bg-red-900/30 border border-red-700 rounded text-red-300 text-[10px] font-mono">
                  {submitError}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex justify-end gap-3 px-5 py-4 border-t border-adm-border">
              <button
                onClick={closeEdit}
                className="px-4 py-2 font-mono text-[10px] uppercase tracking-wider text-adm-t3 hover:text-adm-t1 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={submitting || proposedRoles.length === 0 || !changeReason.trim()}
                className="px-4 py-2 bg-adm-amber font-mono text-[10px] font-bold uppercase tracking-wider text-gray-950 rounded hover:opacity-90 disabled:opacity-40 transition-opacity"
              >
                {submitting ? 'Submitting...' : 'Submit for Approval'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
