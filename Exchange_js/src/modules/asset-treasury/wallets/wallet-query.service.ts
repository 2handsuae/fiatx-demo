import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';

@Injectable()
export class WalletQueryService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll({ skip, take, where, orderBy }: any) {
    const [items, total] = await Promise.all([
      this.prisma.wallet.findMany({ skip, take, where, orderBy, include: { asset: true } }),
      this.prisma.wallet.count({ where }),
    ]);
    const enriched = await this.attachOwnerInfo(items);
    return {
      items: enriched.map((w: any) => ({ ...w, balance: w.mockBalance })),
      total,
    };
  }

  async findOne(id: string) {
    const wallet = await this.prisma.wallet.findUnique({
      where: { id },
      include: { asset: true },
    });
    if (!wallet) throw new NotFoundException({ code: 'WALLET_NOT_FOUND', message: `Wallet ${id} not found` });
    const [enriched] = await this.attachOwnerInfo([wallet]);
    return { ...enriched, balance: (wallet as any).mockBalance };
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

  /** 批量 owner enrich:CUSTOMER/LP 各一次 IN 查询(无 N+1);姓名 firstName+lastName 优先。 */
  private async attachOwnerInfo(wallets: any[]): Promise<any[]> {
    const idsOf = (type: string) => [
      ...new Set(wallets.filter((w) => w.ownerType === type && w.ownerId).map((w) => w.ownerId)),
    ];
    const customerIds = idsOf('CUSTOMER');
    const lpIds = idsOf('LIQUIDITY_PROVIDER');
    const [customers, lps] = await Promise.all([
      customerIds.length
        ? (this.prisma as any).customerMain.findMany({
            where: { id: { in: customerIds } },
            select: { id: true, customerNo: true, firstName: true, lastName: true, companyName: true, email: true },
          })
        : Promise.resolve([]),
      lpIds.length
        ? (this.prisma as any).liquidityProvider.findMany({
            where: { id: { in: lpIds } },
            select: { id: true, providerNo: true, name: true },
          })
        : Promise.resolve([]),
    ]);
    const cMap = new Map(customers.map((c: any) => [c.id, c]));
    const lpMap = new Map(lps.map((l: any) => [l.id, l]));

    return wallets.map((w: any) => {
      if (w.ownerType === 'PLATFORM') return { ...w, ownerName: 'Platform', ownerNo: w.ownerNo ?? 'PLATFORM' };
      if (w.ownerType === 'CUSTOMER') {
        const c: any = cMap.get(w.ownerId);
        const name = c
          ? [c.firstName, c.lastName].filter(Boolean).join(' ') || c.companyName || c.email || null
          : null;
        return { ...w, ownerName: name, ownerNo: c?.customerNo ?? w.ownerNo ?? null };
      }
      if (w.ownerType === 'LIQUIDITY_PROVIDER') {
        const l: any = lpMap.get(w.ownerId);
        return { ...w, ownerName: l?.name ?? null, ownerNo: l?.providerNo ?? null };
      }
      return { ...w, ownerName: null, ownerNo: w.ownerNo ?? null };
    });
  }
}
