// admin-web/src/components/InternalTransferInitiateModal.tsx
// 平账二期（spec §8）：补款 / 垫款一个弹层。全部字段预填只读（金额不可改——多一分都是往客户钱包塞钱），
// 只填理由；提交打划转端点，返回单号 + 审批单号。externalLineId 只作隐藏锚，不上页面。
import { useState } from 'react';
import { adminFetch, AdminSessionError, getApiErrorMessage } from '../utils/adminFetch';
import { adminButtonClass } from './common/adminButtonStyles';
import { formatAmount, type FlowComparisonRow } from '../pages/ReconciliationCasesDetailPage';

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
      if (!res.ok) { setError(await getApiErrorMessage(res, '发起失败')); return; }
      setResult(await res.json());
    } catch (e) { if (e instanceof AdminSessionError) throw e; setError(e instanceof Error ? e.message : '发起失败'); }
    finally { setSubmitting(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="w-[560px] rounded-lg border border-adm-border bg-adm-panel p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-3 text-sm font-semibold text-adm-t1">{isAdvance ? '发起垫款 · 退汇差额由公司先垫' : '发起补款 · 认损后公司补齐客户'}</h3>
        <dl className="mb-4 grid grid-cols-2 gap-x-4 gap-y-1 rounded border border-adm-border bg-adm-hover/40 p-3 text-xs">
          <dt className="text-adm-t3">客户 / 钱包</dt><dd className="font-mono">{ns.customerNo ?? '—'} · {ns.walletNo ?? '—'}</dd>
          <dt className="text-adm-t3">金额（锁定，不可改）</dt><dd className="font-mono">{formatAmount(ns.amount, decimals)} {assetCode}</dd>
          {isAdvance ? (
            <><dt className="text-adm-t3">退汇 / 客户可用</dt><dd className="font-mono">{formatAmount(ns.lineAmount, decimals)} / {formatAmount(ns.available, decimals)}</dd></>
          ) : (
            <><dt className="text-adm-t3">来源认损单</dt><dd className="font-mono">{ns.adjustmentNo}</dd></>
          )}
          <dt className="text-adm-t3">对账案</dt><dd className="font-mono">{caseNo}</dd>
          <dt className="text-adm-t3">路线</dt><dd>{assetCode === 'AED' ? '运营户 → 结算户 → 客户 vIBAN（法币两腿）' : '运营户 → 客户地址（一腿）'}</dd>
        </dl>
        {result ? (
          <>
            <p className="text-xs text-adm-t2">已发起，等待 CFO 复核。划转单 <span className="font-mono">{result.transferNo}</span>，审批单 <span className="font-mono">{result.approvalNo}</span>。批准后到资金单页 ⚡ 推腿，回案子「重新对账」看在途与自愈。</p>
            <div className="mt-4 flex justify-end"><button type="button" onClick={onDone} className={adminButtonClass('modalConfirm')}>完成</button></div>
          </>
        ) : (
          <>
            <label className="mb-3 block text-xs">理由
              <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} className="mt-1 w-full rounded border border-adm-border bg-adm-panel px-2 py-1 text-xs"
                placeholder={isAdvance ? '例：银行扣回 6500，客户已花掉部分，先垫后扣，垫款登记追索' : '例：托管差额查无可查，公司认赔补齐'} />
            </label>
            {error && <p className="mb-2 text-xs text-adm-red">{error}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={onClose} className={adminButtonClass('modalCancel')}>取消</button>
              <button type="button" disabled={submitting || !reason.trim()} onClick={() => void submit()} className={adminButtonClass('modalConfirm')}>{submitting ? '提交中…' : '提交给 CFO'}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default InternalTransferInitiateModal;
