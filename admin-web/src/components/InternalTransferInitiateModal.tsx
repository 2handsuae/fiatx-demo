// admin-web/src/components/InternalTransferInitiateModal.tsx
// 平账二期（spec §8）：垫款一个弹层。全部字段预填只读（金额不可改——多一分都是往客户钱包塞钱），
// 只填理由；提交打划转端点，返回单号 + 审批单号。externalLineId 只作隐藏锚，不上页面。
//
// 戊波二 T8：原「补款」分支改为认损补缺弹层（spec §4.1「入口」）——一张单、CFO 一次批：先记短缺（客户余额不动）再从公司钱包补上。
// 成因固定「Unexplained client loss」只读、金额锁定（差额或事故定损额，读面 nextStep.amount）、生效日只读（案件业务日），
// 金库只选两件事：从哪只公司钱包出钱（运营户 F_OPS 默认 / 手续费户 F_FEE，下拉数据同付款单「Pay From」，不加端点）和理由。
// 提交打 POST /admin/internal-transfers/shortfall-topup {caseNo, flowId?, externalLineId?, fromWalletId, reason}——
// 金额 / 成因 / 来路一概不由前端传，后端按锚现算（DTO 白名单会剥掉）。钱包 id 是登记表行的 ownerUuid，只提交、不渲染（铁律⑥）。
import { useEffect, useState } from 'react';
import { adminFetch, AdminSessionError, getApiErrorMessage } from '../utils/adminFetch';
import { adminButtonClass } from './common/adminButtonStyles';
import { formatAmount } from '../utils/reconAmount';
import type { FlowComparisonRow } from '../utils/reconTypes';
import { WALLET_ROLE_LABEL } from '../utils/walletRole.util';
import { defaultFromWalletId, pickFromWallets, type FromWalletOption } from '../utils/shortfallTopup';

interface Props { open: boolean; caseNo: string; row: FlowComparisonRow | null; assetCode: string; decimals: number; onClose: () => void; onDone: () => void }

