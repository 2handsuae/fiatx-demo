// admin-web/src/components/ReconciliationDispositionModal.tsx
//
// ⚠ 已断线（Task 7，平账处置改版）：案件详情页不再挂载本组件，入口（旧的
// 「Record finding」按钮）已被差异行按钮组 + 挂起两弹窗取代
// （admin-web/src/pages/ReconciliationCasesDetailPage.tsx 的
// DispositionFindingModal / ReconciliationHoldModal）。本文件保留但不再是唯一
// 真相——它读的 FlowComparisonRow.menu 字段后端早已停发（Task 5 读面翻转），下面
// `row.menu` 现在恒为 undefined。按 Task 7 brief「本任务只断线不删文件」不删除，
// Task 13 才物理删除；这里只做了保持 tsc 通过的最小改动（menu 硬编码空数组），
// 不恢复功能。
//
// 处置弹层第一屏（spec §3.2，平账一期半 T8，历史设计）：选成因（该格菜单，后端
// 下发）→ 出口自动定。机器只出线索不出结论：双胞胎线索仅在 row.duplicateTwinRef
// 命中时显示。
// 保存定性 = POST /admin/reconciliation/cases/:caseNo/dispositions；ADJUST 类出口
// 把 handoff 交回父组件（父组件复用既有调账弹层，Task 9 补锁定视图）；挂起/留档类
// 出口不落任何分录，就地显示确认屏收尾——文案必须讲清"不落分录"，不能读成"已解决"。
import { useEffect, useState } from 'react';
import { adminButtonClass } from './common/adminButtonStyles';
import { AdminSessionError, adminFetch, getApiErrorMessage } from '../utils/adminFetch';
import { rowFacts, directionNoteFor } from '../utils/causeRegistry';
import { MATCH_LABEL, formatAmount, type FlowComparisonRow } from '../pages/ReconciliationCasesDetailPage';

// ADJUST 类出口判完后交回父组件的 handoff——父组件据此打开调账弹层。Task 9 会用
// family/reasonCode/direction/directionNote 补一个锁定视图；本任务只负责把它们
// 从这里原样递出去。
export interface AdjustHandoff {
  dispositionNo: string;
  family: 'CORRECT' | 'REVERSE' | 'RECORD' | 'REATTRIBUTE' | 'WRITE_OFF';
  reasonCode?: string;
  direction?: 'REDUCE' | 'INCREASE';
  directionNote: string;
  row: FlowComparisonRow;
}

// POST /dispositions 的返回形状——与后端 ResolvedOutlet + dispositionNo 同形
// （disposition.service.ts 的 record() 返回 { dispositionNo, ...resolved }）。
interface DispositionResult {
  dispositionNo: string;
  outlet: string;
  outletLabel: string;
  family?: 'CORRECT' | 'REVERSE' | 'RECORD' | 'REATTRIBUTE' | 'WRITE_OFF';
  reasonCode?: string;
  direction?: 'REDUCE' | 'INCREASE';
  deferredTarget?: string;
}

interface ReconciliationDispositionModalProps {
  open: boolean;
  caseNo: string;
  row: FlowComparisonRow | null;
  caseStatus: string;
  decimals: number;
  onClose: () => void;
  onRecorded: () => void;
  onProceedToAdjust: (handoff: AdjustHandoff) => void;
}

