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
//
// 方案乙（业主拍板，取代上面「逐字搬运」的旧单列 Disposition）：旧 Disposition 列换成
// Status 列，上面一个标签（该行现在处于什么状态；单号/事故号/暂停原因这些附注挂在标签
// 下面），下面至多一个控件。原拟 Status / Action 分两列，1280 宽下两列最小宽度之和顶出
// 横滚（USDT 六位小数时更甚），故上下叠在同一列。控件：还能改处置的行是一个 Resolve ▾ 菜单
// （ResolveMenu），在途行是去推单的链接，已锁定行只剩「补款」这一个跟进按钮，其余
// 什么都不放。菜单分组固定为 Follow up → Fix the books → Hand off → Hold，系统不替
// 财务挑处置（decisions 2026-09-08）：超期后放开的那一项（Write off / Recognize loss /
// Escalate to incident）和其它处置同级进对应组、不置顶不高亮，"为什么多了这一项"写在
// Status 标签上；唯一的提示是模拟开关打开时的 ⚡ 演示推荐。原 renderFunding 随之拆掉：
// 划转回挂进 Status 附注，补款进 Action，垫款/登记欠款进菜单的 Follow up 组。
import { useRef } from 'react';
import type { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Check } from 'lucide-react';
import { DetailCard } from '../compliance/DetailPageComponents';
import { StatusPill } from '../ui/StatusPill';
import { TONE_CLASSES } from '../../utils/reconBucketMap';
import type { FlowComparisonRow, ReconCaseDetail } from '../../utils/reconTypes';
import { formatAmount, minorToMajorPlain } from '../../utils/reconAmount';
import { INTERNAL_TRANSFER_STATUS_LABEL as TRANSFER_STATUS_WORD } from '../../utils/internalTransferStatusMap';
import { REASON_LABEL } from '../ReconciliationAdjustmentCreateModal';
import { OUTLET_TONE, PAUSED_CAUSES } from '../../utils/causeRegistry';
import { ShortRef, SOURCE_TYPE_HREF, buildIncidentHref, IncidentBadge, MatchChip } from './caseDetailBits';
import { ResolveMenu } from './ResolveMenu';
import type { ResolveMenuGroup, ResolveMenuItem } from './ResolveMenu';

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

// Status 列标签的色调：四个业务色走 TONE_CLASSES，gray = 没有任何结论的中性态。
type StatusTone = 'green' | 'blue' | 'amber' | 'red' | 'gray';
interface StatusChip {
  tone: StatusTone;
  label: string;
  to?: string;          // 标签指向某张单据时给链接
  title?: string;       // 悬停补充说明（与定性结论的 title 合并）
  check?: boolean;      // 「已解释」标签带对勾
  extras?: ReactNode[]; // 紧贴标签下方的附注（事故徽标 / 暂停原因），先于通用附注
}

// 单个标签的版式：max-width 换行而不是 nowrap——长成因/长单号不能把 Status 列撑宽
// （Differences 表治横滚是既有判据）。
const CHIP_BASE = 'inline-flex max-w-[180px] items-start gap-1 rounded border px-1.5 py-0.5 font-mono text-[10px] leading-snug';
const chipToneClass = (tone: StatusTone): string =>
  tone === 'gray'
    ? 'border-adm-border bg-adm-bg text-adm-t3'
    : `${TONE_CLASSES[tone].border} ${TONE_CLASSES[tone].bg} ${TONE_CLASSES[tone].text}`;

const adjustmentHref = (no: string) => `/admin/reconciliation/adjustments/${encodeURIComponent(no)}`;

// 当前定性的出口 → 处置种类（ADJUST_* 出口与菜单里 CORRECT/REVERSE/RECORD/REATTRIBUTE
// 同名对应，其余出口名与种类名一致），用来给菜单里对应的那一项标 current。
const OUTLET_TO_KIND: Record<string, string> = {
  ADJUST_CORRECT: 'CORRECT', ADJUST_REVERSE: 'REVERSE', ADJUST_RECORD: 'RECORD', ADJUST_REATTRIBUTE: 'REATTRIBUTE',
};

const HOLD_KINDS = ['HOLD_NEXT_PERIOD', 'HOLD_INVESTIGATING'];

