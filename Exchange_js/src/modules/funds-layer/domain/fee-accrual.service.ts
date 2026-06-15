import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { generateReferenceNo } from '../../../common/utils/no-generator.util';
import { InternalTransferService } from './internal-transfer.service';
import { FundsFlowService } from './funds-flow.service';
import { SystemWalletResolver } from './system-wallet-resolver.service';
import { SettlementBatchService } from './settlement-batch.service';

type Tx = Prisma.TransactionClient | PrismaService;

interface AccrualInput {
  sourceType: string;
  sourceId: string;
  sourceNo?: string | null;
  ownerType: string;
  ownerId: string;
  ownerNo?: string | null;
  feeKind: string;
  category: string;
  assetId: string;
  assetCode?: string | null;
  amount: Prisma.Decimal;
}

@Injectable()
export class FeeAccrualService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transfers: InternalTransferService,
    private readonly fundsFlow: FundsFlowService,
    private readonly systemWallets: SystemWalletResolver,
    private readonly batchService: SettlementBatchService,
  ) {}

  private async createAccrual(tx: Tx, d: AccrualInput) {
    const existing = await (tx as any).feeAccrual.findUnique({
      where: {
        sourceType_sourceId_feeKind: {
          sourceType: d.sourceType,
          sourceId: d.sourceId,
          feeKind: d.feeKind,
        },
      },
    });
    if (existing) return existing;
    return (tx as any).feeAccrual.create({
      data: {
        feeAccrualNo: generateReferenceNo('FAC'),
        ...d,
        status: 'ACCRUED',
      },
    });
  }

  async accrueForSwap(swapId: string, tx: Tx = this.prisma) {
    const swap = await (tx as any).swapTransaction.findUnique({
      where: { id: swapId },
      select: {
        id: true,
        swapNo: true,
        ownerType: true,
        ownerId: true,
        ownerNo: true,
        toAssetId: true,
        feeAmount: true,
        spreadAmount: true,
        toAsset: { select: { code: true } },
      },
    });
    if (!swap) return;

    const base = {
      sourceType: 'SWAP',
      sourceId: swap.id,
      sourceNo: swap.swapNo,
      ownerType: swap.ownerType,
      ownerId: swap.ownerId,
      ownerNo: swap.ownerNo,
      category: 'SWAP_FEE',
      assetId: swap.toAssetId,
      assetCode: swap.toAsset?.code,
    };

    const fee = new Prisma.Decimal(swap.feeAmount ?? 0);
    if (fee.gt(0)) {
      await this.createAccrual(tx, { ...base, feeKind: 'SERVICE_FEE', amount: fee });
    }

    const spread = new Prisma.Decimal(swap.spreadAmount ?? 0);
    if (spread.gt(0)) {
      await this.createAccrual(tx, { ...base, feeKind: 'SPREAD', amount: spread });
    }
  }

  async accrueForWithdraw(withdrawId: string, tx: Tx = this.prisma) {
    const withdraw = await (tx as any).withdrawTransaction.findUnique({
      where: { id: withdrawId },
      select: {
        id: true,
        withdrawNo: true,
        ownerType: true,
        ownerId: true,
        ownerNo: true,
        assetId: true,
        feeAmount: true,
        asset: { select: { code: true } },
      },
    });
    if (!withdraw) return;

    const fee = new Prisma.Decimal(withdraw.feeAmount ?? 0);
    if (fee.gt(0)) {
      await this.createAccrual(tx, {
        sourceType: 'WITHDRAW',
        sourceId: withdraw.id,
        sourceNo: withdraw.withdrawNo,
        ownerType: withdraw.ownerType,
        ownerId: withdraw.ownerId,
        ownerNo: withdraw.ownerNo,
        feeKind: 'WITHDRAW_FEE',
        category: 'WITHDRAW_FEE',
        assetId: withdraw.assetId,
        assetCode: withdraw.asset?.code,
        amount: fee,
      });
    }
  }
}
