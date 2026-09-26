// admin-web/src/components/SanctionDispositionModal.tsx
// 战役甲波三 T9（对应 T4 后端 SanctionDispositionWorkflowService）：制裁定性裁决提单
// 弹窗——合规官对一张 OPEN 的 SANCTION 便签选定 CLEARED/PARTIAL/CONFIRMED 三出口之一，
// 走 MLRO 单步审批正门（铁律②门不可绕，本弹窗只提单，不落地）。
// 出口三选一各配一句后果说明（spec §2/§4）：
//   CLEARED   — 排除：即时联动解除，客户全程无感（同一次 maker/checker，不叠第二道审批）。
//   PARTIAL   — 部分：维持 SILENT，自动开 PNMR（5 工作日钟）+ 中性补料请求；可再次定性。
//   CONFIRMED — 确认：SILENT 便签解列，开 DISCLOSED 的 SANCTION_CONFIRMED 便签（横幅可见）
//               + 自动开 CNMR（5 工作日钟）。
// 模板：RestrictionReleaseModal.tsx 的弹窗骨架（echo 行 + reason + 提交即开审批案语义）。
import { useEffect, useState, type ReactNode } from 'react';
import { adminButtonClass } from './common/adminButtonStyles';
import { AdminSessionError, adminFetch, getApiErrorMessage } from '../utils/adminFetch';

export type SanctionDispositionOutcome = 'CLEARED' | 'PARTIAL' | 'CONFIRMED';

interface SanctionDispositionModalProps {
  open: boolean;
  customerNo: string;
  customerLabel: string;
  restrictionNo: string | null;
  onClose: () => void;
  onSubmitted: (approvalNo: string, outcome: SanctionDispositionOutcome) => Promise<void> | void;
}

const OUTCOMES: readonly { value: SanctionDispositionOutcome; label: string; consequence: string }[] = [
  { value: 'CLEARED', label: 'Cleared — false positive', consequence: 'Restriction is released the moment MLRO approves — no second unfreeze approval, customer never sees anything.' },
  { value: 'PARTIAL', label: 'Partial match — needs more evidence', consequence: 'Stays SILENT; opens a PNMR filing (5 business days) and issues a neutral supplementary-ID request. Can be re-disposed later.' },
  { value: 'CONFIRMED', label: 'Confirmed match', consequence: 'SILENT restriction is replaced with a disclosed one (customer sees a banner); opens a CNMR filing (5 business days).' },
];

const EchoRow = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="flex items-start justify-between gap-3 border-b border-adm-border py-2 last:border-b-0">
    <span className="shrink-0 font-mono text-[9px] uppercase tracking-[0.14em] text-adm-t3">{label}</span>
    <span className="min-w-0 break-all text-right font-mono text-[10px] text-adm-t2">{children}</span>
  </div>
);

