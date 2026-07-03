// 平账·推单 同步腿的回执查找（spec §4）：两档严格度，任一档命中恰好 1 条即 HIT，否则 MISS 报数。
// 同步永不猜——多候选不进入下一档、不打分挑选。
// Port/adapter：本实现 = "已摄入对账单行" adapter；将来接银行/托管实时查询只换本类。
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../core/prisma/prisma.service';
import { toBusinessDate } from '../../../accounting/tigerbeetle/utils/business-date.util';

export type ReceiptLookupResult =
  | { kind: 'HIT'; lineId: string; effectiveDate: string }
  | { kind: 'MISS'; candidates: number };

/**
 * 归一化的可推单资金单视图。真实资金单列 fromWalletId/toWalletId/referenceNo
 * 由 PushOrderService 映射成本视图（walletId=方向对应的物理钱包、externalRef=referenceNo、
 * direction 由 depositTransactionId/withdrawTransactionId 派生）——本类只依赖归一化后的键。
 */
export interface PushableOrderView {
  fundsOrderNo: string;
  walletId: string;
  direction: 'IN' | 'OUT';
  amount: number | string;
  externalRef: string | null;
  createdAt: Date;
}

@Injectable()
export class ReceiptLookupService {
  constructor(private readonly prisma: PrismaService) {}

  async findUniqueReceipt(order: PushableOrderView): Promise<ReceiptLookupResult> {
    // 钱包 → 外部账户定位（与 run 服务 fetchExternalLinesForWallet 同思路）
    const bal = await (this.prisma as any).externalBalance.findFirst({
      where: { walletRef: order.walletId },
      orderBy: { cutoffDate: 'desc' },
    });
    if (!bal) return { kind: 'MISS', candidates: 0 };

    // 档1：参考号精配
    if (order.externalRef) {
      const hits = await (this.prisma as any).externalStatementLine.findMany({
        where: { source: bal.source, accountRef: bal.accountRef, externalRef: order.externalRef },
      });
      if (hits.length === 1) {
        return { kind: 'HIT', lineId: hits[0].id, effectiveDate: toBusinessDate(hits[0].datetime) };
      }
      if (hits.length > 1) return { kind: 'MISS', candidates: hits.length };
      // 0 条 → 落档2
    }

    // 档2：要素精配（钱包账户 + 方向 + 金额相等 + 单子创建日~今天窗口内唯一）
    const all = await (this.prisma as any).externalStatementLine.findMany({
      where: { source: bal.source, accountRef: bal.accountRef, direction: order.direction },
    });
    const amt = String(order.amount);
    const from = order.createdAt.getTime();
    const cand = all.filter(
      (l: any) =>
        String(l.amount) === amt &&
        l.datetime.getTime() >= from &&
        l.datetime.getTime() <= Date.now(),
    );
    if (cand.length === 1) {
      return { kind: 'HIT', lineId: cand[0].id, effectiveDate: toBusinessDate(cand[0].datetime) };
    }
    return { kind: 'MISS', candidates: cand.length };
  }
}
