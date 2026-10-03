// admin-web/src/pages/DsrRequestDetailPage.tsx
// 战役丙波四 Task 6：资料请求（DSR）——详情。主体区：请求（含客户自述）｜进度轴 + 单钟｜
// 数据摘要（仅 ACCESS）｜办结结论｜条款引用（仅 ERASURE 办结后）。侧栏：动作区（状态×持码双维：
// Start review / Generate summary / Resolve 是 DSR_WRITE=DPO 独占的三枚写钮 + 审计跳转）、
// Manual Simulation（⚡拨钟，DEMO_CLOCK_WRITE × Simulation 开关双门控，照投诉详情页）、身份摘要、
// Lifecycle。铁律⑥：投影只有 requestNo / customerNo 两个业务号，零 UUID。
// 模板：ComplaintDetailPage.tsx 的 fetch / post / 门控写法 + IncidentDetailPage.tsx 的侧栏 Actions 块。
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { RefreshCw, Zap } from 'lucide-react';
import { DetailCard, DetailPageHeader, InfoField } from '../components/compliance/DetailPageComponents';
import { SidebarGroup, SidebarKV } from '../components/ui/SidebarPrimitives';
import { StatusPill } from '../components/ui/StatusPill';
import { ViewAuditTrailButton } from '../components/common/ViewAuditTrailButton';
import { adminButtonClass } from '../components/common/adminButtonStyles';
import { AdminSessionError, adminFetch, getApiErrorMessage } from '../utils/adminFetch';
import { useAdminSession } from '../contexts/AdminSessionContext';
import { PERMISSIONS } from '../rbac/permissions';
import { useSimulationMode } from '../utils/simulationMode';
import { remainingClockText } from '../utils/complaintMap';
import {
  activeDsrClock, DSR_RESOLUTION_BY_TYPE, DSR_RESOLUTION_HINT, DSR_RESOLUTION_LABEL, DSR_STATUS_LABEL,
  DSR_SUMMARY_PROFILE_LABELS, DSR_TERMINAL_STATUS, DSR_TYPE_HINT, DSR_TYPE_LABEL, humanizeCode,
} from '../utils/dsrMap';

interface Summary {
  generatedAt: string;
  profile: Record<string, string | null>;
  agreementConsents: Array<{ versionKey: string; actedAt: string; decision: string }>;
  kycMaterials: Array<{ materialType: string; status: string; issuedAt: string }>;
}

interface Detail {
  requestNo: string;
  customerNo: string;
  type: string;
  status: string;
  submittedAt: string;
  reviewStartedAt: string | null;
  resolvedAt: string | null;
  dueAt: string;
  resolutionCode: string | null;
  detail: string;
  resolutionNote: string | null;
  clauseRef: { versionKey: string; section: string } | null;
  summary: Summary | null;
  materialRequestNo: string | null;
}

const fmt = (v?: string | null): string => {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString();
};

/** 摘要档案块的值展示：两个时间型字段转人读，其余原样（null → InfoField 自己出 —）。 */
const profileValue = (key: string, v: string | null): string | null => {
  if (v == null || v === '') return null;
  if (key === 'dateOfBirth') return v.slice(0, 10);
  if (key === 'onboardingApprovedAt') return fmt(v);
  return v;
};

/** 办结——结局码按请求类型过滤（镜像后端 DSR_RESOLUTION_BY_TYPE），答复正文必填且客户可见。 */
const ResolveModal = ({
  busy, type, onClose, onSubmit,
}: { busy: boolean; type: string; onClose: () => void; onSubmit: (resolutionCode: string, resolutionNote: string) => void }) => {
  const codes = DSR_RESOLUTION_BY_TYPE[type] ?? [];
  // 父级只在打开时才挂载本组件，初值即「每次打开都从干净状态起」，不需要 effect 重置。
  const [code, setCode] = useState(codes[0] ?? '');
  const [note, setNote] = useState('');
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="w-[480px] rounded-lg border border-adm-border bg-adm-panel p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-1 text-sm font-semibold text-adm-t1">Resolve Data Request</h3>
        <p className="mb-3 font-mono text-[10px] text-adm-t3">The outcome and reply below are sent to the customer and the request is closed — no further changes.</p>
        <label className="mb-1 block text-xs">Outcome
          <select value={code} onChange={(e) => setCode(e.target.value)} className="mt-1 w-full rounded border border-adm-border bg-adm-panel px-2 py-1 text-xs">
            {codes.map((c) => <option key={c} value={c}>{DSR_RESOLUTION_LABEL[c] ?? c}</option>)}
          </select>
        </label>
        {code && <p className="mb-3 font-mono text-[10px] text-adm-t3">{DSR_RESOLUTION_HINT[code]}</p>}
        <label className="mb-3 block text-xs">Reply to the Customer
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={5}
            className="mt-1 w-full rounded border border-adm-border bg-adm-panel px-2 py-1 text-xs"
            placeholder="What we did with the request — keep internal investigation details out; the customer reads this as written"
          />
        </label>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={adminButtonClass('modalCancel')}>Cancel</button>
          <button type="button" disabled={busy || !code || !note.trim()} onClick={() => onSubmit(code, note.trim())} className={adminButtonClass('modalConfirm')}>
            {busy ? 'Resolving…' : 'Resolve'}
          </button>
        </div>
      </div>
    </div>
  );
};

