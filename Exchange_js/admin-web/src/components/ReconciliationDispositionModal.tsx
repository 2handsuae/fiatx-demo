// admin-web/src/components/ReconciliationDispositionModal.tsx
//
// 处置弹层第一屏（spec §3.2，平账一期半 T8）：选成因（该格菜单，后端下发）→ 出口自动定。
// 机器只出线索不出结论：双胞胎线索仅在 row.duplicateTwinRef 命中时显示；菜单本身
// （文案 + 出口词）也由后端 FlowComparisonRow.menu 下发——前端不镜像成因表，唯一
// 真相在后端 cause-registry.ts。
// 保存定性 = POST /admin/reconciliation/cases/:caseNo/dispositions；ADJUST 类出口
// 把 handoff 交回父组件（父组件复用既有调账弹层，Task 9 补锁定视图）；挂起/留档类
// 出口不落任何分录，就地显示确认屏收尾——文案必须讲清"不落分录"，不能读成"已解决"。
import { useEffect, useState } from 'react';
import { adminButtonClass } from './common/adminButtonStyles';
import { AdminSessionError, adminFetch, getApiErrorMessage } from '../utils/adminFetch';
import { rowFacts, directionNoteFor } from '../utils/causeRegistry';
import type { FlowComparisonRow } from '../pages/ReconciliationCasesDetailPage';

// ADJUST 类出口判完后交回父组件的 handoff——父组件据此打开调账弹层。Task 9 会用
// family/reasonCode/direction/directionNote 补一个锁定视图；本任务只负责把它们
// 从这里原样递出去。
export interface AdjustHandoff {
  dispositionNo: string;
  family: 'CORRECT' | 'REVERSE' | 'RECORD' | 'REATTRIBUTE';
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
  family?: 'CORRECT' | 'REVERSE' | 'RECORD' | 'REATTRIBUTE';
  reasonCode?: string;
  direction?: 'REDUCE' | 'INCREASE';
  deferredTarget?: string;
}

interface ReconciliationDispositionModalProps {
  open: boolean;
  caseNo: string;
  row: FlowComparisonRow | null;
  caseStatus: string;
  onClose: () => void;
  onRecorded: () => void;
  onProceedToAdjust: (handoff: AdjustHandoff) => void;
}

const ReconciliationDispositionModal = ({
  open,
  caseNo,
  row,
  caseStatus,
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
  const menu = row.menu ?? [];

  const submit = async () => {
    if (!causeCode || !findingNote.trim()) {
      setError('成因与查证说明都是必填——查证说明是这次调查的唯一留存物');
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
            <h3 className="mb-1 text-sm font-semibold text-adm-t1">处置 · 这条差异查下来的成因是？</h3>
            <p className="mb-3 font-mono text-[11px] text-adm-t3">
              {caseNo} · {caseStatus} · {row.matchType} · {(row.externalLine ?? row.internalFlow)?.amount} · ref{' '}
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
                    <div className="mt-0.5 text-[11px] text-adm-t3">线索：{m.clue}</div>
                  </span>
                </label>
              ))}
            </div>
            {row.duplicateTwinRef && (
              <div className="mt-3 rounded border border-adm-amber/30 bg-adm-amber/10 p-2 text-[11px] text-adm-t2">
                💡 机器线索：已匹配列表里有一条同参考号同金额的行（{row.duplicateTwinRef}）——银行只报一次、我方入了两次，指向「重复入账」。
              </div>
            )}
            <div className="mt-3">
              <label className="mb-1 block text-[11px] text-adm-t3">查证说明（必填——写清查了什么、依据什么下的结论）</label>
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
                取消
              </button>
              <button
                type="button"
                onClick={() => void submit()}
                disabled={submitting}
                className={adminButtonClass('modalConfirm')}
              >
                {submitting ? '提交中…' : '下一步 →'}
              </button>
            </div>
          </>
        ) : (
          <>
            <h3 className="mb-2 text-sm font-semibold text-adm-t1">已定性 · {result.outletLabel}</h3>
            <p className="text-xs text-adm-t2">
              {result.outlet === 'HOLD_NEXT_PERIOD' && '不落任何分录。案子保持现状，下期对账自然配平后自动销案。'}
              {result.outlet === 'HOLD_INVESTIGATING' && '不落任何分录。案子保持破口，标注「已定性 · 调查中」——查证记录已留档，账龄与核销归下一轮。'}
              {result.outlet === 'DEFERRED' && `不落任何分录。该差异的正确出口（${result.outletLabel.replace('留档·', '')}）本期未开放，结论已留档，案子继续挂。`}
            </p>
            <p className="mt-2 font-mono text-[11px] text-adm-t3">{result.dispositionNo}</p>
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={() => { onRecorded(); onClose(); }}
                className={adminButtonClass('modalConfirm')}
              >
                完成
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default ReconciliationDispositionModal;
