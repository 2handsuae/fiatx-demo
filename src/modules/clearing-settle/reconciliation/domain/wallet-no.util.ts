import { PrismaService } from '../../../../core/prisma/prisma.service';
/** 钱包业务键——跨钱包合成案件的 'XREF:' 前缀不是真 Wallet.id，查了必空。 */
export async function resolveWalletNo(prisma: PrismaService, ref: string | null | undefined): Promise<string | null> {
  if (!ref || String(ref).startsWith('XREF:')) return null;
  const w = await prisma.wallet.findUnique({ where: { id: ref }, select: { walletNo: true } });
  return w?.walletNo ?? null;
}
