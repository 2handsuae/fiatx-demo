/**
 * L1 闸门回显卡（三域详情页共用）。
 *
 * 业主口径：「这个东西不用筛查，我就是点击后有个代码行能看就行」——
 * 所以后端存的是一个 JSON 字符串,这里只负责把它摊开成人能读的表。
 *
 * ⚠️ 与页面上既有的 `L1 · Eligibility` 格子是**两回事**：那个读的是客户级
 * complianceStatus,本卡读的是这笔单出生时的 L1 判定快照。
 */

interface L1Check {
  code: string;
  outcome: 'PASS' | 'FAIL' | 'NA' | 'SKIPPED';
  detail: string;
}

interface L1Snapshot {
  evaluatedAt: string;
  domain: string;
  verdict: 'PASS' | 'BLOCK' | 'HOLD';
  holdReason: string | null;
  tradingTier: string;
  checks: L1Check[];
}

const OUTCOME_CLASS: Record<string, string> = {
  PASS: 'text-adm-green',
  FAIL: 'text-adm-red',
  NA: 'text-adm-t3',
  SKIPPED: 'text-adm-t3',
};

const VERDICT_CLASS: Record<string, string> = {
  PASS: 'border-adm-green/25 bg-adm-green/10 text-adm-green',
  HOLD: 'border-adm-amber/25 bg-adm-amber/10 text-adm-amber',
  BLOCK: 'border-adm-red/25 bg-adm-red/10 text-adm-red',
};

const L1GateCard = ({ raw }: { raw?: string | null }) => {
  if (!raw) {
    return (
      <div className="rounded-lg border border-adm-border bg-adm-bg p-3">
        <div className="font-mono text-[9px] uppercase tracking-wider text-adm-t3">L1 Gate</div>
        <div className="mt-1 font-mono text-[11px] text-adm-t3">Not evaluated (this order predates the L1 rollout)</div>
      </div>
    );
  }

  let snap: L1Snapshot | null = null;
  try {
    snap = JSON.parse(raw) as L1Snapshot;
  } catch {
    return (
      <div className="rounded-lg border border-adm-border bg-adm-bg p-3">
        <div className="font-mono text-[9px] uppercase tracking-wider text-adm-t3">L1 Gate</div>
        <div className="mt-1 font-mono text-[11px] text-adm-yellow">
          Snapshot unparseable: <span className="text-adm-t3">{raw.slice(0, 80)}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-adm-border bg-adm-bg p-3">
      <div className="flex items-center justify-between">
        <div className="font-mono text-[9px] uppercase tracking-wider text-adm-t3">L1 Gate</div>
        <span
          className={`rounded border px-1.5 py-px font-mono text-[9px] uppercase tracking-wider ${
            VERDICT_CLASS[snap.verdict] ?? VERDICT_CLASS.BLOCK
          }`}
        >
          {snap.verdict}
        </span>
      </div>

      <div className="mt-1 font-mono text-[10px] text-adm-t3">
        Tier {snap.tradingTier}
        {snap.holdReason ? ` · Hold reason ${snap.holdReason}` : ''}
        {snap.evaluatedAt ? ` · ${new Date(snap.evaluatedAt).toLocaleString()}` : ''}
      </div>

      {/* checks 必须防御：这一列是裸 String? 不是 Prisma Json,没有 schema 校验。
          一条结构合法但缺 checks 的行会让 undefined.map() 抛在渲染期,而本页没有
          Error Boundary —— 炸的不是这张卡,是整页白屏(资金流水/Sumsub/状态历史
          全看不见,运营还无从判断是哪笔单的问题)。审查在隔离库实测复现过。 */}
      <div className="mt-2 space-y-1">
        {(Array.isArray(snap.checks) ? snap.checks : []).map((c) => (
          <div key={c.code} className="flex items-start gap-2">
            <span className={`w-[124px] shrink-0 font-mono text-[10px] ${OUTCOME_CLASS[c.outcome] ?? 'text-adm-t3'}`}>
              {c.code}
            </span>
            <span className={`w-9 shrink-0 font-mono text-[10px] ${OUTCOME_CLASS[c.outcome] ?? 'text-adm-t3'}`}>
              {c.outcome}
            </span>
            <span className="min-w-0 flex-1 font-mono text-[10px] text-adm-t2">{c.detail}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default L1GateCard;
