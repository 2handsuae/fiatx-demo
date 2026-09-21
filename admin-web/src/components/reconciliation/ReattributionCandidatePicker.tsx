// admin-web/src/components/reconciliation/ReattributionCandidatePicker.tsx
//
// T9 改记视图：对端候选选择器——第六幕清残留波四 Task 6 从
// ReconciliationAdjustmentCreateModal 外迁。GET 一次候选列表（url 由父组件读
// 当前行的 adjustmentPrefill 拼好 side/amount，本组件原样 fetch，不重算
// side/amount，避免查候选与开单两处各算一遍出现分歧）。单选后回调 onPick 把
// 选中的候选原样交给父组件——摘要行「From A reattributed to B」用到的
// ownerNo/caseNo/本案侧字段仍在父组件手上，本组件不重算。
import { useEffect, useState } from 'react';
import { AdminSessionError, adminFetch, getApiErrorMessage } from '../../utils/adminFetch';

// 改记对端候选——GET reattribution-candidates 的返回行（disposition.service.ts
// ReattributionCandidate 同形状）。anchorId 是内部证据 id（account_flows.id /
// external_statement_lines.id），只用于选中后拼提交体，不在界面上展示（铁律⑥）。
export interface ReattributionCandidateRow {
  caseNo: string;
  walletNo: string | null;
  ownerNo: string | null;
  anchorId: string;
  externalRef: string | null;
  amount: string;
}

const labelCls = 'mb-1.5 block font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-adm-t3';

interface ReattributionCandidatePickerProps {
  url: string;
  /** 父组件的表单级 submitting 状态——提交中不许再切换候选（与原实现的
   *  radio disabled={submitting} 同一条闸，外迁后改由父组件喂进来）。 */
  disabled: boolean;
  onPick: (c: ReattributionCandidateRow) => void;
}

const ReattributionCandidatePicker = ({ url, disabled, onPick }: ReattributionCandidatePickerProps) => {
  // 用下标而不是 caseNo 当选中键——候选理论上可能同案件多行命中同金额（同一对端
  // 案子里凑巧有两笔孤儿同额），caseNo 不保证唯一，下标总唯一。
  const [candidates, setCandidates] = useState<ReattributionCandidateRow[]>([]);
  const [candidatesLoading, setCandidatesLoading] = useState(false);
  const [candidatesError, setCandidatesError] = useState('');
  const [selectedCandidateIdx, setSelectedCandidateIdx] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    setCandidatesLoading(true);
    setCandidatesError('');
    (async () => {
      try {
        const res = await adminFetch(`${import.meta.env.VITE_API_URL}${url}`);
        if (!res.ok) {
          throw new Error(await getApiErrorMessage(res, 'Failed to load reattribution candidates.'));
        }
        const list = (await res.json()) as ReattributionCandidateRow[];
        if (!cancelled) setCandidates(list);
      } catch (e) {
        if (e instanceof AdminSessionError) return;
        if (!cancelled) setCandidatesError(e instanceof Error ? e.message : 'Failed to load reattribution candidates.');
      } finally {
        if (!cancelled) setCandidatesLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  return (
    <>
      <label className={labelCls}>Counterparty Case (single choice)</label>
      {candidatesLoading ? (
        <p className="font-mono text-[11px] text-adm-t3">Loading candidates…</p>
      ) : candidatesError ? (
        <p className="font-mono text-[11px] text-adm-red">{candidatesError}</p>
      ) : candidates.length === 0 ? (
        <p className="font-mono text-[11px] text-adm-red">
          No same-day, same-amount opposite orphan found — confirm the counterparty case has produced a difference row first
        </p>
      ) : (
        <div className="space-y-1.5">
          {candidates.map((c, idx) => (
            <label
              key={`${c.caseNo}-${idx}`}
              className={`flex cursor-pointer items-start gap-2 rounded border p-2 font-mono text-[11px] ${
                selectedCandidateIdx === idx ? 'border-adm-blue/50 bg-adm-blue/10' : 'border-adm-border'
              }`}
            >
              <input
                type="radio"
                name="reattribution-candidate"
                checked={selectedCandidateIdx === idx}
                onChange={() => { setSelectedCandidateIdx(idx); onPick(c); }}
                disabled={disabled}
                className="mt-0.5"
              />
              <span className="flex-1 text-adm-t1">
                {c.caseNo} · Customer {c.ownerNo ?? '—'} · Wallet {c.walletNo ?? '—'} · ref {c.externalRef ?? '—'}
              </span>
            </label>
          ))}
        </div>
      )}
    </>
  );
};

export default ReattributionCandidatePicker;
