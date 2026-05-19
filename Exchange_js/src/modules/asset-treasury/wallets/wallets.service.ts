import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { WalletStatus } from './dto/wallet.dto';
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

  private static readonly WALLET_STATUS_TRANSITIONS: Record<string, string[]> = {
    PENDING_APPROVAL: ['CREATING', 'ACTIVE'],
    CREATING: ['ACTIVE', 'FAILED'],
    FAILED: ['CREATING'],
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

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
      status: 'PENDING_APPROVAL' | 'CREATING';
      vaultId?: string;
      iban?: string;
    },
    tx?: Prisma.TransactionClient,
  ) {
    const db = tx ?? this.prisma;

    const asset = await db.asset.findUnique({ where: { id: dto.assetId } });
    if (!asset) throw new BadRequestException('Invalid Asset ID');

    if (dto.ownerType === 'PLATFORM') {
      if (!['PROVISIONING', 'ACTIVE'].includes(asset.status)) {
        throw new BadRequestException(
          `Asset ${asset.currency} status ${asset.status} does not allow system wallet creation`,
        );
      }
    } else {
      if (asset.status !== 'ACTIVE') {
        throw new BadRequestException(
          `Asset ${asset.currency} must be ACTIVE for customer wallet creation`,
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
            assetId: dto.assetId,
            status: dto.status,
            vaultId: dto.vaultId ?? null,
            iban: dto.iban ?? null,
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
