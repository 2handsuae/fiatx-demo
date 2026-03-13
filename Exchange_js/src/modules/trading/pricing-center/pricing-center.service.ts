import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, PricingPolicy, WithdrawPricingQuote } from '@prisma/client';
import { randomUUID } from 'crypto';
import { generateReferenceNo } from '../../../common/utils/no-generator.util';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AuditLogsService } from '../../risk-engine/audit-logs/audit-logs.service';
import {
  AuditActions,
  AuditEntityTypes,
  AuditModules,
} from '../../risk-engine/audit-logs/constants/audit-actions.constant';
import {
  AuditResult,
  AuditTriggerType,
} from '../../risk-engine/audit-logs/dto/audit-log.dto';
import {
  CreateWithdrawPricingQuoteDto,
  SwapSimulatorDto,
  WithdrawalSimulatorDto,
} from './dto/pricing-center.dto';
import { PricingEngineService } from './pricing-engine.service';
import { BinanceRateProvider } from './providers/binance-rate.provider';
import {
  FeeItem,
  LpCode,
  PricingPolicyListItem,
  ProviderRateQuote,
  SWAP_POLICY_CODE,
  SwapPairEntry,
  SwapPricingPolicyConfig,
  SwapPricingResult,
  WITHDRAWAL_POLICY_CODE,
  WITHDRAW_QUOTE_TTL_SECONDS,
  WithdrawalFeeItemCode,
  WithdrawalAssetEntry,
  WithdrawalPricingPolicyConfig,
  WithdrawalPricingResult,
} from './types/pricing.types';

interface AuditActor {
  actorType: 'ADMIN' | 'CUSTOMER' | 'SYSTEM';
  actorId: string;
  actorNo?: string;
  actorRole?: string;
}

interface ResolvedSwapExecutionQuote {
  fromAssetId: string;
  toAssetId: string;
  fromAssetCode: string;
  toAssetCode: string;
  fromAssetDecimals: number;
  toAssetDecimals: number;
  quotedRate: Prisma.Decimal;
  baseRate: Prisma.Decimal;
  markupBps: number;
  quoteLockSeconds: number;
  baseProvider: string;
  fetchedAt: Date;
  expiresAt: Date;
  pairId: string;
  pairName: string;
  tierId: string;
  tierName: string;
  fees: SwapPricingResult['fees'];
  totals: Record<string, string>;
  policyRef: SwapPricingResult['policyRef'];
  pricingSource: {
    provider: 'BINANCE';
    endpoint: 'api/v3/ticker/bookTicker';
    symbol: string;
    bid: string;
    ask: string;
    sideUsed: 'BID' | 'INVERSE_ASK';
    aedPegApplied: boolean;
    aedPegRate: string;
    formula: string;
    effectiveBaseRate: string;
    fetchedAt: string;
  };
}

interface ResolvedWithdrawalQuote {
  assetId: string;
  assetCode: string;
  amount: Prisma.Decimal;
  matchedAssetEntryId: string;
  tierId: string;
  tierName: string;
  fees: WithdrawalPricingResult['fees'];
  totals: Record<string, string>;
  policyRef: WithdrawalPricingResult['policyRef'];
  createdAt: Date;
  expiresAt: Date;
}

@Injectable()
export class PricingCenterService {
  private readonly auditLogsService: AuditLogsService;
  private static readonly WITHDRAW_QUOTE_FAR_EXPIRY = '2099-12-31T23:59:59.000Z';
  private static readonly WITHDRAW_SERVICE_FEE_CODE: WithdrawalFeeItemCode =
    'WITHDRAW_SERVICE_FEE';
  private static readonly WITHDRAW_GAS_FEE_CODE: WithdrawalFeeItemCode =
    'NETWORK_FEE_EST';

  constructor(
    private readonly prisma: PrismaService,
    private readonly pricingEngineService: PricingEngineService,
    private readonly binanceRateProvider: BinanceRateProvider,
  ) {
    this.auditLogsService = new AuditLogsService(prisma);
  }

  private normalizeAmountBound(value: unknown): string | null {
    if (value === null || value === undefined || value === '') {
      return null;
    }
    try {
      return new Prisma.Decimal(value as Prisma.Decimal.Value).toString();
    } catch {
      return null;
    }
  }

  private toNonNegativeDecimalString(value: unknown, fallback = '0'): string {
    try {
      const decimal = new Prisma.Decimal(value as Prisma.Decimal.Value);
      if (decimal.lt(0)) {
        return fallback;
      }
      return decimal.toString();
    } catch {
      return fallback;
    }
  }

  private getWithdrawalQuoteFarExpiry(): Date {
    return new Date(PricingCenterService.WITHDRAW_QUOTE_FAR_EXPIRY);
  }

  private defaultWithdrawalFeeItem(
    feeId: string,
    itemCode: WithdrawalFeeItemCode,
    assetCode: string,
    decimals: number,
  ): FeeItem {
    return {
      id: feeId,
      itemCode,
      calcType: 'FLAT',
      value: '0',
      currency: assetCode,
      min: null,
      cap: null,
      roundingDp: decimals,
      roundingMode: 'ROUND',
      adjustable: false,
    };
  }

  private normalizeWithdrawalFeeItem(
    raw: unknown,
    fallbackId: string,
    itemCode: WithdrawalFeeItemCode,
    assetCode: string,
    decimals: number,
  ): FeeItem {
    const base = this.defaultWithdrawalFeeItem(
      fallbackId,
      itemCode,
      assetCode,
      decimals,
    );
    if (!raw || typeof raw !== 'object') {
      return base;
    }

    const asItem = raw as Partial<FeeItem>;
    const calcType = asItem.calcType === 'PERCENT' ? 'PERCENT' : 'FLAT';
    const value = this.toNonNegativeDecimalString(asItem.value, '0');
    const minValue =
      calcType === 'PERCENT'
        ? this.toNonNegativeDecimalString(asItem.min, '0')
        : null;

    return {
      ...base,
      id: asItem.id || fallbackId,
      calcType,
      value,
      min: minValue,
    };
  }

