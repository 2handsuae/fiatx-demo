// admin-web/src/components/ReconciliationAdjustmentCreateModal.tsx
//
// 平账一期·调账单 Task 7——从案件详情页的 flowComparison 行开单。
// 表单字段：成因 / 方向 / 金额 / 生效日期 / 关联原单号 / 内部原因 / 客户可见原因。
// 表单里没有「账簿」也没有「谁承担」——账簿取自案件（由父组件传入、只读回显），
// 承担方这个概念一期整个不存在（spec §0 问题 6，Task 7 brief）。
//
// 成因清单是 REASON_SPECS 的前端镜像（backend 唯一真相源见 adjustment-rules.ts）；
// 与本文件其它枚举镜像（如 StatusPill 的状态色表）同款约定——业务规则变了两边都要改，
// 这是本仓库既有取舍，不是本次新发明。
//
// 提交是「开单 + 提审」两步接力成一个操作（brief §Step3：创建成功 → 调 submit →
// 跳详情页），不留一个「已创建草稿待手动提审」的中间态给操作员管理。
//
// 平账一期半（T9）——从处置弹层（Task 8）交回来的「锁定视图」：成因和方向已经由
// 后端 cause-registry.ts 判死，这里只回显、不给下拉（收窄见 spec §3.3）。改记族
// （REATTRIBUTE）额外换一屏：选对端案件，金额只读、无方向可选。`locked` 缺省时
// 表单退回 Task 7 原样——案件级入口开单仍然是「运营自己判断成因」的路子。
//
// 平账处置改版 Task 8（调账四族一窗到底）：CORRECT/REVERSE/RECORD 三族改走新的
// 「按处置进入」模式（props: kind + row，见 isKindMode）——原来「先 POST
// /dispositions 记定性 → 再开本弹层自由填表」两段流已拆掉（案件页不再为这三族调
// /dispositions），原因码单选来自 row.dispositions[kind].causes，方向/金额/生效日
// 全部只读推导（deriveKindDirection），提交一次性走原子端点（causeCode+findingNote+
// disposition+行事实，Task 3 已建）。`locked` 优先于 `kind`——REATTRIBUTE/WRITE_OFF
// 两族仍走锁定视图，不受影响。
import { useEffect, useState } from 'react';
import { adminButtonClass } from './common/adminButtonStyles';
import {
  AdminSessionError,
  adminFetch,
  getApiErrorMessage,
} from '../utils/adminFetch';
// 循环 import——ReconciliationDispositionModal.tsx 已有同款先例（page 引 modal，
// modal 引 page 的具名导出），Vite/esbuild 对这种「模块顶层不互相求值」的循环没问题。
import { formatAmount, type FlowComparisonRow } from '../pages/ReconciliationCasesDetailPage';
// Task 8：kind 模式复用行事实推导（deltaSign/internalDirection/…）与方向依据文案，
// 与案件页 DispositionFindingModal 同一份工具，不另抄一份。
import { directionNoteFor, rowFacts } from '../utils/causeRegistry';

export type AdjustmentBook = 'CLIENT' | 'FIRM';
export type AdjustmentDirection = 'REDUCE' | 'INCREASE';

interface ReasonMeta {
  book: AdjustmentBook;
  directions: AdjustmentDirection[];
  label: string;
}

// 前端镜像 backend REASON_SPECS（src/modules/clearing-settle/reconciliation/
// disposition/adjustment-rules.ts）**旧八码**下拉数据源——「运营自己选成因」那条
// 老通道（!locked && !isKindMode 分支，见下方 reasonOptions）。Task 8 起
// CORRECT/REVERSE/RECORD 三族改走 kind 模式（原因码来自 row.dispositions[kind].causes，
// 不读这张表）、REATTRIBUTE/WRITE_OFF 两族走锁定视图（同样不读）——现存调用点已无人
// 传空 locked+空 kind 打开这条自由选择分支，故它结构性地留空（Task 13 退役旧八码时
// 未见真实消费者，见 task-13-report.md 零残余证明）。留着这张空表 + 下方分支只是不
// 越界删掉一整个表单模式；若以后要接一个新的「自由选成因」入口，往这里加条目即可。
export const REASON_META: Record<string, ReasonMeta> = {};

// 展示用成因词表（超集，铁律⑥ demo-visible：详情页 / 调账单列表 / 锁定视图回显用）。
// Task 13：REASON_META 旧八码清空后不能再从它派生——直接列出单码制 11 码（词取
// cause-registry.ts CAUSE_REGISTRY 同名 label）+ OTHER + 第四/五族三码，与
// adjustment-rules.ts REASON_SPECS 的 15 个 ReasonCode 一一对应，缺一个这里就会有
// 一行调账单 Reason 列显示裸码（Task 12 发现的真实回归）。
export const REASON_LABEL: Record<string, string> = {
  AMT_MISBOOKED: 'Amount misbooked',
  AMT_FEE_NETTED: 'Bank fee netted',
  AMT_ROUNDING: 'Rounding difference',
  DUP_BOOKING: 'Duplicate posting (twin)',
  PHANTOM_BOOKING: 'Phantom posting',
  PAYOUT_NOT_EXECUTED: 'Payout not executed',
  FIRM_AMT_UNDERBOOKED: 'Firm amount underbooked',
  FIRM_AMT_OVERBOOKED: 'Firm amount overbooked',
  FIRM_MISBOOKED: 'Firm entry error',
  BANK_INTEREST_UNBOOKED: 'Bank interest unbooked',
  BANK_CHARGE_UNBOOKED: 'Bank charges unbooked',
  OTHER: 'Other',
  CUSTOMER_REATTRIBUTION: 'Customer reattribution',
  UNEXPLAINED_WRITE_OFF: 'Unexplained write-off',
  UNEXPLAINED_CLIENT_LOSS: 'Client loss recognition',
};

