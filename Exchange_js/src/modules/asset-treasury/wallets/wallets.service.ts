import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Logger,
  InternalServerErrorException,
} from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import {
  CreateWalletDto,
  WalletStatus,
  OwnerType,
  WalletDirection,
  WalletType,
  WalletRole,
} from './dto/wallet.dto';
import { Prisma } from '@prisma/client';
import * as crypto from 'crypto';
import { generateRandomWalletNo } from '../../../common/utils/no-generator.util';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import {
  AuditActions,
  AuditEntityTypes,
  AuditModules,
} from '../../audit-logging/constants/audit-actions.constant';
import { AuditResult, AuditTriggerType } from '../../audit-logging/dto/audit-log.dto';
import {
  classifyWalletSurface,
  isProtectedPoolWalletRole,
} from './system-wallet.util';

@Injectable()
export class WalletsService {
  private readonly logger = new Logger(WalletsService.name);
  private static readonly MAX_WALLET_NO_RETRIES = 5;
  private readonly auditLogsService: AuditLogsService;

  constructor(private prisma: PrismaService) {
    this.auditLogsService = new AuditLogsService(prisma);
  }

  private static readonly walletBalanceSnapshotSelect = {
    walletId: true,
    availableBalance: true,
    restrictedBalance: true,
    updatedAt: true,
  } satisfies Prisma.WalletBalanceSnapshotSelect;

  private static readonly assetValuationRateSelect = {
    assetId: true,
    price: true,
  } satisfies Prisma.AssetValuationRateSelect;

  private static readonly walletBalanceSnapshotDetailSelect = {
    availableBalance: true,
    restrictedBalance: true,
    updatedAt: true,
  } satisfies Prisma.WalletBalanceSnapshotSelect;

  private static readonly valuationRateDetailSelect = {
    price: true,
    status: true,
    quoteAssetCode: true,
    updatedAt: true,
  } satisfies Prisma.AssetValuationRateSelect;

  private buildWalletBalanceView(
    wallet: {
      id: string;
      assetId: string;
    },
    snapshot?: {
      availableBalance: Prisma.Decimal | string | number;
      restrictedBalance: Prisma.Decimal | string | number;
      updatedAt: Date;
    } | null,
  ) {
    const hasSnapshot =
      snapshot?.availableBalance !== undefined ||
      snapshot?.restrictedBalance !== undefined;
    const availableBalance =
      snapshot?.availableBalance !== undefined
        ? new Prisma.Decimal(snapshot.availableBalance)
        : new Prisma.Decimal(0);
    const restrictedBalance =
      snapshot?.restrictedBalance !== undefined
        ? new Prisma.Decimal(snapshot.restrictedBalance)
        : new Prisma.Decimal(0);
    const totalBalance = availableBalance.plus(restrictedBalance);

    return {
      availableBalance,
      restrictedBalance,
      totalBalance,
      balanceUpdatedAt: snapshot?.updatedAt ?? null,
      balanceSource: hasSnapshot ? 'SNAPSHOT' : 'SNAPSHOT_MISSING',
      snapshotMissing: !hasSnapshot,
    };
  }

  private async getWalletBalanceSnapshotMap(walletIds: string[]) {
    type WalletSnapshotRow = Prisma.WalletBalanceSnapshotGetPayload<{
      select: typeof WalletsService.walletBalanceSnapshotSelect;
    }>;
    if (!walletIds.length) return new Map<string, WalletSnapshotRow>();

    const snapshots = await this.prisma.walletBalanceSnapshot.findMany({
      where: {
        walletId: { in: walletIds },
      },
      select: WalletsService.walletBalanceSnapshotSelect,
    });

    return new Map(snapshots.map((item) => [item.walletId, item]));
  }

  private async getAedRateByAssetMap(assetIds: string[]) {
    if (!assetIds.length) return new Map<string, Prisma.Decimal>();

    const rates = await this.prisma.assetValuationRate.findMany({
      where: {
        assetId: { in: assetIds },
        quoteAssetCode: 'AED',
        status: 'ACTIVE',
      },
      select: WalletsService.assetValuationRateSelect,
    });

    return new Map(
      rates.map((item) => [
        item.assetId,
        new Prisma.Decimal(item.price),
      ]),
    );
  }

