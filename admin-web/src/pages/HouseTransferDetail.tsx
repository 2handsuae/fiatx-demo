// admin-web/src/pages/HouseTransferDetail.tsx
// 戊波二 Task 6：公司调拨单详情——路线 + 金额 + 审批 + 唯一一条腿 + 落账两行（码 89 挪钱 / 码 90 扫费结转）。
// 模板：VendorPaymentDetail.tsx / InternalTransferDetail.tsx（结构 / fetch / 权限门控 / 腿区表格，Treasury 域先例）。
// 铁律⑥：投影里没有任何 id / assetId / walletId，钱包只显示 walletNo。
//
// 状态：PENDING_APPROVAL → {EXECUTING, FAILED, REJECTED, CANCELLED}；EXECUTING → {SUCCESS, FAILED}。
// 落账被账本拒（POSTING_FAILED）时单停在 EXECUTING——展示为「Stuck — posting failed」（不是 Failed）并带原因，
// 后端不重试、不补偿（T5）。
//
// 落账两行：投影不带分录金额（只带码 90 的回执 closeTbTransferIds），金额与借贷科目从凭证接口取：
// GET /admin/tb/transfers?q=<transferNo>（凭证按 sourceNo 命中；码 89 的 eventCode = HOUSE_TRANSFER，
// 码 90 的 eventCode = FEE_INCOME_CLOSE_*）。凭证读权是 TB_TRANSFERS_READ，没有就只降级为不带金额的行。
// 本页不设推单按钮：腿的推进走资金单页 ⚡（调拨腿不进推单），落账在腿确认事件里自动收口。
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { DetailCard, DetailPageHeader, InfoField } from '../components/compliance/DetailPageComponents';
import { SidebarGroup, SidebarKV } from '../components/ui/SidebarPrimitives';
import { ViewAuditTrailButton } from '../components/common/ViewAuditTrailButton';
import { StatusPill } from '../components/ui/StatusPill';
import { adminButtonClass } from '../components/common/adminButtonStyles';
import { AdminSessionError, adminFetch, getApiErrorMessage } from '../utils/adminFetch';
import {
  HOUSE_TRANSFER_FAILURE_LABEL,
  HOUSE_TRANSFER_PURPOSE_LABEL,
  houseTransferStatusMeta,
  isFeeSweepRoute,
  isHouseTransferStuck,
} from '../utils/houseTransferStatusMap';
import { formatAmount } from '../utils/reconAmount';
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
  transferNo: string;
  purpose: string;
  assetCode: string;
  currency: string;
  decimals: number;
  amount: string;
  fromWalletNo: string | null;
  fromVaultCode: string | null;
  toWalletNo: string | null;
  toVaultCode: string | null;
  reason: string;
  status: string;
  approvalNo: string | null;
  fundsOrderNo: string | null;
  closeTbTransferIds: string[];
  failureReasonCode: string | null;
  failureNote: string | null;
  createdBy: string;
  createdAt: string;
  executedAt: string | null;
  settledAt: string | null;
  legs: Leg[];
}

/** `GET /admin/tb/transfers` 的凭证行（只取本页要用的列；amount 是最小单位整数串）。 */
interface Voucher {
  tbTransferId: string;
  sourceNo: string;
  eventCode: string;
  debitCode: string;
  creditCode: string;
  amount: string;
  createdAt: string;
}

const MOVE_EVENT_CODE = 'HOUSE_TRANSFER';
const CLOSE_EVENT_PREFIX = 'FEE_INCOME_CLOSE';

/** 凭证号是账本的十六进制转账号，不是业务实体 id；凭证列表页同样截断显示。 */
const shortHex = (hex: string): string => (hex.length > 16 ? `${hex.slice(0, 8)}…${hex.slice(-8)}` : hex);