// T9：族的中文词——本文件内常量，不是共享注册表（唯一真相仍在后端
// cause-registry.ts AdjustFamily；这里只是锁定视图要拼一句回显文案）。
const FAMILY_WORD: Record<string, string> = {
  CORRECT: 'Correction', REVERSE: 'Reversal', RECORD: 'Record entry', REATTRIBUTE: 'Reattribution', WRITE_OFF: 'Write-off',
};

// T9：锁定视图的弹层标题——每族一句白话，说清这张单要干什么（不是简单复述族名）。
// Task 8 起 CORRECT/REVERSE/RECORD 三条不再被 locked 模式使用（那三族改走下面的
// kind 模式），标题文案原样保留给 kind 模式复用——同一句话，不重抄一份。
const LOCKED_TITLE: Record<string, string> = {
  CORRECT: 'Correction · Fix the amount to the right figure',
  REVERSE: 'Reversal · Undo this posting',
  RECORD: 'Record entry · Book a firm-side receipt or charge',
  REATTRIBUTE: 'Reattribution · Move the funds to the right owner',
  WRITE_OFF: 'Write-off · Unexplained, the firm absorbs it',
};

// Task 8（调账四族一窗到底）：kind 模式的原因码全部来自 row.dispositions[kind].causes
// （唯一真相在后端 cause-registry.ts CAUSE_REGISTRY），这里只镜像它们的客户面文案
// （backend adjustment-rules.ts REASON_SPECS.customerLabel）——Customer-facing note
// 预填用。公司侧成因客户看不到（customerLabel 为 null），预填一句中性内部备注。
// 镜像约定同 REASON_META 头注释：业务规则变了两边都要改，这是本仓库既有取舍。
const CAUSE_CUSTOMER_LABEL: Record<string, string | null> = {
  AMT_MISBOOKED: 'Balance correction',
  AMT_FEE_NETTED: 'Balance correction',
  AMT_ROUNDING: 'Balance correction',
  DUP_BOOKING: 'Duplicate deposit reversal',
  PHANTOM_BOOKING: 'Deposit reversal',
  PAYOUT_NOT_EXECUTED: 'Withdrawal refund',
  FIRM_AMT_UNDERBOOKED: null,
  FIRM_AMT_OVERBOOKED: null,
  FIRM_MISBOOKED: null,
  BANK_INTEREST_UNBOOKED: null,
  BANK_CHARGE_UNBOOKED: null,
  OTHER: 'Balance correction',
};
const FIRM_SIDE_CUSTOMER_NOTE = '(Firm-side entry; not visible to the customer)';

// Task 8：方向推导——镜像后端 cause-registry.ts 的 signedDeltaSign/resolveOutlet 公式。
// 原子路径下 record() 只校验「码是否归属所选处置」，不重算方向对不对——Direction 一旦
// 在这个模式下锁定只读，就是唯一权威，算错会静默把钱记反、无人拦（交接清单原话）。
// resolveOutlet 逐支验证过：这条公式只看 matchType（+ deltaSign/internalDirection/
// externalDirection 行事实），与具体选中哪个原因码、甚至哪个 family（CORRECT/
// REVERSE/RECORD）都无关——AMOUNT_MISMATCH 格三族共用 signedDeltaSign，
// ORPHAN_INTERNAL 格（只有 REVERSE 落这格）共用内部方向取反，ORPHAN_EXTERNAL 格
// （只有 RECORD 落这格）共用外部方向照搬。故不需要 kind/causeCode 入参。
const deriveKindDirection = (row: FlowComparisonRow): AdjustmentDirection => {
  const signedDeltaSign = (): 1 | -1 => {
    const raw: 1 | -1 = row.deltaAmount?.startsWith('-') ? -1 : 1;
    // 出账流水翻符号：提现内部记 90、银行实扣 100，原始差 +10，但这 10 是客户余额
    // 多出来的，得减——与 cause-registry.ts signedDeltaSign 同一段推导。
    return row.internalFlow?.direction === 'OUT' ? (raw === 1 ? -1 : 1) : raw;
  };
  if (row.matchType === 'AMOUNT_MISMATCH') return signedDeltaSign() === -1 ? 'REDUCE' : 'INCREASE';
  if (row.matchType === 'ORPHAN_INTERNAL') return row.internalFlow?.direction === 'OUT' ? 'INCREASE' : 'REDUCE';
  return row.externalLine?.direction === 'IN' ? 'INCREASE' : 'REDUCE'; // ORPHAN_EXTERNAL
};

// T9：处置弹层（Task 8）交回来的锁定态——成因/方向已由后端判死，这里只回显。
// toCandidatesUrl 只在 family === 'REATTRIBUTE' 时有值（父组件按 row.matchType
// 算好 side、按 rowAdjustmentPrefill 算好 amount 拼出的候选查询路径，见
// ReconciliationCasesDetailPage.tsx buildAdjustLocked）——本组件不重算这两个值，
// 避免「查候选用一个数、开单用另一个数」两处各算一遍出现分歧。
export interface AdjustmentLocked {
  dispositionNo: string;
  family: string;
  reasonCode?: string;
  direction?: AdjustmentDirection;
  directionNote: string;
  toCandidatesUrl?: string;
  /** 平账 A 批：核销锁定视图——金额 / 生效日只读，说明预填查证结论。
   *  平账处置改版 Task 10：source 区分解锁来源——账龄超期（既有四前提：超期 /
   *  定性=挂起·调查中 / ≤ 小额线 / 账簿）vs 事故已定损（spec §4 M12 三前提：
   *  事故号+FIRM_LOSS / 金额锁定损额 / 小额线不适用）。判定来源 = 行上
   *  disposition.incidentNo 是否非空（父组件 openWriteOff 判），本组件只按
   *  source 渲染对应文案，不重新判断来源。incidentNo/assessedDisplay 只在
   *  source === 'INCIDENT' 时有值。 */
  writeOff?: { findingNote: string; source: 'AGING' | 'INCIDENT'; incidentNo?: string; assessedDisplay?: string };
}

