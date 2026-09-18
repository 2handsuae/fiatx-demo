// admin-web/src/pages/ReconciliationCasesListPage.tsx
//
// T6 — Cases list = tracking view.
//   - Default URL: ?status=OPEN&sort=aging.desc (server already sorts aging desc per T3).
//   - Columns: Case ID | Wallet | COA | Owner | Asset | Aging | Δ | Run | 定性进度 | Status.
//     (Wallet + COA were previously a single stacked "Account" column — split for clarity.
//     Task 15: First Run + Last Run collapsed into one Run column — table-fixed layout
//     to hold 1280×800 without horizontal scroll; see formatRunRange / table-fixed comment below.)
//   - 定性进度 (disposition progress) = dispositionCount/anomalyLineCount, i.e. how many
//     of the case's flagged lines already have a recorded finding vs. still untriaged.
//   - Aging tiers visualise triage urgency (0-3 muted, 4-7 amber, 8+ red).
//   - Row click → /admin/reconciliation/cases/{caseNo}.
//   - V8 columns (book/layer/business-date) removed; per-wallet model surfaces wallet+coa+owner instead.
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import {
  AdminSessionError,
  adminFetch,
  getApiErrorMessage,
} from '../utils/adminFetch';
import { PageTitleBar } from '../components/ui/PageTitleBar';
import Pagination from '../components/common/Pagination';
// 分→元展示格式化：复用详情页既有的 formatAmount（带千分位，展示专用），
// 不再造第三个同类工具（同类先例：ReconciliationAdjustmentCreateModal /
// ReconciliationDispositionModal 都已这样引用）。Task 15：COA 人话短语同理复用
// 详情页已导出的 COA_PHRASE，不重抄一份映射。
import { formatAmount, COA_PHRASE } from './ReconciliationCasesDetailPage';
// 门控一致性小补（本任务）：气泡此前只按数据在场显示——补上与详情页行级推荐同一个
// 模拟开关（业主原话「依然是模拟开关下展示」）。
import { useSimulationMode } from '../utils/simulationMode';

/* ── Interfaces ──────────────────────────────────────────────── */

interface ReconCase {
  id: string;
  caseNo: string;
  assetCode: string;
  walletRef: string | null;
  coaCode: string | null;
  ownerNo: string | null;
  deltaAmount: string;
  status: string;
  aging: number;
  slaBreached: boolean;   // 平账 A 批：账龄到线标记
  firstSeenRunId: string | null;
  lastUpdatedRunId: string | null;
  firstSeenRunNo: string | null;    // business No (e.g. "RUN-0042")
  lastUpdatedRunNo: string | null;  // business No
  walletNo: string | null;  // business key resolved server-side
  dispositionCount: number;   // T7: rows in reconciliation_dispositions for this case
  anomalyLineCount: number;   // T7: case's flagged line items (mismatch/orphan)
  decimals: number;           // T7: asset decimals — scales deltaAmount (分→元)
  // 平账二期：这个案子挂着的补款 / 垫款——PENDING = 还没发起，IN_PROGRESS = 已发起未到账
  pendingFunding: { kind: 'COMPENSATION' | 'ADVANCE'; status: 'PENDING' | 'IN_PROGRESS' } | null;
  // Task 11：列表页演示场景气泡——仅 break 轮答案键在场时下发（Task 5），业务键，
  // 无 walletRef/UUID；真实/pass 轮字段不出现（undefined，不是空数组）。
  demoScenarios?: Array<{
    scenarioId: number;
    causeCode: string;
    causeLabel: string;
    dispositionLabel: string;
    clue: string;
  }>;
}

/* ── Constants ───────────────────────────────────────────────── */

// Status filter values. Server interprets `ALL` as "no status filter"; OPEN is the
// implicit landing default per T3 (omit param == OPEN).
const STATUS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'OPEN', label: 'Open' },
  { value: 'RESOLVED', label: 'Resolved' },
  { value: 'WAIVED', label: 'Waived' },
  { value: 'ALL', label: 'All' },
];