const SanctionDispositionModal = ({
  open,
  customerNo,
  customerLabel,
  restrictionNo,
  onClose,
  onSubmitted,
}: SanctionDispositionModalProps) => {
  const [outcome, setOutcome] = useState<SanctionDispositionOutcome>('CLEARED');
  const [summary, setSummary] = useState('');
  const [externalCaseRef, setExternalCaseRef] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setOutcome('CLEARED');
    setSummary('');
    setExternalCaseRef('');
    setError('');
  }, [open]);

  if (!open) return null;

  const picked = OUTCOMES.find((o) => o.value === outcome)!;
  const submitDisabled = submitting || !summary.trim() || !externalCaseRef.trim();

  const submit = async () => {
    if (submitDisabled) return;
    setSubmitting(true);
    setError('');
    try {
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/customers/${customerNo}/sanction-disposition`,
        {
          method: 'POST',
          body: JSON.stringify({ outcome, summary: summary.trim(), externalCaseRef: externalCaseRef.trim() }),
        },
      );
      if (!res.ok) {
        throw new Error(await getApiErrorMessage(res, 'Failed to submit sanction disposition.'));
      }
      const data = (await res.json()) as { approvalNo: string; restrictionNo: string };
      await onSubmitted(data.approvalNo, outcome);
      onClose();
    } catch (e) {
      if (e instanceof AdminSessionError) return;
      setError(e instanceof Error ? e.message : 'Failed to submit sanction disposition.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-xl border border-adm-border bg-adm-panel shadow-xl">
        <div className="border-b border-adm-border px-6 py-4">
          <h2 className="text-base font-semibold text-adm-t1">Sanction Disposition</h2>
          <p className="mt-1 font-mono text-[10px] text-adm-t3">
            {customerLabel} · {customerNo} — opens a single MLRO approval step. Nothing lands until MLRO decides.
          </p>
        </div>

        <div className="max-h-[70vh] overflow-y-auto px-6 py-4">
          {error && (
            <div className="mb-3 rounded border border-adm-red/30 bg-adm-red/10 px-3 py-2 font-mono text-[10px] text-adm-red">
              {error}
            </div>
          )}

          {restrictionNo && (
            <div className="mb-4 rounded border border-adm-border bg-adm-bg px-3 py-1">
              <EchoRow label="Restriction No">
                <span className="font-semibold text-adm-amber">{restrictionNo}</span>
              </EchoRow>
            </div>
          )}

          <label className="mb-1.5 block font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-adm-t3">
            Outcome
          </label>
          <div className="mb-2 flex flex-col gap-2">
            {OUTCOMES.map((o) => (
              <label
                key={o.value}
                className={`flex cursor-pointer items-start gap-2 rounded border px-3 py-2 transition-colors ${
                  outcome === o.value ? 'border-adm-amber bg-adm-amber/10' : 'border-adm-border'
                }`}
              >
                <input
                  type="radio"
                  name="sanction-disposition-outcome"
                  checked={outcome === o.value}
                  onChange={() => setOutcome(o.value)}
                  disabled={submitting}
                  className="mt-0.5 accent-current"
                />
                <span className="min-w-0">
                  <span className="block font-mono text-[11px] font-semibold text-adm-t1">{o.label}</span>
                  <span className="block font-mono text-[9px] leading-relaxed text-adm-t3">{o.consequence}</span>
                </span>
              </label>
            ))}
          </div>
          <p className="mb-4 font-mono text-[9px] text-adm-amber">{picked.consequence}</p>

          <label className="mb-1.5 block font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-adm-t3">
            Summary
          </label>
          <textarea
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            placeholder="e.g. Full name + DOB checked against EOCN list entry — no match on national ID"
            disabled={submitting}
            className="mb-4 h-20 w-full resize-none rounded border border-adm-border bg-adm-bg px-2.5 py-2 text-xs text-adm-t1 outline-none transition-colors placeholder:text-adm-t3 focus:border-adm-amber"
          />

          <label className="mb-1.5 block font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-adm-t3">
            External Case Reference
          </label>
          <input
            value={externalCaseRef}
            onChange={(e) => setExternalCaseRef(e.target.value)}
            placeholder="EOCN list entry ref used for this disposition"
            disabled={submitting}
            className="w-full rounded border border-adm-border bg-adm-bg px-2.5 py-2 font-mono text-[11px] text-adm-t1 outline-none transition-colors placeholder:text-adm-t3 focus:border-adm-amber"
          />
          <p className="mt-1.5 font-mono text-[9px] text-adm-t3">
            PARTIAL/CONFIRMED carry this reference onto the PNMR/CNMR filing that gets opened automatically.
          </p>
        </div>

        <div className="flex justify-end gap-3 border-t border-adm-border px-6 py-4">
          <button onClick={onClose} disabled={submitting} className={adminButtonClass('modalCancel')}>
            Cancel
          </button>
          <button onClick={() => void submit()} disabled={submitDisabled} className={adminButtonClass('workflowNegative')}>
            {submitting ? 'Submitting…' : 'Submit for MLRO Approval'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default SanctionDispositionModal;
