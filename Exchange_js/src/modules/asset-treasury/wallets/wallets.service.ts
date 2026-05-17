import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ConflictException,
  Logger,
  InternalServerErrorException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
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

  private static readonly WALLET_STATUS_TRANSITIONS: Record<string, string[]> = {
    PENDING_APPROVAL: ['CREATING'],
    CREATING: ['ACTIVE', 'FAILED'],
    FAILED: ['CREATING'],
  };

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

  // ─── L1 Pure Domain Methods ────────────────────────────────────────────

  async createWalletRecord(
    dto: {
      assetId: string;
      ownerType: string;
      ownerId?: string;
      ownerNo?: string;
      walletRole: string;
      type: string;
      direction: string;
      status: 'PENDING_APPROVAL' | 'CREATING';
    },
    tx?: Prisma.TransactionClient,
  ) {
    const db = tx ?? this.prisma;

    const asset = await db.asset.findUnique({ where: { id: dto.assetId } });
    if (!asset) throw new BadRequestException('Invalid Asset ID');

    if (dto.ownerType === 'PLATFORM') {
      if (!['PROVISIONING', 'ACTIVE'].includes(asset.status)) {
        throw new BadRequestException(
          `Asset ${asset.code} status ${asset.status} does not allow system wallet creation`,
        );
      }
    } else {
      if (asset.status !== 'ACTIVE') {
        throw new BadRequestException(
          `Asset ${asset.code} must be ACTIVE for customer wallet creation`,
        );
      }
    }

    for (let attempt = 0; attempt < 3; attempt++) {
      const walletNo = generateReferenceNo('WA');
      try {
        return await db.wallet.create({
          data: {
            walletNo,
            ownerType: dto.ownerType,
            ownerId: dto.ownerType === 'PLATFORM' ? null : (dto.ownerId ?? null),
            ownerNo: dto.ownerNo ?? null,
            walletRole: dto.walletRole,
            type: dto.type,
            direction: dto.direction,
            assetId: dto.assetId,
            status: dto.status,
          },
        });
      } catch (e) {
        if (
          e instanceof Prisma.PrismaClientKnownRequestError &&
          e.code === 'P2002'
        ) {
          if (attempt === 2)
            throw new ConflictException(
              'Failed to generate unique walletNo after 3 attempts',
            );
          continue;
        }
        throw e;
      }
    }
  }

  async linkApprovalCase(
    walletNo: string,
    caseId: string,
    caseNo: string,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const db = tx ?? this.prisma;
    await db.wallet.updateMany({
      where: { walletNo },
      data: { approvalCaseId: caseId, approvalCaseNo: caseNo },
    });
  }

  async transitionStatus(
    walletNo: string,
    from: string,
    to: string,
    extra?: Record<string, any>,
    tx?: Prisma.TransactionClient,
  ) {
    const db = tx ?? this.prisma;

    const allowed = WalletsService.WALLET_STATUS_TRANSITIONS[from];
    if (!allowed || !allowed.includes(to)) {
      throw new ConflictException(
        `Illegal wallet status transition: ${from} → ${to}`,
      );
    }

    const wallet = await db.wallet.findFirst({ where: { walletNo } });
    if (!wallet) throw new NotFoundException(`Wallet ${walletNo} not found`);
    if (wallet.status !== from) {
      throw new ConflictException(
        `Wallet ${walletNo} is ${wallet.status}, expected ${from}`,
      );
    }

    const data: Record<string, any> = { status: to };
    if (extra) Object.assign(data, extra);

    return db.wallet.update({ where: { id: wallet.id }, data });
  }

  async deleteWallet(
    walletNo: string,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const db = tx ?? this.prisma;
    const wallet = await db.wallet.findFirst({ where: { walletNo } });
    if (!wallet) throw new NotFoundException(`Wallet ${walletNo} not found`);
    if (!['PENDING_APPROVAL', 'FAILED'].includes(wallet.status)) {
      throw new ConflictException(
        `Cannot delete wallet ${walletNo}: status ${wallet.status} not deletable`,
      );
    }
    await db.wallet.delete({ where: { id: wallet.id } });
  }

  async findByWalletNo(walletNo: string, tx?: Prisma.TransactionClient) {
    const db = tx ?? this.prisma;
    return db.wallet.findFirst({ where: { walletNo } });
  }
}
