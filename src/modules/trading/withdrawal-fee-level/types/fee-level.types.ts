import { WithdrawalTier } from '../../pricing-center/types/pricing.types';

export interface FeeLevelTiersConfig {
  tiers: WithdrawalTier[];
}

export const WITHDRAWAL_FEE_ITEM_CODES = ['WITHDRAW_SERVICE_FEE', 'NETWORK_FEE_EST'] as const;

export type WithdrawalFeeItemCode = (typeof WITHDRAWAL_FEE_ITEM_CODES)[number];
