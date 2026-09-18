import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';

/** 钱包行按网络而非资产挂——同一条链上的所有币共用一个地址（HexTrust：一 vault 一链一地址）。
 *  调用方仍传 assetId（资金单上记的是资产），这里先取资产的 network 再找行。 */
@Injectable()
export class SystemWalletResolver {
  constructor(private readonly prisma: PrismaService) {}

  private async networkOf(assetId: string, tx?: Prisma.TransactionClient): Promise<{ network: string; code: string }> {
    const client = tx ?? this.prisma;
    const asset = await client.asset.findUnique({ where: { id: assetId }, select: { network: true, code: true } });
    if (!asset) throw new BadRequestException({ code: 'ASSET_NOT_FOUND', message: `Asset ${assetId} not found` });
    return asset;
  }

  /** ACTIVE platform 地址行（F_OPS / F_SET / F_FEE / F_LIQ）for the asset's network */
  async resolve(assetId: string, vaultCode: string, tx?: Prisma.TransactionClient) {
    const asset = await this.networkOf(assetId, tx);
    const wallet = await ((tx ?? this.prisma) as any).wallet.findFirst({
      where: { vaultCode, network: asset.network, ownerType: 'PLATFORM', ownerNo: 'PLATFORM', status: 'ACTIVE' },
      orderBy: { createdAt: 'asc' },
    });
    if (!wallet) {
      throw new BadRequestException({
        code: 'SYSTEM_WALLET_NOT_FOUND',
        message: `No ACTIVE ${vaultCode} platform wallet on network ${asset.network} (asset ${asset.code})`,
      });
    }
    return wallet;
  }

  /** ACTIVE customer 收款行（C_DEP / C_VIBAN）for owner + the asset's network */
  async resolveCustomer(assetId: string, walletRole: string, ownerId: string, tx?: Prisma.TransactionClient) {
    const asset = await this.networkOf(assetId, tx);
    const wallet = await ((tx ?? this.prisma) as any).wallet.findFirst({
      where: { vaultCode: 'CLIENT_DEPOSIT', walletRole, network: asset.network, ownerType: 'CUSTOMER', ownerId, status: 'ACTIVE' },
      orderBy: { createdAt: 'asc' },
    });
    if (!wallet) {
      throw new BadRequestException({
        code: 'CUSTOMER_WALLET_NOT_FOUND',
        message: `No ACTIVE ${walletRole} wallet for customer ${ownerId} on network ${asset.network} (asset ${asset.code})`,
      });
    }
    return wallet;
  }
}