  private resolveCustomerOwnerName(customer?: {
    companyName: string | null;
    firstName: string | null;
    lastName: string | null;
    email: string | null;
  }): string | null {
    if (!customer) return null;

    const companyName = customer.companyName?.trim();
    if (companyName) return companyName;

    const firstName = customer.firstName?.trim() || '';
    const lastName = customer.lastName?.trim() || '';
    const fullName = `${firstName} ${lastName}`.trim();
    if (fullName) return fullName;

    const email = customer.email?.trim();
    return email || null;
  }

  private async findRegulatoryGateSummary(walletId: string) {
    const gate = await this.prisma.regulatoryGateItem.findFirst({
      where: {
        subjectType: 'WALLET',
        subjectId: walletId,
        revokedAt: null,
      },
      orderBy: [{ createdAt: 'desc' }],
      select: {
        id: true,
        gateNo: true,
        gateType: true,
        gateResult: true,
        filingStatus: true,
        receiptStatus: true,
        effectivenessStatus: true,
      },
    });

    if (!gate) {
      return null;
    }

    return {
      gateId: gate.id,
      gateNo: gate.gateNo,
      gateType: gate.gateType,
      gateResult: gate.gateResult,
      filingStatus: gate.filingStatus,
      receiptStatus: gate.receiptStatus,
      effectivenessStatus: gate.effectivenessStatus,
    };
  }