// 改记对端候选——GET reattribution-candidates 的返回行（disposition.service.ts
// ReattributionCandidate 同形状）。anchorId 是内部证据 id（account_flows.id /
// external_statement_lines.id），只用于选中后拼提交体，不在界面上展示（铁律⑥）。
interface ReattributionCandidateRow {
  caseNo: string;
  walletNo: string | null;
  ownerNo: string | null;
  anchorId: string;
  externalRef: string | null;
  amount: string;
}

// 分→元 的可编辑显示值（区别于 formatAmount：那个是千分位展示用，不能拿来回填
// input——逗号会把用户输入搅乱）。bigint-safe：只做字符串切分，不过一次浮点。
const minorToDisplay = (raw: string, decimals: number): string => {
  const s = String(raw ?? '0');
  let neg = false; let body = s;
  if (body.startsWith('-')) { neg = true; body = body.slice(1); }
  if (decimals === 0) return `${neg ? '-' : ''}${body || '0'}`;
  const padded = body.padStart(decimals + 1, '0');
  const intPart = padded.slice(0, padded.length - decimals) || '0';
  const fracPart = padded.slice(padded.length - decimals);
  return `${neg ? '-' : ''}${intPart}.${fracPart}`;
};

// 反向：操作员输入的元 → 分（最小单位整数字符串，CreateAdjustmentDto.amount 要
// 的形状）。非法输入（非数字/小数位超过资产精度）返回 null，调用方据此禁用提交
// ——这是把"输入还原成数字"这件事做对，不是防御性校验（没有它表单根本不能用）。
const displayToMinor = (display: string, decimals: number): string | null => {
  const trimmed = display.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null;
  const [intPart, fracPart = ''] = trimmed.split('.');
  if (fracPart.length > decimals) return null;
  const combined = `${intPart}${fracPart.padEnd(decimals, '0')}`.replace(/^0+(?=\d)/, '');
  return combined || '0';
};

export interface AdjustmentPrefill {
  amountMinor: string;                       // 最小单位（分）整数字符串，来自 flowComparison 行
  direction: AdjustmentDirection | '';        // 猜测性默认值，表单里仍可改
  relatedOrderNo: string;                     // 仅 IN_TRANSIT 行有（该行的 fundsOrderNo）
  // ④ 这张单在解释哪一条差异——锚在真实证据 id 上（内部流水 / 外部对账单行），
  // 后端据此在下一轮对账里把这条差异从异常数里摘掉，案子才平得下来。
  // 从案件级入口开单时两个都空：那是纯补余额，不摘任何差异行。
  explainedFlowId?: string;
  explainedExternalLineId?: string;
}

interface ReconciliationAdjustmentCreateModalProps {
  open: boolean;
  caseNo: string;
  /** 案件业务日（YYYY-MM-DD）——生效日的默认值，见 effectiveDate 初值处注释。 */
  caseBusinessDate: string;
  book: AdjustmentBook;
  assetCode: string;
  decimals: number;
  // T9：本案（caseNo）的客户号/钱包号——只在改记摘要行「从 A 改记到 B」需要展示
  // 「本案是哪一方」时用（铁律⑥ 展示一律业务键）；非改记族不读这两个字段。
  ownerNo?: string | null;
  walletNo?: string | null;
  prefill: AdjustmentPrefill;
  /** T9：处置弹层交回的锁定态；缺省 = Task 7 原样的自由选择表单。 */
  locked?: AdjustmentLocked;
  // Task 8（调账四族一窗到底）：CORRECT/REVERSE/RECORD 三族的「按处置进入」模式——
  // 点差异行按钮直接开本弹层，不再先 POST /dispositions 走两段流。kind + row 成对
  // 出现（row 缺省时 kind 不生效，退回 locked/自由选择两条既有路）。原因码来自
  // row.dispositions 里对应 kind 的 causes；方向/金额/生效日只读推导，不给编辑。
  kind?: 'CORRECT' | 'REVERSE' | 'RECORD';
  row?: FlowComparisonRow;
  onClose: () => void;
  onCreated: (adjustmentNo: string) => void;
}