const HouseTransferDetail = () => {
  const { transferNo } = useParams<{ transferNo: string }>();
  const navigate = useNavigate();
  const { hasPermission } = useAdminSession();
  const canCancel = hasPermission(PERMISSIONS.HOUSE_TRANSFER_CANCEL);
  const canReadVouchers = hasPermission(PERMISSIONS.TB_TRANSFERS_READ);
  const canOpenVoucher = hasPermission(PERMISSIONS.TB_TRANSFER_DETAIL_READ);

  const [detail, setDetail] = useState<Detail | null>(null);
  const [vouchers, setVouchers] = useState<Voucher[]>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);

  const fetchDetail = async () => {
    if (!transferNo) return;
    setLoading(true);
    try {
      const res = await adminFetch(`${import.meta.env.VITE_API_URL}/admin/house-transfers/${encodeURIComponent(transferNo)}`);
      if (!res.ok) {
        alert(await getApiErrorMessage(res, 'Failed to load house transfer'));
        navigate('/admin/house-transfers');
        return;
      }
      const data = (await res.json()) as Detail;
      setDetail(data);
      // 只有腿已确认才可能有落账：EXECUTING（含卡住）与 SUCCESS 才去取凭证。
      if (canReadVouchers && (data.status === 'EXECUTING' || data.status === 'SUCCESS')) {
        const vres = await adminFetch(
          `${import.meta.env.VITE_API_URL}/admin/tb/transfers?q=${encodeURIComponent(data.transferNo)}&take=50`,
        );
        if (vres.ok) {
          const vdata = await vres.json();
          const rows: Voucher[] = Array.isArray(vdata.items) ? vdata.items : [];
          setVouchers(rows.filter((v) => v.sourceNo === data.transferNo));
        } else {
          setVouchers([]);
        }
      } else {
        setVouchers([]);
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
    const reason = window.prompt('Cancellation reason (required)');
    if (!reason?.trim()) return;
    setWorking(true);
    try {
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/house-transfers/${encodeURIComponent(detail.transferNo)}/cancel`,
        { method: 'POST', body: JSON.stringify({ reason: reason.trim() }) },
      );
      if (!res.ok) { alert(await getApiErrorMessage(res, 'Failed to cancel the house transfer')); return; }
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
        <p className="text-adm-t3">Loading house transfer...</p>
      </div>
    );
  if (!detail) return null;

  const meta = houseTransferStatusMeta(detail.status, detail.failureReasonCode);
  const stuck = isHouseTransferStuck(detail.status, detail.failureReasonCode);
  const sweep = isFeeSweepRoute(detail.fromVaultCode, detail.toVaultCode);
  const route = `${detail.fromWalletNo ?? '—'} → ${detail.toWalletNo ?? '—'}`;
  const awaitingPost = detail.status === 'PENDING_APPROVAL' || (detail.status === 'EXECUTING' && !stuck);

  // 落账两行的数据：码 89 取凭证里 HOUSE_TRANSFER 那笔；码 90 以回执 closeTbTransferIds 为准（SUCCESS 才落回执），
  // 卡住时回执为空，退而取凭证里已落的 FEE_INCOME_CLOSE_*（半截状态下也要看得见）。
  const moveVoucher = vouchers.find((v) => v.eventCode === MOVE_EVENT_CODE) ?? null;
  const closeVouchers = vouchers
    .filter((v) => v.eventCode.startsWith(CLOSE_EVENT_PREFIX))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const closeIds = detail.closeTbTransferIds.length > 0 ? detail.closeTbTransferIds : closeVouchers.map((v) => v.tbTransferId);
  const closeLines = closeIds.map((id) => ({ id, voucher: vouchers.find((v) => v.tbTransferId === id) ?? null }));
  const closeTotal = closeLines.length > 0 && closeLines.every((l) => l.voucher)
    ? closeLines.reduce((sum, l) => sum + BigInt(l.voucher!.amount), 0n).toString()
    : null;
  const fmtMinor = (minor: string) => `${formatAmount(minor, detail.decimals)} ${detail.currency}`;

  const voucherLink = (id: string) =>
    canOpenVoucher ? (
      <Link to={`/admin/ledger/transfer-evidence/${encodeURIComponent(id)}`} className="text-adm-blue hover:underline">
        {shortHex(id)}
      </Link>
    ) : (
      <span>{shortHex(id)}</span>
    );

  const pendingText = awaitingPost ? '— posts when the leg is confirmed' : '— not posted';

  return (
    <div className="flex h-full flex-col">
      <DetailPageHeader
        title="House Transfer"
        subtitle={detail.transferNo}
        onBack={() => navigate('/admin/house-transfers')}
        onRefresh={() => void fetchDetail()}
        refreshing={loading}
        backLabel="House Transfers"
      >
        <span className={`inline-flex items-center rounded-full px-3 py-0.5 text-xs font-medium ${meta.badgeClass}`}>{meta.label}</span>
        <ViewAuditTrailButton params={{ subjectNo: detail.transferNo }} />
        {detail.status === 'PENDING_APPROVAL' && canCancel && (
          <button type="button" disabled={working} onClick={() => void cancel()} className={adminButtonClass('workflowNegative')}>
            Cancel
          </button>
        )}
      </DetailPageHeader>

      {detail.status === 'PENDING_APPROVAL' && (
        <div className="border-b border-adm-border bg-adm-amber/10 px-5 py-2 font-mono text-[11px] text-adm-amber">
          Pending CFO review — read-only until decided.
        </div>
      )}

      {detail.status === 'EXECUTING' && !stuck && (
        <div className="border-b border-adm-border bg-adm-blue/10 px-5 py-2 font-mono text-[11px] text-adm-blue">
          Approved, the transfer leg is in flight — advance it from the funds order page (⚡). The ledger entries post when the leg is confirmed.
        </div>
      )}

      {stuck && (
        <div className="border-b border-adm-border bg-adm-red/10 px-5 py-2 font-mono text-[11px] text-adm-red">
          Stuck — posting failed: the leg is confirmed but the ledger rejected the entries. Nothing is retried or compensated automatically — see Failure below.
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 space-y-4 overflow-y-auto p-6">
          <DetailCard title="Transfer" columns={3}>
            <InfoField label="Purpose" value={HOUSE_TRANSFER_PURPOSE_LABEL[detail.purpose] ?? detail.purpose} />
            <InfoField label="Amount" value={`${detail.amount} ${detail.assetCode}`} mono accent />
            <InfoField label="Route (company wallets)" value={route} mono />
            <InfoField label="Status" value={meta.label} />
            <InfoField label="Reason" value={detail.reason} />
            <InfoField
              label="Approval"
              value={detail.approvalNo}
              mono
              link={detail.approvalNo ? `/admin/governance/approvals/${encodeURIComponent(detail.approvalNo)}` : undefined}
            />
            {detail.failureNote && (
              <InfoField
                label="Failure"
                value={`${HOUSE_TRANSFER_FAILURE_LABEL[detail.failureReasonCode ?? ''] ?? detail.failureReasonCode ?? ''} — ${detail.failureNote}`}
                highlight
              />
            )}
          </DetailCard>

          <DetailCard title="Funds Order Leg (⚡ advance from the Funds Order page)" columns={1}>
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
                      <Link to={`/admin/funds-orders/${encodeURIComponent(l.fundsOrderNo)}`} className="text-adm-blue hover:underline">
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
                      The transfer leg is created once the transfer is approved
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </DetailCard>

          <DetailCard title="Ledger Postings (written when the leg is confirmed)" columns={1}>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-adm-t3">
                  {['Posting', 'Entry', 'Amount', 'Voucher'].map((h) => (
                    <th key={h} className="px-2 py-1 font-mono text-[10px]">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr className="border-t border-adm-border/60 align-top">
                  <td className="px-2 py-1.5 font-mono">Move cash (89)</td>
                  {moveVoucher || detail.status === 'SUCCESS' ? (
                    <>
                      <td className="px-2 py-1.5 font-mono">
                        Dr {detail.toWalletNo ?? '—'} cash / Cr {detail.fromWalletNo ?? '—'} cash
                      </td>
                      <td className="px-2 py-1.5 font-mono">{moveVoucher ? fmtMinor(moveVoucher.amount) : `${detail.amount} ${detail.assetCode}`}</td>
                      <td className="px-2 py-1.5 font-mono">{moveVoucher ? voucherLink(moveVoucher.tbTransferId) : '—'}</td>
                    </>
                  ) : (
                    <td colSpan={3} className="px-2 py-1.5 text-adm-t3">{pendingText}</td>
                  )}
                </tr>
                <tr className="border-t border-adm-border/60 align-top">
                  <td className="px-2 py-1.5 font-mono">Close fee income to equity (90)</td>
                  {!sweep ? (
                    <td colSpan={3} className="px-2 py-1.5 text-adm-t3">— not applicable (only a fee wallet → operating wallet sweep closes fee income)</td>
                  ) : closeLines.length > 0 ? (
                    <>
                      <td className="px-2 py-1.5 font-mono">
                        {closeLines.map((l) => (
                          <div key={l.id}>{l.voucher ? `Dr ${l.voucher.debitCode} / Cr ${l.voucher.creditCode}` : 'Dr fee income / Cr firm equity'}</div>
                        ))}
                      </td>
                      <td className="px-2 py-1.5 font-mono">
                        {closeLines.map((l) => (
                          <div key={l.id}>{l.voucher ? fmtMinor(l.voucher.amount) : '—'}</div>
                        ))}
                        {closeLines.length > 1 && closeTotal && (
                          <div className="mt-0.5 border-t border-adm-border/60 pt-0.5 text-adm-t3">Σ {fmtMinor(closeTotal)}</div>
                        )}
                      </td>
                      <td className="px-2 py-1.5 font-mono">
                        {closeLines.map((l) => (
                          <div key={l.id}>{voucherLink(l.id)}</div>
                        ))}
                      </td>
                    </>
                  ) : detail.status === 'SUCCESS' ? (
                    <td colSpan={3} className="px-2 py-1.5 text-adm-t3">— none (no income to close)</td>
                  ) : (
                    <td colSpan={3} className="px-2 py-1.5 text-adm-t3">{pendingText}</td>
                  )}
                </tr>
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

export default HouseTransferDetail;
