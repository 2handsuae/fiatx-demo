import {
  SWAP_POLICY_CODE,
  SwapPricingPolicyConfig,
  WITHDRAWAL_POLICY_CODE,
  WithdrawalPricingPolicyConfig,
} from '../../modules/trading/pricing-center/types/pricing.types';

export type PricingPolicyManifestAsset = {
  id: string;
  code: string;
  type: string;
  network: string | null;
  decimals: number;
};

export type PricingPolicyManifestItem =
  | {
      policyCode: typeof SWAP_POLICY_CODE;
      policyName: string;
      business: 'SWAP';
      channelOnline: boolean;
      channelStoreSoon: boolean;
      config: SwapPricingPolicyConfig;
    }
  | {
      policyCode: typeof WITHDRAWAL_POLICY_CODE;
      policyName: string;
      business: 'WITHDRAWAL';
      channelOnline: boolean;
      channelStoreSoon: boolean;
      config: WithdrawalPricingPolicyConfig;
    };

const DEFAULT_ROUTING = {
  provider: 'LP_A' as const,
  maxStalenessSec: 30,
  quoteLockSeconds: 30,
  rounding: {
    dp: 8,
    mode: 'ROUND' as const,
  },
};

function formatAssetLabel(asset: PricingPolicyManifestAsset): string {
  const network = String(asset.network || '').trim();
  return network ? `${asset.code}-${network}` : asset.code;
}

export function buildDefaultSwapPricingPolicyConfig(
  activeAssets: PricingPolicyManifestAsset[],
): SwapPricingPolicyConfig {
  const pairs = [];
  let pairSeq = 1;

  for (let i = 0; i < activeAssets.length; i += 1) {
    for (let j = 0; j < activeAssets.length; j += 1) {
      if (i === j) {
        continue;
      }

      const left = activeAssets[i];
      const right = activeAssets[j];
      if (left.type === 'FIAT' && right.type === 'FIAT') {
        continue;
      }

      const pairId = `PAIR-${String(pairSeq).padStart(4, '0')}`;
      const tierId = `${pairId}-TIER-001`;
      pairSeq += 1;

      pairs.push({
        id: pairId,
        name: `${formatAssetLabel(left)} -> ${formatAssetLabel(right)}`,
        assetAId: left.id,
        assetALabel: formatAssetLabel(left),
        assetBId: right.id,
        assetBLabel: formatAssetLabel(right),
        enabled: true,
        routing: { ...DEFAULT_ROUTING },
        tiers: [
          {
            id: tierId,
            name: 'Default Tier',
            priority: 1,
            enabled: true,
            rateMarkupBps: 0,
            conditions: {
              amountMin: '0',
              amountMax: null,
            },
            feeItems: [],
          },
        ],
      });
    }
  }

  return {
    policyId: 'POL-SWAP-ONLINE',
    policyName: 'Swap Pricing',
    business: 'SWAP',
    channel: {
      online: true,
      storeComingSoon: true,
    },
    pairs,
  };
}

export function buildDefaultWithdrawalPricingPolicyConfig(
  activeAssets: PricingPolicyManifestAsset[],
): WithdrawalPricingPolicyConfig {
  const assets = activeAssets.map((asset, index) => {
    const assetEntryId = `ASSET-${String(index + 1).padStart(4, '0')}`;
    const tierId = `${assetEntryId}-TIER-001`;
    return {
      id: assetEntryId,
      assetId: asset.id,
      assetCode: asset.code,
      network: asset.network || null,
      enabled: true,
      tiers: [
        {
          id: tierId,
          name: 'Default Tier',
          priority: 1,
          enabled: true,
          conditions: {
            amountMin: '0',
            amountMax: null,
          },
          feeItems: [
            {
              id: `${tierId}-FEE-001`,
              itemCode: 'WITHDRAW_SERVICE_FEE',
              calcType: 'FLAT' as const,
              value: '0',
              currency: asset.code,
              min: null,
              cap: null,
              roundingDp: asset.decimals,
              roundingMode: 'ROUND' as const,
              adjustable: false,
            },
            {
              id: `${tierId}-FEE-002`,
              itemCode: 'NETWORK_FEE_EST',
              calcType: 'FLAT' as const,
              value: '0',
              currency: asset.code,
              min: null,
              cap: null,
              roundingDp: asset.decimals,
              roundingMode: 'ROUND' as const,
              adjustable: false,
            },
          ],
        },
      ],
    };
  });

  return {
    policyId: 'POL-WITHDRAW-ONLINE',
    policyName: 'Withdrawal Pricing',
    business: 'WITHDRAWAL',
    channel: {
      online: true,
      storeComingSoon: true,
    },
    assets,
  };
}

export function buildDefaultPricingPolicyManifest(
  activeAssets: PricingPolicyManifestAsset[],
): PricingPolicyManifestItem[] {
  return [
    {
      policyCode: SWAP_POLICY_CODE,
      policyName: 'Swap Pricing',
      business: 'SWAP',
      channelOnline: true,
      channelStoreSoon: true,
      config: buildDefaultSwapPricingPolicyConfig(activeAssets),
    },
    {
      policyCode: WITHDRAWAL_POLICY_CODE,
      policyName: 'Withdrawal Pricing',
      business: 'WITHDRAWAL',
      channelOnline: true,
      channelStoreSoon: true,
      config: buildDefaultWithdrawalPricingPolicyConfig(activeAssets),
    },
  ];
}
