import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { RefreshCw, X } from 'lucide-react';
import {
  AdminPermissionError,
  AdminSessionError,
  adminFetch,
  getApiErrorMessage,
} from '../utils/adminFetch';
import {
  DetailPageHeader,
  JsonBlock,
} from '../components/compliance/DetailPageComponents';
import { adminButtonClass } from '../components/common/adminButtonStyles';
import { AdminBadge } from '../components/ui/AdminBadge';
import { PERMISSIONS } from '../rbac/permissions';
import { useAdminSession } from '../contexts/AdminSessionContext';

/* ── Interfaces ──────────────────────────────────────────────── */

interface ApprovalDetail {
  id: string;
  approvalNo: string;
  actionType: string;
  entityRef: string;
  createdByUserId: string;
  createdByUserNo?: string | null;
  status: string;
  allowCancel: boolean;
  objectSnapshot?: Record<string, unknown> | null;
  traceId: string;
  submittedAt?: string | null;
  timeoutAt?: string | null;
  createdAt: string;
  updatedAt: string;
  availableDecisionRoles: string[];
  canApprove: boolean;
  canReject: boolean;
  canCancel: boolean;
  step?: ApprovalStepItem | null;
  steps?: ApprovalStepItem[];
}

interface ApprovalStepItem {
  id: string;
  approvalNo?: string | null;
  stepNo: number;
  status: string;
  checkerRoleCandidates: string[];
  decidedByUserNo?: string | null;
  decidedByRole?: string | null;
  reason?: string | null;
  decidedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  evidencePackage?: {
    id: string;
    packageNo: string;
    status: string;
  } | null;
  caseEvidencePackage?: {
    id: string;
    packageNo: string;
    status: string;
  } | null;
  availableDecisionRoles: string[];
  canApprove: boolean;
  canReject: boolean;
  canCancel: boolean;
}

type DecisionAction = 'approve' | 'reject' | 'cancel';

/* ── Helpers ─────────────────────────────────────────────────── */

const fmt = (v?: string | null): string => {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString();
};

const joinOrDash = (arr?: string[] | null): string =>
  arr && arr.length > 0 ? arr.join(', ') : '—';

/* ── Shared layout primitives ────────────────────────────────── */

const Cap = ({ children }: { children: ReactNode }) => (
  <p className="font-mono text-[8.5px] font-semibold uppercase tracking-[0.16em] text-adm-t3">
    {children}
  </p>
);

const FieldGrid = ({ children, cols = 2 }: { children: ReactNode; cols?: 1 | 2 }) => (
  <div
    className={[
      'grid gap-x-8 gap-y-4',
      cols === 1 ? 'grid-cols-1' : 'grid-cols-2',
    ].join(' ')}
  >
    {children}
  </div>
);

const Field = ({
  label,
  value,
  mono = false,
  amber = false,
  full = false,
}: {
  label: string;
  value?: string | null;
  mono?: boolean;
  amber?: boolean;
  full?: boolean;
}) => {
  if (!value) return null;
  return (
    <div className={full ? 'col-span-2' : ''}>
      <p className="mb-1 font-mono text-[8.5px] uppercase tracking-[0.14em] text-adm-t3">
        {label}
      </p>
      <p
        className={[
          'break-all leading-relaxed',
          mono ? 'font-mono text-[10px]' : 'text-[11px]',
          amber ? 'font-semibold text-adm-amber' : 'text-adm-t2',
        ].join(' ')}
      >
        {value}
      </p>
    </div>
  );
};

/* ── Sidebar primitives ──────────────────────────────────────── */

const SidebarGroup = ({ title, children }: { title: string; children: ReactNode }) => (
  <div className="border-b border-adm-border py-4 last:border-b-0">
    <Cap>{title}</Cap>
    <div className="mt-2.5 flex flex-col gap-1.5">{children}</div>
  </div>
);

const SidebarKV = ({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: ReactNode;
  mono?: boolean;
}) => {
  if (value === null || value === undefined || value === '' || value === '—') return null;
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="shrink-0 font-mono text-[9px] text-adm-t3">{label}</span>
      <span
        className={[
          'min-w-0 break-all text-right text-adm-t2',
          mono ? 'font-mono text-[10px]' : 'text-[11px]',
        ].join(' ')}
      >
        {value}
      </span>
    </div>
  );
};