const PAGE_SIZE = 25;

/* ── Helpers ─────────────────────────────────────────────────── */

// Aging tier → muted (0-3d) / amber (4-7d) / red (8d+). Greys out the column when
// there's nothing urgent so the operator's eye jumps straight to red rows.
const agingClass = (days: number): string => {
  if (days >= 8) return 'text-adm-red font-semibold';
  if (days >= 4) return 'text-adm-amber font-semibold';
  return 'text-adm-t3';
};

// Status badge palette: amber for OPEN (needs attention), green for RESOLVED
// (clean), muted gray for WAIVED (acknowledged, no action). Anything else falls
// back to neutral.
const statusBadgeClass = (status: string): string => {
  const s = status.toUpperCase();
  if (s === 'OPEN' || s === 'PENDING_RECHECK') return 'bg-amber-100 text-amber-800';
  if (s === 'RESOLVED') return 'bg-green-100 text-green-800';
  if (s === 'WAIVED') return 'bg-gray-100 text-gray-500';
  return 'bg-gray-100 text-gray-800';
};

const statusLabel = (status: string): string => {
  const s = status.toUpperCase();
  if (s === 'OPEN') return 'Open';
  if (s === 'RESOLVED') return 'Resolved';
  if (s === 'WAIVED') return 'Waived';
  if (s === 'PENDING_RECHECK') return 'Pending recheck';
  return status;
};

// Task 15：First Run / Last Run 两列并一列，治横滚。runNo 形如 'RUN20260907-1'
// （日期前缀 + 序号）；同日多次跑批时前缀相同，只差序号——共同前缀部分只显一次，
// 压成 'RUN20260907-1 → -2'。前缀不同（跨日）时没有压缩空间，原样显示两个全号。
const formatRunRange = (first: string | null, last: string | null): string => {
  if (!first) return '—';
  if (!last || first === last) return first;
  const cut = first.lastIndexOf('-');
  const cutLast = last.lastIndexOf('-');
  if (cut > 0 && cutLast > 0 && first.slice(0, cut) === last.slice(0, cutLast)) {
    return `${first} → ${last.slice(cutLast)}`;
  }
  return `${first} → ${last}`;
};

/* ── Component ───────────────────────────────────────────────── */

