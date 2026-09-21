// admin-web/src/components/reconciliation/CaseFlowTable.tsx
//
// 第六幕波四（Task 5）：从 ReconciliationCasesDetailPage.tsx 剪切粘贴外迁——
// Differences 大表（六态处置按钮组、⚡演示推荐、行内 funding 按钮）+ This Case's
// Adjustments 列表整段，逐字搬运，注释随行；不改 JSX/className/文案。
//
// Props 收口（brief 给的基准名单 + 闸②驱动的补齐）：
//   - 回调统一 on* 命名转发页面既有 handler：onOpenAdjustKind/onOpenFinding/
//     onOpenHold/onOpenWriteOff/onOpenFunding 分别替换原来的
//     openAdjustKind/setFindingPicker/setHoldPicker/openWriteOff/setFundingRow
//     直接调用——这是本次搬运仅有的 5 处调用点改写，语义不变（页面挂载处仍转发
//     同名 handler / 同形状 state setter）。
//   - matchedCount/openRowsCount/existingLargeUnexplained/existingClientShortfall
//     与五个权限布尔（canRecordDisposition/canCreateAdjustment/canSupplement/
//     canRegisterIncident/canFundClient）是段内实际引用、但 brief 基准名单未列的
//     标识符：均为页面级派生值（filter/find/hasPermission），按纪律（同 Task 4
//     CaseBalanceTiles 先例——"派生值一并入 props，禁止把求和/派生算式搬进组件"）
//     留页面计算、以 props 传入，组件内不重新计算。
//   - showMatched 切换原写法 `setShowMatched((v) => !v)`（functional updater）与
//     基准接口给定的 `setShowMatched: (v: boolean) => void` 签名不兼容，改写成
//     `setShowMatched(!showMatched)`——组件内唯一读写 showMatched 之处，行为等价，
//     是接口签名逼出的必要改写，不是顺手规整。
//   - tableRef/shortTimestamp/renderFunding 段内消费方只有本组件，随迁进本文件
//     （renderFunding 原定义在页面 :439-496，早于搬运边界注释，但两处调用点都在
//     段内，随段一并搬入；navigate 内部改用 useNavigate() 自取，不额外开 prop）。
import { useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Check, Plus, PenLine } from 'lucide-react';
import { DetailCard } from '../compliance/DetailPageComponents';
import { StatusPill } from '../ui/StatusPill';
import { TONE_CLASSES } from '../../utils/reconBucketMap';
import type { FlowComparisonRow, ReconCaseDetail } from '../../utils/reconTypes';
import { formatAmount, minorToMajorPlain } from '../../utils/reconAmount';
import { INTERNAL_TRANSFER_STATUS_LABEL as TRANSFER_STATUS_WORD } from '../../utils/internalTransferStatusMap';
import { REASON_LABEL } from '../ReconciliationAdjustmentCreateModal';
import { OUTLET_TONE } from '../../utils/causeRegistry';
import { ShortRef, SOURCE_TYPE_HREF, buildIncidentHref, IncidentBadge, MatchChip } from './caseDetailBits';

type CaseIncidentRef = NonNullable<ReconCaseDetail['incidents']>[number];

interface CaseFlowTableProps {
  kase: ReconCaseDetail;
  sortedFlows: FlowComparisonRow[];
  showMatched: boolean;
  setShowMatched: (v: boolean) => void;
  simEnabled: boolean;
  onOpenAdjustKind: (row: FlowComparisonRow, kind: 'CORRECT' | 'REVERSE' | 'RECORD') => void;
  onOpenFinding: (row: FlowComparisonRow, kind: string, label: string) => void;
  onOpenHold: (row: FlowComparisonRow, kind: 'HOLD_NEXT_PERIOD' | 'HOLD_INVESTIGATING') => void;
  onOpenWriteOff: (row: FlowComparisonRow) => void;
  onOpenFunding: (row: FlowComparisonRow) => void;
  // 闸②补齐（详见上方文件头注释）——五个权限布尔 + 四个派生值，页面计算、组件只读。
  canRecordDisposition: boolean;
  canCreateAdjustment: boolean;
  canSupplement: boolean;
  canRegisterIncident: boolean;
  canFundClient: boolean;
  matchedCount: number;
  openRowsCount: number;
  existingLargeUnexplained: CaseIncidentRef | undefined;
  existingClientShortfall: CaseIncidentRef | undefined;
}

