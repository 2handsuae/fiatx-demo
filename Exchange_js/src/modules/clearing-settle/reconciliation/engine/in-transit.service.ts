import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../core/prisma/prisma.service';
import {
  PAYIN_IN_TRANSIT, WITHDRAW_IN_TRANSIT_STATUS, FUNDS_FLOW_IN_TRANSIT,
} from '../constants/reconciliation.constants';

const D0 = () => new Prisma.Decimal(0);

/** in-transit 调整：已知时序差，会自己平，从外部余额里扣/加。返回应施加到"外部"侧的净调整。 */
@Injectable()
export class InTransitService {
  constructor(private readonly prisma: PrismaService) {}

  /** crypto：① 入金在途(外部−) ② 出金在途(外部+) ③ 内部转账在途(外部+) */
  async computeCrypto(currency: string, assetId: string, cutoff: Date): Promise<Prisma.Decimal> {
    let adj = D0();

    // ① 入金已确认未记账（payin 在途且未进 deposit STEP_1）→ 外部 −=
    const payins = await this.prisma.payin.findMany({
      where: { assetId, status: { in: [...PAYIN_IN_TRANSIT] }, createdAt: { lt: cutoff } },
      select: { amount: true },
    });
    for (const p of payins) adj = adj.minus(new Prisma.Decimal(p.amount));

    // ② 出金已 broadcast 未 POST（withdraw PAYOUT_PENDING）→ 外部 +=
    const wds = await this.prisma.withdrawTransaction.findMany({
      where: { assetId, status: WITHDRAW_IN_TRANSIT_STATUS, createdAt: { lt: cutoff } },
      select: { netAmount: true },
    });
    for (const w of wds) adj = adj.plus(new Prisma.Decimal(w.netAmount));

    // ③ 内部转账在途（internal_fund CREATED 未 CLEAR）→ 外部 +=
    const funds = await this.prisma.internalFund.findMany({
      where: { assetId, status: { in: [...FUNDS_FLOW_IN_TRANSIT] }, createdAt: { lt: cutoff } },
      select: { amount: true },
    });
    for (const f of funds) adj = adj.plus(new Prisma.Decimal(f.amount));

    return adj;
  }

  /** fiat：① 出金在途 ② 结算在途（internal_transaction 未 CLEAR）—— 与 crypto 同形，复用出金+内部转账两段。 */
  async computeFiat(currency: string, assetId: string, cutoff: Date): Promise<Prisma.Decimal> {
    let adj = D0();
    const wds = await this.prisma.withdrawTransaction.findMany({
      where: { assetId, status: WITHDRAW_IN_TRANSIT_STATUS, createdAt: { lt: cutoff } },
      select: { netAmount: true },
    });
    for (const w of wds) adj = adj.plus(new Prisma.Decimal(w.netAmount));
    const funds = await this.prisma.internalFund.findMany({
      where: { assetId, status: { in: [...FUNDS_FLOW_IN_TRANSIT] }, createdAt: { lt: cutoff } },
      select: { amount: true },
    });
    for (const f of funds) adj = adj.plus(new Prisma.Decimal(f.amount));
    return adj;
  }
}
