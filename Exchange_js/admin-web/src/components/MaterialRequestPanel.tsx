// admin-web/src/components/MaterialRequestPanel.tsx
//
// 材料请求面板 —— 客户详情页与三个订单详情页共用同一个组件、同一个端点，
// 用 `mode` 区分数据源（业主选的乙：裁决按钮两处都给，但严格不复制代码）。
//
// G6：客户视角是全集（含终态行），订单视角是活行 —— 这是后端两个端点已经
// 分好的语义（listAllByCustomer vs listLiveByOrder），前端只管挑对端点。

import { useCallback, useEffect, useState } from 'react';
import { adminButtonClass } from './common/adminButtonStyles';
import { AdminBadge } from './ui/AdminBadge';
import { AdminSessionError, adminFetch, getApiErrorMessage } from '../utils/adminFetch';
import { useSimulationMode } from '../utils/simulationMode';
import { useAdminSession } from '../contexts/AdminSessionContext';
import { PERMISSIONS } from '../rbac/permissions';

export interface AdminMaterialRequestRow {
  requestNo: string;
  materialType: string;
  materialLabel: string;
  levelName: string;
  applicantActionId: string;
  orderDomain: 'DEPOSIT' | 'WITHDRAW' | 'SWAP' | null;
  orderRef: string | null;
  restrictionNo: string | null;
  origin: 'SUMSUB_PUSHED' | 'OPERATOR_ISSUED' | 'SYSTEM_SCHEDULED';
  status: 'PENDING_SUBMISSION' | 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  reason: string;
  issuedBy: string;
  issuedAt: string;
  submittedAt: string | null;
  reviewedAt: string | null;
  reviewAnswer: 'GREEN' | 'RED' | null;
  reviewRejectType: 'RETRY' | 'FINAL' | null;
  cancelReason: string | null;
}

type Props = (
  | { mode: 'customer'; customerNo: string }
  | { mode: 'order'; orderDomain: 'DEPOSIT' | 'WITHDRAW' | 'SWAP'; orderRef: string }
) & {
  onChanged?: () => void;
  /** 客户详情页在下发弹窗提交成功后 bump 这个值，让本已挂载的面板重新拉取一次——
   * 面板自己管自己的行状态，父页面没有别的办法通知它「有新行了」。 */
  refreshKey?: number;
};

const fmt = (v?: string | null) => (v ? new Date(v).toLocaleString() : '—');

/** 三个裁决按钮 —— RED 分 RETRY / FINAL 是 Sumsub 的真实语义，不能合成一个「不通过」。 */
const VERDICTS = [
  { key: 'GREEN', label: '✅ Approve', variant: 'workflowPrimary' as const, rejectType: undefined },
  { key: 'RETRY', label: '🔄 Reject · Retry', variant: 'workflowSecondary' as const, rejectType: 'RETRY' as const },
  { key: 'FINAL', label: '❌ Reject · Final', variant: 'workflowNegative' as const, rejectType: 'FINAL' as const },
];

const MaterialRequestPanel = (props: Props) => {
  const { hasPermission } = useAdminSession();
  const { enabled: simEnabled } = useSimulationMode();
  const [rows, setRows] = useState<AdminMaterialRequestRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');

  const canRead =
    props.mode === 'customer'
      ? hasPermission(PERMISSIONS.MATERIAL_REQUESTS_READ)
      : hasPermission(PERMISSIONS.MATERIAL_REQUESTS_BY_ORDER_READ);

  const url =
    props.mode === 'customer'
      ? `${import.meta.env.VITE_API_URL}/admin/customers/${props.customerNo}/material-requests`
      : `${import.meta.env.VITE_API_URL}/admin/material-requests/by-order/${props.orderDomain}/${props.orderRef}`;

  const load = useCallback(() => {
    if (!canRead) return;
    setLoading(true);
    adminFetch(url)
      .then((r) => (r.ok ? r.json() : []))
      .then((d: AdminMaterialRequestRow[]) => setRows(Array.isArray(d) ? d : []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [url, canRead]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, props.refreshKey]);

  const runVerdict = async (requestNo: string, verdict: (typeof VERDICTS)[number]) => {
    setBusy(`${requestNo}:${verdict.key}`);
    setError('');
    try {
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/sumsub/simulate/applicant-action-result`,
        {
          method: 'POST',
          body: JSON.stringify({
            requestNo,
            reviewAnswer: verdict.key === 'GREEN' ? 'GREEN' : 'RED',
            ...(verdict.rejectType ? { reviewRejectType: verdict.rejectType } : {}),
          }),
        },
      );
      if (!res.ok) throw new Error(await getApiErrorMessage(res, 'Verdict failed.'));
      load();
      props.onChanged?.();
    } catch (e) {
      if (e instanceof AdminSessionError) return;
      setError(e instanceof Error ? e.message : 'Verdict failed.');
    } finally {
      setBusy(null);
    }
  };

  if (!canRead) return null;

  return (
    <div>
      {error && (
        <div className="mb-3 rounded border border-adm-red/30 bg-adm-red/10 px-3 py-2 font-mono text-[10px] text-adm-red">
          {error}
        </div>
      )}
      {loading ? (
        <p className="font-mono text-[10px] text-adm-t3">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="font-mono text-[10px] text-adm-t3">No material requests.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                {['Request No', 'Material', 'Bound To', 'Blocks', 'Status', 'Issued', ''].map((h, i) => (
                  <th
                    key={h || `col-${i}`}
                    className="border-b border-adm-border bg-adm-panel px-3 py-1.5 text-left font-mono text-[8.5px] font-semibold uppercase tracking-[0.12em] text-adm-t3 whitespace-nowrap"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.requestNo} className="border-b border-adm-border">
                  <td className="px-3 py-2 font-mono text-[11px] font-semibold text-adm-amber whitespace-nowrap">
                    {r.requestNo}
                  </td>
                  <td className="px-3 py-2 font-mono text-[10px] text-adm-t2 whitespace-nowrap">
                    {r.materialLabel}
                  </td>
                  <td className="px-3 py-2 font-mono text-[10px] text-adm-t2 whitespace-nowrap">
                    {r.orderRef ? `${r.orderDomain} ${r.orderRef}` : 'Customer level'}
                  </td>
                  <td className="px-3 py-2 font-mono text-[10px] whitespace-nowrap">
                    {r.restrictionNo ? (
                      <span className="text-adm-red">{r.restrictionNo}</span>
                    ) : (
                      <span className="text-adm-t3">— nudge only</span>
                    )}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <AdminBadge value={r.status} />
                  </td>
                  <td className="px-3 py-2 font-mono text-[10px] text-adm-t2 whitespace-nowrap">
                    {fmt(r.issuedAt)} · {r.issuedBy}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    {/* 只有客户已经交了才有得裁决。整块受模拟模式门控 —— 真接
                        Sumsub 时裁决在 Sumsub 后台做，这里不该出现按钮。 */}
                    {simEnabled && r.status === 'SUBMITTED' ? (
                      <span className="inline-flex gap-1.5">
                        {VERDICTS.map((v) => (
                          <button
                            key={v.key}
                            disabled={busy !== null}
                            onClick={() => void runVerdict(r.requestNo, v)}
                            className={adminButtonClass(v.variant)}
                          >
                            {busy === `${r.requestNo}:${v.key}` ? '…' : v.label}
                          </button>
                        ))}
                      </span>
                    ) : (
                      <span className="font-mono text-[10px] text-adm-t3">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default MaterialRequestPanel;
