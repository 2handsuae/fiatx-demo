// admin-web/src/pages/CapitalInjectionDetail.tsx
// 战役乙波二 Task 6：注资单详情——金额卡 + 出资方卡 + 六态时间线 + 资金单腿区 +
// 动作区（状态×持码）。模板：LpExchangeDetail.tsx（结构/fetch/权限门控/⚡门控写法，
// 验收弹层「Expected vs Received」并排写法照抄）。铁律⑥：投影零 UUID。
//
// 六态（无 FAILED）：PENDING_APPROVAL → AWAITING_FUNDS → RECEIVED → SUCCESS 正向路径；
// REJECTED/CANCELLED 只从 PENDING_APPROVAL 分出（CAPITAL_INJECTION_TRANSITIONS 唯一
// 出边来源）——同 LpExchangeDetail 的终态负向分支写法，但本域只有一个分支起点，
// reachedIdx 恒为 0，不需要 LP 那种「executedAt 是否已盖章」判断。
//
// 确认弹层的 Received 数——CapitalInjectionView.legs 投影没有 amount 字段（只投
// fundsOrderNo/legSeq/status/wallet/externalRef），不新开后端字段：弹层打开时按需
// 另拉一次腿 1 自己的资金单详情（/admin/funds-orders/:fundsOrderNo，本页「资金单腿区」
// 本就链到它），读它的 amount 字段——纯前端组合已有端点，不碰已冻结的 T2/T3 后端投影。
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
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
  cinNo: string;
  contributorName: string;
  status: string;
  assetCode: string;
  currency: string;
  amount: string;
  prudentialPurpose: string;
  reason: string;
  approvalNo: string | null;
  createdBy: string;
  createdAt: string;
  receivedAt: string | null;
  settledAt: string | null;
  legs: Leg[];
}

/* ── 六态人话时间线 ─────────────────────────────────────────────
   正向 4 态（PENDING_APPROVAL→AWAITING_FUNDS→RECEIVED→SUCCESS）走完即高亮到当前态；
   REJECTED/CANCELLED 两个终态负向分支互斥、只会出现一个——CAPITAL_INJECTION_TRANSITIONS
   里两者唯一出边都来自 PENDING_APPROVAL，不像 LP 兑换单那样有第二个分支起点，故
   reachedIdx 恒为 0（Pending approval 是唯一必经、必达的正向格）。 */
const STAGES: Array<{ key: string; label: string }> = [
  { key: 'PENDING_APPROVAL', label: 'Pending approval' },
  { key: 'AWAITING_FUNDS', label: 'Awaiting contributor payment' },
  { key: 'RECEIVED', label: 'Funds received — pending confirmation' },
  { key: 'SUCCESS', label: 'Completed' },
];

const TERMINAL_LABEL: Record<string, string> = {
  REJECTED: 'Rejected',
  CANCELLED: 'Cancelled',
};

const stampFor = (detail: Detail, key: string): string | null => {
  if (key === 'PENDING_APPROVAL') return detail.createdAt;
  if (key === 'RECEIVED') return detail.receivedAt;
  if (key === 'SUCCESS') return detail.settledAt;
  return null;
};