  private normalizeWithdrawalEntryForActiveAsset(
    entry: WithdrawalAssetEntry | undefined,
    asset: {
      id: string;
      code: string;
      network: string | null;
      decimals: number;
    },
    index: number,
  ): WithdrawalAssetEntry {
    const entryId = entry?.id || `ASSET-${String(index + 1).padStart(4, '0')}`;
    const tier = entry?.tiers?.[0];
    const tierId = tier?.id || `${entryId}-TIER-001`;
    const feeItems = (tier?.feeItems || []).filter((item) =>
      item &&
      (item.itemCode === PricingCenterService.WITHDRAW_SERVICE_FEE_CODE ||
        item.itemCode === PricingCenterService.WITHDRAW_GAS_FEE_CODE),
    );

    const serviceRaw = feeItems.find(
      (item) => item.itemCode === PricingCenterService.WITHDRAW_SERVICE_FEE_CODE,
    );
    const gasRaw = feeItems.find(
      (item) => item.itemCode === PricingCenterService.WITHDRAW_GAS_FEE_CODE,
    );

    return {
      id: entryId,
      assetId: asset.id,
      assetCode: asset.code,
      network: asset.network,
      enabled: entry?.enabled ?? true,
      tiers: [
        {
          id: tierId,
          name: tier?.name || 'Default Tier',
          priority: 1,
          enabled: true,
          conditions: {
            amountMin: '0',
            amountMax: null,
          },
          feeItems: [
            this.normalizeWithdrawalFeeItem(
              serviceRaw,
              `${tierId}-FEE-001`,
              PricingCenterService.WITHDRAW_SERVICE_FEE_CODE,
              asset.code,
              asset.decimals,
            ),
            this.normalizeWithdrawalFeeItem(
              gasRaw,
              `${tierId}-FEE-002`,
              PricingCenterService.WITHDRAW_GAS_FEE_CODE,
              asset.code,
              asset.decimals,
            ),
          ],
        },
      ],
    };
  }

  private async alignWithdrawalPolicyWithActiveAssets(
    config: WithdrawalPricingPolicyConfig,
  ): Promise<{ config: WithdrawalPricingPolicyConfig; changed: boolean }> {
    const activeAssets = await this.prisma.asset.findMany({
      where: { status: 'ACTIVE' },
      orderBy: [{ type: 'asc' }, { code: 'asc' }, { network: 'asc' }],
      select: {
        id: true,
        code: true,
        network: true,
        decimals: true,
      },
    });

    const byAssetId = new Map<string, WithdrawalAssetEntry>();
    (config.assets || []).forEach((entry) => {
      byAssetId.set(entry.assetId, entry);
    });

    const alignedAssets = activeAssets.map((asset, index) =>
      this.normalizeWithdrawalEntryForActiveAsset(
        byAssetId.get(asset.id),
        asset,
        index,
      ),
    );

    const normalized: WithdrawalPricingPolicyConfig = {
      ...config,
      assets: alignedAssets,
    };

    return {
      config: normalized,
      changed: JSON.stringify(normalized) !== JSON.stringify(config),
    };
  }

  private normalizeSwapConfig(raw: SwapPricingPolicyConfig): SwapPricingPolicyConfig {
    return {
      policyId: raw.policyId,
      policyName: raw.policyName || 'Swap Pricing',
      business: 'SWAP',
      channel: {
        online: raw.channel?.online ?? true,
        storeComingSoon: raw.channel?.storeComingSoon ?? true,
      },
      pairs: (raw.pairs || []).map((pair) => ({
        id: pair.id,
        name: pair.name,
        assetAId: pair.assetAId,
        assetALabel: pair.assetALabel,
        assetBId: pair.assetBId,
        assetBLabel: pair.assetBLabel,
        enabled: Boolean(pair.enabled),
        routing: {
          provider: 'LP_A',
          maxStalenessSec: Math.max(1, Number((pair as any)?.routing?.maxStalenessSec || 30)),
          quoteLockSeconds: Math.max(1, Number((pair as any)?.routing?.quoteLockSeconds || 30)),
          rounding: {
            dp: Math.max(0, Number((pair as any)?.routing?.rounding?.dp ?? 8)),
            mode: (pair as any)?.routing?.rounding?.mode || 'ROUND',
          },
        },
        tiers: [
          (() => {
            const tier = pair.tiers?.[0];
            return {
              id: tier?.id || `${pair.id}-TIER-001`,
              name: tier?.name || 'Default Tier',
              priority: 1,
              enabled: true,
              rateMarkupBps: Number((tier as any)?.rateMarkupBps || 0),
              conditions: {
                amountMin: '0',
                amountMax: null,
              },
              // Phase 1: swap pricing is rate-only, fee lines are fixed empty.
              feeItems: [],
            };
          })(),
        ],
      })),
    };
  }

  private normalizeWithdrawalConfig(
    raw: WithdrawalPricingPolicyConfig,
  ): WithdrawalPricingPolicyConfig {
    return {
      policyId: raw.policyId,
      policyName: raw.policyName || 'Withdrawal Pricing',
      business: 'WITHDRAWAL',
      channel: {
        online: raw.channel?.online ?? true,
        storeComingSoon: raw.channel?.storeComingSoon ?? true,
      },
      assets: (raw.assets || []).map((entry) => ({
        id: entry.id,
        assetId: entry.assetId,
        assetCode: entry.assetCode,
        network: entry.network || null,
        enabled: Boolean(entry.enabled),
        tiers: [
          (() => {
            const tier = entry.tiers?.[0];
            return {
              id: tier?.id || `${entry.id}-TIER-001`,
              name: tier?.name || 'Default Tier',
              priority: 1,
              enabled: true,
              conditions: {
                amountMin: '0',
                amountMax: null,
              },
              feeItems: (tier?.feeItems || []).map((item, index) => ({
                id: item.id || `${tier?.id || `${entry.id}-TIER-001`}-FEE-${String(index + 1).padStart(3, '0')}`,
                itemCode: item.itemCode,
                calcType: item.calcType === 'PERCENT' ? 'PERCENT' : 'FLAT',
                value: this.toNonNegativeDecimalString(item.value, '0'),
                currency: String(item.currency || entry.assetCode || '').toUpperCase(),
                min:
                  item.min === null || item.min === undefined || item.min === ''
                    ? null
                    : this.toNonNegativeDecimalString(item.min, '0'),
                cap: null,
                roundingDp: Number(item.roundingDp ?? 8),
                roundingMode: item.roundingMode || 'ROUND',
                adjustable: false,
              })),
            };
          })(),
        ],
      })),
    };
  }

