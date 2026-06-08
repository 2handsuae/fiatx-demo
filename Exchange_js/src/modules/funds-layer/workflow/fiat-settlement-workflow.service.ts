import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { DomainEventNames } from '../../../common/events/domain-events.constants';
import { SettlementBatchService } from '../domain/settlement-batch.service';
import { OutstandingConsumerService } from '../domain/outstanding-consumer.service';
import { InternalTransferService } from '../domain/internal-transfer.service';
import { FundsFlowService } from '../domain/funds-flow.service';
import { FundsAccountingService } from '../accounting/funds-accounting.service';
import { SystemWalletResolver } from '../domain/system-wallet-resolver.service';
import { WhitelistGuard } from '../guards/whitelist.guard';
import {
  InternalFundAction,
  InternalFundStatus,
  UpdateInternalFundStatusDto,
} from '../../asset-treasury/internal-funds/dto/internal-fund.dto';
import { AccountingClass } from '../constants/internal-transfer-paths.constant';

const FIAT_SOURCE_TYPE = 'FIAT_SETTLEMENT';

interface SwapSucceededEvent { swapId: string; swapNo: string; ownerId: string }

interface FundsFlowStatusChangedEvent {
  fundsFlowId: string;
  internalTransferId: string | undefined;
  oldStatus: string;
  newStatus: string;
}

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
    // The SWAP_SUCCEEDED emit is post-commit (swap already durable); an error
    // here must not propagate to the emitter. The OPEN fiat outstandings remain
    // as durable work items for the backstop, and we log against the swap.
    try {
      const outstandings = await this.consumer.findOpenFiatBySwap(event.swapId);
      if (!outstandings.length) return;

      const batch = await this.batchService.createBatch({
        cutoffAt: new Date(),
        settlementType: 'FIAT_SWAP',
      });

      for (const o of outstandings) {
        // direction OUT → client sold fiat (VIBAN → F_SET → F_LIQ);
        // direction IN  → client bought fiat (F_LIQ → F_SET → VIBAN).
        const isOut = o.direction === 'OUT';
        const route = isOut
          ? ['C_VIBAN', 'F_SET', 'F_LIQ']
          : ['F_LIQ', 'F_SET', 'C_VIBAN'];
        // The route whitelist is the single source of truth for path/class/medium.
        const policy = this.whitelist.assertRoute(route);

        const viban = await this.systemWallets.resolveCustomer(o.assetId, 'C_VIBAN', o.ownerId);
        const fset = await this.systemWallets.resolve(o.assetId, 'F_SET');
        const fliq = await this.systemWallets.resolve(o.assetId, 'F_LIQ');

        const hop1From = isOut ? viban : fliq;
        const hop2To = isOut ? fliq : viban;
        const amount = new Prisma.Decimal(o.amount);

        const transfer = await this.transfers.createTransfer({
          path: policy.path,
          accountingClass: policy.class,
          medium: policy.medium,
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
    } catch (err) {
      this.logger.error(
        `Fiat settlement failed for swap=${event.swapId}`,
        err instanceof Error ? err.stack : undefined,
      );
    }
  }

  @OnEvent(DomainEventNames.FUNDSFLOW_STATUS_CHANGED)
  async onFundsFlowStatusChanged(event: FundsFlowStatusChangedEvent): Promise<void> {
    if (!event?.internalTransferId) return;
    if (event.newStatus !== 'CONFIRMED' && event.newStatus !== 'CLEAR') return;

    try {
      const transfer = await (this.prisma as any).internalTransaction.findUnique({
        where: { id: event.internalTransferId },
      });
      if (!transfer || transfer.sourceType !== FIAT_SOURCE_TYPE) return;

      if (event.newStatus === 'CONFIRMED') {
        // hop1 (the leg landing in F_SET) confirmed → release the held hop2.
        const funds = await (this.prisma as any).internalFund.findMany({
          where: { internalTransactionId: transfer.id },
          select: { id: true, fromWalletId: true, toWalletId: true, status: true },
        });
        const confirmed = funds.find((f: any) => f.id === event.fundsFlowId);
        const hop2 = funds.find(
          (f: any) =>
            f.fromWalletId === confirmed?.toWalletId &&
            f.status === InternalFundStatus.CREATED,
        );
        if (confirmed && hop2) {
          await this.fundsFlow.updateStatus(
            hop2.id,
            { action: InternalFundAction.SUBMIT } as UpdateInternalFundStatusDto,
            'SYSTEM',
          );
        }
        return;
      }

      // newStatus === 'CLEAR' — finalize once. settle() is the idempotency latch:
      // LOCKED→SETTLED; the second CLEAR sees count 0 and bails (no double drain).
      const settled = await this.consumer.settle(transfer.id, event.fundsFlowId);
      if (!settled || settled.count === 0) return;

      await this.accounting.applyAccounting({
        accountingClass: AccountingClass.B,
        internalTransferId: transfer.id,
      });
      if (transfer.settlementBatchId) {
        await this.batchService.recomputeBatch(transfer.settlementBatchId);
      }
    } catch (err) {
      this.logger.error(
        `Fiat settlement completion failed for transfer=${event.internalTransferId} status=${event.newStatus}`,
        err instanceof Error ? err.stack : undefined,
      );
    }
  }
}