const CapitalInjectionTimeline = ({ detail }: { detail: Detail }) => {
  const isTerminalNegative = detail.status in TERMINAL_LABEL;
  const reachedIdx = isTerminalNegative ? 0 : STAGES.findIndex((s) => s.key === detail.status);
  const visibleStages = isTerminalNegative ? STAGES.slice(0, 1) : STAGES;

  return (
    <div className="flex flex-col gap-3">
      {visibleStages.map((s, idx) => {
        // SUCCESS 终态：末格（idx === reachedIdx）也判 done，不留 current 高亮——
        // REJECTED/CANCELLED 走 isTerminalNegative 分支，不受此判影响。
        const isFinalSuccess = !isTerminalNegative && detail.status === 'SUCCESS' && idx === reachedIdx;
        const done = isTerminalNegative ? true : idx < reachedIdx || isFinalSuccess;
        const current = isTerminalNegative ? false : idx === reachedIdx && !isFinalSuccess;
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
        </div>
      )}
    </div>
  );
};

/* ── 确认弹层：Expected(=amount) vs Received(=腿 1 自己的资金单 amount) 并排 ── */
const ConfirmReceiptModal = ({
  open,
  detail,
  onClose,
  onConfirmed,
}: {
  open: boolean;
  detail: Detail | null;
  onClose: () => void;
  onConfirmed: () => void;
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
    const leg1 = detail.legs.find((l) => l.legSeq === 1);
    if (!leg1) return;
    setLoadingLeg(true);
    void (async () => {
      try {
        const res = await adminFetch(
          `${import.meta.env.VITE_API_URL}/admin/funds-orders/${encodeURIComponent(leg1.fundsOrderNo)}`,
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
        `${import.meta.env.VITE_API_URL}/admin/capital-injections/${encodeURIComponent(detail.cinNo)}/confirm`,
        { method: 'POST' },
      );
      if (!res.ok) { setError(await getApiErrorMessage(res, 'Failed to confirm the contribution')); return; }
      onConfirmed();
    } catch (e) {
      if (e instanceof AdminSessionError) return;
      setError(e instanceof Error ? e.message : 'Failed to confirm the contribution');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="w-[480px] rounded-lg border border-adm-border bg-adm-panel p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-1 text-sm font-semibold text-adm-t1">Confirm Receipt</h3>
        <p className="mb-3 font-mono text-[10px] text-adm-t3">{detail.cinNo} · {detail.contributorName}</p>

        <div className="mb-4 grid grid-cols-2 gap-3">
          <div className="rounded border border-adm-border bg-adm-bg p-3 text-center">
            <div className="font-mono text-[9px] uppercase text-adm-t3">Expected</div>
            <div className="mt-1 font-mono text-lg font-semibold text-adm-t1">
              {formatAssetAmount(detail.amount)} {detail.assetCode}
            </div>
          </div>
          <div className="rounded border border-adm-border bg-adm-bg p-3 text-center">
            <div className="font-mono text-[9px] uppercase text-adm-t3">Received</div>
            <div className="mt-1 font-mono text-lg font-semibold text-adm-t1">
              {loadingLeg ? '…' : received != null ? `${received} ${receivedAsset ?? detail.assetCode}` : '—'}
            </div>
          </div>
        </div>

        <p className="mb-3 font-mono text-[10px] text-adm-t3">
          Confirming posts the entries — the firm's {detail.assetCode} operating balance increases.
        </p>

        {error && <p className="mb-2 text-xs text-adm-red">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={adminButtonClass('modalCancel')}>Cancel</button>
          <button type="button" disabled={submitting} onClick={() => void submit()} className={adminButtonClass('modalConfirm')}>
            {submitting ? 'Confirming…' : 'Confirm receipt'}
          </button>
        </div>
      </div>
    </div>
  );
};

const CapitalInjectionDetail = () => {
  const { cinNo } = useParams<{ cinNo: string }>();
  const navigate = useNavigate();
  const { hasPermission } = useAdminSession();
  const { enabled: simEnabled } = useSimulationMode();
  const canCancel = hasPermission(PERMISSIONS.CAPITAL_INJECTION_CANCEL);
  const canSimulateContribution = hasPermission(PERMISSIONS.CAPITAL_INJECTION_SIMULATE_CONTRIBUTION);
  const canConfirm = hasPermission(PERMISSIONS.CAPITAL_INJECTION_CONFIRM);

  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [notice, setNotice] = useState<{ text: string } | null>(null);

  const fetchDetail = async () => {
    if (!cinNo) return;
    setLoading(true);
    try {
      const res = await adminFetch(`${import.meta.env.VITE_API_URL}/admin/capital-injections/${encodeURIComponent(cinNo)}`);
      if (!res.ok) {
        alert(await getApiErrorMessage(res, 'Failed to load capital injection'));
        navigate('/admin/capital-injections');
        return;
      }
      const data = (await res.json()) as Detail;
      setDetail(data);
    } catch (e) {
      if (e instanceof AdminSessionError) return;
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (cinNo) void fetchDetail();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cinNo]);

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
        `${import.meta.env.VITE_API_URL}/admin/capital-injections/${encodeURIComponent(detail.cinNo)}/cancel`,
        { method: 'POST', body: JSON.stringify({ reason: reason.trim() }) },
      );
      if (!res.ok) { alert(await getApiErrorMessage(res, 'Failed to cancel the capital injection')); return; }
      await fetchDetail();
    } catch (e) {
      if (e instanceof AdminSessionError) return;
      console.error(e);
    } finally {
      setWorking(false);
    }
  };

  const simulateContribution = async () => {
    if (!detail) return;
    setWorking(true);
    try {
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/capital-injections/${encodeURIComponent(detail.cinNo)}/simulate-contribution`,
        { method: 'POST' },
      );
      if (!res.ok) { alert(await getApiErrorMessage(res, 'Failed to simulate the contribution')); return; }
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
        <p className="text-adm-t3">Loading capital injection...</p>
      </div>
    );
  if (!detail) return null;

  return (
    <div className="flex h-full flex-col">
      <DetailPageHeader
        title="Capital Injection"
        subtitle={detail.cinNo}
        onBack={() => navigate('/admin/capital-injections')}
        onRefresh={() => void fetchDetail()}
        refreshing={loading}
        backLabel="Capital Injections"
      >
        <StatusPill value={detail.status} size="md" />
        <ViewAuditTrailButton params={{ subjectNo: detail.cinNo }} />
        {detail.status === 'PENDING_APPROVAL' && canCancel && (
          <button type="button" disabled={working} onClick={() => void cancel()} className={adminButtonClass('workflowNegative')}>
            Cancel
          </button>
        )}
        {detail.status === 'AWAITING_FUNDS' && canSimulateContribution && simEnabled && (
          <button type="button" disabled={working} onClick={() => void simulateContribution()} className={adminButtonClass('simulationAction')}>
            {working ? 'Working…' : '⚡ Simulate contributor payment'}
          </button>
        )}
        {detail.status === 'RECEIVED' && canConfirm && (
          <button type="button" disabled={working} onClick={() => setShowConfirmModal(true)} className={adminButtonClass('workflowPrimary')}>
            Confirm receipt
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

      {detail.status === 'AWAITING_FUNDS' && (
        <div className="border-b border-adm-border bg-adm-blue/10 px-5 py-2 font-mono text-[11px] text-adm-blue">
          Approved, waiting for the contributor to send the funds into the firm's operating account.
        </div>
      )}

      {detail.status === 'RECEIVED' && (
        <div className="border-b border-adm-border bg-adm-blue/10 px-5 py-2 font-mono text-[11px] text-adm-blue">
          Funds have landed in the operating account but are not yet posted — confirm receipt to book the entries.
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 space-y-4 overflow-y-auto p-6">
          <DetailCard title="Amount" columns={1}>
            <div className="flex items-center justify-center py-4">
              <div className="text-center">
                <div className="font-mono text-[9px] uppercase tracking-[0.1em] text-adm-t3">Contribution</div>
                <div className="mt-1 font-mono text-2xl font-bold text-adm-green">
                  {detail.amount} <span className="text-base">{detail.assetCode}</span>
                </div>
              </div>
            </div>
          </DetailCard>

          <DetailCard title="Contributor" columns={2}>
            <InfoField label="Contributor Name" value={detail.contributorName} />
            <InfoField label="Prudential Purpose" value={detail.prudentialPurpose} />
            <InfoField label="Reason" value={detail.reason} />
            <InfoField
              label="Approval"
              value={detail.approvalNo}
              mono
              link={detail.approvalNo ? `/admin/governance/approvals/${encodeURIComponent(detail.approvalNo)}` : undefined}
            />
          </DetailCard>

          <DetailCard title="Status Timeline" columns={1}>
            <CapitalInjectionTimeline detail={detail} />
          </DetailCard>

          <DetailCard title="Funds Order Legs (⚡ advance from this page)" columns={1}>
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
                      The contribution leg is created once the contributor's payment is simulated
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
            <SidebarKV label="Received" value={detail.receivedAt ? new Date(detail.receivedAt).toLocaleString() : '—'} />
            <SidebarKV label="Settled" value={detail.settledAt ? new Date(detail.settledAt).toLocaleString() : '—'} />
          </SidebarGroup>
        </aside>
      </div>

      <ConfirmReceiptModal
        open={showConfirmModal}
        detail={detail}
        onClose={() => setShowConfirmModal(false)}
        onConfirmed={() => {
          setShowConfirmModal(false);
          setNotice({ text: 'Contribution confirmed — entries posted, the operating balance has increased.' });
          void fetchDetail();
        }}
      />
    </div>
  );
};

export default CapitalInjectionDetail;
