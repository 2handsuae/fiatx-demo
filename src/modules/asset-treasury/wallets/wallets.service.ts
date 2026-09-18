import { Injectable, BadRequestException, NotFoundException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { generateReferenceNo } from '../../../common/utils/no-generator.util';
import { assertNetwork } from '../../../config/manifests/networks.manifest';
import { VAULTS, isVaultCode } from '../../../config/manifests/vaults.manifest';

/** 钱包行状态迁移表（法二）。只有"开地址"那一小段生命周期；ACTIVE / FAILED 都是终态。
 *  DISABLED / FROZEN 已退役——客户侧停入金靠 V2 限制账（"限制是人的属性"），平台侧从不停（spec §4）。 */
export const WALLET_STATUS_TRANSITIONS: Record<string, string[]> = {
  CREATING: ['ACTIVE', 'FAILED'],
  ACTIVE: [],
  FAILED: [],
};

export interface CreateWalletRecordInput {
  ownerType: 'PLATFORM' | 'CUSTOMER';
  ownerId?: string | null;
  ownerNo: string;
  vaultCode: string;
  walletRole: string;
  network: string;
  status: 'CREATING' | 'ACTIVE';
  address?: string | null;
  iban?: string | null;
  custodianRef?: string | null;
}

@Injectable()
export class WalletsService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── L1 Pure Domain Methods ────────────────────────────────────────────

  async createWalletRecord(dto: CreateWalletRecordInput, tx?: Prisma.TransactionClient) {
    const db = tx ?? this.prisma;
    const network = assertNetwork(dto.network);
    if (!isVaultCode(dto.vaultCode)) {
      throw new BadRequestException(`Unknown vault: ${dto.vaultCode}`);
    }
    const vault = VAULTS[dto.vaultCode];
    if (!vault.networks.includes(network.code)) {
      throw new BadRequestException(`Vault ${vault.code} has no address slot on network ${network.code}`);
    }
    if (vault.ownerType !== dto.ownerType) {
      throw new BadRequestException(`Vault ${vault.code} is ${vault.ownerType}-owned, got ownerType ${dto.ownerType}`);
    }

    for (let attempt = 0; attempt < 3; attempt++) {
      const walletNo = generateReferenceNo('WA');
      try {
        return await db.wallet.create({
          data: {
            walletNo,
            ownerType: dto.ownerType,
            ownerId: dto.ownerType === 'PLATFORM' ? null : (dto.ownerId ?? null),
            ownerNo: dto.ownerNo,
            vaultCode: dto.vaultCode,
            walletRole: dto.walletRole,
            network: network.code,
            status: dto.status,
            address: dto.address ?? null,
            iban: dto.iban ?? null,
            custodianRef: dto.custodianRef ?? null,
          },
        });
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          if (attempt === 2) throw new ConflictException('Failed to generate unique walletNo after 3 attempts');
          continue;
        }
        throw e;
      }
    }
    throw new ConflictException('Failed to generate unique walletNo after 3 attempts');
  }

  async transitionStatus(walletNo: string, from: string, to: string, extra?: Record<string, any>, tx?: Prisma.TransactionClient) {
    const db = tx ?? this.prisma;
    const allowed = WALLET_STATUS_TRANSITIONS[from];
    if (!allowed || !allowed.includes(to)) {
      throw new ConflictException(`Invalid transition: wallet in ${from} cannot go to ${to}`);
    }
    const wallet = await db.wallet.findFirst({ where: { walletNo } });
    if (!wallet) throw new NotFoundException(`Wallet ${walletNo} not found`);
    if (wallet.status !== from) {
      throw new ConflictException(`Wallet ${walletNo} is ${wallet.status}, expected ${from}`);
    }
    return db.wallet.update({ where: { id: wallet.id }, data: { status: to, ...(extra ?? {}) } });
  }

  async findByWalletNo(walletNo: string, tx?: Prisma.TransactionClient) {
    const db = tx ?? this.prisma;
    return db.wallet.findFirst({ where: { walletNo } });
  }

  /** 入金信号按（网络, 地址 | IBAN）找客户的收款行（Task 5 消费方） */
  async findCustomerWalletByDestination(
    network: string,
    destination: { address?: string | null; iban?: string | null },
    tx?: Prisma.TransactionClient,
  ) {
    const db = tx ?? this.prisma;
    const key = destination.address ? { address: destination.address } : { iban: destination.iban ?? '' };
    return db.wallet.findFirst({ where: { network, ownerType: 'CUSTOMER', vaultCode: 'CLIENT_DEPOSIT', ...key } });
  }
}
