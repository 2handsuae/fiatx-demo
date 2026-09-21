// admin-web/src/utils/reconTypes.ts
//
// 第六幕清残留·波四（Task 3）：从 ReconciliationCasesDetailPage.tsx 剪出的案件详情
// 数据形状——原页面是这批类型的具名导出源，causeRegistry.ts / 三个弹窗 / 两个列表页
// 反向 import 它（循环 import 病灶）。这里是单一来源，签名逐字未变。
import type { ReconBucket } from './reconBucketMap';

// Legacy line-items still arrive in the response (the V8 engine wrote them).
// We no longer render them — flowComparison is the new investigation surface.
export interface CaseLineItem {
  id: string;
  lineNo: number;
  matchStatus: string;
}

export type FlowMatchType = 'MATCHED' | 'ORPHAN_EXTERNAL' | 'ORPHAN_INTERNAL' | 'AMOUNT_MISMATCH' | 'IN_TRANSIT';

export interface FlowExternalSide {
  id?: string;
  externalRef: string | null;
  amount: string;
  direction: 'IN' | 'OUT';
  timestamp: string | null;
  description?: string | null;
}

export interface FlowInternalSide {
  id?: string;
  externalRef: string | null;
  amount: string;
  direction: 'IN' | 'OUT';
  timestamp: string;
  eventCode: string;
  sourceType: string;
  sourceNo: string;
}

// Exported — T8 (平账一期半) 前端复用件（causeRegistry.ts / ReconciliationHoldModal.tsx）
// 从这里 import type，而不是另建一份镜像类型（页面现状即唯一真相的最小改法，见 T8 brief）。
export interface FlowComparisonRow {
  externalLine: FlowExternalSide | null;
  internalFlow: FlowInternalSide | null;
  matchType: FlowMatchType;
  deltaAmount?: string;
  fundsOrderNo?: string | null;   // NEW — only for IN_TRANSIT rows
  fundsOrderStatus?: string | null; // T4 — funds order status for IN_TRANSIT rows;
                                    // CLEARED here (case still OPEN) = "已推进·待重对账"
  explainedByAdjustmentNo?: string | null; // ④ 这条差异已被哪张已落账的调账单解释
  // T8：以下三个注解同样只在三类异常行（AMOUNT_MISMATCH/ORPHAN_INTERNAL/
  // ORPHAN_EXTERNAL）上出现，MATCHED/IN_TRANSIT 恒 undefined——它们不是差异、没有
  // 可处置的东西。唯一真相在后端 reconciliation-query.service.ts。
  disposition?: {
    dispositionNo: string; causeCode: string; causeLabel: string;
    outlet: string; outletLabel: string;
    // 出口的可执行部分（后端 resolveOutlet 算好随行下发）——「开单」直接用，
    // 前端不反推；非 ADJUST 类出口不落分录，三个都没有值。
    family?: 'CORRECT' | 'REVERSE' | 'RECORD' | 'REATTRIBUTE' | 'WRITE_OFF';
    reasonCode?: string; direction?: 'REDUCE' | 'INCREASE';
    findingNote: string;
    adjustmentNo: string | null; createdBy: string; createdAt: string;
    // 平账 B 批（Task 9）：SUPPLEMENT 出口专用——去向 / 转的补单号 / 补单业务域引用。
    deferredTarget?: 'SUPPLEMENT_DEPOSIT' | 'SUPPLEMENT_BOUNCE' | 'SUPPLEMENT_PAYOUT_RETURN' | string | null;
    supplementNo?: string | null;
    supplementRef?: { kind: 'SIGNAL' | 'DEPOSIT' | 'WITHDRAW'; no: string; id: string | null } | null;
    // 平账三期（Task 9 写入，Task 12 消费）：出口 = INCIDENT 且已登记后回填的事故单号——
    // 未登记恒 null，前端按它渲染「登记事故」按钮 vs「事故 · INC…」徽标。
    incidentNo?: string | null;
  } | null;
  duplicateTwinRef?: string | null;
  // Task 5（读面翻转）取代旧的一格一份平铺成因菜单 `menu`（本任务起不再下发）：
  // 这一格（matchType × book）当下合法的处置清单，按处置分组，组内带该处置在这
  // 一格可选的成因——Task 7 差异行按钮组 + 挂起弹窗的唯一数据源。
  dispositions?: Array<{
    kind: string; label: string;
    causes: Array<{ code: string; label: string; clue: string }>;
  }>;
  // 波四：开单预填——后端 cause-registry.resolveAdjustmentPrefill 单一来源，
  // 只在三类异常行下发（MATCHED/IN_TRANSIT 无消费点）。
  adjustmentPrefill?: { amountMinor: string; direction: 'REDUCE' | 'INCREASE'; reattributionSide: 'FROM' | 'TO' };
  // ⚡ 差异行级推荐（模拟开关门控）：唯一真相在后端 reconciliation-query.service.ts
  // ——已经校验过推荐真的在上面 dispositions 清单里，前端只管展示，不自己算。
  demoRecommended?: {
    scenarioId: number; causeCode: string; causeLabel: string;
    disposition: string; dispositionLabel: string;
  };
  // 平账 A 批（spec §2.6）：超期后的下一步（服务端判）
  nextStep?: {
    kind: 'WRITE_OFF' | 'INCIDENT_DEFERRED' | 'CLIENT_SURPLUS' | 'COMPENSATION' | 'ADVANCE';
    reasonCode?: 'UNEXPLAINED_WRITE_OFF' | 'UNEXPLAINED_CLIENT_LOSS'; direction?: 'REDUCE' | 'INCREASE'; amount?: string; effectiveDate?: string;
    adjustmentNo?: string; externalLineId?: string; customerNo?: string | null; walletNo?: string | null; available?: string; lineAmount?: string;
  };
  // 平账二期：这条差异行牵出的划转单（补款 / 垫款）回挂
  transfer?: { transferNo: string; purpose: string; status: string } | null;
}

