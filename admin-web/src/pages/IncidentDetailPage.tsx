// admin-web/src/pages/IncidentDetailPage.tsx
// 平账三期 · 事故登记：详情页六块（spec §6）——基本信息｜调查时间线｜定损｜善后单｜通报留痕｜结案/撤回。
// 铁律⑥：后端投影全走业务键、零 UUID。（walletRef 恒空管线已于波二退役——表单从无输入框。）
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
  ANCHOR_FIELD_LABEL,
  ASSESSMENT_BASIS_BY_SCHEME,
  ASSESSMENT_BASIS_LABEL,
  ESCALATION_TARGETS,
  ESCALATION_TARGET_LABEL,
  formatSubjectRefValue,
  INCIDENT_OPERATOR_CAP_CODE,
  INCIDENT_REPORT_BASES,
  INCIDENT_STATUS_LABEL,
  INCIDENT_TYPE_LABEL,
  INCIDENT_TYPE_REGISTRY_MIRROR,
  NO_REPORTING_NOTE,
  REMEDIATION_KIND_LABEL,
} from '../utils/incidentStatusMap';
// 战役甲波二（Task 9）：通报区块改脸为「Regulatory filings」表——deadline/tone helper 与
// FILING_STATUS_LABEL 迁至报送台词表；事故页不再自己算通报时限，只读报送单自己的字段。
import {
  AUTHORITY_LABEL,
  REPORT_DEADLINE_TONE_CLASS,
  reportBasisClockText,
  reportDeadlineDisplay,
} from '../utils/regulatoryFilingMap';

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

interface FilingSummary {
  filingNo: string;
  status: string;
  authority: string;
  basisCode: string | null;
  deadlineAt: string | null;
  overdueMarkedAt: string | null;
  submittedAt: string | null;
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
  customerNo: string | null;
  assetCode: string | null;
  amount: string | null;
  assessedAmount: string | null;
  assessmentBasis: string | null;
  // 战役甲波一 T10：IMPACT 口径定损结果（getView 投影补齐，见 incident.service.ts 注释）。
  impactSummary: string | null;
  impactCount: number | null;
  // 新七类锚键值（顶层锚 assetCode/customerNo/amount 不在这里——本就是上面几个顶层字段）。
  subjectRefs: Record<string, string | number | boolean> | null;
  reportRequired: boolean;
  reportBasisCodes: string[];
  // 战役甲波二 T9：单槽六列退役，通报现状改读报送单横向摘要（getView 新 filings 键，
  // IncidentService.getView 里 this.filings.summaryForIncident 投影，铁律③读放行）。
  filings: FilingSummary[];
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
    case 'TRANSFER': return `/admin/custody/internal-transfers/${encodeURIComponent(referenceNo)}`;
    case 'SUPPLEMENT':
    case 'CLAIM': return `/admin/trading/deposits?keyword=${encodeURIComponent(referenceNo)}`;
    default: return null;
  }
};

/** 提结案守卫——镜像 incident-close-workflow.service.ts 的 requestClose 前置判断，
 * 用于按钮禁用态的原因 tooltip；实际裁决仍在后端，前端只是不让人白点。
 * 战役甲波一 T8 修复轮 1（Ruling-10）之后，ASSESSED→CLOSED 这条边的语义是"无善后"，不是
 * "assessmentBasis 字面等于 NO_LOSS"——CYBER_BCDR/OUTSOURCING_FAILURE/STUCK_TRANSACTION_
 * MAJOR/PRUDENTIAL_BREACH 四类（注册表 allowedRemediationKinds 为空集，压根没有善后动作
 * 可挂）在 ASSESSED 状态、零挂载时也该能直接结案，不必先进 RESOLVING（T10 镜像乙案）。 */
