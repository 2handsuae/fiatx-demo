// admin-web/src/components/MaterialRequestIssueModal.tsx
//
// 下发一条材料请求。形态照抄 RestrictionOpenModal（遮罩 + 只读回显 + 底部两按钮）。
//
// G4（tipping-off，硬约束）：这里没有 cause 下拉。运营只决定「摁不摁」，摁的名义
// 永远是 PENDING_DOCUMENT —— 回显区固定写死一行，不给运营选 SANCTION 的机会。

import { useEffect, useState, type ReactNode } from 'react';
import { adminButtonClass } from './common/adminButtonStyles';
import { AdminSessionError, adminFetch, getApiErrorMessage } from '../utils/adminFetch';
import {
  RESTRICTION_CAUSE_POLICY,
  SELECTABLE_SCOPES,
  type RestrictionScope,
} from '../utils/restrictionCauseMeta';

interface MaterialRequestIssueModalProps {
  open: boolean;
  customerNo: string;
  customerLabel: string;
  onClose: () => void;
  onSubmitted: (requestNo: string, restrictionNo: string | null) => Promise<void> | void;
}

const MATERIAL_TYPES: { value: string; label: string }[] = [
  { value: 'EMIRATES_ID', label: 'Emirates ID' },
  { value: 'LIVENESS', label: 'Liveness Check' },
  { value: 'PROOF_OF_ADDRESS', label: 'Proof of Address' },
  { value: 'SOURCE_OF_FUNDS', label: 'Source of Funds' },
  { value: 'SOURCE_OF_WEALTH', label: 'Source of Wealth' },
];

/** 镜像 config/material-refresh-policy.json 里每个 material 的 enforceRestriction ——
 * 后端才是真相源，这里只是弹窗默认值，改了后端记得回来同步。 */
const ENFORCE_RESTRICTION_DEFAULT: Record<string, boolean> = {
  EMIRATES_ID: true,
  LIVENESS: true,
  PROOF_OF_ADDRESS: true,
  SOURCE_OF_FUNDS: true,
  SOURCE_OF_WEALTH: true,
};

/** 下发弹窗的 cause 永远是 PENDING_DOCUMENT —— 唯一 scopeSelectable 的可摁 cause。 */
const POLICY = RESTRICTION_CAUSE_POLICY.PENDING_DOCUMENT;

// 终审 Important #1：client-web 还没有兑换单详情页（BACKLOG.md 383 行）。
// 挂了限制的 SWAP 材料请求会正常出现在客户级横幅上，不受影响；但运营选
// SWAP + 不勾 Restrict 时落一行 orderDomain='SWAP'/restrictionNo=null——
// 客户级横幅两处过滤（profile-banners.service.ts / PendingActionBanner.tsx）
// 都会把「绑了单又没挂限制」的行剔除、指望订单详情页兜底，而 SWAP 没有那个
// 详情页，客户端因此零入口，运营却以为发出去了。等 client-web 补上兑换单
// 详情页（BACKLOG 那条）再放开 SWAP。
const ORDER_DOMAINS: ('DEPOSIT' | 'WITHDRAW')[] = ['DEPOSIT', 'WITHDRAW'];

const EchoRow = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="flex items-start justify-between gap-3 border-b border-adm-border py-2 last:border-b-0">
    <span className="shrink-0 font-mono text-[9px] uppercase tracking-[0.14em] text-adm-t3">
      {label}
    </span>
    <span className="min-w-0 text-right font-mono text-[10px] text-adm-t2">{children}</span>
  </div>
);