export interface FlowComparisonSummary {
  matched: number;
  orphanInternal: number;
  orphanExternal: number;
  mismatch: number;
}

// T6 additions — delta decomposition + observation history.
export interface CaseExplain {
  internalTotal: string;
  externalClosing: string;
  delta: string;
  inTransitSigned: string;
  residual: string;
}

export interface CaseObservation {
  firstSeenRunNo: string | null;
  firstSeenAt: string | null;
  lastObservedRunNo: string | null;
  reObservedCount: number;
  closedByRunNo: string | null;
  ageDays: number | null;
}

// Task 7 (调账单 admin 前端) — 案件级调账单列表，getCase 按 caseNo 直查返回，
// 独立于 lineItemId（ReconciliationLineItem 每轮对账 delete-then-insert 没有跨轮
// 身份，lineItemId 天生悬空——见控制方裁定）。
export interface CaseAdjustmentRow {
  adjustmentNo: string;
  status: string;      // DRAFT | PENDING_APPROVAL | POSTED | REJECTED
  reasonCode: string;
  direction: string;   // REDUCE | INCREASE
  amount: string;       // 最小单位（分）整数字符串
}

export interface ReconCaseDetail {
  id: string;
  caseNo: string;
  businessDate: string;
  assetId: string;
  assetCode: string;
  decimals: number;                   // T4 — asset.decimals; display scales 分→元 by 10^decimals
  layer: string;
  book: string | null;
  adjustmentBook: 'CLIENT' | 'FIRM';   // 波四：后端归一化下发（createDraft 同一句），前端不再镜像
  // Wallet-engine locators (T7 / T1)
  walletRef: string | null;
  walletNo: string | null;            // NEW — resolved business key via wallets table
  coaCode: string | null;
  ownerNo: string | null;
  // T1 idempotency
  firstSeenRunId: string | null;
  lastUpdatedRunId: string | null;
  openedByRunId: string | null;
  linkedRunNo: string | null;         // NEW — resolved runNo for lastUpdatedRunId ?? openedByRunId
  resolvedAt: string | null;
  resolutionReason: string | null;
  severity: string | null;
  // Balance snapshot — for WALLET_V1 cases:
  //   tbAmount         = internal book balance (bigint string)
  //   expectedExternal = external book balance (bigint string)
  //   deltaAmount      = external − internal (bigint string)
  tbAmount: string;
  inTransitAmount: string;
  expectedExternal: string;
  actualExternal: string;
  deltaAmount: string;
  status: string;
  closedByRunId: string | null;
  lastObservedRunId: string | null;
  slaDeadline: string | null;         // NEW — ISO timestamp or null
  slaBreached: boolean;
  traceId: string | null;
  createdAt: string;
  updatedAt: string;
  lineItems: CaseLineItem[];
  // T3 additions
  flowComparison?: FlowComparisonRow[];
  flowSummary?: FlowComparisonSummary;
  // T6 additions (Round3) — historical cases may have bucket=null.
  bucket?: ReconBucket | null;
  explain?: CaseExplain;
  observation?: CaseObservation;
  // T7 addition — see CaseAdjustmentRow above.
  adjustments?: CaseAdjustmentRow[];
  // 平账三期（Task 9 写入，Task 12 消费）：本案已登记过的事故——全类型、按创建倒序。
  // 空数组 = 该案从未挂过事故；「升级事故」/「登记欠款」按钮据此判断是否已经登记过
  // （非撤回状态即算已登记，不再重复给按钮，改给徽标）。
  incidents?: Array<{ incidentNo: string; status: string; type: string }>;
}