// Compact timestamp for flow-row cells (the table is dense — full timestamps blow it up).
const shortTimestamp = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${mm}-${dd} ${hh}:${mi}`;
};

export const CaseFlowTable = ({
  kase, sortedFlows, showMatched, setShowMatched, simEnabled,
  onOpenAdjustKind, onOpenFinding, onOpenHold, onOpenWriteOff, onOpenFunding,
  canRecordDisposition, canCreateAdjustment, canSupplement, canRegisterIncident, canFundClient,
  matchedCount, openRowsCount, existingLargeUnexplained, existingClientShortfall,
}: CaseFlowTableProps) => {
  const navigate = useNavigate();
  const tableRef = useRef<HTMLTableElement | null>(null);

  // 平账二期：行上的划转回挂 + 补款 / 垫款按钮。案子 RESOLVED 之后照样给（认损让案子愈了，补款是对客户的交代）。
  const renderFunding = (row: FlowComparisonRow) => (
    <>
      {row.transfer && (
        <span className="max-w-[220px] font-mono text-[10px] text-adm-t2">
          {row.transfer.purpose === 'CLIENT_ADVANCE' ? 'Advance' : 'Compensation'}{' '}
          <Link to={`/admin/treasury/internal-transfers/${encodeURIComponent(row.transfer.transferNo)}`} className="text-adm-blue hover:underline">{row.transfer.transferNo}</Link>
          {' · '}{TRANSFER_STATUS_WORD[row.transfer.status] ?? row.transfer.status}
        </span>
      )}
      {(row.nextStep?.kind === 'COMPENSATION' || row.nextStep?.kind === 'ADVANCE') && kase && (
        canFundClient ? (
          <button type="button" onClick={() => onOpenFunding(row)} className="inline-flex max-w-[220px] items-start gap-1 font-mono text-[10px] font-medium text-adm-blue hover:underline">
            <Plus size={10} />
            {row.nextStep.kind === 'COMPENSATION'
              ? `Initiate compensation ${formatAmount(row.nextStep.amount, kase.decimals)} ${kase.assetCode}`
              : `Insufficient balance ${formatAmount(row.nextStep.amount, kase.decimals)} ${kase.assetCode} — Initiate advance`}
          </button>
        ) : (
          <span className="max-w-[220px] font-mono text-[10px] text-adm-amber">
            {row.nextStep.kind === 'COMPENSATION' ? 'Pending compensation (initiated by treasury)' : `Insufficient balance ${formatAmount(row.nextStep.amount, kase.decimals)} — pending treasury advance`}
          </span>
        )
      )}
      {/* Recon phase 3 (Task 12): B batch deposit-recall claim insufficient
          balance (ADVANCE) — add "Register shortfall" next to the advance button,
          prefilled with CLIENT_SHORTFALL/customer/shortfall amount/advance
          transfer no (only when row.transfer is already a CLIENT_ADVANCE
          transfer). Once registered it becomes a badge, not a second entry
          point — the dedup check keys on kase.incidents (case-level, by
          sourceCaseNo), so the case no MUST be included here or the dedup
          check can never find it and the button never converges. */}
      {row.nextStep?.kind === 'ADVANCE' && kase && (
        existingClientShortfall ? (
          <IncidentBadge incidentNo={existingClientShortfall.incidentNo} />
        ) : canRegisterIncident ? (
          <button
            type="button"
            onClick={() => navigate(buildIncidentHref({
              type: 'CLIENT_SHORTFALL',
              sourceCaseNo: kase.caseNo,
              customerNo: row.nextStep!.customerNo,
              assetCode: kase.assetCode,
              amount: minorToMajorPlain(row.nextStep!.amount, kase.decimals),
              sourceAdvanceTransferNo: row.transfer?.purpose === 'CLIENT_ADVANCE' ? row.transfer.transferNo : undefined,
              title: `Deposit-recall shortfall · customer ${row.nextStep!.customerNo ?? '—'}`,
              description: `After the deposit-recall claim, customer wallet ${row.nextStep!.walletNo ?? '—'} has insufficient balance. `
                + `The firm advances the shortfall of ${minorToMajorPlain(row.nextStep!.amount, kase.decimals)} ${kase.assetCode} first; register the shortfall for later recovery.`,
            }))}
            className="inline-flex items-center gap-1 whitespace-nowrap font-mono text-[10px] font-medium text-adm-red hover:underline"
          >
            <Plus size={10} />
            Register shortfall
          </button>
        ) : null
      )}
    </>
  );

  return (
    <>
          {/* 5. Differences (renamed from the old Flow Drilldown card, Task 8) —
              single mixed table, no grouped sections: orphans/mismatches sort
              first, then in-transit, then MATCHED collapsed behind a toggle
              below. Disposition column pinned to 250px + Reference truncated
              via ShortRef — the two changes that cure horizontal scroll at
              1280px (long externalRefs were the main overflow cause). Title
              count is the "open" (non-MATCHED) count, independent of the
              showMatched toggle — matches design/Main.dc.html §4 wording. */}
          <DetailCard
            title={`Differences · ${openRowsCount} open row${openRowsCount === 1 ? '' : 's'}`}
            columns={1}
          >
            <div className="overflow-x-auto rounded-lg border border-adm-border">
              <table ref={tableRef} className="w-full text-left text-sm">
                <thead className="border-b border-adm-border bg-adm-bg">
                  <tr>
                    <th className="px-3 py-2 font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-adm-t3">
                      Type
                    </th>
                    <th className="px-3 py-2 font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-adm-t3">
                      Dir
                    </th>
                    <th className="px-3 py-2 text-right font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-adm-t3">
                      Amount
                    </th>
                    <th className="px-3 py-2 font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-adm-t3">
                      Reference
                    </th>
                    <th className="px-3 py-2 font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-adm-t3">
                      Source
                    </th>
                    <th className="px-3 py-2 font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-adm-t3">
                      Time
                    </th>
                    <th className="w-[250px] px-3 py-2 font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-adm-t3">
                      Disposition
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-adm-border">
                  {sortedFlows.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-3 py-8 text-center font-mono text-[11px] text-adm-t3">
                        No flow rows for this case.
                      </td>
                    </tr>
                  ) : (
                    sortedFlows.map((row, idx) => {
                      const ext = row.externalLine;
                      const intl = row.internalFlow;
                      const isMismatch = row.matchType === 'AMOUNT_MISMATCH';
                      const isInTransit = row.matchType === 'IN_TRANSIT';
                      const direction = ext?.direction ?? intl?.direction ?? null;
                      const timestamp = ext?.timestamp ?? intl?.timestamp ?? null;
                      return (
                        <tr
                          key={`${row.matchType}-${ext?.id ?? '_'}-${intl?.id ?? '_'}-${idx}`}
                          className="align-top"
                        >
                          {/* Type badge */}
                          <td className="px-3 py-3">
                            <MatchChip row={row} />
                          </td>
                          {/* Direction */}
                          <td className="px-3 py-3 font-mono text-[11px]">
                            {direction ? (
                              <span
                                className={`rounded border px-1 text-[9px] font-semibold ${
                                  direction === 'IN'
                                    ? 'border-adm-green/30 bg-adm-green/10 text-adm-green'
                                    : 'border-adm-red/30 bg-adm-red/10 text-adm-red'
                                }`}
                              >
                                {direction}
                              </span>
                            ) : (
                              <span className="text-adm-t3">—</span>
                            )}
                          </td>
                          {/* Amount — mismatch shows both sides "internal ≠ external" */}
                          <td className={`px-3 py-3 text-right font-mono text-[11px] ${isMismatch ? 'font-bold text-adm-red' : 'text-adm-t1'}`}>
                            {isMismatch
                              ? `${formatAmount(intl?.amount, kase.decimals)} ≠ ${formatAmount(ext?.amount, kase.decimals)}`
                              : formatAmount(ext?.amount ?? intl?.amount, kase.decimals)}
                          </td>
                          {/* Reference — truncated + copy (ShortRef); the main
                              lever that cures horizontal scroll (raw refs can
                              be long on-chain hashes). */}
                          <td className="px-3 py-3">
                            <ShortRef value={ext?.externalRef ?? null} />
                          </td>
                          {/* Source — IN_TRANSIT links to the funds order. When
                              that funds order is already CLEARED but this case
                              is still OPEN, badge "Pushed · re-reconcile": a
                              rerun will close the case (Re-reconcile action in
                              the sidebar). Other rows show the internal
                              business number (DEP/WD/SWP/…) linked via
                              SOURCE_TYPE_HREF, eventCode moved to title; a
                              sourceType with no route mapping falls back to
                              plain text. External-only orphan rows have no
                              internal side → em dash. */}
                          <td className="px-3 py-3 font-mono text-[11px] text-adm-t2">
                            {isInTransit && row.fundsOrderNo ? (
                              <span className="inline-flex flex-wrap items-center gap-1.5">
                                <Link
                                  to={`/admin/funds-orders/${encodeURIComponent(row.fundsOrderNo)}`}
                                  className="text-adm-blue hover:underline"
                                >
                                  {row.fundsOrderNo}
                                </Link>
                                {kase.status === 'OPEN' && row.fundsOrderStatus === 'CLEARED' && (
                                  <span className="inline-flex items-center gap-1 rounded border border-adm-blue/30 bg-adm-blue/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-adm-blue">
                                    <Check size={9} /> Pushed · re-reconcile
                                  </span>
                                )}
                              </span>
                            ) : intl ? (
                              SOURCE_TYPE_HREF[intl.sourceType] ? (
                                <Link to={SOURCE_TYPE_HREF[intl.sourceType](intl.sourceNo)} title={intl.eventCode} className="text-adm-blue hover:underline">
                                  {intl.sourceNo}
                                </Link>
                              ) : (
                                <span title={intl.eventCode}>{intl.sourceNo}</span>
                              )
                            ) : (
                              <span className="text-adm-t3">—</span>
                            )}
                          </td>
                          {/* Time */}
                          <td className="px-3 py-3 font-mono text-[11px] text-adm-t3">
                            {timestamp ? shortTimestamp(timestamp) : '—'}
                          </td>
                          {/* Recon phase 1.5 (spec §3.1): six-state action column.
                              Same shape, same button — giving different buttons
                              would pretend the machine knows something it
                              doesn't; the differentiation happens once a human
                              picks a cause in the disposition modal. */}
                          <td className="px-3 py-3">
                            {row.explainedByAdjustmentNo ? (
                              // ① 已解释——这条差异已经被一张落了账的调账单解释掉，
                              // 引擎算桶时已把它从异常数里摘掉，改为指回那张单。
                              <div className="flex flex-col gap-1">
                                <Link
                                  to={`/admin/reconciliation/adjustments/${encodeURIComponent(row.explainedByAdjustmentNo)}`}
                                  className="inline-flex items-center gap-1 whitespace-nowrap rounded border border-adm-green/30 bg-adm-green/10 px-1.5 py-0.5 font-mono text-[10px] font-medium text-adm-green hover:underline"
                                >
                                  <Check size={10} />
                                  Explained · {row.explainedByAdjustmentNo}
                                </Link>
                                {renderFunding(row)}
                              </div>
                            ) : row.matchType === 'MATCHED' ? (
                              // ② 已匹配——两边一致，没有可处置的东西。
                              null
                            ) : row.matchType === 'IN_TRANSIT' ? (
                              // ③ 在途——差异会随资金单落地自然消失，动作是推单不是处置。
                              row.fundsOrderNo ? (
                                <Link
                                  to={`/admin/funds-orders/${encodeURIComponent(row.fundsOrderNo)}`}
                                  className="whitespace-nowrap font-mono text-[10px] font-medium text-adm-blue hover:underline"
                                >
                                  Push order →
                                </Link>
                              ) : (
                                <span className="text-[10px] text-adm-t3">In-transit · no funds order</span>
                              )
                            ) : (
                              // ④/⑤/⑥ 统一渲染（Task 7 差异行按钮组，取代旧的「已定性 vs
                              // 未定性」两分支）：结论 chip（如有）+ 处置按钮组（未锁定时）。
                              // 覆盖/重定语义——挂起是临时状态：已定性也照样给全套按钮，
                              // 再点一次就是换一个结论（承接④）。锁定 = 行上已经挂着一张
                              // 走不掉的单（调账单 / 补单）——那条单号本身就是唯一出口，
                              // 不该再给别的按钮制造「两条并行结论」的假象；未挂单（含
                              // 从未定性）都不锁。按钮词 = 后端下发的 label（row.dispositions，
                              // Task 5 读面），不前端另编。
                              <div className="flex flex-col gap-1.5">
                                {row.disposition && (
                                  <span
                                    title={row.disposition.findingNote}
                                    className={[
                                      // 与设计稿同款 max-width 换行（design/Main.dc.html §4
                                      // Row B 该徽标就带 max-width: 230px）——不用 nowrap，
                                      // 否则长成因/长操作者名会把 250px 定宽的 Disposition
                                      // 列撑宽，Differences 表就横滚了（治横滚是本任务判据）。
                                      'inline-flex max-w-[220px] items-start gap-1 rounded border px-1.5 py-0.5 font-mono text-[10px] leading-snug',
                                      TONE_CLASSES[OUTLET_TONE[row.disposition.outlet]].border,
                                      TONE_CLASSES[OUTLET_TONE[row.disposition.outlet]].bg,
                                      TONE_CLASSES[OUTLET_TONE[row.disposition.outlet]].text,
                                    ].join(' ')}
                                  >
                                    Finding: {row.disposition.causeLabel} → {row.disposition.outletLabel} · {row.disposition.createdBy} {row.disposition.createdAt.slice(5, 10)}
                                  </span>
                                )}

                                {!(row.disposition?.adjustmentNo || row.disposition?.supplementNo)
                                  && kase.status === 'OPEN' && canRecordDisposition && (row.dispositions?.length ?? 0) > 0 && (
                                  <>
                                    {/* ⚡ 差异行级推荐（本任务）：仅模拟开关开启时展示——关掉模拟
                                        开关即消失，与列表页气泡同一开关（useSimulationMode）。 */}
                                    {simEnabled && row.demoRecommended && (
                                      <div className="font-mono text-[10px] font-medium text-adm-amber">
                                        ⚡ #{row.demoRecommended.scenarioId} Recommended: {row.demoRecommended.dispositionLabel} — {row.demoRecommended.causeLabel}
                                      </div>
                                    )}
                                    <div className="flex flex-wrap gap-1">
                                      {row.dispositions!.map((d) => {
                                        const isHold = d.kind === 'HOLD_NEXT_PERIOD' || d.kind === 'HOLD_INVESTIGATING';
                                        // 每个处置种类跟进动作各自的写权限——按钮组本身已被
                                        // canRecordDisposition 整体门控，这里只筛后续动作走
                                        // 不通的那几种（同既有 canCreateAdjustment/canSupplement/
                                        // canRegisterIncident 三个变量的既有约定，不新开权限口径）。
                                        const allowed = d.kind === 'SUPPLEMENT' ? canSupplement
                                          : d.kind === 'INCIDENT' ? canRegisterIncident
                                          : isHold ? true
                                          : canCreateAdjustment; // CORRECT/REVERSE/RECORD/REATTRIBUTE
                                        if (!allowed) return null;
                                        const tone: 'amber' | 'red' | 'blue' = d.kind === 'INCIDENT' ? 'red' : isHold || d.kind === 'SUPPLEMENT' ? 'amber' : 'blue';
                                        // ⚡ 推荐的那颗处置按钮加轻量高亮——非推荐按钮不动。
                                        const isRecommended = simEnabled && row.demoRecommended?.disposition === d.kind;
                                        return (
                                          <button
                                            key={d.kind}
                                            type="button"
                                            onClick={() => {
                                              if (isHold) onOpenHold(row, d.kind as 'HOLD_NEXT_PERIOD' | 'HOLD_INVESTIGATING');
                                              // Task 8：CORRECT/REVERSE/RECORD 三族原子一窗——直接开调账
                                              // 弹层的 kind 模式，不再先记一遍定性（拆两段流）。
                                              else if (d.kind === 'CORRECT' || d.kind === 'REVERSE' || d.kind === 'RECORD') onOpenAdjustKind(row, d.kind);
                                              else onOpenFinding(row, d.kind, d.label);
                                            }}
                                            className={[
                                              'inline-flex items-center gap-1 whitespace-nowrap rounded border px-1.5 py-0.5 font-mono text-[10px] font-medium',
                                              TONE_CLASSES[tone].border, TONE_CLASSES[tone].bg, TONE_CLASSES[tone].text,
                                              isRecommended ? 'ring-1 ring-adm-amber ring-offset-1 ring-offset-adm-panel' : '',
                                            ].join(' ')}
                                          >
                                            <PenLine size={9} />
                                            {d.label}
                                          </button>
                                        );
                                      })}
                                    </div>
                                  </>
                                )}

                                {row.disposition?.outlet === 'SUPPLEMENT' && row.disposition.supplementNo && (
                                  <span className="max-w-[220px] font-mono text-[10px] text-adm-t2">
                                    Transferred ·{' '}
                                    {row.disposition.supplementRef?.kind === 'DEPOSIT' && row.disposition.supplementRef.id
                                      ? <Link to={`/admin/trading/deposits/${row.disposition.supplementRef.no}`} className="text-adm-blue hover:underline">{row.disposition.supplementNo}</Link>
                                      : row.disposition.supplementRef?.kind === 'WITHDRAW' && row.disposition.supplementRef.id
                                        ? <Link to={`/admin/trading/withdrawals/${row.disposition.supplementRef.no}`} className="text-adm-blue hover:underline">{row.disposition.supplementNo}</Link>
                                        : <span>{row.disposition.supplementNo} (Pending CFO review)</span>}
                                  </span>
                                )}

                                {/* Recon phase 3 (Task 12): outlet = INCIDENT
                                    (unauthorized outflow), already registered — badge
                                    to the incident detail. incidentNo does NOT lock the
                                    row (承接④：only adjustmentNo/supplementNo do), so this
                                    renders alongside the button group, not instead of it. */}
                                {row.disposition?.outlet === 'INCIDENT' && row.disposition.incidentNo && (
                                  <IncidentBadge incidentNo={row.disposition.incidentNo} />
                                )}

                                {row.nextStep?.kind === 'WRITE_OFF' && kase.status === 'OPEN' && (
                                  canCreateAdjustment ? (
                                    <button
                                      type="button"
                                      onClick={() => onOpenWriteOff(row)}
                                      className="inline-flex items-center gap-1 whitespace-nowrap font-mono text-[10px] font-medium text-adm-red hover:underline"
                                    >
                                      <Plus size={10} />
                                      {row.nextStep.reasonCode === 'UNEXPLAINED_CLIENT_LOSS' ? 'Recognize loss' : 'Write off'}
                                    </button>
                                  ) : (
                                    // 行挂了事故号（事故已定损公司承损）不是「超期」——那句话在这里是撒谎。
                                    // C1 挂接链评审修复：判据从单看 outlet==='INCIDENT' 改成看 incidentNo——
                                    // 大额升级路的定性行 outlet 一直留在 HOLD_INVESTIGATING，只有 incidentNo
                                    // 会被 attachIncident 写上，纯 outlet 判据永远照不到那条路。
                                    <span className="max-w-[220px] font-mono text-[10px] text-adm-red">
                                      {row.disposition?.incidentNo
                                        // 终审修复批 Item 6：事故已定损（公司簿也有事故升级路，见
                                        // adjustment.service.ts assertIncidentWriteOffAllowed）不代表
                                        // 一定是"认损"——公司池事故定损后走的是核销，「eligible to
                                        // recognize loss」是客户簿专属措辞，公司簿讲"认损"文不对题。
                                        ? (row.nextStep.reasonCode === 'UNEXPLAINED_CLIENT_LOSS' ? 'Incident assessed · eligible to recognize loss' : 'Incident assessed · eligible to write off')
                                        : (row.nextStep.reasonCode === 'UNEXPLAINED_CLIENT_LOSS' ? 'Overdue · eligible to recognize loss' : 'Overdue · eligible to write off')}
                                    </span>
                                  )
                                )}
                                {row.nextStep?.kind === 'INCIDENT_DEFERRED' && (
                                  existingLargeUnexplained ? (
                                    <IncidentBadge incidentNo={existingLargeUnexplained.incidentNo} />
                                  ) : canRegisterIncident ? (
                                    <button
                                      type="button"
                                      onClick={() => navigate(buildIncidentHref({
                                        type: 'LARGE_UNEXPLAINED',
                                        sourceCaseNo: kase.caseNo,
                                        // C1 挂接链评审修复：不带这个号，后端 attachIncident 的唯一
                                        // 调用点（前提是 dto.sourceDispositionNo 存在）永远不会触发——
                                        // 事故定了损也回写不到这行上。该按钮出现的前提本就是行已定性
                                        // 挂起·调查中（INCIDENT_DEFERRED），disposition 必在。
                                        sourceDispositionNo: row.disposition!.dispositionNo,
                                        customerNo: kase.ownerNo,
                                        assetCode: kase.assetCode,
                                        amount: minorToMajorPlain(row.nextStep!.amount, kase.decimals),
                                        title: `Large unexplained · case ${kase.caseNo}`,
                                        description: `Wallet ${kase.walletNo ?? '—'}'s difference is overdue and its cause could not be determined. Amount ${minorToMajorPlain(row.nextStep!.amount, kase.decimals)} ${kase.assetCode} `
                                          + `exceeds the small-amount threshold — escalating to an incident. Finding: ${row.disposition!.findingNote}`,
                                      }))}
                                      className="inline-flex items-center gap-1 whitespace-nowrap font-mono text-[10px] font-medium text-adm-red hover:underline"
                                    >
                                      <Plus size={10} />
                                      Escalate to incident
                                    </button>
                                  ) : (
                                    <span className="max-w-[220px] font-mono text-[10px] text-adm-red">Overdue · pending escalation to incident</span>
                                  )
                                )}
                                {row.nextStep?.kind === 'CLIENT_SURPLUS' && (
                                  <span className="max-w-[220px] font-mono text-[10px] text-adm-amber">Overdue · surplus pending attribution, route via supplement</span>
                                )}
                                {renderFunding(row)}
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
            {matchedCount > 0 && (
              <button
                type="button"
                onClick={() => setShowMatched(!showMatched)}
                className="mt-3 inline-flex items-center gap-1 font-mono text-[11px] text-adm-blue hover:underline"
              >
                {showMatched ? `Hide ${matchedCount} matched rows` : `Show ${matchedCount} matched rows`}
              </button>
            )}
          </DetailCard>

          {/* This Case's Adjustments (Task 7 controller ruling) — case-level
              list so operations can see at a glance which adjustments have
              already been opened for this case; that's how duplicate-adjustment
              prevention is achieved (not by graying out the whole difference
              row — flowComparison row ids and ReconciliationLineItem.id are not
              the same table, so that's not possible). Click the number to go to
              the adjustment detail page. */}
          <DetailCard
            title={`This Case's Adjustments · ${kase.adjustments?.length ?? 0}`}
            columns={1}
          >
            {!kase.adjustments || kase.adjustments.length === 0 ? (
              <div className="py-4 text-center font-mono text-[11px] text-adm-t3">
                No adjustments opened yet.
              </div>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-adm-border">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-adm-border bg-adm-bg">
                    <tr>
                      <th className="px-3 py-2 font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-adm-t3">
                        Adjustment No
                      </th>
                      <th className="px-3 py-2 font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-adm-t3">
                        Status
                      </th>
                      <th className="px-3 py-2 font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-adm-t3">
                        Reason
                      </th>
                      <th className="px-3 py-2 font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-adm-t3">
                        Dir
                      </th>
                      <th className="px-3 py-2 text-right font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-adm-t3">
                        Amount
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-adm-border">
                    {kase.adjustments.map((adj) => (
                      <tr key={adj.adjustmentNo}>
                        <td className="px-3 py-2.5">
                          <Link
                            to={`/admin/reconciliation/adjustments/${encodeURIComponent(adj.adjustmentNo)}`}
                            className="font-mono text-[11px] font-semibold text-adm-amber hover:underline"
                          >
                            {adj.adjustmentNo}
                          </Link>
                        </td>
                        <td className="px-3 py-2.5">
                          <StatusPill value={adj.status} />
                        </td>
                        <td className="px-3 py-2.5 font-mono text-[11px] text-adm-t2">
                          {REASON_LABEL[adj.reasonCode] ?? adj.reasonCode}
                        </td>
                        <td className="px-3 py-2.5 font-mono text-[11px]">
                          <span
                            className={`rounded border px-1 text-[9px] font-semibold ${
                              adj.direction === 'INCREASE'
                                ? 'border-adm-green/30 bg-adm-green/10 text-adm-green'
                                : 'border-adm-red/30 bg-adm-red/10 text-adm-red'
                            }`}
                          >
                            {adj.direction}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono text-[11px] text-adm-t1">
                          {formatAmount(adj.amount, kase.decimals)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </DetailCard>
    </>
  );
};
