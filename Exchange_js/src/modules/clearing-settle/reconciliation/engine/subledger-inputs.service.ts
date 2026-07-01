import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../core/prisma/prisma.service';
import { FundsOrderSourceRepo } from '../data-source/funds-order-source.repo';

/**
 * 五公式右侧子账输入抓取器（spec 2026-06-20 §3）。薄 DB-reader：把 Outstanding / swap / external_balances
 * 读成 formula-checker 吃的标量，让 formula-checker 保持纯函数、可单测。
 *
 * 单位约定：Outstanding.amount、swap.fromAmount/toAmount/spreadAmount、external_balances.closing_balance
 * 均以 human decimal 存储（已核 DB），与 credit-net（缩放后 human）单位自洽，无需再缩放。
 */
@Injectable()
export class SubledgerInputsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly source: FundsOrderSourceRepo,
  ) {}

  /**
   * 式2 RHS：仅 OPEN(未 SETTLED) 的 Outstanding，(ΣIN − ΣOUT)，本币种、createdAt < cutoff。
   * ★ 某腿实物结算 → status='SETTLED' → 退出求和（与客户块同步减）。
   */
  async openOutstandingNet(currency: string, cutoff: Date): Promise<Prisma.Decimal> {
    // 数据源换 funds_orders：在途(未终态) funds_orders 等价 OPEN Outstanding。
    // {direction, amount} shape 不变 → 下面的净额求和逐字保持。
    const rows = await this.source.findOpenOutstandings(currency, cutoff);
    let net = new Prisma.Decimal(0);
    for (const r of rows) {
      const amt = new Prisma.Decimal(r.amount);
      net = r.direction === 'IN' ? net.plus(amt) : net.minus(amt); // IN +, OUT −
    }
    return net;
  }

  /**
   * 式3 RHS：仅未清桥(非两腿全 SETTLED)的 swap，按本币种聚合桥贡献。
   * 每笔 swap：from 币 +fromAmount、to 币 −mid，mid = toAmount(gross) + spreadAmount。
   * ★ 两腿都 SETTLED 的 swap 已整笔清桥 → 退出求和（与桥块同步减）。
   */
  async unsweptSwapBridgeContribution(currency: string, cutoff: Date): Promise<Prisma.Decimal> {
    const swaps = await this.prisma.swapTransaction.findMany({
      where: {
        createdAt: { lt: cutoff },
        OR: [{ fromAssetCode: currency }, { toAssetCode: currency }],
      },
      select: {
        fromAssetCode: true, fromAmount: true,
        toAssetCode: true, toAmount: true, spreadAmount: true,
        outstandings: { select: { status: true } },
      },
    });
    let contrib = new Prisma.Decimal(0);
    for (const s of swaps) {
      // 未清桥 = 不是「两腿都 SETTLED」。无 outstanding 腿的 swap 视为已结算/不入桥（保守，不贡献）。
      const legs = s.outstandings;
      const bothSettled = legs.length > 0 && legs.every((l) => l.status === 'SETTLED');
      if (bothSettled || legs.length === 0) continue;

      if (s.fromAssetCode === currency) {
        contrib = contrib.plus(new Prisma.Decimal(s.fromAmount)); // from 腿 +fromAmount
      }
      if (s.toAssetCode === currency) {
        const mid = new Prisma.Decimal(s.toAmount).plus(s.spreadAmount ?? 0); // mid = gross + spread
        contrib = contrib.minus(mid); // to 腿 −mid
      }
    }
    return contrib;
  }

  /**
   * 式2 RHS 第二项：未去混同的提现费 = Σ FeeAccrual.amount where
   * category='WITHDRAW_FEE' AND status≠'SETTLED'，本币种、createdAt < cutoff。
   * 提现费成功即从客户 claim 扣除，但物理去混同(client pool→F_FEE)在 EOD/手动结算才发生；
   * cutoff 时这段在途使客户块比 OPEN Outstanding 少这笔 → 式2 须减去它。
   * 币种无关、读数据决定：法币提现费成功即去混同→cutoff 时已 SETTLED→天然≈0；仅虚拟币有 lag。
   * 不含 swap 费(已 netted 进 Outstanding 的 net)。
   */
  async unsettledWithdrawFee(currency: string, cutoff: Date): Promise<Prisma.Decimal> {
    // 数据源换 funds_orders：在途出金费腿(withdraw legSeq>1 未终态)等价未去混同提现费。
    // {amount} shape 不变 → 下面的 reduce sum 逐字保持。
    const rows = await this.source.findFeeAccruals(currency, cutoff);
    return rows.reduce((s, r) => s.plus(new Prisma.Decimal(r.amount)), new Prisma.Decimal(0));
  }

  /** 式4/5 RHS：Σ external_balances.closing_balance（指定 book + currency + cutoff_date）。 */
  async externalBalanceSum(
    book: 'CLIENT' | 'FIRM',
    currency: string,
    cutoffDate: string,
  ): Promise<Prisma.Decimal> {
    const rows = await this.prisma.externalBalance.findMany({
      where: { book, currency, cutoffDate },
      select: { closingBalance: true },
    });
    return rows.reduce(
      (s, r) => s.plus(new Prisma.Decimal(r.closingBalance)),
      new Prisma.Decimal(0),
    );
  }
}