const MaterialRequestIssueModal = ({
  open,
  customerNo,
  customerLabel,
  onClose,
  onSubmitted,
}: MaterialRequestIssueModalProps) => {
  const [materialType, setMaterialType] = useState(MATERIAL_TYPES[0].value);
  const [orderDomain, setOrderDomain] = useState<'' | 'DEPOSIT' | 'WITHDRAW'>('');
  const [orderRef, setOrderRef] = useState('');
  const [restrict, setRestrict] = useState(ENFORCE_RESTRICTION_DEFAULT[MATERIAL_TYPES[0].value]);
  const [scopes, setScopes] = useState<RestrictionScope[]>(POLICY.defaultScopes);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setMaterialType(MATERIAL_TYPES[0].value);
    setOrderDomain('');
    setOrderRef('');
    setRestrict(ENFORCE_RESTRICTION_DEFAULT[MATERIAL_TYPES[0].value]);
    setScopes(POLICY.defaultScopes);
    setReason('');
    setError('');
  }, [open]);

  /** 切材料类型 —— restrict 默认值跟着这个材料的策略走，不残留上一个材料的手动改动。 */
  const pickMaterialType = (next: string) => {
    setMaterialType(next);
    setRestrict(ENFORCE_RESTRICTION_DEFAULT[next] ?? false);
    setScopes(POLICY.defaultScopes);
  };

  const toggleScope = (scope: RestrictionScope) =>
    setScopes((prev) =>
      prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope],
    );

  const submit = async () => {
    if (!reason.trim()) return;
    if (orderDomain && !orderRef.trim()) return;
    setSubmitting(true);
    setError('');
    try {
      const body: Record<string, unknown> = {
        materialType,
        restrict,
        reason: reason.trim(),
      };
      if (orderDomain) {
        body.orderDomain = orderDomain;
        body.orderRef = orderRef.trim();
      }
      if (restrict) body.restrictScopes = scopes;

      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/customers/${customerNo}/material-requests`,
        { method: 'POST', body: JSON.stringify(body) },
      );
      if (!res.ok) {
        throw new Error(await getApiErrorMessage(res, 'Failed to issue material request.'));
      }
      const data = (await res.json()) as { requestNo: string; restrictionNo: string | null };
      await onSubmitted(data.requestNo, data.restrictionNo);
      onClose();
    } catch (e) {
      if (e instanceof AdminSessionError) return;
      setError(e instanceof Error ? e.message : 'Failed to issue material request.');
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  const submitDisabled =
    submitting ||
    !reason.trim() ||
    (!!orderDomain && !orderRef.trim()) ||
    (restrict && scopes.length === 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-xl border border-adm-border bg-adm-panel shadow-xl">
        <div className="border-b border-adm-border px-6 py-4">
          <h2 className="text-base font-semibold text-adm-t1">Request Documents</h2>
          <p className="mt-1 font-mono text-[10px] text-adm-t3">
            {customerLabel} · {customerNo} — creates a Sumsub applicant action.
          </p>
        </div>

        <div className="max-h-[70vh] overflow-y-auto px-6 py-4">
          {error && (
            <div className="mb-3 rounded border border-adm-red/30 bg-adm-red/10 px-3 py-2 font-mono text-[10px] text-adm-red">
              {error}
            </div>
          )}

          <label className="mb-1.5 block font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-adm-t3">
            Material Type
          </label>
          <select
            value={materialType}
            onChange={(e) => pickMaterialType(e.target.value)}
            disabled={submitting}
            className="mb-4 w-full rounded border border-adm-border bg-adm-bg px-2.5 py-2 font-mono text-[11px] text-adm-t1 outline-none transition-colors focus:border-adm-amber"
          >
            {MATERIAL_TYPES.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>

          <label className="mb-1.5 block font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-adm-t3">
            Bind To Order (optional)
          </label>
          <div className="mb-4 flex gap-2">
            <select
              value={orderDomain}
              onChange={(e) => setOrderDomain(e.target.value as typeof orderDomain)}
              disabled={submitting}
              className="w-40 shrink-0 rounded border border-adm-border bg-adm-bg px-2.5 py-2 font-mono text-[11px] text-adm-t1 outline-none transition-colors focus:border-adm-amber"
            >
              <option value="">Customer level</option>
              {ORDER_DOMAINS.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
            <input
              value={orderRef}
              onChange={(e) => setOrderRef(e.target.value)}
              placeholder={orderDomain ? 'e.g. DP2604108406' : 'Select an order domain first'}
              disabled={submitting || !orderDomain}
              className="min-w-0 flex-1 rounded border border-adm-border bg-adm-bg px-2.5 py-2 font-mono text-[11px] text-adm-t1 outline-none transition-colors placeholder:text-adm-t3 focus:border-adm-amber disabled:opacity-50"
            />
          </div>

          <label className="mb-2 flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={restrict}
              onChange={(e) => setRestrict(e.target.checked)}
              disabled={submitting}
              className="h-3.5 w-3.5 accent-current"
            />
            <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-adm-t2">
              Restrict trading
            </span>
          </label>

          {restrict && (
            <div className="mb-4 rounded border border-adm-border bg-adm-bg px-3 py-1">
              <EchoRow label="Blocks">
                <span className="inline-flex flex-wrap items-center justify-end gap-2">
                  {SELECTABLE_SCOPES.map((scope) => (
                    <label
                      key={scope}
                      className="inline-flex cursor-pointer items-center gap-1 text-adm-t2"
                    >
                      <input
                        type="checkbox"
                        checked={scopes.includes(scope)}
                        onChange={() => toggleScope(scope)}
                        disabled={submitting}
                        className="h-3 w-3 accent-current"
                      />
                      {scope}
                    </label>
                  ))}
                </span>
              </EchoRow>
              <EchoRow label="Restriction cause">
                PENDING_DOCUMENT (disclosed to the customer)
              </EchoRow>
              <EchoRow label="Release by">
                {POLICY.releasePolicy === 'MLRO_APPROVAL'
                  ? 'MLRO_APPROVAL — MLRO approval required'
                  : 'OPS_APPROVAL — ops officer approval required'}
              </EchoRow>
            </div>
          )}
          {!restrict && (
            <p className="mb-4 font-mono text-[9px] text-adm-t3">
              Reminder only — no restriction opens, trading stays unaffected.
            </p>
          )}

          <label className="mb-1.5 block font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-adm-t3">
            Reason
          </label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Emirates ID on file expires in 25 days, requesting renewal"
            disabled={submitting}
            className="w-full resize-none rounded border border-adm-border bg-adm-bg px-2.5 py-2 text-xs text-adm-t1 outline-none transition-colors placeholder:text-adm-t3 focus:border-adm-amber h-20"
          />
        </div>

        <div className="flex justify-end gap-3 border-t border-adm-border px-6 py-4">
          <button onClick={onClose} disabled={submitting} className={adminButtonClass('modalCancel')}>
            Cancel
          </button>
          <button
            onClick={() => void submit()}
            disabled={submitDisabled}
            className={adminButtonClass('workflowPrimary')}
          >
            {submitting ? 'Requesting…' : 'Request Documents'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default MaterialRequestIssueModal;
