// admin-web/src/components/ReconciliationAdjustmentCreateModal.tsx
//
// 平账一期·调账单 Task 7——从案件详情页的 flowComparison 行开单。
// 表单字段：成因 / 方向 / 金额 / 生效日期 / 关联原单号 / 内部原因 / 客户可见原因。
// 表单里没有「账簿」也没有「谁承担」——账簿取自案件（由父组件传入、只读回显），
// 承担方这个概念一期整个不存在（spec §0 问题 6，Task 7 brief）。
//
// 成因清单是 REASON_SPECS 的前端镜像（backend 唯一真相源见 adjustment-rules.ts）；
// 与本文件其它枚举镜像（如 StatusPill 的状态色表）同款约定——业务规则变了两边都要改，
// 这是本仓库既有取舍，不是本次新发明。
//
// 提交是「开单 + 提审」两步接力成一个操作（brief §Step3：创建成功 → 调 submit →
// 跳详情页），不留一个「已创建草稿待手动提审」的中间态给操作员管理。
import { useEffect, useState } from 'react';
import { adminButtonClass } from './common/adminButtonStyles';
import {
  AdminSessionError,
  adminFetch,
  getApiErrorMessage,
} from '../utils/adminFetch';

export type AdjustmentBook = 'CLIENT' | 'FIRM';
export type AdjustmentDirection = 'REDUCE' | 'INCREASE';

interface ReasonMeta {
  book: AdjustmentBook;
  directions: AdjustmentDirection[];
  label: string;
}

// 前端镜像 backend REASON_SPECS（src/modules/clearing-settle/reconciliation/
// disposition/adjustment-rules.ts）。无兜底档——七个成因码是全集，新增成因需要
// 两边同时改。customerLabel 与 backend 一致（5 个客户侧成因原样照抄）；FIRM 两个
// backend 没有 customerLabel（客户看不到公司侧调账），这里的 label 只是运营选择
// 用的中文名，不是客户文案。
// 导出给案件详情页复用（本案调账单列表要显示成因中文名），避免同一张表两处各抄一份。
export const REASON_META: Record<string, ReasonMeta> = {
  DEPOSIT_AMOUNT_CORRECTION: { book: 'CLIENT', directions: ['REDUCE', 'INCREASE'], label: '充值金额更正' },
  DEPOSIT_DUPLICATE_REVERSAL: { book: 'CLIENT', directions: ['REDUCE'], label: '重复入账撤销' },
  DEPOSIT_SIGNAL_VOID: { book: 'CLIENT', directions: ['REDUCE'], label: '充值撤销' },
  WITHDRAW_AMOUNT_CORRECTION: { book: 'CLIENT', directions: ['INCREASE'], label: '提现金额更正' },
  WITHDRAW_VOID_REFUND: { book: 'CLIENT', directions: ['INCREASE'], label: '提现撤销退回' },
  BANK_INTEREST: { book: 'FIRM', directions: ['INCREASE'], label: '银行利息' },
  BANK_CHARGE: { book: 'FIRM', directions: ['REDUCE'], label: '银行杂费' },
};

const todayStr = (): string => new Date().toISOString().slice(0, 10);

// 分→元 的可编辑显示值（区别于 formatAmount：那个是千分位展示用，不能拿来回填
// input——逗号会把用户输入搅乱）。bigint-safe：只做字符串切分，不过一次浮点。
const minorToDisplay = (raw: string, decimals: number): string => {
  const s = String(raw ?? '0');
  let neg = false; let body = s;
  if (body.startsWith('-')) { neg = true; body = body.slice(1); }
  if (decimals === 0) return `${neg ? '-' : ''}${body || '0'}`;
  const padded = body.padStart(decimals + 1, '0');
  const intPart = padded.slice(0, padded.length - decimals) || '0';
  const fracPart = padded.slice(padded.length - decimals);
  return `${neg ? '-' : ''}${intPart}.${fracPart}`;
};

// 反向：操作员输入的元 → 分（最小单位整数字符串，CreateAdjustmentDto.amount 要
// 的形状）。非法输入（非数字/小数位超过资产精度）返回 null，调用方据此禁用提交
// ——这是把"输入还原成数字"这件事做对，不是防御性校验（没有它表单根本不能用）。
const displayToMinor = (display: string, decimals: number): string | null => {
  const trimmed = display.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null;
  const [intPart, fracPart = ''] = trimmed.split('.');
  if (fracPart.length > decimals) return null;
  const combined = `${intPart}${fracPart.padEnd(decimals, '0')}`.replace(/^0+(?=\d)/, '');
  return combined || '0';
};

export interface AdjustmentPrefill {
  amountMinor: string;                       // 最小单位（分）整数字符串，来自 flowComparison 行
  direction: AdjustmentDirection | '';        // 猜测性默认值，表单里仍可改
  relatedOrderNo: string;                     // 仅 IN_TRANSIT 行有（该行的 fundsOrderNo）
}

