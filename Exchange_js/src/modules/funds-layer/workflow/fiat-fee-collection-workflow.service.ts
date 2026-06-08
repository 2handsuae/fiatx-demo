import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { InternalTransferService } from '../domain/internal-transfer.service';
import { FundsFlowService } from '../domain/funds-flow.service';
import { FundsAccountingService } from '../accounting/funds-accounting.service';
import { SystemWalletResolver } from '../domain/system-wallet-resolver.service';
import { WhitelistGuard } from '../guards/whitelist.guard';
import { AccountingClass, TransferMedium } from '../constants/internal-transfer-paths.constant';
import { InternalFundStatus } from '../../asset-treasury/internal-funds/dto/internal-fund.dto';

const FEE_SOURCE_TYPE = 'FIAT_FEE_COLLECTION';

@Injectable()
export class FiatFeeCollectionWorkflowService {
  private readonly logger = new Logger(FiatFeeCollectionWorkflowService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly transfers: InternalTransferService,
    private readonly fundsFlow: FundsFlowService,
    private readonly accounting: FundsAccountingService,
    private readonly systemWallets: SystemWalletResolver,
    private readonly whitelist: WhitelistGuard,
  ) {}

  /** Spawn a single-hop fee-collect transfer (1 transfer + 1 fund). Idempotent per sourceId. */
  private async spawnCollect(input: {
    fromRole: string;
    fromWalletId: string;
    toWalletId: string;
    assetId: string;
    amount: Prisma.Decimal;
    ownerType: string;
    ownerId: string;
    ownerNo: string | null;
    sourceId: string;
    sourceNo: string | null;
    triggerSource: string;
  }) {
    const existing = await (this.prisma as any).internalTransaction.findFirst({
      where: { sourceType: FEE_SOURCE_TYPE, sourceId: input.sourceId },
    });
    if (existing) return existing;

    const policy = this.whitelist.assertWhitelisted(input.fromRole, 'F_FEE');

    const transfer = await this.transfers.createTransfer({
      path: policy.path,
      accountingClass: AccountingClass.B,
      medium: TransferMedium.BANK,
      triggerSource: input.triggerSource,
      sourceType: FEE_SOURCE_TYPE,
      sourceId: input.sourceId,
      sourceNo: input.sourceNo,
      ownerType: input.ownerType,
      ownerId: input.ownerId,
      ownerNo: input.ownerNo,
      assetId: input.assetId,
      amount: input.amount,
      feeAmount: new Prisma.Decimal(0),
      netAmount: input.amount,
      fromWalletId: input.fromWalletId,
      toWalletId: input.toWalletId,
      settlementBatchId: null,
    });

    await this.fundsFlow.createLeg({
      internalTransactionId: transfer.id,
      fromWalletId: input.fromWalletId,
      toWalletId: input.toWalletId,
      amount: input.amount,
      status: InternalFundStatus.CREATED,
    });

    return transfer;
  }

  /** Collect a swap's fiat fees: customer service fee (VIBAN→F_FEE) + spread (F_LIQ→F_FEE). */
  async collectSwapFees(swapId: string): Promise<void> {
    const swap = await (this.prisma as any).swapTransaction.findUnique({
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
        toAsset: { select: { type: true } },
      },
    });

    if (!swap || swap.toAsset?.type !== 'FIAT') return;

    const fee = new Prisma.Decimal(swap.feeAmount ?? 0);
    const spread = new Prisma.Decimal(swap.spreadAmount ?? 0);

    if (fee.gt(0)) {
      const viban = await this.systemWallets.resolveCustomer(swap.toAssetId, 'C_VIBAN', swap.ownerId);
      const fFee = await this.systemWallets.resolve(swap.toAssetId, 'F_FEE');
      await this.spawnCollect({
        fromRole: 'C_VIBAN',
        fromWalletId: viban.id,
        toWalletId: fFee.id,
        assetId: swap.toAssetId,
        amount: fee,
        ownerType: swap.ownerType,
        ownerId: swap.ownerId,
        ownerNo: swap.ownerNo,
        sourceId: `${swap.id}:FEE`,
        sourceNo: swap.swapNo,
        triggerSource: 'SWAP',
      });
    }

    if (spread.gt(0)) {
      const fLiq = await this.systemWallets.resolve(swap.toAssetId, 'F_LIQ');
      const fFee = await this.systemWallets.resolve(swap.toAssetId, 'F_FEE');
      await this.spawnCollect({
        fromRole: 'F_LIQ',
        fromWalletId: fLiq.id,
        toWalletId: fFee.id,
        assetId: swap.toAssetId,
        amount: spread,
        ownerType: 'PLATFORM',
        ownerId: 'PLATFORM',
        ownerNo: null,
        sourceId: `${swap.id}:SPREAD`,
        sourceNo: swap.swapNo,
        triggerSource: 'SWAP',
      });
    }
  }
}