  private isUniqueConstraintError(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: unknown }).code === 'P2002'
    );
  }

  private isWalletNoUniqueConstraintError(error: unknown): boolean {
    const maybe = error as {
      code?: string;
      meta?: { target?: string[] | string };
    };
    if (maybe?.code !== 'P2002') return false;
    const target = maybe.meta?.target;
    if (Array.isArray(target)) return target.includes('walletNo');
    if (typeof target === 'string') return target.includes('walletNo');
    return false;
  }

  private resolveCreateWalletRole(data: CreateWalletDto): WalletRole {
    if (
      data.ownerType === OwnerType.CUSTOMER &&
      data.direction === WalletDirection.INBOUND
    ) {
      return WalletRole.DEPOSIT;
    }
    return (data.walletRole as WalletRole | undefined) ?? WalletRole.GENERAL;
  }

  private assertManualCreateAllowed(
    data: CreateWalletDto,
    walletRole: WalletRole,
  ) {
    if (isProtectedPoolWalletRole(walletRole)) {
      throw new BadRequestException(
        `${walletRole} wallets are base-config only and cannot be created manually`,
      );
    }

    if (data.ownerType !== OwnerType.CUSTOMER) {
      return;
    }

    if (data.direction === WalletDirection.BIDIRECTIONAL) {
      throw new BadRequestException(
        'Customer wallets cannot be created with BIDIRECTIONAL direction',
      );
    }

    if (
      data.direction === WalletDirection.INBOUND &&
      walletRole !== WalletRole.DEPOSIT
    ) {
      throw new BadRequestException(
        'Customer inbound wallets must use DEPOSIT role',
      );
    }

    if (
      data.direction === WalletDirection.OUTBOUND &&
      walletRole !== WalletRole.GENERAL
    ) {
      throw new BadRequestException(
        'Customer outbound wallets must use GENERAL role',
      );
    }
  }

  async create(data: CreateWalletDto) {
    this.logger.log(`Creating wallet for ${data.ownerType}`);
    const walletRole = this.resolveCreateWalletRole(data);
    this.assertManualCreateAllowed(data, walletRole);

    // Validate asset
    const asset = await this.prisma.asset.findUnique({
      where: { id: data.assetId },
    });
    if (!asset) throw new BadRequestException('Invalid Asset ID');

    if (data.ownerType === OwnerType.PLATFORM && data.ownerId) {
      throw new BadRequestException(
        'Owner ID must be empty for PLATFORM wallets',
      );
    }

    // Validate ownerId based on ownerType
    if (data.ownerType !== OwnerType.PLATFORM && !data.ownerId) {
      throw new BadRequestException(
        'Owner ID is required for non-PLATFORM wallets',
      );
    }

    if (data.ownerType === OwnerType.CUSTOMER && data.ownerId) {
      const customer = await this.prisma.customerMain.findUnique({
        where: { id: data.ownerId },
      });
      if (!customer) throw new BadRequestException('Invalid Customer ID');

      // Check for existing INBOUND wallet for this customer and asset to ensure uniqueness
      if (data.direction === WalletDirection.INBOUND) {
        const existing = await this.prisma.wallet.findFirst({
          where: {
            ownerType: OwnerType.CUSTOMER,
            ownerId: data.ownerId,
            assetId: data.assetId,
            direction: WalletDirection.INBOUND,
            type: data.type,
          },
          include: {
            asset: { select: { code: true, type: true, decimals: true } },
          },
        });
        if (existing) {
          this.logger.log(`Returning existing INBOUND wallet: ${existing.id}`);
          return existing;
        }
      }
    }

    // Auto-generate Address/IBAN for INBOUND CUSTOMER wallets if missing
    if (
      data.direction === WalletDirection.INBOUND &&
      data.ownerType === OwnerType.CUSTOMER
    ) {
      if (data.type === WalletType.CRYPTO_ADDRESS && !data.address) {
        // Mock Address Generation (e.g. ETH style)
        data.address = '0x' + crypto.randomBytes(20).toString('hex');
        this.logger.log(`Generated mock address: ${data.address}`);
      }
      if (data.type === WalletType.FIAT_BANK && !data.iban) {
        // Mock IBAN Generation
        data.iban =
          'US' +
          crypto.randomInt(10, 99) +
          'FIATX' +
          crypto.randomBytes(8).toString('hex').toUpperCase();
        if (!data.bankName) data.bankName = 'FiatX Virtual Bank';
        if (!data.accountName) data.accountName = 'Customer Account';
        this.logger.log(`Generated mock IBAN: ${data.iban}`);
      }
    }

    if (data.ownerType === OwnerType.LIQUIDITY_PROVIDER && data.ownerId) {
      const lp = await this.prisma.liquidityProvider.findUnique({
        where: { id: data.ownerId },
      });
      if (!lp) throw new BadRequestException('Invalid Liquidity Provider ID');
    }

    for (
      let attempt = 1;
      attempt <= WalletsService.MAX_WALLET_NO_RETRIES;
      attempt += 1
    ) {
      const walletNo = generateRandomWalletNo(walletRole);
      try {
        const result = await this.prisma.wallet.create({
          data: {
            walletNo,
            ownerType: data.ownerType,
            ownerId:
              data.ownerType === OwnerType.PLATFORM ? null : data.ownerId,
            type: data.type,
            direction: data.direction,
            walletRole,
            assetId: data.assetId,
            address: data.address,
            memo: data.memo,
            beneficiaryName: data.beneficiaryName,
            counterpartyVasp: data.counterpartyVasp,
            bankName: data.bankName,
            bankAccount: data.bankAccount,
            bankCode: data.bankCode,
            accountName: data.accountName,
            iban: data.iban,
            status: WalletStatus.ACTIVE,
          },
          include: {
            asset: { select: { code: true, type: true, decimals: true } },
          },
        });

        await this.auditLogsService.recordSystem({
          triggerType: AuditTriggerType.DATA_CREATE,
          action: AuditActions.WALLET_CREATED,
          module: AuditModules.WALLETS,
          entityType: AuditEntityTypes.WALLET,
          entityId: result.id,
          entityNo: result.walletNo || undefined,
          entityOwnerType: result.ownerType,
          entityOwnerId: result.ownerId || undefined,
          entityOwnerNo: result.ownerNo || undefined,
          result: AuditResult.SUCCESS,
          reason: 'Wallet created',
          afterData: {
            ownerType: result.ownerType,
            ownerId: result.ownerId,
            type: result.type,
            direction: result.direction,
            status: result.status,
            assetId: result.assetId,
          },
          sourcePlatform: 'ADMIN_API',
        });

        this.logger.log(`Wallet created: ${result.id}`);
        return result;
      } catch (error) {
        if (this.isWalletNoUniqueConstraintError(error)) {
          continue;
        }
        if (this.isUniqueConstraintError(error)) {
          throw new BadRequestException(
            'Inbound customer wallet already exists for this asset and type',
          );
        }
        throw error;
      }
    }

    throw new InternalServerErrorException(
      `Failed to generate unique walletNo after ${WalletsService.MAX_WALLET_NO_RETRIES} attempts`,
    );
  }

  async findAll(params: {
    skip?: number;
    take?: number;
    where?: Prisma.WalletWhereInput;
    orderBy?: Prisma.WalletOrderByWithRelationInput;
  }) {
    const { skip, take, where, orderBy } = params;
    const [items, total] = await Promise.all([
      this.prisma.wallet.findMany({
        skip,
        take,
        where,
        orderBy,
        include: {
          asset: {
            select: {
              id: true,
              code: true,
              type: true,
              network: true,
              decimals: true,
            },
          },
        },
      }),
      this.prisma.wallet.count({ where }),
    ]);

    const walletIds = items.map((item) => item.id);
    const assetIds = Array.from(new Set(items.map((item) => item.assetId)));
    const [snapshotByWalletId, aedRateByAssetId] = await Promise.all([
      this.getWalletBalanceSnapshotMap(walletIds),
      this.getAedRateByAssetMap(assetIds),
    ]);

    const customerOwnerIds = [
      ...new Set(
        items
          .filter(
            (item) =>
              item.ownerType === OwnerType.CUSTOMER &&
              typeof item.ownerId === 'string',
          )
          .map((item) => item.ownerId as string),
      ),
    ];

    const lpOwnerIds = [
      ...new Set(
        items
          .filter(
            (item) =>
              item.ownerType === OwnerType.LIQUIDITY_PROVIDER &&
              typeof item.ownerId === 'string',
          )
          .map((item) => item.ownerId as string),
      ),
    ];

    const [customers, liquidityProviders] = await Promise.all([
      customerOwnerIds.length
        ? this.prisma.customerMain.findMany({
            where: { id: { in: customerOwnerIds } },
            select: {
              id: true,
              customerNo: true,
              customerType: true,
              companyName: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          })
        : Promise.resolve([]),
      lpOwnerIds.length
        ? this.prisma.liquidityProvider.findMany({
            where: { id: { in: lpOwnerIds } },
            select: { id: true, name: true },
          })
        : Promise.resolve([]),
    ]);

    const customerMap = new Map(
      customers.map((customer) => [customer.id, customer]),
    );
    const lpMap = new Map(
      liquidityProviders.map((provider) => [provider.id, provider]),
    );

    const normalizedItems = items.map((item) => {
      let ownerNo: string | null = item.ownerNo;
      let ownerName: string | null = null;

      if (item.ownerType === OwnerType.PLATFORM) {
        ownerName = 'Platform';
      } else if (
        item.ownerType === OwnerType.CUSTOMER &&
        typeof item.ownerId === 'string'
      ) {
        const customer = customerMap.get(item.ownerId);
        if (!ownerNo) ownerNo = customer?.customerNo ?? null;
        ownerName = this.resolveCustomerOwnerName(customer);
      } else if (
        item.ownerType === OwnerType.LIQUIDITY_PROVIDER &&
        typeof item.ownerId === 'string'
      ) {
        const provider = lpMap.get(item.ownerId);
        ownerName = provider?.name ?? null;
      }

      const snapshot = snapshotByWalletId.get(item.id) ?? null;
      const balanceView = this.buildWalletBalanceView(item, snapshot);
      const totalAedEquivalent =
        item.asset.type === 'FIAT'
          ? item.asset.code === 'AED'
            ? balanceView.totalBalance
            : null
          : (() => {
              const rate = aedRateByAssetId.get(item.assetId) as
                | Prisma.Decimal
                | undefined;
              return rate ? balanceView.totalBalance.mul(rate) : null;
            })();

      return {
        ...item,
        ownerNo,
        ownerName,
        surfaceCategory: classifyWalletSurface({
          ownerType: item.ownerType,
          ownerId: item.ownerId,
          ownerNo,
          direction: item.direction,
          walletRole: item.walletRole,
        }),
        ...balanceView,
        totalAedEquivalent,
      };
    });

    return { items: normalizedItems, total };
  }

  async findOne(id: string) {
    const item = await this.prisma.wallet.findUnique({
      where: { id },
      include: {
        asset: true,
      },
    });
    if (!item) throw new NotFoundException('Wallet not found');

    const [snapshot, valuationRate, regulatoryGateSummary] = await Promise.all([
      this.prisma.walletBalanceSnapshot.findUnique({
        where: {
          walletId_assetId: {
            walletId: item.id,
            assetId: item.assetId,
          },
        },
        select: WalletsService.walletBalanceSnapshotDetailSelect,
      }),
      this.prisma.assetValuationRate.findUnique({
        where: {
          assetId_quoteAssetCode: {
            assetId: item.assetId,
            quoteAssetCode: 'AED',
          },
        },
        select: WalletsService.valuationRateDetailSelect,
      }),
      this.findRegulatoryGateSummary(item.id),
    ]);

    let ownerNo: string | null = item.ownerNo;
    if (!ownerNo && item.ownerType === OwnerType.CUSTOMER && item.ownerId) {
      const customer = await this.prisma.customerMain.findUnique({
        where: { id: item.ownerId },
        select: { customerNo: true },
      });
      ownerNo = customer?.customerNo ?? null;
    }

    const balanceView = this.buildWalletBalanceView(item, snapshot);
    const totalAedEquivalent =
      item.asset.type === 'FIAT'
        ? item.asset.code === 'AED'
          ? balanceView.totalBalance
          : null
        : valuationRate?.status === 'ACTIVE'
          ? balanceView.totalBalance.mul(
              new Prisma.Decimal(valuationRate.price),
            )
          : null;

    return {
      ...item,
      ownerNo,
      surfaceCategory: classifyWalletSurface({
        ownerType: item.ownerType,
        ownerId: item.ownerId,
        ownerNo,
        direction: item.direction,
        walletRole: item.walletRole,
      }),
      regulatoryGateSummary,
      ...balanceView,
      totalAedEquivalent,
    };
  }

  async findBalance(id: string) {
    const wallet = await this.prisma.wallet.findUnique({
      where: { id },
      include: {
        asset: {
          select: {
            id: true,
            code: true,
            type: true,
            network: true,
            decimals: true,
          },
        },
      },
    });
    if (!wallet) throw new NotFoundException('Wallet not found');

    const [snapshot, valuationRate] = await Promise.all([
      this.prisma.walletBalanceSnapshot.findUnique({
        where: {
          walletId_assetId: {
            walletId: wallet.id,
            assetId: wallet.assetId,
          },
        },
        select: WalletsService.walletBalanceSnapshotDetailSelect,
      }),
      this.prisma.assetValuationRate.findUnique({
        where: {
          assetId_quoteAssetCode: {
            assetId: wallet.assetId,
            quoteAssetCode: 'AED',
          },
        },
        select: WalletsService.valuationRateDetailSelect,
      }),
    ]);

    const balanceView = this.buildWalletBalanceView(wallet, snapshot);
    const quotePrice =
      wallet.asset.type === 'FIAT'
        ? wallet.asset.code === 'AED'
          ? new Prisma.Decimal(1)
          : null
        : valuationRate?.status === 'ACTIVE'
          ? new Prisma.Decimal(valuationRate.price)
          : null;

    return {
      walletId: wallet.id,
      walletNo: wallet.walletNo,
      ownerType: wallet.ownerType,
      ownerId: wallet.ownerId,
      ownerNo: wallet.ownerNo,
      asset: wallet.asset,
      ...balanceView,
      quoteAssetCode: 'AED',
      quotePrice,
      totalAedEquivalent: quotePrice
        ? balanceView.totalBalance.mul(quotePrice)
        : null,
      valuationUpdatedAt: valuationRate?.updatedAt ?? null,
    };
  }

  async changeStatus(id: string, status: WalletStatus) {
    this.logger.log(`Changing status of wallet ${id} to ${status}`);
    const before = await this.findOne(id);
    if (isProtectedPoolWalletRole(before.walletRole)) {
      throw new BadRequestException(
        `${before.walletRole} wallets are base-config only and cannot be manually disabled`,
      );
    }
    const result = await this.prisma.wallet.update({
      where: { id },
      data: { status },
    });
    await this.auditLogsService.recordSystem({
      triggerType: AuditTriggerType.DATA_UPDATE,
      action: AuditActions.WALLET_STATUS_UPDATED,
      module: AuditModules.WALLETS,
      entityType: AuditEntityTypes.WALLET,
      entityId: result.id,
      entityNo: result.walletNo || undefined,
      entityOwnerType: result.ownerType,
      entityOwnerId: result.ownerId || undefined,
      entityOwnerNo: before.ownerNo || undefined,
      statusFrom: before.status,
      statusTo: result.status,
      result: AuditResult.SUCCESS,
      reason: 'Wallet status changed',
      beforeData: { status: before.status },
      afterData: { status: result.status },
      sourcePlatform: 'ADMIN_API',
    });
    return result;
  }
}
