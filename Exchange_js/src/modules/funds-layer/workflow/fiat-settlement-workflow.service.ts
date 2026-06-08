import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { DomainEventNames } from '../../../common/events/domain-events.constants';
import {
  AccountingClass,
  TransferMedium,
  TransferPath,
} from '../constants/internal-transfer-paths.constant';
import { SettlementBatchService } from '../domain/settlement-batch.service';
import { OutstandingConsumerService } from '../domain/outstanding-consumer.service';
import { InternalTransferService } from '../domain/internal-transfer.service';
import { FundsFlowService } from '../domain/funds-flow.service';
import { FundsAccountingService } from '../accounting/funds-accounting.service';
import { SystemWalletResolver } from '../domain/system-wallet-resolver.service';
import { WhitelistGuard } from '../guards/whitelist.guard';
import { InternalFundStatus } from '../../asset-treasury/internal-funds/dto/internal-fund.dto';

const FIAT_SOURCE_TYPE = 'FIAT_SETTLEMENT';

interface SwapSucceededEvent { swapId: string; swapNo: string; ownerId: string }

@Injectable()
export class FiatSettlementWorkflowService {
  private readonly logger = new Logger(FiatSettlementWorkflowService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly batchService: SettlementBatchService,
    private readonly consumer: OutstandingConsumerService,
    private readonly transfers: InternalTransferService,
    private readonly fundsFlow: FundsFlowService,
    private readonly accounting: FundsAccountingService,
    private readonly systemWallets: SystemWalletResolver,
    private readonly whitelist: WhitelistGuard,
  ) {}

  @OnEvent(DomainEventNames.SWAP_SUCCEEDED)
  async onSwapSucceeded(event: SwapSucceededEvent): Promise<void> {
    const outstandings = await this.consumer.findOpenFiatBySwap(event.swapId);
    if (!outstandings.length) return;

    const batch = await this.batchService.createBatch({
      cutoffAt: new Date(),
      settlementType: 'FIAT_SWAP',
    });

    for (const o of outstandings) {
      const isOut = o.direction === 'OUT';
      const path = isOut ? TransferPath.FIAT_SETTLE_OUT : TransferPath.FIAT_SETTLE_IN;
      const route = isOut
        ? ['C_VIBAN', 'F_SET', 'F_LIQ']
        : ['F_LIQ', 'F_SET', 'C_VIBAN'];
      this.whitelist.assertRoute(route);

      const viban = await this.systemWallets.resolveCustomer(o.assetId, 'C_VIBAN', o.ownerId);
      const fset = await this.systemWallets.resolve(o.assetId, 'F_SET');
      const fliq = await this.systemWallets.resolve(o.assetId, 'F_LIQ');

      const hop1From = isOut ? viban : fliq;
      const hop2To = isOut ? fliq : viban;
      const amount = new Prisma.Decimal(o.amount);

      const transfer = await this.transfers.createTransfer({
        path,
        accountingClass: AccountingClass.B,
        medium: TransferMedium.BANK,
        triggerSource: 'SWAP',
        sourceType: FIAT_SOURCE_TYPE,
        sourceId: `${event.swapId}:${o.id}`,
        sourceNo: o.sourceNo ?? event.swapNo,
        ownerType: o.ownerType,
        ownerId: o.ownerId,
        ownerNo: o.ownerNo ?? null,
        assetId: o.assetId,
        amount,
        feeAmount: new Prisma.Decimal(0),
        netAmount: amount,
        fromWalletId: hop1From.id,
        toWalletId: hop2To.id,
        settlementBatchId: batch.id,
      });

      // hop1: hop1From → F_SET (executable, CREATED)
      await this.fundsFlow.createLeg({
        internalTransactionId: transfer.id,
        fromWalletId: hop1From.id,
        toWalletId: fset.id,
        amount,
        status: InternalFundStatus.CREATED,
      });
      // hop2: F_SET → hop2To (held in CREATED until hop1 confirms — sequenced in a later task)
      await this.fundsFlow.createLeg({
        internalTransactionId: transfer.id,
        fromWalletId: fset.id,
        toWalletId: hop2To.id,
        amount,
        status: InternalFundStatus.CREATED,
      });

      await this.consumer.lockToTransfer([o.id], batch.id, transfer.id);
    }

    await this.batchService.recomputeBatch(batch.id);
  }
}
