export type KytTxnType = 'finance' | 'travelRule';
export type KytTxnTypeReason = 'NOT_CRYPTO' | 'TR_REQUIRED';

export interface KytTxnTypeInput {
  assetType: string;
}
export interface KytTxnTypeDecision {
  type: KytTxnType;
  reason: KytTxnTypeReason;
}

/**
 * 判定这笔订单报哪个 Sumsub 交易类型。
 * 口径(对手方波二):crypto → travelRule,法币 → finance。
 * 对手方是不是 VASP、金额过不过 TR 阈值**不再**决定提交类型 —— 那是 mock TR 规则
 * (sumsub-shared/travel-rule)管的"挂不挂起认领"。判型只回答"报哪种单"。
 */
export function resolveKytTxnType(input: KytTxnTypeInput): KytTxnTypeDecision {
  if (String(input.assetType).toUpperCase() !== 'CRYPTO') {
    return { type: 'finance', reason: 'NOT_CRYPTO' };
  }
  return { type: 'travelRule', reason: 'TR_REQUIRED' };
}