export const CaseFlowTable = ({
  kase, sortedFlows, showMatched, setShowMatched, simEnabled,
  onOpenAdjustKind, onOpenFinding, onOpenHold, onOpenWriteOff, onOpenFunding,
  canRecordDisposition, canCreateAdjustment, canSupplement, canRegisterIncident, canFundClient,
  matchedCount, openRowsCount, existingLargeUnexplained, existingClientShortfall,
}: CaseFlowTableProps) => {
  const navigate = useNavigate();
  const tableRef = useRef<HTMLTableElement | null>(null);

  // Status 列：一个标签，按下面的顺序取第一条命中的规则。MATCHED 行不显示任何东西。
  const statusChipOf = (row: FlowComparisonRow): StatusChip | null => {
    if (row.matchType === 'MATCHED') return null;
    if (row.matchType === 'IN_TRANSIT') return { tone: 'blue', label: 'In transit' };
    const d = row.disposition;
    const ns = row.nextStep;
    // 已解释——这条差异已被一张落了账的调账单解释掉，引擎算桶时已把它从异常数里摘掉，
    // 改为指回那张单。
    if (row.explainedByAdjustmentNo) {
      return { tone: 'green', label: `Explained · ${row.explainedByAdjustmentNo}`, to: adjustmentHref(row.explainedByAdjustmentNo), check: true };
    }
    // 行上已挂着一张走不掉的单（调账单 / 补单）——那条单号本身就是唯一出口。
    if (d?.adjustmentNo) {
      return { tone: 'blue', label: `Pending CFO · ${d.adjustmentNo}`, to: adjustmentHref(d.adjustmentNo) };
    }
    if (d?.supplementNo) {
      const ref = d.supplementRef;
      if (ref?.id && ref.kind === 'DEPOSIT') return { tone: 'blue', label: `Transferred · ${d.supplementNo}`, to: `/admin/trading/deposits/${ref.no}` };
      if (ref?.id && ref.kind === 'WITHDRAW') return { tone: 'blue', label: `Transferred · ${d.supplementNo}`, to: `/admin/trading/withdrawals/${ref.no}` };
      return { tone: 'blue', label: `Supplement · ${d.supplementNo} · pending CFO` };
    }
    // 认领退汇因客户余额不够被拒（ADVANCE）：行没锁，处置照样能改；暂停说明 / 已登记
    // 的欠款事故作附注。
    if (ns?.kind === 'ADVANCE') {
      const extras: ReactNode[] = [];
      if (PAUSED_CAUSES.BOUNCED_FUNDS) {
        extras.push(<span key="paused" className="font-mono text-[10px] text-adm-t3">{PAUSED_CAUSES.BOUNCED_FUNDS}</span>);
      }
      if (existingClientShortfall) extras.push(<IncidentBadge key="shortfall" incidentNo={existingClientShortfall.incidentNo} />);
      return { tone: 'amber', label: `Recall blocked · short ${formatAmount(ns.amount, kase.decimals)} ${kase.assetCode}`, extras };
    }
    // 超期后放开的几项：为什么多了这一项，写在这里。
    if (ns?.kind === 'WRITE_OFF') {
      const lossWord = ns.reasonCode === 'UNEXPLAINED_CLIENT_LOSS' ? 'recognize loss' : 'write off';
      // 行挂了事故号（事故已定损公司承损）不是「超期」——那句话在这里是撒谎。
      // C1 挂接链评审修复：判据从单看 outlet==='INCIDENT' 改成看 incidentNo——
      // 大额升级路的定性行 outlet 一直留在 HOLD_INVESTIGATING，只有 incidentNo
      // 会被 attachIncident 写上，纯 outlet 判据永远照不到那条路。
      // 终审修复批 Item 6：事故已定损（公司簿也有事故升级路，见
      // adjustment.service.ts assertIncidentWriteOffAllowed）不代表一定是"认损"——
      // 公司池事故定损后走的是核销，「eligible to recognize loss」是客户簿专属措辞。
      return d?.incidentNo
        ? { tone: 'red', label: `Incident assessed · eligible to ${lossWord}`, extras: [<IncidentBadge key="inc" incidentNo={d.incidentNo} />] }
        : { tone: 'red', label: `Overdue · eligible to ${lossWord}` };
    }
    if (ns?.kind === 'INCIDENT_DEFERRED') {
      return existingLargeUnexplained
        ? { tone: 'red', label: 'Incident · pending assessment', extras: [<IncidentBadge key="inc" incidentNo={existingLargeUnexplained.incidentNo} />] }
        : { tone: 'red', label: 'Overdue · write-off needs incident' };
    }
    if (ns?.kind === 'CLIENT_SURPLUS') {
      return { tone: 'red', label: 'Overdue · surplus pending attribution', title: 'Route via Supplement' };
    }
    // Recon phase 3 (Task 12): outlet = INCIDENT（未授权转出）已登记——徽标指向事故
    // 详情。incidentNo 不锁行（承接④：只有 adjustmentNo/supplementNo 锁），所以菜单
    // 照样在。
    if (d?.outlet === 'INCIDENT' && d.incidentNo) {
      return { tone: 'red', label: 'Incident registered', extras: [<IncidentBadge key="inc" incidentNo={d.incidentNo} />] };
    }
    if (d) {
      const label = d.outlet === 'HOLD_NEXT_PERIOD' ? 'Held · next period'
        : d.outlet === 'HOLD_INVESTIGATING' ? 'Held · investigating'
        : `Finding · ${d.outletLabel}`;
      return { tone: OUTLET_TONE[d.outlet] ?? 'amber', label };
    }
    return { tone: 'gray', label: 'Unresolved' };
  };

  // Status 单元格：标签 + 依次可能出现的附注（定性出处 → 划转回挂 → 待补款提示）。
  const renderStatus = (row: FlowComparisonRow) => {
    const chip = statusChipOf(row);
    if (!chip) return null;
    const d = row.disposition;
    // 有定性就把「成因 → 出口 · 谁」+ 查证说明放进 title，行上只留一行精简出处。
    const dispositionTitle = d ? `${d.causeLabel} → ${d.outletLabel} · ${d.createdBy}\n${d.findingNote}` : undefined;
    const title = [dispositionTitle, chip.title].filter(Boolean).join('\n') || undefined;
    const cls = `${CHIP_BASE} ${chipToneClass(chip.tone)}`;
    const body = (
      <>
        {chip.check && <Check size={10} className="mt-0.5 shrink-0" />}
        {chip.label}
      </>
    );
    return (
      <div className="flex flex-col items-start gap-1">
        {chip.to ? (
          <Link to={chip.to} title={title} className={`${cls} hover:underline`}>{body}</Link>
        ) : (
          <span title={title} className={cls}>{body}</span>
        )}
        {chip.extras}
        {d && (
          <span className="font-mono text-[10px] text-adm-t3">
            {d.causeLabel} · {d.createdBy} {d.createdAt.slice(5, 10)}
          </span>
        )}
        {/* 平账二期：行上的划转回挂（补款 / 垫款）。案子 RESOLVED 之后照样给（认损让案子愈了，补款是对客户的交代）。 */}
        {row.transfer && (
          <span className="font-mono text-[10px] text-adm-t2">
            {row.transfer.purpose === 'CLIENT_ADVANCE' ? 'Advance' : 'Compensation'}{' '}
            <Link to={`/admin/custody/internal-transfers/${encodeURIComponent(row.transfer.transferNo)}`} className="text-adm-blue hover:underline">{row.transfer.transferNo}</Link>
            {' · '}{TRANSFER_STATUS_WORD[row.transfer.status] ?? row.transfer.status}
          </span>
        )}
        {row.nextStep?.kind === 'COMPENSATION' && !canFundClient && (
          <span className="font-mono text-[10px] text-adm-amber">Pending compensation (initiated by treasury)</span>
        )}
      </div>
    );
  };

  // Resolve 菜单的分组与条目。组序固定 Follow up → Fix the books → Hand off → Hold；
  // 处置条目来自 row.dispositions（后端下发的 label 与顺序，前端不另编），点下去的
  // 行为与旧按钮逐一相同。
  const buildResolveGroups = (row: FlowComparisonRow): ResolveMenuGroup[] => {
    const ns = row.nextStep;
    const canPickDisposition = kase.status === 'OPEN' && canRecordDisposition;
    // ⚡ 演示推荐：仅模拟开关开启时；推荐的成因被暂停时不推荐。
    const recommended = simEnabled && row.demoRecommended && !PAUSED_CAUSES[row.demoRecommended.causeCode]
      ? row.demoRecommended : undefined;
    const currentKind = row.disposition ? (OUTLET_TO_KIND[row.disposition.outlet] ?? row.disposition.outlet) : undefined;
    const tagFor = (kind: string): ResolveMenuItem['tag'] =>
      recommended?.disposition === kind ? { text: `⚡ #${recommended.scenarioId}`, tone: 'amber' }
        : currentKind === kind ? { text: 'current', tone: 'muted' }
        : undefined;

    // 某组的处置条目：保持后端顺序；每个处置种类各自的写权限——整体已被
    // canRecordDisposition 门控，这里只筛后续动作走不通的那几种（同既有
    // canCreateAdjustment/canSupplement/canRegisterIncident 三个变量的既有约定，不新开权限口径）。
    const dispositionItems = (kinds: string[]): ResolveMenuItem[] => {
      if (!canPickDisposition) return [];
      return (row.dispositions ?? [])
        .filter((d) => kinds.includes(d.kind))
        .filter((d) => d.kind === 'SUPPLEMENT' ? canSupplement
          : d.kind === 'INCIDENT' ? canRegisterIncident
          : HOLD_KINDS.includes(d.kind) ? true
          : canCreateAdjustment) // CORRECT/REVERSE/RECORD/REATTRIBUTE
        .map((d) => ({
          key: d.kind,
          label: d.label,
          tag: tagFor(d.kind),
          // 这个处置在本行可选的成因全被暂停（如 OUT 行的 Supplement 只有 Deposit recalled）
          // ——菜单里直接置灰，不让人点进弹窗才发现无一可选。
          disabledNote: d.causes.length > 0 && d.causes.every((c) => PAUSED_CAUSES[c.code])
            ? PAUSED_CAUSES[d.causes[0].code] : undefined,
          onSelect: () => {
            if (HOLD_KINDS.includes(d.kind)) onOpenHold(row, d.kind as 'HOLD_NEXT_PERIOD' | 'HOLD_INVESTIGATING');
            // Task 8：CORRECT/REVERSE/RECORD 三族原子一窗——直接开调账
            // 弹层的 kind 模式，不再先记一遍定性（拆两段流）。
            else if (d.kind === 'CORRECT' || d.kind === 'REVERSE' || d.kind === 'RECORD') onOpenAdjustKind(row, d.kind);
            else onOpenFinding(row, d.kind, d.label);
          },
        }));
    };

    // Follow up：财务已选的处置卡在动钱那一步（认领退汇余额不够）时才有——接着做选好
    // 的那个处置，不是系统替财务挑新处置。「入金被退汇」暂停期间两项置灰。
    const followUp: ResolveMenuItem[] = [];
    if (ns?.kind === 'ADVANCE') {
      const disabledNote = PAUSED_CAUSES.BOUNCED_FUNDS;
      if (canFundClient) {
        followUp.push({ key: 'ADVANCE', label: 'Initiate advance', onSelect: () => onOpenFunding(row), disabledNote });
      }
      // Recon phase 3 (Task 12): B batch deposit-recall claim insufficient
      // balance (ADVANCE) — "Register shortfall" prefilled with
      // CLIENT_SHORTFALL/customer/shortfall amount/advance transfer no (only when
      // row.transfer is already a CLIENT_ADVANCE transfer). Once registered it
      // becomes a badge in Status, not a second entry point — the dedup check keys
      // on kase.incidents (case-level, by sourceCaseNo), so the case no MUST be
      // included here or the dedup check can never find it and the entry never converges.
      if (canRegisterIncident && !existingClientShortfall) {
        followUp.push({
          key: 'CLIENT_SHORTFALL',
          label: 'Register shortfall',
          disabledNote,
          onSelect: () => navigate(buildIncidentHref({
            type: 'CLIENT_SHORTFALL',
            sourceCaseNo: kase.caseNo,
            customerNo: ns.customerNo,
            assetCode: kase.assetCode,
            amount: minorToMajorPlain(ns.amount, kase.decimals),
            sourceAdvanceTransferNo: row.transfer?.purpose === 'CLIENT_ADVANCE' ? row.transfer.transferNo : undefined,
            title: `Deposit-recall shortfall · customer ${ns.customerNo ?? '—'}`,
            description: `After the deposit-recall claim, customer wallet ${ns.walletNo ?? '—'} has insufficient balance. `
              + `The firm advances the shortfall of ${minorToMajorPlain(ns.amount, kase.decimals)} ${kase.assetCode} first; register the shortfall for later recovery.`,
          })),
        });
      }
    }

    // Fix the books：超期放开的核销 / 认损跟其它处置同级，排在组尾、不高亮。
    const fixBooks = dispositionItems(['CORRECT', 'REVERSE', 'RECORD', 'REATTRIBUTE']);
    if (ns?.kind === 'WRITE_OFF' && kase.status === 'OPEN' && canCreateAdjustment) {
      fixBooks.push({
        key: 'WRITE_OFF',
        label: ns.reasonCode === 'UNEXPLAINED_CLIENT_LOSS' ? 'Recognize loss' : 'Write off',
        onSelect: () => onOpenWriteOff(row),
      });
    }

    // Hand off：同理，超期大额的「升级事故」排在组尾。
    const handOff = dispositionItems(['SUPPLEMENT', 'INCIDENT']);
    if (ns?.kind === 'INCIDENT_DEFERRED' && !existingLargeUnexplained && canRegisterIncident) {
      handOff.push({
        key: 'LARGE_UNEXPLAINED',
        label: 'Escalate to incident',
        onSelect: () => navigate(buildIncidentHref({
          type: 'LARGE_UNEXPLAINED',
          sourceCaseNo: kase.caseNo,
          // C1 挂接链评审修复：不带这个号，后端 attachIncident 的唯一
          // 调用点（前提是 dto.sourceDispositionNo 存在）永远不会触发——
          // 事故定了损也回写不到这行上。该入口出现的前提本就是行已定性
          // 挂起·调查中（INCIDENT_DEFERRED），disposition 必在。
          sourceDispositionNo: row.disposition!.dispositionNo,
          customerNo: kase.ownerNo,
          assetCode: kase.assetCode,
          amount: minorToMajorPlain(ns.amount, kase.decimals),
          title: `Large unexplained · case ${kase.caseNo}`,
          description: `Wallet ${kase.walletNo ?? '—'}'s difference is overdue and its cause could not be determined. Amount ${minorToMajorPlain(ns.amount, kase.decimals)} ${kase.assetCode} `
            + `exceeds the small-amount threshold — escalating to an incident. Finding: ${row.disposition!.findingNote}`,
        })),
      });
    }

    return [
      { title: 'Follow up', items: followUp },
      { title: 'Fix the books', items: fixBooks },
      { title: 'Hand off', items: handOff },
      { title: 'Hold', items: dispositionItems(HOLD_KINDS) },
    ];
  };

  // 动作控件：至多一个，挂在 Status 列标签下面。
  const renderAction = (row: FlowComparisonRow) => {
    if (row.matchType === 'MATCHED') return null;
    if (row.matchType === 'IN_TRANSIT') {
      // 在途——差异会随资金单落地自然消失，动作是推单不是处置。
      // Task 7：划转腿由划转工作流推进、资金单页无替代动作（推单已在
      // 后端 loadPushable 显式拒），行上不再给「Push order →」诱饵，
      // 改指向划转详情——row.transfer 存在即是划转腿，优先于 fundsOrderNo 判断。
      return row.transfer ? (
        <Link
          to={`/admin/custody/internal-transfers/${encodeURIComponent(row.transfer.transferNo)}`}
          className="whitespace-nowrap font-mono text-[10px] font-medium text-adm-blue hover:underline"
        >
          Transfer leg →
        </Link>
      ) : row.fundsOrderNo ? (
        <Link
          to={`/admin/funds-orders/${encodeURIComponent(row.fundsOrderNo)}`}
          className="whitespace-nowrap font-mono text-[10px] font-medium text-adm-blue hover:underline"
        >
          Push order →
        </Link>
      ) : (
        <span className="text-[10px] text-adm-t3">In-transit · no funds order</span>
      );
    }
    // 锁定 = 行上已经挂着一张走不掉的单（调账单 / 补单）——那条单号本身就是唯一出口，
    // 不该再给别的入口制造「两条并行结论」的假象；未挂单（含从未定性、挂起、已登记事故）
    // 都不锁，仍可改处置。覆盖/重定语义——挂起是临时状态，再选一次就是换一个结论（承接④）。
    const locked = !!(row.explainedByAdjustmentNo || row.disposition?.adjustmentNo || row.disposition?.supplementNo);
    if (locked) {
      // 锁定后只剩跟进的事：认损落账后给客户补款（金额在补款弹窗里锁定，按钮词保持简短）。
      return row.nextStep?.kind === 'COMPENSATION' && canFundClient ? (
        <button
          type="button"
          onClick={() => onOpenFunding(row)}
          className="rounded border border-adm-blue/30 bg-adm-blue/10 px-1.5 py-0.5 text-left font-mono text-[10px] font-medium text-adm-blue hover:bg-adm-blue/20"
        >
          Initiate compensation
        </button>
      ) : null;
    }
    return <ResolveMenu groups={buildResolveGroups(row)} />;
  };

  return (
    <>
          {/* 5. Differences (renamed from the old Flow Drilldown card, Task 8) —
              single mixed table, no grouped sections: orphans/mismatches sort
              first, then in-transit, then MATCHED collapsed behind a toggle
              below. Status column (200px: label + at most one control, stacked) + Reference
              truncated via ShortRef — the changes that cure horizontal scroll at
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
                    <th className="w-[200px] px-3 py-2 font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-adm-t3">
                      Status
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
                          {/* 方案乙：Status 列——一个标签在上、至多一个控件在下（详见文件头注释）。
                              同一形状同一入口——给不同按钮会假装机器知道些它不知道的
                              东西，差异化发生在人在弹层里选了成因之后。 */}
                          <td className="px-3 py-3">
                            <div className="flex flex-col items-start gap-1.5">
                              {renderStatus(row)}
                              {renderAction(row)}
                            </div>
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
