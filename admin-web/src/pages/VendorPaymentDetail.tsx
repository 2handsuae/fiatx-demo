// admin-web/src/pages/VendorPaymentDetail.tsx
// 战役乙波二 Task 7：付款单详情——金额卡 + 收款方卡 + 六态时间线 + 资金单腿区 +
// 动作区（状态×持码）。模板：CapitalInjectionDetail.tsx（结构/fetch/权限门控写法，
// Treasury 域最近先例）+ LpExchangeDetail.tsx（FAILED 双分支起点的 executedAt 判支法，
// 「Funds Order Legs」腿区表格照抄——本域腿区同样只展示/跳转，不在本页放推单按钮）。
// 铁律⑥：投影里没有任何 id / assetId / walletId / vendorId。
//
// 六态（VENDOR_PAYMENT_TRANSITIONS）：PENDING_APPROVAL → {EXECUTING, FAILED, REJECTED,
// CANCELLED}；EXECUTING → {SUCCESS, FAILED}。FAILED 有两个分支起点——批准时运营户余额
// 不足直接 PENDING_APPROVAL→FAILED（零资金单，executedAt 未盖章）；或腿落账失败
// EXECUTING→FAILED（executedAt 已盖章）。REJECTED/CANCELLED 只从 PENDING_APPROVAL 分出。
// 用 executedAt 是否已盖章判支（同 LpExchangeDetail 先例）：FAILED 时 reachedIdx =
// executedAt ? 1 : 0；REJECTED/CANCELLED 恒 reachedIdx = 0（唯一出边来自 PENDING_APPROVAL）。
//
// 本族无 simulate-contribution/confirm 端点（同 T5 头注释）：EXECUTING 上⚡推出款确认
// （回单先于落账）落 SUCCESS 全在资金单页驱动，付款详情页不设推单按钮，只展示腿+跳转。
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

interface Leg {
  fundsOrderNo: string;
  legSeq: number;
  status: string;
  fromWalletNo: string | null;
  toWalletNo: string | null;
  externalRef: string | null;
}

interface Detail {
  payNo: string;
  vendorNo: string;
  vendorName: string;
  payeeAccountRef: string;
  assetCode: string;
  currency: string;
  amount: string;
  purposeNote: string;
  prudentialPurpose: string;
  reason: string;
  status: string;
  approvalNo: string | null;
  failureReasonCode: string | null;
  failureNote: string | null;
  createdBy: string;
  createdAt: string;
  executedAt: string | null;
  settledAt: string | null;
  legs: Leg[];
}

/* ── 六态人话时间线 ─────────────────────────────────────────────
   正向 3 态（PENDING_APPROVAL→EXECUTING→SUCCESS）走完即高亮到当前态；FAILED/REJECTED/
   CANCELLED 三个终态负向分支互斥、只会出现一个。REJECTED/CANCELLED 唯一出边来自
   PENDING_APPROVAL，reachedIdx 恒为 0；FAILED 有两个分支起点，用 executedAt 是否已
   盖章判支（同 LpExchangeDetail 先例）。 */
const STAGES: Array<{ key: string; label: string }> = [
  { key: 'PENDING_APPROVAL', label: 'Pending approval' },
  { key: 'EXECUTING', label: 'Paying out' },
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
  if (key === 'SUCCESS') return detail.settledAt;
  return null;
};