const ReconciliationCasesListPage = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  // URL is the source of truth; missing/empty status param means OPEN (server default).
  const statusFromUrl = searchParams.get('status') ?? 'OPEN';
  const runNo = searchParams.get('runNo');
  // 门控一致性小补（本任务）：⚡ 演示场景气泡只在模拟模式下展示——与详情页行级
  // 推荐同一个开关。
  const { enabled: simEnabled } = useSimulationMode();

  const [cases, setCases] = useState<ReconCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const fetchCases = async (status: string, runNoFilter: string | null) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      // Pass status explicitly (incl. OPEN) for clarity. `ALL` opts out per T3 contract.
      params.set('status', status);
      if (runNoFilter) params.set('runNo', runNoFilter);
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/reconciliation/cases?${params.toString()}`,
      );
      if (!res.ok)
        throw new Error(await getApiErrorMessage(res, 'Failed to load reconciliation cases.'));
      const result = await res.json();
      const rows: ReconCase[] = Array.isArray(result) ? result : (result.items ?? []);
      setCases(rows);
      setPage(1);
    } catch (err) {
      if (err instanceof AdminSessionError) return;
      setError(err instanceof Error ? err.message : 'Failed to load reconciliation cases.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchCases(statusFromUrl, runNo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFromUrl, runNo]);

  const handleStatusChange = (value: string) => {
    // Update URL → effect re-fetches. Keep sort param for shareable links even
    // though the backend already sorts; future-proofs if we add other sort modes.
    const next = new URLSearchParams(searchParams);
    next.set('status', value);
    next.set('sort', 'aging.desc');
    setSearchParams(next, { replace: true });
  };

  const pageRows = useMemo(
    () => cases.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [cases, page],
  );

  const fi =
    'h-[30px] rounded border border-adm-border bg-adm-bg px-2.5 font-mono text-[11px] text-adm-t1 outline-none focus:border-adm-amber transition-colors';

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* ── Title bar ── */}
      <PageTitleBar
        title="Reconciliation Cases"
        meta={`${cases.length} case${cases.length === 1 ? '' : 's'} · sorted by aging`}
      >
        <button
          onClick={() => void fetchCases(statusFromUrl, runNo)}
          className="inline-flex h-[30px] w-[30px] items-center justify-center rounded border border-adm-border bg-adm-bg text-adm-t2 transition-colors hover:bg-adm-hover"
          title="Refresh"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </PageTitleBar>

      {/* ── Filter bar ── */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-adm-border bg-adm-panel px-5 py-2">
        <label className="font-mono text-[10px] uppercase tracking-[0.1em] text-adm-t3">
          Status
        </label>
        <select
          value={statusFromUrl}
          onChange={(e) => handleStatusChange(e.target.value)}
          className={`${fi} w-36`}
        >
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      {/* ── Notices ── */}
      {error && (
        <div className="shrink-0 border-b border-adm-red/20 bg-adm-red/6 px-5 py-2.5 font-mono text-[11px] text-adm-red">
          {error}
        </div>
      )}

      {/* ── Table ── */}
      <div className="flex-1 overflow-auto">
        {/* table-fixed（Task 15 治横滚关键一步）：列宽由声明值硬钉，不再随最长单元格内容
            撑宽——auto 布局下 11 列声明宽度加总原就等于 1280（视口整宽），但侧栏吃掉 240px
            后实际可用只剩 1040px，单元格里任何不可断行的长值（caseNo/walletNo/COA 码等）都会
            把某一列继续撑宽，逼出横向滚动条、切掉最右的 Status 列。改 table-fixed 后列宽=
            声明值之和（现已降到约 1000px，留出安全边），配合下方逐列 truncate 兜底。 */}
        <table className="w-full table-fixed border-collapse text-sm">
          <thead>
            <tr>
              {(
                [
                  ['Case ID', '130px', 'left'],
                  ['Wallet', '110px', 'left'],
                  ['COA', '97px', 'left'],
                  ['Owner', '106px', 'left'],
                  ['Asset', '85px', 'left'],
                  ['Aging', '60px', 'right'],
                  ['Δ', '108px', 'right'],
                  ['Run', '140px', 'left'],
                  ['Disposition', '98px', 'left'],
                  ['Status', '82px', 'left'],
                ] as [string, string, string][]
              ).map(([label, w, align]) => (
                <th
                  key={label}
                  style={{ width: w }}
                  className={`border-b border-adm-border bg-adm-panel px-4 py-2 font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-adm-t3 whitespace-nowrap ${align === 'right' ? 'text-right' : 'text-left'}`}
                >
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={10} className="px-4 py-10 text-center font-mono text-[11px] text-adm-t3">
                  Loading…
                </td>
              </tr>
            )}
            {!loading && cases.length === 0 && (
              <tr>
                <td colSpan={10} className="px-4 py-10 text-center font-mono text-[11px] text-adm-t3">
                  No {statusFromUrl === 'ALL' ? '' : statusLabel(statusFromUrl).toLowerCase() + ' '}
                  reconciliation cases found.
                </td>
              </tr>
            )}
            {!loading &&
              pageRows.map((kase) => {
                const deltaNum = Number(kase.deltaAmount ?? '0');
                const hasDelta = Number.isFinite(deltaNum) && deltaNum !== 0;
                const deltaSign = deltaNum > 0 ? '+' : '';
                return (
                  <tr
                    key={kase.id}
                    className="cursor-pointer border-b border-adm-border transition-colors hover:bg-adm-hover"
                    onClick={() => navigate(`/admin/reconciliation/cases/${kase.caseNo}`)}
                  >
                    {/* Case ID */}
                    <td className="truncate px-4 py-2.5" title={kase.caseNo}>
                      <span className="font-mono text-[11px] font-semibold text-adm-amber">
                        {kase.caseNo}
                      </span>
                    </td>

                    {/* Wallet — business key (walletNo). Never expose raw UUIDs. */}
                    <td className="truncate px-4 py-2.5" title={kase.walletNo ?? undefined}>
                      {kase.walletNo ? (
                        <span className="font-mono text-[11px] text-adm-t1">
                          {kase.walletNo}
                        </span>
                      ) : (
                        <span className="font-mono text-[11px] text-adm-t3">—</span>
                      )}
                    </td>

                    {/* COA — human phrase via shared COA_PHRASE map (Task 8); unmapped codes
                        fall back to the raw code. Truncated to hold the column's width (治横
                        滚的关键一环，同 Task 8 Reference 列 ShortRef 的既有做法) — raw code
                        always sits in title so nothing is actually lost. */}
                    <td className="truncate px-4 py-2.5" title={kase.coaCode ?? undefined}>
                      <span className="font-mono text-[10px] font-semibold text-adm-blue">
                        {kase.coaCode ? (COA_PHRASE[kase.coaCode] ?? kase.coaCode) : '—'}
                      </span>
                    </td>

                    {/* Owner — ownerNo (name not on row; can drill into detail for full identity) */}
                    <td className="truncate px-4 py-2.5 font-mono text-[10px] text-adm-t2" title={kase.ownerNo ?? undefined}>
                      {kase.ownerNo ?? '—'}
                    </td>

                    {/* Asset */}
                    <td className="truncate px-4 py-2.5">
                      <span className="font-mono text-[10px] font-semibold text-adm-blue">
                        {kase.assetCode}
                      </span>
                    </td>

                    {/* Aging — tier-coloured days since first seen；到线加「超期」红标（平账 A 批） */}
                    <td className="px-4 py-2.5 text-right">
                      <span className={`font-mono text-[11px] ${agingClass(kase.aging)}`}>
                        {kase.aging}d
                      </span>
                      {kase.slaBreached && (
                        <span className="ml-1 whitespace-nowrap rounded border border-adm-red/30 bg-adm-red/10 px-1 py-0.5 font-mono text-[9px] font-semibold text-adm-red">
                          Overdue
                        </span>
                      )}
                    </td>

                    {/* Δ — bold+signed when non-zero; muted "balanced" when zero */}
                    <td
                      className="truncate px-4 py-2.5 text-right"
                      title={hasDelta ? `${deltaSign}${formatAmount(kase.deltaAmount, kase.decimals)}` : undefined}
                    >
                      {hasDelta ? (
                        <span className="font-mono text-[11px] font-semibold text-adm-amber">
                          {deltaSign}
                          {formatAmount(kase.deltaAmount, kase.decimals)}
                        </span>
                      ) : (
                        <span className="font-mono text-[10px] italic text-adm-t3">balanced</span>
                      )}
                    </td>

                    {/* Run — Task 15: First Run + Last Run 并一列，同 run 只显一次
                        （见 formatRunRange：共同日期前缀只留一次，压成 'RUNxxx-1 → -2'）。
                        title 兜底两个全号（压缩显示偶尔换行截断时仍能核对）。*/}
                    <td
                      className="truncate px-4 py-2.5 font-mono text-[10px] text-adm-t2"
                      title={kase.lastUpdatedRunNo && kase.lastUpdatedRunNo !== kase.firstSeenRunNo ? `${kase.firstSeenRunNo} → ${kase.lastUpdatedRunNo}` : undefined}
                    >
                      {formatRunRange(kase.firstSeenRunNo, kase.lastUpdatedRunNo)}
                    </td>

                    {/* 定性进度 — dispositionCount/anomalyLineCount; '—' when the case has
                        no flagged lines to triage (nothing to qualify). */}
                    <td className="px-3 py-3 font-mono text-[11px] text-adm-t3">
                      {kase.anomalyLineCount > 0 ? `${kase.dispositionCount}/${kase.anomalyLineCount}` : '—'}
                      {kase.pendingFunding && (
                        <span className={`ml-1 inline-flex rounded border px-1 py-0.5 font-mono text-[9px] ${kase.pendingFunding.status === 'PENDING' ? 'border-adm-amber/40 bg-adm-amber/10 text-adm-amber' : 'border-adm-blue/40 bg-adm-blue/10 text-adm-blue'}`}>
                          {kase.pendingFunding.kind === 'COMPENSATION'
                            ? (kase.pendingFunding.status === 'PENDING' ? 'Compensation pending' : 'Compensation in progress')
                            : (kase.pendingFunding.status === 'PENDING' ? 'Advance pending' : 'Advance in progress')}
                        </span>
                      )}
                      {/* Task 11：演示场景气泡——只在答案键在场（demoScenarios 非空数组）
                          时渲染；真实/pass 轮字段 undefined，此处零渲染（不是隐藏）。
                          hover 出纯 CSS tooltip（不引库、不用 title 属性）；group-focus-within
                          兼作截图工具点击/聚焦触发的兜底路径。业务键展示，不含 walletRef/UUID。
                          门控一致性小补（本任务）：补上 simEnabled 门控——此前只按数据在场
                          显示，与详情页行级推荐（仅模拟开关开启时展示）不一致。 */}
                      {simEnabled && kase.demoScenarios && kase.demoScenarios.length > 0 && (
                        <span className="group relative ml-1 inline-block align-middle">
                          <button
                            type="button"
                            onClick={(e) => e.stopPropagation()}
                            className="inline-flex cursor-default rounded border border-adm-amber/40 bg-adm-amber/10 px-1 py-0.5 font-mono text-[9px] font-semibold text-adm-amber focus:outline-none focus:ring-1 focus:ring-adm-amber"
                          >
                            ⚡{kase.demoScenarios.map((s) => s.scenarioId).join('·')}
                          </button>
                          {/* 定位：right-0 令卡片从触发点右边缘向左展开——本列越靠视口右侧
                              越需要这样防溢出（Disposition 列右边只剩 Status 列，卡片宽
                              380px 若向右展开会冲出 1280 视口）。 */}
                          <div className="pointer-events-none absolute right-0 top-full z-50 mt-1 hidden w-[380px] rounded border border-adm-border bg-adm-card p-3 text-left shadow-lg group-hover:block group-focus-within:block">
                            <p className="mb-1.5 font-mono text-[10px] font-semibold text-adm-amber">
                              ⚡ Demo scenarios on this case
                            </p>
                            <ul className="space-y-1.5">
                              {kase.demoScenarios.map((s) => (
                                <li key={s.scenarioId} className="font-mono text-[10px] leading-snug text-adm-t2">
                                  <div>#{s.scenarioId} {s.causeLabel} — {s.dispositionLabel}</div>
                                  {/* Minor 4（终审修复批）：业主原始诉求"悬浮出现场景说明"——场景号 +
                                      成因标题只说了"是什么"，没说"怎么查证得出这个结论"；补一行
                                      成因注册表自带的 clue，与成因菜单同一个词表来源，不另造文案。 */}
                                  <div className="mt-0.5 text-[9px] font-normal normal-case leading-snug text-adm-t3">
                                    {s.clue}
                                  </div>
                                </li>
                              ))}
                            </ul>
                          </div>
                        </span>
                      )}
                    </td>

                    {/* Status badge */}
                    <td className="px-4 py-2.5">
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${statusBadgeClass(kase.status)}`}
                      >
                        {statusLabel(kase.status)}
                      </span>
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>

      {/* ── Pagination ── */}
      <Pagination
        currentPage={page}
        totalItems={cases.length}
        pageSize={PAGE_SIZE}
        onPageChange={setPage}
      />
    </div>
  );
};

export default ReconciliationCasesListPage;
