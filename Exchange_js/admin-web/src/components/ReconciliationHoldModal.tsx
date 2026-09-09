// admin-web/src/components/ReconciliationHoldModal.tsx
//
// 平账处置改版（Task 7，样机 M8/M9）：挂起两弹窗，一个组件按 kind 切——
// Hold · Next period（等下期，零账务，下期自愈）/ Hold · Investigating（调查中，
// 零账务，启动 3 天账龄倒计时）。数据来源唯一真相在后端：causes 从
// row.dispositions 里按 kind 取该格当下合法的成因清单（Task 5 读面），不前端镜像。
// 提交 = POST /admin/reconciliation/cases/:caseNo/dispositions（Task 3 契约，
// disposition 字段必填=本挂起的 kind）；挂起类出口不落任何分录。
import { useEffect, useState } from 'react';
import { adminButtonClass } from './common/adminButtonStyles';
import { AdminSessionError, adminFetch, getApiErrorMessage } from '../utils/adminFetch';
import { rowFacts } from '../utils/causeRegistry';
import { useSimulationMode } from '../utils/simulationMode';
import type { FlowComparisonRow } from '../pages/ReconciliationCasesDetailPage';

export type HoldKind = 'HOLD_NEXT_PERIOD' | 'HOLD_INVESTIGATING';

// POST /dispositions 的实际返回形状（disposition.service.ts record()）——没有
// family/reasonCode/direction：那三个字段现在只在「开调账单」那一步才定下来
// （见 reconciliation-query.service.ts 读面注释），写端不再现算。
export interface DispositionRecordResult {
  dispositionNo: string;
  outlet: string;
  outletLabel: string;
  deferredTarget?: string | null;
}

interface ReconciliationHoldModalProps {
  open: boolean;
  caseNo: string;
  row: FlowComparisonRow | null;
  kind: HoldKind;
  onClose: () => void;
  onDone: (result: DispositionRecordResult) => void;
}

const HOLD_TITLE: Record<HoldKind, string> = {
  HOLD_NEXT_PERIOD: 'Hold · Next period',
  HOLD_INVESTIGATING: 'Hold · Investigating',
};

// 样机 M8/M9 逐字静态提示行——零账务的后果说清楚，不能让人读成「已解决」。
const HOLD_HINT: Record<HoldKind, string> = {
  HOLD_NEXT_PERIOD: 'Zero accounting. The case stays red; next period’s statement heals it.',
  HOLD_INVESTIGATING: 'Zero accounting. Starts the 3-day aging clock.',
};

const ReconciliationHoldModal = ({ open, caseNo, row, kind, onClose, onDone }: ReconciliationHoldModalProps) => {
  const [causeCode, setCauseCode] = useState('');
  const [otherReason, setOtherReason] = useState('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  // ⚡ 演示推荐徽标只在模拟模式下显示——与案件页其它 ⚡ 件同一开关。
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
        throw new Error(await getApiErrorMessage(res, 'Failed to record hold.'));
      }
      const result = (await res.json()) as DispositionRecordResult;
      onDone(result);
    } catch (e) {
      if (e instanceof AdminSessionError) throw e;
      setError(e instanceof Error ? e.message : 'Failed to record hold.');
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
        <h3 className="mb-1 text-sm font-semibold text-adm-t1">{HOLD_TITLE[kind]}</h3>
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
                name="hold-cause"
                checked={causeCode === c.code}
                onChange={() => setCauseCode(c.code)}
                className="mt-0.5"
              />
              <span className="flex-1">
                <span className="text-adm-t1">{c.label}</span>
                {simEnabled && row.demoRecommended?.causeCode === c.code && (
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
          <label className="mb-1 block text-[11px] text-adm-t3">Investigation note (required)</label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            className="w-full rounded border border-adm-border bg-adm-bg p-2 text-xs text-adm-t1"
          />
        </div>

        <p className="mt-3 rounded border border-adm-amber/30 bg-adm-amber/10 p-2 text-[11px] text-adm-t2">
          {HOLD_HINT[kind]}
        </p>

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
            {submitting ? 'Recording…' : 'Record hold'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ReconciliationHoldModal;