const closeGateReason = (d: Detail): string | null => {
  if (d.status === 'CLOSED') return 'Already closed — cannot request close again';
  if (d.status === 'WITHDRAWN') return 'Already withdrawn — cannot request close';
  if (d.status === 'REGISTERED' || d.status === 'INVESTIGATING') {
    return 'Not yet assessed — complete the assessment first (must reach Assessed or Resolving)';
  }
  if (d.status === 'ASSESSED') {
    // T11 修（同步后端 incident-close-workflow.service.ts 的拒绝文案拆分）：两条互斥原因
    // 分开报，不再把"该类型没有处置动作"包装成又一个被拒理由。
    const allowedKinds = INCIDENT_TYPE_REGISTRY_MIRROR[d.type]?.allowedRemediationKinds ?? [];
    const noRemediationPath = d.assessmentBasis === 'NO_LOSS' || allowedKinds.length === 0;
    if (!noRemediationPath) {
      return 'Assessment concluded remediation is required for this type — link a remediation item and reach Resolving first before requesting close';
    }
    if (d.remediations.length > 0) {
      return 'A remediation item is already linked — reach Resolving first before requesting close';
    }
  }
  // 战役甲波二 T9：证据源从事故单槽换成报送单（镜像 incident-close-workflow.service.ts
  // requestClose 的新守卫，spec §5 第 7 条）——reportRequired=true 时，名下全部报送单须
  // 已提交（submittedAt 非空），零单或任一未提交都拒。
  if (d.reportRequired) {
    if (d.filings.length === 0) {
      return 'A regulatory filing is required but none has been opened yet — cannot close';
    }
    const unsubmitted = d.filings.find((f) => !f.submittedAt);
    if (unsubmitted) {
      return `Regulatory filing ${unsubmitted.filingNo} is not yet submitted — cannot close`;
    }
  }
  return null;
};

