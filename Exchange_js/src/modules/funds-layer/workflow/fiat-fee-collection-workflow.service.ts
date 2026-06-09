import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { DomainEventNames } from '../../../common/events/domain-events.constants';
import { WithdrawEvents } from '../../trading/withdraw-transactions/constants/withdraw-events.constant';
import { InternalTransferService } from '../domain/internal-transfer.service';
import { FundsFlowService } from '../domain/funds-flow.service';
import { FundsAccountingService } from '../accounting/funds-accounting.service';
import { SystemWalletResolver } from '../domain/system-wallet-resolver.service';
import { WhitelistGuard } from '../guards/whitelist.guard';
import { InternalFundStatus } from '../../asset-treasury/internal-funds/dto/internal-fund.dto';

interface FundsFlowStatusChangedEvent {
  fundsFlowId: string;
  internalTransferId: string | undefined;
  oldStatus: string;
  newStatus: string;
}

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
      accountingClass: policy.class,
      medium: policy.medium,
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

  /** Collect a swap's fiat fees company-side (Model A): service fee + spread, both F_LIQ→F_FEE. */
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
      // Model A: service fee comes from company liquidity (F_LIQ→F_FEE), NOT the
      // client VIBAN — settlement delivers net, so no fee is parked in the VIBAN.
      const fLiq = await this.systemWallets.resolve(swap.toAssetId, 'F_LIQ');
      const fFee = await this.systemWallets.resolve(swap.toAssetId, 'F_FEE');
      await this.spawnCollect({
        fromRole: 'F_LIQ',
        fromWalletId: fLiq.id,
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

  @OnEvent(WithdrawEvents.EVT_WITHDRAWAL_SUCCESS__FIAT)
  async onFiatWithdrawalSucceeded(event: { withdrawId: string }): Promise<void> {
    try {
      const w = await (this.prisma as any).withdrawTransaction.findUnique({
        where: { id: event.withdrawId },
        select: {
          id: true,
          withdrawNo: true,
          ownerType: true,
          ownerId: true,
          ownerNo: true,
          assetId: true,
          feeAmount: true,
          asset: { select: { type: true } },
        },
      });
      if (!w || w.asset?.type !== 'FIAT') return;
      const fee = new Prisma.Decimal(w.feeAmount ?? 0);
      if (!fee.gt(0)) return;
      const viban = await this.systemWallets.resolveCustomer(w.assetId, 'C_VIBAN', w.ownerId);
      const fFee = await this.systemWallets.resolve(w.assetId, 'F_FEE');
      await this.spawnCollect({
        fromRole: 'C_VIBAN',
        fromWalletId: viban.id,
        toWalletId: fFee.id,
        assetId: w.assetId,
        amount: fee,
        ownerType: w.ownerType,
        ownerId: w.ownerId,
        ownerNo: w.ownerNo,
        sourceId: `${w.id}:FEE`,
        sourceNo: w.withdrawNo,
        triggerSource: 'WITHDRAW',
      });
    } catch (err) {
      this.logger.error(
        `Withdrawal fee collection failed for withdraw=${event.withdrawId}`,
        err instanceof Error ? err.stack : undefined,
      );
    }
  }

  @OnEvent(DomainEventNames.FUNDSFLOW_STATUS_CHANGED)
  async onFundsFlowStatusChanged(event: FundsFlowStatusChangedEvent): Promise<void> {
    if (!event?.internalTransferId) return;
    if (event.newStatus !== 'CLEAR') return;
    try {
      const transfer = await (this.prisma as any).internalTransaction.findUnique({
        where: { id: event.internalTransferId },
      });
      if (!transfer || transfer.sourceType !== FEE_SOURCE_TYPE) return;
      // single-hop fee transfer → single CLEAR → drain the exact fee amount FEE_RECEIVABLE→BANK.
      await this.accounting.drainFeeReceivableAmount({
        internalTransferId: transfer.id,
        amount: new Prisma.Decimal(transfer.amount),
      });
    } catch (err) {
      this.logger.error(
        `Fiat fee drain failed for transfer=${event.internalTransferId}`,
        err instanceof Error ? err.stack : undefined,
      );
    }
  }
}