  private parseSwapConfig(policy: PricingPolicy): SwapPricingPolicyConfig {
    try {
      const config = JSON.parse(policy.configJson) as SwapPricingPolicyConfig;
      if (!config || config.business !== 'SWAP' || !Array.isArray(config.pairs)) {
        throw new Error('Invalid swap pricing config');
      }
      return this.normalizeSwapConfig(config);
    } catch (error) {
      throw new InternalServerErrorException(
        `Failed to parse swap pricing policy: ${String(error)}`,
      );
    }
  }

  private parseWithdrawalConfig(policy: PricingPolicy): WithdrawalPricingPolicyConfig {
    try {
      const config = JSON.parse(policy.configJson) as WithdrawalPricingPolicyConfig;
      if (!config || config.business !== 'WITHDRAWAL' || !Array.isArray(config.assets)) {
        throw new Error('Invalid withdrawal pricing config');
      }
      return this.normalizeWithdrawalConfig(config);
    } catch (error) {
      throw new InternalServerErrorException(
        `Failed to parse withdrawal pricing policy: ${String(error)}`,
      );
    }
  }

  private formatAssetLabel(asset: {
    code: string;
    network: string | null;
  }): string {
    return asset.network ? `${asset.code}-${asset.network}` : asset.code;
  }

  private buildDefaultSwapPolicyConfig(
    assets: Array<{
      id: string;
      code: string;
      type: string;
      network: string | null;
      decimals: number;
    }>,
  ): SwapPricingPolicyConfig {
    const pairs: SwapPairEntry[] = [];
    let pairSeq = 1;

    for (let i = 0; i < assets.length; i += 1) {
      for (let j = 0; j < assets.length; j += 1) {
        if (i === j) {
          continue;
        }
        const left = assets[i];
        const right = assets[j];
        if (left.type === 'FIAT' && right.type === 'FIAT') {
          continue;
        }

        const pairId = `PAIR-${String(pairSeq).padStart(4, '0')}`;
        const tierId = `${pairId}-TIER-001`;
        pairSeq += 1;

        pairs.push({
          id: pairId,
          name: `${this.formatAssetLabel(left)} -> ${this.formatAssetLabel(right)}`,
          assetAId: left.id,
          assetALabel: this.formatAssetLabel(left),
          assetBId: right.id,
          assetBLabel: this.formatAssetLabel(right),
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

  private buildDefaultWithdrawalPolicyConfig(
    assets: Array<{
      id: string;
      code: string;
      network: string | null;
      decimals: number;
    }>,
  ): WithdrawalPricingPolicyConfig {
    const entries: WithdrawalAssetEntry[] = assets.map((asset, index) => {
      const entryId = `ASSET-${String(index + 1).padStart(4, '0')}`;
      const tierId = `${entryId}-TIER-001`;
      return {
        id: entryId,
        assetId: asset.id,
        assetCode: asset.code,
        network: asset.network,
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
                calcType: 'FLAT',
                value: '0',
                currency: asset.code,
                min: null,
                cap: null,
                roundingDp: asset.decimals,
                roundingMode: 'ROUND',
                adjustable: false,
              },
              {
                id: `${tierId}-FEE-002`,
                itemCode: 'NETWORK_FEE_EST',
                calcType: 'FLAT',
                value: '0',
                currency: asset.code,
                min: null,
                cap: null,
                roundingDp: asset.decimals,
                roundingMode: 'ROUND',
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
      assets: entries,
    };
  }

  async ensurePoliciesReady() {
    const [swap, withdrawal] = await Promise.all([
      this.prisma.pricingPolicy.findUnique({ where: { policyCode: SWAP_POLICY_CODE } }),
      this.prisma.pricingPolicy.findUnique({ where: { policyCode: WITHDRAWAL_POLICY_CODE } }),
    ]);

    if (swap && withdrawal) {
      return { swap, withdrawal };
    }

    const activeAssets = await this.prisma.asset.findMany({
      where: { status: 'ACTIVE' },
      orderBy: [{ type: 'asc' }, { code: 'asc' }, { network: 'asc' }],
      select: {
        id: true,
        code: true,
        type: true,
        network: true,
        decimals: true,
      },
    });

    const swapConfig = this.buildDefaultSwapPolicyConfig(activeAssets);
    const withdrawalConfig = this.buildDefaultWithdrawalPolicyConfig(activeAssets);

    await this.prisma.pricingPolicy.upsert({
      where: { policyCode: SWAP_POLICY_CODE },
      update: {
        policyName: 'Swap Pricing',
        business: 'SWAP',
        channelOnline: true,
        channelStoreSoon: true,
        configJson: JSON.stringify(swapConfig),
        updatedByUserId: 'SYSTEM',
        updatedByUserNo: 'SYSTEM',
      },
      create: {
        policyCode: SWAP_POLICY_CODE,
        policyName: 'Swap Pricing',
        business: 'SWAP',
        channelOnline: true,
        channelStoreSoon: true,
        configJson: JSON.stringify(swapConfig),
        updatedByUserId: 'SYSTEM',
        updatedByUserNo: 'SYSTEM',
      },
    });

    await this.prisma.pricingPolicy.upsert({
      where: { policyCode: WITHDRAWAL_POLICY_CODE },
      update: {
        policyName: 'Withdrawal Pricing',
        business: 'WITHDRAWAL',
        channelOnline: true,
        channelStoreSoon: true,
        configJson: JSON.stringify(withdrawalConfig),
        updatedByUserId: 'SYSTEM',
        updatedByUserNo: 'SYSTEM',
      },
      create: {
        policyCode: WITHDRAWAL_POLICY_CODE,
        policyName: 'Withdrawal Pricing',
        business: 'WITHDRAWAL',
        channelOnline: true,
        channelStoreSoon: true,
        configJson: JSON.stringify(withdrawalConfig),
        updatedByUserId: 'SYSTEM',
        updatedByUserNo: 'SYSTEM',
      },
    });

    const [readySwap, readyWithdrawal] = await Promise.all([
      this.prisma.pricingPolicy.findUnique({ where: { policyCode: SWAP_POLICY_CODE } }),
      this.prisma.pricingPolicy.findUnique({ where: { policyCode: WITHDRAWAL_POLICY_CODE } }),
    ]);

    if (!readySwap || !readyWithdrawal) {
      throw new InternalServerErrorException('Failed to initialize pricing policies');
    }

    return {
      swap: readySwap,
      withdrawal: readyWithdrawal,
    };
  }

  private toPolicySummary(item: PricingPolicy): PricingPolicyListItem {
    let policyId = item.id;
    try {
      const parsed = JSON.parse(item.configJson) as { policyId?: string };
      policyId = parsed.policyId || policyId;
    } catch {
      // ignore malformed payload in summary path
    }

    return {
      policyCode: item.policyCode,
      policyName: item.policyName,
      policyId,
      business: item.business as any,
      channel: {
        online: item.channelOnline,
        storeComingSoon: item.channelStoreSoon,
      },
      lastUpdatedAt: item.updatedAt.toISOString(),
      lastUpdatedBy: item.updatedByUserNo || item.updatedByUserId || null,
    };
  }

  async listPolicies(): Promise<{ items: PricingPolicyListItem[] }> {
    const { swap, withdrawal } = await this.ensurePoliciesReady();
    return {
      items: [this.toPolicySummary(swap), this.toPolicySummary(withdrawal)],
    };
  }

  async getSwapPolicy(): Promise<SwapPricingPolicyConfig> {
    const { swap } = await this.ensurePoliciesReady();
    return this.parseSwapConfig(swap);
  }

  async getWithdrawalPolicy(): Promise<WithdrawalPricingPolicyConfig> {
    const { withdrawal } = await this.ensurePoliciesReady();
    const parsed = this.parseWithdrawalConfig(withdrawal);
    const { config, changed } = await this.alignWithdrawalPolicyWithActiveAssets(
      parsed,
    );

    if (changed) {
      await this.prisma.pricingPolicy.update({
        where: { policyCode: WITHDRAWAL_POLICY_CODE },
        data: {
          policyName: config.policyName || 'Withdrawal Pricing',
          business: 'WITHDRAWAL',
          channelOnline: true,
          channelStoreSoon: true,
          configJson: JSON.stringify(config),
          updatedByUserId: 'SYSTEM',
          updatedByUserNo: 'SYSTEM',
        },
      });
    }

    return config;
  }

  private parseRangeBound(
    value: string | null,
    label: string,
    allowInfinity: 'NEG' | 'POS',
  ): Prisma.Decimal {
    if (value === null || value === '') {
      return allowInfinity === 'NEG'
        ? new Prisma.Decimal('-1e30')
        : new Prisma.Decimal('1e30');
    }
    try {
      return new Prisma.Decimal(value);
    } catch {
      throw new BadRequestException(`${label} must be a valid numeric value`);
    }
  }

  private validateNoOverlap(
    ranges: Array<{ id: string; min: string | null; max: string | null }>,
    scope: string,
  ) {
    const normalized = ranges
      .map((item) => ({
        id: item.id,
        minRaw: item.min,
        maxRaw: item.max,
        min: this.parseRangeBound(item.min, `${scope} ${item.id} amountMin`, 'NEG'),
        max: this.parseRangeBound(item.max, `${scope} ${item.id} amountMax`, 'POS'),
      }))
      .sort((a, b) => a.min.cmp(b.min) || a.max.cmp(b.max));

    normalized.forEach((item) => {
      if (item.min.gt(item.max)) {
        throw new BadRequestException(`${scope} ${item.id} requires amountMin <= amountMax`);
      }
    });

    for (let i = 1; i < normalized.length; i += 1) {
      const prev = normalized[i - 1];
      const current = normalized[i];
      if (current.min.lte(prev.max)) {
        throw new BadRequestException(
          `${scope} tiers have overlapping amount ranges: ${prev.id} and ${current.id}`,
        );
      }
    }
  }

  private validateSwapPolicy(config: SwapPricingPolicyConfig): void {
    if (config.business !== 'SWAP') {
      throw new BadRequestException('Swap policy business must be SWAP');
    }
    if (!Array.isArray(config.pairs)) {
      throw new BadRequestException('Swap policy pairs must be an array');
    }

    const directionKeys = new Set<string>();
    config.pairs.forEach((pair) => {
      if (!Array.isArray(pair.tiers)) {
        throw new BadRequestException(`Swap pair ${pair.id} tiers must be an array`);
      }

      if (!pair.assetAId || !pair.assetBId) {
        throw new BadRequestException(`Swap pair ${pair.id} requires assetAId and assetBId`);
      }

      if (pair.assetAId === pair.assetBId) {
        throw new BadRequestException(`Swap pair ${pair.id} cannot use the same asset on both sides`);
      }

      const directionKey = `${pair.assetAId}->${pair.assetBId}`;
      if (directionKeys.has(directionKey)) {
        throw new BadRequestException(`Duplicate swap direction is not allowed: ${directionKey}`);
      }
      directionKeys.add(directionKey);

      if (pair.routing.provider !== 'LP_A') {
        throw new BadRequestException(`Swap pair ${pair.id} provider must be LP_A`);
      }

      if (pair.tiers.length !== 1) {
        throw new BadRequestException(`Swap pair ${pair.id} must contain exactly one tier`);
      }

      const tier = pair.tiers[0];
      if ((tier.feeItems || []).length > 0) {
        throw new BadRequestException(`Swap pair ${pair.id} ${tier.id} feeItems must be empty`);
      }
    });
  }

  private validateWithdrawalPolicy(config: WithdrawalPricingPolicyConfig): void {
    if (config.business !== 'WITHDRAWAL') {
      throw new BadRequestException('Withdrawal policy business must be WITHDRAWAL');
    }
    if (!Array.isArray(config.assets)) {
      throw new BadRequestException('Withdrawal policy assets must be an array');
    }

    const allowedFeeCodes = new Set<WithdrawalFeeItemCode>([
      PricingCenterService.WITHDRAW_SERVICE_FEE_CODE,
      PricingCenterService.WITHDRAW_GAS_FEE_CODE,
    ]);
    const seenAssetIds = new Set<string>();

    config.assets.forEach((entry) => {
      if (!entry.assetId) {
        throw new BadRequestException(`Withdrawal asset ${entry.id} requires assetId`);
      }
      if (seenAssetIds.has(entry.assetId)) {
        throw new BadRequestException(
          `Duplicate withdrawal asset entry is not allowed: ${entry.assetId}`,
        );
      }
      seenAssetIds.add(entry.assetId);

      if (!Array.isArray(entry.tiers) || entry.tiers.length !== 1) {
        throw new BadRequestException(
          `Withdrawal asset ${entry.id} must contain exactly one tier`,
        );
      }

      const tier = entry.tiers[0];
      if (!Array.isArray(tier.feeItems) || tier.feeItems.length !== 2) {
        throw new BadRequestException(
          `Withdrawal asset ${entry.id} must contain exactly 2 fee items`,
        );
      }

      const seenFeeCodes = new Set<WithdrawalFeeItemCode>();
      tier.feeItems.forEach((item) => {
        const code = item.itemCode as WithdrawalFeeItemCode;
        if (!allowedFeeCodes.has(code)) {
          throw new BadRequestException(
            `Withdrawal asset ${entry.id} has unsupported fee itemCode: ${item.itemCode}`,
          );
        }
        if (seenFeeCodes.has(code)) {
          throw new BadRequestException(
            `Withdrawal asset ${entry.id} has duplicated fee itemCode: ${item.itemCode}`,
          );
        }
        seenFeeCodes.add(code);

        if (String(item.currency || '').toUpperCase() !== String(entry.assetCode || '').toUpperCase()) {
          throw new BadRequestException(
            `Withdrawal asset ${entry.id} ${item.itemCode} currency must match asset code`,
          );
        }

        if (item.calcType !== 'PERCENT' && item.calcType !== 'FLAT') {
          throw new BadRequestException(
            `Withdrawal asset ${entry.id} ${item.itemCode} calcType must be PERCENT or FLAT`,
          );
        }

        try {
          const value = new Prisma.Decimal(item.value);
          if (value.lt(0)) {
            throw new BadRequestException(
              `Withdrawal asset ${entry.id} ${item.itemCode} value must be >= 0`,
            );
          }
        } catch (error) {
          if (error instanceof BadRequestException) {
            throw error;
          }
          throw new BadRequestException(
            `Withdrawal asset ${entry.id} ${item.itemCode} value is invalid`,
          );
        }

        if (item.calcType === 'PERCENT') {
          if (item.min === null || item.min === undefined || item.min === '') {
            throw new BadRequestException(
              `Withdrawal asset ${entry.id} ${item.itemCode} requires minimum when calcType=PERCENT`,
            );
          }
          try {
            const min = new Prisma.Decimal(item.min);
            if (min.lt(0)) {
              throw new BadRequestException(
                `Withdrawal asset ${entry.id} ${item.itemCode} minimum must be >= 0`,
              );
            }
          } catch (error) {
            if (error instanceof BadRequestException) {
              throw error;
            }
            throw new BadRequestException(
              `Withdrawal asset ${entry.id} ${item.itemCode} minimum is invalid`,
            );
          }
        } else if (item.min !== null && item.min !== undefined && item.min !== '') {
          try {
            const min = new Prisma.Decimal(item.min);
            if (min.lt(0)) {
              throw new BadRequestException(
                `Withdrawal asset ${entry.id} ${item.itemCode} minimum must be >= 0`,
              );
            }
          } catch (error) {
            if (error instanceof BadRequestException) {
              throw error;
            }
            throw new BadRequestException(
              `Withdrawal asset ${entry.id} ${item.itemCode} minimum is invalid`,
            );
          }
        }
      });

      if (
        !seenFeeCodes.has(PricingCenterService.WITHDRAW_SERVICE_FEE_CODE) ||
        !seenFeeCodes.has(PricingCenterService.WITHDRAW_GAS_FEE_CODE)
      ) {
        throw new BadRequestException(
          `Withdrawal asset ${entry.id} must contain both service fee and gas fee`,
        );
      }
    });
  }

  async updateSwapPolicy(config: SwapPricingPolicyConfig, actor?: AuditActor) {
    this.validateSwapPolicy(config);
    const normalizedConfig = this.normalizeSwapConfig(config);
    await this.ensurePoliciesReady();

    const updated = await this.prisma.pricingPolicy.update({
      where: { policyCode: SWAP_POLICY_CODE },
      data: {
        policyName: normalizedConfig.policyName || 'Swap Pricing',
        business: 'SWAP',
        channelOnline: true,
        channelStoreSoon: true,
        configJson: JSON.stringify(normalizedConfig),
        updatedByUserId: actor?.actorId || 'SYSTEM',
        updatedByUserNo: actor?.actorNo || actor?.actorId || 'SYSTEM',
      },
    });

    if (actor) {
      await this.auditLogsService.recordByActor(
        {
          triggerType: AuditTriggerType.CONFIG_CHANGE,
          action: AuditActions.PRICING_POLICY_UPDATED,
          module: AuditModules.PRICING_CENTER,
          entityType: AuditEntityTypes.PRICING_POLICY,
          entityId: updated.id,
          entityNo: updated.policyCode,
          result: AuditResult.SUCCESS,
          reason: 'Swap pricing policy updated',
          afterData: {
            policyCode: updated.policyCode,
            business: updated.business,
          },
          sourcePlatform: 'ADMIN_API',
        },
        actor,
      );
    }

    return this.parseSwapConfig(updated);
  }

  async updateWithdrawalPolicy(config: WithdrawalPricingPolicyConfig, actor?: AuditActor) {
    const normalizedConfig = this.normalizeWithdrawalConfig(config);
    this.validateWithdrawalPolicy(normalizedConfig);
    const aligned = await this.alignWithdrawalPolicyWithActiveAssets(
      normalizedConfig,
    );
    await this.ensurePoliciesReady();

    const updated = await this.prisma.pricingPolicy.update({
      where: { policyCode: WITHDRAWAL_POLICY_CODE },
      data: {
        policyName: aligned.config.policyName || 'Withdrawal Pricing',
        business: 'WITHDRAWAL',
        channelOnline: true,
        channelStoreSoon: true,
        configJson: JSON.stringify(aligned.config),
        updatedByUserId: actor?.actorId || 'SYSTEM',
        updatedByUserNo: actor?.actorNo || actor?.actorId || 'SYSTEM',
      },
    });

    if (actor) {
      await this.auditLogsService.recordByActor(
        {
          triggerType: AuditTriggerType.CONFIG_CHANGE,
          action: AuditActions.PRICING_POLICY_UPDATED,
          module: AuditModules.PRICING_CENTER,
          entityType: AuditEntityTypes.PRICING_POLICY,
          entityId: updated.id,
          entityNo: updated.policyCode,
          result: AuditResult.SUCCESS,
          reason: 'Withdrawal pricing policy updated',
          afterData: {
            policyCode: updated.policyCode,
            business: updated.business,
          },
          sourcePlatform: 'ADMIN_API',
        },
        actor,
      );
    }

    return this.parseWithdrawalConfig(updated);
  }

  private async fetchProviderQuote(
    provider: LpCode,
    fromCode: string,
    toCode: string,
  ): Promise<ProviderRateQuote> {
    const result = await this.binanceRateProvider.fetchRate(fromCode, toCode);
    return {
      provider: 'LP_A',
      providerName: 'BINANCE',
      baseRate: result.rate.toString(),
      fetchedAt: result.fetchedAt.toISOString(),
      symbol: result.symbol,
      bid: result.bid,
      ask: result.ask,
      sideUsed: result.sideUsed,
      aedPegApplied: result.aedPegApplied,
      aedPegRate: result.aedPegRate,
      formula: result.formula,
    };
  }

  private isStale(quote: ProviderRateQuote, maxStalenessSec: number, now: Date): boolean {
    const fetchedAt = new Date(quote.fetchedAt);
    return now.getTime() - fetchedAt.getTime() > maxStalenessSec * 1000;
  }

  private pickPairForSwap(
    pairs: SwapPairEntry[],
    fromAssetId: string,
    toAssetId: string,
  ): SwapPairEntry {
    const candidate = pairs.find(
      (pair) =>
        pair.enabled &&
        pair.assetAId === fromAssetId &&
        pair.assetBId === toAssetId,
    );

    if (!candidate) {
      throw new BadRequestException(
        `No enabled pricing pair for direction ${fromAssetId} -> ${toAssetId}`,
      );
    }

    return candidate;
  }

  async resolveOwnerNo(ownerType: string, ownerId: string): Promise<string | null> {
    if (ownerType === 'CUSTOMER') {
      const customer = await (this.prisma as any).customerMain.findUnique({
        where: { id: ownerId },
        select: { customerNo: true },
      });
      return customer?.customerNo || null;
    }

    if (ownerType === 'ADMIN') {
      const admin = await (this.prisma as any).user.findUnique({
        where: { id: ownerId },
        select: { userNo: true },
      });
      return admin?.userNo || null;
    }

    return null;
  }

  async resolveSwapQuoteForExecution(input: {
    fromAssetId: string;
    toAssetId: string;
    amount: number | string | Prisma.Decimal;
  }): Promise<ResolvedSwapExecutionQuote> {
    const { swap } = await this.ensurePoliciesReady();
    const swapConfig = this.parseSwapConfig(swap);

    const [fromAsset, toAsset] = await Promise.all([
      this.prisma.asset.findUnique({ where: { id: input.fromAssetId } }),
      this.prisma.asset.findUnique({ where: { id: input.toAssetId } }),
    ]);

    if (!fromAsset || !toAsset) {
      throw new NotFoundException('Asset not found for swap pricing');
    }

    const pair = this.pickPairForSwap(swapConfig.pairs, fromAsset.id, toAsset.id);
    const amount = new Prisma.Decimal(input.amount);

    const tier = this.pricingEngineService.findMatchedSwapTier({
      tiers: pair.tiers,
      amount,
    });

    if (!tier) {
      throw new BadRequestException(
        `No pricing tier matched for amount ${amount.toString()} in pair ${pair.id}`,
      );
    }

    const now = new Date();
    const provider: LpCode = pair.routing.provider || 'LP_A';
    let selectedQuote: ProviderRateQuote;
    try {
      selectedQuote = await this.fetchProviderQuote(provider, fromAsset.code, toAsset.code);
    } catch {
      throw new BadRequestException('No valid LP quote available for this pair');
    }
    if (this.isStale(selectedQuote, pair.routing.maxStalenessSec, now)) {
      throw new BadRequestException('No valid LP quote available for this pair');
    }

    const pricingResult = this.pricingEngineService.buildSwapQuote({
      amount,
      baseRate: new Prisma.Decimal(selectedQuote.baseRate),
      markupBps: tier.rateMarkupBps,
      roundingDp: pair.routing.rounding.dp,
      roundingMode: pair.routing.rounding.mode,
      quoteLockSeconds: pair.routing.quoteLockSeconds,
      fees: tier.feeItems,
      createdAt: now,
      pairId: pair.id,
      pairName: pair.name,
      tierId: tier.id,
      tierName: tier.name,
      baseProvider: selectedQuote.providerName,
      policyCode: SWAP_POLICY_CODE,
      policyId: swapConfig.policyId,
    });

    return {
      fromAssetId: fromAsset.id,
      toAssetId: toAsset.id,
      fromAssetCode: fromAsset.code,
      toAssetCode: toAsset.code,
      fromAssetDecimals: fromAsset.decimals,
      toAssetDecimals: toAsset.decimals,
      quotedRate: new Prisma.Decimal(pricingResult.fx.quotedRate),
      baseRate: new Prisma.Decimal(pricingResult.fx.baseRate),
      markupBps: pricingResult.fx.markupBps,
      quoteLockSeconds: pair.routing.quoteLockSeconds,
      baseProvider: pricingResult.fx.baseProvider,
      fetchedAt: new Date(selectedQuote.fetchedAt),
      expiresAt: new Date(pricingResult.expiresAt),
      pairId: pair.id,
      pairName: pair.name,
      tierId: tier.id,
      tierName: tier.name,
      fees: pricingResult.fees,
      totals: pricingResult.totals,
      policyRef: pricingResult.policyRef,
      pricingSource: {
        provider: 'BINANCE',
        endpoint: 'api/v3/ticker/bookTicker',
        symbol: selectedQuote.symbol,
        bid: selectedQuote.bid,
        ask: selectedQuote.ask,
        sideUsed: selectedQuote.sideUsed,
        aedPegApplied: selectedQuote.aedPegApplied,
        aedPegRate: selectedQuote.aedPegRate,
        formula: selectedQuote.formula,
        effectiveBaseRate: selectedQuote.baseRate,
        fetchedAt: selectedQuote.fetchedAt,
      },
    };
  }

  async getSwapPairMarketSource(pairId: string) {
    const { swap } = await this.ensurePoliciesReady();
    const swapConfig = this.parseSwapConfig(swap);
    const pair = swapConfig.pairs.find((item) => item.id === pairId);
    if (!pair) {
      throw new NotFoundException(`Swap pair ${pairId} not found`);
    }

    const [fromAsset, toAsset] = await Promise.all([
      this.prisma.asset.findUnique({ where: { id: pair.assetAId } }),
      this.prisma.asset.findUnique({ where: { id: pair.assetBId } }),
    ]);

    if (!fromAsset || !toAsset) {
      throw new NotFoundException('Asset not found for swap pair');
    }

    let providerQuote: ProviderRateQuote;
    try {
      providerQuote = await this.fetchProviderQuote(
        pair.routing.provider || 'LP_A',
        fromAsset.code,
        toAsset.code,
      );
    } catch {
      throw new BadRequestException('No valid LP quote available for this pair');
    }

    if (this.isStale(providerQuote, pair.routing.maxStalenessSec, new Date())) {
      throw new BadRequestException('No valid LP quote available for this pair');
    }

    return {
      pairId: pair.id,
      provider: 'BINANCE' as const,
      endpoint: 'api/v3/ticker/bookTicker' as const,
      symbol: providerQuote.symbol,
      bid: providerQuote.bid,
      ask: providerQuote.ask,
      sideUsed: providerQuote.sideUsed,
      aedPegApplied: providerQuote.aedPegApplied,
      aedPegRate: providerQuote.aedPegRate,
      formula: providerQuote.formula,
      effectiveBaseRate: providerQuote.baseRate,
      fetchedAt: providerQuote.fetchedAt,
    };
  }

  async simulateSwap(dto: SwapSimulatorDto, actor?: AuditActor) {
    const resolved = await this.resolveSwapQuoteForExecution({
      fromAssetId: dto.fromAssetId,
      toAssetId: dto.toAssetId,
      amount: dto.amount,
    });

    const quote = {
      quoteId: randomUUID(),
      createdAt: new Date().toISOString(),
      expiresAt: resolved.expiresAt.toISOString(),
      matched: {
        pairId: resolved.pairId,
        tierId: resolved.tierId,
        tierName: resolved.tierName,
      },
      fx: {
        baseProvider: resolved.baseProvider,
        baseRate: resolved.baseRate.toString(),
        quotedRate: resolved.quotedRate.toString(),
        markupBps: resolved.markupBps,
        endpoint: resolved.pricingSource.endpoint,
        symbol: resolved.pricingSource.symbol,
        bid: resolved.pricingSource.bid,
        ask: resolved.pricingSource.ask,
        sideUsed: resolved.pricingSource.sideUsed,
        aedPegApplied: resolved.pricingSource.aedPegApplied,
        aedPegRate: resolved.pricingSource.aedPegRate,
        formula: resolved.pricingSource.formula,
        effectiveBaseRate: resolved.pricingSource.effectiveBaseRate,
        fetchedAt: resolved.pricingSource.fetchedAt,
      },
      fees: resolved.fees,
      totals: resolved.totals,
      policyRef: resolved.policyRef,
    };

    if (actor) {
      await this.auditLogsService.recordByActor(
        {
          triggerType: AuditTriggerType.DATA_CREATE,
          action: AuditActions.SWAP_PRICING_SIMULATED,
          module: AuditModules.PRICING_CENTER,
          entityType: AuditEntityTypes.PRICING_POLICY,
          entityId: SWAP_POLICY_CODE,
          entityNo: quote.matched.pairId,
          result: AuditResult.SUCCESS,
          reason: 'Swap pricing simulated',
          afterData: {
            quoteId: quote.quoteId,
            matched: quote.matched,
          },
          sourcePlatform: 'ADMIN_API',
        },
        actor,
      );
    }

    return quote;
  }

  async resolveWithdrawalQuote(input: {
    assetId: string;
    amount: number | string | Prisma.Decimal;
  }): Promise<ResolvedWithdrawalQuote> {
    const withdrawalConfig = await this.getWithdrawalPolicy();

    const asset = await this.prisma.asset.findUnique({ where: { id: input.assetId } });
    if (!asset) {
      throw new NotFoundException('Asset not found for withdrawal pricing');
    }

    const assetEntry = withdrawalConfig.assets.find(
      (entry) => entry.enabled && entry.assetId === input.assetId,
    );

    if (!assetEntry) {
      throw new BadRequestException(`No enabled withdrawal pricing entry for asset ${input.assetId}`);
    }

    const amount = new Prisma.Decimal(input.amount);
    const tier = this.pricingEngineService.findMatchedWithdrawalTier({
      tiers: assetEntry.tiers,
      amount,
    });

    if (!tier) {
      throw new BadRequestException(
        `No withdrawal pricing tier matched for amount ${amount.toString()} in asset entry ${assetEntry.id}`,
      );
    }

    const now = new Date();
    const result = this.pricingEngineService.buildWithdrawalQuote({
      amount,
      fees: tier.feeItems,
      createdAt: now,
      quoteLockSeconds: WITHDRAW_QUOTE_TTL_SECONDS,
      policyCode: WITHDRAWAL_POLICY_CODE,
      policyId: withdrawalConfig.policyId,
      assetEntryId: assetEntry.id,
      assetId: asset.id,
      tierId: tier.id,
      tierName: tier.name,
    });

    return {
      assetId: asset.id,
      assetCode: asset.code,
      amount,
      matchedAssetEntryId: result.matched.assetEntryId,
      tierId: result.matched.tierId,
      tierName: result.matched.tierName,
      fees: result.fees,
      totals: result.totals,
      policyRef: result.policyRef,
      createdAt: now,
      expiresAt: this.getWithdrawalQuoteFarExpiry(),
    };
  }

  async simulateWithdrawal(dto: WithdrawalSimulatorDto, actor?: AuditActor) {
    const resolved = await this.resolveWithdrawalQuote({
      assetId: dto.assetId,
      amount: dto.amount,
    });

    const quote = {
      quoteId: randomUUID(),
      createdAt: resolved.createdAt.toISOString(),
      expiresAt: resolved.expiresAt.toISOString(),
      matched: {
        assetId: resolved.assetId,
        assetEntryId: resolved.matchedAssetEntryId,
        tierId: resolved.tierId,
        tierName: resolved.tierName,
      },
      fees: resolved.fees,
      totals: resolved.totals,
      policyRef: resolved.policyRef,
    };

    if (actor) {
      await this.auditLogsService.recordByActor(
        {
          triggerType: AuditTriggerType.DATA_CREATE,
          action: AuditActions.WITHDRAW_PRICING_SIMULATED,
          module: AuditModules.PRICING_CENTER,
          entityType: AuditEntityTypes.PRICING_POLICY,
          entityId: WITHDRAWAL_POLICY_CODE,
          entityNo: quote.matched.assetEntryId,
          result: AuditResult.SUCCESS,
          reason: 'Withdrawal pricing simulated',
          afterData: {
            quoteId: quote.quoteId,
            matched: quote.matched,
          },
          sourcePlatform: 'ADMIN_API',
        },
        actor,
      );
    }

    return quote;
  }

  async createWithdrawPricingQuote(
    ownerType: string,
    ownerId: string,
    ownerNo: string | null,
    dto: CreateWithdrawPricingQuoteDto,
  ) {
    const resolved = await this.resolveWithdrawalQuote({
      assetId: dto.assetId,
      amount: dto.amount,
    });

    const created = await this.prisma.withdrawPricingQuote.create({
      data: {
        quoteNo: generateReferenceNo('WQO'),
        status: 'ACTIVE',
        ownerType,
        ownerId,
        ownerNo,
        assetId: resolved.assetId,
        assetCode: resolved.assetCode,
        amount: resolved.amount,
        segment: 'ANY',
        riskTier: 'ANY',
        matchedAssetId: resolved.matchedAssetEntryId,
        matchedTierId: resolved.tierId,
        matchedTierName: resolved.tierName,
        feeBreakdown: JSON.stringify(resolved.fees),
        totalsJson: JSON.stringify(resolved.totals),
        policyRef: JSON.stringify(resolved.policyRef),
        expiresAt: this.getWithdrawalQuoteFarExpiry(),
      },
    });

    await this.auditLogsService.recordByActor(
      {
        triggerType: AuditTriggerType.DATA_CREATE,
        action: AuditActions.WITHDRAW_PRICING_QUOTE_CREATED,
        module: AuditModules.PRICING_CENTER,
        entityType: AuditEntityTypes.WITHDRAW_PRICING_QUOTE,
        entityId: created.id,
        entityNo: created.quoteNo,
        entityOwnerType: created.ownerType,
        entityOwnerId: created.ownerId,
        entityOwnerNo: created.ownerNo || undefined,
        result: AuditResult.SUCCESS,
        reason: 'Withdrawal pricing quote created',
        afterData: {
          assetId: created.assetId,
          amount: created.amount.toString(),
          expiresAt: created.expiresAt,
        },
        sourcePlatform: ownerType === 'CUSTOMER' ? 'CUSTOMER_API' : 'ADMIN_API',
      },
      {
        actorType: ownerType === 'CUSTOMER' ? 'CUSTOMER' : 'ADMIN',
        actorId: ownerId,
        actorNo: ownerNo || undefined,
        actorRole: ownerType,
      },
    );

    return {
      quoteId: created.id,
      quoteNo: created.quoteNo,
      createdAt: created.createdAt,
      expiresAt: created.expiresAt,
      matched: {
        assetEntryId: created.matchedAssetId,
        tierId: created.matchedTierId,
        tierName: created.matchedTierName,
      },
      fees: JSON.parse(created.feeBreakdown),
      totals: JSON.parse(created.totalsJson),
      policyRef: JSON.parse(created.policyRef),
    };
  }

  private async markWithdrawQuoteExpired(
    client: PrismaService | Prisma.TransactionClient,
    quoteId: string,
    now: Date,
  ) {
    await (client as any).withdrawPricingQuote.updateMany({
      where: {
        id: quoteId,
        status: 'ACTIVE',
      },
      data: {
        status: 'EXPIRED',
        updatedAt: now,
      },
    });
  }

  async getActiveWithdrawQuoteOrThrow(
    quoteId: string,
    ownerType: string,
    ownerId: string,
    now: Date = new Date(),
    tx?: Prisma.TransactionClient,
  ): Promise<WithdrawPricingQuote> {
    const client = tx ?? this.prisma;
    const quote = await (client as any).withdrawPricingQuote.findUnique({
      where: { id: quoteId },
    });

    if (!quote) {
      throw new BadRequestException('Withdrawal quote not found');
    }

    if (quote.ownerType !== ownerType || quote.ownerId !== ownerId) {
      throw new ForbiddenException('Withdrawal quote owner mismatch');
    }

    if (quote.status !== 'ACTIVE') {
      throw new BadRequestException('Withdrawal quote is not active');
    }

    if (quote.expiresAt.getTime() <= now.getTime()) {
      await this.markWithdrawQuoteExpired(client as any, quoteId, now);
      throw new BadRequestException('Withdrawal quote expired');
    }

    return quote as WithdrawPricingQuote;
  }

  async consumeWithdrawQuoteForWithdraw(
    tx: Prisma.TransactionClient,
    quoteId: string,
    ownerType: string,
    ownerId: string,
    now: Date = new Date(),
  ): Promise<WithdrawPricingQuote> {
    await this.getActiveWithdrawQuoteOrThrow(quoteId, ownerType, ownerId, now, tx);

    const updatedCount = await (tx as any).withdrawPricingQuote.updateMany({
      where: {
        id: quoteId,
        ownerType,
        ownerId,
        status: 'ACTIVE',
        expiresAt: { gt: now },
        usedAt: null,
        cancelledAt: null,
      },
      data: {
        status: 'USED',
        usedAt: now,
      },
    });

    if (updatedCount.count !== 1) {
      throw new BadRequestException('Withdrawal quote is not active');
    }

    const consumed = (await (tx as any).withdrawPricingQuote.findUnique({
      where: { id: quoteId },
    })) as WithdrawPricingQuote;

    return consumed;
  }
}