const IncidentDetailPage = () => {
  const { incidentNo } = useParams<{ incidentNo: string }>();
  const navigate = useNavigate();
  const { hasPermission } = useAdminSession();

  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // 战役甲波二 T9：定损提交后展示自动开单结果（filingsOpened 单号）——assess 端点回参见
  // incident-assessment-workflow.service.ts，草案/已通报的旧手动标记流程已随单槽退役。
  const [notice, setNotice] = useState<string | null>(null);

  // 调查
  const [noteBody, setNoteBody] = useState('');
  const [escalateTo, setEscalateTo] = useState<string>(ESCALATION_TARGETS[0]);
  const [escalateNote, setEscalateNote] = useState('');

  // 定损——口径按类型收窄（战役甲波一 T10）：assessmentBasis/remediationKind 的初值是
  // MONETARY 口径的合理默认（资金族三存量类型最常见），真实合法值待 detail 加载后由下面
  // 的 useEffect 按该事故类型的 assessmentScheme/allowedRemediationKinds 纠正——不能在这里
  // 直接读 detail.type，因为 Hooks 必须无条件跑在 `if (!detail) return null;` 之前。
  const [assessedAmount, setAssessedAmount] = useState('');
  const [assessmentBasis, setAssessmentBasis] = useState<string>(ASSESSMENT_BASIS_BY_SCHEME.MONETARY[0]);
  const [impactSummary, setImpactSummary] = useState('');
  const [impactCount, setImpactCount] = useState('');
  // 钱/缺口口径：登记时行上无币种 → 定损补填（spec §4.3）；行上有值则只读展示、不发这个键。
  const [assessAssetCode, setAssessAssetCode] = useState('');
  const [reportRequired, setReportRequired] = useState(false);
  const [reportBasisCodes, setReportBasisCodes] = useState<string[]>([]);

  // 善后
  const [remediationKind, setRemediationKind] = useState<string>('SUPPLEMENT');
  const [remediationRef, setRemediationRef] = useState('');

  const fetchDetail = async () => {
    if (!incidentNo) return;
    setLoading(true);
    try {
      const res = await adminFetch(`${import.meta.env.VITE_API_URL}/admin/incidents/${encodeURIComponent(incidentNo)}`);
      if (res.ok) {
        const data = (await res.json()) as Detail;
        setDetail(data);
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

  // 战役甲波一 T10：口径/善后下拉按类型收窄后，一旦事故类型加载出来，把 stale 的初值
  // 纠正成该类型合法集合里的第一个（口径七选一/善后六选一此前是全类型共用的固定选项）。
  // 定损结论按类型 allowedAssessmentBases 收窄（spec §4.1）：合法集只有 1 个值的类型，
  // 这里就是把 state 钉成那个唯一值（表单渲染固定文本、不渲染下拉，提交的就是这个值）。
  useEffect(() => {
    if (!detail) return;
    const cfg = INCIDENT_TYPE_REGISTRY_MIRROR[detail.type];
    const basisOptions = cfg?.allowedAssessmentBases ?? ASSESSMENT_BASIS_BY_SCHEME[cfg?.assessmentScheme ?? 'MONETARY'];
    setAssessmentBasis((prev) => (basisOptions.includes(prev) ? prev : basisOptions[0]));
    const allowedKinds = cfg?.allowedRemediationKinds ?? [];
    setRemediationKind((prev) => (allowedKinds.includes(prev) ? prev : (allowedKinds[0] ?? '')));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail?.type]);

  // spec §4.4：登记锚 → 定损预填（登记=初判、定损=查实，第二次可改）。按 incidentNo 触发而
  // 非 detail 引用——fetchDetail 每次操作后都会换新 detail 对象，按引用触发会冲掉经办人
  // 已改的值。subjectRefs 由 getView 解析成对象回传（与 Type-Specific Details 区块同一读法）。
  useEffect(() => {
    if (!detail) return;
    const refs = detail.subjectRefs;
    const pick = (k: string) => (refs?.[k] != null ? String(refs[k]) : '');
    if (detail.type === 'DATA_BREACH') setImpactCount(pick('affectedCustomerCount'));
    if (detail.type === 'PRUDENTIAL_BREACH') setAssessedAmount(pick('shortfallAmount'));
    if (detail.type === 'OUTSOURCING_FAILURE') setImpactSummary(pick('serviceImpact'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail?.incidentNo]);

  const post = async (path: string, body?: Record<string, unknown>) => {
    if (!detail) return false;
    setBusy(true); setError('');
    try {
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/incidents/${encodeURIComponent(detail.incidentNo)}${path}`,
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

  /** 提交定损——不能复用 post()（丢弃响应体）：assess 端点回参 filingsOpened（自动开单
   * 结果）要展示给经办人看，见 incident-assessment-workflow.service.ts。 */
  const submitAssessment = async (body: Record<string, unknown>) => {
    if (!detail) return;
    setBusy(true); setError('');
    try {
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/incidents/${encodeURIComponent(detail.incidentNo)}/assess`,
        { method: 'POST', body: JSON.stringify(body) },
      );
      if (!res.ok) { setError(await getApiErrorMessage(res, 'Operation failed')); return; }
      const data = (await res.json()) as { filingsOpened: string[] };
      if (data.filingsOpened?.length) {
        setNotice(`Regulatory filing${data.filingsOpened.length > 1 ? 's' : ''} opened: ${data.filingsOpened.join(', ')}`);
        setTimeout(() => setNotice(null), 8000);
      }
      await fetchDetail();
    } catch (e) {
      if (e instanceof AdminSessionError) return;
      setError(e instanceof Error ? e.message : 'Operation failed');
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

  // 战役甲波一 T10（item8）：按"所视事故类型所属族"门控写按钮，不用被五组共享而失去区分力
  // 的路由级码（PERMISSIONS.INCIDENT_WRITE）——见 incidentStatusMap.ts 里
  // INCIDENT_OPERATOR_CAP_CODE 头注释的同款诊断（一个 DPO 打开资金族事故会看见一整排
  // "能点但一点就 403" 的按钮，只有换成按当前事故类型取族独占能力码才会正确收起）。
  const canWrite = hasPermission(INCIDENT_OPERATOR_CAP_CODE[detail.type] ?? PERMISSIONS.INCIDENT_WRITE);
  const cfg = INCIDENT_TYPE_REGISTRY_MIRROR[detail.type];
  const scheme = cfg?.assessmentScheme ?? 'MONETARY';
  const allowedBases = cfg?.allowedAssessmentBases ?? ASSESSMENT_BASIS_BY_SCHEME[scheme];
  const reportBasisOptions = cfg?.reportBasisCandidates ?? [];
  const allowedRemediationKinds = cfg?.allowedRemediationKinds ?? [];

  const closeReason = closeGateReason(detail);
  const canRequestClose = canWrite && !closeReason;
  const canWithdraw = canWrite && detail.status === 'REGISTERED';
  const canStartInvestigation = canWrite && detail.status === 'REGISTERED';
  const canInvestigate = canWrite && detail.status === 'INVESTIGATING';
  const canAssess = canWrite && detail.status === 'INVESTIGATING';
  const canLinkRemediation = canWrite && allowedRemediationKinds.length > 0 && (detail.status === 'ASSESSED' || detail.status === 'RESOLVING');
  // 定损结果是否已落——不能只看 assessedAmount（IMPACT 口径类型定损时不填这个字段，只填
  // impactSummary，见 IncidentService.assess），改看永远会填的 assessmentBasis（三档口径
  // 都必填），否则 CYBER_BCDR/DATA_BREACH/OUTSOURCING_FAILURE/ASSET_NONCOMPLIANCE 四类
  // 定损完仍会被当成"未定损"，Assessment 卡片会一直显示表单而不是结果。
  const assessed = detail.assessmentBasis != null;
  // Task 12：善后区「发起补款」——事故处置中 + 挂载里有一张已落账（POSTED）认损调账单，
  // 说明认损已过审批入账，该由公司补齐客户了。跳到对账案子页，复用那里已有的补款
  // 发起入口（案件页会按 disposition.adjustmentNo 自动算出同一张单的 COMPENSATION
  // nextStep，零新通道）。
  // 走查发现 Fix 2：挂载里已经有一张 kind==='TRANSFER' 的善后单，说明补款单已经在了——
  // 同 Task 12 各入口的徽标收敛纪律，按钮不再显示，避免重复发起。
  const postedAdjustment = detail.status === 'RESOLVING'
    ? detail.remediations.find((r) => r.kind === 'ADJUSTMENT' && r.status === 'POSTED')
    : undefined;
  const hasTransferRemediation = detail.remediations.some((r) => r.kind === 'TRANSFER');
  const canInitiateCompensation = canWrite && !!postedAdjustment && !!detail.sourceCaseNo && !hasTransferRemediation;

  const toggleBasisCode = (code: string) => {
    setReportBasisCodes((prev) => (prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]));
  };

  return (
    <div className="flex h-full flex-col">
      <DetailPageHeader
        title="Incident"
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
      {notice && (
        <div className="px-6 pt-3">
          <div className="rounded border border-adm-amber/30 bg-adm-amber/10 px-4 py-2 font-mono text-[11px] text-adm-amber">{notice}</div>
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 space-y-4 overflow-y-auto p-6">

          {/* ① 基本信息 */}
          <DetailCard title="Basic Info" columns={3}>
            <InfoField label="Type" value={INCIDENT_TYPE_LABEL[detail.type] ?? detail.type} />
            <InfoField label="Status" value={INCIDENT_STATUS_LABEL[detail.status] ?? detail.status} />
            <InfoField label="Amount" value={detail.amount != null ? `${detail.amount} ${detail.assetCode ?? ''}` : null} mono accent />
            <InfoField label="Title" value={detail.title} />
            <InfoField label="Description" value={detail.description} />
            <InfoField
              label="Source Case"
              value={detail.sourceCaseNo}
              mono
              link={detail.sourceCaseNo ? `/admin/reconciliation/cases/${encodeURIComponent(detail.sourceCaseNo)}` : undefined}
            />
            {detail.sourceDispositionNo && <InfoField label="Source Disposition Line" value={detail.sourceDispositionNo} mono />}
            {detail.sourceAdvanceTransferNo && (
              <InfoField
                label="Source Advance Transfer"
                value={detail.sourceAdvanceTransferNo}
                mono
                link={`/admin/custody/internal-transfers/${encodeURIComponent(detail.sourceAdvanceTransferNo)}`}
              />
            )}
            <InfoField
              label="Customer"
              value={detail.customerNo}
              mono
              link={detail.customerNo ? `/admin/customers/${encodeURIComponent(detail.customerNo)}` : undefined}
            />
            <InfoField label="Registered By" value={detail.registeredBy} mono />
            <InfoField label="Registered At" value={fmt(detail.createdAt)} mono />
            {detail.closedAt && <InfoField label="Closed At" value={fmt(detail.closedAt)} mono />}
            {detail.withdrawnReason && <InfoField label="Withdrawn Reason" value={detail.withdrawnReason} highlight />}
          </DetailCard>
          {detail.customerNo && (
            <div className="-mt-2">
              <Link to={`/admin/customers/${encodeURIComponent(detail.customerNo)}`} className={adminButtonClass('detailUtility')}>
                Freeze via Customer page (not automatic — freezing goes through the separate customer restriction gate)
              </Link>
            </div>
          )}

          {/* ①b 类型专属锚（新七类，subjectRefs 键值区块——顶层锚 assetCode/customerNo/
              amount 已经在 Basic Info 里，这里只放剩下那些，铁律⑥零 UUID：业务值全是文本/
              受控枚举/布尔）。 */}
          {detail.subjectRefs && Object.keys(detail.subjectRefs).length > 0 && (
            <DetailCard title="Type-Specific Details" columns={3}>
              {Object.entries(detail.subjectRefs).map(([key, value]) => (
                <InfoField
                  key={key}
                  label={ANCHOR_FIELD_LABEL[key] ?? key}
                  value={formatSubjectRefValue(key, value)}
                  mono={key === 'complaintNo'}
                  // 战役甲波五 Task 9（承接项H）：complaintNo 是 COMPLAINT_ESCALATION 的类型专属
                  // 回链锚（见 ANCHOR_FIELD_LABEL 头注释）——spec §9 判据2 要求投诉/事件双向
                  // 跳转可点，这里补链接，同 Source Case/Customer 字段既有 link= 惯例。
                  link={key === 'complaintNo' && typeof value === 'string' ? `/admin/governance/complaints/${encodeURIComponent(value)}` : undefined}
                />
              ))}
            </DetailCard>
          )}

          {/* ② 调查时间线 */}
          <DetailCard title="Investigation Timeline" columns={1}>
            <div className="col-span-full space-y-3">
              {canStartInvestigation && (
                <button type="button" disabled={busy} onClick={() => void post('/investigation')} className={adminButtonClass('workflowPrimary')}>
                  Start Investigation
                </button>
              )}
              {detail.notes.length === 0 && <p className="font-mono text-[11px] text-adm-t3">No investigation notes yet</p>}
              {detail.notes.map((n, i) => (
                <div
                  key={i}
                  className={`rounded border p-3 ${n.kind === 'ESCALATION' ? 'border-adm-amber/40 bg-adm-amber/5' : 'border-adm-border bg-adm-bg'}`}
                >
                  <div className="mb-1 flex items-center gap-2">
                    <span className="font-mono text-[10px] font-semibold text-adm-t2">
                      {n.kind === 'ESCALATION' ? `Escalated → ${ESCALATION_TARGET_LABEL[n.escalatedTo ?? ''] ?? n.escalatedTo}` : 'Investigation note'}
                    </span>
                    <span className="font-mono text-[9px] text-adm-t3">{n.authorBy} · {fmt(n.createdAt)}</span>
                  </div>
                  <p className="text-[11px] text-adm-t2">{n.body}</p>
                </div>
              ))}

              {canInvestigate && (
                <div className="space-y-3 border-t border-adm-border pt-3">
                  <div>
                    <p className="mb-1 font-mono text-[9px] uppercase tracking-[0.1em] text-adm-t3">Add Investigation Note</p>
                    <textarea value={noteBody} onChange={(e) => setNoteBody(e.target.value)} rows={2} className="w-full rounded border border-adm-border bg-adm-panel px-2 py-1 text-xs" placeholder="What was investigated, what was found" />
                    <button type="button" disabled={busy || !noteBody.trim()} onClick={() => { void post('/notes', { body: noteBody.trim() }).then((ok) => { if (ok) setNoteBody(''); }); }} className={`mt-1.5 ${adminButtonClass('detailUtility')}`}>
                      Add Note
                    </button>
                  </div>
                  <div>
                    <p className="mb-1 font-mono text-[9px] uppercase tracking-[0.1em] text-adm-t3">Escalate</p>
                    <div className="flex gap-2">
                      <select value={escalateTo} onChange={(e) => setEscalateTo(e.target.value)} className="rounded border border-adm-border bg-adm-panel px-2 py-1 text-xs">
                        {ESCALATION_TARGETS.map((t) => <option key={t} value={t}>{ESCALATION_TARGET_LABEL[t]}</option>)}
                      </select>
                      <input value={escalateNote} onChange={(e) => setEscalateNote(e.target.value)} className="flex-1 rounded border border-adm-border bg-adm-panel px-2 py-1 text-xs" placeholder="Escalation note" />
                    </div>
                    <button type="button" disabled={busy || !escalateNote.trim()} onClick={() => { void post('/escalate', { to: escalateTo, note: escalateNote.trim() }).then((ok) => { if (ok) setEscalateNote(''); }); }} className={`mt-1.5 ${adminButtonClass('detailUtility')}`}>
                      Escalate
                    </button>
                  </div>
                </div>
              )}
            </div>
          </DetailCard>

          {/* ③ 定损——口径按类型收窄（战役甲波一 Task 6/T10；2026-10-07 表单重设计 spec §4）：
              结论 + 数字 + 说明 + 通报判定四段统一。MONETARY/SHORTFALL 填金额（带币种），
              IMPACT 填影响数；三口径说明字段（复用 impactSummary 列）都必填；结论合法集
              按类型 allowedAssessmentBases，只有 1 个值时渲染固定文本；依据码候选集按类型
              reportBasisCandidates，零候选类型渲染静态说明。 */}
          <DetailCard title="Assessment" columns={assessed ? 3 : 1}>
            {assessed ? (
              <>
                {detail.assessedAmount != null && (
                  <InfoField label="Assessed Amount" value={`${detail.assessedAmount} ${detail.assetCode ?? ''}`} mono accent />
                )}
                {detail.impactSummary != null && <InfoField label={scheme === 'IMPACT' ? 'Impact Summary' : 'Assessment Note'} value={detail.impactSummary} />}
                {detail.impactCount != null && <InfoField label="Impact Count" value={String(detail.impactCount)} mono />}
                <InfoField label="Assessment Basis" value={ASSESSMENT_BASIS_LABEL[detail.assessmentBasis ?? ''] ?? detail.assessmentBasis} />
                <InfoField label="Reporting Required" value={detail.reportRequired ? 'Yes' : 'No'} />
              </>
            ) : canAssess ? (
              <div className="col-span-full space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  {scheme === 'IMPACT' ? (
                    <input value={impactCount} onChange={(e) => setImpactCount(e.target.value)} placeholder="Impact count (optional)" className="w-44 rounded border border-adm-border bg-adm-panel px-2 py-1 text-xs font-mono" />
                  ) : (
                    <>
                      <input value={assessedAmount} onChange={(e) => setAssessedAmount(e.target.value)} placeholder="Assessed amount" className="w-40 rounded border border-adm-border bg-adm-panel px-2 py-1 text-xs font-mono" />
                      {detail.assetCode ? (
                        <span className="font-mono text-xs text-adm-t3">{detail.assetCode}</span>
                      ) : (
                        <input value={assessAssetCode} onChange={(e) => setAssessAssetCode(e.target.value)} placeholder="Asset code*" className="w-28 rounded border border-adm-border bg-adm-panel px-2 py-1 text-xs font-mono" />
                      )}
                    </>
                  )}
                  {allowedBases.length === 1 ? (
                    <span className="text-xs">{ASSESSMENT_BASIS_LABEL[allowedBases[0]]}</span>
                  ) : (
                    <select value={assessmentBasis} onChange={(e) => setAssessmentBasis(e.target.value)} className="rounded border border-adm-border bg-adm-panel px-2 py-1 text-xs">
                      {allowedBases.map((v) => <option key={v} value={v}>{ASSESSMENT_BASIS_LABEL[v]}</option>)}
                    </select>
                  )}
                  {reportBasisOptions.length > 0 && (
                    <label className="flex items-center gap-1 text-xs">
                      <input
                        type="checkbox"
                        checked={reportRequired}
                        onChange={(e) => setReportRequired(e.target.checked)}
                      /> Regulatory report required
                    </label>
                  )}
                </div>
                <textarea
                  value={impactSummary}
                  onChange={(e) => setImpactSummary(e.target.value)}
                  rows={2}
                  className="w-full rounded border border-adm-border bg-adm-panel px-2 py-1 text-xs"
                  placeholder={scheme === 'IMPACT'
                    ? 'Impact summary (required for this incident type)'
                    : 'Assessment note — basis for this determination (required)'}
                />
                {reportBasisOptions.length === 0 && NO_REPORTING_NOTE[detail.type] && (
                  <p className="font-mono text-[10px] text-adm-t3">{NO_REPORTING_NOTE[detail.type]}</p>
                )}
                {reportRequired && reportBasisOptions.length > 0 && (
                  <div className="space-y-1">
                    <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-adm-t3">Report Basis (multi-select)</p>
                    {reportBasisOptions.map((code) => {
                      const b = INCIDENT_REPORT_BASES[code];
                      return (
                        <label key={code} className="flex items-start gap-1.5 text-[11px]">
                          <input type="checkbox" checked={reportBasisCodes.includes(code)} onChange={() => toggleBasisCode(code)} className="mt-0.5" />
                          <span>
                            <span className="font-mono">{code}</span> — {b?.label ?? ''}
                            {' — '}
                            <span className="font-mono text-[10px] text-adm-amber">{reportBasisClockText(code)}</span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                )}
                <button
                  type="button"
                  disabled={
                    busy
                    || !impactSummary.trim()
                    || (scheme !== 'IMPACT' && (!assessedAmount.trim() || (!detail.assetCode && !assessAssetCode.trim())))
                    || (reportRequired && reportBasisCodes.length === 0)
                  }
                  onClick={() => void submitAssessment({
                    assessedAmount: scheme === 'IMPACT' ? undefined : assessedAmount.trim(),
                    // 三口径统一发 impactSummary 键（说明字段复用该列，spec §4.2）。
                    impactSummary: impactSummary.trim(),
                    // 钱/缺口口径：登记时行上无币种才带补填值，行上有值以后端行值为准（spec §4.3）。
                    assetCode: scheme !== 'IMPACT' && !detail.assetCode ? assessAssetCode.trim() : undefined,
                    impactCount: scheme === 'IMPACT' && impactCount.trim() ? Number(impactCount.trim()) : undefined,
                    assessmentBasis, reportRequired, reportBasisCodes: reportRequired ? reportBasisCodes : undefined,
                  })}
                  className={adminButtonClass('workflowPrimary')}
                >
                  Submit Assessment
                </button>
              </div>
            ) : (
              <p className="font-mono text-[11px] text-adm-t3">Start an investigation first (status must reach Investigating) before assessing</p>
            )}
          </DetailCard>

          {/* ④ 善后单 */}
          <DetailCard title="Remediation" columns={1}>
            <div className="col-span-full space-y-3">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-adm-t3">
                    {['Type', 'Reference', 'Linked By', 'Time'].map((h) => <th key={h} className="px-2 py-1 font-mono text-[10px]">{h}</th>)}
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
                    <tr><td colSpan={4} className="px-2 py-3 text-adm-t3">No remediation items linked yet</td></tr>
                  )}
                </tbody>
              </table>

              {canLinkRemediation ? (
                <div className="flex gap-2 border-t border-adm-border pt-3">
                  <select value={remediationKind} onChange={(e) => setRemediationKind(e.target.value)} className="rounded border border-adm-border bg-adm-panel px-2 py-1 text-xs">
                    {allowedRemediationKinds.map((k) => <option key={k} value={k}>{REMEDIATION_KIND_LABEL[k]}</option>)}
                  </select>
                  <input value={remediationRef} onChange={(e) => setRemediationRef(e.target.value)} placeholder="Reference No" className="flex-1 rounded border border-adm-border bg-adm-panel px-2 py-1 text-xs font-mono" />
                  <button
                    type="button"
                    disabled={busy || !remediationRef.trim()}
                    onClick={() => { void post('/remediations', { kind: remediationKind, referenceNo: remediationRef.trim() }).then((ok) => { if (ok) setRemediationRef(''); }); }}
                    className={adminButtonClass('detailUtility')}
                  >
                    Link
                  </button>
                </div>
              ) : allowedRemediationKinds.length === 0 ? (
                (detail.status === 'ASSESSED' || detail.status === 'RESOLVING') && (
                  <p className="border-t border-adm-border pt-3 font-mono text-[11px] text-adm-t3">This incident type has no remediation actions to attach — it can be closed directly once assessed.</p>
                )
              ) : (
                (detail.status === 'REGISTERED' || detail.status === 'INVESTIGATING') && (
                  <p className="border-t border-adm-border pt-3 font-mono text-[11px] text-adm-t3">Complete the assessment first before linking a remediation item</p>
                )
              )}
              {canInitiateCompensation && (
                <div className="border-t border-adm-border pt-3">
                  <button
                    type="button"
                    onClick={() => navigate(`/admin/reconciliation/cases/${encodeURIComponent(detail.sourceCaseNo!)}?adjustmentNo=${encodeURIComponent(postedAdjustment!.referenceNo)}`)}
                    className={adminButtonClass('workflowPrimary')}
                  >
                    Initiate Compensation
                  </button>
                  <p className="mt-1 font-mono text-[9px] text-adm-t3">Loss-recognition adjustment {postedAdjustment!.referenceNo} has posted — jump to the reconciliation case page to initiate compensation (reuses the existing entry point)</p>
                </div>
              )}
            </div>
          </DetailCard>

          {/* ⑤ 通报留痕——战役甲波二 T9：草案 textarea/「Mark reported」按钮随单槽退役，
              改「Regulatory filings」表——横向只读报送单摘要（getView 新 filings 键），
              行点击跳报送单详情页（有读权限者才点得进去，路由自己的 withPermission 门控）。 */}
          <DetailCard title="Regulatory Filings" columns={1}>
            {!assessed ? (
              <p className="font-mono text-[11px] text-adm-t3">Whether a report is required is determined after assessment</p>
            ) : !detail.reportRequired ? (
              <p className="font-mono text-[11px] text-adm-t3">This incident was determined not to require reporting</p>
            ) : detail.filings.length === 0 ? (
              <p className="font-mono text-[11px] text-adm-red">Reporting is required but no filing has been opened yet</p>
            ) : (
              <div className="col-span-full space-y-2">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-adm-t3">
                      {['Filing No.', 'Basis', 'Authority', 'Status', 'Deadline'].map((h) => (
                        <th key={h} className="px-2 py-1 font-mono text-[10px]">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {detail.filings.map((f) => {
                      const fDeadline = reportDeadlineDisplay(f.deadlineAt, f.submittedAt, f.overdueMarkedAt, f.basisCode);
                      return (
                        <tr
                          key={f.filingNo}
                          onClick={() => navigate(`/admin/governance/regulatory-filings/${encodeURIComponent(f.filingNo)}`)}
                          className="cursor-pointer border-t border-adm-border/60 hover:bg-adm-hover/40"
                        >
                          <td className="px-2 py-1 font-mono text-adm-blue">{f.filingNo}</td>
                          <td className="px-2 py-1">
                            {f.basisCode ? (
                              <><span className="font-mono">{f.basisCode}</span> — {INCIDENT_REPORT_BASES[f.basisCode]?.label ?? ''}</>
                            ) : '—'}
                          </td>
                          <td className="px-2 py-1">{AUTHORITY_LABEL[f.authority] ?? f.authority}</td>
                          <td className="px-2 py-1"><StatusPill value={f.status} /></td>
                          <td className="px-2 py-1">
                            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${REPORT_DEADLINE_TONE_CLASS[fDeadline.tone]}`}>
                              {fDeadline.text}
                            </span>
                            {!f.submittedAt && <span className="ml-1.5 font-mono text-[9px] text-adm-red">not yet submitted</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
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
                Request Close
              </button>
              {closeReason && <p className="mt-1 font-mono text-[9px] text-adm-t3">{closeReason}</p>}
              {canWithdraw && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    const reason = window.prompt('Withdrawal reason (required — how a mis-registration gets recorded; leaves an audit trail, not an eraser)');
                    if (reason?.trim()) void post('/withdraw', { reason: reason.trim() });
                  }}
                  className={`mt-2 ${adminButtonClass('workflowNegative')}`}
                >
                  Withdraw (mis-registered)
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
            <SidebarGroup title="Close Approval">
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
