// admin-web/src/pages/LpExchangeDetail.tsx
// 战役乙波一 Task 8：LP 兑换单详情——Sell→Buy 金额卡 + 档案卡 + 八态时间线 +
// 资金单腿区 + 动作区（状态×持码）。模板：InternalTransferDetail.tsx（结构/fetch/
// 权限门控写法，腿区形态）+ LpProfileDetail.tsx（同域头部动作按钮写法）。
// 铁律⑥：后端投影已无 UUID，本页类型里也不出现。
//
// 验收弹层的 Received 数——LpExchangeView.legs 投影没有 amount 字段（只投 fundsOrderNo/
// legSeq/status/wallet/externalRef），不新开后端字段：验收弹层打开时按需另拉一次腿 2 自己的
// 资金单详情（/admin/funds-orders/:fundsOrderNo，本页「资金单腿区」本就链到它），读它的
// amount 字段——纯前端组合已有端点，不碰已冻结的 T4/T6 后端投影。
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowRight, RefreshCw } from 'lucide-react';
import { DetailCard, DetailPageHeader, InfoField } from '../components/compliance/DetailPageComponents';
import { SidebarGroup, SidebarKV } from '../components/ui/SidebarPrimitives';
import { StatusPill } from '../components/ui/StatusPill';
import { ViewAuditTrailButton } from '../components/common/ViewAuditTrailButton';
import { adminButtonClass } from '../components/common/adminButtonStyles';
import { AdminSessionError, adminFetch, getApiErrorMessage } from '../utils/adminFetch';
import { useAdminSession } from '../contexts/AdminSessionContext';
import { PERMISSIONS } from '../rbac/permissions';
import { useSimulationMode } from '../utils/simulationMode';
import { formatAssetAmount } from '../utils/number-format';

interface Leg {
  fundsOrderNo: string;
  legSeq: number;
  status: string;
  fromWalletNo: string | null;
  toWalletNo: string | null;
  externalRef: string | null;
}

interface Detail {
  exchangeNo: string;
  lpNo: string;
  status: string;
  sellAssetCode: string;
  sellCurrency: string;
  sellAmount: string;
  buyAssetCode: string;
  buyCurrency: string;
  buyAmount: string;
  prudentialPurpose: string;
  reason: string;
  approvalNo: string | null;
  failureReasonCode: string | null;
  failureNote: string | null;
  createdBy: string;
  createdAt: string;
  executedAt: string | null;
  deliveredAt: string | null;
  settledAt: string | null;
  legs: Leg[];
}

interface LpProfile {
  lpNo: string;
  name: string;
}

/* ── 八态人话时间线 ─────────────────────────────────────────────
   正向 5 态（PENDING_APPROVAL→EXECUTING→AWAITING_DELIVERY→DELIVERED→SUCCESS）走完
   即高亮到当前态;3 个终态负向分支（FAILED/REJECTED/CANCELLED）互斥、只会出现一个——
   用 executedAt 是否已盖章判断分支前走到了哪一步（EXECUTING 是唯一在正向路径上
   会盖 executedAt 的中间态；AWAITING_DELIVERY/DELIVERED 之后才失败在这三态机型下
   不会发生——迁移表 AWAITING_DELIVERY 只出 DELIVERED，DELIVERED 只出 SUCCESS，
   零 FAILED 出边）。 */
const STAGES: Array<{ key: string; label: string }> = [
  { key: 'PENDING_APPROVAL', label: 'Pending approval' },
  { key: 'EXECUTING', label: 'Paying out (sell leg)' },
  { key: 'AWAITING_DELIVERY', label: 'Awaiting LP delivery' },
  { key: 'DELIVERED', label: 'Delivered — pending acceptance' },
  { key: 'SUCCESS', label: 'Completed' },
];

const TERMINAL_LABEL: Record<string, string> = {
  FAILED: 'Failed',
  REJECTED: 'Rejected',
  CANCELLED: 'Cancelled',
};

const stampFor = (detail: Detail, key: string): string | null => {
  if (key === 'PENDING_APPROVAL') return detail.createdAt;
  if (key === 'EXECUTING') return detail.executedAt;
  if (key === 'DELIVERED') return detail.deliveredAt;
  if (key === 'SUCCESS') return detail.settledAt;
  return null;
};

