// admin-web/src/components/reconciliation/DispositionFindingModal.tsx
//
// 第六幕波四（Task 4）：从 ReconciliationCasesDetailPage.tsx 剪切粘贴外迁——
// props interface 与上方注释块、函数组件整段。逐字搬运，注释随行；不改
// JSX/className/文案。
import { useEffect, useState } from 'react';
import { adminButtonClass } from '../common/adminButtonStyles';
import { AdminSessionError, adminFetch, getApiErrorMessage } from '../../utils/adminFetch';
import { rowFacts } from '../../utils/causeRegistry';
import { useSimulationMode } from '../../utils/simulationMode';
import type { FlowComparisonRow } from '../../utils/reconTypes';
import type { DispositionRecordResult } from '../ReconciliationHoldModal';

// Task 7（差异行按钮组）：CORRECT/REVERSE/RECORD/REATTRIBUTE/SUPPLEMENT/INCIDENT
// 六个非挂起处置共用的「选成因 + 查证说明」小弹层——取代旧两屏处置弹层
// （ReconciliationDispositionModal，已断线、读 row.menu 这个死字段，Task 13 已删文件）
// 的第一屏，数据源换成 row.dispositions（Task 5 读面）。不导出、不另开文件：
// 与 HOLD_NEXT_PERIOD/HOLD_INVESTIGATING 两个挂起 kind 用的
// ReconciliationHoldModal 结构相近但提交后的下一步完全不同（挂起是终态，这六个
// 都要接力到别处——调账弹层 / 补单弹层 / 事故登记），拆开两个组件比硬塞一个通用
// kind 联合类型更不容易读错。
interface DispositionFindingModalProps {
  open: boolean;
  caseNo: string;
  row: FlowComparisonRow | null;
  kind: string;
  label: string;
  onClose: () => void;
  onRecorded: (result: DispositionRecordResult, findingNote: string) => void;
}

export const DispositionFindingModal = ({ open, caseNo, row, kind, label, onClose, onRecorded }: DispositionFindingModalProps) => {
  const [causeCode, setCauseCode] = useState('');
  const [otherReason, setOtherReason] = useState('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  // ⚡ 演示推荐徽标只在模拟模式下显示——与本页其它 ⚡ 件同一开关。
  const { enabled: simEnabled } = useSimulationMode();

  const causes = row?.dispositions?.find((d) => d.kind === kind)?.causes ?? [];

  useEffect(() => {
    if (!open) return;
    setCauseCode(causes.length === 1 ? causes[0].code : '');
    setOtherReason('');
    setNote('');
    setError('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, row, kind]);

  if (!open || !row) return null;
  const isOther = causeCode === 'OTHER';
  const canSubmit = !!causeCode && note.trim().length > 0 && (!isOther || otherReason.trim().length > 0);

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError('');
    try {
      const findingNote = isOther ? `Other: ${otherReason.trim()}\n${note.trim()}` : note.trim();
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/reconciliation/cases/${encodeURIComponent(caseNo)}/dispositions`,
        {
          method: 'POST',
          body: JSON.stringify({
            matchType: row.matchType,
            explainedFlowId: row.internalFlow?.id,
            explainedExternalLineId: row.externalLine?.id,
            causeCode,
            disposition: kind,
            findingNote,
            ...rowFacts(row),
          }),
        },
      );
      if (!res.ok) {
        throw new Error(await getApiErrorMessage(res, 'Failed to record finding.'));
      }
      const result = (await res.json()) as DispositionRecordResult;
      onRecorded(result, findingNote);
    } catch (e) {
      if (e instanceof AdminSessionError) throw e;
      setError(e instanceof Error ? e.message : 'Failed to record finding.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="w-[520px] max-h-[80vh] overflow-y-auto rounded-lg border border-adm-border bg-adm-panel p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-1 text-sm font-semibold text-adm-t1">{label} · What caused this difference?</h3>
        <p className="mb-3 font-mono text-[11px] text-adm-t3">{caseNo}</p>

        <div className="space-y-1.5">
          {causes.map((c) => (
            <label
              key={c.code}
              className={`flex cursor-pointer items-start gap-2 rounded border p-2 text-xs ${
                causeCode === c.code ? 'border-adm-blue/50 bg-adm-blue/10' : 'border-adm-border'
              }`}
            >
              <input
                type="radio"
                name="finding-cause"
                checked={causeCode === c.code}
                onChange={() => setCauseCode(c.code)}
                className="mt-0.5"
              />
              <span className="flex-1">
                <span className="text-adm-t1">{c.label}</span>
                {simEnabled && row?.demoRecommended?.causeCode === c.code && (
                  <span className="ml-2 rounded border border-adm-amber/30 bg-adm-amber/10 px-1.5 py-0.5 text-[10px] font-medium text-adm-amber">⚡ Recommended</span>
                )}
                <div className="mt-0.5 text-[11px] text-adm-t3">Clue: {c.clue}</div>
              </span>
            </label>
          ))}
        </div>

        {isOther && (
          <div className="mt-3">
            <label className="mb-1 block text-[11px] text-adm-t3">Describe the cause (required for Other)</label>
            <textarea
              value={otherReason}
              onChange={(e) => setOtherReason(e.target.value)}
              rows={2}
              className="w-full rounded border border-adm-border bg-adm-bg p-2 text-xs text-adm-t1"
            />
          </div>
        )}

        <div className="mt-3">
          <label className="mb-1 block text-[11px] text-adm-t3">Finding note (required — describe what was checked and the basis for the conclusion)</label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
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
            disabled={!canSubmit || submitting}
            className={adminButtonClass('modalConfirm')}
          >
            {submitting ? 'Submitting…' : 'Continue'}
          </button>
        </div>
      </div>
    </div>
  );
};
