import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { InternalFundQueryDto } from '../dto/internal-fund.dto';

/**
 * Funds-order admin read surface.
 *
 * The V7 execution state machine + settlement write helpers were removed in
 * Round 2 (C5b); the deposit/withdraw/swap workflows now drive funds_orders
 * directly via FundsOrderService. Only the admin readers survive here so the
 * Funds admin controller keeps working — C6 folds these into FundsOrderService.
 */
@Injectable()
export class FundsFlowService {
  constructor(private readonly prisma: PrismaService) {}

  async findAllForAdmin(query: InternalFundQueryDto) {
    const {
      skip = 0,
      take = 20,
      internalTransactionId,
      status,
      txHash,
      fundsOrderNo,
      assetId,
      type,
      startDate,
      endDate,
    } = query as InternalFundQueryDto & { type?: string };

    const where: any = {};
    if (internalTransactionId)
      where.internalTransactionId = internalTransactionId;
    if (status) where.status = status;
    if (txHash) where.txHash = { contains: txHash };
    if (fundsOrderNo) where.fundsOrderNo = { contains: fundsOrderNo };
    if (assetId) where.assetId = assetId;
    if (type) where.asset = { type };
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate);
      if (endDate) where.createdAt.lte = new Date(endDate);
    }

    const [items, total] = await Promise.all([
      (this.prisma as any).fundsOrder.findMany({
        where,
        skip: Number(skip),
        take: Number(take),
        orderBy: { createdAt: 'desc' },
        include: {
          asset: true,
        },
      }),
      (this.prisma as any).fundsOrder.count({ where }),
    ]);

    return { items, total };
  }

  async findOneByNoForAdmin(fundsOrderNo: string) {
    const item = await (this.prisma as any).fundsOrder.findUnique({
      where: { fundsOrderNo },
      include: {
        asset: true,
        fromWallet: true,
        toWallet: true,
        // Swap legs hang directly on the swap (no internalTransaction parent).
        // Expose swapNo + status so the detail page can advance the leg via the
        // swap settlement endpoint instead of the transfer-simulate endpoint.
        swapTransaction: {
          select: {
            id: true,
            swapNo: true,
            status: true,
          },
        },
        // Withdrawal fee funds hang directly on the withdraw transaction.
        withdrawTransaction: {
          select: {
            id: true,
            withdrawNo: true,
            status: true,
          },
        },
        auditLogs: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!item) {
      throw new NotFoundException('Internal fund not found');
    }
    return item;
  }

  async findOneForAdmin(id: string) {
    const item = await (this.prisma as any).fundsOrder.findUnique({
      where: { id },
      include: {
        asset: true,
        fromWallet: true,
        toWallet: true,
        auditLogs: {
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!item) {
      throw new NotFoundException('Internal fund not found');
    }

    return item;
  }
}
