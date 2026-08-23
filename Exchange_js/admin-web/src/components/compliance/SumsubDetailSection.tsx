import { InfoField } from './DetailPageComponents';

/**
 * Sumsub getTxn 报告里的一条命中规则。充值/提现/兑换三域此前各自声明过一份
 * （`SumsubMatchedRule` / `SwapMatchedRule`），四个字段逐字段同形，故共用。
 */
export interface SumsubMatchedRuleView {
  id?: string;
  name?: string;
  action?: string;
  score?: number;
}

/**
 * 三域（充值/提现/兑换）共用的 Sumsub getTxn 报告只读入参。
 *
 * 各域自己的 DTO（充值/提现的 `SumsubTxnDetail`、兑换的 `SwapSumsubDetail`）
 * 靠结构化子类型直接可赋值进来——不需要改各页面里的 DTO 声明，那些 DTO 还带
 * 域内独有字段（例如兑换的 `tags`/双腿 `txnIdOut`/`txnIdIn`，后者由 References
 * 卡消费），必须留在各自页面。
 */
export interface SumsubDetailView {
  verdict: string | null;
  reviewStatus: string | null;
  reviewAnswer: string | null;
  score: number | null;
  matchedRules: SumsubMatchedRuleView[];
  applicantActionIds: string[];
  raw: unknown;
}

/**
 * 渲染某一笔交易解析后的 Sumsub getTxn 报告。三域共用同一个承载物——合并前
 * 三份本地副本的渲染体逐字节相同（充值/提现）或只差一行 props 类型名（兑换，
 * 第五批 §7 实证）。本组件内部没有任何按域分支。
 */
export const SumsubDetailSection = ({
  detail,
}: {
  detail: SumsubDetailView | null | undefined;
}) => (
  <div>
    {detail ? (
      <div className="space-y-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          <InfoField label="Score" value={detail.score} mono />
          <InfoField label="Verdict" value={detail.verdict} />
          <InfoField label="Review Status" value={detail.reviewStatus} />
          <InfoField label="Review Answer" value={detail.reviewAnswer} />
        </div>
        <div>
          <div className="font-mono text-[9px] uppercase tracking-[0.1em] text-adm-t3">Matched Rules</div>
          {detail.matchedRules.length > 0 ? (
            <ul className="mt-1 space-y-1">
              {detail.matchedRules.map((r, idx) => (
                <li key={r.id ?? idx} className="font-mono text-[11px] text-adm-t1">
                  {r.name ?? '—'} · {r.action ?? '—'} · {r.score ?? '—'}
                </li>
              ))}
            </ul>
          ) : (
            <div className="mt-1 font-mono text-[11px] text-adm-t3">—</div>
          )}
        </div>
        <div>
          <div className="font-mono text-[9px] uppercase tracking-[0.1em] text-adm-t3">Applicant Action IDs</div>
          <div className="mt-1 font-mono text-[11px] text-adm-t1">
            {detail.applicantActionIds.length > 0 ? detail.applicantActionIds.join(', ') : '—'}
          </div>
        </div>
        <details>
          <summary className="cursor-pointer font-mono text-[10px] uppercase tracking-[0.1em] text-adm-t3">
            Raw payload
          </summary>
          <pre className="mt-2 max-h-96 overflow-auto rounded bg-gray-900 p-3 font-mono text-[11px] text-gray-100">
            {JSON.stringify(detail.raw, null, 2)}
          </pre>
        </details>
      </div>
    ) : (
      <p className="font-mono text-[11px] text-adm-t3">No Sumsub transaction detail yet</p>
    )}
  </div>
);
