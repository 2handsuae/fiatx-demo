import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { SwapEvents } from '../modules/trading/swap-transactions/constants/swap-events.constant';
import { SwapTransactionsService } from '../modules/trading/swap-transactions/swap-transactions.service';
import { JournalsService } from '../modules/accounting/journals/journals.service';
import { SwapTransactionStatus } from '../modules/trading/swap-transactions/dto/swap-transaction.dto';

@Injectable()
export class SwapWorkflowService implements OnModuleInit {
  private readonly logger = new Logger(SwapWorkflowService.name);

  constructor(
    private readonly swapService: SwapTransactionsService,
    private readonly journalService: JournalsService,
  ) {}

  onModuleInit() {
    this.logger.log(
      'SwapWorkflowService initialized and listening for Swap events.',
    );
  }

  @OnEvent(SwapEvents.EVT_SWAP_CREATED)
  async handleSwapCreated(payload: { swapId: string }) {
    this.logger.log(
      `Event received: ${SwapEvents.EVT_SWAP_CREATED} for ${payload.swapId}`,
    );
    await this.triggerAccounting(
      payload.swapId,
      null,
      SwapTransactionStatus.PENDING_COMPLIANCE,
    );
  }

  @OnEvent(SwapEvents.EVT_SWAP_SUCCESS)
  async handleSwapSuccess(payload: { swapId: string; oldStatus: string }) {
    this.logger.log(
      `Event received: ${SwapEvents.EVT_SWAP_SUCCESS} for ${payload.swapId}`,
    );
    await this.triggerAccounting(
      payload.swapId,
      payload.oldStatus,
      SwapTransactionStatus.SUCCESS,
    );
  }

  @OnEvent(SwapEvents.EVT_SWAP_REJECTED)
  async handleSwapRejected(payload: {
    swapId: string;
    oldStatus: string;
    reason?: string;
  }) {
    this.logger.log(
      `Event received: ${SwapEvents.EVT_SWAP_REJECTED} for ${payload.swapId}, reason: ${payload.reason}`,
    );
    await this.triggerAccounting(
      payload.swapId,
      payload.oldStatus,
      SwapTransactionStatus.REJECTED,
    );
  }

  private async triggerAccounting(
    swapId: string,
    fromStatus: string | null,
    toStatus: string,
  ) {
    const swap = await this.swapService.findOne(swapId);

    // Context for accounting template
    const context = {
      src: {
        id: swap.id,
        swapNo: swap.swapNo,
        ownerId: swap.ownerId,
        ownerType: swap.ownerType,
        fromAssetId: swap.fromAssetId,
        toAssetId: swap.toAssetId,
        amount: swap.fromAmount.toString(), // Default amount for journal header
        fromAmount: swap.fromAmount.toString(),
        toAmount: swap.toAmount.toString(),
        exchangeRate: swap.exchangeRate.toString(),
      },
    };

    const journal = await this.journalService.triggerEvent({
      entityType: 'SWAP',
      triggerKey: 'status',
      fromStatus: fromStatus,
      toStatus: toStatus,
      assetType: 'ALL',
      context,
      sourceId: swapId,
    });

    if (journal) {
      this.logger.log(
        `Accounting triggered for Swap ${swapId}: ${fromStatus} -> ${toStatus}, Journal ID: ${journal.id}`,
      );
    } else {
      this.logger.warn(
        `No accounting event matched for Swap ${swapId}: ${fromStatus} -> ${toStatus}`,
      );
    }
  }
}
