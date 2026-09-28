// admin-web/src/pages/ComplaintDetailPage.tsx
// 战役甲波五 Task 9：投诉工作流骨架——详情。五块：基本信息｜双钟卡｜工作流动作（七枚
// 按钮逐一落位，可见性=状态×持码双维，波二判例）｜往来记录全量｜审计区。铁律⑥：投影
// 全走业务键、零 UUID。模板：RegulatoryFilingDetailPage.tsx 的卡片结构 + IncidentDetailPage.tsx
// 的内联表单惯例 + FundsOrderDetail.tsx 的 CentralAuditTrail 审计区惯例。
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { RefreshCw, Zap } from 'lucide-react';
import { DetailCard, DetailPageHeader, InfoField } from '../components/compliance/DetailPageComponents';
import { SidebarGroup, SidebarKV } from '../components/ui/SidebarPrimitives';
import { StatusPill } from '../components/ui/StatusPill';
import { AdminBadge } from '../components/ui/AdminBadge';
import { adminButtonClass } from '../components/common/adminButtonStyles';
import { AdminSessionError, adminFetch, getApiErrorMessage } from '../utils/adminFetch';
import { useAdminSession } from '../contexts/AdminSessionContext';
import { PERMISSIONS } from '../rbac/permissions';
import { useSimulationMode } from '../utils/simulationMode';
import {
  activeComplaintClock, COMPLAINT_CATEGORY_LABEL, COMPLAINT_ENTRY_KIND_LABEL, COMPLAINT_INVESTIGATING_STATUSES,
  COMPLAINT_MESSAGE_TYPE_LABEL, COMPLAINT_RESOLUTION_OUTCOMES, COMPLAINT_RESOLUTION_OUTCOME_LABEL,
  COMPLAINT_TERMINAL_STATUS, remainingClockText,
} from '../utils/complaintMap';

interface Entry {
  kind: string;
  messageType: string | null;
  body: string;
  actorNo: string;
  createdAt: string;
}

interface Detail {
  complaintNo: string;
  ownerCustomerNo: string;
  category: string;
  relatedOrderNo: string | null;
  subject: string;
  description: string;
  currentStatus: string;
  submittedAt: string;
  ackDeadlineAt: string;
  acknowledgedAt: string | null;
  resolveDeadlineAt: string;
  extendedAt: string | null;
  resolvedAt: string | null;
  resolutionOutcome: string | null;
  resolutionText: string | null;
  pendingApprovalNo: string | null;
  escalatedIncidentNo: string | null;
  entries: Entry[];
}

const fmt = (v?: string | null): string => {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString();
};

/** 确认收悉——确认函文本必填（AcknowledgeComplaintBodyDto.message，entries CLIENT_MESSAGE/ACK 落这个值）。 */
const AcknowledgeModal = ({ open, busy, onClose, onSubmit }: { open: boolean; busy: boolean; onClose: () => void; onSubmit: (message: string) => void }) => {
  const [message, setMessage] = useState('');
  useEffect(() => { if (open) setMessage(''); }, [open]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="w-[460px] rounded-lg border border-adm-border bg-adm-panel p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-1 text-sm font-semibold text-adm-t1">Acknowledge Receipt</h3>
        <p className="mb-3 font-mono text-[10px] text-adm-t3">This text becomes the acknowledgement letter sent to the customer — required (Market Conduct III.A.1.a: acknowledge within 1 week).</p>
        <label className="mb-3 block text-xs">Acknowledgement Text
          <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={4} className="mt-1 w-full rounded border border-adm-border bg-adm-panel px-2 py-1 text-xs" placeholder="We confirm receipt of your complaint and have opened a file to investigate it…" />
        </label>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={adminButtonClass('modalCancel')}>Cancel</button>
          <button type="button" disabled={busy || !message.trim()} onClick={() => onSubmit(message.trim())} className={adminButtonClass('modalConfirm')}>
            {busy ? 'Acknowledging…' : 'Acknowledge'}
          </button>
        </div>
      </div>
    </div>
  );
};

