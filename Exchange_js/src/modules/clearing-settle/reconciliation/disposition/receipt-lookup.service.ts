// 平账·推单 同步腿的回执查找（spec §4）：两档严格度，任一档命中恰好 1 条即 HIT，否则 MISS 报数。
// 同步永不猜——多候选不进入下一档、不打分挑选。
// Port/adapter：本实现 = "已摄入对账单行" adapter；将来接银行/托管实时查询只换本类。
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../core/prisma/prisma.service';
import { toBusinessDate } from '../../../accounting/tigerbeetle/utils/business-date.util';

export type ReceiptLookupResult =
  | { kind: 'HIT'; lineId: string; effectiveDate: string }
  | { kind: 'MISS'; candidates: number };

/**
 * 归一化的可推单资金单视图。真实资金单列 fromWalletId/toWalletId/txHash/referenceNo/providerTxnId
 * 由 PushOrderService 映射成本视图（walletId=方向对应的物理钱包、externalRefs=[txHash,referenceNo,
 * providerTxnId].filter(Boolean)、direction 由 depositTransactionId/withdrawTransactionId 派生）——
 * 本类只依赖归一化后的键。
 */
export interface PushableOrderView {
  fundsOrderNo: string;
  walletId: string;
  direction: 'IN' | 'OUT';
  amount: number | string;
  // 参考号集合：与对账 matcher 的 refsOf 同源 = [txHash, referenceNo, providerTxnId].filter(Boolean)
  // （链上充值/提现回执是 txHash，法币是自有号）。空数组 → 直接落档2。
  externalRefs: string[];
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

    // 档1：参考号精配（对 order 的 ref 集合做 membership 匹配，与 matcher refsOf 同源）
    if (order.externalRefs.length > 0) {
      const hits = await (this.prisma as any).externalStatementLine.findMany({
        where: { source: bal.source, accountRef: bal.accountRef, externalRef: { in: order.externalRefs } },
      });
      if (hits.length === 1) {
        return { kind: 'HIT', lineId: hits[0].id, effectiveDate: toBusinessDate(hits[0].datetime) };
      }
      if (hits.length > 1) return { kind: 'MISS', candidates: hits.length };
      // 0 条 → 落档2
    }

    // 档2：要素精配（钱包账户 + 方向 + 金额相等 + 单子创建日~今天窗口内唯一）
    //
    // 跨口径金额比较（与 matcher T1 同一分界，wallet-flow-matcher.service.ts:167-171）：
    // external_statement_lines.amount 已是「分」(T2 契约，是值为整数分的 Prisma.Decimal) →
    // 直接取整成 BigInt，不 ×10^decimals；funds_order.amount 本轮仍存「元」→ 必须先 元→分
    // (×10^decimals) 才能与外部分行相等比。decimals 来自 asset 表(按币种)，禁硬编码。
    // 推单动钱：币种小数位查不到 = 无法安全换算，宁可 MISS 也不在错口径上假配（避免误命中）。
    const asset = await (this.prisma as any).asset.findFirst({
      where: { currency: bal.currency },
      select: { decimals: true },
    });
    if (!asset || asset.decimals == null) return { kind: 'MISS', candidates: 0 };
    const decimals: number = asset.decimals;

    const all = await (this.prisma as any).externalStatementLine.findMany({
      where: { source: bal.source, accountRef: bal.accountRef, direction: order.direction },
    });
    // funds_order 元 → 分（BigInt 整数，避免 JS 浮点）
    const orderMinor = BigInt(
      new Prisma.Decimal(String(order.amount)).mul(new Prisma.Decimal(10).pow(decimals)).toFixed(0),
    );
    // external 行分 → BigInt 整数（l.amount 是值为整数分的 Prisma.Decimal；取整后用 BigInt 比，
    // 不用字符串 ===，否则 "49800" vs "49800.0" 会假不等）
    const extMinor = (a: any): bigint => BigInt((a?.toFixed ? a.toFixed(0) : String(a)));
    const from = order.createdAt.getTime();
    const cand = all.filter(
      (l: any) =>
        extMinor(l.amount) === orderMinor &&
        l.datetime.getTime() >= from &&
        l.datetime.getTime() <= Date.now(),
    );
    if (cand.length === 1) {
      return { kind: 'HIT', lineId: cand[0].id, effectiveDate: toBusinessDate(cand[0].datetime) };
    }
    return { kind: 'MISS', candidates: cand.length };
  }
}
