import { useEffect, useRef, useState, type ReactNode } from 'react';
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
import { LinkedRelationCard, LinkedRelationEmpty } from '../components/ui/LinkedRelationCard';
import { PERMISSIONS } from '../rbac/permissions';
import { useAdminSession } from '../contexts/AdminSessionContext';

/* ── Interfaces ──────────────────────────────────────────────── */

interface DeleteRequestDetail {
  id: string;
  requestNo: string;
  targetType: string;
  targetId: string;
  targetNo: string;
  status: string;
  approvalCaseId: string | null;
  approvalNo: string | null;
  createdByUserId: string;
  createdByUserNo: string;
  submittedByUserId: string | null;
  submittedByUserNo: string | null;
  consumedByUserId: string | null;
  consumedByUserNo: string | null;
  deleteReason: string;
  resultNote: string | null;
  docRef: string | null;
  targetSnapshotJson: Record<string, unknown> | null;
  targetSnapshotDigest: string | null;
  traceId: string;
  createdAt: string;
  updatedAt: string;
  submittedAt: string | null;
  consumedAt: string | null;
}

type ModalKind = 'submit' | 'cancel' | 'consume';

const DELETE_REQUEST_STATUSES = {
  DRAFT: 'DRAFT',
  PENDING_APPROVAL: 'PENDING_APPROVAL',
  READY: 'READY',
  DONE: 'DONE',
  FAILED: 'FAILED',
  REJECTED: 'REJECTED',
  CANCELLED: 'CANCELLED',
} as const;

const SUPER_ADMIN_ROLE = 'SUPER_ADMIN';

/* ── Helpers ─────────────────────────────────────────────────── */

const fmt = (v?: string | null): string => {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString();
};

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

/* ── Modal shell ─────────────────────────────────────────────── */

const ModalShell = ({
  title,
  subtitle,
  onClose,
  footer,
  children,
}: {
  title: string;
  subtitle: string;
  onClose: () => void;
  footer: ReactNode;
  children: ReactNode;
}) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
    <div className="w-full max-w-md overflow-hidden rounded-xl border border-adm-border bg-adm-panel shadow-xl">
      <div className="flex items-center justify-between border-b border-adm-border bg-adm-card px-5 py-4">
        <div>
          <p className="font-mono text-[11px] font-semibold text-adm-t1">{title}</p>
          <p className="mt-1 font-mono text-[9px] text-adm-t3">{subtitle}</p>
        </div>
        <button
          onClick={onClose}
          className="rounded p-1 text-adm-t3 hover:bg-adm-hover hover:text-adm-t1"
        >
          <X size={15} />
        </button>
      </div>
      <div className="px-5 py-4 space-y-3">{children}</div>
      <div className="flex justify-end gap-2 border-t border-adm-border bg-adm-card px-5 py-4">
        {footer}
      </div>
    </div>
  </div>
);

/* ─────────────────────────────────────────────────────────────── */

