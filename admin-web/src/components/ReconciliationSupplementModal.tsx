// admin-web/src/components/ReconciliationSupplementModal.tsx
// 平账 B 批（spec §2.2 / §7）：三路补单一个组件。证据区只读（金额 / 币种 / 时间 / 参考号 / 银行描述），
// 下半按定性去向切：① 链上填来源地址、法币填来源 IBAN；②③ 候选原单单选；都要原因。
// 提交打业务域端点；对账域只给候选。UUID 不出现在页面（externalLineId 只是隐藏锚）。
import { useEffect, useState } from 'react';
import { adminFetch, AdminSessionError, getApiErrorMessage } from '../utils/adminFetch';
import { adminButtonClass } from './common/adminButtonStyles';

type Kind = 'SUPPLEMENT_DEPOSIT' | 'SUPPLEMENT_BOUNCE' | 'SUPPLEMENT_PAYOUT_RETURN';
// 与后端 SupplementCandidatesView 逐字段对齐（对外投影，不含 caseId/walletId/ownerId/assetId/
// amountMinor/walletAddress/walletIban 等内部 id——supplement-evidence.service.ts 铁律⑥）。
interface LineFacts { externalLineId: string; caseNo: string; businessDate: string; dispositionNo: string | null; walletNo: string | null; ownerNo: string | null;
  currency: string; assetType: 'CRYPTO' | 'FIAT'; decimals: number; direction: 'IN' | 'OUT'; amountMajor: string; externalRef: string | null; channelRef: string | null; datetime: string; description: string | null; source: string }
// 与后端 SupplementCandidate 逐字段对齐——没有 id（铁律⑥：对外只用业务单号 orderNo）。
interface Candidate { orderNo: string; amountMajor: string; createdAt: string; status: string }
interface Props { open: boolean; caseNo: string; row: any | null; onClose: () => void; onDone: () => void }

const TITLE: Record<Kind, string> = { SUPPLEMENT_DEPOSIT: 'Record missed deposit · Missed customer deposit', SUPPLEMENT_BOUNCE: 'Claim recall · Deposit recalled by bank', SUPPLEMENT_PAYOUT_RETURN: 'Claim return · Payout returned by bank' };
const ENDPOINT = (kind: Kind, orderNo: string) => kind === 'SUPPLEMENT_DEPOSIT' ? '/deposit-transactions/supplement'
  : kind === 'SUPPLEMENT_BOUNCE' ? `/deposit-transactions/${encodeURIComponent(orderNo)}/clawback` : `/withdraw-transactions/${encodeURIComponent(orderNo)}/return-claim`;