const InternalTransferInitiateModal = ({ open, caseNo, row, assetCode, decimals, onClose, onDone }: Props) => {
  const [reason, setReason] = useState('');
  const [fromWalletId, setFromWalletId] = useState('');
  const [fromWallets, setFromWallets] = useState<FromWalletOption[]>([]);
  // 下拉里余额的单位：/admin/tb/accounts 的余额是币种级（USDT），案件资产代码是 USDT-TRON，不能直接拿来当后缀。
  const [currency, setCurrency] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ transferNo: string; approvalNo: string } | null>(null);
  const isShortfall = row?.nextStep?.kind === 'SHORTFALL_TOPUP';

  // 弹层常驻挂载（open 只控显隐）：同一案件页上连着给两行开单时，上一次的理由 / 回执不能带进来。
  useEffect(() => {
    if (!open) return;
    setReason(''); setResult(null); setError('');
  }, [open]);

  // 认损补缺：取该币种的公司现金户（带 walletRole / walletNo / balance），留运营户 / 手续费户，默认运营户。
  // /admin/tb/accounts 按币种（USDT）过滤，案件的 assetCode 是资产代码（USDT-TRON），先查资产表换算。
  useEffect(() => {
    setFromWallets([]);
    setFromWalletId('');
    setCurrency('');
    if (!open || !isShortfall) return undefined;
    let stale = false;
    void (async () => {
      try {
        const assetsRes = await adminFetch(`${import.meta.env.VITE_API_URL}/assets?status=ACTIVE&take=200`);
        if (!assetsRes.ok || stale) return;
        const assets = (await assetsRes.json()).items as Array<{ code: string; currency: string }> | undefined;
        const ccy = assets?.find((a) => a.code === assetCode)?.currency;
        if (!ccy) return;
        const res = await adminFetch(
          `${import.meta.env.VITE_API_URL}/admin/tb/accounts?ownerType=WALLET&code=50&assetCurrency=${encodeURIComponent(ccy)}&take=100`,
        );
        if (!res.ok || stale) return;
        const data = await res.json();
        const rows = pickFromWallets(Array.isArray(data.items) ? data.items : []);
        setFromWallets(rows);
        setFromWalletId(defaultFromWalletId(rows));
        setCurrency(ccy);
      } catch (e) {
        if (e instanceof AdminSessionError) return;
        console.error(e);
      }
    })();
    return () => { stale = true; };
  }, [open, isShortfall, assetCode]);

  if (!open || !row?.nextStep) return null;
  const ns = row.nextStep;
  const isAdvance = ns.kind === 'ADVANCE';

  const submit = async () => {
    setSubmitting(true); setError('');
    try {
      const path = isAdvance ? '/admin/internal-transfers/advance' : '/admin/internal-transfers/shortfall-topup';
      const body = isAdvance
        ? { caseNo, externalLineId: ns.externalLineId, reason: reason.trim() }
        : { caseNo, flowId: row.internalFlow?.id, externalLineId: row.externalLine?.id, fromWalletId, reason: reason.trim() };
      const res = await adminFetch(`${import.meta.env.VITE_API_URL}${path}`, { method: 'POST', body: JSON.stringify(body) });
      if (!res.ok) { setError(await getApiErrorMessage(res, 'Failed to initiate')); return; }
      setResult(await res.json());
    } catch (e) { if (e instanceof AdminSessionError) throw e; setError(e instanceof Error ? e.message : 'Failed to initiate'); }
    finally { setSubmitting(false); }
  };

  const fi = 'mt-1 w-full rounded border border-adm-border bg-adm-panel px-2 py-1 text-xs';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="w-[560px] rounded-lg border border-adm-border bg-adm-panel p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-3 text-sm font-semibold text-adm-t1">{isAdvance ? 'Initiate advance · The firm fronts the recall shortfall' : 'Recognize loss & top up · The firm recognizes the custody shortfall and tops the wallet up'}</h3>
        <dl className="mb-4 grid grid-cols-2 gap-x-4 gap-y-1 rounded border border-adm-border bg-adm-hover/40 p-3 text-xs">
          <dt className="text-adm-t3">Customer / Wallet</dt><dd className="font-mono">{ns.customerNo ?? '—'} · {ns.walletNo ?? '—'}</dd>
          {isAdvance ? (
            <>
              <dt className="text-adm-t3">Amount (locked, not editable)</dt><dd className="font-mono">{formatAmount(ns.amount, decimals)} {assetCode}</dd>
              <dt className="text-adm-t3">Recalled / Customer available</dt><dd className="font-mono">{formatAmount(ns.lineAmount, decimals)} / {formatAmount(ns.available, decimals)}</dd>
            </>
          ) : (
            <>
              <dt className="text-adm-t3">Cause</dt><dd>Unexplained client loss</dd>
              <dt className="text-adm-t3">Shortfall (locked, not editable)</dt><dd className="font-mono">{formatAmount(ns.amount, decimals)} {assetCode}</dd>
              <dt className="text-adm-t3">Effective date</dt><dd className="font-mono">{ns.effectiveDate ?? '—'}</dd>
            </>
          )}
          <dt className="text-adm-t3">Reconciliation case</dt><dd className="font-mono">{caseNo}</dd>
          <dt className="text-adm-t3">Route</dt><dd>{assetCode === 'AED' ? 'Company wallet → Settlement account → Customer vIBAN (2 fiat legs)' : 'Company wallet → Customer address (1 leg)'}</dd>
        </dl>
        {result ? (
          <>
            {isAdvance ? (
              <p className="text-xs text-adm-t2">Initiated, awaiting CFO review. Transfer <span className="font-mono">{result.transferNo}</span>, approval <span className="font-mono">{result.approvalNo}</span>. Once approved, push the leg on the funds order page — then return to the case and click "Re-reconcile" to see it in transit and self-resolve.</p>
            ) : (
              <p className="text-xs text-adm-t2">Initiated, awaiting CFO review. Transfer <span className="font-mono">{result.transferNo}</span>, approval <span className="font-mono">{result.approvalNo}</span>. Once approved the shortfall is recognised on the books (the customer balance does not move) and the top-up leg is created for treasury to push on the funds order page.</p>
            )}
            <div className="mt-4 flex justify-end"><button type="button" onClick={onDone} className={adminButtonClass('modalConfirm')}>Complete</button></div>
          </>
        ) : (
          <>
            {!isAdvance && (
              <label className="mb-3 block text-xs">Top up from
                <select value={fromWalletId} onChange={(e) => setFromWalletId(e.target.value)} className={fi}>
                  <option value="">Select…</option>
                  {fromWallets.map((w) => (
                    <option key={w.ownerUuid} value={w.ownerUuid}>
                      {w.walletNo} · {WALLET_ROLE_LABEL[w.walletRole] ?? w.walletRole} · balance {formatAmount(w.balance, decimals)} {currency}
                    </option>
                  ))}
                </select>
                <span className="mt-1 block font-mono text-[10px] text-adm-t3">
                  Operating wallet by default. Topping up from the fee wallet uses collected fees and leaves the operating balance untouched.
                </span>
              </label>
            )}
            <label className="mb-3 block text-xs">Reason
              <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} className="mt-1 w-full rounded border border-adm-border bg-adm-panel px-2 py-1 text-xs"
                placeholder={isAdvance ? 'e.g.: Bank recalled 6,500, customer already spent part of it — front the funds now, recover later; the advance is logged for recovery' : 'e.g.: Custody shortfall cannot be traced — the firm recognizes the loss and tops the wallet up in full'} />
            </label>
            {error && <p className="mb-2 text-xs text-adm-red">{error}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={onClose} className={adminButtonClass('modalCancel')}>Cancel</button>
              <button type="button" disabled={submitting || !reason.trim() || (!isAdvance && !fromWalletId)} onClick={() => void submit()} className={adminButtonClass('modalConfirm')}>{submitting ? 'Submitting…' : 'Submit to CFO'}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default InternalTransferInitiateModal;
