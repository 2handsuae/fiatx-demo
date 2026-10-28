// 战役甲波四 · 合规办公室骨架（spec §3.2 翻期语义；Task 2）：主体 ComplianceObligation 的
// 状态、显式迁移表、频率枚举、翻期纯函数、方法入参形状。
// 本文件只放常量与纯类型——不含任何 Prisma / NestJS 依赖（照 regulatory-filing.constants.ts
// 头注释惯例）；唯一的 import 是审计码常量表 AuditActions（服务商边→审计码映射取它的字面值）。
import { AuditActions } from '../../audit-logging/constants/audit-actions.constant';

export const ObligationStatus = { ACTIVE: 'ACTIVE', DISABLED: 'DISABLED' } as const;

/** 铁律④显式迁移表：仅两态两边，非法跃迁（含同态自转）一律拒绝（服务层显式 400）。 */
export const OBLIGATION_TRANSITIONS: Record<string, readonly string[]> = {
  [ObligationStatus.ACTIVE]: [ObligationStatus.DISABLED],
  [ObligationStatus.DISABLED]: [ObligationStatus.ACTIVE],
};

export const ObligationFrequencies = {
  MONTHLY: 'MONTHLY', QUARTERLY: 'QUARTERLY', SEMIANNUAL: 'SEMIANNUAL', ANNUAL: 'ANNUAL',
} as const;
export type ObligationFrequency = (typeof ObligationFrequencies)[keyof typeof ObligationFrequencies];

/** 翻期纯函数（spec §3.2）：日历月加法 +1/+3/+6/+12，月末钳制——不许用 Date mutator
 *  （act6 波五判例：`setUTCHours` 类 mutator 是 grep 照不到的边界逃逸），用 `Date.UTC`
 *  重构造 + 目标月末钳制（`new Date(Date.UTC(y, m+1, 0))` 取目标月最后一天）。 */
export function advanceDueDate(due: Date, frequency: ObligationFrequency): Date {
  const months = { MONTHLY: 1, QUARTERLY: 3, SEMIANNUAL: 6, ANNUAL: 12 }[frequency];
  const y = due.getUTCFullYear(); const m = due.getUTCMonth() + months;
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const d = Math.min(due.getUTCDate(), lastDay);
  return new Date(Date.UTC(y, m, d, due.getUTCHours(), due.getUTCMinutes(), due.getUTCSeconds()));
}

/** create 入参：leadBusinessDays 缺省落 Prisma 列默认值 5（spec §9 核对表未特别指定时的
 *  通用提前量）；nextDueAt 是首期到期日，ISO 字符串（照 regulatory-filing 的 receivedAt 先例，
 *  纯日期串不在本文件解析，交服务层 `new Date()`）。 */
export interface CreateObligationDto {
  name: string;
  description?: string;
  frequency: ObligationFrequency;
  authority: string;
  basisNote: string;
  leadBusinessDays?: number;
  nextDueAt: string;
}

/** update 只改描述性字段——status 走 setStatus、nextDueAt 只由 claimDue/simulateDue 迁
 *  （各管各的：状态与钟只能沿各自显式通道走，不许从通用 update 混入）。 */
export interface UpdateObligationDto {
  name?: string;
  description?: string;
  frequency?: ObligationFrequency;
  authority?: string;
  basisNote?: string;
  leadBusinessDays?: number;
}

// ── 战役甲波四 T4：外包供应商登记册 ──────────────────────────────────
// 甲波六 T6：登记册改成服务商准入——七态十边，先评估后审批；重大（MATERIAL）批后多一道 VARA 事前报备门。

export const VendorStatus = {
  PENDING_ASSESSMENT: 'PENDING_ASSESSMENT',
  RETURNED: 'RETURNED',
  PENDING_APPROVAL: 'PENDING_APPROVAL',
  PENDING_NOTIFICATION: 'PENDING_NOTIFICATION',
  ACTIVE: 'ACTIVE',
  REJECTED: 'REJECTED',
  TERMINATED: 'TERMINATED',
} as const;
export type VendorStatusValue = (typeof VendorStatus)[keyof typeof VendorStatus];

