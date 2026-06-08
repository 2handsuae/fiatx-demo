import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';

@Injectable()
export class SystemWalletResolver {
  constructor(private readonly prisma: PrismaService) {}

  /** ACTIVE platform 钱包（C_MAIN / C_OUT / F_LIQ / F_OPS）for an asset */
  async resolve(assetId: string, walletRole: string) {
    const wallet = await (this.prisma as any).wallet.findFirst({
      where: { walletRole, assetId, ownerType: 'PLATFORM', status: 'ACTIVE' },
      orderBy: { createdAt: 'asc' },
    });
    if (!wallet)
      throw new BadRequestException({
        code: 'SYSTEM_WALLET_NOT_FOUND',
        message: `No ACTIVE ${walletRole} platform wallet for asset ${assetId}`,
      });
    return wallet;
  }

  /** ACTIVE CUSTOMER-owned wallet (e.g. C_VIBAN) for a given owner + asset */
  async resolveCustomer(assetId: string, walletRole: string, ownerId: string) {
    const wallet = await (this.prisma as any).wallet.findFirst({
      where: { walletRole, assetId, ownerType: 'CUSTOMER', ownerId, status: 'ACTIVE' },
      orderBy: { createdAt: 'asc' },
    });
    if (!wallet)
      throw new BadRequestException({
        code: 'CUSTOMER_WALLET_NOT_FOUND',
        message: `No ACTIVE ${walletRole} wallet for customer ${ownerId} asset ${assetId}`,
      });
    return wallet;
  }
}
