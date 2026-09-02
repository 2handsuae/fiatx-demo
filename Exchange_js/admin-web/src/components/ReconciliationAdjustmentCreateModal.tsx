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
import { useEffect, useState } from 'react';
import { adminButtonClass } from './common/adminButtonStyles';
import {
  AdminSessionError,
  adminFetch,
  getApiErrorMessage,
} from '../utils/adminFetch';
// 循环 import——ReconciliationDispositionModal.tsx 已有同款先例（page 引 modal，
// modal 引 page 的具名导出），Vite/esbuild 对这种「模块顶层不互相求值」的循环没问题。
import { formatAmount } from '../pages/ReconciliationCasesDetailPage';

export type AdjustmentBook = 'CLIENT' | 'FIRM';
export type AdjustmentDirection = 'REDUCE' | 'INCREASE';

interface ReasonMeta {
  book: AdjustmentBook;
  directions: AdjustmentDirection[];
  label: string;
}

// 前端镜像 backend REASON_SPECS（src/modules/clearing-settle/reconciliation/
// disposition/adjustment-rules.ts）的**前七码**，是「运营自己选成因」那条老通道的
// 下拉数据源。⚠ 第 8 码 CUSTOMER_REATTRIBUTION（改记）**刻意不在这里**：它只走
// 「先定性、再开单」的锁定视图，成因由后端 resolveOutlet 定死、不给下拉。把它补
// 进这张表 = 它会出现在非锁定态的成因下拉里，运营能凭空手选改记——那是回归，别补。
// customerLabel 与 backend 一致（5 个客户侧成因原样照抄）；FIRM 两个 backend 没有
// customerLabel（客户看不到公司侧调账），这里的 label 只是运营选择用的中文名，
// 不是客户文案。
// 导出给案件详情页复用（本案调账单列表要显示成因中文名），避免同一张表两处各抄一份。
export const REASON_META: Record<string, ReasonMeta> = {
  DEPOSIT_AMOUNT_CORRECTION: { book: 'CLIENT', directions: ['REDUCE', 'INCREASE'], label: '充值金额更正' },
  DEPOSIT_DUPLICATE_REVERSAL: { book: 'CLIENT', directions: ['REDUCE'], label: '重复入账撤销' },
  DEPOSIT_SIGNAL_VOID: { book: 'CLIENT', directions: ['REDUCE'], label: '充值撤销' },
  WITHDRAW_AMOUNT_CORRECTION: { book: 'CLIENT', directions: ['INCREASE'], label: '提现金额更正' },
  WITHDRAW_VOID_REFUND: { book: 'CLIENT', directions: ['INCREASE'], label: '提现撤销退回' },
  BANK_INTEREST: { book: 'FIRM', directions: ['INCREASE'], label: '银行利息' },
  BANK_CHARGE: { book: 'FIRM', directions: ['REDUCE'], label: '银行杂费' },
  FIRM_ENTRY_REVERSAL: { book: 'FIRM', directions: ['REDUCE', 'INCREASE'], label: '公司账簿冲销' },
};

// 展示用成因词表（超集）：详情页 / 本案调账单列表 / 锁定视图回显用。
// 改记与核销刻意不在 REASON_META（下拉数据源）里：前者只走「先定性再开单」，后者只由账龄解锁。
export const REASON_LABEL: Record<string, string> = {
  ...Object.fromEntries(Object.entries(REASON_META).map(([code, meta]) => [code, meta.label])),
  CUSTOMER_REATTRIBUTION: '记错客户更正（改记）',
  UNEXPLAINED_WRITE_OFF: '查无果核销',
};

// T9：族的中文词——本文件内常量，不是共享注册表（唯一真相仍在后端
// cause-registry.ts AdjustFamily；这里只是锁定视图要拼一句回显文案）。
const FAMILY_WORD: Record<string, string> = {
  CORRECT: '冲正', REVERSE: '冲销', RECORD: '补记', REATTRIBUTE: '改记', WRITE_OFF: '核销',
};