/* ─────────────────────────────────────────────────────────────── */

const ApprovalDetailPage = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { hasAnyPermission } = useAdminSession();

  const canDecide          = hasAnyPermission([
    PERMISSIONS.GOV_APPROVAL_APPROVE,
    PERMISSIONS.GOV_APPROVAL_REJECT,
  ]);
  const canCancelPermission = hasAnyPermission([PERMISSIONS.GOV_APPROVAL_CANCEL]);

  const [detail,  setDetail]  = useState<ApprovalDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');
  const [notice,  setNotice]  = useState<string | null>(null);

  /* Decision modal */
  const [decisionAction, setDecisionAction] = useState<DecisionAction | null>(null);
  const [decisionReason, setDecisionReason] = useState('');
  const [decisionRole,   setDecisionRole]   = useState('');
  const [submittingAction, setSubmittingAction] = useState<DecisionAction | null>(null);
  const [decisionError,    setDecisionError]    = useState<string | null>(null);

  /* ── Fetching ── */

  const fetchJson = async <T,>(url: string, init?: RequestInit): Promise<T> => {
    const response = await adminFetch(url, init);
    if (!response.ok) {
      throw new Error(await getApiErrorMessage(response, 'Request failed.'));
    }
    return (await response.json()) as T;
  };

  const fetchDetail = async () => {
    if (!id) { setError('Approval id is required.'); setLoading(false); return; }
    setLoading(true); setError('');
    try {
      const payload = await fetchJson<ApprovalDetail>(
        `${import.meta.env.VITE_API_URL}/admin/control-gates/approvals/${id}`,
      );
      setDetail(payload);
      setDecisionRole(
        payload.availableDecisionRoles.length === 1 ? payload.availableDecisionRoles[0] : '',
      );
    } catch (e: unknown) {
      if (e instanceof AdminSessionError) return;
      if (e instanceof AdminPermissionError) {
        setError('Permission denied. You cannot view this approval.');
      } else {
        setError(e instanceof Error ? e.message : 'Failed to load approval detail.');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void fetchDetail(); }, [id]);

  /* Auto-dismiss notice */
  useEffect(() => {
    if (!notice) return undefined;
    const t = window.setTimeout(
      () => setNotice((c) => (c === notice ? null : c)),
      4000,
    );
    return () => window.clearTimeout(t);
  }, [notice]);

  /* ── Decision modal ── */

  const openDecisionModal = (action: DecisionAction) => {
    setDecisionAction(action);
    setDecisionReason('');
    setDecisionError(null);
    setDecisionRole(
      detail?.availableDecisionRoles.length === 1
        ? detail.availableDecisionRoles[0]
        : '',
    );
  };

  const closeDecisionModal = () => {
    setDecisionAction(null);
    setDecisionReason('');
    setDecisionError(null);
  };

  const submitDecision = async () => {
    if (!id || !decisionAction) return;
    const action = decisionAction;
    setSubmittingAction(action);
    setDecisionError(null);
    try {
      const payload: Record<string, unknown> = {};
      if (decisionReason.trim()) payload.reason = decisionReason.trim();
      if (action !== 'cancel' && decisionRole) payload.checkerRole = decisionRole;

      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/control-gates/approvals/${id}/${action}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      );
      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, `Failed to ${action} approval.`));
      }

      closeDecisionModal();
      setNotice(
        action === 'approve'
          ? `Approval ${detail?.approvalNo ?? id} approved.`
          : action === 'reject'
            ? `Approval ${detail?.approvalNo ?? id} rejected.`
            : `Approval ${detail?.approvalNo ?? id} cancelled.`,
      );
      await fetchDetail();
    } catch (e: unknown) {
      if (e instanceof AdminPermissionError) {
        setDecisionError(`Permission denied. You cannot ${action} this approval.`);
      } else {
        setDecisionError(e instanceof Error ? e.message : `Failed to ${action} approval.`);
      }
    } finally {
      setSubmittingAction(null);
    }
  };

  /* ── Loading / error stubs ── */

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center gap-3">
        <RefreshCw size={24} className="animate-spin text-adm-amber" />
        <p className="font-mono text-[11px] text-adm-t3">Loading…</p>
      </div>
    );
  }

  if (error && !detail) {
    return (
      <div className="flex h-full flex-col overflow-hidden">
        <div className="shrink-0 border-b border-adm-border bg-adm-panel px-6 py-4 flex items-center gap-2">
          <button
            onClick={() => navigate('/admin/governance/approvals')}
            className={adminButtonClass('detailUtility')}
          >
            ← Back
          </button>
          <button
            onClick={() => void fetchDetail()}
            className={adminButtonClass('detailUtility')}
          >
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

  if (!detail) {
    return (
      <div className="flex h-full flex-col overflow-hidden">
        <div className="shrink-0 border-b border-adm-border bg-adm-panel px-6 py-4">
          <button
            onClick={() => navigate('/admin/governance/approvals')}
            className={adminButtonClass('detailUtility')}
          >
            ← Back
          </button>
        </div>
        <div className="px-6 py-6 font-mono text-[11px] text-adm-t3">Approval not found.</div>
      </div>
    );
  }

  /* ── Derived ── */

  const allSteps             = detail.steps || (detail.step ? [detail.step] : []);
  const hasSteps             = allSteps.length > 0;
  const showActionsBlock =
    (detail.canApprove && canDecide) ||
    (detail.canReject && canDecide) ||
    (detail.canCancel && canCancelPermission);

  const modalTitle: Record<DecisionAction, string> = {
    approve: 'Approve Request',
    reject:  'Reject Request',
    cancel:  'Cancel Request',
  };
  const modalIntro: Record<DecisionAction, string> = {
    approve: 'Approving advances this case to execution.',
    reject:  'Rejecting terminates this case with a recorded reason.',
    cancel:  'Cancelling withdraws this case without a decision.',
  };
  const confirmVariant: Record<DecisionAction, 'workflowPrimary' | 'workflowNegative' | 'modalConfirm'> = {
    approve: 'workflowPrimary',
    reject:  'workflowNegative',
    cancel:  'modalConfirm',
  };
  const confirmLabel: Record<DecisionAction, string> = {
    approve: 'Approve',
    reject:  'Reject',
    cancel:  'Cancel Request',
  };
  const busyLabel: Record<DecisionAction, string> = {
    approve: 'Approving…',
    reject:  'Rejecting…',
    cancel:  'Cancelling…',
  };

  /* ── Page ── */

  return (
    <div className="flex h-full flex-col overflow-hidden">

      {/* ── Sticky nav header ── */}
      <DetailPageHeader
        onBack={() => navigate('/admin/governance/approvals')}
        onRefresh={() => void fetchDetail()}
        refreshing={loading}
        backLabel="Approvals"
      />

      {/* ── Inline notices ── */}
      {(notice || error) && (
        <div className="shrink-0 px-6 pt-3 pb-1 space-y-2">
          {notice && (
            <div className="rounded border border-adm-green/30 bg-adm-green/10 px-4 py-2 font-mono text-[11px] text-adm-green">
              {notice}
            </div>
          )}
          {error && (
            <div className="rounded border border-adm-red/30 bg-adm-red/10 px-4 py-2 font-mono text-[11px] text-adm-red">
              {error}
            </div>
          )}
        </div>
      )}

      {/* ── Body ── */}
      <div className="flex min-h-0 flex-1 overflow-hidden">

        {/* ════ LEFT MAIN ════ */}
        <div className="flex min-w-0 flex-1 flex-col divide-y divide-adm-border overflow-y-auto">

          {/* ① Identity */}
          <section className="bg-adm-card px-6 py-5">
            <p className="font-mono text-[19px] font-bold leading-snug text-adm-amber">
              {detail.approvalNo}
            </p>
            <div className="mt-4 border-t border-adm-border pt-4 grid grid-cols-2 gap-x-8 gap-y-3">
              <div>
                <p className="mb-1 font-mono text-[8.5px] uppercase tracking-[0.14em] text-adm-t3">Status</p>
                <AdminBadge value={detail.status} />
              </div>
              <div className="col-span-2">
                <p className="mb-1 font-mono text-[8.5px] uppercase tracking-[0.14em] text-adm-t3">Action Type</p>
                <p className="font-mono text-[11px] text-adm-t2">{detail.actionType}</p>
              </div>
            </div>
          </section>

          {/* ② Core Context */}
          <section className="px-6 py-5">
            <Cap>Core Context</Cap>
            <div className="mt-3">
              <FieldGrid>
                <Field label="Entity Ref"            value={detail.entityRef}           mono full />
              </FieldGrid>
            </div>
          </section>

          {/* ③ Approval Steps */}
          {hasSteps && (
            <section className="px-6 py-5">
              <Cap>Approval Steps</Cap>
              <p className="mt-1 mb-4 font-mono text-[9px] text-adm-t3">
                Sequential sign-off chain — each step must be approved in order
              </p>
              <div className="space-y-3">
                {allSteps.map((s) => {
                  const isPending = s.status === 'PENDING';
                  const isApproved = s.status === 'APPROVED';
                  return (
                    <div
                      key={s.id}
                      className={[
                        'rounded border p-4',
                        isPending
                          ? 'border-adm-amber/40 bg-adm-amber/5'
                          : isApproved
                            ? 'border-adm-green/30 bg-adm-green/5'
                            : 'border-adm-border bg-adm-bg',
                      ].join(' ')}
                    >
                      <div className="flex items-center gap-3 mb-3">
                        <span className="font-mono text-[10px] font-semibold text-adm-t2">
                          Step {s.stepNo}
                        </span>
                        <AdminBadge value={s.status} />
                        <span className="font-mono text-[10px] text-adm-t3">
                          {joinOrDash(s.checkerRoleCandidates)}
                        </span>
                      </div>
                      {(s.decidedByUserNo || s.decidedByRole || s.decidedAt || s.reason) && (
                        <FieldGrid>
                          <Field label="Decided By" value={s.decidedByUserNo} mono />
                          <Field label="Decided Role" value={s.decidedByRole} />
                          <Field label="Decided At" value={fmt(s.decidedAt)} mono />
                          <Field label="Reason" value={s.reason} full />
                        </FieldGrid>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* ④ Technical Detail */}
          {(detail.traceId || (detail.objectSnapshot && Object.keys(detail.objectSnapshot).length > 0)) && (
            <section className="px-6 py-5">
              <Cap>Technical Detail</Cap>
              <div className="mt-3 space-y-4">
                <FieldGrid>
                  <Field label="Trace ID"      value={detail.traceId}           mono     />
                  <Field label="Allow Cancel"  value={detail.allowCancel ? 'YES' : 'NO'} />
                </FieldGrid>
                {detail.objectSnapshot && Object.keys(detail.objectSnapshot).length > 0 && (
                  <div className="rounded border border-adm-border bg-adm-bg p-4">
                    <JsonBlock title="objectSnapshot" value={detail.objectSnapshot} />
                  </div>
                )}
              </div>
            </section>
          )}

        </div>

        {/* ════ RIGHT SIDEBAR ════ */}
        <div className="w-[272px] min-w-[272px] overflow-y-auto border-l border-adm-border bg-adm-panel px-4 py-1">

          {/* Actions */}
          {showActionsBlock && (
            <div className="border-b border-adm-border py-4">
              <Cap>Actions</Cap>
              <div className="mt-2.5 flex flex-col gap-2">
                {detail.canApprove && canDecide && (
                  <button
                    onClick={() => openDecisionModal('approve')}
                    className={adminButtonClass('workflowPrimary')}
                  >
                    Approve
                  </button>
                )}
                {detail.canReject && canDecide && (
                  <button
                    onClick={() => openDecisionModal('reject')}
                    className={adminButtonClass('workflowNegative')}
                  >
                    Reject
                  </button>
                )}
                {detail.canCancel && canCancelPermission && (
                  <button
                    onClick={() => openDecisionModal('cancel')}
                    className={adminButtonClass('detailUtility')}
                  >
                    Cancel Request
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Identity Summary */}
          <SidebarGroup title="Identity Summary">
            <SidebarKV label="Submitted By"  value={detail.createdByUserNo}       mono   />
          </SidebarGroup>

          {/* Lifecycle */}
          <SidebarGroup title="Lifecycle">
            <SidebarKV label="Submitted" value={fmt(detail.submittedAt)} mono />
            <SidebarKV label="Timeout"   value={fmt(detail.timeoutAt)}   mono />
            <SidebarKV label="Updated"   value={fmt(detail.updatedAt)}   mono />
          </SidebarGroup>

        </div>
      </div>

      {/* ════ Decision Modal ════ */}
      {decisionAction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md overflow-hidden rounded-xl border border-adm-border bg-adm-panel shadow-xl">

            {/* Header */}
            <div className="flex items-center justify-between border-b border-adm-border bg-adm-card px-5 py-4">
              <div>
                <p className="font-mono text-[11px] font-semibold text-adm-t1">
                  {modalTitle[decisionAction]}
                </p>
                <p className="mt-1 font-mono text-[9px] text-adm-t3">
                  {detail.approvalNo} · {detail.actionType}
                </p>
              </div>
              <button
                onClick={closeDecisionModal}
                className="rounded p-1 text-adm-t3 hover:bg-adm-hover hover:text-adm-t1"
              >
                <X size={15} />
              </button>
            </div>

            {/* Body */}
            <div className="px-5 py-4 space-y-3">
              <p className="font-mono text-[10px] text-adm-t3">
                {modalIntro[decisionAction]}
              </p>

              {decisionAction !== 'cancel' && detail.availableDecisionRoles.length > 0 && (
                <div>
                  <p className="mb-1.5 font-mono text-[8.5px] uppercase tracking-[0.14em] text-adm-t3">
                    Checker Role
                  </p>
                  <select
                    value={decisionRole}
                    onChange={(e) => setDecisionRole(e.target.value)}
                    disabled={detail.availableDecisionRoles.length <= 1}
                    className="h-[32px] w-full rounded border border-adm-border bg-adm-bg px-3 font-mono text-[11px] text-adm-t1 outline-none focus:border-adm-amber transition-colors"
                  >
                    <option value="">Auto select</option>
                    {detail.availableDecisionRoles.map((role) => (
                      <option key={role} value={role}>{role}</option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <p className="mb-1.5 font-mono text-[8.5px] uppercase tracking-[0.14em] text-adm-t3">
                  Reason {decisionAction === 'reject' ? '' : '(optional)'}
                </p>
                <textarea
                  value={decisionReason}
                  onChange={(e) => setDecisionReason(e.target.value)}
                  rows={4}
                  placeholder={
                    decisionAction === 'approve'
                      ? 'Optional note explaining the approval.'
                      : decisionAction === 'reject'
                        ? 'Explain why this case is rejected.'
                        : 'Optional cancellation note.'
                  }
                  className="w-full rounded border border-adm-border bg-adm-bg px-3 py-2 font-mono text-[10px] text-adm-t2 placeholder:text-adm-t3 focus:border-adm-amber focus:outline-none resize-none transition-colors"
                  autoFocus
                />
              </div>

              {decisionError && (
                <div className="rounded border border-adm-red/30 bg-adm-red/10 px-3 py-2 font-mono text-[10px] text-adm-red">
                  {decisionError}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex justify-end gap-2 border-t border-adm-border bg-adm-card px-5 py-4">
              <button onClick={closeDecisionModal} className={adminButtonClass('modalCancel')}>
                Close
              </button>
              <button
                onClick={() => void submitDecision()}
                disabled={
                  submittingAction !== null ||
                  (decisionAction === 'reject' && !decisionReason.trim())
                }
                className={adminButtonClass(confirmVariant[decisionAction])}
              >
                {submittingAction === decisionAction
                  ? busyLabel[decisionAction]
                  : confirmLabel[decisionAction]}
              </button>
            </div>

          </div>
        </div>
      )}

    </div>
  );
};

export default ApprovalDetailPage;
