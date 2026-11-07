// admin-web/src/utils/caseInternalCheck.ts
//
// 戊波二 T10：客户钱包「自己两本账」对内检查的两处展示——案件页 Balance Explained 的 Internal 格副行，
// 与跑批详情钱包表的 Internal check 列。纯函数：输入 = 后端下发的最小单位字符串 + 金额格式化器，
// 不在这里重新求和（四户净额与 Δ 的算式只有后端检查器那一份，前端只排版）。
import { isZeroAmount } from './reconAmount';
import type { CaseExplain } from './reconTypes';

export type InternalBreakdown = NonNullable<CaseExplain['internalBreakdown']>;

export interface InternalCheckLine {
  /** 一行纯文本：`Cash x + Shortfall y ｜ Payable p + Held q ｜ Δ d` */
  text: string;
  /** 只有 Δ 这一段要按是否为 0 上色，故单独给出 */
  delta: string;
  deltaZero: boolean;
  /** 不含 Δ 的前两段，供 JSX 在 Δ 前原样接上 */
  head: string;
}

/** 非零差额带显式正号（负号由格式化器自带），零不带符号。 */
const signedDelta = (raw: string, fmt: (v: string) => string): string =>
  isZeroAmount(raw) ? fmt('0') : `${raw.startsWith('-') ? '' : '+'}${fmt(raw)}`;

export const buildInternalCheckLine = (b: InternalBreakdown, fmt: (v: string) => string): InternalCheckLine => {
  const head = `Cash ${fmt(b.cash)} + Shortfall ${fmt(b.shortfall)} ｜ Payable ${fmt(b.payable)} + Held ${fmt(b.suspense)}`;
  const delta = signedDelta(b.delta, fmt);
  return { text: `${head} ｜ Δ ${delta}`, head, delta, deltaZero: isZeroAmount(b.delta) };
};

export type InternalCheckCell =
  | { kind: 'na' }                  // 公司钱包：没有逐钱包的两本账
  | { kind: 'ok' }                  // Δ = 0
  | { kind: 'break'; text: string }; // Δ ≠ 0：带符号的差额

/** 跑批详情页钱包表 Internal check 列：✓ / Δ 值 / —（公司钱包与老快照行没有值）。 */
export const internalCheckCell = (
  internalDelta: string | null | undefined,
  fmt: (v: string) => string,
): InternalCheckCell => {
  if (internalDelta === null || internalDelta === undefined) return { kind: 'na' };
  if (isZeroAmount(internalDelta)) return { kind: 'ok' };
  return { kind: 'break', text: signedDelta(internalDelta, fmt) };
};