/** 延期——强制解释文字（spec 裁定 4）：28d→56d，一次性。 */
const ExtendModal = ({ open, busy, onClose, onSubmit }: { open: boolean; busy: boolean; onClose: () => void; onSubmit: (explanation: string) => void }) => {
  const [explanation, setExplanation] = useState('');
  useEffect(() => { if (open) setExplanation(''); }, [open]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="w-[460px] rounded-lg border border-adm-border bg-adm-panel p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-1 text-sm font-semibold text-adm-t1">Extend Resolution Deadline</h3>
        <p className="mb-3 font-mono text-[10px] text-adm-t3">Pushes the resolution clock from 4 weeks to 8 weeks — one time only. The customer must be told why (Market Conduct III.A.1.b.ii).</p>
        <label className="mb-3 block text-xs">Explanation (sent to the customer)
          <textarea value={explanation} onChange={(e) => setExplanation(e.target.value)} rows={4} className="mt-1 w-full rounded border border-adm-border bg-adm-panel px-2 py-1 text-xs" placeholder="Why the investigation needs more time" />
        </label>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={adminButtonClass('modalCancel')}>Cancel</button>
          <button type="button" disabled={busy || !explanation.trim()} onClick={() => onSubmit(explanation.trim())} className={adminButtonClass('modalConfirm')}>
            {busy ? 'Extending…' : 'Extend Deadline'}
          </button>
        </div>
      </div>
    </div>
  );
};

/** 裁决提案——outcome 三选一 + resolutionText 必填。开单走 ApprovalsService 正门
 * （铁律②门不可绕），合规官批准后 resolutionText 才真正落库并成为对客户的最终答复。 */
const ProposeResolutionModal = ({ open, busy, onClose, onSubmit }: { open: boolean; busy: boolean; onClose: () => void; onSubmit: (outcome: string, resolutionText: string) => void }) => {
  const [outcome, setOutcome] = useState<string>(COMPLAINT_RESOLUTION_OUTCOMES[0]);
  const [resolutionText, setResolutionText] = useState('');
  useEffect(() => { if (open) { setOutcome(COMPLAINT_RESOLUTION_OUTCOMES[0]); setResolutionText(''); } }, [open]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="w-[480px] rounded-lg border border-adm-border bg-adm-panel p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-1 text-sm font-semibold text-adm-t1">Propose Resolution</h3>
        <p className="mb-3 font-mono text-[10px] text-adm-t3">Opens an approval — the compliance officer decides. If approved, resolutionText becomes the final response sent to the customer.</p>
        <label className="mb-3 block text-xs">Outcome
          <select value={outcome} onChange={(e) => setOutcome(e.target.value)} className="mt-1 w-full rounded border border-adm-border bg-adm-panel px-2 py-1 text-xs">
            {COMPLAINT_RESOLUTION_OUTCOMES.map((o) => <option key={o} value={o}>{COMPLAINT_RESOLUTION_OUTCOME_LABEL[o]}</option>)}
          </select>
        </label>
        <label className="mb-3 block text-xs">Final Response Text (sent to the customer if approved)
          <textarea value={resolutionText} onChange={(e) => setResolutionText(e.target.value)} rows={5} className="mt-1 w-full rounded border border-adm-border bg-adm-panel px-2 py-1 text-xs" placeholder="Our findings and the outcome of your complaint" />
        </label>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={adminButtonClass('modalCancel')}>Cancel</button>
          <button type="button" disabled={busy || !resolutionText.trim()} onClick={() => onSubmit(outcome, resolutionText.trim())} className={adminButtonClass('modalConfirm')}>
            {busy ? 'Submitting…' : 'Propose Resolution'}
          </button>
        </div>
      </div>
    </div>
  );
};

/** 审计区（波三甲案惯例）：直调中央审计日志（subjectNo=本投诉号），不经死表。 */
interface CentralAuditRow {
  id: string;
  eventNo: string;
  action: string;
  outcome: string;
  actorNo?: string | null;
  occurredAt: string;
}

