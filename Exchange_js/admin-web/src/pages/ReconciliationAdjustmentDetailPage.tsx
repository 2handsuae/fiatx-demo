// admin-web/src/pages/ReconciliationAdjustmentDetailPage.tsx
//
// 平账一期·调账单 Task 7——调账单详情页（brief §Step3）。从案件详情页的
// 「开调账单」流程创建成功后跳转到这里，也可以从案件详情页的「本案调账单」
// 列表点进来。纯展示页：状态、审批单号（可深链审批中心）、成因、方向、
// 两版原因、分录预览（借/贷科目助记码）。一期没有任何写操作（不重开、不撤销
// ——POSTED/REJECTED 是终态，开错了只能再开一张反向单，见 spec §6.3）。
import { useEffect, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { RefreshCw, ExternalLink, ArrowRight } from 'lucide-react';
import {
  DetailPageHeader,
  DetailCard,
  InfoField,
} from '../components/compliance/DetailPageComponents';
import { SidebarGroup, SidebarKV } from '../components/ui/SidebarPrimitives';
import { StatusPill } from '../components/ui/StatusPill';
import { REASON_META } from '../components/ReconciliationAdjustmentCreateModal';
import {
  AdminSessionError,
  adminFetch,
  getApiErrorMessage,
} from '../utils/adminFetch';

/* ── Types ──────────────────────────────────────────────────── */
// 镜像 AdjustmentService.getAdjustment() 的返回体（后端 dto 见
// src/modules/clearing-settle/reconciliation/disposition/adjustment.service.ts）。
// 铁律⑥：五个内部字段（id/ownerId/approvalCaseId/lineItemId/walletRef）后端已经
// 剔除，这里的类型里压根不出现——不给自己留"手滑展示 UUID"的接口面。
interface AdjustmentDetail {
  adjustmentNo: string;
  caseNo: string;
  book: string;               // CLIENT | FIRM
  direction: string;          // REDUCE | INCREASE
  reasonCode: string;
  relatedOrderNo: string | null;
  assetCode: string;
  amount: string;             // 最小单位（分）整数字符串
  effectiveDate: string;
  reasonInternal: string;
  reasonCustomer: string;
  status: string;             // DRAFT | PENDING_APPROVAL | POSTED | REJECTED
  approvalNo: string | null;
  ownerNo: string | null;
  traceId: string | null;
  createdByUserId: string;
  decidedByUserId: string | null;
  postedAt: string | null;
  tbTransferId: string | null;
  createdAt: string;
  updatedAt: string;
  walletNo: string | null;
  decimals: number;
  debitAccountCode: string | null;
  creditAccountCode: string | null;
}

/* ── Helpers ────────────────────────────────────────────────── */
// 同款 分→元 展示缩放（与 ReconciliationCasesDetailPage 的 formatAmount 一致写法，
// 两处各自本地一份——本仓库既有约定，跨页面共享格式化器不是本任务范围）。
const formatAmount = (raw: string | null | undefined, decimals: number): string => {
  const s = String(raw ?? '0');
  let neg = false; let body = s;
  if (body.startsWith('-')) { neg = true; body = body.slice(1); }
  const padded = body.padStart(decimals + 1, '0');
  const intPart = padded.slice(0, padded.length - decimals) || '0';
  const fracPart = decimals > 0 ? padded.slice(padded.length - decimals) : '';
  const intGrouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${neg ? '-' : ''}${intGrouped}${fracPart ? `.${fracPart}` : ''}`;
};

const fmtTime = (v: string | null) => (v ? new Date(v).toLocaleString() : null);

/* ── Page Component ─────────────────────────────────────────── */

const ReconciliationAdjustmentDetailPage = () => {
  const { adjustmentNo } = useParams<{ adjustmentNo: string }>();
  const navigate = useNavigate();
  const [detail, setDetail] = useState<AdjustmentDetail | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchDetail = async () => {
    if (!adjustmentNo) return;
    setLoading(true);
    try {
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/reconciliation/adjustments/${encodeURIComponent(adjustmentNo)}`,
      );
      if (res.ok) {
        setDetail((await res.json()) as AdjustmentDetail);
      } else {
        alert(await getApiErrorMessage(res, 'Failed to load adjustment'));
        navigate('/admin/reconciliation/cases');
      }
    } catch (error) {
      if (error instanceof AdminSessionError) return;
      console.error('Failed to fetch reconciliation adjustment', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (adjustmentNo) void fetchDetail();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adjustmentNo]);

  const openApprovalCenter = () => {
    if (!detail?.approvalNo) return;
    navigate(`/admin/governance/approvals/${detail.approvalNo}`);
  };

  if (loading && !detail) {
    return (
      <div className="flex min-h-[400px] flex-col items-center justify-center">
        <RefreshCw className="mb-4 animate-spin text-adm-amber" size={32} />
        <p className="text-adm-t3">Loading adjustment...</p>
      </div>
    );
  }

  if (!detail) return null;

  const reasonMeta = REASON_META[detail.reasonCode];
  const bookLabel = detail.book === 'CLIENT' ? '客户账簿 / Client' : '公司账簿 / Firm';
  const directionLabel = detail.direction === 'INCREASE' ? '增加 INCREASE' : '减少 REDUCE';

  return (
    <div className="flex h-full flex-col">
      <DetailPageHeader
        onBack={() => navigate(`/admin/reconciliation/cases/${encodeURIComponent(detail.caseNo)}`)}
        onRefresh={fetchDetail}
        refreshing={loading}
        backLabel="Case"
      />

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="flex-1 divide-y divide-adm-border overflow-y-auto">
          {/* Hero */}
          <section className="bg-adm-card p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-[19px] font-bold text-adm-amber">{detail.adjustmentNo}</span>
              <StatusPill value={detail.status} size="md" />
            </div>
            <div className="mt-2 font-mono text-[12px] text-adm-t2">
              案件{' '}
              <Link
                to={`/admin/reconciliation/cases/${encodeURIComponent(detail.caseNo)}`}
                className="text-adm-blue hover:underline"
              >
                {detail.caseNo}
              </Link>
              {' · '}{bookLabel}{' · '}{detail.assetCode}
            </div>
          </section>

          {/* 调账信息 / Adjustment Info */}
          <DetailCard title="调账信息 / Adjustment Info" columns={3}>
            <InfoField label="成因 / Reason" value={reasonMeta ? `${reasonMeta.label} · ${detail.reasonCode}` : detail.reasonCode} />
            <InfoField label="方向 / Direction" value={directionLabel} mono />
            <InfoField label="金额 / Amount" value={`${formatAmount(detail.amount, detail.decimals)} ${detail.assetCode}`} accent />
            <InfoField label="生效日期 / Effective Date" value={detail.effectiveDate} mono />
            <InfoField
              label="关联原单号 / Related Order"
              value={detail.relatedOrderNo ?? '—'}
              mono={!!detail.relatedOrderNo}
            />
            <InfoField label="钱包 / Wallet" value={detail.walletNo ?? '—'} mono />
            <InfoField label="客户 / Customer" value={detail.ownerNo ?? '—（公司账簿）'} />
          </DetailCard>

          {/* 两版原因 / Reasons */}
          <DetailCard title="两版原因 / Reasons" columns={1}>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <div className="font-mono text-[9px] uppercase tracking-[0.1em] text-adm-t3">
                  内部原因 / Internal Reason
                </div>
                <div className="mt-1 whitespace-pre-wrap text-[13px] text-adm-t1">{detail.reasonInternal}</div>
              </div>
              <div>
                <div className="font-mono text-[9px] uppercase tracking-[0.1em] text-adm-t3">
                  客户可见原因 / Customer-Visible Reason
                </div>
                <div className="mt-1 whitespace-pre-wrap text-[13px] text-adm-t1">{detail.reasonCustomer}</div>
                <p className="mt-1 font-mono text-[9px] text-adm-t3">
                  本期尚未对客户展示（留给客户流水读模型任务）。
                </p>
              </div>
            </div>
          </DetailCard>

          {/* 分录预览 / Posting Preview */}
          <DetailCard title="分录预览 / Posting Preview" columns={1}>
            <div className="flex flex-wrap items-center gap-3 font-mono text-[12px]">
              <span className="rounded border border-adm-border bg-adm-bg px-3 py-2">
                <span className="text-adm-t3">借 / Dr </span>
                <span className="text-adm-t1">{detail.debitAccountCode ?? '—'}</span>
              </span>
              <ArrowRight size={14} className="text-adm-t3" />
              <span className="rounded border border-adm-border bg-adm-bg px-3 py-2">
                <span className="text-adm-t3">贷 / Cr </span>
                <span className="text-adm-t1">{detail.creditAccountCode ?? '—'}</span>
              </span>
              <span className="text-adm-t2">{formatAmount(detail.amount, detail.decimals)} {detail.assetCode}</span>
            </div>
            <p className="mt-2 font-mono text-[10px] text-adm-t3">
              {detail.status === 'POSTED'
                ? '审批已通过，此分录已实际过账。'
                : '预览——按（账簿 × 方向）推导，审批通过后才会实际过账（见 adjustment-rules.ts resolvePostingLegs）。'}
            </p>
            {detail.status === 'POSTED' && detail.tbTransferId && (
              <Link
                to={`/admin/ledger/transfer-evidence/${encodeURIComponent(detail.tbTransferId)}`}
                className="mt-3 inline-flex items-center gap-1.5 rounded border border-adm-blue/30 bg-adm-blue/5 px-3 py-1.5 font-mono text-[11px] text-adm-blue transition-colors hover:bg-adm-blue/10"
              >
                <ExternalLink size={12} />
                查看记账凭证 / View Ledger Evidence
              </Link>
            )}
          </DetailCard>

          {/* 审批 / Approval */}
          <DetailCard title="审批 / Approval" columns={1}>
            {detail.approvalNo ? (
              <button
                type="button"
                onClick={openApprovalCenter}
                className="inline-flex items-center gap-1.5 rounded border border-adm-blue/30 bg-adm-blue/5 px-3 py-1.5 font-mono text-[11px] text-adm-blue transition-colors hover:bg-adm-blue/10"
              >
                <ExternalLink size={12} />
                {detail.approvalNo}
                <ArrowRight size={11} />
                审批中心
              </button>
            ) : (
              <div className="font-mono text-[11px] text-adm-t3">
                尚未提审（DRAFT）。
              </div>
            )}
          </DetailCard>
        </div>

        {/* ── Sidebar ── */}
        <aside className="w-[272px] min-w-[272px] overflow-y-auto border-l border-adm-border bg-adm-panel px-4">
          <SidebarGroup title="Identity Summary">
            <SidebarKV label="Adjustment No" value={detail.adjustmentNo} mono />
            <SidebarKV label="Status" value={<StatusPill value={detail.status} />} />
            <SidebarKV label="Case" value={detail.caseNo} mono />
            <SidebarKV label="Book" value={detail.book} mono />
          </SidebarGroup>

          <SidebarGroup title="Lifecycle">
            <SidebarKV label="Created By" value={detail.createdByUserId} mono />
            <SidebarKV label="Created" value={fmtTime(detail.createdAt)} mono />
            <SidebarKV label="Decided By" value={detail.decidedByUserId ?? '—'} mono />
            <SidebarKV label="Posted At" value={detail.postedAt ? fmtTime(detail.postedAt) : '—'} mono />
            <SidebarKV label="Updated" value={fmtTime(detail.updatedAt)} mono />
          </SidebarGroup>
        </aside>
      </div>
    </div>
  );
};

export default ReconciliationAdjustmentDetailPage;