const ReconciliationDispositionModal = ({
  open,
  caseNo,
  row,
  caseStatus,
  decimals,
  onClose,
  onRecorded,
  onProceedToAdjust,
}: ReconciliationDispositionModalProps) => {
  const [causeCode, setCauseCode] = useState('');
  const [findingNote, setFindingNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<DispositionResult | null>(null);

  useEffect(() => {
    if (open) { setCauseCode(''); setFindingNote(''); setError(''); setResult(null); }
  }, [open, row]);

  if (!open || !row) return null;
  // 断线说明见文件头——FlowComparisonRow.menu 已停发，本组件不再被挂载，这里
  // 硬编码空数组只是保持 tsc 通过，不是恢复功能。
  const menu: Array<{ code: string; label: string; clue: string; outletLabel: string }> = [];

  const submit = async () => {
    if (!causeCode || !findingNote.trim()) {
      setError('Cause and finding note are both required — the finding note is the only record kept of this investigation');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/reconciliation/cases/${encodeURIComponent(caseNo)}/dispositions`,
        {
          method: 'POST',
          body: JSON.stringify({
            matchType: row.matchType,
            explainedFlowId: row.internalFlow?.id,
            explainedExternalLineId: row.externalLine?.id,
            causeCode,
            findingNote: findingNote.trim(),
            ...rowFacts(row),
          }),
        },
      );
      if (!res.ok) {
        throw new Error(await getApiErrorMessage(res, 'Failed to record disposition.'));
      }
      const r = (await res.json()) as DispositionResult;
      if (r.outlet.startsWith('ADJUST')) {
        onProceedToAdjust({
          dispositionNo: r.dispositionNo,
          family: r.family!, // ADJUST_* 出口的 family 由后端 resolveOutlet 保证必有
          reasonCode: r.reasonCode,
          direction: r.direction,
          directionNote: directionNoteFor(row.matchType),
          row,
        });
      } else {
        setResult(r); // 挂起/留档：显示确认屏（不落任何分录）
      }
    } catch (e) {
      if (e instanceof AdminSessionError) throw e;
      setError(e instanceof Error ? e.message : 'Failed to record disposition.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="w-[560px] max-h-[80vh] overflow-y-auto rounded-lg border border-adm-border bg-adm-panel p-5"
        onClick={(e) => e.stopPropagation()}
      >
        {!result ? (
          <>
            <h3 className="mb-1 text-sm font-semibold text-adm-t1">Record finding · What caused this difference?</h3>
            <p className="mb-3 font-mono text-[11px] text-adm-t3">
              {caseNo} · {caseStatus} · {MATCH_LABEL[row.matchType]} ·{' '}
              {formatAmount((row.externalLine ?? row.internalFlow)?.amount, decimals)} · ref{' '}
              {(row.externalLine?.externalRef ?? row.internalFlow?.externalRef) ?? '—'}
            </p>
            <div className="space-y-1.5">
              {menu.map((m) => (
                <label
                  key={m.code}
                  className={`flex cursor-pointer items-start gap-2 rounded border p-2 text-xs ${
                    causeCode === m.code ? 'border-adm-blue/50 bg-adm-blue/10' : 'border-adm-border'
                  }`}
                >
                  <input
                    type="radio"
                    name="cause"
                    checked={causeCode === m.code}
                    onChange={() => setCauseCode(m.code)}
                    className="mt-0.5"
                  />
                  <span className="flex-1">
                    <span className="text-adm-t1">{m.label}</span>
                    <span className="ml-2 text-adm-t3">→ {m.outletLabel}</span>
                    <div className="mt-0.5 text-[11px] text-adm-t3">Clue: {m.clue}</div>
                  </span>
                </label>
              ))}
            </div>
            {row.duplicateTwinRef && (
              <div className="mt-3 rounded border border-adm-amber/30 bg-adm-amber/10 p-2 text-[11px] text-adm-t2">
                💡 System clue: the matched list has a line with the same reference number and amount ({row.duplicateTwinRef}) — the bank reported it once but we booked it twice, pointing to "Duplicate posting".
              </div>
            )}
            <div className="mt-3">
              <label className="mb-1 block text-[11px] text-adm-t3">Finding note (required — describe what was checked and the basis for the conclusion)</label>
              <textarea
                value={findingNote}
                onChange={(e) => setFindingNote(e.target.value)}
                rows={3}
                className="w-full rounded border border-adm-border bg-adm-bg p-2 text-xs text-adm-t1"
              />
            </div>
            {error && <p className="mt-2 text-xs text-adm-red">{error}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={onClose} className={adminButtonClass('modalCancel')}>
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void submit()}
                disabled={submitting}
                className={adminButtonClass('modalConfirm')}
              >
                {submitting ? 'Submitting…' : 'Next →'}
              </button>
            </div>
          </>
        ) : (
          <>
            <h3 className="mb-2 text-sm font-semibold text-adm-t1">Finding recorded · {result.outletLabel}</h3>
            <p className="text-xs text-adm-t2">
              {result.outlet === 'HOLD_NEXT_PERIOD' && 'No entry is posted. The case stays as-is; it self-resolves and auto-closes once next period’s reconciliation balances.'}
              {result.outlet === 'HOLD_INVESTIGATING' && 'No entry is posted. The case stays open, marked "Finding recorded · Investigating" — the finding note is on file. Once the aging threshold (3 days) is reached: small firm-pool amounts can be written off; small client-pool shortfalls can be recognized as a loss (the treasury then initiates compensation), surpluses go through Record missed deposit; large amounts go through Register incident.'}
              {result.outlet === 'DEFERRED' && `No entry is posted. The correct outlet for this difference (${result.outletLabel.replace('File only · ', '')}) is not yet available this period — the finding is on file and the case stays open.`}
              {result.outlet === 'SUPPLEMENT' && `No entry is posted. This difference needs a supplement filed in the originating business domain (${result.outletLabel.replace('Supplement · ', '')}): click "Complete", then start it next to the finding row — once CFO review approves it, the business domain executes it; come back and re-reconcile.`}
              {result.outlet === 'INCIDENT' && 'No entry is posted. This is a large unauthorized outflow — escalate straight to an incident: click "Complete", then "Register incident" next to the finding row and run the full investigation / loss assessment / remediation / regulatory notification flow; the treasury only compensates once the loss is recognized.'}
            </p>
            <p className="mt-2 font-mono text-[11px] text-adm-t3">{result.dispositionNo}</p>
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={() => { onRecorded(); onClose(); }}
                className={adminButtonClass('modalConfirm')}
              >
                Complete
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default ReconciliationDispositionModal;
