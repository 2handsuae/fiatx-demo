import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { classifyWalletSurface } from './system-wallet.util';

@Injectable()
export class WalletQueryService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll({ skip, take, where, orderBy }: any) {
    const [items, total] = await Promise.all([
      this.prisma.wallet.findMany({ skip, take, where, orderBy, include: { asset: true } }),
      this.prisma.wallet.count({ where }),
    ]);

    const enriched = await Promise.all(
      items.map(async (wallet: any) => {
        const ownerInfo = await this.resolveOwnerInfo(wallet);
        return {
          ...wallet,
          ...ownerInfo,
          surfaceCategory: classifyWalletSurface(wallet),
          balance: wallet.mockBalance,
        };
      }),
    );

    return { items: enriched, total };
  }

  async findOne(id: string) {
    const wallet = await this.prisma.wallet.findUnique({
      where: { id },
      include: { asset: true },
    });
    if (!wallet) throw new NotFoundException({ code: 'WALLET_NOT_FOUND', message: `Wallet ${id} not found` });

    const ownerInfo = await this.resolveOwnerInfo(wallet);
    return {
      ...wallet,
      ...ownerInfo,
      surfaceCategory: classifyWalletSurface(wallet),
      balance: wallet.mockBalance,
    };
  }

  async findBalance(id: string) {
    const wallet = await this.prisma.wallet.findUnique({
      where: { id },
      include: { asset: { select: { id: true, code: true, type: true, decimals: true } } },
    });
    if (!wallet) throw new NotFoundException({ code: 'WALLET_NOT_FOUND', message: `Wallet ${id} not found` });

    return {
      walletId: wallet.id,
      walletNo: wallet.walletNo,
      ownerType: wallet.ownerType,
      ownerId: wallet.ownerId,
      asset: wallet.asset,
      balance: wallet.mockBalance,
    };
  }

  private async resolveOwnerInfo(wallet: any) {
    if (wallet.ownerType === 'PLATFORM') return { ownerName: 'Platform', ownerNo: null };
    if (wallet.ownerType === 'CUSTOMER' && wallet.ownerId) {
      const customer = await (this.prisma as any).customerMain.findUnique({ where: { id: wallet.ownerId } });
      if (!customer) return { ownerName: null, ownerNo: null };
      return {
        ownerName: customer.companyName || customer.fullName || customer.email,
        ownerNo: customer.customerNo,
      };
    }
    if (wallet.ownerType === 'LIQUIDITY_PROVIDER' && wallet.ownerId) {
      const lp = await (this.prisma as any).liquidityProvider.findUnique({ where: { id: wallet.ownerId } });
      return { ownerName: lp?.name ?? null, ownerNo: lp?.providerNo ?? null };
    }
    return { ownerName: null, ownerNo: null };
  }
}