const VendorPaymentTimeline = ({ detail }: { detail: Detail }) => {
  const isTerminalNegative = detail.status in TERMINAL_LABEL;
  const reachedIdx = isTerminalNegative
    ? (detail.status === 'FAILED' && detail.executedAt ? 1 : 0)
    : STAGES.findIndex((s) => s.key === detail.status);
  const visibleStages = isTerminalNegative ? STAGES.slice(0, reachedIdx + 1) : STAGES;

  return (
    <div className="flex flex-col gap-3">
      {visibleStages.map((s, idx) => {
        // SUCCESS 终态：末格（idx === reachedIdx）也判 done，不留 current 高亮——
        // FAILED/REJECTED/CANCELLED 走 isTerminalNegative 分支，不受此判影响。
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
          {detail.failureNote && <span className="text-[11px] text-adm-t3">— {detail.failureNote}</span>}
        </div>
      )}
    </div>
  );
};

const VendorPaymentDetail = () => {
  const { payNo } = useParams<{ payNo: string }>();
  const navigate = useNavigate();
  const { hasPermission } = useAdminSession();
  const canCancel = hasPermission(PERMISSIONS.VENDOR_PAYMENT_CANCEL);
  // 跨域回链持码门控（同 FundsOrderDetail.tsx parentLinkAllowed 先例）：金库/CFO 看文本，
  // 内审/合规官（持 COMPLIANCE_OFFICE_VIEW）点得动外包商登记册。评审 Imp#1 逮回：
  // /admin/outsourcing-vendors/:vendorNo 这条路由在 admin-web 里不存在，App.tsx 的
  // catch-all 会把持码用户静默弹回首页——业主拍板禁止的「点得到、点了落空」。真实落点是
  // ComplianceRegistersPage.tsx（挂在 /admin/governance/compliance-office/registers，
  // 同样由 COMPLIANCE_OFFICE_VIEW 把门，甲波四交付），vendors 是它的默认 tab，不带查询参数
  // 就落在外包商登记册——该页无按 vendorNo 过滤/深链的查询参数，故不传参（没有的功能不能造）。
  const canViewVendorProfile = hasPermission(PERMISSIONS.COMPLIANCE_OFFICE_VIEW);

  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [notice, setNotice] = useState<{ text: string } | null>(null);

  const fetchDetail = async () => {
    if (!payNo) return;
    setLoading(true);
    try {
      const res = await adminFetch(`${import.meta.env.VITE_API_URL}/admin/vendor-payments/${encodeURIComponent(payNo)}`);
      if (!res.ok) {
        alert(await getApiErrorMessage(res, 'Failed to load vendor payment'));
        navigate('/admin/vendor-payments');
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
    if (payNo) void fetchDetail();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payNo]);

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
        `${import.meta.env.VITE_API_URL}/admin/vendor-payments/${encodeURIComponent(detail.payNo)}/cancel`,
        { method: 'POST', body: JSON.stringify({ reason: reason.trim() }) },
      );
      if (!res.ok) { alert(await getApiErrorMessage(res, 'Failed to cancel the vendor payment')); return; }
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
        <p className="text-adm-t3">Loading vendor payment...</p>
      </div>
    );
  if (!detail) return null;

  return (
    <div className="flex h-full flex-col">
      <DetailPageHeader
        title="Vendor Payment"
        subtitle={detail.payNo}
        onBack={() => navigate('/admin/vendor-payments')}
        onRefresh={() => void fetchDetail()}
        refreshing={loading}
        backLabel="Vendor Payments"
      >
        <StatusPill value={detail.status} size="md" />
        <ViewAuditTrailButton params={{ subjectNo: detail.payNo }} />
        {detail.status === 'PENDING_APPROVAL' && canCancel && (
          <button type="button" disabled={working} onClick={() => void cancel()} className={adminButtonClass('workflowNegative')}>
            Cancel
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

      {detail.status === 'EXECUTING' && (
        <div className="border-b border-adm-border bg-adm-blue/10 px-5 py-2 font-mono text-[11px] text-adm-blue">
          Approved, the payout leg is in flight — advance it from the funds order page (⚡).
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 space-y-4 overflow-y-auto p-6">
          <DetailCard title="Amount" columns={1}>
            <div className="flex items-center justify-center py-4">
              <div className="text-center">
                <div className="font-mono text-[9px] uppercase tracking-[0.1em] text-adm-t3">Payment</div>
                <div className="mt-1 font-mono text-2xl font-bold text-adm-red">
                  {detail.amount} <span className="text-base">{detail.assetCode}</span>
                </div>
              </div>
            </div>
          </DetailCard>

          <DetailCard title="Payee" columns={2}>
            <InfoField
              label="Vendor"
              value={`${detail.vendorNo} · ${detail.vendorName}`}
              mono
              link={canViewVendorProfile ? '/admin/governance/compliance-office/registers' : undefined}
            />
            <InfoField label="Payee Account Reference" value={detail.payeeAccountRef} mono />
            <InfoField label="Purpose" value={detail.purposeNote} />
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
            <VendorPaymentTimeline detail={detail} />
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
                      The payout leg is created once the payment is approved
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
            <SidebarKV label="Executing" value={detail.executedAt ? new Date(detail.executedAt).toLocaleString() : '—'} />
            <SidebarKV label="Settled" value={detail.settledAt ? new Date(detail.settledAt).toLocaleString() : '—'} />
          </SidebarGroup>
        </aside>
      </div>
    </div>
  );
};

export default VendorPaymentDetail;