interface ReconciliationAdjustmentCreateModalProps {
  open: boolean;
  caseNo: string;
  book: AdjustmentBook;
  assetCode: string;
  decimals: number;
  prefill: AdjustmentPrefill;
  onClose: () => void;
  onCreated: (adjustmentNo: string) => void;
}

const ReconciliationAdjustmentCreateModal = ({
  open,
  caseNo,
  book,
  assetCode,
  decimals,
  prefill,
  onClose,
  onCreated,
}: ReconciliationAdjustmentCreateModalProps) => {
  const [reasonCode, setReasonCode] = useState('');
  const [direction, setDirection] = useState<AdjustmentDirection | ''>('');
  const [amountDisplay, setAmountDisplay] = useState('');
  const [effectiveDate, setEffectiveDate] = useState(todayStr());
  const [relatedOrderNo, setRelatedOrderNo] = useState('');
  const [reasonInternal, setReasonInternal] = useState('');
  const [reasonCustomer, setReasonCustomer] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setReasonCode('');
    setDirection('');
    setAmountDisplay(prefill.amountMinor ? minorToDisplay(prefill.amountMinor, decimals) : '');
    setEffectiveDate(todayStr());
    setRelatedOrderNo(prefill.relatedOrderNo ?? '');
    setReasonInternal('');
    setReasonCustomer('');
    setError('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // 只列当前案件账簿下的成因——客户账簿案件不该看到 BANK_INTEREST/BANK_CHARGE，反之亦然。
  const reasonOptions = Object.entries(REASON_META).filter(([, meta]) => meta.book === book);
  const directionOptions = reasonCode ? REASON_META[reasonCode].directions : [];

  const pickReason = (code: string) => {
    setReasonCode(code);
    if (!code) { setDirection(''); return; }
    const dirs = REASON_META[code].directions;
    if (dirs.length === 1) {
      setDirection(dirs[0]);
    } else if (prefill.direction && dirs.includes(prefill.direction)) {
      setDirection(prefill.direction);
    } else {
      setDirection(dirs[0]);
    }
  };

  const needsRelatedOrder = book === 'CLIENT' && direction === 'INCREASE';
  const amountMinor = displayToMinor(amountDisplay, decimals);
  const amountValid = amountMinor !== null && amountMinor !== '0';

  const submitDisabled =
    submitting ||
    !reasonCode ||
    !direction ||
    !amountValid ||
    !effectiveDate ||
    (needsRelatedOrder && !relatedOrderNo.trim()) ||
    !reasonInternal.trim() ||
    !reasonCustomer.trim();

  const submit = async () => {
    if (submitDisabled || amountMinor === null) return;
    setSubmitting(true);
    setError('');
    try {
      const body: Record<string, unknown> = {
        caseNo,
        reasonCode,
        direction,
        amount: amountMinor,
        effectiveDate,
        reasonInternal: reasonInternal.trim(),
        reasonCustomer: reasonCustomer.trim(),
      };
      if (relatedOrderNo.trim()) body.relatedOrderNo = relatedOrderNo.trim();

      const createRes = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/reconciliation/adjustments`,
        { method: 'POST', body: JSON.stringify(body) },
      );
      if (!createRes.ok) {
        throw new Error(await getApiErrorMessage(createRes, 'Failed to create adjustment.'));
      }
      const { adjustmentNo } = (await createRes.json()) as { adjustmentNo: string };

      const submitRes = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/reconciliation/adjustments/${encodeURIComponent(adjustmentNo)}/submit`,
        { method: 'POST' },
      );
      if (!submitRes.ok) {
        throw new Error(
          `已开单 ${adjustmentNo}，但提审失败：${await getApiErrorMessage(submitRes, 'Failed to submit for approval.')}`,
        );
      }
      onCreated(adjustmentNo);
    } catch (e) {
      if (e instanceof AdminSessionError) return;
      setError(e instanceof Error ? e.message : 'Failed to create adjustment.');
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  const selectCls =
    'w-full rounded border border-adm-border bg-adm-bg px-2.5 py-2 font-mono text-[11px] text-adm-t1 outline-none transition-colors focus:border-adm-amber disabled:opacity-50';
  const labelCls = 'mb-1.5 block font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-adm-t3';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-xl border border-adm-border bg-adm-panel shadow-xl">
        <div className="border-b border-adm-border px-6 py-4">
          <h2 className="text-base font-semibold text-adm-t1">开调账单 / Open Adjustment</h2>
          <p className="mt-1 font-mono text-[10px] text-adm-t3">
            {caseNo} · {book === 'CLIENT' ? '客户账簿' : '公司账簿'} · {assetCode}
          </p>
        </div>

        <div className="max-h-[70vh] overflow-y-auto px-6 py-4">
          {error && (
            <div className="mb-3 rounded border border-adm-red/30 bg-adm-red/10 px-3 py-2 font-mono text-[10px] text-adm-red">
              {error}
            </div>
          )}

          <label className={labelCls}>成因 / Reason</label>
          <select
            value={reasonCode}
            onChange={(e) => pickReason(e.target.value)}
            disabled={submitting}
            className={`mb-4 ${selectCls}`}
          >
            <option value="">请选择成因…</option>
            {reasonOptions.map(([code, meta]) => (
              <option key={code} value={code}>
                {meta.label} · {code}
              </option>
            ))}
          </select>

          <label className={labelCls}>方向 / Direction</label>
          <select
            value={direction}
            onChange={(e) => setDirection(e.target.value as AdjustmentDirection)}
            disabled={submitting || directionOptions.length <= 1}
            className={`mb-1 ${selectCls}`}
          >
            {directionOptions.length === 0 && <option value="">请先选择成因</option>}
            {directionOptions.map((d) => (
              <option key={d} value={d}>
                {d === 'REDUCE' ? '减少 REDUCE' : '增加 INCREASE'}
              </option>
            ))}
          </select>
          {reasonCode && directionOptions.length === 1 && (
            <p className="mb-4 font-mono text-[9px] text-adm-t3">该成因只允许这一个方向，已锁定。</p>
          )}
          {(!reasonCode || directionOptions.length !== 1) && <div className="mb-4" />}

          <label className={labelCls}>金额 / Amount（{assetCode}）</label>
          <input
            value={amountDisplay}
            onChange={(e) => setAmountDisplay(e.target.value)}
            placeholder="0.00"
            disabled={submitting}
            className="mb-1 w-full rounded border border-adm-border bg-adm-bg px-2.5 py-2 font-mono text-[11px] text-adm-t1 outline-none transition-colors placeholder:text-adm-t3 focus:border-adm-amber"
          />
          {amountDisplay.trim() !== '' && !amountValid && (
            <p className="mb-1 font-mono text-[9px] text-adm-red">
              金额格式不对，或超出 {assetCode} 的精度（最多 {decimals} 位小数）。
            </p>
          )}
          <div className="mb-4" />

          <label className={labelCls}>生效日期 / Effective Date</label>
          <input
            type="date"
            value={effectiveDate}
            onChange={(e) => setEffectiveDate(e.target.value)}
            disabled={submitting}
            className="mb-4 w-full rounded border border-adm-border bg-adm-bg px-2.5 py-2 font-mono text-[11px] text-adm-t1 outline-none transition-colors focus:border-adm-amber"
          />

          <label className={labelCls}>
            关联原单号 / Related Order No{needsRelatedOrder ? '（必填）' : '（可选）'}
          </label>
          <input
            value={relatedOrderNo}
            onChange={(e) => setRelatedOrderNo(e.target.value)}
            placeholder={needsRelatedOrder ? '例如 DEP2608280001' : '（可留空）'}
            disabled={submitting}
            className="mb-1 w-full rounded border border-adm-border bg-adm-bg px-2.5 py-2 font-mono text-[11px] text-adm-t1 outline-none transition-colors placeholder:text-adm-t3 focus:border-adm-amber"
          />
          {needsRelatedOrder && (
            <p className="mb-1 font-mono text-[9px] text-adm-t3">
              客户账簿给客户加钱必须指向一张已存在的原单——无原单即凭空加钱，会绕过 KYT 与合规闸。
            </p>
          )}
          <div className="mb-4" />

          <label className={labelCls}>内部原因 / Internal Reason</label>
          <textarea
            value={reasonInternal}
            onChange={(e) => setReasonInternal(e.target.value)}
            placeholder="给审批人看的具体说明，例如：同一笔充值入账两次，需冲正"
            disabled={submitting}
            className="mb-4 h-16 w-full resize-none rounded border border-adm-border bg-adm-bg px-2.5 py-2 text-xs text-adm-t1 outline-none transition-colors placeholder:text-adm-t3 focus:border-adm-amber"
          />

          <label className={labelCls}>客户可见原因 / Customer-Visible Reason</label>
          <textarea
            value={reasonCustomer}
            onChange={(e) => setReasonCustomer(e.target.value)}
            placeholder="客户流水读模型任务上线前暂不展示，但仍需留痕"
            disabled={submitting}
            className="w-full resize-none rounded border border-adm-border bg-adm-bg px-2.5 py-2 text-xs text-adm-t1 outline-none transition-colors placeholder:text-adm-t3 focus:border-adm-amber"
            rows={2}
          />
        </div>

        <div className="flex justify-end gap-3 border-t border-adm-border px-6 py-4">
          <button onClick={onClose} disabled={submitting} className={adminButtonClass('modalCancel')}>
            Cancel
          </button>
          <button onClick={() => void submit()} disabled={submitDisabled} className={adminButtonClass('modalConfirm')}>
            {submitting ? '提交中… / Submitting…' : '开单并提审 / Open & Submit'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ReconciliationAdjustmentCreateModal;
