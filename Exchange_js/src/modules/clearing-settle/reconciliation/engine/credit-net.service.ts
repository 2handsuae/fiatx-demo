import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../core/prisma/prisma.service';

/**
 * credit-net 口径（spec 2026-06-20 §0/§3）：cn(account) = Σcredit − Σdebit（贷正借负，同币种）。
 *
 * 与 balance-snapshot.service 的关系：balance-snapshot 用 debit-net（资产正），本服务用 credit-net
 * （贷正）。两者只差一个全局符号——credit-net 下「同币种全账户 cn 之和恒 = 0」（式1），符号机械、
 * 不必按 A/L/E/R class 翻转，正是五公式（§3）想要的口径。
 *
 * 缩放：tb_transfer_evidence.amount 以 TigerBeetle 最小单位存储（整数 × 10^decimals）。
 * 这里除以 10^decimals 还原 human-decimal，使 cn 与 Outstanding/swap/external_balances（均 human）单位自洽。
 */
@Injectable()
export class CreditNetService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 返回 { COA字符串 → cn(Decimal, human) }，按 createdAt < cutoff + POSTED 重算。
   * cn[code] = Σ(该 code 作 credit 的 amount) − Σ(该 code 作 debit 的 amount)，再 ÷ 10^decimals。
   */
  async creditNetAtCutoff(
    currency: string,
    cutoff: Date,
  ): Promise<Record<string, Prisma.Decimal>> {
    const rows = await this.prisma.tbTransferEvidence.findMany({
      where: { assetCode: currency, transferType: 'POSTED', createdAt: { lt: cutoff } },
      select: { debitCode: true, creditCode: true, amount: true },
    });
    const asset = await this.prisma.asset.findFirst({
      where: { currency }, select: { decimals: true },
    });
    const scale = new Prisma.Decimal(10).pow(asset?.decimals ?? 0);

    const cnRaw: Record<string, Prisma.Decimal> = {};
    const add = (code: string, v: Prisma.Decimal) => {
      cnRaw[code] = (cnRaw[code] ?? new Prisma.Decimal(0)).plus(v);
    };
    for (const r of rows) {
      const amt = new Prisma.Decimal(r.amount);
      add(r.creditCode, amt);          // 贷 → +
      add(r.debitCode, amt.negated()); // 借 → −
    }

    const out: Record<string, Prisma.Decimal> = {};
    for (const [code, net] of Object.entries(cnRaw)) {
      out[code] = net.div(scale);
    }
    return out;
  }
}
