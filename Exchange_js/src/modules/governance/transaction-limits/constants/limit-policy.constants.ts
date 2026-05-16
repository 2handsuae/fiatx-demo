export const TRADING_TIERS = ['BASIC', 'PREMIUM'] as const;
export type TradingTier = (typeof TRADING_TIERS)[number];

export const OPERATION_TYPES = ['WITHDRAWAL', 'SWAP'] as const;
export type OperationType = (typeof OPERATION_TYPES)[number];

export const LIMIT_PERIODS = ['DAILY', 'MONTHLY'] as const;
export type LimitPeriod = (typeof LIMIT_PERIODS)[number];
