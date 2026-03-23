import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  PricingPolicy,
  SwapQuote,
  WithdrawPricingQuote,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { generateReferenceNo } from '../../../common/utils/no-generator.util';
import { PrismaService } from '../../../core/prisma/prisma.service';
import {
  buildDefaultPricingPolicyManifest,
  PricingPolicyManifestAsset,
} from '../../../config/manifests/pricing-policies.manifest';
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
  AdminPricingQuoteQueryDto,
  CreateWithdrawPricingQuoteDto,
  PricingQuoteBusiness,
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
import {
  AdminSwapQuoteQueryDto,
  CreateSwapQuoteDto,
  SwapAmountType,
  SwapQuoteStatus,
  SwapQuoteType,
  SwapSide,
} from '../swap-transactions/dto/swap-quote.dto';

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

export interface PricingQuoteListItem {
  quoteId: string;
  quoteNo: string | null;
  business: PricingQuoteBusiness;
  status: string;
  ownerType: string;
  ownerNo: string | null;
  createdAt: Date;
  expiresAt: Date;
  usedAt: Date | null;
  cancelledAt: Date | null;
  primaryAssetCode: string;
  secondaryAssetCode: string | null;
  amountIn: string | null;
  amountOut: string | null;
  amount: string | null;
  rateAllIn: string | null;
  feeTotal: string;
  feeCurrency: string;
  linkedBusinessNo: string | null;
}

export interface PricingQuoteDetail {
  quoteId: string;
  quoteNo: string | null;
  business: PricingQuoteBusiness;
  status: string;
  ownerType: string;
  ownerNo: string | null;
  createdAt: Date;
  expiresAt: Date;
  usedAt: Date | null;
  cancelledAt: Date | null;
  fees: unknown[];
  totals: Record<string, string>;
  policyRef: Record<string, unknown>;
  swap?: Record<string, unknown>;
  withdrawal?: Record<string, unknown>;
}

@Injectable()
export class PricingCenterService {
  private readonly auditLogsService: AuditLogsService;
  private static readonly MAX_SWAP_QUOTE_NO_GENERATION_RETRIES = 10;
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

    const activeAssets = (await this.prisma.asset.findMany({
      where: { status: 'ACTIVE' },
      orderBy: [{ type: 'asc' }, { code: 'asc' }, { network: 'asc' }],
      select: {
        id: true,
        code: true,
        type: true,
        network: true,
        decimals: true,
      },
    })) as PricingPolicyManifestAsset[];

    const manifestItems = buildDefaultPricingPolicyManifest(activeAssets);

    for (const item of manifestItems) {
      await this.prisma.pricingPolicy.upsert({
        where: { policyCode: item.policyCode },
        update: {
          policyName: item.policyName,
          business: item.business,
          channelOnline: item.channelOnline,
          channelStoreSoon: item.channelStoreSoon,
          configJson: JSON.stringify(item.config),
          updatedByUserId: 'SYSTEM',
          updatedByUserNo: 'SYSTEM',
        },
        create: {
          policyCode: item.policyCode,
          policyName: item.policyName,
          business: item.business,
          channelOnline: item.channelOnline,
          channelStoreSoon: item.channelStoreSoon,
          configJson: JSON.stringify(item.config),
          updatedByUserId: 'SYSTEM',
          updatedByUserNo: 'SYSTEM',
        },
      });
    }

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

  async assertSwapPolicyConfig(config: SwapPricingPolicyConfig): Promise<SwapPricingPolicyConfig> {
    const normalized = this.normalizeSwapConfig(config);
    this.validateSwapPolicy(normalized);
    return normalized;
  }

