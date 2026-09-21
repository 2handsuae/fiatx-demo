// admin-web/src/components/InternalTransferInitiateModal.tsx
// 平账二期（spec §8）：补款 / 垫款一个弹层。全部字段预填只读（金额不可改——多一分都是往客户钱包塞钱），
// 只填理由；提交打划转端点，返回单号 + 审批单号。externalLineId 只作隐藏锚，不上页面。
import { useState } from 'react';
import { adminFetch, AdminSessionError, getApiErrorMessage } from '../utils/adminFetch';
import { adminButtonClass } from './common/adminButtonStyles';
import { formatAmount } from '../utils/reconAmount';
import type { FlowComparisonRow } from '../utils/reconTypes';

interface Props { open: boolean; caseNo: string; row: FlowComparisonRow | null; assetCode: string; decimals: number; onClose: () => void; onDone: () => void }

const InternalTransferInitiateModal = ({ open, caseNo, row, assetCode, decimals, onClose, onDone }: Props) => {
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ transferNo: string; approvalNo: string } | null>(null);
  if (!open || !row?.nextStep) return null;
  const ns = row.nextStep;
  const isAdvance = ns.kind === 'ADVANCE';

  const submit = async () => {
    setSubmitting(true); setError('');
    try {
      const path = isAdvance ? '/admin/internal-transfers/advance' : '/admin/internal-transfers/compensation';
      const body = isAdvance
        ? { caseNo, externalLineId: ns.externalLineId, reason: reason.trim() }
        : { adjustmentNo: ns.adjustmentNo, reason: reason.trim() };
      const res = await adminFetch(`${import.meta.env.VITE_API_URL}${path}`, { method: 'POST', body: JSON.stringify(body) });
      if (!res.ok) { setError(await getApiErrorMessage(res, 'Failed to initiate')); return; }
      setResult(await res.json());
    } catch (e) { if (e instanceof AdminSessionError) throw e; setError(e instanceof Error ? e.message : 'Failed to initiate'); }
    finally { setSubmitting(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="w-[560px] rounded-lg border border-adm-border bg-adm-panel p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-3 text-sm font-semibold text-adm-t1">{isAdvance ? 'Initiate advance · The firm fronts the recall shortfall' : 'Initiate compensation · Firm compensates the customer after loss recognition'}</h3>
        <dl className="mb-4 grid grid-cols-2 gap-x-4 gap-y-1 rounded border border-adm-border bg-adm-hover/40 p-3 text-xs">
          <dt className="text-adm-t3">Customer / Wallet</dt><dd className="font-mono">{ns.customerNo ?? '—'} · {ns.walletNo ?? '—'}</dd>
          <dt className="text-adm-t3">Amount (locked, not editable)</dt><dd className="font-mono">{formatAmount(ns.amount, decimals)} {assetCode}</dd>
          {isAdvance ? (
            <><dt className="text-adm-t3">Recalled / Customer available</dt><dd className="font-mono">{formatAmount(ns.lineAmount, decimals)} / {formatAmount(ns.available, decimals)}</dd></>
          ) : (
            <><dt className="text-adm-t3">Source loss recognition no.</dt><dd className="font-mono">{ns.adjustmentNo}</dd></>
          )}
          <dt className="text-adm-t3">Reconciliation case</dt><dd className="font-mono">{caseNo}</dd>
          <dt className="text-adm-t3">Route</dt><dd>{assetCode === 'AED' ? 'Operating account → Settlement account → Customer vIBAN (2 fiat legs)' : 'Operating account → Customer address (1 leg)'}</dd>
        </dl>
        {result ? (
          <>
            <p className="text-xs text-adm-t2">Initiated, awaiting CFO review. Transfer <span className="font-mono">{result.transferNo}</span>, approval <span className="font-mono">{result.approvalNo}</span>. Once approved, push the leg on the funds order page — then return to the case and click "Re-reconcile" to see it in transit and self-resolve.</p>
            <div className="mt-4 flex justify-end"><button type="button" onClick={onDone} className={adminButtonClass('modalConfirm')}>Complete</button></div>
          </>
        ) : (
          <>
            <label className="mb-3 block text-xs">Reason
              <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} className="mt-1 w-full rounded border border-adm-border bg-adm-panel px-2 py-1 text-xs"
                placeholder={isAdvance ? 'e.g.: Bank recalled 6,500, customer already spent part of it — front the funds now, recover later; the advance is logged for recovery' : 'e.g.: Custody shortfall cannot be traced — the firm recognizes the loss and compensates in full'} />
            </label>
            {error && <p className="mb-2 text-xs text-adm-red">{error}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={onClose} className={adminButtonClass('modalCancel')}>Cancel</button>
              <button type="button" disabled={submitting || !reason.trim()} onClick={() => void submit()} className={adminButtonClass('modalConfirm')}>{submitting ? 'Submitting…' : 'Submit to CFO'}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default InternalTransferInitiateModal;
