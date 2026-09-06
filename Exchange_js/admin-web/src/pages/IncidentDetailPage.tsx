// admin-web/src/pages/IncidentDetailPage.tsx
// 平账三期 · 事故登记：详情页六块（spec §6）——基本信息｜调查时间线｜定损｜善后单｜通报留痕｜结案/撤回。
// 铁律⑥：后端投影已无 UUID（walletRef 已译 walletNo），本页类型里也不出现。
// 时间线块参照 ApprovalDetailPage.tsx 的步骤渲染（rounded border 卡片 + badge）。
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
import {
  ASSESSMENT_BASIS_LABEL,
  ASSESSMENT_BASIS_VALUES,
  ESCALATION_TARGETS,
  ESCALATION_TARGET_LABEL,
  INCIDENT_REPORT_BASES,
  INCIDENT_STATUS_LABEL,
  INCIDENT_TYPE_LABEL,
  REMEDIATION_KINDS,
  REMEDIATION_KIND_LABEL,
  REPORT_DEADLINE_TONE_CLASS,
  reportDeadlineDisplay,
} from '../utils/incidentStatusMap';

interface NoteItem {
  kind: string;
  escalatedTo: string | null;
  body: string;
  authorBy: string;
  createdAt: string;
}

interface RemediationItem {
  kind: string;
  referenceNo: string;
  linkedBy: string;
  createdAt: string;
  // Task 12：只有 kind === 'ADJUSTMENT' 才有值（调账单现状）——「发起补款」按钮据此
  // 判断是否已落账（POSTED）；其余 kind 恒 null。
  status: string | null;
}

interface Detail {
  incidentNo: string;
  type: string;
  status: string;
  title: string;
  description: string;
  sourceCaseNo: string | null;
  sourceDispositionNo: string | null;
  sourceAdvanceTransferNo: string | null;
  walletNo: string | null;
  customerNo: string | null;
  assetCode: string | null;
  amount: string | null;
  assessedAmount: string | null;
  assessmentBasis: string | null;
  reportRequired: boolean;
  reportBasisCodes: string[];
  reportDeadlineAt: string | null;
  reportDraft: string | null;
  reportDraftedAt: string | null;
  reportedAt: string | null;
  reportReference: string | null;
  approvalNo: string | null;
  registeredBy: string;
  closedAt: string | null;
  withdrawnReason: string | null;
  createdAt: string;
  notes: NoteItem[];
  remediations: RemediationItem[];
}

const fmt = (v?: string | null): string => {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString();
};

/** 各善后单类型的详情页回链——铁律⑥用业务号，交易域详情路由仍是内部 id 的既有限制
 * 同 approvalEntityRoutes.ts 的判例：落到列表页 + keyword，不硬造。 */
const remediationLink = (kind: string, referenceNo: string): string | null => {
  switch (kind) {
    case 'ADJUSTMENT': return `/admin/reconciliation/adjustments/${encodeURIComponent(referenceNo)}`;
    case 'TRANSFER': return `/admin/treasury/internal-transfers/${encodeURIComponent(referenceNo)}`;
    case 'SUPPLEMENT':
    case 'CLAIM': return `/admin/trading/deposits?keyword=${encodeURIComponent(referenceNo)}`;
    default: return null;
  }
};

/** 提结案守卫——镜像 incident-close-workflow.service.ts 的 requestClose 前置判断，
 * 用于按钮禁用态的原因 tooltip；实际裁决仍在后端，前端只是不让人白点。 */
const closeGateReason = (d: Detail): string | null => {
  if (d.status === 'CLOSED') return '已结案，不能再申请结案';
  if (d.status === 'WITHDRAWN') return '已撤回，不能申请结案';
  if (d.status === 'REGISTERED' || d.status === 'INVESTIGATING') {
    return '还没定损，须先完成定损（进入已定损或处置中）';
  }
  if (d.status === 'ASSESSED' && (d.assessmentBasis !== 'NO_LOSS' || d.remediations.length > 0)) {
    return '定损结论非「无损失」或已挂善后单，须先挂善后单进入处置中才能申请结案';
  }
  if (d.reportRequired && !d.reportedAt) {
    return '判定需要监管通报但尚未标记已通报，不能结案';
  }
  return null;
};

