import { IsIn, IsOptional, IsString } from 'class-validator';
import type { DispositionKind, AdjustmentPrefill } from '../disposition/cause-registry';
export class ReconRunQueryDto {
  @IsOptional() @IsString() businessDate?: string;
  @IsOptional() @IsString() layer?: string;
}
export class ReconCaseQueryDto {
  // T3 cockpit default: when status is omitted the list is filtered to OPEN
  // (the cockpit screen only shows actionable cases). Pass status='ALL' to opt
  // out of the default and see every status.
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() assetCode?: string;
  @IsOptional() @IsString() runNo?: string;  // filter to cases touched by a specific run
  // T6: filter by four-bucket classification (Round3) — IN_TRANSIT | COMPENSATING | BREAK.
  @IsOptional() @IsIn(['IN_TRANSIT', 'COMPENSATING', 'BREAK']) bucket?: string;
}
export class ReconExternalBalanceQueryDto {
  @IsOptional() @IsString() cutoffDate?: string;
  @IsOptional() @IsString() book?: string;
  @IsOptional() @IsString() source?: string;
  @IsOptional() @IsString() currency?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// T3 response shapes — surfaced to admin cockpit UI (T4–T6).
// These are pure response types (no validation needed); kept here so the
// frontend codegen has a single source of truth alongside the query DTOs.
// All numeric fields are serialised as strings to dodge JSON BigInt issues.
// ─────────────────────────────────────────────────────────────────────────────

// Round3 four-bucket classification (T4 bucket-classifier). MATCHED doesn't
// open a Case; the other three do. Replaces the old three-tier
// MATCH/FLOW_REVIEW/BREAK status (T6 — getRun now reads the run-wallet
// snapshot table instead of recomputing via the balance checker).
export type ReconWalletBucket = 'MATCHED' | 'IN_TRANSIT' | 'COMPENSATING' | 'BREAK';

export interface AccountStatusRow {
  walletRef: string;
  walletNo: string | null;          // business key (e.g. 'WAL-001'); null for XREF synthetic refs
  walletRole?: string | null;       // 'C_DEP' | 'C_VIBAN' | 'F_FEE' | ... — from wallets lookup
  ownerNo?: string | null;          // customer / firm owner number
  ownerName?: string | null;        // first+last name or company name (null for firm)
  asset: string;                    // 'AED' | 'USDT-TRON'
  decimals: number;                 // asset.decimals — display layer scales 分→元 by 10^decimals
  book: string;                     // CUSTOMER | FIRM
  coaCode: string | null;           // 'A.CLIENT_CASH' | 'A.FIRM_CASH'（钱包现金户的助记码；未归属外部账户为 null）
  internal: { balance: string };
  external: { balance: string };
  delta: string;                    // external − internal
  // 戊波二 T9a：对内差额 (现金 + 短缺待补) − (应付 + 暂扣)，分，带符号；公司钱包 / 无快照值 null。≠ 0 即 BREAK。
  internalDelta: string | null;
  inTransitAmount: string;          // signed sum of in-transit lines (IN +, OUT −)
  flowMatched: number;
  flowTotal: number;
  flowOrphanInternal: number;
  flowOrphanExternal: number;
  flowMismatch: number;
  inTransitCount: number;
  bucket: ReconWalletBucket;
  caseId?: string | null;           // null for MATCHED rows
  caseNo?: string | null;           // human-readable case key (null for MATCHED)
}

export interface RunDetailSummary {
  // Round3 four-bucket wallet counts, taken straight from the run row
  // (ReconciliationRun.walletCount/matchedCount/inTransitCount/softFlagCount/
  // breakCount) — no per-wallet recompute.
  walletCount: number;
  matchedCount: number;
  inTransitCount: number;
  softFlagCount: number;
  breakCount: number;
  // Case lifecycle triple (from the run row): opened/re-observed/closed this run.
  openedCount: number;
  reObservedCount: number;
  closedCount: number;
}

export interface ReconRunDetail {
  accountStatusTable: AccountStatusRow[];
  summary: RunDetailSummary;
  // T6: true when this run predates the reconciliation_run_wallets snapshot
  // table (no snapshot rows exist) — accountStatusTable is empty and the UI
  // should show a "legacy run, no per-wallet detail" notice instead of an
  // empty-state "all clear".
  legacy?: boolean;
  [key: string]: unknown;
}

// T6: case-level residual explanation — how delta decomposes into the
// in-transit-explained portion vs what's left over (the bucket-classifier's
// residual = delta − inTransitSigned; see engine/v2/bucket-classifier.ts).
export interface CaseExplain {
  internalTotal: string;
  externalClosing: string;
  delta: string;
  inTransitSigned: string;
  residual: string;
}

// T6: observation history — when this case was first/last seen, how many
// times it's been re-observed across reruns, and (if resolved) which run
// closed it.
export interface CaseObservation {
  firstSeenRunNo: string | null;
  firstSeenAt: string | null;       // ISO — firstSeenRun.startedAt
  lastObservedRunNo: string | null;
  reObservedCount: number;
  closedByRunNo: string | null;     // null unless status=RESOLVED
  ageDays: number | null;           // null unless status=OPEN
}

// Task 7（调账单 admin 前端）: 案件级调账单列表条目——getCase 按 caseNo 直查
// reconciliation_adjustments 返回，独立于 lineItemId（对账每轮 delete-then-insert
// 没有跨轮身份，lineItemId 天生悬空，见 adjustment-rules.ts 顶部注释同一背景）。
export interface CaseAdjustmentSummary {
  adjustmentNo: string;
  status: string;      // DRAFT | PENDING_APPROVAL | POSTED | REJECTED
  reasonCode: string;
  // 成因 = OTHER 时锚中定性行上的「Other cause」一行（调账单自己不存）；其余恒 null。getCase 装配时回填。
  otherCause?: string | null;
  direction: string;   // REDUCE | INCREASE
  amount: string;       // 最小单位（分）整数字符串
}

type FlowComparisonMatchType =
  | 'MATCHED'
  | 'ORPHAN_EXTERNAL'
  | 'ORPHAN_INTERNAL'
  | 'AMOUNT_MISMATCH'
  | 'IN_TRANSIT';        // T6: sourced from the case's persisted IN_TRANSIT line items

interface FlowComparisonExternalSide {
  id?: string;
  externalRef: string | null;
  amount: string;
  direction: 'IN' | 'OUT';
  timestamp: string | null;        // ISO；在途行无外部时间时如实 null（红3甲，2026-09-20）
  description?: string | null;
}

interface FlowComparisonInternalSide {
  id?: string;
  externalRef: string | null;
  amount: string;
  direction: 'IN' | 'OUT';
  timestamp: string;                // ISO (account_flows.createdAt)
  eventCode: string;
  sourceType: string;
  sourceNo: string;
}

export interface FlowComparisonRow {
  externalLine: FlowComparisonExternalSide | null;
  internalFlow: FlowComparisonInternalSide | null;
  matchType: FlowComparisonMatchType;
  deltaAmount?: string;             // only for AMOUNT_MISMATCH
  fundsOrderNo?: string | null;     // only for IN_TRANSIT — the explaining funds order
  fundsOrderStatus?: string | null; // T4: current status of the explaining funds order
                                    // (IN_TRANSIT only) — CLEARED here + case OPEN means
                                    // "已推进·待重对账": a rerun will close the case.
  // 波四：开单预填三件（金额/方向/改记 side）——唯一真相在 disposition/cause-registry.ts
  // resolveAdjustmentPrefill（出账翻符号见其头注释）。只在三类异常行下发；MATCHED/
  // IN_TRANSIT 行开不了调账弹窗（按钮唯一入口挂在 dispositions 上），不挂即不造死字段。
  adjustmentPrefill?: AdjustmentPrefill;
  // ④ 这条差异已被哪张已落账的调账单解释（三类异常行才有；MATCHED/IN_TRANSIT 恒 null）。
  // 有值 = 引擎算桶时已把它从异常数里摘掉，案子可以平下去。
  explainedByAdjustmentNo?: string | null;
  // 平账一期半（spec §3/§8）案件读面——以下三个注解同样只在三类异常行上出现，
  // MATCHED/IN_TRANSIT 恒 undefined（它们不是差异、没有可处置的东西）。
  // 定性结论：这条差异如果已经被查过定过性，把结论贴回来（成因/出口/谁/何时）。
  // Task 5（读面翻转）：outletLabel 由存储的 outlet 反查处置种类再取
  // DISPOSITION_LABEL（不再靠 resolveOutlet 从成因反推）。family/reasonCode/
  // direction = 开调账单时才定下的执行细节——行上挂着单就从单上读，没开单就
  // 省略（三个都不下发）。
  disposition?: {
    dispositionNo: string; causeCode: string; causeLabel: string;
    // 成因 = OTHER 时的「Other cause」一行（causeLabel 已是 `Other · <otherCause>`）；其余恒 null。
    otherCause: string | null;
    outlet: string; outletLabel: string;
    family?: 'CORRECT' | 'REVERSE' | 'RECORD' | 'REATTRIBUTE' | 'WRITE_OFF';
    reasonCode?: string; direction?: 'REDUCE' | 'INCREASE';
    findingNote: string; adjustmentNo: string | null;
    // 戊波二 T7a：认损补缺单号——与 adjustmentNo 平行，有值 = 这一行被一张认损补缺单锁住（「已锁定」判定认两者之一）。
    transferNo: string | null;
    // 平账 B 批（spec §2.5）：出口去向 + 补单回挂单号 + 该单号的详情页引用（SIG… 无页面，id 为 null）。
    deferredTarget: string | null;
    supplementNo: string | null;
    supplementRef: { kind: 'SIGNAL' | 'DEPOSIT' | 'WITHDRAW'; no: string; id: string | null } | null;
    // 平账三期（Task 9）：出口 = INCIDENT 且已登记后回填的事故单号——未登记恒 null，
    // 前端按它渲染「登记事故」按钮 vs 「事故 · INC…」徽标（Task 12 消费）。
    incidentNo: string | null;
    createdBy: string; createdAt: string;
  } | null;
  // 15 个成因里唯一机器认得出的证据（spec §0.3）：本行与已匹配池里某行同参考号同
  // 金额——只对 ORPHAN_INTERNAL 生效，查证池只认「已匹配」。
  duplicateTwinRef?: string | null;
  // Task 5（读面翻转）：这一格（matchType × book）当下合法的处置清单——按处置分组，
  // 组内带该处置在这一格可选的成因，供前端两级选择（先选处置、再选成因）。取代旧的
  // 一格一份平铺成因菜单 `menu`（本任务起不再下发）。
  dispositions?: Array<{
    kind: string; label: string;
    causes: Array<{ code: string; label: string; clue: string }>;
  }>;
  // ⚡ 差异行级推荐操作（平账处置改版承接）：按该案所属最近 break 轮 run.demoManifest
  // 反查这一行的种子成因，取该成因 usableIn[0] 的处置种类——仅当推荐的处置真的在
  // 上面 `dispositions` 清单里、且成因也在该处置的 causes 里才下发（宁缺勿错，见
  // reconciliation-query.service.ts）。真实/pass 轮（无 manifest）恒不下发。展示与否
  // 由前端模拟开关门控，后端只给事实。
  demoRecommended?: {
    scenarioId: number; causeCode: string; causeLabel: string;
    disposition: DispositionKind; dispositionLabel: string;
  };
  // 平账 A 批（spec §2.6）：超期后的下一步——只在「案件超期 + 该行已定性为挂起·调查中 + 未挂单」时出现。
  // 服务端算（前端不自己拼真相）：WRITE_OFF（公司池核销）带开单预填四项；另外几种只是只读标签。
  // 戊波二 T7a：客户池的「认损」改叫 SHORTFALL_TOPUP（认损补缺：一张划转单、一次批、客户余额不动）——
  // 账龄路（超期 + 小额 + 少了）与事故路（FIRM_LOSS 定损、金额锁定）两条出现条件不变，只是 kind 改名、
  // 不再带 reasonCode / direction（成因固定、方向恒为「托管里少了」），多带 lossSource；COMPENSATION（补款）整条退役。
  nextStep?: {
    kind: 'WRITE_OFF' | 'SHORTFALL_TOPUP' | 'INCIDENT_DEFERRED' | 'CLIENT_SURPLUS' | 'ADVANCE';
    reasonCode?: 'UNEXPLAINED_WRITE_OFF'; direction?: 'REDUCE' | 'INCREASE';
    amount?: string;          // 最小单位整数字符串（WRITE_OFF：核销额；SHORTFALL_TOPUP：认损补缺额（差额或定损额）；ADVANCE：差额；
                              // INCIDENT_DEFERRED：Task 12 起也带——「升级事故」按钮据此预填 LARGE_UNEXPLAINED 金额）
    effectiveDate?: string;   // = 案件业务日（WRITE_OFF / SHORTFALL_TOPUP）
    lossSource?: 'AGING' | 'INCIDENT'; // SHORTFALL_TOPUP：账龄路 / 事故路
    externalLineId?: string;  // ADVANCE：被退汇的账单行（隐藏锚，不上页面）
    customerNo?: string | null; walletNo?: string | null;
    available?: string; lineAmount?: string; // ADVANCE：客户可用 / 账单行金额（最小单位）
  };
  // 平账二期：这条差异行牵出的划转单（垫款 / 认损补缺）回挂——只在客户账簿行上出现。
  // Task 7：IN_TRANSIT 行也复用同一字段——该行背后的资金单若本身就是一条划转腿
  // （internalTransferId 非空），这里回填对应划转单，供前端优先渲染「Transfer leg →」。
  // 戊波二 T7a（R22）：recognized = 这张单已在批准那一步记了短缺（recognizedTbTransferId 有值，认损补缺才可能为 true）——
  // 前端据 { status, recognized } 打 Pending CFO / Shortfall recognised · topping up / top-up failed 标签。
  transfer?: { transferNo: string; purpose: string; status: string; recognized: boolean } | null;
}

export interface FlowComparisonSummary {
  matched: number;
  orphanInternal: number;
  orphanExternal: number;
  mismatch: number;
}