const LpExchangeTimeline = ({ detail }: { detail: Detail }) => {
  const isTerminalNegative = detail.status in TERMINAL_LABEL;
  const reachedIdx = isTerminalNegative
    ? (detail.executedAt ? 1 : 0)
    : STAGES.findIndex((s) => s.key === detail.status);
  const visibleStages = isTerminalNegative ? STAGES.slice(0, reachedIdx + 1) : STAGES;

  return (
    <div className="flex flex-col gap-3">
      {visibleStages.map((s, idx) => {
        const done = isTerminalNegative ? true : idx < reachedIdx;
        const current = isTerminalNegative ? false : idx === reachedIdx;
        const ts = stampFor(detail, s.key);
        return (
          <div key={s.key} className="flex items-center gap-3">
            <span
              className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                done ? 'bg-adm-green' : current ? 'bg-adm-amber' : 'bg-adm-border'
              }`}
            />
            <span
              className={`font-mono text-[11px] ${
                current ? 'font-semibold text-adm-t1' : done ? 'text-adm-t2' : 'text-adm-t3'
              }`}
            >
              {s.label}
            </span>
            {ts && <span className="font-mono text-[10px] text-adm-t3">{new Date(ts).toLocaleString()}</span>}
          </div>
        );
      })}
      {isTerminalNegative && (
        <div className="flex items-center gap-3">
          <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-adm-red" />
          <span className="font-mono text-[11px] font-semibold text-adm-red">{TERMINAL_LABEL[detail.status]}</span>
          {detail.failureNote && <span className="text-[11px] text-adm-t3">— {detail.failureNote}</span>}
        </div>
      )}
    </div>
  );
};

/* ── 验收弹层：Expected(=buyAmount) vs Received(=腿 2 自己的资金单 amount) 并排 ── */
const AcceptDeliveryModal = ({
  open,
  detail,
  onClose,
  onAccepted,
}: {
  open: boolean;
  detail: Detail | null;
  onClose: () => void;
  onAccepted: () => void;
}) => {
  const [received, setReceived] = useState<string | null>(null);
  const [receivedAsset, setReceivedAsset] = useState<string | null>(null);
  const [loadingLeg, setLoadingLeg] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open || !detail) return;
    setError('');
    setReceived(null);
    setReceivedAsset(null);
    const leg2 = detail.legs.find((l) => l.legSeq === 2);
    if (!leg2) return;
    setLoadingLeg(true);
    void (async () => {
      try {
        const res = await adminFetch(
          `${import.meta.env.VITE_API_URL}/admin/funds-orders/${encodeURIComponent(leg2.fundsOrderNo)}`,
        );
        if (res.ok) {
          const data = await res.json();
          setReceived(formatAssetAmount(data.amount, data.asset?.decimals));
          setReceivedAsset(data.asset?.code ?? data.asset?.currency ?? null);
        }
      } catch (e) {
        if (e instanceof AdminSessionError) return;
        console.error(e);
      } finally {
        setLoadingLeg(false);
      }
    })();
  }, [open, detail]);

  if (!open || !detail) return null;

  const submit = async () => {
    setSubmitting(true);
    setError('');
    try {
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/lp-exchanges/${encodeURIComponent(detail.exchangeNo)}/accept`,
        { method: 'POST' },
      );
      if (!res.ok) { setError(await getApiErrorMessage(res, 'Failed to accept the delivery')); return; }
      onAccepted();
    } catch (e) {
      if (e instanceof AdminSessionError) return;
      setError(e instanceof Error ? e.message : 'Failed to accept the delivery');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="w-[480px] rounded-lg border border-adm-border bg-adm-panel p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-1 text-sm font-semibold text-adm-t1">Accept LP Delivery</h3>
        <p className="mb-3 font-mono text-[10px] text-adm-t3">{detail.exchangeNo} · {detail.lpNo}</p>

        <div className="mb-4 grid grid-cols-2 gap-3">
          <div className="rounded border border-adm-border bg-adm-bg p-3 text-center">
            <div className="font-mono text-[9px] uppercase text-adm-t3">Expected</div>
            <div className="mt-1 font-mono text-lg font-semibold text-adm-t1">
              {detail.buyAmount} {detail.buyAssetCode}
            </div>
          </div>
          <div className="rounded border border-adm-border bg-adm-bg p-3 text-center">
            <div className="font-mono text-[9px] uppercase text-adm-t3">Received</div>
            <div className="mt-1 font-mono text-lg font-semibold text-adm-t1">
              {loadingLeg ? '…' : received != null ? `${received} ${receivedAsset ?? detail.buyAssetCode}` : '—'}
            </div>
          </div>
        </div>

        <p className="mb-3 font-mono text-[10px] text-adm-t3">
          Confirming transfers the buy leg from the front desk (F_LIQ) to the operating account (F_OPS).
        </p>

        {error && <p className="mb-2 text-xs text-adm-red">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={adminButtonClass('modalCancel')}>Cancel</button>
          <button type="button" disabled={submitting} onClick={() => void submit()} className={adminButtonClass('modalConfirm')}>
            {submitting ? 'Accepting…' : 'Accept delivery'}
          </button>
        </div>
      </div>
    </div>
  );
};

const LpExchangeDetail = () => {
  const { exchangeNo } = useParams<{ exchangeNo: string }>();
  const navigate = useNavigate();
  const { hasPermission } = useAdminSession();
  const { enabled: simEnabled } = useSimulationMode();
  const canCancel = hasPermission(PERMISSIONS.LP_EXCHANGE_CANCEL);
  const canSimulateDelivery = hasPermission(PERMISSIONS.LP_EXCHANGE_SIMULATE_DELIVERY);
  const canAccept = hasPermission(PERMISSIONS.LP_EXCHANGE_ACCEPT);

  const [detail, setDetail] = useState<Detail | null>(null);
  const [lpProfile, setLpProfile] = useState<LpProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [showAcceptModal, setShowAcceptModal] = useState(false);
  const [notice, setNotice] = useState<{ text: string; approvalNo?: string } | null>(null);

  const fetchDetail = async () => {
    if (!exchangeNo) return;
    setLoading(true);
    try {
      const res = await adminFetch(`${import.meta.env.VITE_API_URL}/admin/lp-exchanges/${encodeURIComponent(exchangeNo)}`);
      if (!res.ok) {
        alert(await getApiErrorMessage(res, 'Failed to load LP exchange'));
        navigate('/admin/lp-exchanges');
        return;
      }
      const data = (await res.json()) as Detail;
      setDetail(data);
      const profileRes = await adminFetch(`${import.meta.env.VITE_API_URL}/admin/lp-profiles/${encodeURIComponent(data.lpNo)}`);
      if (profileRes.ok) setLpProfile((await profileRes.json()) as LpProfile);
    } catch (e) {
      if (e instanceof AdminSessionError) return;
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (exchangeNo) void fetchDetail();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exchangeNo]);

  useEffect(() => {
    if (!notice) return undefined;
    const t = window.setTimeout(() => setNotice((c) => (c === notice ? null : c)), 8000);
    return () => window.clearTimeout(t);
  }, [notice]);

  const cancel = async () => {
    if (!detail) return;
    const reason = window.prompt('Cancellation reason (required)');
    if (!reason?.trim()) return;
    setWorking(true);
    try {
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/lp-exchanges/${encodeURIComponent(detail.exchangeNo)}/cancel`,
        { method: 'POST', body: JSON.stringify({ reason: reason.trim() }) },
      );
      if (!res.ok) { alert(await getApiErrorMessage(res, 'Failed to cancel the LP exchange')); return; }
      await fetchDetail();
    } catch (e) {
      if (e instanceof AdminSessionError) return;
      console.error(e);
    } finally {
      setWorking(false);
    }
  };

  const simulateDelivery = async () => {
    if (!detail) return;
    setWorking(true);
    try {
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/lp-exchanges/${encodeURIComponent(detail.exchangeNo)}/simulate-delivery`,
        { method: 'POST' },
      );
      if (!res.ok) { alert(await getApiErrorMessage(res, 'Failed to simulate the LP delivery')); return; }
      await fetchDetail();
    } catch (e) {
      if (e instanceof AdminSessionError) return;
      console.error(e);
    } finally {
      setWorking(false);
    }
  };

  if (loading && !detail)
    return (
      <div className="flex min-h-[400px] flex-col items-center justify-center">
        <RefreshCw className="mb-4 animate-spin text-adm-amber" size={32} />
        <p className="text-adm-t3">Loading LP exchange...</p>
      </div>
    );
  if (!detail) return null;

  return (
    <div className="flex h-full flex-col">
      <DetailPageHeader
        title="LP Exchange"
        subtitle={detail.exchangeNo}
        onBack={() => navigate('/admin/lp-exchanges')}
        onRefresh={() => void fetchDetail()}
        refreshing={loading}
        backLabel="LP Exchanges"
      >
        <StatusPill value={detail.status} size="md" />
        <ViewAuditTrailButton params={{ subjectNo: detail.exchangeNo }} />
        {detail.status === 'PENDING_APPROVAL' && canCancel && (
          <button type="button" disabled={working} onClick={() => void cancel()} className={adminButtonClass('workflowNegative')}>
            Cancel
          </button>
        )}
        {detail.status === 'AWAITING_DELIVERY' && canSimulateDelivery && simEnabled && (
          <button type="button" disabled={working} onClick={() => void simulateDelivery()} className={adminButtonClass('simulationAction')}>
            {working ? 'Working…' : '⚡ Simulate LP delivery'}
          </button>
        )}
        {detail.status === 'DELIVERED' && canAccept && (
          <button type="button" disabled={working} onClick={() => setShowAcceptModal(true)} className={adminButtonClass('workflowPrimary')}>
            Accept delivery
          </button>
        )}
      </DetailPageHeader>

      {notice && (
        <div className="border-b border-adm-border bg-adm-amber/10 px-5 py-2 font-mono text-[11px] text-adm-amber">
          {notice.text}
        </div>
      )}

      {detail.status === 'PENDING_APPROVAL' && (
        <div className="border-b border-adm-border bg-adm-amber/10 px-5 py-2 font-mono text-[11px] text-adm-amber">
          Pending CFO review — read-only until decided.
        </div>
      )}

      {detail.status === 'AWAITING_DELIVERY' && (
        <div className="border-b border-adm-border bg-adm-blue/10 px-5 py-2 font-mono text-[11px] text-adm-blue">
          Sell leg cleared, waiting for the LP to deliver the buy leg to the front desk — the firm's {detail.sellAssetCode} operating balance has already decreased.
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 space-y-4 overflow-y-auto p-6">
          <DetailCard title="Sell → Buy" columns={1}>
            <div className="flex items-center justify-center gap-6 py-4">
              <div className="text-center">
                <div className="font-mono text-[9px] uppercase tracking-[0.1em] text-adm-t3">Sell</div>
                <div className="mt-1 font-mono text-2xl font-bold text-adm-red">
                  {detail.sellAmount} <span className="text-base">{detail.sellAssetCode}</span>
                </div>
              </div>
              <ArrowRight className="text-adm-t3" size={28} />
              <div className="text-center">
                <div className="font-mono text-[9px] uppercase tracking-[0.1em] text-adm-t3">Buy</div>
                <div className="mt-1 font-mono text-2xl font-bold text-adm-green">
                  {detail.buyAmount} <span className="text-base">{detail.buyAssetCode}</span>
                </div>
              </div>
            </div>
          </DetailCard>

          <DetailCard title="Liquidity Provider" columns={2}>
            <InfoField
              label="LP"
              value={lpProfile ? `${lpProfile.lpNo} · ${lpProfile.name}` : detail.lpNo}
              mono
              link={`/admin/lp-profiles/${encodeURIComponent(detail.lpNo)}`}
            />
            <InfoField label="Prudential Purpose" value={detail.prudentialPurpose} />
            <InfoField label="Reason" value={detail.reason} />
            <InfoField
              label="Approval"
              value={detail.approvalNo}
              mono
              link={detail.approvalNo ? `/admin/governance/approvals/${encodeURIComponent(detail.approvalNo)}` : undefined}
            />
            {detail.failureNote && (
              <InfoField label="Failure" value={`${detail.failureReasonCode ?? ''} ${detail.failureNote}`} highlight />
            )}
          </DetailCard>

          <DetailCard title="Status Timeline" columns={1}>
            <LpExchangeTimeline detail={detail} />
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
                      The sell leg is created once approved
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </DetailCard>
        </div>

        <aside className="w-[272px] min-w-[272px] overflow-y-auto border-l border-adm-border bg-adm-panel px-4">
          <SidebarGroup title="Lifecycle">
            <SidebarKV label="Created" value={`${detail.createdBy} · ${new Date(detail.createdAt).toLocaleString()}`} />
            <SidebarKV label="Executed" value={detail.executedAt ? new Date(detail.executedAt).toLocaleString() : '—'} />
            <SidebarKV label="Delivered" value={detail.deliveredAt ? new Date(detail.deliveredAt).toLocaleString() : '—'} />
            <SidebarKV label="Settled" value={detail.settledAt ? new Date(detail.settledAt).toLocaleString() : '—'} />
          </SidebarGroup>
        </aside>
      </div>

      <AcceptDeliveryModal
        open={showAcceptModal}
        detail={detail}
        onClose={() => setShowAcceptModal(false)}
        onAccepted={() => {
          setShowAcceptModal(false);
          setNotice({ text: 'Delivery accepted — buy leg transferred to the operating account.' });
          void fetchDetail();
        }}
      />
    </div>
  );
};

export default LpExchangeDetail;