// T9：锁定视图的弹层标题——每族一句白话，说清这张单要干什么（不是简单复述族名）。
const LOCKED_TITLE: Record<string, string> = {
  CORRECT: '冲正 · 把金额改成对的',
  REVERSE: '冲销 · 撤销这笔入账',
  RECORD: '补记 · 记一笔公司自己的收支',
  REATTRIBUTE: '改记 · 把钱改记到正主名下',
  WRITE_OFF: '核销 · 查不出，公司认下来',
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
  /** 平账 A 批：核销锁定视图——金额 / 生效日只读，说明预填查证结论。 */
  writeOff?: { findingNote: string };
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
  onClose,
  onCreated,
}: ReconciliationAdjustmentCreateModalProps) => {
  const [reasonCode, setReasonCode] = useState('');
  const [direction, setDirection] = useState<AdjustmentDirection | ''>('');
  const [amountDisplay, setAmountDisplay] = useState('');
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
  // 哪一行是「本行」在改记里决定了提交体怎么拼：ORPHAN_INTERNAL（我有外无=错记方）
  // 只带 explainedFlowId，ORPHAN_EXTERNAL（外有我无=正主方）只带
  // explainedExternalLineId（reconciliation-query.service.ts 对两类行的构造保证
  // 互斥，见 :890/:917）——哪个有值就天然指示本行是哪一边，不用再传一个
  // matchType/side 字段。
  const side: 'FROM' | 'TO' = prefill.explainedFlowId ? 'FROM' : 'TO';

  useEffect(() => {
    if (!open) return;
    setReasonCode(locked ? (locked.reasonCode ?? 'CUSTOMER_REATTRIBUTION') : '');
    setDirection(locked ? (locked.direction ?? '') : '');
    setAmountDisplay(prefill.amountMinor ? minorToDisplay(prefill.amountMinor, decimals) : '');
    setEffectiveDate(caseBusinessDate);
    setRelatedOrderNo(prefill.relatedOrderNo ?? '');
    setReasonInternal(locked?.writeOff ? `查无果核销：${locked.writeOff.findingNote}` : '');
    setReasonCustomer(locked?.writeOff ? '（公司侧核销，客户不可见）' : '');
    setError('');
    setCandidates([]);
    setCandidatesError('');
    setSelectedCandidateIdx(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

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

  // 只列当前案件账簿下的成因——客户账簿案件不该看到 BANK_INTEREST/BANK_CHARGE，反之亦然。
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
    (isReattribute && (candidatesLoading || !selectedCandidate));

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
        amount: (isReattribute || isWriteOff) ? prefill.amountMinor : amountMinor,
        effectiveDate,
        reasonInternal: reasonInternal.trim(),
        reasonCustomer: reasonCustomer.trim(),
      };
      if (relatedOrderNo.trim()) body.relatedOrderNo = relatedOrderNo.trim();
      if (locked?.dispositionNo) body.dispositionNo = locked.dispositionNo;

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
          `已开单 ${adjustmentNo}，但提审失败：${await getApiErrorMessage(submitRes, 'Failed to submit for approval.')}`,
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
            {locked ? (LOCKED_TITLE[locked.family] ?? '开调账单 / Open Adjustment') : '开调账单 / Open Adjustment'}
          </h2>
          <p className="mt-1 font-mono text-[10px] text-adm-t3">
            {caseNo} · {book === 'CLIENT' ? '客户账簿' : '公司账簿'} · {assetCode}
          </p>
        </div>

        <div className="max-h-[70vh] overflow-y-auto px-6 py-4">
          {error && (
            <div className="mb-3 rounded border border-adm-red/30 bg-adm-red/10 px-3 py-2 font-mono text-[10px] text-adm-red">
              {error}
            </div>
          )}

          <label className={labelCls}>成因 / Reason</label>
          {locked ? (
            // T9 锁定视图：成因由上一屏（处置弹层）判死，这里只回显——不给下拉。
            // 唯一真相在后端 cause-registry.ts，前端不猜、不改。
            <div className="mb-4 rounded border border-adm-border bg-adm-bg px-2.5 py-2 font-mono text-[11px] text-adm-t1">
              【{FAMILY_WORD[locked.family] ?? locked.family}】{REASON_LABEL[locked.reasonCode ?? ''] ?? locked.reasonCode}
            </div>
          ) : (
            <select
              value={reasonCode}
              onChange={(e) => pickReason(e.target.value)}
              disabled={submitting}
              className={`mb-4 ${selectCls}`}
            >
              <option value="">请选择成因…</option>
              {reasonOptions.map(([code, meta]) => (
                <option key={code} value={code}>
                  {meta.label} · {code}
                </option>
              ))}
            </select>
          )}

          {!isReattribute && (
            <>
              <label className={labelCls}>方向 / Direction</label>
              {locked ? (
                // T9：方向本来就能从行推出来（差额符号 / 内外部流水方向），给人改
                // 是错的——只读文本 + 一句推导依据（directionNote 由后端行事实
                // 算出，见 causeRegistry.ts directionNoteFor）。
                <div className="mb-1 rounded border border-adm-border bg-adm-bg px-2.5 py-2 font-mono text-[11px] text-adm-t1">
                  {direction === 'REDUCE' ? '减少 REDUCE' : direction === 'INCREASE' ? '增加 INCREASE' : '—'}
                </div>
              ) : (
                <select
                  value={direction}
                  onChange={(e) => setDirection(e.target.value as AdjustmentDirection)}
                  disabled={submitting || directionOptions.length <= 1}
                  className={`mb-1 ${selectCls}`}
                >
                  {directionOptions.length === 0 && <option value="">请先选择成因</option>}
                  {directionOptions.map((d) => (
                    <option key={d} value={d}>
                      {d === 'REDUCE' ? '减少 REDUCE' : '增加 INCREASE'}
                    </option>
                  ))}
                </select>
              )}
              {locked ? (
                <p className="mb-4 font-mono text-[9px] text-adm-t3">{locked.directionNote}</p>
              ) : (
                <>
                  {reasonCode && directionOptions.length === 1 && (
                    <p className="mb-4 font-mono text-[9px] text-adm-t3">该成因只允许这一个方向，已锁定。</p>
                  )}
                  {(!reasonCode || directionOptions.length !== 1) && <div className="mb-4" />}
                </>
              )}
            </>
          )}

          {isReattribute && (
            <div className="mb-4">
              <label className={labelCls}>对端案件 / Counterparty Case（单选）</label>
              {candidatesLoading ? (
                <p className="font-mono text-[11px] text-adm-t3">加载候选中…</p>
              ) : candidatesError ? (
                <p className="font-mono text-[11px] text-adm-red">{candidatesError}</p>
              ) : candidates.length === 0 ? (
                <p className="font-mono text-[11px] text-adm-red">
                  未找到同日同额的反向孤儿——先确认对端案件已跑出差异行
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
                        {c.caseNo} · 客户 {c.ownerNo ?? '—'} · 钱包 {c.walletNo ?? '—'} · ref {c.externalRef ?? '—'}
                      </span>
                    </label>
                  ))}
                </div>
              )}
              {selectedCandidate && (
                <p className="mt-2 rounded border border-adm-blue/30 bg-adm-blue/10 px-2 py-1.5 font-mono text-[11px] text-adm-t2">
                  从 {fromParty.ownerNo}（{fromParty.walletNo}）改记到 {toParty.ownerNo}（{toParty.walletNo}）·
                  客户资产总额不变
                </p>
              )}
            </div>
          )}

          <label className={labelCls}>金额 / Amount（{assetCode}）</label>
          {(isReattribute || isWriteOff) ? (
            // 改记金额只读——它就是这一行的金额，不是运营能改的数（改的是「谁的」，不是「多少」）。
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
                  金额格式不对，或超出 {assetCode} 的精度（最多 {decimals} 位小数）。
                </p>
              )}
              <div className="mb-4" />
            </>
          )}

          <label className={labelCls}>生效日期 / Effective Date</label>
          <input
            type="date"
            value={effectiveDate}
            onChange={(e) => setEffectiveDate(e.target.value)}
            disabled={submitting || isWriteOff}
            className="mb-4 w-full rounded border border-adm-border bg-adm-bg px-2.5 py-2 font-mono text-[11px] text-adm-t1 outline-none transition-colors focus:border-adm-amber"
          />
          {isWriteOff && <p className="-mt-3 mb-4 font-mono text-[9px] text-adm-t3">核销修的是案件那一天的账，生效日 = 案件业务日，不可改。</p>}

          <label className={labelCls}>
            关联原单号 / Related Order No{needsRelatedOrder ? '（必填）' : '（可选）'}
          </label>
          <input
            value={relatedOrderNo}
            onChange={(e) => setRelatedOrderNo(e.target.value)}
            placeholder={needsRelatedOrder ? '例如 DEP2608280001' : '（可留空）'}
            disabled={submitting}
            className="mb-1 w-full rounded border border-adm-border bg-adm-bg px-2.5 py-2 font-mono text-[11px] text-adm-t1 outline-none transition-colors placeholder:text-adm-t3 focus:border-adm-amber"
          />
          {needsRelatedOrder && (
            <p className="mb-1 font-mono text-[9px] text-adm-t3">
              {isReattribute
                ? '改记必须指向一张已存在的原单（记在错记方名下的那笔真实充值/提现）——KYT 已对这笔钱跑过才放行。'
                : '客户账簿给客户加钱必须指向一张已存在的原单——无原单即凭空加钱，会绕过 KYT 与合规闸。'}
            </p>
          )}
          <div className="mb-4" />

          <label className={labelCls}>内部原因 / Internal Reason</label>
          <textarea
            value={reasonInternal}
            onChange={(e) => setReasonInternal(e.target.value)}
            placeholder="给审批人看的具体说明，例如：同一笔充值入账两次，需冲正"
            disabled={submitting}
            className="mb-4 h-16 w-full resize-none rounded border border-adm-border bg-adm-bg px-2.5 py-2 text-xs text-adm-t1 outline-none transition-colors placeholder:text-adm-t3 focus:border-adm-amber"
          />

          <label className={labelCls}>客户可见原因 / Customer-Visible Reason</label>
          <textarea
            value={reasonCustomer}
            onChange={(e) => setReasonCustomer(e.target.value)}
            placeholder="客户流水读模型任务上线前暂不展示，但仍需留痕"
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
            {submitting ? '提交中… / Submitting…' : '开单并提审 / Open & Submit'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ReconciliationAdjustmentCreateModal;
