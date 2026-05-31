import { SwapTier } from '../../pricing-center/types/pricing.types';

export interface SwapFeeLevelTiersConfig {
  tiers: SwapTier[];
}

export const SWAP_FEE_ITEM_CODES = ['SWAP_SERVICE_FEE', 'COMPLIANCE_FEE'] as const;

export type SwapFeeItemCode = (typeof SWAP_FEE_ITEM_CODES)[number];
