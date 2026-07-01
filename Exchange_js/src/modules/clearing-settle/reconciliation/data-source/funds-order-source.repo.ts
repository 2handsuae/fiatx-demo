import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../core/prisma/prisma.service';
import { FundsOrderStatus } from '../../../funds-orders/dto/funds-order.dto';

/**
 * FundsOrderSourceRepo — 对账引擎的单一数据源抽象（round2 §6.1）。
 *
 * C1 把 payin/payout/internal_funds 三张表 rename+合并成 funds_orders 后，对账引擎不再
 * 直接读旧表。本 repo 把 funds_orders 行按「父 FK + legSeq + status」投影成旧表(payin/
 * payout/internal_fund/outstanding/feeAccrual)的行 shape，让 recon 消费方（五公式 /
 * leg-projection / internal-actions / in-transit / mock-external）**零改动**、语义逐字不变。
 *
 * 视角划分（§6.1）：
 *   payin    = funds_orders 有 depositTransactionId（入金）
 *   payout   = funds_orders 有 withdrawTransactionId 且 legSeq=1（出金主腿；费腿不入外部出金视角）
 *   internal = funds_orders 有 swapTransactionId（swap 各腿） 或（withdrawTransactionId 且 legSeq>1，出金费腿）
 *
 * 单位约定：amount 均以 human decimal 存储，与消费方一致，不缩放。
 */
@Injectable()
export class FundsOrderSourceRepo {
  constructor(private readonly prisma: PrismaService) {}

  // ── 终态窗口视角（leg-projection / internal-actions 消费 CLEARED 终态） ──────────

  /**
   * payin 视角：depositTransactionId != null 的 funds_orders。
   * 返回字段对齐 leg-projection:76 + internal-actions:32 的并集
   * （payinNo ← fundsOrderNo；toWallet 关系原样带出）。
   */
  async findPayins(filter: {
    assetId: string;
    status: string;
    createdAt?: { gte: Date; lt: Date };
  }): Promise<PayinView[]> {
    const rows = await this.prisma.fundsOrder.findMany({
      where: {
        assetId: filter.assetId,
        status: filter.status,
        depositTransactionId: { not: null },
        ...(filter.createdAt ? { createdAt: filter.createdAt } : {}),
      },
      select: {
        id: true, fundsOrderNo: true, amount: true, txHash: true,
        referenceNo: true, createdAt: true,
        toWallet: { select: { id: true, vaultId: true, iban: true, walletRole: true } },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      payinNo: r.fundsOrderNo,
      amount: r.amount,
      txHash: r.txHash,
      referenceNo: r.referenceNo,
      createdAt: r.createdAt,
      toWallet: r.toWallet,
    }));
  }

  /**
   * payout 视角：withdrawTransactionId != null 且 legSeq=1 的 funds_orders（出金主腿）。
   * 返回字段对齐 leg-projection:91 + internal-actions:43 的并集
   * （payoutNo ← fundsOrderNo；ownerId 经出金主腿的来源钱包 owner 反查）。
   */
  async findPayouts(filter: { assetId: string; status: string }): Promise<PayoutView[]> {
    const rows = await this.prisma.fundsOrder.findMany({
      where: {
        assetId: filter.assetId,
        status: filter.status,
        withdrawTransactionId: { not: null },
        legSeq: 1,
      },
      select: {
        id: true, fundsOrderNo: true, amount: true, txHash: true,
        referenceNo: true, createdAt: true,
        // ownerId 旧 payout 表是直接列；funds_orders 经来源钱包 owner 反查。
        fromWallet: { select: { ownerId: true } },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      payoutNo: r.fundsOrderNo,
      amount: r.amount,
      txHash: r.txHash,
      referenceNo: r.referenceNo,
      createdAt: r.createdAt,
      ownerId: r.fromWallet?.ownerId ?? null,
    }));
  }

  /**
   * internal 视角：swapTransactionId != null 或（withdrawTransactionId != null 且 legSeq>1）。
   * 返回字段对齐 leg-projection:102 + internal-actions:17 + mock-external:34 的并集
   * （fundsOrderNo 原名；from/to Wallet 关系原样带出）。
   * @param opts.requireExternalRef  仅取有 txHash||referenceNo 的行（internal-actions:17 语义）。
   * @param opts.requireTxHash       仅取有 txHash 的行（mock-external:34 语义）。
   */
  async findInternals(filter: {
    assetId: string;
    status: string;
    createdAt?: { gte: Date; lt: Date };
    requireExternalRef?: boolean;
    requireTxHash?: boolean;
  }): Promise<InternalView[]> {
    // 两个独立 OR（父 FK 视角 + requireExternalRef）都放进 AND，避免顶层 OR 键冲突。
    const andClauses: Prisma.FundsOrderWhereInput[] = [
      {
        OR: [
          { swapTransactionId: { not: null } },
          { AND: [{ withdrawTransactionId: { not: null } }, { legSeq: { gt: 1 } }] },
        ],
      },
    ];
    if (filter.requireExternalRef) {
      andClauses.push({ OR: [{ txHash: { not: null } }, { referenceNo: { not: null } }] });
    }
    const rows = await this.prisma.fundsOrder.findMany({
      where: {
        assetId: filter.assetId,
        status: filter.status,
        ...(filter.createdAt ? { createdAt: filter.createdAt } : {}),
        ...(filter.requireTxHash ? { txHash: { not: null } } : {}),
        AND: andClauses,
      },
      select: {
        id: true, fundsOrderNo: true, amount: true, txHash: true,
        referenceNo: true, createdAt: true,
        fromWallet: { select: { id: true, vaultId: true, iban: true, walletRole: true } },
        toWallet: { select: { id: true, vaultId: true, iban: true, walletRole: true } },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      fundsOrderNo: r.fundsOrderNo,
      amount: r.amount,
      txHash: r.txHash,
      referenceNo: r.referenceNo,
      createdAt: r.createdAt,
      fromWallet: r.fromWallet,
      toWallet: r.toWallet,
    }));
  }

