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

const TITLE: Record<Kind, string> = { SUPPLEMENT_DEPOSIT: '发起补录 · 漏记客户入金', SUPPLEMENT_BOUNCE: '认领退汇 · 入金被银行扣回', SUPPLEMENT_PAYOUT_RETURN: '认领退回 · 出款后被银行退回' };
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
        if (!res.ok) { setError(await getApiErrorMessage(res, '读取账单行失败')); return; }
        const data = await res.json();
        setFacts(data.line); setKind(data.kind); setCandidates(data.candidates ?? []);
        if (data.candidates?.length === 1) setOrderNo(data.candidates[0].orderNo);
      } catch (e) { if (e instanceof AdminSessionError) throw e; setError(e instanceof Error ? e.message : '读取账单行失败'); }
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
      if (!res.ok) { setError(await getApiErrorMessage(res, '发起失败')); return; }
      const r = await res.json();
      setResult({ approvalNo: r.approvalNo, no: r.signalNo ?? r.depositNo ?? r.withdrawNo });
    } catch (e) { if (e instanceof AdminSessionError) throw e; setError(e instanceof Error ? e.message : '发起失败'); }
    finally { setSubmitting(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="w-[600px] max-h-[85vh] overflow-y-auto rounded-lg border border-adm-border bg-adm-panel p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-3 text-sm font-semibold text-adm-t1">{kind ? TITLE[kind] : '补单'}</h3>
        {facts && (
          <dl className="mb-4 grid grid-cols-2 gap-x-4 gap-y-1 rounded border border-adm-border bg-adm-hover/40 p-3 text-xs">
            <dt className="text-adm-t3">来源</dt><dd className="font-mono">{facts.source}</dd>
            <dt className="text-adm-t3">方向 / 金额</dt><dd className="font-mono">{facts.direction} {facts.amountMajor} {facts.currency}</dd>
            <dt className="text-adm-t3">入账时刻</dt><dd className="font-mono">{facts.datetime.replace('T', ' ').slice(0, 19)}</dd>
            <dt className="text-adm-t3">参考号</dt><dd className="font-mono">{facts.externalRef ?? '—'}</dd>
            <dt className="text-adm-t3">银行描述</dt><dd>{facts.description ?? '—'}</dd>
            <dt className="text-adm-t3">钱包 / 客户</dt><dd className="font-mono">{facts.walletNo ?? '—'} · {facts.ownerNo ?? '—'}</dd>
            <dt className="text-adm-t3">生效日（案子业务日）</dt><dd className="font-mono">{facts.businessDate}</dd>
          </dl>
        )}
        {result ? (
          <>
            <p className="text-xs text-adm-t2">已发起，等待 CFO 复核。审批单 <span className="font-mono">{result.approvalNo}</span>，补单号 <span className="font-mono">{result.no}</span>。批准后由业务域执行，回案子点「重新对账」看自愈。</p>
            <div className="mt-4 flex justify-end"><button type="button" onClick={onDone} className={adminButtonClass('modalConfirm')}>完成</button></div>
          </>
        ) : (
          <>
            {needAddr && <label className="mb-3 block text-xs">来源地址<input value={fromAddress} onChange={(e) => setFromAddress(e.target.value)} className="mt-1 w-full rounded border border-adm-border bg-adm-panel px-2 py-1 font-mono text-xs" placeholder="链上付款方地址" /></label>}
            {needIban && <label className="mb-3 block text-xs">来源 IBAN<input value={fromIban} onChange={(e) => setFromIban(e.target.value)} className="mt-1 w-full rounded border border-adm-border bg-adm-panel px-2 py-1 font-mono text-xs" placeholder="付款方 IBAN" /></label>}
            {needOrder && (
              <fieldset className="mb-3 text-xs">
                <legend className="mb-1 text-adm-t3">原单（同钱包 · 已成功 · 同金额，最近的在前）</legend>
                {candidates.length === 0 && <p className="text-adm-red">没有金额相符的原单，不能认领</p>}
                {candidates.map((c) => (
                  <label key={c.orderNo} className="flex items-center gap-2 py-0.5">
                    <input type="radio" name="orderNo" checked={orderNo === c.orderNo} onChange={() => setOrderNo(c.orderNo)} />
                    <span className="font-mono">{c.orderNo}</span><span>{c.amountMajor}</span><span className="text-adm-t3">{c.createdAt.slice(0, 10)}</span>
                  </label>
                ))}
              </fieldset>
            )}
            <label className="mb-3 block text-xs">原因<textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} className="mt-1 w-full rounded border border-adm-border bg-adm-panel px-2 py-1 text-xs" placeholder="写清依据：银行回单 / 托管通知 / 客户申报" /></label>
            {error && <p className="mb-2 text-xs text-adm-red">{error}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={onClose} className={adminButtonClass('modalCancel')}>取消</button>
              <button type="button" disabled={!canSubmit || submitting} onClick={submit} className={adminButtonClass('modalConfirm')}>{submitting ? '提交中…' : '提交给 CFO 复核'}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
export default ReconciliationSupplementModal;
