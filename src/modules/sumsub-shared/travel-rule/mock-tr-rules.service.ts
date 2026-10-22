import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';

/**
 * VARA Travel Rule 门槛(按资产写死,业主 2026-07-31 定)。
 * 监管数值,不做管理台可配 —— 改动须走发版 + review。
 * （对手方波二：从 kyt-txn-type.resolver 原样搬回——判型只管"报哪种单"，这里管"挂不挂起认领"。）
 */
const TR_THRESHOLD_BY_CURRENCY: Record<string, number> = {
  USDT: 1000,
  AED: 3500,
};

/**
 * 站在 Sumsub 一侧的 TR 规则 mock：阈值规则 + 已知来源判别。
 * 真身是 Sumsub 的 Travel Rule 引擎，切真集成时这里是刀口，登记于 reference/sumsub-mock-touchpoints.md。
 */
@Injectable()
export class MockTrRulesService {
  private readonly logger = new Logger(MockTrRulesService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 这笔金额是否触发 Travel Rule。边界取 >=(正好 1000 USDT / 3500 AED 要走 TR)。
   * 漏配币种:判不适用保证不卡单,但必须能被发现 —— 静默漏报比报错危险。
   */
  isTrApplicable(currency: string, amount: number): boolean {
    const threshold = TR_THRESHOLD_BY_CURRENCY[String(currency).toUpperCase()];
    if (threshold === undefined) {
      this.logger.warn(
        `No VARA TR threshold configured for currency=${currency}; treating as not applicable. Add it to TR_THRESHOLD_BY_CURRENCY.`,
      );
      return false;
    }
    return amount >= threshold;
  }

  /**
   * 已知来源:同客户 × 同 fromAddress × 已提交过认领(sourceClaimedAt 非空)→ 返回最近一单 depositNo。
   * 已知来源的"记忆"以查询代存储,零新表;查询不排除任何单——含本单自己刚提交的认领快照。
   */
  async findKnownSource(userId: string, fromAddress: string): Promise<string | null> {
    const row = await this.prisma.depositTransaction.findFirst({
      where: { ownerId: userId, fromAddress, sourceClaimedAt: { not: null } },
      orderBy: { sourceClaimedAt: 'desc' },
      select: { depositNo: true },
    });
    return row?.depositNo ?? null;
  }
}
