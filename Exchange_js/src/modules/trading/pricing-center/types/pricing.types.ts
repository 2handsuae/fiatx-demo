export type PricingBusiness = 'SWAP' | 'WITHDRAWAL';

export type LpCode = 'LP_A';
export type RoundingMode = 'ROUND' | 'FLOOR' | 'CEIL';
export type FeeCalcType = 'FLAT' | 'PERCENT';
export type PricingSourceSide = 'BID' | 'INVERSE_ASK';

export type SwapFeeItemCode = 'SWAP_SERVICE_FEE' | 'COMPLIANCE_FEE';
export type WithdrawalFeeItemCode =
  | 'WITHDRAW_SERVICE_FEE'
  | 'NETWORK_FEE_EST';

export interface PricingRounding {
  dp: number;
  mode: RoundingMode;
}

export interface FeeItem {
  id: string;
  itemCode: string;
  calcType: FeeCalcType;
  value: string;
  min: string | null;
  max: string | null;
  roundingMode: RoundingMode;
}

export interface SwapTierConditions {
  amountMin: string | null;
  amountMax: string | null;
}

export interface SwapProductRestrictions {
  blockedInvestorClassifications: string[];
}

export interface WithdrawalTierConditions {
  amountMin: string | null;
  amountMax: string | null;
}

export interface SwapTier {
  id: string;
  name: string;
  enabled: boolean;
  rateMarkupBps: number;
  conditions: SwapTierConditions;
  feeItems: FeeItem[];
}

export interface WithdrawalTier {
  id: string;
  name: string;
  enabled: boolean;
  conditions: WithdrawalTierConditions;
  feeItems: FeeItem[];
}

export interface SwapRoutingConfig {
  provider: LpCode;
  maxStalenessSec: number;
  quoteLockSeconds: number;
  rounding: PricingRounding;
}

export interface SwapPairEntry {
  id: string;
  name: string;
  assetAId: string;
  assetALabel: string;
  assetBId: string;
  assetBLabel: string;
  enabled: boolean;
  restrictions?: SwapProductRestrictions;
  routing: SwapRoutingConfig;
  tiers: SwapTier[];
}

export interface WithdrawalAssetEntry {
  id: string;
  assetId: string;
  assetCurrency: string;
  network: string | null;
  enabled: boolean;
  tiers: WithdrawalTier[];
}

export interface WithdrawalPolicyRestrictions {
  extremeVolatilityBlocked: boolean;
  reason: string | null;
}

export interface SwapPricingPolicyConfig {
  policyId: string;
  policyName: string;
  business: 'SWAP';
  channel: {
    online: boolean;
    storeComingSoon: boolean;
  };
  pairs: SwapPairEntry[];
}

export interface WithdrawalPricingPolicyConfig {
  policyId: string;
  policyName: string;
  business: 'WITHDRAWAL';
  channel: {
    online: boolean;
    storeComingSoon: boolean;
  };
  restrictions?: WithdrawalPolicyRestrictions;
  assets: WithdrawalAssetEntry[];
}

export interface PricingPolicyListItem {
  policyCode: string;
  policyName: string;
  policyId: string;
  business: PricingBusiness;
  channel: {
    online: boolean;
    storeComingSoon: boolean;
  };
  lastUpdatedAt: string;
  lastUpdatedBy: string | null;
}

export interface ProviderRateQuote {
  provider: LpCode;
  providerName: 'BINANCE';
  baseRate: string;
  fetchedAt: string;
  symbol: string;
  bid: string;
  ask: string;
  sideUsed: PricingSourceSide;
  aedPegApplied: boolean;
  aedPegRate: string;
  formula: string;
}

export interface CalculatedFeeLine {
  itemCode: string;
  calcType: FeeCalcType;
  currency: string;
  amount: string;
}

export interface SwapPricingResult {
  createdAt: string;
  expiresAt: string;
  matched: {
    pairId: string;
    pairName: string;
    tierId: string;
    tierName: string;
  };
  fx: {
    baseProvider: string;
    baseRate: string;
    quotedRate: string;
    markupBps: number;
    endpoint?: 'api/v3/ticker/bookTicker';
    symbol?: string;
    bid?: string;
    ask?: string;
    sideUsed?: PricingSourceSide;
    aedPegApplied?: boolean;
    aedPegRate?: string;
    formula?: string;
    effectiveBaseRate?: string;
    fetchedAt?: string;
  };
  fees: CalculatedFeeLine[];
  totals: Record<string, string>;
  grossAmountOut: string;
  netAmountOut: string;
  feeTotal: string;
  feeCurrency: string | null;
  policyRef: {
    policyCode: string;
    policyId: string;
    business: 'SWAP';
    channel: 'ONLINE';
  };
}

export interface WithdrawalPricingResult {
  createdAt: string;
  expiresAt: string;
  matched: {
    assetEntryId: string;
    assetId: string;
    tierId: string;
    tierName: string;
  };
  fees: CalculatedFeeLine[];
  totals: Record<string, string>;
  policyRef: {
    policyCode: string;
    policyId: string;
    business: 'WITHDRAWAL';
    channel: 'ONLINE';
  };
}

export const SWAP_POLICY_CODE = 'SWAP_PRICING';
export const WITHDRAWAL_POLICY_CODE = 'WITHDRAWAL_PRICING';
export const WITHDRAW_QUOTE_TTL_SECONDS = 30;