const V = VendorStatus;

/** 铁律④显式迁移表（spec §5.6）：PENDING_ASSESSMENT 由合规官下结论走出三条边（退回 / 不通过 / 送审）；RETURNED 只有运营
 *  「重新提交」一条出路；PENDING_APPROVAL 批准按重大性落 ACTIVE（一般）或 PENDING_NOTIFICATION（重大），驳回（含超时）→ REJECTED，
 *  撤单 → 回 PENDING_ASSESSMENT 重新评估；PENDING_NOTIFICATION 等告知单报送后 → ACTIVE；终态 REJECTED / TERMINATED 零出边
 *  （无硬删，「删」这个操作本身就不存在）。 */
export const VENDOR_TRANSITIONS: Record<string, readonly string[]> = {
  [V.PENDING_ASSESSMENT]: [V.RETURNED, V.REJECTED, V.PENDING_APPROVAL],
  [V.RETURNED]: [V.PENDING_ASSESSMENT],
  [V.PENDING_APPROVAL]: [V.ACTIVE, V.PENDING_NOTIFICATION, V.REJECTED, V.PENDING_ASSESSMENT],
  [V.PENDING_NOTIFICATION]: [V.ACTIVE],
  [V.ACTIVE]: [V.TERMINATED],
  [V.REJECTED]: [],
  [V.TERMINATED]: [],
};

/** (from→to) 边到审计动作码的映射——与 VENDOR_TRANSITIONS 的十条边一一对应（OutsourcingVendorsService.transition 的完整性闸读它）。
 *  两种批准落点（ACTIVE / PENDING_NOTIFICATION）同属「批准」，共用 VENDOR_APPROVED，区别由 metadata 的 toStatus 承载。 */
export const VENDOR_ACTION_BY_EDGE: Record<string, string> = {
  [`${V.PENDING_ASSESSMENT}->${V.RETURNED}`]: AuditActions.VENDOR_RETURNED,
  [`${V.RETURNED}->${V.PENDING_ASSESSMENT}`]: AuditActions.VENDOR_RESUBMITTED,
  [`${V.PENDING_ASSESSMENT}->${V.REJECTED}`]: AuditActions.VENDOR_REJECTED,
  [`${V.PENDING_ASSESSMENT}->${V.PENDING_APPROVAL}`]: AuditActions.VENDOR_SENT_FOR_APPROVAL,
  [`${V.PENDING_APPROVAL}->${V.ACTIVE}`]: AuditActions.VENDOR_APPROVED,
  [`${V.PENDING_APPROVAL}->${V.PENDING_NOTIFICATION}`]: AuditActions.VENDOR_APPROVED,
  [`${V.PENDING_APPROVAL}->${V.REJECTED}`]: AuditActions.VENDOR_APPROVAL_REJECTED,
  [`${V.PENDING_APPROVAL}->${V.PENDING_ASSESSMENT}`]: AuditActions.VENDOR_APPROVAL_CANCELLED,
  [`${V.PENDING_NOTIFICATION}->${V.ACTIVE}`]: AuditActions.VENDOR_ACTIVATED,
  [`${V.ACTIVE}->${V.TERMINATED}`]: AuditActions.VENDOR_TERMINATED,
};

export type VendorCriticality = 'MATERIAL' | 'NON_MATERIAL';

/** 重大性判定纯函数（spec §5.2）：四问对应 VARA Schedule 1「关键或重要职能」定义 (a)–(d)，任一答「会」→ MATERIAL；
 *  「换掉难不难」只供合规参考，不参与判定。运营改不了——申请表里没有 criticality 这一项。 */
export function judgeCriticality(a: {
  impactLicence: boolean; impactLegal: boolean; impactFinancial: boolean; impactContinuity: boolean;
}): VendorCriticality {
  return a.impactLicence || a.impactLegal || a.impactFinancial || a.impactContinuity ? 'MATERIAL' : 'NON_MATERIAL';
}