  // ── in-transit 在途视角（in-transit.service 只读 amount） ─────────────────────

  /** payin 在途：depositTransactionId != null，status ∈ 传入集合，createdAt < cutoff。只返 amount。 */
  async findPayinsInTransit(filter: {
    assetId: string;
    statuses: readonly string[];
    cutoff: Date;
  }): Promise<{ amount: Prisma.Decimal }[]> {
    return this.prisma.fundsOrder.findMany({
      where: {
        assetId: filter.assetId,
        depositTransactionId: { not: null },
        status: { in: [...filter.statuses] },
        createdAt: { lt: filter.cutoff },
      },
      select: { amount: true },
    });
  }

  /** internal 在途：swap 腿或出金费腿(legSeq>1)，status ∈ 传入集合，createdAt < cutoff。只返 amount。 */
  async findInternalsInTransit(filter: {
    assetId: string;
    statuses: readonly string[];
    cutoff: Date;
  }): Promise<{ amount: Prisma.Decimal }[]> {
    return this.prisma.fundsOrder.findMany({
      where: {
        assetId: filter.assetId,
        status: { in: [...filter.statuses] },
        createdAt: { lt: filter.cutoff },
        OR: [
          { swapTransactionId: { not: null } },
          { AND: [{ withdrawTransactionId: { not: null } }, { legSeq: { gt: 1 } }] },
        ],
      },
      select: { amount: true },
    });
  }

  // ── 五公式 RHS 专用（subledger-inputs 消费；等价映射，语义不动） ─────────────────

  /**
   * 式2 RHS 第一项等价源：在途(未终态) funds_orders 当作 OPEN Outstanding。
   *   funds_orders WHERE status ∈ (SUBMITTED,CONFIRMING,CONFIRMED)
   *     AND asset.currency=currency AND createdAt < cutoff
   * 返回 {direction, amount}，direction 由父 FK 派生（入金=IN、出金=OUT、swap=IN）。
   * 供 subledger-inputs 按 direction 分正负 sum。
   */
  async findOpenOutstandings(
    currency: string,
    cutoff: Date,
  ): Promise<{ direction: 'IN' | 'OUT'; amount: Prisma.Decimal }[]> {
    const rows = await this.prisma.fundsOrder.findMany({
      where: {
        status: { in: [...IN_FLIGHT_STATUSES] },
        asset: { is: { currency } },
        createdAt: { lt: cutoff },
      },
      select: {
        amount: true,
        depositTransactionId: true,
        withdrawTransactionId: true,
        swapTransactionId: true,
      },
    });
    return rows.map((r) => ({
      direction: this.directionFor(r),
      amount: r.amount,
    }));
  }

  /**
   * 式2 RHS 第二项等价源：在途出金费腿当作未去混同提现费。
   *   funds_orders WHERE withdrawTransactionId != null AND legSeq>1
   *     AND status ∈ (SUBMITTED,CONFIRMING,CONFIRMED) AND asset.currency=currency
   *     AND createdAt < cutoff
   * 返回 {amount}，供 subledger-inputs reduce sum。
   */
  async findFeeAccruals(
    currency: string,
    cutoff: Date,
  ): Promise<{ amount: Prisma.Decimal }[]> {
    return this.prisma.fundsOrder.findMany({
      where: {
        withdrawTransactionId: { not: null },
        legSeq: { gt: 1 },
        status: { in: [...IN_FLIGHT_STATUSES] },
        asset: { is: { currency } },
        createdAt: { lt: cutoff },
      },
      select: { amount: true },
    });
  }

  /** 父 FK → 方向：入金=IN、出金=OUT、swap 记 to-leg 净贷记=IN（保守，五公式引擎已停用不实际命中）。 */
  private directionFor(r: {
    depositTransactionId: string | null;
    withdrawTransactionId: string | null;
    swapTransactionId: string | null;
  }): 'IN' | 'OUT' {
    if (r.withdrawTransactionId) return 'OUT';
    return 'IN';
  }
}

const IN_FLIGHT_STATUSES = [
  FundsOrderStatus.SUBMITTED,
  FundsOrderStatus.CONFIRMING,
  FundsOrderStatus.CONFIRMED,
] as const;

// ── Row-shape types: funds_orders 投影成旧表 shape，消费方零改动 ─────────────────

type WalletRefView = {
  id: string;
  vaultId: string | null;
  iban: string | null;
  walletRole: string | null;
} | null;

export interface PayinView {
  id: string;
  payinNo: string; // ← fundsOrderNo
  amount: Prisma.Decimal;
  txHash: string | null;
  referenceNo: string | null;
  createdAt: Date;
  toWallet: WalletRefView;
}

export interface PayoutView {
  id: string;
  payoutNo: string; // ← fundsOrderNo
  amount: Prisma.Decimal;
  txHash: string | null;
  referenceNo: string | null;
  createdAt: Date;
  ownerId: string | null; // ← fromWallet.ownerId
}

export interface InternalView {
  id: string;
  fundsOrderNo: string;
  amount: Prisma.Decimal;
  txHash: string | null;
  referenceNo: string | null;
  createdAt: Date;
  fromWallet: WalletRefView;
  toWallet: WalletRefView;
}
