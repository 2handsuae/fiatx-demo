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

interface ChangeTicketDetail {
  id: string;
  ticketNo: string;
  status: string;
  changeType: string | null;
  changeReason: string | null;
  scopeSummary: string | null;
  testEvidenceRef: string | null;
  rollbackPlanRef: string | null;
  bindingSnapshotJson: Record<string, unknown> | null;
  bindingDigest: string | null;
  approvalCaseId: string | null;
  approvalNo: string | null;
  traceId: string;
  createdByUserId: string;
  createdByUserNo: string;
  submittedByUserId: string | null;
  submittedByUserNo: string | null;
  consumedByUserId: string | null;
  consumedByUserNo: string | null;
  submittedAt: string | null;
  consumedAt: string | null;
  resultNote: string | null;
  createdAt: string;
  updatedAt: string;
}

type ModalKind = 'submit' | 'consume';

/* ── Helpers ─────────────────────────────────────────────────── */

const fmt = (v?: string | null): string => {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString();
};

const SUBMITTABLE_STATUSES = ['DRAFT'] as const;
const CONSUMABLE_STATUSES  = ['READY'] as const;

const CONSUME_RESULT_SUCCESS = 'success' as const;
const CONSUME_RESULT_FAILURE = 'failure' as const;

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

const ChangeTicketDetailPage = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { hasAnyPermission } = useAdminSession();

  const canSubmit          = hasAnyPermission([PERMISSIONS.GOV_CHANGE_TICKET_SUBMIT]);
  const canConsume         = hasAnyPermission([PERMISSIONS.GOV_CHANGE_TICKET_CONSUME]);
  const canViewApproval    = hasAnyPermission([PERMISSIONS.GOV_APPROVAL_DETAIL_READ]);

  const [detail,  setDetail]  = useState<ChangeTicketDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');
  const [notice,  setNotice]  = useState<string | null>(null);

  /* Modal state */
  const [modal, setModal] = useState<ModalKind | null>(null);
  const [modalBusy, setModalBusy]       = useState(false);
  const [modalError, setModalError]     = useState<string | null>(null);

  /* Modal form fields */
  const [consumeResult, setConsumeResult] = useState<typeof CONSUME_RESULT_SUCCESS | typeof CONSUME_RESULT_FAILURE>(CONSUME_RESULT_SUCCESS);
  const [consumeNote, setConsumeNote]     = useState('');

  const requestSeqRef = useRef(0);

  /* ── Fetching ── */

  const fetchDetail = async () => {
    if (!id) { setError('Change ticket id is required.'); setLoading(false); return; }
    const seq = ++requestSeqRef.current;
    setLoading(true); setError('');
    try {
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/control-gates/change-tickets/${id}`,
      );
      if (!res.ok) throw new Error(await getApiErrorMessage(res, 'Failed to load change ticket.'));

      const data = (await res.json()) as ChangeTicketDetail;
      if (seq !== requestSeqRef.current) return;
      setDetail(data);
    } catch (e: unknown) {
      if (seq !== requestSeqRef.current) return;
      if (e instanceof AdminSessionError) return;
      if (e instanceof AdminPermissionError) {
        setError('Permission denied. You cannot view this ticket.');
      } else {
        setError(e instanceof Error ? e.message : 'Failed to load change ticket detail.');
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
    setModalError(null);
    if (kind === 'consume') {
      setConsumeResult(CONSUME_RESULT_SUCCESS);
      setConsumeNote('');
    }
    setModal(kind);
  };

  const closeModal = () => {
    setModal(null);
    setModalBusy(false);
    setModalError(null);
  };

  /* ── Actions ── */

  const submitChangeTicket = async () => {
    if (!id || !detail) return;
    setModalBusy(true); setModalError(null);
    try {
      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/control-gates/change-tickets/${id}/submit`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ traceId: detail.traceId }),
        },
      );
      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, 'Failed to submit change ticket.'));
      }
      closeModal();
      setNotice(`Change ticket ${detail.ticketNo} submitted.`);
      await fetchDetail();
    } catch (e: unknown) {
      if (e instanceof AdminPermissionError) {
        setModalError('Permission denied. You cannot submit this ticket.');
      } else {
        setModalError(e instanceof Error ? e.message : 'Failed to submit change ticket.');
      }
    } finally {
      setModalBusy(false);
    }
  };

  const consumeChangeTicket = async () => {
    if (!id || !detail) return;
    setModalBusy(true); setModalError(null);
    try {
      const note = consumeNote.trim();
      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/control-gates/change-tickets/${id}/consume`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            success: consumeResult === CONSUME_RESULT_SUCCESS,
            ...(note ? { note } : {}),
            traceId: detail.traceId,
          }),
        },
      );
      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, 'Failed to consume change ticket.'));
      }
      closeModal();
      setNotice(
        consumeResult === CONSUME_RESULT_SUCCESS
          ? `Change ticket ${detail.ticketNo} consumed.`
          : `Change ticket ${detail.ticketNo} marked as failed.`,
      );
      await fetchDetail();
    } catch (e: unknown) {
      if (e instanceof AdminPermissionError) {
        setModalError('Permission denied. You cannot consume this ticket.');
      } else {
        setModalError(e instanceof Error ? e.message : 'Failed to consume change ticket.');
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
            onClick={() => navigate('/dashboard/control-gates/change-tickets')}
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
            onClick={() => navigate('/dashboard/control-gates/change-tickets')}
            className={adminButtonClass('detailUtility')}
          >
            ← Back
          </button>
        </div>
        <div className="px-6 py-6 font-mono text-[11px] text-adm-t3">Change ticket not found.</div>
      </div>
    );
  }

  /* ── Derived ── */

  const canSubmitAction  = canSubmit && SUBMITTABLE_STATUSES.includes(detail.status as (typeof SUBMITTABLE_STATUSES)[number]);
  const canConsumeAction = canConsume && CONSUMABLE_STATUSES.includes(detail.status as (typeof CONSUMABLE_STATUSES)[number]);
  const hasSubmission    = !!(detail.submittedByUserNo || detail.submittedAt);
  const hasConsumption   = !!(detail.consumedByUserNo || detail.consumedAt || detail.resultNote);
  const hasBinding       = !!(detail.bindingDigest || detail.bindingSnapshotJson);

  const showActionsBlock =
    canSubmitAction || canConsumeAction;

  /* ── Page ── */

  return (
    <div className="flex h-full flex-col overflow-hidden">

      {/* ── Sticky nav header ── */}
      <DetailPageHeader
        title="Change Ticket"
        onBack={() => navigate('/dashboard/control-gates/change-tickets')}
        onRefresh={() => void fetchDetail()}
        refreshing={loading}
        backLabel="Change Tickets"
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

          {/* ① Identity — ticketNo dominant, status, then secondary details */}
          <section className="bg-adm-card px-6 py-5">
            <Cap>Change Ticket</Cap>
            <p className="mt-1.5 font-mono text-[19px] font-bold leading-snug text-adm-amber">
              {detail.ticketNo}
            </p>
            <div className="mt-2.5">
              <AdminBadge value={detail.status} />
            </div>
            <div className="mt-4 border-t border-adm-border pt-4">
              <p className="font-mono text-[11px] text-adm-t2">{detail.changeType ?? '—'}</p>
              <p className="mt-1.5 break-all font-mono text-[9px] text-adm-t3">{detail.id}</p>
            </div>
          </section>

          {/* ② Approval — governance relationship (content, not action) */}
          <section className="px-6 py-5">
            <Cap>Approval</Cap>
            <p className="mt-1 mb-4 font-mono text-[9px] text-adm-t3">
              Governance case routing this ticket through approval
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
                message="No approval yet — submit this ticket to open an approval case."
              />
            )}
          </section>

          {/* ③ Change Scope */}
          <section className="px-6 py-5">
            <Cap>Change Scope</Cap>
            <div className="mt-3">
              <FieldGrid>
                <Field label="Change Reason"     value={detail.changeReason}    full />
                <Field label="Scope Summary"     value={detail.scopeSummary}    full />
                <Field label="Test Evidence Ref" value={detail.testEvidenceRef} mono />
                <Field label="Rollback Plan Ref" value={detail.rollbackPlanRef} mono />
              </FieldGrid>
            </div>
          </section>

          {/* ③ Binding Snapshot */}
          {hasBinding && (
            <section className="px-6 py-5">
              <Cap>Binding Snapshot</Cap>
              <p className="mt-1 mb-4 font-mono text-[9px] text-adm-t3">
                Immutable state captured when this ticket was authored
              </p>
              <div className="rounded border border-adm-border bg-adm-bg p-4 space-y-4">
                {detail.bindingDigest && (
                  <div>
                    <p className="mb-1 font-mono text-[8.5px] uppercase tracking-[0.14em] text-adm-t3">
                      Binding Digest
                    </p>
                    <p className="break-all font-mono text-[10px] text-adm-t2">
                      {detail.bindingDigest}
                    </p>
                  </div>
                )}
                {detail.bindingSnapshotJson && (
                  <JsonBlock title="Binding Snapshot JSON" value={detail.bindingSnapshotJson} />
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
                  <Field label="Consumed At" value={fmt(detail.consumedAt)}   mono />
                  <Field label="Result Note" value={detail.resultNote}        full />
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
                    Submit Ticket
                  </button>
                )}
                {canConsumeAction && (
                  <button
                    onClick={() => openModal('consume')}
                    className={adminButtonClass('workflowPrimary')}
                  >
                    Consume Ticket
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Maker */}
          <SidebarGroup title="Maker">
            <SidebarKV label="User No" value={detail.createdByUserNo}                />
            <SidebarKV label="User ID" value={detail.createdByUserId}         mono   />
            <SidebarKV label="Created" value={fmt(detail.createdAt)}          mono   />
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
            <SidebarKV label="Approval No"     value={detail.approvalNo}     mono />
            <SidebarKV label="Approval Case"   value={detail.approvalCaseId} mono />
            <SidebarKV label="Trace ID"        value={detail.traceId}        mono />
          </SidebarGroup>

          {/* Lifecycle */}
          <SidebarGroup title="Lifecycle">
            <SidebarKV label="Updated" value={fmt(detail.updatedAt)} mono />
          </SidebarGroup>

        </div>
      </div>

      {/* ════ Submit Modal ════ */}
      {modal === 'submit' && (
        <ModalShell
          title="Submit Change Ticket"
          subtitle={`${detail.ticketNo} · ${detail.changeType ?? '—'}`}
          onClose={closeModal}
          footer={
            <>
              <button onClick={closeModal} className={adminButtonClass('modalCancel')}>
                Cancel
              </button>
              <button
                onClick={() => void submitChangeTicket()}
                disabled={modalBusy}
                className={adminButtonClass('workflowPrimary')}
              >
                {modalBusy ? 'Submitting…' : 'Submit'}
              </button>
            </>
          }
        >
          <p className="font-mono text-[10px] text-adm-t3">
            Submitting this ticket locks the binding snapshot and routes it through approval.
            The ticket remains visible throughout its lifecycle.
          </p>
          {modalError && (
            <div className="rounded border border-adm-red/30 bg-adm-red/10 px-3 py-2 font-mono text-[10px] text-adm-red">
              {modalError}
            </div>
          )}
        </ModalShell>
      )}

      {/* ════ Consume Modal ════ */}
      {modal === 'consume' && (
        <ModalShell
          title="Consume Change Ticket"
          subtitle={`${detail.ticketNo} · ${detail.changeType ?? '—'}`}
          onClose={closeModal}
          footer={
            <>
              <button onClick={closeModal} className={adminButtonClass('modalCancel')}>
                Cancel
              </button>
              <button
                onClick={() => void consumeChangeTicket()}
                disabled={modalBusy}
                className={adminButtonClass('workflowPrimary')}
              >
                {modalBusy
                  ? 'Recording…'
                  : consumeResult === CONSUME_RESULT_SUCCESS
                    ? 'Record Success'
                    : 'Record Failure'}
              </button>
            </>
          }
        >
          <p className="font-mono text-[10px] text-adm-t3">
            Record the real-world execution result. Success consumes the ticket; failure marks
            it as failed for audit.
          </p>
          <div>
            <p className="mb-1.5 font-mono text-[8.5px] uppercase tracking-[0.14em] text-adm-t3">
              Result
            </p>
            <select
              value={consumeResult}
              onChange={(e) =>
                setConsumeResult(
                  e.target.value === CONSUME_RESULT_FAILURE
                    ? CONSUME_RESULT_FAILURE
                    : CONSUME_RESULT_SUCCESS,
                )
              }
              className="h-[32px] w-full rounded border border-adm-border bg-adm-bg px-3 font-mono text-[11px] text-adm-t1 outline-none focus:border-adm-amber transition-colors"
            >
              <option value={CONSUME_RESULT_SUCCESS}>Success</option>
              <option value={CONSUME_RESULT_FAILURE}>Failure</option>
            </select>
          </div>
          <div>
            <p className="mb-1.5 font-mono text-[8.5px] uppercase tracking-[0.14em] text-adm-t3">
              Operator Note (optional)
            </p>
            <textarea
              value={consumeNote}
              onChange={(e) => setConsumeNote(e.target.value)}
              rows={3}
              placeholder="Describe what was executed and anything notable."
              className="w-full rounded border border-adm-border bg-adm-bg px-3 py-2 font-mono text-[10px] text-adm-t2 placeholder:text-adm-t3 focus:border-adm-amber focus:outline-none resize-none transition-colors"
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
      {/* Header */}
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
      {/* Body */}
      <div className="px-5 py-4 space-y-3">{children}</div>
      {/* Footer */}
      <div className="flex justify-end gap-2 border-t border-adm-border bg-adm-card px-5 py-4">
        {footer}
      </div>
    </div>
  </div>
);

export default ChangeTicketDetailPage;