const ReconciliationAdjustmentCreateModal = ({
  open,
  caseNo,
  caseBusinessDate,
  book,
  assetCode,
  decimals,
  ownerNo,
  walletNo,
  prefill,
  locked,
  kind,
  row,
  onClose,
  onCreated,
}: ReconciliationAdjustmentCreateModalProps) => {
  const [reasonCode, setReasonCode] = useState('');
  const [direction, setDirection] = useState<AdjustmentDirection | ''>('');
  const [amountDisplay, setAmountDisplay] = useState('');
  // Task 8：kind 模式 OTHER 码的必填手写框——与 reasonInternal（查证说明）分开：
  // 前者是「这个 Other 具体指什么」，后者是「查过什么、结论依据」，两者都要。
  const [otherReason, setOtherReason] = useState('');
  // ⚠ 2026-08-29 修正：默认值从 todayStr() 改成案件业务日。
  // 一张调账单修的是**案件那一天**的账，所以生效日必须落在那一天的账期里——
  // 这正是账本 effectiveDate 字段存在的意义（effective-cutoff.ts 按生效日卡截止点）。
  // 原来默认"今天"时：案件业务日 8-28、生效日 8-29，重跑 8-28 的对账取不到这笔
  // 分录，调账单落了账、内部余额一分没动，差额永远归不了零（业主走查实证）。
  // 后端 createDraft 有对应守卫：生效日晚于案件业务日直接 400。
  const [effectiveDate, setEffectiveDate] = useState(caseBusinessDate);
  const [relatedOrderNo, setRelatedOrderNo] = useState('');
  const [reasonInternal, setReasonInternal] = useState('');
  const [reasonCustomer, setReasonCustomer] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  // T9 改记视图：对端候选（GET reattribution-candidates）+ 单选状态。用下标而不是
  // caseNo 当选中键——候选理论上可能同案件多行命中同金额（同一对端案子里凑巧有
  // 两笔孤儿同额），caseNo 不保证唯一，下标总唯一。
  const [candidates, setCandidates] = useState<ReattributionCandidateRow[]>([]);
  const [candidatesLoading, setCandidatesLoading] = useState(false);
  const [candidatesError, setCandidatesError] = useState('');
  const [selectedCandidateIdx, setSelectedCandidateIdx] = useState<number | null>(null);

  const isReattribute = locked?.family === 'REATTRIBUTE';
  const isWriteOff = locked?.family === 'WRITE_OFF';
  // Task 8：kind 模式——locked 缺省时才生效（locked 优先级更高，覆盖 REATTRIBUTE/
  // WRITE_OFF 两族既有流程不受影响）。row 缺省时 kind 不生效，退回自由选择表单。
  const isKindMode = !locked && !!kind && !!row;
  const kindCauses = (isKindMode && row?.dispositions?.find((d) => d.kind === kind)?.causes) || [];
  // 哪一行是「本行」在改记里决定了提交体怎么拼：ORPHAN_INTERNAL（我有外无=错记方）
  // 只带 explainedFlowId，ORPHAN_EXTERNAL（外有我无=正主方）只带
  // explainedExternalLineId（reconciliation-query.service.ts 对两类行的构造保证
  // 互斥，见 :890/:917）——哪个有值就天然指示本行是哪一边，不用再传一个
  // matchType/side 字段。
  const side: 'FROM' | 'TO' = prefill.explainedFlowId ? 'FROM' : 'TO';

  useEffect(() => {
    if (!open) return;
    // Task 8：kind 模式——单选项直接预选（同 DispositionFindingModal 既有惯例，
    // menuFor 只剩一个选项时不用让人多点一次）；多选项留空，等人挑。方向不看选了
    // 哪个原因码（同 family × matchType 组合下公式一致，见 deriveKindDirection 头
    // 注释），行一到手就能算，不用等选码。
    const initialKindCause = isKindMode && kindCauses.length === 1 ? kindCauses[0].code : '';
    setReasonCode(locked ? (locked.reasonCode ?? 'CUSTOMER_REATTRIBUTION') : (isKindMode ? initialKindCause : ''));
    setDirection(locked ? (locked.direction ?? '') : (isKindMode && row ? deriveKindDirection(row) : ''));
    setAmountDisplay(prefill.amountMinor ? minorToDisplay(prefill.amountMinor, decimals) : '');
    setEffectiveDate(caseBusinessDate);
    // kind 模式：原单号不是手填的——同一条行的内部流水自带的业务单号（sourceNo），
    // 证据区只读展示，也就是要提交的 relatedOrderNo（见 submit() 里 body 拼装）。
    setRelatedOrderNo(isKindMode ? (row?.internalFlow?.sourceNo ?? '') : (prefill.relatedOrderNo ?? ''));
    setOtherReason('');
    setReasonInternal(locked?.writeOff ? `${locked.reasonCode === 'UNEXPLAINED_CLIENT_LOSS' ? 'Client pool loss recognition' : 'Firm pool unexplained write-off'}: ${locked.writeOff.findingNote}` : '');
    setReasonCustomer(
      locked?.writeOff
        ? (locked.reasonCode === 'UNEXPLAINED_CLIENT_LOSS' ? 'Balance adjustment (custody shortfall recognized as loss; the firm will compensate)' : '(Firm-side write-off; not visible to the customer)')
        : (isKindMode && initialKindCause ? (CAUSE_CUSTOMER_LABEL[initialKindCause] ?? FIRM_SIDE_CUSTOMER_NOTE) : ''),
    );
    setError('');
    setCandidates([]);
    setCandidatesError('');
    setSelectedCandidateIdx(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Task 8：kind 模式选原因码——客户面备注（customerLabel）随之预填；查证说明与
  // Other 手写框不联动重置（换个码不该抹掉已经写了一半的查证记录）。
  const pickKindCause = (code: string) => {
    setReasonCode(code);
    setReasonCustomer(CAUSE_CUSTOMER_LABEL[code] ?? FIRM_SIDE_CUSTOMER_NOTE);
  };

  // T9 改记视图：打开时拉一次对端候选。toCandidatesUrl 由父组件按这一行的
  // matchType 算好 side、按 rowAdjustmentPrefill 算好 amount 拼好——本组件原样
  // fetch，不重算 side/amount（避免查候选与开单两处各算一遍出现分歧）。
  useEffect(() => {
    if (!open || !isReattribute || !locked?.toCandidatesUrl) return;
    let cancelled = false;
    setCandidatesLoading(true);
    setCandidatesError('');
    (async () => {
      try {
        const res = await adminFetch(`${import.meta.env.VITE_API_URL}${locked.toCandidatesUrl}`);
        if (!res.ok) {
          throw new Error(await getApiErrorMessage(res, 'Failed to load reattribution candidates.'));
        }
        const list = (await res.json()) as ReattributionCandidateRow[];
        if (!cancelled) setCandidates(list);
      } catch (e) {
        if (e instanceof AdminSessionError) return;
        if (!cancelled) setCandidatesError(e instanceof Error ? e.message : 'Failed to load reattribution candidates.');
      } finally {
        if (!cancelled) setCandidatesLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const selectedCandidate = selectedCandidateIdx != null ? candidates[selectedCandidateIdx] : null;
  // 摘要行左右两方——side=FROM 时本案是错记方、候选是正主；side=TO 时对调。
  const fromParty = side === 'FROM'
    ? { ownerNo: ownerNo ?? '—', walletNo: walletNo ?? '—' }
    : { ownerNo: selectedCandidate?.ownerNo ?? '—', walletNo: selectedCandidate?.walletNo ?? '—' };
  const toParty = side === 'FROM'
    ? { ownerNo: selectedCandidate?.ownerNo ?? '—', walletNo: selectedCandidate?.walletNo ?? '—' }
    : { ownerNo: ownerNo ?? '—', walletNo: walletNo ?? '—' };

  // 只列当前案件账簿下的成因——客户账簿案件不该看到公司侧成因，反之亦然。
  // Task 13：REASON_META 现为空表（头注释），这条分支结构性地渲染不出任何选项。
  const reasonOptions = Object.entries(REASON_META).filter(([, meta]) => meta.book === book);
  // 改记族锁定态把 reasonCode 初始化成 'CUSTOMER_REATTRIBUTION'——它不在这份前端
  // 镜像表里（改记走独立视图，不用「成因下拉→方向下拉」这条老路），直接下标会
  // 炸（对象 undefined 取 .directions）。这条分支本就不渲染方向下拉
  // （isReattribute 时方向区整段隐藏），空数组只是让这行算式本身不再崩。
  const directionOptions = reasonCode ? (REASON_META[reasonCode]?.directions ?? []) : [];

  const pickReason = (code: string) => {
    setReasonCode(code);
    if (!code) { setDirection(''); return; }
    const dirs = REASON_META[code].directions;
    if (dirs.length === 1) {
      setDirection(dirs[0]);
    } else if (prefill.direction && dirs.includes(prefill.direction)) {
      setDirection(prefill.direction);
    } else {
      setDirection(dirs[0]);
    }
  };

  // 改记必须指向一张已存在的原单——与「客户账簿加钱」同一条边界线守卫（KYT 对这
  // 笔钱跑过才放行），backend createReattributionDraft 无条件要求，不看 direction
  // （见 adjustment.service.ts:205-208）。
  const needsRelatedOrder = isReattribute || (book === 'CLIENT' && direction === 'INCREASE');
  const amountMinor = displayToMinor(amountDisplay, decimals);
  const amountValid = amountMinor !== null && amountMinor !== '0';

  const submitDisabled =
    submitting ||
    !reasonCode ||
    // 改记没有方向（direction state 恒为 ''——locked.direction 后端本来就不给这一
    // 族），跳过这条闸；其余三族仍要求方向已锁定成一个具体值。
    (!isReattribute && !direction) ||
    !amountValid ||
    !effectiveDate ||
    (needsRelatedOrder && !relatedOrderNo.trim()) ||
    !reasonInternal.trim() ||
    !reasonCustomer.trim() ||
    (isReattribute && (candidatesLoading || !selectedCandidate)) ||
    // Task 8：kind 模式选 Other 时手写框必填（同 DispositionFindingModal 既有惯例）。
    (isKindMode && reasonCode === 'OTHER' && !otherReason.trim());

  const submit = async () => {
    if (submitDisabled || amountMinor === null) return;
    if (isReattribute && !selectedCandidate) return; // submitDisabled 已挡，这里只是给 TS 收窄类型
    setSubmitting(true);
    setError('');
    try {
      const body: Record<string, unknown> = {
        reasonCode,
        // 改记的 direction 不参与任何语义（CUSTOMER_REATTRIBUTION 的 directions 是
        // 空数组，assertReasonAllowed 对它任何方向都拒——createReattributionDraft
        // 在那道闸之前就把它分流出去了，dto.direction 整段被忽略，见
        // adjustment.service.ts:101-107/222）。DTO 校验仍要求 REDUCE|INCREASE 之一，
        // 随手给个合法值让它过闸，后端不会读它。
        direction: isReattribute ? 'REDUCE' : direction,
        amount: (isReattribute || isWriteOff || isKindMode) ? prefill.amountMinor : amountMinor,
        effectiveDate,
        reasonInternal: reasonInternal.trim(),
        reasonCustomer: reasonCustomer.trim(),
      };
      if (relatedOrderNo.trim()) body.relatedOrderNo = relatedOrderNo.trim();
      if (locked?.dispositionNo) body.dispositionNo = locked.dispositionNo;

      // Task 8：kind 模式——原子路径（POST 一次落定性 + 开单 + 挂号，Task 3 已建）。
      // causeCode = reasonCode（单码制，闸门要求两者相等）；disposition 显式带上
      // kind，后端 createDraft 优先信它、只在缺省时才回落 kindOfFamily(reasonCode)
      // （Other 码走这条回落会判死成 CORRECT，见 adjustment.service.ts 交接注释）；
      // 行事实（deltaSign/internalDirection/…）与案件页 DispositionFindingModal
      // 用的是同一个 rowFacts() 工具，不再自己现算一遍。
      if (isKindMode && row && kind) {
        Object.assign(body, rowFacts(row));
        body.matchType = row.matchType;
        body.causeCode = reasonCode;
        body.disposition = kind;
        body.findingNote = reasonCode === 'OTHER'
          ? `Other: ${otherReason.trim()}\n${reasonInternal.trim()}`
          : reasonInternal.trim();
      }

      if (isReattribute && selectedCandidate) {
        // 改记单永远挂在错记方名下（spec §6）：side=FROM 时本案就是错记方，直接
        // 用 caseNo/toCaseNo 原样；side=TO 时本案是正主方，caseNo/toCaseNo 与两个
        // 解释锚都要对调——搞反会让改记单挂错主体，两案都自愈不了（本任务最容易
        // 做错的一处，brief 原话）。
        if (side === 'FROM') {
          body.caseNo = caseNo;
          body.toCaseNo = selectedCandidate.caseNo;
          body.explainedFlowId = prefill.explainedFlowId;
          body.explainedExternalLineId = selectedCandidate.anchorId;
        } else {
          body.caseNo = selectedCandidate.caseNo;
          body.toCaseNo = caseNo;
          body.explainedFlowId = selectedCandidate.anchorId;
          body.explainedExternalLineId = prefill.explainedExternalLineId;
        }
      } else {
        body.caseNo = caseNo;
        if (prefill.explainedFlowId) body.explainedFlowId = prefill.explainedFlowId;
        if (prefill.explainedExternalLineId) body.explainedExternalLineId = prefill.explainedExternalLineId;
      }

      const createRes = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/reconciliation/adjustments`,
        { method: 'POST', body: JSON.stringify(body) },
      );
      if (!createRes.ok) {
        throw new Error(await getApiErrorMessage(createRes, 'Failed to create adjustment.'));
      }
      const { adjustmentNo } = (await createRes.json()) as { adjustmentNo: string };

      const submitRes = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/reconciliation/adjustments/${encodeURIComponent(adjustmentNo)}/submit`,
        { method: 'POST' },
      );
      if (!submitRes.ok) {
        throw new Error(
          `Adjustment ${adjustmentNo} was created, but submission for approval failed: ${await getApiErrorMessage(submitRes, 'Failed to submit for approval.')}`,
        );
      }
      onCreated(adjustmentNo);
    } catch (e) {
      if (e instanceof AdminSessionError) return;
      setError(e instanceof Error ? e.message : 'Failed to create adjustment.');
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  const selectCls =
    'w-full rounded border border-adm-border bg-adm-bg px-2.5 py-2 font-mono text-[11px] text-adm-t1 outline-none transition-colors focus:border-adm-amber disabled:opacity-50';
  const labelCls = 'mb-1.5 block font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-adm-t3';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-xl border border-adm-border bg-adm-panel shadow-xl">
        <div className="border-b border-adm-border px-6 py-4">
          <h2 className="text-base font-semibold text-adm-t1">
            {locked
              ? (locked.family === 'WRITE_OFF' && locked.reasonCode === 'UNEXPLAINED_CLIENT_LOSS'
                ? 'Recognize loss · Match the books to custody, firm compensates after'
                : (LOCKED_TITLE[locked.family] ?? 'Open Adjustment'))
              : isKindMode
                ? (LOCKED_TITLE[kind!] ?? 'Open Adjustment') // Task 8：三族标题原样复用 locked 视图那句话，不重抄
                : 'Open Adjustment'}
          </h2>
          <p className="mt-1 font-mono text-[10px] text-adm-t3">
            {caseNo} · {book === 'CLIENT' ? 'Client book' : 'Firm book'} · {assetCode}
          </p>
        </div>

        <div className="max-h-[70vh] overflow-y-auto px-6 py-4">
          {error && (
            <div className="mb-3 rounded border border-adm-red/30 bg-adm-red/10 px-3 py-2 font-mono text-[10px] text-adm-red">
              {error}
            </div>
          )}

          {/* Task 8：证据区（只读）——行金额 / 参考号 / 原单号，一次看清这一步在解释
              哪条真实证据。原单号有值时它就是即将随本单提交的 relatedOrderNo（见
              submit() body 拼装与下方隐去的 Related Order No 单独区块）。 */}
          {isKindMode && row && (
            <div className="mb-4 space-y-0.5 rounded border border-adm-border bg-adm-bg px-2.5 py-2 font-mono text-[11px] text-adm-t2">
              <div>Amount: <span className="text-adm-t1">{formatAmount(prefill.amountMinor, decimals)} {assetCode}</span></div>
              <div>Reference: <span className="text-adm-t1">{(row.externalLine?.externalRef ?? row.internalFlow?.externalRef) ?? '—'}</span></div>
              {row.internalFlow?.sourceNo && (
                <div>Original order: <span className="text-adm-t1">{row.internalFlow.sourceNo}</span></div>
              )}
            </div>
          )}

          {/* 平账处置改版 Task 10（M10–M12）：核销/认损锁定视图的前提清单区——
              账龄路四前提（v8-recon.md §核销/认损行）原样保留；事故路（spec §4
              M12）换成三前提，说明这张单为什么此刻能开、金额为什么锁定在这个数。
              纯展示，不参与提交体——闸真正卡在后端（assertWriteOffAllowed /
              assertIncidentWriteOffAllowed），这里只是让人看懂门是怎么开的。 */}
          {locked?.writeOff && (
            <div className="mb-4 space-y-1 rounded border border-adm-border bg-adm-bg px-2.5 py-2 font-mono text-[11px] text-adm-t2">
              <div className="mb-0.5 font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-adm-t3">
                {locked.writeOff.source === 'INCIDENT' ? 'Unlocked by · Incident loss assessment' : 'Unlocked by · Aging'}
              </div>
              {locked.writeOff.source === 'INCIDENT' ? (
                <>
                  <div>✓ Incident {locked.writeOff.incidentNo ?? '—'} · loss assessed (FIRM_LOSS)</div>
                  <div>✓ Amount locked = {locked.writeOff.assessedDisplay ?? `${formatAmount(prefill.amountMinor, decimals)} ${assetCode}`}</div>
                  <div>✓ Small-amount threshold not applicable (incident process is the large-amount control)</div>
                </>
              ) : (
                <>
                  <div>✓ Case overdue</div>
                  <div>✓ Finding = Hold · Investigating</div>
                  <div>✓ Amount ≤ small-amount threshold</div>
                  <div>✓ {book === 'CLIENT' ? 'Client book' : 'Firm book'}</div>
                </>
              )}
            </div>
          )}

          <label className={labelCls}>Reason</label>
          {locked ? (
            // T9 锁定视图：成因由上一屏（处置弹层）判死，这里只回显——不给下拉。
            // 唯一真相在后端 cause-registry.ts，前端不猜、不改。
            <div className="mb-4 rounded border border-adm-border bg-adm-bg px-2.5 py-2 font-mono text-[11px] text-adm-t1">
              [{locked.reasonCode === 'UNEXPLAINED_CLIENT_LOSS' ? 'Recognize loss' : (FAMILY_WORD[locked.family] ?? locked.family)}] {REASON_LABEL[locked.reasonCode ?? ''] ?? locked.reasonCode}
            </div>
          ) : isKindMode ? (
            // Task 8：kind 模式——原因码单选，数据来自 row.dispositions[kind].causes
            // （唯一真相在后端 cause-registry.ts）；不用 REASON_META（旧 8 码表，三族
            // 在这个模式下不用它，见文件头 T9 注释）。
            <div className="mb-4 space-y-1.5">
              {kindCauses.map((c) => (
                <label
                  key={c.code}
                  className={`flex cursor-pointer items-start gap-2 rounded border p-2 font-mono text-[11px] ${
                    reasonCode === c.code ? 'border-adm-blue/50 bg-adm-blue/10' : 'border-adm-border'
                  }`}
                >
                  <input
                    type="radio"
                    name="kind-cause"
                    checked={reasonCode === c.code}
                    onChange={() => pickKindCause(c.code)}
                    disabled={submitting}
                    className="mt-0.5"
                  />
                  <span className="flex-1">
                    <span className="text-adm-t1">{c.label}</span>
                    <div className="mt-0.5 text-adm-t3">Clue: {c.clue}</div>
                  </span>
                </label>
              ))}
              {reasonCode === 'OTHER' && (
                <div className="pt-1">
                  <label className="mb-1 block font-mono text-[9px] text-adm-t3">Describe the cause (required for Other)</label>
                  <textarea
                    value={otherReason}
                    onChange={(e) => setOtherReason(e.target.value)}
                    rows={2}
                    disabled={submitting}
                    className="w-full rounded border border-adm-border bg-adm-bg p-2 text-xs text-adm-t1"
                  />
                </div>
              )}
              {reasonCode === 'DUP_BOOKING' && row?.duplicateTwinRef && (
                <div className="rounded border border-adm-amber/30 bg-adm-amber/10 p-2 text-[11px] text-adm-t2">
                  System clue: the matched list has a line with the same reference number and amount ({row.duplicateTwinRef}) — the bank reported it once but we booked it twice, pointing to "Duplicate posting".
                </div>
              )}
            </div>
          ) : (
            <select
              value={reasonCode}
              onChange={(e) => pickReason(e.target.value)}
              disabled={submitting}
              className={`mb-4 ${selectCls}`}
            >
              <option value="">Select a cause…</option>
              {reasonOptions.map(([code, meta]) => (
                <option key={code} value={code}>
                  {meta.label} · {code}
                </option>
              ))}
            </select>
          )}

          {!isReattribute && (
            <>
              <label className={labelCls}>Direction</label>
              {(locked || isKindMode) ? (
                // T9：方向本来就能从行推出来（差额符号 / 内外部流水方向），给人改
                // 是错的——只读文本 + 一句推导依据（directionNote 由后端行事实
                // 算出，见 causeRegistry.ts directionNoteFor）。Task 8：kind 模式同款
                // 只读展示，值由 deriveKindDirection 在打开弹层时算好写进 state。
                <div className="mb-1 rounded border border-adm-border bg-adm-bg px-2.5 py-2 font-mono text-[11px] text-adm-t1">
                  {direction === 'REDUCE' ? 'Reduce' : direction === 'INCREASE' ? 'Increase' : '—'}
                </div>
              ) : (
                <select
                  value={direction}
                  onChange={(e) => setDirection(e.target.value as AdjustmentDirection)}
                  disabled={submitting || directionOptions.length <= 1}
                  className={`mb-1 ${selectCls}`}
                >
                  {directionOptions.length === 0 && <option value="">Select a cause first</option>}
                  {directionOptions.map((d) => (
                    <option key={d} value={d}>
                      {d === 'REDUCE' ? 'Reduce' : 'Increase'}
                    </option>
                  ))}
                </select>
              )}
              {locked ? (
                <p className="mb-4 font-mono text-[9px] text-adm-t3">{locked.directionNote}</p>
              ) : isKindMode && row ? (
                <p className="mb-4 font-mono text-[9px] text-adm-t3">{directionNoteFor(row.matchType)}</p>
              ) : (
                <>
                  {reasonCode && directionOptions.length === 1 && (
                    <p className="mb-4 font-mono text-[9px] text-adm-t3">This cause only allows one direction — locked.</p>
                  )}
                  {(!reasonCode || directionOptions.length !== 1) && <div className="mb-4" />}
                </>
              )}
            </>
          )}

          {isReattribute && (
            <div className="mb-4">
              <label className={labelCls}>Counterparty Case (single choice)</label>
              {candidatesLoading ? (
                <p className="font-mono text-[11px] text-adm-t3">Loading candidates…</p>
              ) : candidatesError ? (
                <p className="font-mono text-[11px] text-adm-red">{candidatesError}</p>
              ) : candidates.length === 0 ? (
                <p className="font-mono text-[11px] text-adm-red">
                  No same-day, same-amount opposite orphan found — confirm the counterparty case has produced a difference row first
                </p>
              ) : (
                <div className="space-y-1.5">
                  {candidates.map((c, idx) => (
                    <label
                      key={`${c.caseNo}-${idx}`}
                      className={`flex cursor-pointer items-start gap-2 rounded border p-2 font-mono text-[11px] ${
                        selectedCandidateIdx === idx ? 'border-adm-blue/50 bg-adm-blue/10' : 'border-adm-border'
                      }`}
                    >
                      <input
                        type="radio"
                        name="reattribution-candidate"
                        checked={selectedCandidateIdx === idx}
                        onChange={() => setSelectedCandidateIdx(idx)}
                        disabled={submitting}
                        className="mt-0.5"
                      />
                      <span className="flex-1 text-adm-t1">
                        {c.caseNo} · Customer {c.ownerNo ?? '—'} · Wallet {c.walletNo ?? '—'} · ref {c.externalRef ?? '—'}
                      </span>
                    </label>
                  ))}
                </div>
              )}
              {selectedCandidate && (
                <p className="mt-2 rounded border border-adm-blue/30 bg-adm-blue/10 px-2 py-1.5 font-mono text-[11px] text-adm-t2">
                  From {fromParty.ownerNo} ({fromParty.walletNo}) reattributed to {toParty.ownerNo} ({toParty.walletNo}) ·
                  total customer assets unchanged
                </p>
              )}
            </div>
          )}

          <label className={labelCls}>Amount ({assetCode})</label>
          {(isReattribute || isWriteOff || isKindMode) ? (
            // 改记/核销/kind 模式金额只读——它就是这一行的金额，不是运营能改的数
            // （kind 模式下改的是「哪个原因码」，不是「多少」——算术不是判断）。
            <div className="mb-4 w-full rounded border border-adm-border bg-adm-bg px-2.5 py-2 font-mono text-[11px] text-adm-t1">
              {formatAmount(prefill.amountMinor, decimals)}
            </div>
          ) : (
            <>
              <input
                value={amountDisplay}
                onChange={(e) => setAmountDisplay(e.target.value)}
                placeholder="0.00"
                disabled={submitting}
                className="mb-1 w-full rounded border border-adm-border bg-adm-bg px-2.5 py-2 font-mono text-[11px] text-adm-t1 outline-none transition-colors placeholder:text-adm-t3 focus:border-adm-amber"
              />
              {amountDisplay.trim() !== '' && !amountValid && (
                <p className="mb-1 font-mono text-[9px] text-adm-red">
                  Invalid amount format, or exceeds {assetCode}'s precision (max {decimals} decimal places).
                </p>
              )}
              <div className="mb-4" />
            </>
          )}

          <label className={labelCls}>Effective Date</label>
          <input
            type="date"
            value={effectiveDate}
            onChange={(e) => setEffectiveDate(e.target.value)}
            disabled={submitting || isWriteOff || isKindMode}
            className="mb-4 w-full rounded border border-adm-border bg-adm-bg px-2.5 py-2 font-mono text-[11px] text-adm-t1 outline-none transition-colors focus:border-adm-amber"
          />
          {isWriteOff && <p className="-mt-3 mb-4 font-mono text-[9px] text-adm-t3">Write-off corrects the books for the case's business date — effective date = case business date, not editable.</p>}
          {isKindMode && <p className="-mt-3 mb-4 font-mono text-[9px] text-adm-t3">An adjustment corrects the books for the case's business date — effective date = case business date, not editable.</p>}

          {/* Task 8：kind 模式下原单号已经在证据区只读展示过（有值才显示），这里
              不重复渲染一个可编辑输入框——它不是运营手填的字段。仍旧提交（见
              submit() 用的 relatedOrderNo state），只是不给它第二次露面。 */}
          {!isKindMode && (
            <>
              <label className={labelCls}>
                Related Order No{needsRelatedOrder ? ' (required)' : ' (optional)'}
              </label>
              <input
                value={relatedOrderNo}
                onChange={(e) => setRelatedOrderNo(e.target.value)}
                placeholder={needsRelatedOrder ? 'e.g. DEP2608280001' : '(optional)'}
                disabled={submitting}
                className="mb-1 w-full rounded border border-adm-border bg-adm-bg px-2.5 py-2 font-mono text-[11px] text-adm-t1 outline-none transition-colors placeholder:text-adm-t3 focus:border-adm-amber"
              />
              {needsRelatedOrder && (
                <p className="mb-1 font-mono text-[9px] text-adm-t3">
                  {isReattribute
                    ? 'Reattribution must point to an existing original order (the real deposit/withdrawal booked under the misattributed owner) — KYT must have already cleared this money.'
                    : 'Crediting the client book must point to an existing original order — without one, funds appear out of nowhere and bypass KYT and compliance gates.'}
                </p>
              )}
              <div className="mb-4" />
            </>
          )}

          <label className={labelCls}>{isKindMode ? 'Investigation Note' : 'Internal Reason'}</label>
          <textarea
            value={reasonInternal}
            onChange={(e) => setReasonInternal(e.target.value)}
            placeholder={isKindMode
              ? 'Describe what was checked and the basis for the conclusion — this is the approver\'s only record of the investigation'
              : 'Specific explanation for the approver, e.g.: the same deposit was booked twice, needs correction'}
            disabled={submitting}
            className="mb-4 h-16 w-full resize-none rounded border border-adm-border bg-adm-bg px-2.5 py-2 text-xs text-adm-t1 outline-none transition-colors placeholder:text-adm-t3 focus:border-adm-amber"
          />

          <label className={labelCls}>{isKindMode ? 'Customer-facing Note' : 'Internal Note'}</label>
          <textarea
            value={reasonCustomer}
            onChange={(e) => setReasonCustomer(e.target.value)}
            placeholder={isKindMode
              ? 'Prefilled from the selected cause — this is the wording that appears on the customer statement; edit if needed'
              : 'Internal record only — the customer statement shows the standard wording for this reason type.'}
            disabled={submitting}
            className="w-full resize-none rounded border border-adm-border bg-adm-bg px-2.5 py-2 text-xs text-adm-t1 outline-none transition-colors placeholder:text-adm-t3 focus:border-adm-amber"
            rows={2}
          />
        </div>

        <div className="flex justify-end gap-3 border-t border-adm-border px-6 py-4">
          <button onClick={onClose} disabled={submitting} className={adminButtonClass('modalCancel')}>
            Cancel
          </button>
          <button onClick={() => void submit()} disabled={submitDisabled} className={adminButtonClass('modalConfirm')}>
            {submitting ? 'Submitting…' : isKindMode ? 'Submit for CFO review' : 'Open & Submit'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ReconciliationAdjustmentCreateModal;
