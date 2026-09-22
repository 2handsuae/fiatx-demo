// admin-web/src/pages/InternalTransferDetail.tsx
// 平账二期：划转单详情——来源（案号 / 认损单或账单行参考号）、客户、金额、状态、审批单回链、资金单腿卡片（法币两腿）、待批时金库可撤回。
// 铁律⑥：后端投影已无任何 UUID，本页类型里也不出现。
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { DetailCard, DetailPageHeader, InfoField } from '../components/compliance/DetailPageComponents';
import { SidebarGroup, SidebarKV } from '../components/ui/SidebarPrimitives';
import { StatusPill } from '../components/ui/StatusPill';
import { adminButtonClass } from '../components/common/adminButtonStyles';
import { AdminSessionError, adminFetch, getApiErrorMessage } from '../utils/adminFetch';
import { useAdminSession } from '../contexts/AdminSessionContext';
import { PERMISSIONS } from '../rbac/permissions';
import {
  INTERNAL_TRANSFER_PURPOSE_LABEL,
  INTERNAL_TRANSFER_STATUS_LABEL,
} from '../utils/internalTransferStatusMap';

interface Leg {
  fundsOrderNo: string;
  legSeq: number;
  status: string;
  fromWalletNo: string | null;
  toWalletNo: string | null;
  externalRef: string | null;
}

interface Detail {
  transferNo: string;
  purpose: string;
  status: string;
  customerNo: string;
  assetCode: string;
  currency: string;
  decimals: number;
  amount: string;
  reason: string;
  sourceCaseNo: string;
  sourceAdjustmentNo: string | null;
  sourceExternalRef: string | null;
  approvalNo: string | null;
  failureReasonCode: string | null;
  failureNote: string | null;
  fromWalletNo: string | null;
  viaWalletNo: string | null;
  toWalletNo: string | null;
  createdBy: string;
  createdAt: string;
  executedAt: string | null;
  settledAt: string | null;
  legs: Leg[];
}

const InternalTransferDetail = () => {
  const { transferNo } = useParams<{ transferNo: string }>();
  const navigate = useNavigate();
  const { hasPermission } = useAdminSession();
  const canCancel = hasPermission(PERMISSIONS.INTERNAL_TRANSFER_CANCEL);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState(false);

  const fetchDetail = async () => {
    if (!transferNo) return;
    setLoading(true);
    try {
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/internal-transfers/${encodeURIComponent(transferNo)}`,
      );
      if (res.ok) setDetail((await res.json()) as Detail);
      else {
        alert(await getApiErrorMessage(res, 'Failed to load internal transfer'));
        navigate('/admin/custody/internal-transfers');
      }
    } catch (e) {
      if (e instanceof AdminSessionError) return;
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (transferNo) void fetchDetail();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transferNo]);

  const cancel = async () => {
    if (!detail) return;
    const reason = window.prompt('Withdrawal reason (required)');
    if (!reason?.trim()) return;
    setCancelling(true);
    try {
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/internal-transfers/${encodeURIComponent(detail.transferNo)}/cancel`,
        { method: 'POST', body: JSON.stringify({ reason: reason.trim() }) },
      );
      if (!res.ok) {
        alert(await getApiErrorMessage(res, 'Withdrawal failed'));
        return;
      }
      await fetchDetail();
    } catch (e) {
      if (e instanceof AdminSessionError) return;
      console.error(e);
    } finally {
      setCancelling(false);
    }
  };

  if (loading && !detail)
    return (
      <div className="flex min-h-[400px] flex-col items-center justify-center">
        <RefreshCw className="mb-4 animate-spin text-adm-amber" size={32} />
        <p className="text-adm-t3">Loading internal transfer...</p>
      </div>
    );
  if (!detail) return null;
  const route = detail.viaWalletNo
    ? `${detail.fromWalletNo} → ${detail.viaWalletNo} → ${detail.toWalletNo}`
    : `${detail.fromWalletNo} → ${detail.toWalletNo}`;

  return (
    <div className="flex h-full flex-col">
      <DetailPageHeader
        title="Internal Transfer"
        subtitle={detail.transferNo}
        onBack={() => navigate('/admin/custody/internal-transfers')}
        onRefresh={() => void fetchDetail()}
        refreshing={loading}
        backLabel="Internal Transfers"
      >
        <StatusPill value={detail.status} size="md" />
        {detail.status === 'PENDING_APPROVAL' && canCancel && (
          <button
            type="button"
            disabled={cancelling}
            onClick={() => void cancel()}
            className={adminButtonClass('detailUtility')}
          >
            Cancel
          </button>
        )}
      </DetailPageHeader>

      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 space-y-4 overflow-y-auto p-6">
          <DetailCard title="Transfer" columns={3}>
            <InfoField
              label="Purpose"
              value={INTERNAL_TRANSFER_PURPOSE_LABEL[detail.purpose] ?? detail.purpose}
            />
            <InfoField label="Customer" value={detail.customerNo} mono />
            <InfoField label="Amount" value={`${detail.amount} ${detail.currency}`} mono accent />
            <InfoField label="Route" value={route} mono />
            <InfoField
              label="Status"
              value={INTERNAL_TRANSFER_STATUS_LABEL[detail.status] ?? detail.status}
            />
            <InfoField label="Reason" value={detail.reason} />
            {detail.failureNote && (
              <InfoField
                label="Failure"
                value={`${detail.failureReasonCode ?? ''} ${detail.failureNote}`}
                highlight
              />
            )}
          </DetailCard>

          <DetailCard title="Source" columns={3}>
            <InfoField
              label="Recon Case"
              value={detail.sourceCaseNo}
              mono
              link={`/admin/reconciliation/cases/${encodeURIComponent(detail.sourceCaseNo)}`}
            />
            {detail.sourceAdjustmentNo && (
              <InfoField
                label="Loss-Recognition Adjustment"
                value={detail.sourceAdjustmentNo}
                mono
                link={`/admin/reconciliation/adjustments/${encodeURIComponent(detail.sourceAdjustmentNo)}`}
              />
            )}
            {detail.sourceExternalRef && (
              <InfoField label="Return Statement Line Ref" value={detail.sourceExternalRef} mono />
            )}
            <InfoField
              label="Approval"
              value={detail.approvalNo}
              mono
              link={
                detail.approvalNo
                  ? `/admin/governance/approvals/${encodeURIComponent(detail.approvalNo)}`
                  : undefined
              }
            />
          </DetailCard>

          <DetailCard title="Funds Order Legs (⚡ advance from the Funds Order page)" columns={1}>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-adm-t3">
                  {['Leg', 'Funds Order', 'From → To', 'Status', 'Reference'].map((h) => (
                    <th key={h} className="px-2 py-1 font-mono text-[10px]">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {detail.legs.map((l) => (
                  <tr key={l.fundsOrderNo} className="border-t border-adm-border/60">
                    <td className="px-2 py-1 font-mono">{l.legSeq}</td>
                    <td className="px-2 py-1 font-mono">
                      <Link
                        to={`/admin/funds-orders/${encodeURIComponent(l.fundsOrderNo)}`}
                        className="text-adm-blue hover:underline"
                      >
                        {l.fundsOrderNo}
                      </Link>
                    </td>
                    <td className="px-2 py-1 font-mono">
                      {l.fromWalletNo ?? '—'} → {l.toWalletNo ?? '—'}
                    </td>
                    <td className="px-2 py-1">
                      <StatusPill value={l.status} />
                    </td>
                    <td className="px-2 py-1 font-mono text-adm-t3">{l.externalRef ?? '—'}</td>
                  </tr>
                ))}
                {detail.legs.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-2 py-3 text-adm-t3">
                      The first leg is created once approved
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </DetailCard>
        </div>

        <aside className="w-[272px] min-w-[272px] overflow-y-auto border-l border-adm-border bg-adm-panel px-4">
          <SidebarGroup title="Lifecycle">
            <SidebarKV
              label="Created"
              value={`${detail.createdBy} · ${new Date(detail.createdAt).toLocaleString()}`}
            />
            <SidebarKV
              label="Executed"
              value={detail.executedAt ? new Date(detail.executedAt).toLocaleString() : '—'}
            />
            <SidebarKV
              label="Settled"
              value={detail.settledAt ? new Date(detail.settledAt).toLocaleString() : '—'}
            />
          </SidebarGroup>
        </aside>
      </div>
    </div>
  );
};

export default InternalTransferDetail;
