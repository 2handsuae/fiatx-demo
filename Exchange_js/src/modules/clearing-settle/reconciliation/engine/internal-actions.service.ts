import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { FundsOrderSourceRepo } from '../data-source/funds-order-source.repo';
import { FundsOrderStatus } from '../../../funds-orders/dto/funds-order.dto';
import { InternalAction } from './match-engine.service';

/** 收集当日"必须有物理对应"的内部资金动作：payin/payout/internal_fund（已 CLEARED）。 */
@Injectable()
export class InternalActionsService {
  constructor(private readonly source: FundsOrderSourceRepo) {}
  async collect(assetId: string, businessDate: string, cutoff: Date): Promise<InternalAction[]> {
    const start = new Date(`${businessDate}T00:00:00.000Z`);
    const out: InternalAction[] = [];

    // ① internal_fund（已 CLEARED 且有外部物理键）→ 有真实链上/银行对应 → IN
    //    （match key = txHash || referenceNo：crypto 走 txHash，fiat 走银行 referenceNo）。
    //    无任何键的纯账内转账无外部物理腿，不进账实(I5)对账。
    const funds = await this.source.findInternals({
      assetId,
      status: FundsOrderStatus.CLEARED,
      createdAt: { gte: start, lt: cutoff },
      requireExternalRef: true,
    });
    for (const f of funds) out.push({
      sourceType: 'INTERNAL_FUND', sourceId: f.id, sourceNo: f.fundsOrderNo,
      amount: new Prisma.Decimal(f.amount), direction: 'IN', txHash: f.txHash, referenceNo: f.referenceNo,
    });

    // ② payin（已 CLEARED，当日）→ 入金 → IN（match key 用 txHash || referenceNo）
    const payins = await this.source.findPayins({
      assetId, status: FundsOrderStatus.CLEARED, createdAt: { gte: start, lt: cutoff },
    });
    for (const p of payins) out.push({
      sourceType: 'PAYIN', sourceId: p.id, sourceNo: p.payinNo,
      amount: new Prisma.Decimal(p.amount), direction: 'IN', txHash: p.txHash, referenceNo: p.referenceNo,
    });

    // ③ payout（已 CLEARED）→ 出金 → OUT（match key 用 txHash || referenceNo）；
    //    出金无当日 createdAt 过滤（与 in-transit/spec 一致：CLEARED 即已物理出账）。
    const payouts = await this.source.findPayouts({ assetId, status: FundsOrderStatus.CLEARED });
    for (const po of payouts) out.push({
      sourceType: 'PAYOUT', sourceId: po.id, sourceNo: po.payoutNo,
      amount: new Prisma.Decimal(po.amount), direction: 'OUT', txHash: po.txHash, referenceNo: po.referenceNo,
    });

    return out;
  }
}