  async assertWithdrawalPolicyConfig(
    config: WithdrawalPricingPolicyConfig,
  ): Promise<WithdrawalPricingPolicyConfig> {
    const normalized = this.normalizeWithdrawalConfig(config);
    this.validateWithdrawalPolicy(normalized);
    const aligned = await this.alignWithdrawalPolicyWithActiveAssets(normalized);
    return aligned.config;
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

  private buildQuoteActor(
    ownerType: string,
    ownerId: string,
    ownerNo?: string | null,
  ): AuditActor {
    if (ownerType === 'CUSTOMER') {
      return {
        actorType: 'CUSTOMER',
        actorId: ownerId,
        actorNo: ownerNo || undefined,
        actorRole: 'CUSTOMER',
      };
    }

    if (ownerType === 'ADMIN') {
      return {
        actorType: 'ADMIN',
        actorId: ownerId,
        actorNo: ownerNo || undefined,
        actorRole: 'ADMIN',
      };
    }

    return {
      actorType: 'SYSTEM',
      actorId: ownerId || 'SYSTEM',
      actorNo: ownerNo || undefined,
      actorRole: ownerType || 'SYSTEM',
    };
  }

  private parseJsonValue<T>(value: string | null | undefined, fallback: T): T {
    if (!value) {
      return fallback;
    }
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }

  private getFirstSnapshot(quote: { feeBreakdown?: string | null }) {
    const feeBreakdown = this.parseJsonValue<any[]>(
      quote.feeBreakdown ?? null,
      [],
    );
    const firstSnapshot =
      Array.isArray(feeBreakdown) && feeBreakdown.length > 0 && feeBreakdown[0]
        ? feeBreakdown[0]
        : null;
    return {
      feeBreakdown,
      firstSnapshot:
        firstSnapshot && typeof firstSnapshot === 'object' ? firstSnapshot : null,
    };
  }

  private getSwapQuoteSnapshots(quote: {
    feeBreakdown?: string | null;
    totalsJson?: string | null;
    policyRef?: string | null;
    rateSource?: string | null;
    marketRate?: Prisma.Decimal | Prisma.Decimal.Value;
    fetchedAt?: Date | null;
  }) {
    const { feeBreakdown, firstSnapshot } = this.getFirstSnapshot(quote);
    const matched =
      firstSnapshot && typeof firstSnapshot === 'object'
        ? ((firstSnapshot as any).matched ?? null)
        : null;
    const fx =
      firstSnapshot && typeof firstSnapshot === 'object'
        ? ((firstSnapshot as any).fx ?? null)
        : null;

    const pricingSource =
      fx && typeof fx === 'object'
        ? {
            provider: quote.rateSource || 'BINANCE',
            endpoint: fx.endpoint || 'api/v3/ticker/bookTicker',
            symbol: fx.symbol || null,
            bid: fx.bid || null,
            ask: fx.ask || null,
            sideUsed: fx.sideUsed || null,
            aedPegApplied: Boolean(fx.aedPegApplied),
            aedPegRate: fx.aedPegRate || null,
            formula: fx.formula || null,
            effectiveBaseRate:
              fx.effectiveBaseRate ||
              fx.baseRate ||
              (quote.marketRate ? new Prisma.Decimal(quote.marketRate).toString() : null),
            fetchedAt:
              fx.fetchedAt ||
              (quote.fetchedAt ? new Date(quote.fetchedAt).toISOString() : null),
          }
        : null;

    const parsedTotals = this.parseJsonValue<Record<string, string>>(
      quote.totalsJson ?? null,
      {},
    );
    const parsedPolicyRef = this.parseJsonValue<Record<string, unknown>>(
      quote.policyRef ?? null,
      {},
    );

    return {
      feeBreakdown,
      matched,
      pricingSource,
      totals: parsedTotals,
      policyRef: parsedPolicyRef,
    };
  }

  private getEffectiveWithdrawQuoteExpiry(quote: {
    expiresAt: Date;
  }): Date {
    return quote.expiresAt;
  }

  private getWithdrawDisplayStatus(
    quote: Pick<
      WithdrawPricingQuote,
      'status' | 'createdAt' | 'expiresAt' | 'usedAt' | 'cancelledAt'
    >,
    now: Date = new Date(),
  ): string {
    if (
      quote.status === 'ACTIVE' &&
      this.getEffectiveWithdrawQuoteExpiry(quote).getTime() <= now.getTime()
    ) {
      return 'EXPIRED';
    }
    return quote.status;
  }

  private toSwapQuoteResponse(quote: SwapQuote) {
    const { feeBreakdown, matched, pricingSource, totals, policyRef } =
      this.getSwapQuoteSnapshots(quote);

    return {
      quoteId: quote.id,
      quoteNo: quote.quoteNo,
      business: PricingQuoteBusiness.SWAP,
      quoteType: quote.quoteType,
      status: quote.status,
      ownerType: quote.ownerType,
      ownerNo: quote.ownerNo,
      createdAt: quote.createdAt,
      expiresAt: quote.expiresAt,
      usedAt: quote.usedAt,
      cancelledAt: quote.cancelledAt,
      fees: feeBreakdown,
      totals,
      policyRef,
      baseCurrency: quote.fromAssetCode,
      quoteCurrency: quote.toAssetCode,
      side: quote.side,
      amountType: quote.amountType,
      amountIn: new Prisma.Decimal(quote.amountIn).toNumber(),
      currencyIn: quote.currencyIn,
      amountOut: new Prisma.Decimal(quote.amountOut).toNumber(),
      currencyOut: quote.currencyOut,
      rateDisplay: new Prisma.Decimal(quote.rateDisplay).toNumber(),
      rateAllIn: new Prisma.Decimal(quote.rateAllIn).toNumber(),
      marketRate: new Prisma.Decimal(quote.marketRate).toNumber(),
      spreadPercent: new Prisma.Decimal(quote.spreadPercent).toNumber(),
      spreadBps: quote.spreadBps,
      rateSource: quote.rateSource,
      fetchedAt: quote.fetchedAt,
      feeTotal: new Prisma.Decimal(quote.feeTotal).toNumber(),
      feeCurrency: quote.feeCurrency,
      feeBreakdown,
      matched,
      pricingSource,
    };
  }

  private toWithdrawQuoteResponse(
    quote: WithdrawPricingQuote,
    now: Date = new Date(),
  ) {
    return {
      quoteId: quote.id,
      quoteNo: quote.quoteNo,
      business: PricingQuoteBusiness.WITHDRAWAL,
      status: this.getWithdrawDisplayStatus(quote, now),
      ownerType: quote.ownerType,
      ownerNo: quote.ownerNo,
      createdAt: quote.createdAt,
      expiresAt: this.getEffectiveWithdrawQuoteExpiry(quote),
      usedAt: quote.usedAt,
      cancelledAt: quote.cancelledAt,
      fees: this.parseJsonValue<unknown[]>(quote.feeBreakdown, []),
      totals: this.parseJsonValue<Record<string, string>>(quote.totalsJson, {}),
      policyRef: this.parseJsonValue<Record<string, unknown>>(quote.policyRef, {}),
      amount: new Prisma.Decimal(quote.amount).toNumber(),
      matched: {
        assetEntryId: quote.matchedAssetId,
        tierId: quote.matchedTierId,
        tierName: quote.matchedTierName,
      },
    };
  }

  private isSwapQuoteNoUniqueConflict(error: unknown): boolean {
    const maybeError = error as {
      code?: string;
      meta?: { target?: string[] | string };
    };
    if (maybeError?.code !== 'P2002') return false;

    const target = maybeError.meta?.target;
    if (Array.isArray(target)) return target.includes('quoteNo');
    if (typeof target === 'string') return target.includes('quoteNo');
    return false;
  }

  private async createSwapQuoteWithUniqueNo(
    data: Omit<Prisma.SwapQuoteUncheckedCreateInput, 'quoteNo'>,
  ): Promise<SwapQuote> {
    for (
      let attempt = 1;
      attempt <= PricingCenterService.MAX_SWAP_QUOTE_NO_GENERATION_RETRIES;
      attempt += 1
    ) {
      const quoteNo = generateReferenceNo('QUO');
      try {
        return await this.prisma.swapQuote.create({
          data: {
            ...data,
            quoteNo,
          },
        });
      } catch (error) {
        if (this.isSwapQuoteNoUniqueConflict(error)) {
          continue;
        }
        throw error;
      }
    }

    throw new InternalServerErrorException(
      `Failed to generate unique quoteNo after ${PricingCenterService.MAX_SWAP_QUOTE_NO_GENERATION_RETRIES} attempts`,
    );
  }

  private async markSwapQuoteExpired(
    client: PrismaService | Prisma.TransactionClient,
    quoteId: string,
    now: Date,
  ) {
    await (client as any).swapQuote.updateMany({
      where: {
        id: quoteId,
        status: SwapQuoteStatus.ACTIVE,
      },
      data: {
        status: SwapQuoteStatus.EXPIRED,
        updatedAt: now,
      },
    });
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

  async createSwapQuote(
    ownerType: string,
    ownerId: string,
    dto: CreateSwapQuoteDto,
  ) {
    const fromAmount = new Prisma.Decimal(dto.fromAmount);
    if (fromAmount.lte(0)) {
      throw new BadRequestException('fromAmount must be greater than 0');
    }

    const resolved = await this.resolveSwapQuoteForExecution({
      fromAssetId: dto.fromAssetId,
      toAssetId: dto.toAssetId,
      amount: dto.fromAmount,
    });

    const ownerNo = await this.resolveOwnerNo(ownerType, ownerId);
    const marketRate = resolved.baseRate;
    const rateAllIn = resolved.quotedRate;
    const spreadPercent = new Prisma.Decimal(resolved.markupBps).div(100);
    const amountOut = fromAmount.mul(rateAllIn);
    const feeTotal = new Prisma.Decimal(
      resolved.totals[resolved.toAssetCode] || '0',
    );
    const feeBreakdown = JSON.stringify([
      {
        policyRef: resolved.policyRef,
        matched: {
          pairId: resolved.pairId,
          pairName: resolved.pairName,
          tierId: resolved.tierId,
          tierName: resolved.tierName,
        },
        fx: {
          baseProvider: resolved.baseProvider,
          baseRate: marketRate.toString(),
          quotedRate: rateAllIn.toString(),
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
      },
    ]);

    const created = await this.createSwapQuoteWithUniqueNo({
      quoteType: SwapQuoteType.FIRM,
      status: SwapQuoteStatus.ACTIVE,
      ownerType,
      ownerId,
      ownerNo,
      fromAssetId: resolved.fromAssetId,
      fromAssetCode: resolved.fromAssetCode,
      toAssetId: resolved.toAssetId,
      toAssetCode: resolved.toAssetCode,
      side: SwapSide.SELL_BASE,
      amountType: SwapAmountType.EXACT_IN,
      amountIn: fromAmount,
      currencyIn: resolved.fromAssetCode,
      amountOut,
      currencyOut: resolved.toAssetCode,
      rateDisplay: rateAllIn,
      rateAllIn,
      marketRate,
      spreadPercent,
      spreadBps: resolved.markupBps,
      rateSource: resolved.baseProvider,
      fetchedAt: resolved.fetchedAt,
      feeTotal,
      feeCurrency: resolved.toAssetCode,
      feeBreakdown,
      totalsJson: JSON.stringify(resolved.totals),
      policyRef: JSON.stringify(resolved.policyRef),
      expiresAt: resolved.expiresAt,
    });

    await this.auditLogsService.recordByActor(
      {
        triggerType: AuditTriggerType.DATA_CREATE,
        action: AuditActions.SWAP_QUOTE_CREATED,
        module: AuditModules.SWAP_QUOTES,
        entityType: AuditEntityTypes.SWAP_QUOTE,
        entityId: created.id,
        entityNo: created.quoteNo || undefined,
        entityOwnerType: created.ownerType,
        entityOwnerId: created.ownerId,
        entityOwnerNo: created.ownerNo || undefined,
        result: AuditResult.SUCCESS,
        reason: 'Swap quote created',
        afterData: {
          status: created.status,
          fromAssetId: created.fromAssetId,
          toAssetId: created.toAssetId,
          amountIn: created.amountIn.toString(),
          amountOut: created.amountOut.toString(),
          expiresAt: created.expiresAt,
        },
        sourcePlatform: ownerType === 'CUSTOMER' ? 'CUSTOMER_API' : 'SYSTEM',
      },
      this.buildQuoteActor(ownerType, ownerId, created.ownerNo),
    );

    return this.toSwapQuoteResponse(created);
  }

  async getActiveSwapQuoteOrThrow(
    quoteId: string,
    ownerType: string,
    ownerId: string,
    now: Date = new Date(),
    tx?: Prisma.TransactionClient,
  ): Promise<SwapQuote> {
    const client = tx ?? this.prisma;
    const quote = await (client as any).swapQuote.findUnique({
      where: { id: quoteId },
    });

    if (!quote) {
      throw new BadRequestException('Quote not found');
    }

    if (quote.ownerType !== ownerType || quote.ownerId !== ownerId) {
      throw new ForbiddenException('Quote owner mismatch');
    }

    if (quote.status !== SwapQuoteStatus.ACTIVE) {
      throw new BadRequestException('Quote is not active');
    }

    if (quote.expiresAt.getTime() <= now.getTime()) {
      await this.markSwapQuoteExpired(client as any, quoteId, now);
      throw new BadRequestException('Quote expired');
    }

    return quote as SwapQuote;
  }

  async consumeSwapQuoteForSwap(
    tx: Prisma.TransactionClient,
    quoteId: string,
    ownerType: string,
    ownerId: string,
    now: Date = new Date(),
  ): Promise<SwapQuote> {
    await this.getActiveSwapQuoteOrThrow(quoteId, ownerType, ownerId, now, tx);

    const consumed = await (tx as any).swapQuote.updateMany({
      where: {
        id: quoteId,
        ownerType,
        ownerId,
        status: SwapQuoteStatus.ACTIVE,
        expiresAt: { gt: now },
        usedAt: null,
        cancelledAt: null,
      },
      data: {
        status: SwapQuoteStatus.USED,
        usedAt: now,
      },
    });

    if (consumed.count !== 1) {
      throw new BadRequestException('Quote is not active');
    }

    const updated = (await (tx as any).swapQuote.findUnique({
      where: { id: quoteId },
    })) as SwapQuote;

    await this.auditLogsService.recordByActor(
      {
        triggerType: AuditTriggerType.DATA_UPDATE,
        action: AuditActions.SWAP_QUOTE_USED,
        module: AuditModules.SWAP_QUOTES,
        entityType: AuditEntityTypes.SWAP_QUOTE,
        entityId: updated.id,
        entityNo: updated.quoteNo || undefined,
        entityOwnerType: updated.ownerType,
        entityOwnerId: updated.ownerId,
        entityOwnerNo: updated.ownerNo || undefined,
        result: AuditResult.SUCCESS,
        reason: 'Swap quote consumed',
        statusFrom: SwapQuoteStatus.ACTIVE,
        statusTo: SwapQuoteStatus.USED,
        beforeData: { status: SwapQuoteStatus.ACTIVE },
        afterData: { status: SwapQuoteStatus.USED, usedAt: updated.usedAt },
        sourcePlatform: ownerType === 'CUSTOMER' ? 'CUSTOMER_API' : 'SYSTEM',
      },
      this.buildQuoteActor(ownerType, ownerId, updated.ownerNo),
      tx,
    );

    return updated;
  }

  async cancelSwapQuote(
    quoteId: string,
    ownerType: string,
    ownerId: string,
    now: Date = new Date(),
  ) {
    const quote = await this.prisma.swapQuote.findUnique({
      where: { id: quoteId },
    });

    if (!quote) {
      throw new BadRequestException('Quote not found');
    }

    if (quote.ownerType !== ownerType || quote.ownerId !== ownerId) {
      throw new ForbiddenException('Quote owner mismatch');
    }

    if (quote.status !== SwapQuoteStatus.ACTIVE) {
      throw new BadRequestException('Quote is not active');
    }

    if (quote.expiresAt.getTime() <= now.getTime()) {
      await this.markSwapQuoteExpired(this.prisma, quoteId, now);
      throw new BadRequestException('Quote expired');
    }

    const cancelled = await this.prisma.swapQuote.update({
      where: { id: quoteId },
      data: {
        status: SwapQuoteStatus.CANCELLED,
        cancelledAt: now,
      },
    });

    await this.auditLogsService.recordByActor(
      {
        triggerType: AuditTriggerType.DATA_UPDATE,
        action: AuditActions.SWAP_QUOTE_CANCELLED,
        module: AuditModules.SWAP_QUOTES,
        entityType: AuditEntityTypes.SWAP_QUOTE,
        entityId: cancelled.id,
        entityNo: cancelled.quoteNo || undefined,
        entityOwnerType: cancelled.ownerType,
        entityOwnerId: cancelled.ownerId,
        entityOwnerNo: cancelled.ownerNo || undefined,
        result: AuditResult.SUCCESS,
        reason: 'Swap quote cancelled',
        statusFrom: SwapQuoteStatus.ACTIVE,
        statusTo: SwapQuoteStatus.CANCELLED,
        beforeData: { status: SwapQuoteStatus.ACTIVE },
        afterData: {
          status: SwapQuoteStatus.CANCELLED,
          cancelledAt: cancelled.cancelledAt,
        },
        sourcePlatform: ownerType === 'CUSTOMER' ? 'CUSTOMER_API' : 'SYSTEM',
      },
      this.buildQuoteActor(ownerType, ownerId, cancelled.ownerNo),
    );

    return this.toSwapQuoteResponse(cancelled);
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
      expiresAt: new Date(result.expiresAt),
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
        expiresAt: resolved.expiresAt,
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
      ...this.toWithdrawQuoteResponse(created),
      matched: {
        assetEntryId: created.matchedAssetId,
        tierId: created.matchedTierId,
        tierName: created.matchedTierName,
      },
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

    if (this.getEffectiveWithdrawQuoteExpiry(quote).getTime() <= now.getTime()) {
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

    await this.auditLogsService.recordByActor(
      {
        triggerType: AuditTriggerType.DATA_UPDATE,
        action: AuditActions.WITHDRAW_PRICING_QUOTE_USED,
        module: AuditModules.PRICING_CENTER,
        entityType: AuditEntityTypes.WITHDRAW_PRICING_QUOTE,
        entityId: consumed.id,
        entityNo: consumed.quoteNo,
        entityOwnerType: consumed.ownerType,
        entityOwnerId: consumed.ownerId,
        entityOwnerNo: consumed.ownerNo || undefined,
        result: AuditResult.SUCCESS,
        reason: 'Withdrawal pricing quote consumed',
        statusFrom: 'ACTIVE',
        statusTo: 'USED',
        beforeData: { status: 'ACTIVE' },
        afterData: { status: 'USED', usedAt: consumed.usedAt },
        sourcePlatform: ownerType === 'CUSTOMER' ? 'CUSTOMER_API' : 'ADMIN_API',
      },
      this.buildQuoteActor(ownerType, ownerId, consumed.ownerNo),
      tx,
    );

    return consumed;
  }

  async cancelWithdrawPricingQuote(
    quoteId: string,
    ownerType: string,
    ownerId: string,
    now: Date = new Date(),
  ) {
    const quote = await this.prisma.withdrawPricingQuote.findUnique({
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

    if (this.getEffectiveWithdrawQuoteExpiry(quote).getTime() <= now.getTime()) {
      await this.markWithdrawQuoteExpired(this.prisma, quoteId, now);
      throw new BadRequestException('Withdrawal quote expired');
    }

    const cancelled = await this.prisma.withdrawPricingQuote.update({
      where: { id: quoteId },
      data: {
        status: 'CANCELLED',
        cancelledAt: now,
      },
    });

    await this.auditLogsService.recordByActor(
      {
        triggerType: AuditTriggerType.DATA_UPDATE,
        action: AuditActions.WITHDRAW_PRICING_QUOTE_CANCELLED,
        module: AuditModules.PRICING_CENTER,
        entityType: AuditEntityTypes.WITHDRAW_PRICING_QUOTE,
        entityId: cancelled.id,
        entityNo: cancelled.quoteNo,
        entityOwnerType: cancelled.ownerType,
        entityOwnerId: cancelled.ownerId,
        entityOwnerNo: cancelled.ownerNo || undefined,
        result: AuditResult.SUCCESS,
        reason: 'Withdrawal pricing quote cancelled',
        statusFrom: 'ACTIVE',
        statusTo: 'CANCELLED',
        beforeData: { status: 'ACTIVE' },
        afterData: {
          status: 'CANCELLED',
          cancelledAt: cancelled.cancelledAt,
        },
        sourcePlatform: ownerType === 'CUSTOMER' ? 'CUSTOMER_API' : 'ADMIN_API',
      },
      this.buildQuoteActor(ownerType, ownerId, cancelled.ownerNo),
    );

    return this.toWithdrawQuoteResponse(cancelled, now);
  }

  private toSwapQuoteListItem(item: any): PricingQuoteListItem {
    return {
      quoteId: item.id,
      quoteNo: item.quoteNo || null,
      business: PricingQuoteBusiness.SWAP,
      status: item.status,
      ownerType: item.ownerType,
      ownerNo: item.ownerNo || null,
      createdAt: item.createdAt,
      expiresAt: item.expiresAt,
      usedAt: item.usedAt || null,
      cancelledAt: item.cancelledAt || null,
      primaryAssetCode: item.fromAssetCode,
      secondaryAssetCode: item.toAssetCode,
      amountIn: item.amountIn?.toString?.() || String(item.amountIn),
      amountOut: item.amountOut?.toString?.() || String(item.amountOut),
      amount: null,
      rateAllIn: item.rateAllIn?.toString?.() || String(item.rateAllIn),
      feeTotal: item.feeTotal?.toString?.() || String(item.feeTotal || '0'),
      feeCurrency: item.feeCurrency,
      linkedBusinessNo: item.swapTransaction?.swapNo || null,
    };
  }

  private toWithdrawQuoteListItem(item: any, now: Date): PricingQuoteListItem {
    const totals = this.parseJsonValue<Record<string, string>>(item.totalsJson, {});
    const feeCurrency =
      Object.keys(totals)[0] || item.assetCode || item.asset?.code || 'N/A';
    const feeTotal = totals[feeCurrency] || '0';

    return {
      quoteId: item.id,
      quoteNo: item.quoteNo || null,
      business: PricingQuoteBusiness.WITHDRAWAL,
      status: this.getWithdrawDisplayStatus(item, now),
      ownerType: item.ownerType,
      ownerNo: item.ownerNo || null,
      createdAt: item.createdAt,
      expiresAt: this.getEffectiveWithdrawQuoteExpiry(item),
      usedAt: item.usedAt || null,
      cancelledAt: item.cancelledAt || null,
      primaryAssetCode: item.assetCode,
      secondaryAssetCode: null,
      amountIn: null,
      amountOut: null,
      amount: item.amount?.toString?.() || String(item.amount),
      rateAllIn: null,
      feeTotal,
      feeCurrency,
      linkedBusinessNo:
        Array.isArray(item.withdrawals) && item.withdrawals.length > 0
          ? item.withdrawals[0]?.withdrawNo || null
          : null,
    };
  }

  async listAdminPricingQuotes(query: AdminPricingQuoteQueryDto) {
    const now = new Date();
    const skip = query.skip ?? 0;
    const take = query.take ?? 20;

    const buildCreatedAtFilter = () => {
      if (!query.startDate && !query.endDate) {
        return undefined;
      }
      const createdAt: Prisma.DateTimeFilter = {};
      if (query.startDate) createdAt.gte = new Date(query.startDate);
      if (query.endDate) createdAt.lte = new Date(query.endDate);
      return createdAt;
    };

    const createdAt = buildCreatedAtFilter();
    const swapWhere: Prisma.SwapQuoteWhereInput = {};
    const withdrawWhere: Prisma.WithdrawPricingQuoteWhereInput = {};

    if (query.status) {
      swapWhere.status = query.status;
      withdrawWhere.status = query.status;
    }
    if (query.ownerId) {
      swapWhere.ownerId = query.ownerId;
      withdrawWhere.ownerId = query.ownerId;
    }
    if (query.ownerNo) {
      swapWhere.ownerNo = { contains: query.ownerNo };
      withdrawWhere.ownerNo = { contains: query.ownerNo };
    }
    if (query.quoteNo) {
      swapWhere.quoteNo = { contains: query.quoteNo };
      withdrawWhere.quoteNo = { contains: query.quoteNo };
    }
    if (query.fromAssetId) {
      swapWhere.fromAssetId = query.fromAssetId;
    }
    if (query.toAssetId) {
      swapWhere.toAssetId = query.toAssetId;
    }
    if (query.swapNo) {
      swapWhere.swapTransaction = {
        is: {
          swapNo: { contains: query.swapNo },
        },
      };
    }
    if (createdAt) {
      swapWhere.createdAt = createdAt;
      withdrawWhere.createdAt = createdAt;
    }

    if (query.business === PricingQuoteBusiness.SWAP) {
      const result = await this.prisma.swapQuote.findMany({
        skip,
        take,
        where: swapWhere,
        orderBy: { createdAt: 'desc' },
        include: {
          swapTransaction: true,
        },
      });
      const total = await this.prisma.swapQuote.count({ where: swapWhere });
      return {
        items: result.map((item) => this.toSwapQuoteListItem(item)),
        total,
      };
    }

    if (query.business === PricingQuoteBusiness.WITHDRAWAL) {
      const result = await this.prisma.withdrawPricingQuote.findMany({
        skip,
        take,
        where: withdrawWhere,
        orderBy: { createdAt: 'desc' },
        include: {
          withdrawals: {
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
      });
      const total = await this.prisma.withdrawPricingQuote.count({
        where: withdrawWhere,
      });
      return {
        items: result.map((item) => this.toWithdrawQuoteListItem(item, now)),
        total,
      };
    }

    const [swapItems, withdrawItems] = await Promise.all([
      this.prisma.swapQuote.findMany({
        where: swapWhere,
        orderBy: { createdAt: 'desc' },
        include: {
          swapTransaction: true,
        },
      }),
      this.prisma.withdrawPricingQuote.findMany({
        where: withdrawWhere,
        orderBy: { createdAt: 'desc' },
        include: {
          withdrawals: {
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
      }),
    ]);

    const items = [
      ...swapItems.map((item) => this.toSwapQuoteListItem(item)),
      ...withdrawItems.map((item) => this.toWithdrawQuoteListItem(item, now)),
    ]
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
      .slice(skip, skip + take);

    return {
      items,
      total: swapItems.length + withdrawItems.length,
    };
  }

  async getAdminPricingQuoteDetail(
    business: PricingQuoteBusiness,
    id: string,
  ): Promise<PricingQuoteDetail> {
    if (business === PricingQuoteBusiness.SWAP) {
      const item = await this.prisma.swapQuote.findUnique({
        where: { id },
        include: {
          fromAsset: true,
          toAsset: true,
          swapTransaction: true,
        },
      });

      if (!item) {
        throw new NotFoundException('Swap quote not found');
      }

      const snapshots = this.getSwapQuoteSnapshots(item);
      return {
        quoteId: item.id,
        quoteNo: item.quoteNo || null,
        business,
        status: item.status,
        ownerType: item.ownerType,
        ownerNo: item.ownerNo || null,
        createdAt: item.createdAt,
        expiresAt: item.expiresAt,
        usedAt: item.usedAt || null,
        cancelledAt: item.cancelledAt || null,
        fees: snapshots.feeBreakdown,
        totals: snapshots.totals,
        policyRef: snapshots.policyRef,
        swap: {
          quoteType: item.quoteType,
          fromAssetCode: item.fromAssetCode,
          toAssetCode: item.toAssetCode,
          fromAsset: item.fromAsset,
          toAsset: item.toAsset,
          side: item.side,
          amountType: item.amountType,
          amountIn: item.amountIn.toString(),
          currencyIn: item.currencyIn,
          amountOut: item.amountOut.toString(),
          currencyOut: item.currencyOut,
          rateDisplay: item.rateDisplay.toString(),
          rateAllIn: item.rateAllIn.toString(),
          marketRate: item.marketRate.toString(),
          spreadPercent: item.spreadPercent.toString(),
          spreadBps: item.spreadBps,
          rateSource: item.rateSource,
          fetchedAt: item.fetchedAt,
          pricingSource: snapshots.pricingSource,
          matched: snapshots.matched,
          linkedSwap: item.swapTransaction
            ? {
                swapNo: item.swapTransaction.swapNo,
                quoteNo: item.swapTransaction.quoteNo,
                status: item.swapTransaction.status,
                createdAt: item.swapTransaction.createdAt,
              }
            : null,
        },
      };
    }

    const item = await this.prisma.withdrawPricingQuote.findUnique({
      where: { id },
      include: {
        asset: true,
        withdrawals: {
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!item) {
      throw new NotFoundException('Withdrawal quote not found');
    }

    return {
      quoteId: item.id,
      quoteNo: item.quoteNo,
      business,
      status: this.getWithdrawDisplayStatus(item),
      ownerType: item.ownerType,
      ownerNo: item.ownerNo || null,
      createdAt: item.createdAt,
      expiresAt: this.getEffectiveWithdrawQuoteExpiry(item),
      usedAt: item.usedAt || null,
      cancelledAt: item.cancelledAt || null,
      fees: this.parseJsonValue<unknown[]>(item.feeBreakdown, []),
      totals: this.parseJsonValue<Record<string, string>>(item.totalsJson, {}),
      policyRef: this.parseJsonValue<Record<string, unknown>>(item.policyRef, {}),
      withdrawal: {
        assetId: item.assetId,
        assetCode: item.assetCode,
        asset: item.asset,
        amount: item.amount.toString(),
        segment: item.segment,
        riskTier: item.riskTier,
        matchedAssetEntryId: item.matchedAssetId,
        matchedTierId: item.matchedTierId,
        matchedTierName: item.matchedTierName,
        linkedWithdrawals: item.withdrawals.map((withdrawal) => ({
          withdrawNo: withdrawal.withdrawNo,
          status: withdrawal.status,
          createdAt: withdrawal.createdAt,
        })),
      },
    };
  }
}
