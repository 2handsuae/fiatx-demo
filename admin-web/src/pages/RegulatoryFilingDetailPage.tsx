// admin-web/src/pages/RegulatoryFilingDetailPage.tsx
// 战役甲波二 · 报送台骨架（Task 9）：报送单详情——五块：基本信息｜正文草稿｜签发区｜
// 往来记录时间线｜办结/作废。铁律⑥：投影全走业务键、零 UUID。
// 模板：IncidentDetailPage.tsx 的卡片结构 + 动作按钮可见性口径（canWrite × 状态机边）。
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { DetailCard, DetailPageHeader, InfoField } from '../components/compliance/DetailPageComponents';
import { SidebarGroup, SidebarKV } from '../components/ui/SidebarPrimitives';
import { StatusPill } from '../components/ui/StatusPill';
import { adminButtonClass } from '../components/common/adminButtonStyles';
import { AdminSessionError, adminFetch, getApiErrorMessage } from '../utils/adminFetch';
import { useAdminSession } from '../contexts/AdminSessionContext';
import { PERMISSIONS } from '../rbac/permissions';
import { INCIDENT_REPORT_BASES } from '../utils/incidentStatusMap';
import {
  AML_FILING_ENTRY_KINDS,
  AUTHORITY_LABEL,
  FILING_ENTRY_KINDS,
  FILING_ENTRY_KIND_LABEL,
  FILING_STATUS_LABEL,
  FILING_TYPE_LABEL,
  FILING_TYPE_MIRROR,
  REPORT_DEADLINE_TONE_CLASS,
  reportDeadlineDisplay,
} from '../utils/regulatoryFilingMap';

interface Entry {
  kind: string;
  body: string;
  externalRef: string | null;
  // T5：仅 CUSTOMER_COMM 非空——拟稿人自由文本，其余四种 kind 恒 null。
  commDraftedBy: string | null;
  recordedByUserId: string;
  createdAt: string;
}

interface Detail {
  filingNo: string;
  direction: string;
  type: string;
  status: string;
  authority: string;
  ccAuthorities: string[];
  basisCode: string | null;
  incidentNo: string | null;
  title: string;
  body: string | null;
  receivedAt: string | null;
  deadlineAt: string | null;
  externalRef: string | null;
  // 波三 T3：Sumsub 案件引用 / EOCN 名单条目引用（requiresExternalCaseRef 类型必填）。
  externalCaseRef: string | null;
  submittedAt: string | null;
  submittedByUserId: string | null;
  overdueMarkedAt: string | null;
  approvalNo: string | null;
  closedAt: string | null;
  cancelledReason: string | null;
  // 波三 T3：「决定不报」结案理由——仅 closeNoFiling 落库，终态专属字段。
  noFilingReason: string | null;
  createdByUserId: string;
  createdAt: string;
  entries: Entry[];
}

const fmt = (v?: string | null): string => {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString();
};

/** 「Mark submitted」弹窗——spec §3：SIGNED_OFF→SUBMITTED 前置必填 externalRef（对外提交前
 * 高管已签发；externalRef 是「留痕不真发」核心闸——留了外部编号才算真的标了已提交）。 */