const IncidentDetailPage = () => {
  const { incidentNo } = useParams<{ incidentNo: string }>();
  const navigate = useNavigate();
  const { hasPermission } = useAdminSession();
  const canWrite = hasPermission(PERMISSIONS.INCIDENT_WRITE);

  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // 调查
  const [noteBody, setNoteBody] = useState('');
  const [escalateTo, setEscalateTo] = useState<string>(ESCALATION_TARGETS[0]);
  const [escalateNote, setEscalateNote] = useState('');

  // 定损
  const [assessedAmount, setAssessedAmount] = useState('');
  const [assessmentBasis, setAssessmentBasis] = useState<string>(ASSESSMENT_BASIS_VALUES[0]);
  const [reportRequired, setReportRequired] = useState(false);
  const [reportBasisCodes, setReportBasisCodes] = useState<string[]>([]);

  // 善后
  const [remediationKind, setRemediationKind] = useState<string>(REMEDIATION_KINDS[0]);
  const [remediationRef, setRemediationRef] = useState('');

  // 通报
  const [draftText, setDraftText] = useState('');
  const [markReference, setMarkReference] = useState('');

  const fetchDetail = async () => {
    if (!incidentNo) return;
    setLoading(true);
    try {
      const res = await adminFetch(`${import.meta.env.VITE_API_URL}/admin/incidents/${encodeURIComponent(incidentNo)}`);
      if (res.ok) {
        const data = (await res.json()) as Detail;
        setDetail(data);
        setDraftText(data.reportDraft ?? '');
      } else {
        alert(await getApiErrorMessage(res, 'Failed to load incident'));
        navigate('/admin/governance/incidents');
      }
    } catch (e) {
      if (e instanceof AdminSessionError) return;
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (incidentNo) void fetchDetail();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incidentNo]);

  const post = async (path: string, body?: Record<string, unknown>) => {
    if (!detail) return false;
    setBusy(true); setError('');
    try {
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/incidents/${encodeURIComponent(detail.incidentNo)}${path}`,
        { method: 'POST', body: body ? JSON.stringify(body) : undefined },
      );
      if (!res.ok) { setError(await getApiErrorMessage(res, '操作失败')); return false; }
      await fetchDetail();
      return true;
    } catch (e) {
      if (e instanceof AdminSessionError) return false;
      setError(e instanceof Error ? e.message : '操作失败');
      return false;
    } finally {
      setBusy(false);
    }
  };

  if (loading && !detail) {
    return (
      <div className="flex min-h-[400px] flex-col items-center justify-center">
        <RefreshCw className="mb-4 animate-spin text-adm-amber" size={32} />
        <p className="text-adm-t3">Loading incident...</p>
      </div>
    );
  }
  if (!detail) return null;

  const closeReason = closeGateReason(detail);
  const canRequestClose = canWrite && !closeReason;
  const canWithdraw = canWrite && detail.status === 'REGISTERED';
  const canStartInvestigation = canWrite && detail.status === 'REGISTERED';
  const canInvestigate = canWrite && detail.status === 'INVESTIGATING';
  const canAssess = canWrite && detail.status === 'INVESTIGATING';
  const canLinkRemediation = canWrite && (detail.status === 'ASSESSED' || detail.status === 'RESOLVING');
  const assessed = detail.assessedAmount != null;
  // Task 12：善后区「发起补款」——事故处置中 + 挂载里有一张已落账（POSTED）认损调账单，
  // 说明认损已过审批入账，该由公司补齐客户了。跳到对账案子页，复用那里已有的补款
  // 发起入口（案件页会按 disposition.adjustmentNo 自动算出同一张单的 COMPENSATION
  // nextStep，零新通道）。
  const postedAdjustment = detail.status === 'RESOLVING'
    ? detail.remediations.find((r) => r.kind === 'ADJUSTMENT' && r.status === 'POSTED')
    : undefined;
  const canInitiateCompensation = canWrite && !!postedAdjustment && !!detail.sourceCaseNo;
  const canSaveDraft = canWrite && assessed && detail.reportRequired && !detail.reportedAt;
  const canMarkReported = canWrite && assessed && detail.reportRequired && !detail.reportedAt && !!detail.reportDraft;

  const toggleBasisCode = (code: string) => {
    setReportBasisCodes((prev) => (prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]));
  };

  const deadline = reportDeadlineDisplay(detail.reportDeadlineAt, detail.reportedAt);

  return (
    <div className="flex h-full flex-col">
      <DetailPageHeader
        title="Incident · 事故登记"
        subtitle={detail.incidentNo}
        onBack={() => navigate('/admin/governance/incidents')}
        onRefresh={() => void fetchDetail()}
        refreshing={loading}
        backLabel="Incidents"
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
          <DetailCard title="基本信息" columns={3}>
            <InfoField label="类型" value={INCIDENT_TYPE_LABEL[detail.type] ?? detail.type} />
            <InfoField label="状态" value={INCIDENT_STATUS_LABEL[detail.status] ?? detail.status} />
            <InfoField label="金额" value={detail.amount != null ? `${detail.amount} ${detail.assetCode ?? ''}` : null} mono accent />
            <InfoField label="标题" value={detail.title} />
            <InfoField label="说明" value={detail.description} />
            <InfoField
              label="来源案号"
              value={detail.sourceCaseNo}
              mono
              link={detail.sourceCaseNo ? `/admin/reconciliation/cases/${encodeURIComponent(detail.sourceCaseNo)}` : undefined}
            />
            {detail.sourceDispositionNo && <InfoField label="来源定性行号" value={detail.sourceDispositionNo} mono />}
            {detail.sourceAdvanceTransferNo && (
              <InfoField
                label="来源垫款单"
                value={detail.sourceAdvanceTransferNo}
                mono
                link={`/admin/treasury/internal-transfers/${encodeURIComponent(detail.sourceAdvanceTransferNo)}`}
              />
            )}
            {detail.walletNo && <InfoField label="钱包" value={detail.walletNo} mono />}
            <InfoField
              label="客户"
              value={detail.customerNo}
              mono
              link={detail.customerNo ? `/admin/customers/${encodeURIComponent(detail.customerNo)}` : undefined}
            />
            <InfoField label="登记人" value={detail.registeredBy} mono />
            <InfoField label="登记时间" value={fmt(detail.createdAt)} mono />
            {detail.closedAt && <InfoField label="结案时间" value={fmt(detail.closedAt)} mono />}
            {detail.withdrawnReason && <InfoField label="撤回理由" value={detail.withdrawnReason} highlight />}
          </DetailCard>
          {detail.customerNo && (
            <div className="-mt-2">
              <Link to={`/admin/customers/${encodeURIComponent(detail.customerNo)}`} className={adminButtonClass('detailUtility')}>
                去冻结 · 客户页（不自动冻，冻结走客户限制的独立门）
              </Link>
            </div>
          )}

          {/* ② 调查时间线 */}
          <DetailCard title="调查时间线" columns={1}>
            <div className="col-span-full space-y-3">
              {canStartInvestigation && (
                <button type="button" disabled={busy} onClick={() => void post('/investigation')} className={adminButtonClass('workflowPrimary')}>
                  开始调查
                </button>
              )}
              {detail.notes.length === 0 && <p className="font-mono text-[11px] text-adm-t3">还没有调查记录</p>}
              {detail.notes.map((n, i) => (
                <div
                  key={i}
                  className={`rounded border p-3 ${n.kind === 'ESCALATION' ? 'border-adm-amber/40 bg-adm-amber/5' : 'border-adm-border bg-adm-bg'}`}
                >
                  <div className="mb-1 flex items-center gap-2">
                    <span className="font-mono text-[10px] font-semibold text-adm-t2">
                      {n.kind === 'ESCALATION' ? `升级 → ${ESCALATION_TARGET_LABEL[n.escalatedTo ?? ''] ?? n.escalatedTo}` : '调查记录'}
                    </span>
                    <span className="font-mono text-[9px] text-adm-t3">{n.authorBy} · {fmt(n.createdAt)}</span>
                  </div>
                  <p className="text-[11px] text-adm-t2">{n.body}</p>
                </div>
              ))}

              {canInvestigate && (
                <div className="space-y-3 border-t border-adm-border pt-3">
                  <div>
                    <p className="mb-1 font-mono text-[9px] uppercase tracking-[0.1em] text-adm-t3">添加调查记录</p>
                    <textarea value={noteBody} onChange={(e) => setNoteBody(e.target.value)} rows={2} className="w-full rounded border border-adm-border bg-adm-panel px-2 py-1 text-xs" placeholder="查了什么、发现了什么" />
                    <button type="button" disabled={busy || !noteBody.trim()} onClick={() => { void post('/notes', { body: noteBody.trim() }).then((ok) => { if (ok) setNoteBody(''); }); }} className={`mt-1.5 ${adminButtonClass('detailUtility')}`}>
                      添加记录
                    </button>
                  </div>
                  <div>
                    <p className="mb-1 font-mono text-[9px] uppercase tracking-[0.1em] text-adm-t3">记录升级</p>
                    <div className="flex gap-2">
                      <select value={escalateTo} onChange={(e) => setEscalateTo(e.target.value)} className="rounded border border-adm-border bg-adm-panel px-2 py-1 text-xs">
                        {ESCALATION_TARGETS.map((t) => <option key={t} value={t}>{ESCALATION_TARGET_LABEL[t]}</option>)}
                      </select>
                      <input value={escalateNote} onChange={(e) => setEscalateNote(e.target.value)} className="flex-1 rounded border border-adm-border bg-adm-panel px-2 py-1 text-xs" placeholder="升级说明" />
                    </div>
                    <button type="button" disabled={busy || !escalateNote.trim()} onClick={() => { void post('/escalate', { to: escalateTo, note: escalateNote.trim() }).then((ok) => { if (ok) setEscalateNote(''); }); }} className={`mt-1.5 ${adminButtonClass('detailUtility')}`}>
                      记录升级
                    </button>
                  </div>
                </div>
              )}
            </div>
          </DetailCard>

          {/* ③ 定损 */}
          <DetailCard title="定损" columns={assessed ? 3 : 1}>
            {assessed ? (
              <>
                <InfoField label="定损金额" value={`${detail.assessedAmount} ${detail.assetCode ?? ''}`} mono accent />
                <InfoField label="定损口径" value={ASSESSMENT_BASIS_LABEL[detail.assessmentBasis ?? ''] ?? detail.assessmentBasis} />
                <InfoField label="是否需通报" value={detail.reportRequired ? '需通报' : '不需通报'} />
              </>
            ) : canAssess ? (
              <div className="col-span-full space-y-2">
                <div className="flex gap-2">
                  <input value={assessedAmount} onChange={(e) => setAssessedAmount(e.target.value)} placeholder="定损金额" className="w-40 rounded border border-adm-border bg-adm-panel px-2 py-1 text-xs font-mono" />
                  <select value={assessmentBasis} onChange={(e) => setAssessmentBasis(e.target.value)} className="rounded border border-adm-border bg-adm-panel px-2 py-1 text-xs">
                    {ASSESSMENT_BASIS_VALUES.map((v) => <option key={v} value={v}>{ASSESSMENT_BASIS_LABEL[v]}</option>)}
                  </select>
                  <label className="flex items-center gap-1 text-xs">
                    <input type="checkbox" checked={reportRequired} onChange={(e) => setReportRequired(e.target.checked)} /> 需要监管通报
                  </label>
                </div>
                {reportRequired && (
                  <div className="space-y-1">
                    <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-adm-t3">通报依据（多选）</p>
                    {Object.entries(INCIDENT_REPORT_BASES).map(([code, b]) => (
                      <label key={code} className="flex items-start gap-1.5 text-[11px]">
                        <input type="checkbox" checked={reportBasisCodes.includes(code)} onChange={() => toggleBasisCode(code)} className="mt-0.5" />
                        <span>{b.label}</span>
                      </label>
                    ))}
                  </div>
                )}
                <button
                  type="button"
                  disabled={busy || !assessedAmount.trim() || (reportRequired && reportBasisCodes.length === 0)}
                  onClick={() => void post('/assess', { assessedAmount: assessedAmount.trim(), assessmentBasis, reportRequired, reportBasisCodes: reportRequired ? reportBasisCodes : undefined })}
                  className={adminButtonClass('workflowPrimary')}
                >
                  提交定损
                </button>
              </div>
            ) : (
              <p className="font-mono text-[11px] text-adm-t3">先开始调查（状态进入「调查中」）才能定损</p>
            )}
          </DetailCard>

          {/* ④ 善后单 */}
          <DetailCard title="善后单" columns={1}>
            <div className="col-span-full space-y-3">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-adm-t3">
                    {['类型', '单号', '挂载人', '时间'].map((h) => <th key={h} className="px-2 py-1 font-mono text-[10px]">{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {detail.remediations.map((r, i) => {
                    const link = remediationLink(r.kind, r.referenceNo);
                    return (
                      <tr key={i} className="border-t border-adm-border/60">
                        <td className="px-2 py-1">{REMEDIATION_KIND_LABEL[r.kind] ?? r.kind}</td>
                        <td className="px-2 py-1 font-mono">
                          {link ? <Link to={link} className="text-adm-blue hover:underline">{r.referenceNo}</Link> : r.referenceNo}
                        </td>
                        <td className="px-2 py-1 font-mono">{r.linkedBy}</td>
                        <td className="px-2 py-1 font-mono text-adm-t3">{fmt(r.createdAt)}</td>
                      </tr>
                    );
                  })}
                  {detail.remediations.length === 0 && (
                    <tr><td colSpan={4} className="px-2 py-3 text-adm-t3">还没有善后单挂载</td></tr>
                  )}
                </tbody>
              </table>

              {canLinkRemediation ? (
                <div className="flex gap-2 border-t border-adm-border pt-3">
                  <select value={remediationKind} onChange={(e) => setRemediationKind(e.target.value)} className="rounded border border-adm-border bg-adm-panel px-2 py-1 text-xs">
                    {REMEDIATION_KINDS.map((k) => <option key={k} value={k}>{REMEDIATION_KIND_LABEL[k]}</option>)}
                  </select>
                  <input value={remediationRef} onChange={(e) => setRemediationRef(e.target.value)} placeholder="单号" className="flex-1 rounded border border-adm-border bg-adm-panel px-2 py-1 text-xs font-mono" />
                  <button
                    type="button"
                    disabled={busy || !remediationRef.trim()}
                    onClick={() => { void post('/remediations', { kind: remediationKind, referenceNo: remediationRef.trim() }).then((ok) => { if (ok) setRemediationRef(''); }); }}
                    className={adminButtonClass('detailUtility')}
                  >
                    挂载
                  </button>
                </div>
              ) : (
                (detail.status === 'REGISTERED' || detail.status === 'INVESTIGATING') && (
                  <p className="border-t border-adm-border pt-3 font-mono text-[11px] text-adm-t3">先定损才能挂善后单</p>
                )
              )}
              {canInitiateCompensation && (
                <div className="border-t border-adm-border pt-3">
                  <button
                    type="button"
                    onClick={() => navigate(`/admin/reconciliation/cases/${encodeURIComponent(detail.sourceCaseNo!)}?adjustmentNo=${encodeURIComponent(postedAdjustment!.referenceNo)}`)}
                    className={adminButtonClass('workflowPrimary')}
                  >
                    发起补款
                  </button>
                  <p className="mt-1 font-mono text-[9px] text-adm-t3">认损单 {postedAdjustment!.referenceNo} 已落账——跳对账案子页发起补款（复用既有入口）</p>
                </div>
              )}
            </div>
          </DetailCard>

          {/* ⑤ 通报留痕 */}
          <DetailCard title="监管通报留痕" columns={1}>
            {!assessed ? (
              <p className="font-mono text-[11px] text-adm-t3">定损后才判定是否需要通报</p>
            ) : !detail.reportRequired ? (
              <p className="font-mono text-[11px] text-adm-t3">该事故判定无需通报</p>
            ) : (
              <div className="col-span-full space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-adm-t3">时限</span>
                  <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${REPORT_DEADLINE_TONE_CLASS[deadline.tone]}`}>{deadline.text}</span>
                </div>
                <div>
                  <p className="mb-1 font-mono text-[9px] uppercase tracking-[0.1em] text-adm-t3">依据</p>
                  <ul className="list-disc space-y-0.5 pl-4 text-[11px] text-adm-t2">
                    {detail.reportBasisCodes.map((code) => <li key={code}>{INCIDENT_REPORT_BASES[code]?.label ?? code}</li>)}
                  </ul>
                </div>
                <div>
                  <p className="mb-1 font-mono text-[9px] uppercase tracking-[0.1em] text-adm-t3">通报草案</p>
                  <textarea
                    value={draftText}
                    onChange={(e) => setDraftText(e.target.value)}
                    rows={4}
                    disabled={!canSaveDraft}
                    className="w-full rounded border border-adm-border bg-adm-panel px-2 py-1 text-xs disabled:opacity-60"
                    placeholder="事件性质 / 范围 / 影响 + 缓解措施 + 是否已报他机关"
                  />
                  {canSaveDraft && (
                    <button type="button" disabled={busy || !draftText.trim()} onClick={() => void post('/regulator-report', { draft: draftText.trim() })} className={`mt-1.5 ${adminButtonClass('detailUtility')}`}>
                      保存草案
                    </button>
                  )}
                  {detail.reportDraftedAt && <p className="mt-1 font-mono text-[9px] text-adm-t3">起草于 {fmt(detail.reportDraftedAt)}</p>}
                </div>
                {detail.reportedAt ? (
                  <InfoField label="已通报" value={`${fmt(detail.reportedAt)}${detail.reportReference ? ` · 对外编号 ${detail.reportReference}` : ''}`} highlight />
                ) : (
                  canMarkReported && (
                    <div className="flex gap-2">
                      <input value={markReference} onChange={(e) => setMarkReference(e.target.value)} placeholder="对外编号（选填）" className="flex-1 rounded border border-adm-border bg-adm-panel px-2 py-1 text-xs font-mono" />
                      <button type="button" disabled={busy} onClick={() => void post('/regulator-report/mark', { reference: markReference.trim() || undefined })} className={adminButtonClass('workflowPrimary')}>
                        已通报
                      </button>
                    </div>
                  )
                )}
              </div>
            )}
          </DetailCard>
        </div>

        {/* ════ 右侧栏：结案 / 撤回动作区 ════ */}
        <aside className="w-[280px] min-w-[280px] overflow-y-auto border-l border-adm-border bg-adm-panel px-4">
          {canWrite && (detail.status !== 'CLOSED' && detail.status !== 'WITHDRAWN') && (
            <SidebarGroup title="Actions">
              <button
                type="button"
                disabled={!canRequestClose || busy}
                title={closeReason ?? undefined}
                onClick={() => void post('/close')}
                className={adminButtonClass('workflowPrimary')}
              >
                提结案
              </button>
              {closeReason && <p className="mt-1 font-mono text-[9px] text-adm-t3">{closeReason}</p>}
              {canWithdraw && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    const reason = window.prompt('撤回理由（必填——误登记怎么收，留审计不留橡皮擦）');
                    if (reason?.trim()) void post('/withdraw', { reason: reason.trim() });
                  }}
                  className={`mt-2 ${adminButtonClass('workflowNegative')}`}
                >
                  撤回（误登记）
                </button>
              )}
            </SidebarGroup>
          )}

          <SidebarGroup title="Lifecycle">
            <SidebarKV label="Registered By" value={detail.registeredBy} mono />
            <SidebarKV label="Created" value={fmt(detail.createdAt)} mono />
            <SidebarKV label="Closed" value={detail.closedAt ? fmt(detail.closedAt) : null} mono />
          </SidebarGroup>

          {detail.approvalNo && (
            <SidebarGroup title="结案审批">
              <Link to={`/admin/governance/approvals/${encodeURIComponent(detail.approvalNo)}`} className="font-mono text-[11px] text-adm-blue hover:underline">
                {detail.approvalNo}
              </Link>
            </SidebarGroup>
          )}
        </aside>
      </div>
    </div>
  );
};

export default IncidentDetailPage;
