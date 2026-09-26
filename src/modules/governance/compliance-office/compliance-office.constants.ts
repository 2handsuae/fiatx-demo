// 战役甲波四 · 合规办公室骨架（spec §3.2 翻期语义；Task 2）：主体 ComplianceObligation 的
// 状态、显式迁移表、频率枚举、翻期纯函数、方法入参形状。
// 本文件只放常量与纯类型——不含任何 Prisma / NestJS 依赖（照 regulatory-filing.constants.ts
// 头注释惯例）。

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