const MarkSubmittedModal = ({ open, busy, onClose, onSubmit }: { open: boolean; busy: boolean; onClose: () => void; onSubmit: (externalRef: string) => void }) => {
  const [externalRef, setExternalRef] = useState('');

  useEffect(() => { if (open) setExternalRef(''); }, [open]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="w-[420px] rounded-lg border border-adm-border bg-adm-panel p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-1 text-sm font-semibold text-adm-t1">Mark Submitted</h3>
        <p className="mb-3 font-mono text-[10px] text-adm-t3">Records that this filing was manually sent to the regulator — the external acknowledgement reference is required (staying "reported" is only real once there's a number to point at)</p>
        <label className="mb-3 block text-xs">External Reference
          <input value={externalRef} onChange={(e) => setExternalRef(e.target.value)} className="mt-1 w-full rounded border border-adm-border bg-adm-panel px-2 py-1 text-xs font-mono" placeholder="e.g. VARA-REG-2026-001" />
        </label>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={adminButtonClass('modalCancel')}>Cancel</button>
          <button type="button" disabled={busy || !externalRef.trim()} onClick={() => onSubmit(externalRef.trim())} className={adminButtonClass('modalConfirm')}>
            {busy ? 'Submitting…' : 'Mark Submitted'}
          </button>
        </div>
      </div>
    </div>
  );
};

/** 「Close — no filing decision」弹窗——spec §3 点 2/T3：AML 族 DRAFT→CLOSED 新边，
 * 唯 STR/SAR（allowNoFilingClose）可走，noFilingReason 必填闸（no-file decision 的
 * 法定可辩护留痕）。仅 DRAFT 态可用，与既有「Close Filing」（仅 SUBMITTED）互斥。 */
const CloseNoFilingModal = ({ open, busy, onClose, onSubmit }: { open: boolean; busy: boolean; onClose: () => void; onSubmit: (noFilingReason: string) => void }) => {
  const [reason, setReason] = useState('');

  useEffect(() => { if (open) setReason(''); }, [open]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="w-[420px] rounded-lg border border-adm-border bg-adm-panel p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-1 text-sm font-semibold text-adm-t1">Close — No Filing Decision</h3>
        <p className="mb-3 font-mono text-[10px] text-adm-t3">Records the decision not to file — this is itself a legally defensible decision and must be documented (Federal Decree-Law 20/2018).</p>
        <label className="mb-3 block text-xs">No-Filing Reason
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} className="mt-1 w-full rounded border border-adm-border bg-adm-panel px-2 py-1 text-xs" placeholder="Why the formed suspicion did not result in a filing" />
        </label>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={adminButtonClass('modalCancel')}>Cancel</button>
          <button type="button" disabled={busy || !reason.trim()} onClick={() => onSubmit(reason.trim())} className={adminButtonClass('workflowNegative')}>
            {busy ? 'Closing…' : 'Close — No Filing'}
          </button>
        </div>
      </div>
    </div>
  );
};

