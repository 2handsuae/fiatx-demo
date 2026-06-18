import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../core/prisma/prisma.service';
import { InternalAction } from './match-engine.service';

/** 收集当日"必须有物理对应"的内部资金动作：payin/payout/internal_fund（已 CLEAR/CLEARED）。 */
@Injectable()
export class InternalActionsService {
  constructor(private readonly prisma: PrismaService) {}
  async collect(assetId: string, businessDate: string, cutoff: Date): Promise<InternalAction[]> {
    const start = new Date(`${businessDate}T00:00:00.000Z`);
    const funds = await this.prisma.internalFund.findMany({
      where: { assetId, status: 'CLEAR', createdAt: { gte: start, lt: cutoff } },
      select: { id: true, internalFundNo: true, amount: true, txHash: true },
    });
    return funds.map(f => ({
      sourceType: 'INTERNAL_FUND', sourceId: f.id, sourceNo: f.internalFundNo,
      amount: new Prisma.Decimal(f.amount), direction: 'IN', txHash: f.txHash,
    }));
  }
}