const CentralAuditTrail = ({ complaintNo }: { complaintNo: string }) => {
  const navigate = useNavigate();
  const [rows, setRows] = useState<CentralAuditRow[] | null>(null);
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const res = await adminFetch(
          `${import.meta.env.VITE_API_URL}/admin/audit-logs?subjectNo=${encodeURIComponent(complaintNo)}&take=10`,
        );
        if (res.status === 403) { setDenied(true); setRows([]); return; }
        if (!res.ok) throw new Error(await getApiErrorMessage(res, 'Failed to load audit trail.'));
        const data = (await res.json()) as { items?: CentralAuditRow[] };
        setRows(Array.isArray(data.items) ? data.items : []);
      } catch (e: unknown) {
        if (e instanceof AdminSessionError) return;
        setRows([]);
      }
    })();
  }, [complaintNo]);

  if (denied) return <p className="py-2 font-mono text-[11px] text-adm-t3">Audit log access is not granted for this role.</p>;
  if (rows === null) return <p className="py-2 font-mono text-[11px] text-adm-t3">Loading…</p>;
  return (
    <div className="space-y-2">
      {rows.length === 0 && <p className="py-2 font-mono text-[11px] text-adm-t3">No audit records.</p>}
      {rows.map((row) => (
        <div
          key={row.id}
          className="cursor-pointer rounded border border-adm-border bg-adm-bg px-3 py-2 transition-colors hover:bg-adm-hover"
          onClick={() => navigate(`/admin/audit/logs/${row.eventNo}`)}
        >
          <div className="flex items-center gap-2 font-mono text-[10px]">
            <span className="font-semibold text-adm-amber">{row.eventNo}</span>
            <span className="text-adm-t1">{row.action}</span>
            <AdminBadge value={row.outcome} />
          </div>
          <div className="mt-1 flex items-center gap-2 text-[10px] text-adm-t3">
            <span className="font-mono">{row.actorNo ?? 'SYSTEM'}</span>
            <span>·</span>
            <time className="font-mono">{new Date(row.occurredAt).toLocaleString()}</time>
          </div>
        </div>
      ))}
      <button
        onClick={() => navigate(`/admin/audit/logs?subjectNo=${encodeURIComponent(complaintNo)}`)}
        className={adminButtonClass('rowLink')}
      >
        View full trail →
      </button>
    </div>
  );
};

