export const GATE_TYPES = ['SINGLE', 'CUMULATIVE', 'LARGE_APPROVAL'] as const;
export type GateType = (typeof GATE_TYPES)[number];

export const LIMIT_OPERATION_TYPES = ['WITHDRAWAL', 'SWAP', 'DEPOSIT'] as const;
export type LimitOperationType = (typeof LIMIT_OPERATION_TYPES)[number];

export const LIMIT_PERIODS = ['DAILY', 'MONTHLY'] as const;
export type LimitPeriod = (typeof LIMIT_PERIODS)[number];

export const LIMIT_TRADING_TIERS = ['BASIC', 'PREMIUM'] as const;
export type LimitTradingTier = (typeof LIMIT_TRADING_TIERS)[number];

/**
 * 每种 gateType 的行形状：哪些维度必填/必空、哪些金额字段合法。
 * 不变量：`required`/`forbidden` 只能列维度字段(operationType/assetId/tradingTier/period)，
 * 绝不能列金额字段——validateShape 用 `!input[f]` 判真，会把金额 0 误读成"缺失"。
 */
export const GATE_SHAPES: Record<GateType, { required: string[]; forbidden: string[]; amountFields: string[] }> = {
  SINGLE:         { required: ['operationType', 'assetId'],                 forbidden: ['tradingTier', 'period'], amountFields: ['minAmount', 'maxAmount'] },
  CUMULATIVE:     { required: ['operationType', 'tradingTier', 'period'],   forbidden: ['assetId'],               amountFields: ['defaultLimit'] },
  LARGE_APPROVAL: { required: ['operationType'],                            forbidden: ['assetId', 'tradingTier', 'period'], amountFields: ['threshold'] },
};

/** 所有 gateType 的金额字段并集(单一真相源，validateShape 检测"别形状字段"用) */
export const ALL_AMOUNT_FIELDS: string[] = [
  ...new Set(Object.values(GATE_SHAPES).flatMap((s) => s.amountFields)),
];