const ReconciliationSupplementModal = ({ open, caseNo, row, onClose, onDone }: Props) => {
  const [facts, setFacts] = useState<LineFacts | null>(null);
  const [kind, setKind] = useState<Kind | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [orderNo, setOrderNo] = useState('');
  const [fromAddress, setFromAddress] = useState(''); const [fromIban, setFromIban] = useState(''); const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false); const [error, setError] = useState(''); const [result, setResult] = useState<{ approvalNo: string; no: string } | null>(null);

  useEffect(() => {
    if (!open || !row?.externalLine?.id) return;
    setFacts(null); setResult(null); setError(''); setOrderNo(''); setFromAddress(''); setFromIban(''); setReason('');
    (async () => {
      try {
        const res = await adminFetch(`${import.meta.env.VITE_API_URL}/admin/reconciliation/cases/${encodeURIComponent(caseNo)}/supplement-candidates?externalLineId=${encodeURIComponent(row.externalLine.id)}`);
        if (!res.ok) { setError(await getApiErrorMessage(res, 'Failed to read the statement line')); return; }
        const data = await res.json();
        setFacts(data.line); setKind(data.kind); setCandidates(data.candidates ?? []);
        if (data.candidates?.length === 1) setOrderNo(data.candidates[0].orderNo);
      } catch (e) { if (e instanceof AdminSessionError) throw e; setError(e instanceof Error ? e.message : 'Failed to read the statement line'); }
    })();
  }, [open, caseNo, row]);

  if (!open || !row) return null;
  const dispositionNo: string | undefined = row.disposition?.dispositionNo;
  const needAddr = kind === 'SUPPLEMENT_DEPOSIT' && facts?.assetType === 'CRYPTO';
  const needIban = kind === 'SUPPLEMENT_DEPOSIT' && facts?.assetType === 'FIAT';
  const needOrder = kind === 'SUPPLEMENT_BOUNCE' || kind === 'SUPPLEMENT_PAYOUT_RETURN';
  const canSubmit = !!facts && !!kind && !!dispositionNo && reason.trim().length > 0 && (!needAddr || fromAddress.trim()) && (!needIban || fromIban.trim()) && (!needOrder || orderNo);

  const submit = async () => {
    if (!canSubmit || !facts || !kind) return;
    setSubmitting(true); setError('');
    try {
      const body: Record<string, unknown> = { externalLineId: facts.externalLineId, caseNo, dispositionNo, reason: reason.trim() };
      if (needAddr) body.fromAddress = fromAddress.trim(); if (needIban) body.fromIban = fromIban.trim();
      const res = await adminFetch(`${import.meta.env.VITE_API_URL}${ENDPOINT(kind, orderNo)}`, { method: 'POST', body: JSON.stringify(body) });
      if (!res.ok) { setError(await getApiErrorMessage(res, 'Failed to initiate')); return; }
      const r = await res.json();
      setResult({ approvalNo: r.approvalNo, no: r.signalNo ?? r.depositNo ?? r.withdrawNo });
    } catch (e) { if (e instanceof AdminSessionError) throw e; setError(e instanceof Error ? e.message : 'Failed to initiate'); }
    finally { setSubmitting(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="w-[600px] max-h-[85vh] overflow-y-auto rounded-lg border border-adm-border bg-adm-panel p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-3 text-sm font-semibold text-adm-t1">{kind ? TITLE[kind] : 'Supplement'}</h3>
        {facts && (
          <dl className="mb-4 grid grid-cols-2 gap-x-4 gap-y-1 rounded border border-adm-border bg-adm-hover/40 p-3 text-xs">
            <dt className="text-adm-t3">Source</dt><dd className="font-mono">{facts.source}</dd>
            <dt className="text-adm-t3">Direction / Amount</dt><dd className="font-mono">{facts.direction} {facts.amountMajor} {facts.currency}</dd>
            <dt className="text-adm-t3">Posted at</dt><dd className="font-mono">{facts.datetime.replace('T', ' ').slice(0, 19)}</dd>
            <dt className="text-adm-t3">Reference</dt><dd className="font-mono">{facts.externalRef ?? '—'}</dd>
            <dt className="text-adm-t3">Bank description</dt><dd>{facts.description ?? '—'}</dd>
            <dt className="text-adm-t3">Wallet / Customer</dt><dd className="font-mono">{facts.walletNo ?? '—'} · {facts.ownerNo ?? '—'}</dd>
            <dt className="text-adm-t3">Effective date (case business date)</dt><dd className="font-mono">{facts.businessDate}</dd>
          </dl>
        )}
        {result ? (
          <>
            <p className="text-xs text-adm-t2">Initiated, awaiting CFO review. Approval <span className="font-mono">{result.approvalNo}</span>, supplement no. <span className="font-mono">{result.no}</span>. Once approved, the business domain executes it — go back to the case and click "Re-reconcile" to see it self-resolve.</p>
            <div className="mt-4 flex justify-end"><button type="button" onClick={onDone} className={adminButtonClass('modalConfirm')}>Complete</button></div>
          </>
        ) : (
          <>
            {needAddr && <label className="mb-3 block text-xs">Source address<input value={fromAddress} onChange={(e) => setFromAddress(e.target.value)} className="mt-1 w-full rounded border border-adm-border bg-adm-panel px-2 py-1 font-mono text-xs" placeholder="On-chain payer address" /></label>}
            {needIban && <label className="mb-3 block text-xs">Source IBAN<input value={fromIban} onChange={(e) => setFromIban(e.target.value)} className="mt-1 w-full rounded border border-adm-border bg-adm-panel px-2 py-1 font-mono text-xs" placeholder="Payer IBAN" /></label>}
            {kind === 'SUPPLEMENT_DEPOSIT' && <p className="mb-3 text-xs text-adm-t3">Amounts below this asset's single-deposit minimum will pause at OPERATION_PENDING after approval — release it on the deposit detail page.</p>}
            {needOrder && (
              <fieldset className="mb-3 text-xs">
                <legend className="mb-1 text-adm-t3">Original order (same wallet · succeeded · same amount, most recent first)</legend>
                {candidates.length === 0 && <p className="text-adm-red">No original order with a matching amount — cannot be claimed</p>}
                {candidates.map((c) => (
                  <label key={c.orderNo} className="flex items-center gap-2 py-0.5">
                    <input type="radio" name="orderNo" checked={orderNo === c.orderNo} onChange={() => setOrderNo(c.orderNo)} />
                    <span className="font-mono">{c.orderNo}</span><span>{c.amountMajor}</span><span className="text-adm-t3">{c.createdAt.slice(0, 10)}</span>
                  </label>
                ))}
              </fieldset>
            )}
            <label className="mb-3 block text-xs">Reason<textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} className="mt-1 w-full rounded border border-adm-border bg-adm-panel px-2 py-1 text-xs" placeholder="State the basis clearly: bank receipt / custody notice / customer report" /></label>
            {error && <p className="mb-2 text-xs text-adm-red">{error}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={onClose} className={adminButtonClass('modalCancel')}>Cancel</button>
              <button type="button" disabled={!canSubmit || submitting} onClick={submit} className={adminButtonClass('modalConfirm')}>{submitting ? 'Submitting…' : 'Submit for CFO review'}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
export default ReconciliationSupplementModal;
