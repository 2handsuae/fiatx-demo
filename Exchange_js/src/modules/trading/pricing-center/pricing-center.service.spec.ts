import { BadRequestException } from '@nestjs/common';
import { PricingCenterService } from './pricing-center.service';
import {
  SwapPricingPolicyConfig,
  WithdrawalPricingPolicyConfig,
} from './types/pricing.types';

const mockPrisma = {
  pricingPolicy: {
    findUnique: jest.fn(),
    update: jest.fn(),
    upsert: jest.fn(),
  },
  asset: {
    findMany: jest.fn(),
  },
};

describe('PricingCenterService - Swap Phase 1 constraints', () => {
  let service: PricingCenterService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new PricingCenterService(mockPrisma as any, {} as any, {} as any);
  });

  const buildBaseSwapPolicy = (): SwapPricingPolicyConfig => ({
    policyId: 'POL-SWAP-ONLINE',
    policyName: 'Swap Pricing',
    business: 'SWAP',
    channel: {
      online: true,
      storeComingSoon: true,
    },
    pairs: [
      {
        id: 'PAIR-001',
        name: 'BTC-TRON -> AED',
        assetAId: 'asset-btc',
        assetALabel: 'BTC-BITCOIN',
        assetBId: 'asset-aed',
        assetBLabel: 'AED',
        enabled: true,
        routing: {
          provider: 'LP_A',
          maxStalenessSec: 30,
          quoteLockSeconds: 30,
          rounding: {
            dp: 8,
            mode: 'ROUND',
          },
        },
        tiers: [
          {
            id: 'PAIR-001-TIER-001',
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
      },
    ],
  });

  const buildBaseWithdrawalPolicy = (): WithdrawalPricingPolicyConfig => ({
    policyId: 'POL-WITHDRAW-ONLINE',
    policyName: 'Withdrawal Pricing',
    business: 'WITHDRAWAL',
    channel: {
      online: true,
      storeComingSoon: true,
    },
    assets: [
      {
        id: 'ASSET-0001',
        assetId: 'asset-btc',
        assetCode: 'BTC',
        network: 'BTC',
        enabled: true,
        tiers: [
          {
            id: 'ASSET-0001-TIER-001',
            name: 'Default Tier',
            priority: 1,
            enabled: true,
            conditions: {
              amountMin: '0',
              amountMax: null,
            },
            feeItems: [
              {
                id: 'ASSET-0001-TIER-001-FEE-001',
                itemCode: 'WITHDRAW_SERVICE_FEE',
                calcType: 'PERCENT',
                value: '2',
                currency: 'BTC',
                min: '0.0001',
                cap: null,
                roundingDp: 8,
                roundingMode: 'ROUND',
                adjustable: false,
              },
              {
                id: 'ASSET-0001-TIER-001-FEE-002',
                itemCode: 'NETWORK_FEE_EST',
                calcType: 'FLAT',
                value: '0.0002',
                currency: 'BTC',
                min: null,
                cap: null,
                roundingDp: 8,
                roundingMode: 'ROUND',
                adjustable: false,
              },
            ],
          },
        ],
      },
    ],
  });

  it('pickPairForSwap should match only forward direction', () => {
    const pairs = buildBaseSwapPolicy().pairs;

    const direct = (service as any).pickPairForSwap(pairs, 'asset-btc', 'asset-aed');
    expect(direct.id).toBe('PAIR-001');

    expect(() =>
      (service as any).pickPairForSwap(pairs, 'asset-aed', 'asset-btc'),
    ).toThrow(BadRequestException);
  });

  it('should reject policy when one pair has more than one tier', async () => {
    const config = buildBaseSwapPolicy();
    config.pairs[0].tiers.push({
      ...config.pairs[0].tiers[0],
      id: 'PAIR-001-TIER-002',
    });

    await expect(service.updateSwapPolicy(config)).rejects.toThrow(
      'must contain exactly one tier',
    );
    expect(mockPrisma.pricingPolicy.update).not.toHaveBeenCalled();
  });

  it('should reject policy when pair directions are duplicated', async () => {
    const config = buildBaseSwapPolicy();
    config.pairs.push({
      ...config.pairs[0],
      id: 'PAIR-002',
    });

    await expect(service.updateSwapPolicy(config)).rejects.toThrow(
      'Duplicate swap direction is not allowed',
    );
  });

  it('should reject policy when assetAId equals assetBId', async () => {
    const config = buildBaseSwapPolicy();
    config.pairs[0].assetBId = config.pairs[0].assetAId;

    await expect(service.updateSwapPolicy(config)).rejects.toThrow(
      'cannot use the same asset on both sides',
    );
  });

  it('should allow supported swap feeItems', async () => {
    const config = buildBaseSwapPolicy();
    config.pairs[0].tiers[0].feeItems = [
      {
        id: 'fee-1',
        itemCode: 'SWAP_SERVICE_FEE',
        calcType: 'FLAT',
        value: '1',
        currency: 'AED',
        min: null,
        cap: null,
        roundingDp: 2,
        roundingMode: 'ROUND',
        adjustable: true,
      },
    ];

    const existingSwap = {
      id: 'policy-swap-id',
      policyCode: 'SWAP_PRICING',
      business: 'SWAP',
      configJson: JSON.stringify(buildBaseSwapPolicy()),
      updatedAt: new Date(),
      updatedByUserId: 'SYSTEM',
      updatedByUserNo: 'SYSTEM',
    };
    const existingWithdrawal = {
      id: 'policy-withdraw-id',
      policyCode: 'WITHDRAWAL_PRICING',
      business: 'WITHDRAWAL',
      configJson: JSON.stringify({
        policyId: 'POL-WITHDRAW-ONLINE',
        policyName: 'Withdrawal Pricing',
        business: 'WITHDRAWAL',
        channel: { online: true, storeComingSoon: true },
        assets: [],
      }),
      updatedAt: new Date(),
      updatedByUserId: 'SYSTEM',
      updatedByUserNo: 'SYSTEM',
    };

    mockPrisma.pricingPolicy.findUnique
      .mockResolvedValueOnce(existingSwap)
      .mockResolvedValueOnce(existingWithdrawal);
    mockPrisma.pricingPolicy.update.mockImplementation(async ({ data }: { data: { configJson: string } }) => ({
      ...existingSwap,
      configJson: data.configJson,
    }));

    const saved = await service.updateSwapPolicy(config);

    expect(saved.pairs[0].tiers[0].feeItems).toHaveLength(1);
    expect(saved.pairs[0].tiers[0].feeItems[0].itemCode).toBe('SWAP_SERVICE_FEE');
  });

  it('should preserve swap tier configuration and channel flags on save', async () => {
    const config = buildBaseSwapPolicy();
    config.channel.online = false;
    config.pairs[0].tiers[0].enabled = false;
    config.pairs[0].tiers[0].priority = 3;
    config.pairs[0].tiers[0].conditions.amountMin = '999';
    config.pairs[0].tiers[0].conditions.amountMax = '1000';

    const existingSwap = {
      id: 'policy-swap-id',
      policyCode: 'SWAP_PRICING',
      business: 'SWAP',
      configJson: JSON.stringify(buildBaseSwapPolicy()),
      updatedAt: new Date(),
      updatedByUserId: 'SYSTEM',
      updatedByUserNo: 'SYSTEM',
    };
    const existingWithdrawal = {
      id: 'policy-withdraw-id',
      policyCode: 'WITHDRAWAL_PRICING',
      business: 'WITHDRAWAL',
      configJson: JSON.stringify({
        policyId: 'POL-WITHDRAW-ONLINE',
        policyName: 'Withdrawal Pricing',
        business: 'WITHDRAWAL',
        channel: { online: true, storeComingSoon: true },
        assets: [],
      }),
      updatedAt: new Date(),
      updatedByUserId: 'SYSTEM',
      updatedByUserNo: 'SYSTEM',
    };

    mockPrisma.pricingPolicy.findUnique
      .mockResolvedValueOnce(existingSwap)
      .mockResolvedValueOnce(existingWithdrawal);
    mockPrisma.pricingPolicy.update.mockImplementation(async ({ data }: { data: { configJson: string } }) => ({
      ...existingSwap,
      configJson: data.configJson,
    }));

    const saved = await service.updateSwapPolicy(config);
    const tier = saved.pairs[0].tiers[0];

    expect(saved.channel.online).toBe(false);
    expect(tier.priority).toBe(3);
    expect(tier.enabled).toBe(false);
    expect(tier.conditions.amountMin).toBe('999');
    expect(tier.conditions.amountMax).toBe('1000');
  });

  it('should normalize legacy withdrawal fees into service+gas and auto-add ACTIVE assets', async () => {
    const swap = {
      id: 'policy-swap-id',
      policyCode: 'SWAP_PRICING',
      business: 'SWAP',
      configJson: JSON.stringify(buildBaseSwapPolicy()),
      updatedAt: new Date(),
      updatedByUserId: 'SYSTEM',
      updatedByUserNo: 'SYSTEM',
    };
    const withdrawal = {
      id: 'policy-withdraw-id',
      policyCode: 'WITHDRAWAL_PRICING',
      business: 'WITHDRAWAL',
      configJson: JSON.stringify({
        ...buildBaseWithdrawalPolicy(),
        assets: [
          {
            ...buildBaseWithdrawalPolicy().assets[0],
            tiers: [
              {
                ...buildBaseWithdrawalPolicy().assets[0].tiers[0],
                feeItems: [
                  {
                    id: 'legacy-fee-1',
                    itemCode: 'WITHDRAW_SERVICE_FEE',
                    calcType: 'FLAT',
                    value: '1',
                    currency: 'BTC',
                    min: null,
                    cap: null,
                    roundingDp: 8,
                    roundingMode: 'ROUND',
                    adjustable: true,
                  },
                  {
                    id: 'legacy-fee-2',
                    itemCode: 'BANK_OUT_FEE',
                    calcType: 'FLAT',
                    value: '7',
                    currency: 'BTC',
                    min: null,
                    cap: null,
                    roundingDp: 8,
                    roundingMode: 'ROUND',
                    adjustable: true,
                  },
                ],
              },
            ],
          },
        ],
      }),
      updatedAt: new Date(),
      updatedByUserId: 'SYSTEM',
      updatedByUserNo: 'SYSTEM',
      policyName: 'Withdrawal Pricing',
      channelOnline: true,
      channelStoreSoon: true,
    };

    mockPrisma.pricingPolicy.findUnique
      .mockResolvedValueOnce(swap)
      .mockResolvedValueOnce(withdrawal);
    mockPrisma.asset.findMany.mockResolvedValue([
      { id: 'asset-aed', code: 'AED', network: null, decimals: 2 },
      { id: 'asset-btc', code: 'BTC', network: 'BTC', decimals: 8 },
    ]);
    mockPrisma.pricingPolicy.update.mockImplementation(
      async ({ data }: { data: { configJson: string } }) => ({
        ...withdrawal,
        configJson: data.configJson,
      }),
    );

    const result = await service.getWithdrawalPolicy();

    expect(result.assets).toHaveLength(2);
    const btcEntry = result.assets.find((item) => item.assetId === 'asset-btc');
    expect(btcEntry).toBeDefined();
    expect(btcEntry?.tiers).toHaveLength(1);
    expect(btcEntry?.tiers[0].feeItems).toHaveLength(2);
    expect(btcEntry?.tiers[0].feeItems.map((fee) => fee.itemCode)).toEqual([
      'WITHDRAW_SERVICE_FEE',
      'NETWORK_FEE_EST',
    ]);
  });

  it('should reject withdrawal policy when percent fee misses minimum', async () => {
    const invalid = buildBaseWithdrawalPolicy();
    invalid.assets[0].tiers[0].feeItems[0] = {
      ...invalid.assets[0].tiers[0].feeItems[0],
      calcType: 'PERCENT',
      min: null,
    };

    await expect(service.updateWithdrawalPolicy(invalid)).rejects.toThrow(
      'requires minimum when calcType=PERCENT',
    );
    expect(mockPrisma.pricingPolicy.update).not.toHaveBeenCalled();
  });
});
