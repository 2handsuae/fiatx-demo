import { Logger } from '@nestjs/common';

/**
 * VARA Travel Rule 门槛(按资产写死,业主 2026-07-31 定)。
 * 监管数值,不做管理台可配 —— 改动须走发版 + review。
 */
const TR_THRESHOLD_BY_CURRENCY: Record<string, number> = {
  USDT: 1000,
  AED: 3500,
};

export type KytTxnType = 'finance' | 'travelRule';
export type KytTxnTypeReason =
  | 'NOT_CRYPTO'
  | 'COUNTERPARTY_NOT_VASP'
  | 'NO_TR_THRESHOLD_CONFIGURED'
  | 'BELOW_TR_THRESHOLD'
  | 'TR_REQUIRED';

export interface KytTxnTypeInput {
  assetType: string;
  currency: string;
  amount: number;
  counterpartyIsVasp?: boolean | null;
}
export interface KytTxnTypeDecision {
  type: KytTxnType;
  reason: KytTxnTypeReason;
}

const logger = new Logger('resolveKytTxnType');

/**
 * 判定这笔充值报哪个 Sumsub 交易类型。
 * 口径(业主 2026-07-31):crypto ∧ 对手方是 VASP ∧ amount >= 阈值 → travelRule;其余 finance。
 * 边界取 >=(正好 1000 USDT / 3500 AED 要走 TR)。
 */
export function resolveKytTxnType(input: KytTxnTypeInput): KytTxnTypeDecision {
  if (String(input.assetType).toUpperCase() !== 'CRYPTO') {
    return { type: 'finance', reason: 'NOT_CRYPTO' };
  }
  if (input.counterpartyIsVasp !== true) {
    return { type: 'finance', reason: 'COUNTERPARTY_NOT_VASP' };
  }
  const threshold = TR_THRESHOLD_BY_CURRENCY[String(input.currency).toUpperCase()];
  if (threshold === undefined) {
    // 漏配币种:判 finance 保证不卡单,但必须能被发现 —— 静默漏报比报错危险。
    logger.warn(
      `No VARA TR threshold configured for currency=${input.currency}; falling back to finance. Add it to TR_THRESHOLD_BY_CURRENCY.`,
    );
    return { type: 'finance', reason: 'NO_TR_THRESHOLD_CONFIGURED' };
  }
  if (input.amount < threshold) {
    return { type: 'finance', reason: 'BELOW_TR_THRESHOLD' };
  }
  return { type: 'travelRule', reason: 'TR_REQUIRED' };
}
