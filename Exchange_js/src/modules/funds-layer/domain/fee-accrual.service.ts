import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { generateReferenceNo } from '../../../common/utils/no-generator.util';
import { InternalTransferService } from './internal-transfer.service';
import { FundsFlowService } from './funds-flow.service';
import { SystemWalletResolver } from './system-wallet-resolver.service';
import { SettlementBatchService } from './settlement-batch.service';
import {
  TransferPath,
  TRANSFER_PATH_WHITELIST,
} from '../constants/internal-transfer-paths.constant';

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

  /**
   * Settle a set of same-category accruals: group by asset, net each group into a
   * single policy-driven F_*→F_FEE transfer, then LOCK the group's accruals.
   *
   * INVARIANT: fiat WITHDRAW_FEE sources the per-customer C_VIBAN, so a fiat-withdraw
   * settle MUST be called per-order (single owner) — the immediate-settle path
   * guarantees this. Crypto sources (F_OPS for SWAP_FEE, C_MAIN for WITHDRAW_FEE) and
   * SWAP_FEE are platform-level, so netting many owners into one transfer is correct.
   */
  async settle(
    accruals: any[],
    category: string,
    settlementType: string,
    tx: Tx,
  ): Promise<void> {
    const groups = new Map<string, any[]>();
    for (const a of accruals) {
      const list = groups.get(a.assetId) ?? [];
      list.push(a);
      groups.set(a.assetId, list);
    }

    for (const [assetId, group] of groups) {
      const amount = group.reduce(
        (sum, a) => sum.add(new Prisma.Decimal(a.amount)),
        new Prisma.Decimal(0),
      );
      if (amount.lte(0)) continue;

      const asset = await (tx as any).asset.findUnique({
        where: { id: assetId },
        select: { type: true },
      });
      const isCrypto = asset?.type === 'CRYPTO';

      let pathEnum: TransferPath;
      let fromRole: string;
      if (category === 'SWAP_FEE') {
        pathEnum = isCrypto
          ? TransferPath.CRYPTO_SWAP_FEE_COLLECT
          : TransferPath.FIAT_SWAP_FEE_COLLECT;
        fromRole = 'F_OPS';
      } else {
        pathEnum = isCrypto
          ? TransferPath.CRYPTO_WITHDRAW_FEE_COLLECT
          : TransferPath.FIAT_WITHDRAW_FEE_COLLECT;
        fromRole = isCrypto ? 'C_MAIN' : 'C_VIBAN';
      }

      const policy = TRANSFER_PATH_WHITELIST[pathEnum];

      const to = await this.systemWallets.resolve(assetId, 'F_FEE');
      const from =
        fromRole === 'C_VIBAN'
          ? await this.systemWallets.resolveCustomer(
              assetId,
              'C_VIBAN',
              group[0].ownerId,
            )
          : await this.systemWallets.resolve(assetId, fromRole);

      const batch = await this.batchService.createBatch({
        cutoffAt: new Date(),
        settlementType,
        category,
      });

      const transfer = await this.transfers.createTransfer({
        path: policy.path,
        accountingClass: policy.class,
        medium: policy.medium,
        triggerSource: settlementType,
        sourceType:
          category === 'SWAP_FEE'
            ? 'SWAP_FEE_SETTLEMENT'
            : 'WITHDRAW_FEE_SETTLEMENT',
        sourceId: `${batch.id}:${assetId}`,
        sourceNo: batch.batchNo,
        ownerType: group[0].ownerType,
        ownerId: group[0].ownerId,
        ownerNo: group[0].ownerNo,
        assetId,
        amount,
        feeAmount: new Prisma.Decimal(0),
        netAmount: amount,
        fromWalletId: from.id,
        toWalletId: to.id,
        settlementBatchId: batch.id,
      });

      await this.fundsFlow.createLeg({
        internalTransactionId: transfer.id,
        fromWalletId: from.id,
        toWalletId: to.id,
        amount,
      });

      await (tx as any).feeAccrual.updateMany({
        where: { id: { in: group.map((a) => a.id) } },
        data: {
          status: 'LOCKED',
          settledByTransferId: transfer.id,
          settlementBatchId: batch.id,
          lockedAt: new Date(),
        },
      });
    }
  }

  /**
   * Flip a transfer's LOCKED accruals to SETTLED when its fund leg reaches CLEAR.
   * Mirrors OutstandingConsumerService.settle: the second CLEAR sees count 0 and
   * is a no-op, so it is safe as an idempotency latch.
   */
  async settleByTransfer(
    settledByTransferId: string,
    internalFundId: string,
    tx: Tx,
  ): Promise<{ count: number }> {
    return (tx as any).feeAccrual.updateMany({
      where: { settledByTransferId, status: 'LOCKED' },
      data: {
        status: 'SETTLED',
        closedByInternalFundId: internalFundId,
        closedAt: new Date(),
      },
    });
  }
}
