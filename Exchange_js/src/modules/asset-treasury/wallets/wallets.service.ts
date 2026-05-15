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
import * as crypto from 'crypto';
import { generateReferenceNo } from '../../../common/utils/no-generator.util';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import {
  AuditActions,
  AuditEntityTypes,
} from '../../audit-logging/constants/audit-actions.constant';
import { AuditResult } from '../../audit-logging/dto/audit-log.dto';
import { isProtectedSystemWalletRole } from './system-wallet.util';

@Injectable()
export class WalletsService {
  private readonly logger = new Logger(WalletsService.name);
  private static readonly MAX_WALLET_NO_RETRIES = 5;

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

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

  private resolveCreateWalletRole(
    data: CreateWalletDto,
    assetType: string,
  ): WalletRole {
    if (
      data.ownerType === OwnerType.CUSTOMER &&
      data.direction === WalletDirection.INBOUND
    ) {
      return assetType === 'FIAT' ? WalletRole.C_VIBAN : WalletRole.C_DEP;
    }
    if (data.walletRole) {
      return data.walletRole;
    }
    throw new BadRequestException(
      'walletRole is required for non-customer-inbound wallets',
    );
  }

  private assertManualCreateAllowed(
    data: CreateWalletDto,
    walletRole: WalletRole,
  ) {
    if (isProtectedSystemWalletRole(walletRole)) {
      throw new BadRequestException(
        `${walletRole} wallets are system-provisioned and cannot be created manually`,
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
      walletRole !== WalletRole.C_DEP &&
      walletRole !== WalletRole.C_VIBAN
    ) {
      throw new BadRequestException(
        'Customer inbound wallets must use C_DEP or C_VIBAN role',
      );
    }
  }

  async create(data: CreateWalletDto) {
    this.logger.log(`Creating wallet for ${data.ownerType}`);

    // Validate asset first — needed for role resolution
    const asset = await this.prisma.asset.findUnique({
      where: { id: data.assetId },
    });
    if (!asset) throw new BadRequestException('Invalid Asset ID');
    if (asset.status !== 'ACTIVE') {
      throw new BadRequestException(
        `Asset ${asset.code} is not active (status: ${asset.status}). Wallets can only be created for ACTIVE assets.`,
      );
    }

    const walletRole = this.resolveCreateWalletRole(data, asset.type);
    this.assertManualCreateAllowed(data, walletRole);

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
      const walletNo = generateReferenceNo('WA');
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
          action: AuditActions.WALLET_CREATED,
          entityType: AuditEntityTypes.WALLET,
          entityId: result.id,
          entityNo: result.walletNo || undefined,
          entityOwnerType: result.ownerType,
          entityOwnerId: result.ownerId || undefined,
          entityOwnerNo: result.ownerNo || undefined,
          result: AuditResult.SUCCESS,
          reason: 'Wallet created',
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

  async changeStatus(id: string, status: WalletStatus) {
    this.logger.log(`Changing status of wallet ${id} to ${status}`);
    const before = await this.prisma.wallet.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Wallet not found');

    if (isProtectedSystemWalletRole(before.walletRole)) {
      throw new BadRequestException(
        `${before.walletRole} wallets are system-provisioned and cannot be manually disabled`,
      );
    }
    const result = await this.prisma.wallet.update({
      where: { id },
      data: { status },
    });
    await this.auditLogsService.recordSystem({
      action: AuditActions.WALLET_STATUS_UPDATED,
      entityType: AuditEntityTypes.WALLET,
      entityId: result.id,
      entityNo: result.walletNo || undefined,
      entityOwnerType: result.ownerType,
      entityOwnerId: result.ownerId || undefined,
      entityOwnerNo: before.ownerNo || undefined,
      result: AuditResult.SUCCESS,
      reason: 'Wallet status changed',
      sourcePlatform: 'ADMIN_API',
    });
    return result;
  }
}