const ComplaintDetailPage = () => {
  const { complaintNo } = useParams<{ complaintNo: string }>();
  const navigate = useNavigate();
  const { hasPermission } = useAdminSession();
  const canWrite = hasPermission(PERMISSIONS.COMPLAINT_WRITE);
  const { enabled: simEnabled } = useSimulationMode();
  const canSimulate = hasPermission(PERMISSIONS.DEMO_CLOCK_WRITE);

  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const [noteBody, setNoteBody] = useState('');
  const [showAcknowledge, setShowAcknowledge] = useState(false);
  const [showExtend, setShowExtend] = useState(false);
  const [showPropose, setShowPropose] = useState(false);
  const [simulatingTarget, setSimulatingTarget] = useState<'ACK' | 'RESOLVE' | null>(null);

  const fetchDetail = async () => {
    if (!complaintNo) return;
    setLoading(true);
    try {
      const res = await adminFetch(`${import.meta.env.VITE_API_URL}/admin/complaints/${encodeURIComponent(complaintNo)}`);
      if (res.ok) {
        setDetail((await res.json()) as Detail);
      } else {
        alert(await getApiErrorMessage(res, 'Failed to load complaint'));
        navigate('/admin/governance/complaints');
      }
    } catch (e) {
      if (e instanceof AdminSessionError) return;
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (complaintNo) void fetchDetail();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [complaintNo]);

  const post = async (path: string, body?: Record<string, unknown>) => {
    if (!detail) return false;
    setBusy(true); setError('');
    try {
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/complaints/${encodeURIComponent(detail.complaintNo)}${path}`,
        { method: 'POST', body: body ? JSON.stringify(body) : undefined },
      );
      if (!res.ok) { setError(await getApiErrorMessage(res, 'Operation failed')); return false; }
      await fetchDetail();
      return true;
    } catch (e) {
      if (e instanceof AdminSessionError) return false;
      setError(e instanceof Error ? e.message : 'Operation failed');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const fastForward = async (target: 'ACK' | 'RESOLVE') => {
    if (!detail) return;
    setSimulatingTarget(target);
    setError('');
    try {
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/complaints/${encodeURIComponent(detail.complaintNo)}/simulate-timeout`,
        { method: 'POST', body: JSON.stringify({ target }) },
      );
      if (!res.ok) { setError(await getApiErrorMessage(res, 'Failed to fast-forward the deadline')); return; }
      await fetchDetail();
    } catch (e) {
      if (e instanceof AdminSessionError) return;
      setError(e instanceof Error ? e.message : 'Failed to fast-forward the deadline');
    } finally {
      setSimulatingTarget(null);
    }
  };

  if (loading && !detail) {
    return (
      <div className="flex min-h-[400px] flex-col items-center justify-center">
        <RefreshCw className="mb-4 animate-spin text-adm-amber" size={32} />
        <p className="text-adm-t3">Loading complaint...</p>
      </div>
    );
  }
  if (!detail) return null;

  // 可见性口径（波二判例）：状态 × 持码双维，不加第三维——七枚按钮逐一落位。
  const status = detail.currentStatus;
  const isInvestigating = COMPLAINT_INVESTIGATING_STATUSES.includes(status);
  const canAcknowledge = canWrite && status === 'RECEIVED';
  const canStartInvestigation = canWrite && status === 'ACKNOWLEDGED';
  const canAddNote = canWrite && status !== COMPLAINT_TERMINAL_STATUS;
  const canExtend = canWrite && status === 'INVESTIGATING';
  const canProposeResolution = canWrite && isInvestigating;
  const canEscalate = canWrite && isInvestigating && !detail.escalatedIncidentNo;

  const clock = activeComplaintClock(detail);
  const canFastForward = simEnabled && canSimulate && !!clock;

  return (
    <div className="flex h-full flex-col">
      <DetailPageHeader
        title="Complaint"
        subtitle={detail.complaintNo}
        onBack={() => navigate('/admin/governance/complaints')}
        onRefresh={() => void fetchDetail()}
        refreshing={loading}
        backLabel="Complaints"
      >
        <StatusPill value={detail.currentStatus} size="md" />
      </DetailPageHeader>

      {error && (
        <div className="px-6 pt-3">
          <div className="rounded border border-adm-red/30 bg-adm-red/10 px-4 py-2 font-mono text-[11px] text-adm-red">{error}</div>
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 space-y-4 overflow-y-auto p-6">

          {/* ① 基本信息 */}
          <DetailCard title="Basic Info" columns={3}>
            <InfoField label="Category" value={COMPLAINT_CATEGORY_LABEL[detail.category] ?? detail.category} />
            <InfoField
              label="Customer"
              value={detail.ownerCustomerNo}
              mono
              link={`/admin/customers/${encodeURIComponent(detail.ownerCustomerNo)}`}
            />
            {detail.relatedOrderNo && <InfoField label="Related Order" value={detail.relatedOrderNo} mono />}
            <InfoField label="Subject" value={detail.subject} />
            <InfoField label="Description" value={detail.description} />
            <InfoField label="Submitted At" value={fmt(detail.submittedAt)} mono />
            {detail.acknowledgedAt && <InfoField label="Acknowledged At" value={fmt(detail.acknowledgedAt)} mono />}
            {detail.extendedAt && <InfoField label="Extended At" value={fmt(detail.extendedAt)} mono />}
            {detail.resolvedAt && <InfoField label="Resolved At" value={fmt(detail.resolvedAt)} mono />}
            {detail.resolutionOutcome && (
              <InfoField label="Resolution Outcome" value={COMPLAINT_RESOLUTION_OUTCOME_LABEL[detail.resolutionOutcome] ?? detail.resolutionOutcome} highlight />
            )}
            {detail.escalatedIncidentNo && (
              <InfoField
                label="Escalated To"
                value={detail.escalatedIncidentNo}
                mono
                accent
                link={`/admin/governance/incidents/${encodeURIComponent(detail.escalatedIncidentNo)}`}
              />
            )}
          </DetailCard>

          {/* ② 双钟卡——确认钟 / 裁决钟，超时红。 */}
          <DetailCard title="Clocks" columns={2}>
            <div className={`rounded border p-3 ${status !== COMPLAINT_TERMINAL_STATUS && !detail.acknowledgedAt && new Date(detail.ackDeadlineAt).getTime() < Date.now() ? 'border-adm-red/40 bg-adm-red/5' : 'border-adm-border bg-adm-bg'}`}>
              <div className="font-mono text-[9px] uppercase tracking-[0.1em] text-adm-t3">Acknowledge Clock (1 week)</div>
              <div className="mt-1 font-mono text-xs text-adm-t1">{fmt(detail.ackDeadlineAt)}</div>
              {!detail.acknowledgedAt && status !== COMPLAINT_TERMINAL_STATUS && (
                <div className="mt-1 font-mono text-[10px] text-adm-t3">{remainingClockText(detail.ackDeadlineAt)}</div>
              )}
              {detail.acknowledgedAt && <div className="mt-1 font-mono text-[10px] text-adm-green">Stopped — acknowledged {fmt(detail.acknowledgedAt)}</div>}
              {canFastForward && clock?.target === 'ACK' && (
                <button
                  type="button"
                  disabled={simulatingTarget === 'ACK'}
                  onClick={() => void fastForward('ACK')}
                  className="mt-2 inline-flex items-center gap-1 rounded border border-amber-300 px-2 py-1 font-mono text-[10px] text-amber-700 hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-50"
                  title="Fast-forward this clock into the past (demo only)"
                >
                  <Zap size={11} /> {simulatingTarget === 'ACK' ? 'Working…' : 'Fast-forward'}
                </button>
              )}
            </div>
            <div className={`rounded border p-3 ${status !== COMPLAINT_TERMINAL_STATUS && !!detail.acknowledgedAt && new Date(detail.resolveDeadlineAt).getTime() < Date.now() ? 'border-adm-red/40 bg-adm-red/5' : 'border-adm-border bg-adm-bg'}`}>
              <div className="font-mono text-[9px] uppercase tracking-[0.1em] text-adm-t3">Resolve Clock ({detail.extendedAt ? '8 weeks — extended' : '4 weeks'})</div>
              <div className="mt-1 font-mono text-xs text-adm-t1">{fmt(detail.resolveDeadlineAt)}</div>
              {status !== COMPLAINT_TERMINAL_STATUS && detail.acknowledgedAt && (
                <div className="mt-1 font-mono text-[10px] text-adm-t3">{remainingClockText(detail.resolveDeadlineAt)}</div>
              )}
              {detail.resolvedAt && <div className="mt-1 font-mono text-[10px] text-adm-green">Stopped — resolved {fmt(detail.resolvedAt)}</div>}
              {canFastForward && clock?.target === 'RESOLVE' && (
                <button
                  type="button"
                  disabled={simulatingTarget === 'RESOLVE'}
                  onClick={() => void fastForward('RESOLVE')}
                  className="mt-2 inline-flex items-center gap-1 rounded border border-amber-300 px-2 py-1 font-mono text-[10px] text-amber-700 hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-50"
                  title="Fast-forward this clock into the past (demo only)"
                >
                  <Zap size={11} /> {simulatingTarget === 'RESOLVE' ? 'Working…' : 'Fast-forward'}
                </button>
              )}
            </div>
          </DetailCard>

          {/* ③ 工作流动作——七枚逐一落位。 */}
          <DetailCard title="Workflow" columns={1}>
            <div className="col-span-full flex flex-wrap items-center gap-2">
              {canAcknowledge && (
                <button type="button" onClick={() => setShowAcknowledge(true)} className={adminButtonClass('workflowPrimary')}>
                  Acknowledge
                </button>
              )}
              {canStartInvestigation && (
                <button type="button" disabled={busy} onClick={() => void post('/investigation')} className={adminButtonClass('workflowPrimary')}>
                  Start Investigation
                </button>
              )}
              {canExtend && (
                <button type="button" onClick={() => setShowExtend(true)} className={adminButtonClass('workflowSecondary')}>
                  Extend
                </button>
              )}
              {canProposeResolution && (
                <button type="button" onClick={() => setShowPropose(true)} className={adminButtonClass('workflowPrimary')}>
                  Propose Resolution
                </button>
              )}
              {canEscalate && (
                <button type="button" disabled={busy} onClick={() => void post('/escalate')} className={adminButtonClass('workflowNegative')}>
                  Escalate to Incident
                </button>
              )}
              {status === 'RESOLUTION_PENDING' && (
                detail.pendingApprovalNo ? (
                  <Link to={`/admin/governance/approvals/${encodeURIComponent(detail.pendingApprovalNo)}`} className="font-mono text-[11px] text-adm-blue hover:underline">
                    Pending compliance officer decision — approval {detail.pendingApprovalNo}
                  </Link>
                ) : (
                  <p className="font-mono text-[11px] text-adm-t3">Pending resolution approval</p>
                )
              )}
              {status === COMPLAINT_TERMINAL_STATUS && (
                <p className="font-mono text-[11px] text-adm-t3">Resolved — no further workflow actions</p>
              )}
              {!canAcknowledge && !canStartInvestigation && !canExtend && !canProposeResolution && !canEscalate && status !== 'RESOLUTION_PENDING' && status !== COMPLAINT_TERMINAL_STATUS && (
                <p className="font-mono text-[11px] text-adm-t3">No workflow action available in the current status</p>
              )}
            </div>
          </DetailCard>

          {/* ④ 往来记录——全量（含内部备注）。 */}
          <DetailCard title="Correspondence" columns={1}>
            <div className="col-span-full space-y-3">
              {detail.entries.length === 0 && <p className="font-mono text-[11px] text-adm-t3">No correspondence logged yet</p>}
              {detail.entries.map((e, i) => (
                <div key={i} className={`rounded border p-3 ${e.kind === 'INTERNAL_NOTE' ? 'border-adm-border bg-adm-bg' : 'border-adm-blue/30 bg-adm-blue/5'}`}>
                  <div className="mb-1 flex items-center gap-2">
                    <span className="font-mono text-[10px] font-semibold text-adm-t2">
                      {e.messageType ? COMPLAINT_MESSAGE_TYPE_LABEL[e.messageType] ?? e.messageType : COMPLAINT_ENTRY_KIND_LABEL[e.kind] ?? e.kind}
                    </span>
                    {e.kind === 'CLIENT_MESSAGE' && <span className="font-mono text-[9px] text-adm-blue">visible to customer</span>}
                    <span className="font-mono text-[9px] text-adm-t3">{e.actorNo} · {fmt(e.createdAt)}</span>
                  </div>
                  <p className="text-[11px] text-adm-t2">{e.body}</p>
                </div>
              ))}

              {canAddNote && (
                <div className="space-y-2 border-t border-adm-border pt-3">
                  <p className="mb-1 font-mono text-[9px] uppercase tracking-[0.1em] text-adm-t3">Add Internal Note (not shown to the customer)</p>
                  <textarea value={noteBody} onChange={(e) => setNoteBody(e.target.value)} rows={2} className="w-full rounded border border-adm-border bg-adm-panel px-2 py-1 text-xs" placeholder="Investigation findings, internal context" />
                  <button
                    type="button"
                    disabled={busy || !noteBody.trim()}
                    onClick={() => { void post('/notes', { body: noteBody.trim() }).then((ok) => { if (ok) setNoteBody(''); }); }}
                    className={adminButtonClass('detailUtility')}
                  >
                    Add Note
                  </button>
                </div>
              )}
            </div>
          </DetailCard>

          {/* ⑤ 审计区（波三甲案惯例）——直调中央审计日志。 */}
          <DetailCard title="Audit Trail" columns={1}>
            <CentralAuditTrail complaintNo={detail.complaintNo} />
          </DetailCard>
        </div>

        {/* ════ 右侧栏 ════ */}
        <aside className="w-[280px] min-w-[280px] overflow-y-auto border-l border-adm-border bg-adm-panel px-4">
          <SidebarGroup title="Lifecycle">
            <SidebarKV label="Submitted" value={fmt(detail.submittedAt)} mono />
            <SidebarKV label="Acknowledged" value={detail.acknowledgedAt ? fmt(detail.acknowledgedAt) : null} mono />
            <SidebarKV label="Extended" value={detail.extendedAt ? fmt(detail.extendedAt) : null} mono />
            <SidebarKV label="Resolved" value={detail.resolvedAt ? fmt(detail.resolvedAt) : null} mono />
          </SidebarGroup>

          {detail.pendingApprovalNo && (
            <SidebarGroup title="Pending Resolution Approval">
              <Link to={`/admin/governance/approvals/${encodeURIComponent(detail.pendingApprovalNo)}`} className="font-mono text-[11px] text-adm-blue hover:underline">
                {detail.pendingApprovalNo}
              </Link>
            </SidebarGroup>
          )}

          {detail.escalatedIncidentNo && (
            <SidebarGroup title="Escalated Incident">
              <Link to={`/admin/governance/incidents/${encodeURIComponent(detail.escalatedIncidentNo)}`} className="font-mono text-[11px] text-adm-blue hover:underline">
                {detail.escalatedIncidentNo}
              </Link>
            </SidebarGroup>
          )}
        </aside>
      </div>

      <AcknowledgeModal
        open={showAcknowledge}
        busy={busy}
        onClose={() => setShowAcknowledge(false)}
        onSubmit={(message) => { void post('/acknowledge', { message }).then((ok) => { if (ok) setShowAcknowledge(false); }); }}
      />
      <ExtendModal
        open={showExtend}
        busy={busy}
        onClose={() => setShowExtend(false)}
        onSubmit={(explanation) => { void post('/extend', { explanation }).then((ok) => { if (ok) setShowExtend(false); }); }}
      />
      <ProposeResolutionModal
        open={showPropose}
        busy={busy}
        onClose={() => setShowPropose(false)}
        onSubmit={(outcome, resolutionText) => { void post('/propose-resolution', { outcome, resolutionText }).then((ok) => { if (ok) setShowPropose(false); }); }}
      />
    </div>
  );
};

export default ComplaintDetailPage;
