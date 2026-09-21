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
import { REASON_LABEL } from '../components/ReconciliationAdjustmentCreateModal';
import { formatAmount } from '../utils/reconAmount';
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

  const reasonLabel = REASON_LABEL[detail.reasonCode];
  const bookLabel = detail.book === 'CLIENT' ? 'Client' : 'Firm';
  const directionLabel = detail.direction === 'INCREASE' ? 'INCREASE' : 'REDUCE';

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
              Case{' '}
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
          <DetailCard title="Adjustment Info" columns={3}>
            <InfoField label="Reason" value={reasonLabel ? `${reasonLabel} · ${detail.reasonCode}` : detail.reasonCode} />
            <InfoField label="Direction" value={directionLabel} mono />
            <InfoField label="Amount" value={`${formatAmount(detail.amount, detail.decimals)} ${detail.assetCode}`} accent />
            <InfoField label="Effective Date" value={detail.effectiveDate} mono />
            <InfoField
              label="Related Order"
              value={detail.relatedOrderNo ?? '—'}
              mono={!!detail.relatedOrderNo}
            />
            <InfoField label="Wallet" value={detail.walletNo ?? '—'} mono />
            <InfoField label="Customer" value={detail.ownerNo ?? '— (firm book)'} />
          </DetailCard>

          {/* 两版原因 / Reasons */}
          <DetailCard title="Reasons" columns={1}>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <div className="font-mono text-[9px] uppercase tracking-[0.1em] text-adm-t3">
                  Internal Reason
                </div>
                <div className="mt-1 whitespace-pre-wrap text-[13px] text-adm-t1">{detail.reasonInternal}</div>
              </div>
              <div>
                <div className="font-mono text-[9px] uppercase tracking-[0.1em] text-adm-t3">
                  Internal Note
                </div>
                <div className="mt-1 whitespace-pre-wrap text-[13px] text-adm-t1">{detail.reasonCustomer}</div>
                <p className="mt-1 font-mono text-[9px] text-adm-t3">
                  Internal record only — the customer statement shows the standard wording for this reason type.
                </p>
              </div>
            </div>
          </DetailCard>

          {/* 分录预览 / Posting Preview */}
          <DetailCard title="Posting Preview" columns={1}>
            <div className="flex flex-wrap items-center gap-3 font-mono text-[12px]">
              <span className="rounded border border-adm-border bg-adm-bg px-3 py-2">
                <span className="text-adm-t3">Dr </span>
                <span className="text-adm-t1">{detail.debitAccountCode ?? '—'}</span>
              </span>
              <ArrowRight size={14} className="text-adm-t3" />
              <span className="rounded border border-adm-border bg-adm-bg px-3 py-2">
                <span className="text-adm-t3">Cr </span>
                <span className="text-adm-t1">{detail.creditAccountCode ?? '—'}</span>
              </span>
              <span className="text-adm-t2">{formatAmount(detail.amount, detail.decimals)} {detail.assetCode}</span>
            </div>
            <p className="mt-2 font-mono text-[10px] text-adm-t3">
              {detail.status === 'POSTED'
                ? 'Approved — this entry has been posted.'
                : 'Preview — derived from (book × direction); posts once approved (see adjustment-rules.ts resolvePostingLegs).'}
            </p>
            {detail.status === 'POSTED' && detail.tbTransferId && (
              <Link
                to={`/admin/ledger/transfer-evidence/${encodeURIComponent(detail.tbTransferId)}`}
                className="mt-3 inline-flex items-center gap-1.5 rounded border border-adm-blue/30 bg-adm-blue/5 px-3 py-1.5 font-mono text-[11px] text-adm-blue transition-colors hover:bg-adm-blue/10"
              >
                <ExternalLink size={12} />
                View Ledger Evidence
              </Link>
            )}
          </DetailCard>

          {/* 审批 / Approval */}
          <DetailCard title="Approval" columns={1}>
            {detail.approvalNo ? (
              <button
                type="button"
                onClick={openApprovalCenter}
                className="inline-flex items-center gap-1.5 rounded border border-adm-blue/30 bg-adm-blue/5 px-3 py-1.5 font-mono text-[11px] text-adm-blue transition-colors hover:bg-adm-blue/10"
              >
                <ExternalLink size={12} />
                {detail.approvalNo}
                <ArrowRight size={11} />
                Approval Center
              </button>
            ) : (
              <div className="font-mono text-[11px] text-adm-t3">
                Not yet submitted (DRAFT).
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