const DeleteRequestDetailPage = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { session, hasAnyPermission } = useAdminSession();

  const canSubmit       = hasAnyPermission([PERMISSIONS.GOV_DELETE_REQUEST_SUBMIT]);
  const canCancel       = hasAnyPermission([PERMISSIONS.GOV_DELETE_REQUEST_CANCEL]);
  const canConsume      = hasAnyPermission([PERMISSIONS.GOV_DELETE_REQUEST_CONSUME]);
  const canViewApproval = hasAnyPermission([PERMISSIONS.GOV_APPROVAL_DETAIL_READ]);
  const isSuperAdmin    = (session?.roles || []).includes(SUPER_ADMIN_ROLE);

  const [detail,  setDetail]  = useState<DeleteRequestDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');
  const [notice,  setNotice]  = useState<string | null>(null);

  /* Modal state */
  const [modal,         setModal]         = useState<ModalKind | null>(null);
  const [modalBusy,     setModalBusy]     = useState(false);
  const [modalReason,   setModalReason]   = useState('');
  const [modalError,    setModalError]    = useState<string | null>(null);

  const requestSeqRef = useRef(0);

  /* ── Fetching ── */

  const fetchDetail = async () => {
    if (!id) { setError('Delete request id is required.'); setLoading(false); return; }
    const seq = ++requestSeqRef.current;
    setLoading(true); setError('');
    try {
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/control-gates/delete-requests/${id}`,
      );
      if (!res.ok) throw new Error(await getApiErrorMessage(res, 'Failed to load delete request.'));
      const data = (await res.json()) as DeleteRequestDetail;
      if (seq !== requestSeqRef.current) return;
      setDetail(data);
    } catch (e: unknown) {
      if (seq !== requestSeqRef.current) return;
      if (e instanceof AdminSessionError) return;
      if (e instanceof AdminPermissionError) {
        setError('Permission denied. You cannot view this delete request.');
      } else {
        setError(e instanceof Error ? e.message : 'Failed to load delete request detail.');
      }
    } finally {
      if (seq === requestSeqRef.current) setLoading(false);
    }
  };

  useEffect(() => { void fetchDetail(); }, [id]);

  /* Auto-dismiss notice */
  useEffect(() => {
    if (!notice) return undefined;
    const t = window.setTimeout(() => setNotice((c) => (c === notice ? null : c)), 4000);
    return () => window.clearTimeout(t);
  }, [notice]);

  /* ── Modal helpers ── */

  const openModal = (kind: ModalKind) => {
    setModal(kind);
    setModalReason('');
    setModalError(null);
  };

  const closeModal = () => {
    setModal(null);
    setModalBusy(false);
    setModalError(null);
    setModalReason('');
  };

  /* ── Actions ── */

  const submitSimpleAction = async (path: ModalKind) => {
    if (!id || !detail) return;
    setModalBusy(true); setModalError(null);
    try {
      const payload: Record<string, unknown> = { traceId: detail.traceId };
      if (modalReason.trim()) payload.reason = modalReason.trim();

      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/control-gates/delete-requests/${id}/${path}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      );
      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, `Failed to ${path} delete request.`));
      }
      closeModal();
      setNotice(
        path === 'submit'
          ? `Delete request ${detail.requestNo} submitted.`
          : path === 'cancel'
            ? `Delete request ${detail.requestNo} cancelled.`
            : `Delete request ${detail.requestNo} consumed.`,
      );
      await fetchDetail();
    } catch (e: unknown) {
      if (e instanceof AdminPermissionError) {
        setModalError(`Permission denied. You cannot ${path} this request.`);
      } else {
        setModalError(e instanceof Error ? e.message : `Failed to ${path} delete request.`);
      }
    } finally {
      setModalBusy(false);
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
            onClick={() => navigate('/dashboard/control-gates/delete-requests')}
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
            onClick={() => navigate('/dashboard/control-gates/delete-requests')}
            className={adminButtonClass('detailUtility')}
          >
            ← Back
          </button>
        </div>
        <div className="px-6 py-6 font-mono text-[11px] text-adm-t3">Delete request not found.</div>
      </div>
    );
  }

  /* ── Derived ── */

  const status           = detail.status;
  const isMaker          = session?.id === detail.createdByUserId;
  const canSubmitAction  = canSubmit && isMaker && status === DELETE_REQUEST_STATUSES.DRAFT;
  const canCancelAction  =
    canCancel &&
    (isMaker || isSuperAdmin) &&
    (status === DELETE_REQUEST_STATUSES.DRAFT ||
      status === DELETE_REQUEST_STATUSES.PENDING_APPROVAL ||
      status === DELETE_REQUEST_STATUSES.READY);
  const canConsumeAction =
    canConsume &&
    status === DELETE_REQUEST_STATUSES.READY &&
    (!isMaker || isSuperAdmin);

  const hasSubmission   = !!(detail.submittedByUserNo || detail.submittedAt);
  const hasConsumption  = !!(detail.consumedByUserNo || detail.consumedAt || detail.resultNote);
  const hasSnapshot     = !!(detail.targetSnapshotDigest || detail.targetSnapshotJson);

  const showActionsBlock =
    canSubmitAction || canCancelAction || canConsumeAction;

  const modalTitle: Record<ModalKind, string> = {
    submit:  'Submit Delete Request',
    cancel:  'Cancel Delete Request',
    consume: 'Consume Delete Request',
  };
  const modalIntro: Record<ModalKind, string> = {
    submit:  'Submitting routes this request through approval.',
    cancel:  'Cancelling withdraws the request without executing deletion.',
    consume: 'Consuming records that the governed deletion was executed.',
  };
  const confirmVariant: Record<ModalKind, 'workflowPrimary' | 'workflowNegative'> = {
    submit:  'workflowPrimary',
    cancel:  'workflowNegative',
    consume: 'workflowPrimary',
  };
  const confirmLabel: Record<ModalKind, string> = {
    submit:  'Submit',
    cancel:  'Cancel Request',
    consume: 'Consume',
  };
  const busyLabel: Record<ModalKind, string> = {
    submit:  'Submitting…',
    cancel:  'Cancelling…',
    consume: 'Consuming…',
  };

  /* ── Page ── */

  return (
    <div className="flex h-full flex-col overflow-hidden">

      {/* ── Sticky nav header ── */}
      <DetailPageHeader
        title="Delete Request"
        onBack={() => navigate('/dashboard/control-gates/delete-requests')}
        onRefresh={() => void fetchDetail()}
        refreshing={loading}
        backLabel="Delete Requests"
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

          {/* ① Identity — requestNo dominant, status, then secondary details */}
          <section className="bg-adm-card px-6 py-5">
            <Cap>Delete Request</Cap>
            <p className="mt-1.5 font-mono text-[19px] font-bold leading-snug text-adm-amber">
              {detail.requestNo}
            </p>
            <div className="mt-2.5">
              <AdminBadge value={detail.status} />
            </div>
            <div className="mt-4 border-t border-adm-border pt-4">
              <p className="font-mono text-[11px] text-adm-t2">{detail.targetType}</p>
              <p className="mt-1.5 break-all font-mono text-[9px] text-adm-t3">{detail.id}</p>
            </div>
          </section>

          {/* ② Approval — governance relationship (content, not action) */}
          <section className="px-6 py-5">
            <Cap>Approval</Cap>
            <p className="mt-1 mb-4 font-mono text-[9px] text-adm-t3">
              Governance case routing this request through approval
            </p>
            {detail.approvalCaseId && detail.approvalNo ? (
              <LinkedRelationCard
                cap="Approval Case"
                identifier={detail.approvalNo}
                onClick={
                  canViewApproval
                    ? () =>
                        navigate(`/dashboard/control-gates/approvals/${detail.approvalCaseId}`)
                    : undefined
                }
              />
            ) : (
              <LinkedRelationEmpty
                cap="Approval Case"
                message="No approval yet — submit this request to open an approval case."
              />
            )}
          </section>

          {/* ③ Target Reference */}
          <section className="px-6 py-5">
            <Cap>Target Reference</Cap>
            <div className="mt-3">
              <FieldGrid>
                <Field label="Target Type"   value={detail.targetType}   />
                <Field label="Target No"     value={detail.targetNo}     mono />
                <Field label="Target ID"     value={detail.targetId}     mono full />
                <Field label="Delete Reason" value={detail.deleteReason} full />
                <Field label="Doc Ref"       value={detail.docRef}       mono />
              </FieldGrid>
            </div>
          </section>

          {/* ③ Target Snapshot */}
          {hasSnapshot && (
            <section className="px-6 py-5">
              <Cap>Target Snapshot</Cap>
              <p className="mt-1 mb-4 font-mono text-[9px] text-adm-t3">
                Frozen state of the target captured at request time
              </p>
              <div className="rounded border border-adm-border bg-adm-bg p-4 space-y-4">
                {detail.targetSnapshotDigest && (
                  <div>
                    <p className="mb-1 font-mono text-[8.5px] uppercase tracking-[0.14em] text-adm-t3">
                      Snapshot Digest
                    </p>
                    <p className="break-all font-mono text-[10px] text-adm-t2">
                      {detail.targetSnapshotDigest}
                    </p>
                  </div>
                )}
                {detail.targetSnapshotJson && (
                  <JsonBlock title="Target Snapshot JSON" value={detail.targetSnapshotJson} />
                )}
              </div>
            </section>
          )}

          {/* ④ Consumption Result */}
          {hasConsumption && (
            <section className="px-6 py-5">
              <Cap>Consumption Result</Cap>
              <div className="mt-3">
                <FieldGrid>
                  <Field label="Consumed By" value={detail.consumedByUserNo} mono />
                  <Field label="Consumed At" value={fmt(detail.consumedAt)}  mono />
                  <Field label="Result Note" value={detail.resultNote}       full />
                </FieldGrid>
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
                {canSubmitAction && (
                  <button
                    onClick={() => openModal('submit')}
                    className={adminButtonClass('workflowPrimary')}
                  >
                    Submit Request
                  </button>
                )}
                {canConsumeAction && (
                  <button
                    onClick={() => openModal('consume')}
                    className={adminButtonClass('workflowPrimary')}
                  >
                    Consume Request
                  </button>
                )}
                {canCancelAction && (
                  <button
                    onClick={() => openModal('cancel')}
                    className={adminButtonClass('workflowNegative')}
                  >
                    Cancel Request
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Maker */}
          <SidebarGroup title="Maker">
            <SidebarKV label="User No" value={detail.createdByUserNo}               />
            <SidebarKV label="User ID" value={detail.createdByUserId}        mono   />
            <SidebarKV label="Created" value={fmt(detail.createdAt)}         mono   />
          </SidebarGroup>

          {/* Submission */}
          {hasSubmission && (
            <SidebarGroup title="Submission">
              <SidebarKV label="Submitted By" value={detail.submittedByUserNo}       />
              <SidebarKV label="User ID"      value={detail.submittedByUserId} mono  />
              <SidebarKV label="Submitted At" value={fmt(detail.submittedAt)}  mono  />
            </SidebarGroup>
          )}

          {/* Governance */}
          <SidebarGroup title="Governance">
            <SidebarKV label="Approval No"   value={detail.approvalNo}     mono />
            <SidebarKV label="Approval Case" value={detail.approvalCaseId} mono />
            <SidebarKV label="Trace ID"      value={detail.traceId}        mono />
          </SidebarGroup>

          {/* Lifecycle */}
          <SidebarGroup title="Lifecycle">
            <SidebarKV label="Updated" value={fmt(detail.updatedAt)} mono />
          </SidebarGroup>

        </div>
      </div>

      {/* ════ Action Modal ════ */}
      {modal && (
        <ModalShell
          title={modalTitle[modal]}
          subtitle={`${detail.requestNo} · ${detail.targetType}`}
          onClose={closeModal}
          footer={
            <>
              <button onClick={closeModal} className={adminButtonClass('modalCancel')}>
                Close
              </button>
              <button
                onClick={() => void submitSimpleAction(modal)}
                disabled={modalBusy}
                className={adminButtonClass(confirmVariant[modal])}
              >
                {modalBusy ? busyLabel[modal] : confirmLabel[modal]}
              </button>
            </>
          }
        >
          <p className="font-mono text-[10px] text-adm-t3">{modalIntro[modal]}</p>
          <div>
            <p className="mb-1.5 font-mono text-[8.5px] uppercase tracking-[0.14em] text-adm-t3">
              Operator Note (optional)
            </p>
            <textarea
              value={modalReason}
              onChange={(e) => setModalReason(e.target.value)}
              rows={4}
              placeholder="Record any context for the audit trail."
              className="w-full rounded border border-adm-border bg-adm-bg px-3 py-2 font-mono text-[10px] text-adm-t2 placeholder:text-adm-t3 focus:border-adm-amber focus:outline-none resize-none transition-colors"
              autoFocus
            />
          </div>
          {modalError && (
            <div className="rounded border border-adm-red/30 bg-adm-red/10 px-3 py-2 font-mono text-[10px] text-adm-red">
              {modalError}
            </div>
          )}
        </ModalShell>
      )}

    </div>
  );
};

export default DeleteRequestDetailPage;