const RegulatoryFilingDetailPage = () => {
  const { filingNo } = useParams<{ filingNo: string }>();
  const navigate = useNavigate();
  const { hasPermission } = useAdminSession();
  const canWrite = hasPermission(PERMISSIONS.REG_FILING_WRITE);

  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const [draftText, setDraftText] = useState('');
  const [showMarkSubmitted, setShowMarkSubmitted] = useState(false);
  const [showCloseNoFiling, setShowCloseNoFiling] = useState(false);
  const [entryKind, setEntryKind] = useState<string>(FILING_ENTRY_KINDS[0]);
  const [entryBody, setEntryBody] = useState('');
  const [entryRef, setEntryRef] = useState('');
  // 波三 T5：CUSTOMER_COMM 专属必填字段（拟稿人自由文本，MLRO 代录）。
  const [entryCommDraftedBy, setEntryCommDraftedBy] = useState('');

  const fetchDetail = async () => {
    if (!filingNo) return;
    setLoading(true);
    try {
      const res = await adminFetch(`${import.meta.env.VITE_API_URL}/admin/regulatory-filings/${encodeURIComponent(filingNo)}`);
      if (res.ok) {
        const data = (await res.json()) as Detail;
        setDetail(data);
        setDraftText(data.body ?? '');
      } else {
        alert(await getApiErrorMessage(res, 'Failed to load regulatory filing'));
        navigate('/admin/governance/regulatory-filings');
      }
    } catch (e) {
      if (e instanceof AdminSessionError) return;
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (filingNo) void fetchDetail();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filingNo]);

  const post = async (path: string, body?: Record<string, unknown>) => {
    if (!detail) return false;
    setBusy(true); setError('');
    try {
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/regulatory-filings/${encodeURIComponent(detail.filingNo)}${path}`,
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

  if (loading && !detail) {
    return (
      <div className="flex min-h-[400px] flex-col items-center justify-center">
        <RefreshCw className="mb-4 animate-spin text-adm-amber" size={32} />
        <p className="text-adm-t3">Loading filing...</p>
      </div>
    );
  }
  if (!detail) return null;

  // 波三 T9：族感知（spec §3 点 2）——AML 族无签发链，DRAFT→SUBMITTED 直达；GENERAL 族
  // 两页零变化，下面每一处都以 isAml 分支，false 分支与波二原样一致。
  const cfg = FILING_TYPE_MIRROR[detail.type];
  const isAml = cfg?.family === 'AML';

  // 评审终审修复：按钮可见性/可用性回到纯「状态机边 × 持码」公式——不加 draftText 内容/
  // 一致性判断这个第三维（禁做清单：输入防御性校验）。没存草稿就送签，body 空由后端 400 拦，
  // 不是前端的活。
  const canSaveDraft = canWrite && detail.status === 'DRAFT';
  // AML 族族边集没有 DRAFT→PENDING_SIGNOFF 这条边（T1），送签按钮对 AML 单不出现。
  const canSubmitForSignoff = canWrite && !isAml && detail.status === 'DRAFT';
  const canCancel = canWrite && detail.status === 'DRAFT';
  // AML 族 DRAFT→SUBMITTED 是族边集里的合法边（T3 markSubmitted）：MLRO 对 DRAFT 态
  // 直接标已提交，不必先过 PENDING_SIGNOFF/SIGNED_OFF 两态。
  const canMarkSubmitted = canWrite && (detail.status === 'SIGNED_OFF' || (isAml && detail.status === 'DRAFT'));
  // T3：DRAFT→CLOSED「决定不报」新边——仅 allowNoFilingClose 类型（STR/SAR）、仅 DRAFT。
  const canCloseNoFiling = canWrite && isAml && !!cfg?.allowNoFilingClose && detail.status === 'DRAFT';
  const canClose = canWrite && detail.status === 'SUBMITTED';

  // T5（spec §5）：往来记录 kind 可选集按族 × 状态查表，不写针对某个 kind 的专属 if——
  // 旧三种（两族皆可）仅 SUBMITTED；新两种（仅 AML 族）非终态（未 CLOSED/CANCELLED）皆可。
  const NON_TERMINAL_STATUSES = ['DRAFT', 'PENDING_SIGNOFF', 'SIGNED_OFF', 'SUBMITTED'];
  const availableEntryKinds = (): string[] => {
    const base = detail.status === 'SUBMITTED' ? [...FILING_ENTRY_KINDS] : [];
    if (isAml && NON_TERMINAL_STATUSES.includes(detail.status)) {
      return [...base, ...AML_FILING_ENTRY_KINDS];
    }
    return base;
  };
  const entryKindOptions = availableEntryKinds();
  const canLogEntry = canWrite && entryKindOptions.length > 0;
  const effectiveEntryKind = entryKindOptions.includes(entryKind) ? entryKind : (entryKindOptions[0] ?? entryKind);

  const deadline = reportDeadlineDisplay(detail.deadlineAt, detail.submittedAt, detail.overdueMarkedAt, detail.basisCode);

  return (
    <div className="flex h-full flex-col">
      <DetailPageHeader
        title="Regulatory Filing"
        subtitle={detail.filingNo}
        onBack={() => navigate('/admin/governance/regulatory-filings')}
        onRefresh={() => void fetchDetail()}
        refreshing={loading}
        backLabel="Filings"
      >
        <StatusPill value={detail.status} size="md" />
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
            <InfoField label="Type" value={FILING_TYPE_LABEL[detail.type] ?? detail.type} />
            <InfoField label="Direction" value={detail.direction === 'INBOUND' ? 'Inbound' : 'Outbound'} />
            <InfoField label="Status" value={FILING_STATUS_LABEL[detail.status] ?? detail.status} />
            <InfoField label="Title" value={detail.title} />
            <InfoField label="Authority" value={AUTHORITY_LABEL[detail.authority] ?? detail.authority} />
            {detail.ccAuthorities.length > 0 && (
              <InfoField label="CC Authorities" value={detail.ccAuthorities.map((a) => AUTHORITY_LABEL[a] ?? a).join(', ')} />
            )}
            {detail.basisCode && (
              <InfoField label="Report Basis" value={INCIDENT_REPORT_BASES[detail.basisCode]?.label ?? detail.basisCode} />
            )}
            <InfoField
              label="Incident"
              value={detail.incidentNo}
              mono
              link={detail.incidentNo ? `/admin/governance/incidents/${encodeURIComponent(detail.incidentNo)}` : undefined}
            />
            {detail.receivedAt && <InfoField label="Received At" value={fmt(detail.receivedAt)} mono />}
            <div className="min-w-0">
              <div className="font-mono text-[9px] uppercase tracking-[0.1em] text-adm-t3">Deadline</div>
              <div className="mt-1">
                <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${REPORT_DEADLINE_TONE_CLASS[deadline.tone]}`}>{deadline.text}</span>
              </div>
            </div>
            {detail.externalRef && <InfoField label="External Reference" value={detail.externalRef} mono accent />}
            {detail.externalCaseRef && <InfoField label="External Case Reference" value={detail.externalCaseRef} mono />}
            <InfoField label="Created By" value={detail.createdByUserId} mono />
            <InfoField label="Created At" value={fmt(detail.createdAt)} mono />
            {detail.closedAt && <InfoField label="Closed At" value={fmt(detail.closedAt)} mono />}
            {detail.cancelledReason && <InfoField label="Cancelled Reason" value={detail.cancelledReason} highlight />}
            {detail.noFilingReason && <InfoField label="No-Filing Reason" value={detail.noFilingReason} highlight />}
          </DetailCard>

          {/* ② 正文草稿 */}
          <DetailCard title="Filing Draft" columns={1}>
            <div className="col-span-full space-y-2">
              <textarea
                value={draftText}
                onChange={(e) => setDraftText(e.target.value)}
                rows={6}
                disabled={!canSaveDraft}
                className="w-full rounded border border-adm-border bg-adm-panel px-2 py-1 text-xs disabled:opacity-60"
                placeholder="Nature of the matter / scope / substance of the filing"
              />
              {canSaveDraft && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void post('/draft', { body: draftText.trim() })}
                  className={adminButtonClass('detailUtility')}
                >
                  Save Draft
                </button>
              )}
            </div>
          </DetailCard>

          {/* ③ 签发区——AML 族（spec §3 点 2）无签发链：DRAFT→SUBMITTED 直达，MLRO 亲办，
              不经 PENDING_SIGNOFF/SIGNED_OFF 两态；「送签」按钮对 AML 单不出现（族边集里
              这条边就不存在，不是权限不够）。GENERAL 族原样不动。 */}
          <DetailCard title="Sign-off" columns={1}>
            <div className="col-span-full space-y-2">
              {detail.status === 'DRAFT' && isAml && (
                <>
                  <p className="font-mono text-[11px] text-adm-t2">No sign-off chain — AML reporting is handled directly by MLRO (FDL 20/2018: goAML filings cannot be held up by anyone else's sign-off).</p>
                  {canMarkSubmitted && (
                    <button type="button" onClick={() => setShowMarkSubmitted(true)} className={adminButtonClass('workflowPrimary')}>
                      Mark Submitted
                    </button>
                  )}
                </>
              )}
              {detail.status === 'DRAFT' && !isAml && (
                <>
                  <button
                    type="button"
                    disabled={!canSubmitForSignoff || busy}
                    onClick={() => void post('/signoff')}
                    className={adminButtonClass('workflowPrimary')}
                  >
                    Submit for Sign-off
                  </button>
                  <p className="font-mono text-[10px] text-adm-t3">Requires a saved, non-empty draft — a single senior-management step then approves or rejects</p>
                </>
              )}
              {detail.status === 'PENDING_SIGNOFF' && (
                detail.approvalNo ? (
                  <Link to={`/admin/governance/approvals/${encodeURIComponent(detail.approvalNo)}`} className="font-mono text-[11px] text-adm-blue hover:underline">
                    Pending sign-off — approval {detail.approvalNo}
                  </Link>
                ) : (
                  <p className="font-mono text-[11px] text-adm-t3">Pending sign-off</p>
                )
              )}
              {detail.status === 'SIGNED_OFF' && (
                <>
                  <p className="font-mono text-[11px] text-adm-t2">Signed off — ready to submit to the regulator</p>
                  {canMarkSubmitted && (
                    <button type="button" onClick={() => setShowMarkSubmitted(true)} className={adminButtonClass('workflowPrimary')}>
                      Mark Submitted
                    </button>
                  )}
                </>
              )}
              {(detail.status === 'SUBMITTED' || detail.status === 'CLOSED') && (
                <InfoField label="Submitted" value={`${fmt(detail.submittedAt)}${detail.submittedByUserId ? ` · by ${detail.submittedByUserId}` : ''}`} highlight />
              )}
              {detail.status === 'CANCELLED' && <p className="font-mono text-[11px] text-adm-t3">Filing was cancelled — see Cancelled Reason above</p>}
            </div>
          </DetailCard>

          {/* ④ 往来记录时间线 */}
          <DetailCard title="Correspondence" columns={1}>
            <div className="col-span-full space-y-3">
              {detail.entries.length === 0 && <p className="font-mono text-[11px] text-adm-t3">No correspondence logged yet</p>}
              {detail.entries.map((e, i) => (
                <div key={i} className="rounded border border-adm-border bg-adm-bg p-3">
                  <div className="mb-1 flex items-center gap-2">
                    <span className="font-mono text-[10px] font-semibold text-adm-t2">{FILING_ENTRY_KIND_LABEL[e.kind] ?? e.kind}</span>
                    {/* T5/T9：CUSTOMER_COMM 两签一行——拟稿(commDraftedBy 自由文本)／放行
                        (recordedByUserId 实名) 都是同一次 MLRO 亲录的两个字段，不装作两个
                        账号；其余四种 kind 维持原样只显 recordedByUserId。 */}
                    <span className="font-mono text-[9px] text-adm-t3">
                      {e.kind === 'CUSTOMER_COMM'
                        ? `Drafted ${e.commDraftedBy} · Cleared ${e.recordedByUserId} · ${fmt(e.createdAt)}`
                        : `${e.recordedByUserId} · ${fmt(e.createdAt)}`}
                    </span>
                    {e.externalRef && <span className="font-mono text-[9px] text-adm-amber">Ref {e.externalRef}</span>}
                  </div>
                  <p className="text-[11px] text-adm-t2">{e.body}</p>
                </div>
              ))}

              {canLogEntry && (
                <div className="space-y-2 border-t border-adm-border pt-3">
                  <div className="flex gap-2">
                    <select value={effectiveEntryKind} onChange={(e) => setEntryKind(e.target.value)} className="rounded border border-adm-border bg-adm-panel px-2 py-1 text-xs">
                      {entryKindOptions.map((k) => <option key={k} value={k}>{FILING_ENTRY_KIND_LABEL[k]}</option>)}
                    </select>
                    <input value={entryRef} onChange={(e) => setEntryRef(e.target.value)} placeholder="External reference (optional)" className="flex-1 rounded border border-adm-border bg-adm-panel px-2 py-1 text-xs font-mono" />
                  </div>
                  {/* T5：CUSTOMER_COMM 专属必填字段——拟稿人自由文本（MLRO 代录），放行人
                      就是 actor 本人（recordedByUserId），两签不装作两人。 */}
                  {effectiveEntryKind === 'CUSTOMER_COMM' && (
                    <input value={entryCommDraftedBy} onChange={(e) => setEntryCommDraftedBy(e.target.value)} placeholder="Drafted by (free text — MLRO recording on their behalf)" className="w-full rounded border border-adm-border bg-adm-panel px-2 py-1 text-xs" />
                  )}
                  <textarea value={entryBody} onChange={(e) => setEntryBody(e.target.value)} rows={2} className="w-full rounded border border-adm-border bg-adm-panel px-2 py-1 text-xs" placeholder="What was received / said / supplemented" />
                  <button
                    type="button"
                    disabled={busy || !entryBody.trim() || (effectiveEntryKind === 'CUSTOMER_COMM' && !entryCommDraftedBy.trim())}
                    onClick={() => {
                      void post('/entries', {
                        kind: effectiveEntryKind,
                        body: entryBody.trim(),
                        externalRef: entryRef.trim() || undefined,
                        commDraftedBy: effectiveEntryKind === 'CUSTOMER_COMM' ? entryCommDraftedBy.trim() : undefined,
                      }).then((ok) => { if (ok) { setEntryBody(''); setEntryRef(''); setEntryCommDraftedBy(''); } });
                    }}
                    className={adminButtonClass('detailUtility')}
                  >
                    Log Entry
                  </button>
                </div>
              )}
            </div>
          </DetailCard>

          {/* ⑤ 办结 / 作废 */}
          <DetailCard title="Closeout" columns={1}>
            <div className="col-span-full space-y-2">
              {detail.status === 'CLOSED' && <p className="font-mono text-[11px] text-adm-t3">Closed {fmt(detail.closedAt)}</p>}
              {detail.status === 'CANCELLED' && <p className="font-mono text-[11px] text-adm-t3">Cancelled — {detail.cancelledReason}</p>}
              {canClose && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void post('/close')}
                  className={adminButtonClass('workflowPrimary')}
                >
                  Close Filing
                </button>
              )}
              {canCancel && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    const reason = window.prompt('Cancellation reason (required)');
                    if (reason?.trim()) void post('/cancel', { reason: reason.trim() });
                  }}
                  className={`${adminButtonClass('workflowNegative')} ml-2`}
                >
                  Cancel Filing
                </button>
              )}
              {/* T3：DRAFT→CLOSED「决定不报」新边——仅 STR/SAR、仅 DRAFT。 */}
              {canCloseNoFiling && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setShowCloseNoFiling(true)}
                  className={`${adminButtonClass('workflowNegative')} ml-2`}
                >
                  Close — No Filing Decision
                </button>
              )}
              {!canClose && !canCancel && !canCloseNoFiling && detail.status !== 'CLOSED' && detail.status !== 'CANCELLED' && (
                <p className="font-mono text-[11px] text-adm-t3">No closeout action available in the current status</p>
              )}
            </div>
          </DetailCard>
        </div>

        {/* ════ 右侧栏 ════ */}
        <aside className="w-[280px] min-w-[280px] overflow-y-auto border-l border-adm-border bg-adm-panel px-4">
          <SidebarGroup title="Lifecycle">
            <SidebarKV label="Created By" value={detail.createdByUserId} mono />
            <SidebarKV label="Created" value={fmt(detail.createdAt)} mono />
            <SidebarKV label="Submitted" value={detail.submittedAt ? fmt(detail.submittedAt) : null} mono />
            <SidebarKV label="Closed" value={detail.closedAt ? fmt(detail.closedAt) : null} mono />
          </SidebarGroup>

          {detail.approvalNo && (
            <SidebarGroup title="Sign-off Approval">
              <Link to={`/admin/governance/approvals/${encodeURIComponent(detail.approvalNo)}`} className="font-mono text-[11px] text-adm-blue hover:underline">
                {detail.approvalNo}
              </Link>
            </SidebarGroup>
          )}
        </aside>
      </div>

      <MarkSubmittedModal
        open={showMarkSubmitted}
        busy={busy}
        onClose={() => setShowMarkSubmitted(false)}
        onSubmit={(externalRef) => { void post('/mark-submitted', { externalRef }).then((ok) => { if (ok) setShowMarkSubmitted(false); }); }}
      />
      <CloseNoFilingModal
        open={showCloseNoFiling}
        busy={busy}
        onClose={() => setShowCloseNoFiling(false)}
        onSubmit={(noFilingReason) => { void post('/close-no-filing', { noFilingReason }).then((ok) => { if (ok) setShowCloseNoFiling(false); }); }}
      />
    </div>
  );
};

export default RegulatoryFilingDetailPage;