/** 三态进度轴：已走过的绿点、当前态琥珀点、未到灰点；RESOLVED 是终点，到达即全绿。 */
const STAGES: Array<{ key: string; stamp: (d: Detail) => string | null }> = [
  { key: 'SUBMITTED', stamp: (d) => d.submittedAt },
  { key: 'IN_REVIEW', stamp: (d) => d.reviewStartedAt },
  { key: 'RESOLVED', stamp: (d) => d.resolvedAt },
];

const DsrTimeline = ({ detail }: { detail: Detail }) => {
  const reachedIdx = STAGES.findIndex((s) => s.key === detail.status);
  const finished = detail.status === DSR_TERMINAL_STATUS;
  return (
    <div className="flex flex-col gap-3">
      {STAGES.map((s, idx) => {
        const done = idx < reachedIdx || finished;
        const current = idx === reachedIdx && !finished;
        const ts = s.stamp(detail);
        return (
          <div key={s.key} className="flex items-center gap-3">
            <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${done ? 'bg-adm-green' : current ? 'bg-adm-amber' : 'bg-adm-border'}`} />
            <span className={`font-mono text-[11px] ${current ? 'font-semibold text-adm-t1' : done ? 'text-adm-t2' : 'text-adm-t3'}`}>
              {DSR_STATUS_LABEL[s.key]}
            </span>
            {ts && <span className="font-mono text-[10px] text-adm-t3">{fmt(ts)}</span>}
          </div>
        );
      })}
    </div>
  );
};

const SectionLabel = ({ children }: { children: string }) => (
  <p className="mb-2 font-mono text-[9px] uppercase tracking-[0.1em] text-adm-t3">{children}</p>
);

const DsrRequestDetailPage = () => {
  const { requestNo } = useParams<{ requestNo: string }>();
  const navigate = useNavigate();
  const { hasPermission } = useAdminSession();
  const canWrite = hasPermission(PERMISSIONS.DSR_WRITE);
  const { enabled: simEnabled } = useSimulationMode();
  const canSimulate = hasPermission(PERMISSIONS.DEMO_CLOCK_WRITE);

  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showResolve, setShowResolve] = useState(false);

  const fetchDetail = async () => {
    if (!requestNo) return;
    setLoading(true);
    try {
      const res = await adminFetch(`${import.meta.env.VITE_API_URL}/admin/dsr-requests/${encodeURIComponent(requestNo)}`);
      if (res.ok) {
        setDetail((await res.json()) as Detail);
      } else {
        alert(await getApiErrorMessage(res, 'Failed to load data request'));
        navigate('/admin/governance/compliance-office/dsr-requests');
      }
    } catch (e) {
      if (e instanceof AdminSessionError) return;
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (requestNo) void fetchDetail();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestNo]);

  const post = async (path: string, body?: Record<string, unknown>) => {
    if (!detail) return false;
    setBusy(true); setError('');
    try {
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/dsr-requests/${encodeURIComponent(detail.requestNo)}${path}`,
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
        <p className="text-adm-t3">Loading data request...</p>
      </div>
    );
  }
  if (!detail) return null;

  // 可见性口径（同投诉）：状态 × 持码双维，不加第三维。
  const status = detail.status;
  const isAccess = detail.type === 'ACCESS';
  const canStartReview = canWrite && status === 'SUBMITTED';
  const canGenerateSummary = canWrite && isAccess && status === 'IN_REVIEW' && !detail.summary;
  const canResolve = canWrite && status === 'IN_REVIEW';
  // ACCESS 必须先固化摘要才能办结（后端同口径）——前端灰掉并写明原因，不让 DPO 点出必然的 400。
  const resolveBlockedReason = isAccess && !detail.summary ? 'Generate the data summary first' : null;
  const clock = activeDsrClock(detail);
  const canFastForward = simEnabled && canSimulate && !!clock;

  return (
    <div className="flex h-full flex-col">
      <DetailPageHeader
        title="Data Request"
        subtitle={detail.requestNo}
        onBack={() => navigate('/admin/governance/compliance-office/dsr-requests')}
        onRefresh={() => void fetchDetail()}
        refreshing={loading}
        backLabel="Data Requests"
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

          {/* ① 请求——类型 / 客户 / 提交时间 + 客户自述原文 */}
          <DetailCard title="Request" columns={3} description={DSR_TYPE_HINT[detail.type]}>
            <InfoField label="Type" value={DSR_TYPE_LABEL[detail.type] ?? detail.type} />
            <InfoField
              label="Customer"
              value={detail.customerNo}
              mono
              link={`/admin/customers/${encodeURIComponent(detail.customerNo)}`}
            />
            <InfoField label="Submitted At" value={fmt(detail.submittedAt)} mono />
            <div className="col-span-full">
              <InfoField label="Customer's Statement" value={detail.detail} />
            </div>
          </DetailCard>

          {/* ② 进度轴 + 单钟——30 自然日，锚提交时刻；办结即停。 */}
          <DetailCard title="Progress" columns={1}>
            <DsrTimeline detail={detail} />
            <div className={`rounded border p-3 ${clock?.overdue ? 'border-adm-red/40 bg-adm-red/5' : 'border-adm-border bg-adm-bg'}`}>
              <div className="font-mono text-[9px] uppercase tracking-[0.1em] text-adm-t3">Response Clock (30 days from submission)</div>
              <div className="mt-1 font-mono text-xs text-adm-t1">{fmt(detail.dueAt)}</div>
              {clock && (
                <div className={`mt-1 font-mono text-[10px] ${clock.overdue ? 'text-adm-red' : 'text-adm-t3'}`}>{remainingClockText(clock.deadlineAt)}</div>
              )}
              {!clock && detail.resolvedAt && (
                <div className="mt-1 font-mono text-[10px] text-adm-green">Stopped — resolved {fmt(detail.resolvedAt)}</div>
              )}
            </div>
          </DetailCard>

          {/* ③ 数据摘要——仅 ACCESS 型；快照一次写成，三块分区。 */}
          {isAccess && (
            <DetailCard
              title="Data Summary"
              columns={1}
              description={detail.summary ? `Snapshot taken ${fmt(detail.summary.generatedAt)} — written once; this is what the customer receives` : undefined}
            >
              {!detail.summary && (
                <p className="font-mono text-[11px] text-adm-t3">
                  Not generated yet — start the review, then use Generate Summary; the request cannot be resolved without it
                </p>
              )}
              {detail.summary && (
                <div className="space-y-5">
                  <div>
                    <SectionLabel>Profile</SectionLabel>
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                      {DSR_SUMMARY_PROFILE_LABELS.map(({ key, label }) => (
                        <InfoField key={key} label={label} value={profileValue(key, detail.summary?.profile[key] ?? null)} mono />
                      ))}
                    </div>
                  </div>

                  <div>
                    <SectionLabel>Agreement Consents</SectionLabel>
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-left text-adm-t3">
                          {['Version', 'Decision', 'Acted At'].map((h) => <th key={h} className="px-2 py-1 font-mono text-[10px]">{h}</th>)}
                        </tr>
                      </thead>
                      <tbody>
                        {detail.summary.agreementConsents.map((c, i) => (
                          <tr key={i} className="border-t border-adm-border/60">
                            <td className="px-2 py-1 font-mono">{c.versionKey}</td>
                            <td className="px-2 py-1">{humanizeCode(c.decision)}</td>
                            <td className="px-2 py-1 font-mono">{fmt(c.actedAt)}</td>
                          </tr>
                        ))}
                        {detail.summary.agreementConsents.length === 0 && (
                          <tr><td colSpan={3} className="px-2 py-3 text-adm-t3">No agreement history on file</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>

                  <div>
                    <SectionLabel>KYC Materials</SectionLabel>
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-left text-adm-t3">
                          {['Material', 'Status', 'Issued At'].map((h) => <th key={h} className="px-2 py-1 font-mono text-[10px]">{h}</th>)}
                        </tr>
                      </thead>
                      <tbody>
                        {detail.summary.kycMaterials.map((m, i) => (
                          <tr key={i} className="border-t border-adm-border/60">
                            <td className="px-2 py-1">{humanizeCode(m.materialType)}</td>
                            <td className="px-2 py-1"><StatusPill value={m.status} /></td>
                            <td className="px-2 py-1 font-mono">{fmt(m.issuedAt)}</td>
                          </tr>
                        ))}
                        {detail.summary.kycMaterials.length === 0 && (
                          <tr><td colSpan={3} className="px-2 py-3 text-adm-t3">No material requests on file</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </DetailCard>
          )}

          {/* ④ 办结结论——结局码 + 对客户的答复原文 + 连带开出的材料请求（若有）。 */}
          {detail.resolutionCode && (
            <DetailCard title="Resolution" columns={2}>
              <InfoField label="Outcome" value={DSR_RESOLUTION_LABEL[detail.resolutionCode] ?? detail.resolutionCode} highlight />
              <InfoField label="Resolved At" value={fmt(detail.resolvedAt)} mono />
              {detail.materialRequestNo && <InfoField label="Material Request" value={detail.materialRequestNo} mono />}
              <div className="col-span-full">
                <InfoField label="Reply to the Customer" value={detail.resolutionNote} />
              </div>
            </DetailCard>
          )}

          {/* ⑤ 条款引用——拒绝删除时引的协议版本与章节（办结时后端自动取客户最新同意版）。 */}
          {detail.clauseRef && (
            <DetailCard title="Clause Reference" columns={2} description="The customer agreement clause cited in the refusal letter">
              {/* 不挂协议页链接：协议版本页要 COMPLIANCE_OFFICE_VIEW，DPO 不持，链出去只会 403。 */}
              <InfoField label="Agreement Version" value={detail.clauseRef.versionKey} mono />
              <InfoField label="Section" value={detail.clauseRef.section} mono />
            </DetailCard>
          )}
        </div>

        {/* ════ 右侧栏 ════ */}
        <aside className="w-[280px] min-w-[280px] overflow-y-auto border-l border-adm-border bg-adm-panel px-4">
          <SidebarGroup title="Actions">
            {canStartReview && (
              <button type="button" disabled={busy} onClick={() => void post('/start-review')} className={adminButtonClass('workflowPrimary')}>
                Start Review
              </button>
            )}
            {canGenerateSummary && (
              <button type="button" disabled={busy} onClick={() => void post('/generate-summary')} className={adminButtonClass('workflowPrimary')}>
                Generate Summary
              </button>
            )}
            {canResolve && (
              <>
                <button
                  type="button"
                  disabled={busy || !!resolveBlockedReason}
                  title={resolveBlockedReason ?? undefined}
                  onClick={() => setShowResolve(true)}
                  className={adminButtonClass('workflowPrimary')}
                >
                  Resolve
                </button>
                {resolveBlockedReason && <p className="font-mono text-[9px] text-adm-t3">{resolveBlockedReason}</p>}
              </>
            )}
            <ViewAuditTrailButton params={{ subjectNo: detail.requestNo }} />
            {!canWrite && status !== DSR_TERMINAL_STATUS && (
              <p className="font-mono text-[9px] text-adm-t3">Read-only — only the Data Protection Officer can work this request</p>
            )}
            {canWrite && status === DSR_TERMINAL_STATUS && (
              <p className="font-mono text-[9px] text-adm-t3">Resolved — no further workflow actions</p>
            )}
          </SidebarGroup>

          {canFastForward && (
            <SidebarGroup title="Manual Simulation">
              <button
                type="button"
                disabled={busy}
                onClick={() => void post('/simulate-timeout')}
                className={adminButtonClass('simulationAction')}
                title="Fast-forward the response deadline into the past (demo only)"
              >
                <Zap size={11} /> Simulate Timeout
              </button>
            </SidebarGroup>
          )}

          <SidebarGroup title="Summary">
            <SidebarKV label="Type" value={DSR_TYPE_LABEL[detail.type] ?? detail.type} />
            <SidebarKV label="Customer" value={detail.customerNo} mono />
            <SidebarKV label="Outcome" value={detail.resolutionCode ? DSR_RESOLUTION_LABEL[detail.resolutionCode] ?? detail.resolutionCode : null} />
          </SidebarGroup>

          <SidebarGroup title="Lifecycle">
            <SidebarKV label="Submitted" value={fmt(detail.submittedAt)} mono />
            <SidebarKV label="Review Started" value={detail.reviewStartedAt ? fmt(detail.reviewStartedAt) : null} mono />
            <SidebarKV label="Due" value={fmt(detail.dueAt)} mono />
            <SidebarKV label="Resolved" value={detail.resolvedAt ? fmt(detail.resolvedAt) : null} mono />
          </SidebarGroup>
        </aside>
      </div>

      {showResolve && (
        <ResolveModal
          busy={busy}
          type={detail.type}
          onClose={() => setShowResolve(false)}
          onSubmit={(resolutionCode, resolutionNote) => { void post('/resolve', { resolutionCode, resolutionNote }).then((ok) => { if (ok) setShowResolve(false); }); }}
        />
      )}
    </div>
  );
};

export default DsrRequestDetailPage;
