export const GATE_TYPES = ['SINGLE', 'CUMULATIVE', 'LARGE_APPROVAL'] as const;
export type GateType = (typeof GATE_TYPES)[number];

export const LIMIT_OPERATION_TYPES = ['WITHDRAWAL', 'SWAP', 'DEPOSIT'] as const;
export type LimitOperationType = (typeof LIMIT_OPERATION_TYPES)[number];

export const LIMIT_PERIODS = ['DAILY', 'MONTHLY'] as const;
export type LimitPeriod = (typeof LIMIT_PERIODS)[number];

export const LIMIT_TRADING_TIERS = ['BASIC', 'PREMIUM'] as const;

/** 每种 gateType 的行形状：哪些维度必填/必空、哪些金额字段合法 */
export const GATE_SHAPES: Record<GateType, { required: string[]; forbidden: string[]; amountFields: string[] }> = {
  SINGLE:         { required: ['operationType', 'assetId'],                 forbidden: ['tradingTier', 'period'], amountFields: ['minAmount', 'maxAmount'] },
  CUMULATIVE:     { required: ['operationType', 'tradingTier', 'period'],   forbidden: ['assetId'],               amountFields: ['defaultLimit', 'cap'] },
  LARGE_APPROVAL: { required: ['operationType'],                            forbidden: ['assetId', 'tradingTier', 'period'], amountFields: ['threshold'] },
};
