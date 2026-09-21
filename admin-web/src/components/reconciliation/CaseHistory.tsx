// admin-web/src/components/reconciliation/CaseHistory.tsx
//
// 第六幕波四（Task 4）：从 ReconciliationCasesDetailPage.tsx 剪切粘贴外迁——
// caseHistoryTime + CaseHistoryCell（不导出）+ CaseHistory（导出）。逐字搬运，
// 注释随行；不改 JSX/className/文案。
import type { ReconCaseDetail } from '../../utils/reconTypes';

// Task 8（Case History 卡）：三格用的紧凑时间戳——design/Main.dc.html 字面格式
// "Sep 6, 21:51"（24 小时制，无秒）。
const caseHistoryTime = (iso: string | null): string | null => {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  // Fix round：hour12:false 在午夜仍会把 00:xx 显示成 24:xx（Chrome/V8 已知行为，
  // hour12:false 只关闭 AM/PM 后缀不改小时基数）——改用 hourCycle:'h23' 才是真正的
  // 0–23 小时制,午夜正确显示 00:30 而不是 24:30。
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
};

// Task 8：Case History 三格卡，替换旧的一行式 ObservationBar——OPENED BY /
// LAST RE-CHECKED / AGING（design/Main.dc.html §3）。复观察次数（reObservedCount）
// 故意不渲染：该计数器现状恒为 0（T6 已知限制，见 CaseObservation 类型定义处的
// KNOWN LIMITATION 注释——delete-then-insert 的行项目没有跨轮身份），spec §3.3
// 业主拍板不展示，不是本任务该修的 bug。RESOLVED 案子的 resolutionReason 同样不
// 在三格里落地——设计给的字面模板只有 closedByRunNo+"closed"，没有它的位置。
const CaseHistoryCell = ({
  label, value, sub, tone = 'neutral',
}: { label: string; value: string; sub?: string | null; tone?: 'neutral' | 'red' }) => (
  <div
    className={[
      'rounded-lg border p-4',
      tone === 'red' ? 'border-adm-red/30 bg-adm-red/5' : 'border-adm-border bg-adm-bg',
    ].join(' ')}
  >
    <div className={['font-mono text-[9px] uppercase tracking-wider', tone === 'red' ? 'text-adm-red' : 'text-adm-t3'].join(' ')}>
      {label}
    </div>
    <div className={['mt-1 font-mono text-[13px]', tone === 'red' ? 'font-bold text-adm-red' : 'text-adm-t1'].join(' ')}>
      {value}
    </div>
    {sub && <div className="mt-0.5 font-mono text-[10px] text-adm-t3">{sub}</div>}
  </div>
);

// agingReferenceMs — Minor #5（终审）冻结逻辑：结案后的超期天数在结案那一刻冻结，
// 不再跟着 Date.now() 涨；由外层（页面组件已算好）传入，AGING 格与 Hero 徽标共用
// 同一个数，避免两处各算一遍出现分歧。
export const CaseHistory = ({ kase, agingReferenceMs }: { kase: ReconCaseDetail; agingReferenceMs: number }) => {
  const obs = kase.observation;
  const runOrDash = (v: string | null | undefined) => v ?? '—';
  if (!obs) {
    return <div className="font-mono text-[12px] text-adm-t3">No observation history available.</div>;
  }
  const isResolved = kase.status === 'RESOLVED';
  const isOverdue = !isResolved && kase.slaBreached && !!kase.slaDeadline;
  const overdueDays = isOverdue && kase.slaDeadline
    ? Math.max(1, Math.floor((agingReferenceMs - new Date(kase.slaDeadline).getTime()) / 86_400_000))
    : 0;
  const ageDaysFrozen = Math.max(0, Math.floor((agingReferenceMs - new Date(kase.createdAt).getTime()) / 86_400_000));
  const lastCheckedTime = isResolved ? caseHistoryTime(kase.resolvedAt) : caseHistoryTime(kase.updatedAt);
  const lastCheckedSuffix = isResolved ? 'closed' : 'still unmatched';

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <CaseHistoryCell label="Opened By" value={runOrDash(obs.firstSeenRunNo)} sub={caseHistoryTime(obs.firstSeenAt)} />
      <CaseHistoryCell
        label="Last Re-Checked"
        value={isResolved ? runOrDash(obs.closedByRunNo) : runOrDash(obs.lastObservedRunNo)}
        sub={lastCheckedTime ? `${lastCheckedTime} · ${lastCheckedSuffix}` : lastCheckedSuffix}
      />
      {isOverdue ? (
        <CaseHistoryCell
          label="Aging"
          value={`Overdue by ${overdueDays} day${overdueDays === 1 ? '' : 's'}`}
          sub={kase.slaDeadline ? `deadline was ${caseHistoryTime(kase.slaDeadline)}` : null}
          tone="red"
        />
      ) : (
        <CaseHistoryCell label="Aging" value={`day ${ageDaysFrozen} of 3-day SLA`} />
      )}
    </div>
  );
};
