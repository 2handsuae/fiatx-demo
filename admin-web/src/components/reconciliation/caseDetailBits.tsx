// admin-web/src/components/reconciliation/caseDetailBits.tsx
//
// 第六幕波四（Task 4）：从 ReconciliationCasesDetailPage.tsx 剪切粘贴外迁的小件——
// ShortRef / SOURCE_TYPE_HREF / buildIncidentHref / IncidentBadge / MatchChip。
// 逐字搬运，注释随行；不改 JSX/className/文案。
import { Link } from 'react-router-dom';
import { Check, AlertTriangle, Copy } from 'lucide-react';
import type { FlowComparisonRow } from '../../utils/reconTypes';
import { MATCH_TONE, MATCH_LABEL } from '../../utils/causeRegistry';

// Task 8（Differences 表 Reference 列）：外部单号截断 + 复制，治横滚的关键一环——原
// 组件展示完整 externalRef（部分是长链上哈希），是表格撑爆 1280 视口的主因之一。
export const ShortRef = ({ value }: { value: string | null }) =>
  !value ? <span className="text-adm-t3">—</span> : (
    <span className="inline-flex items-center gap-1.5 font-mono text-[11px] text-adm-t2" title={value}>
      {value.length > 18 ? `${value.slice(0, 10)}…${value.slice(-4)}` : value}
      <button
        type="button"
        onClick={() => { void navigator.clipboard.writeText(value); }}
        className="shrink-0 text-adm-t3 hover:text-adm-blue"
      >
        <Copy size={11} />
      </button>
    </span>
  );

// Task 8（Differences 表 Source 列）：内部行链到对应订单详情。不复用
// approvalEntityRoutes.ts 的 ENTITY_ROUTE_BY_ACTION——那张表按审批 actionType 建键
// （如 DEPOSIT_CONFISCATION），键空间与账务 sourceType（DEPOSIT/WITHDRAWAL/…）不
// 重合；这里沿用它"能给详情页用详情页、不能给（deposit/withdraw 详情路由仍是内部
// id）用列表页 + 单号定位"的既有惯例，对 recon 场景会出现的 sourceType 逐条落地。
// Fix round：三个列表页此前都不读 `?keyword=`（全管理台无人读，死参数），改传各自
// 列表页真正认识的单号过滤参数——depositNo / withdrawNo / swapNo（见三张列表页
// FilterState 初始化处新增的 URL 参数读取，逐字仿写它们旁边既有的 ownerNo 写法）。
export const SOURCE_TYPE_HREF: Record<string, (no: string) => string> = {
  DEPOSIT: (no) => `/admin/trading/deposits?depositNo=${encodeURIComponent(no)}`,
  WITHDRAWAL: (no) => `/admin/trading/withdrawals?withdrawNo=${encodeURIComponent(no)}`,
  SWAP: (no) => `/admin/trading/swaps?swapNo=${encodeURIComponent(no)}`,
  INTERNAL_TRANSFER: (no) => `/admin/treasury/internal-transfers/${encodeURIComponent(no)}`,
  RECON_ADJUSTMENT: (no) => `/admin/reconciliation/adjustments/${encodeURIComponent(no)}`,
};

// 平账三期（Task 12）：案件页三入口共用——拼「登记事故」跳转的 query。铁律⑥：
// 只传业务键（案号/定性行号/客户号/资产代码/元口径金额）；钱包与账单行参考号在
// NewIncidentModal 里没有专用结构化字段，塞进 description 供人读、可编辑，不当
// 隐藏字段提交（walletRef 字段在后端要的是内部 UUID，本页不该替它拼一个出来）。
export const buildIncidentHref = (params: Record<string, string | null | undefined>): string => {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v) qs.set(k, v);
  }
  return `/admin/governance/incidents?${qs.toString()}`;
};

// 已登记事故的徽标——三处出口（未授权转出 / 大额到线 / 退汇欠款）共用同一个样式，
// 点进去是事故详情页；outlet=INCIDENT 的红色调沿用 OUTLET_TONE.INCIDENT 的既有语义。
export const IncidentBadge = ({ incidentNo }: { incidentNo: string }) => (
  <Link
    to={`/admin/governance/incidents/${encodeURIComponent(incidentNo)}`}
    className="inline-flex items-center gap-1 whitespace-nowrap rounded border border-adm-red/30 bg-adm-red/10 px-1.5 py-0.5 font-mono text-[10px] font-medium text-adm-red hover:underline"
  >
    Incident · {incidentNo}
  </Link>
);

export const MatchChip = ({ row }: { row: FlowComparisonRow }) => {
  const tone = MATCH_TONE[row.matchType];
  return (
    <span className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 font-mono text-[10px] font-semibold ${tone}`}>
      {row.matchType === 'MATCHED' ? <Check size={10} /> : <AlertTriangle size={10} />}
      {MATCH_LABEL[row.matchType]}
    </span>
  );
};
