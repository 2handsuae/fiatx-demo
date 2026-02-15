import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SwapEvents } from './constants/swap-events.constant';
import { generateReferenceNo } from '../../../common/utils/no-generator.util';
import {
  SwapTransactionStatus,
  SwapTransactionAction,
  CreateSwapTransactionDto,
  UpdateSwapTransactionStatusDto,
} from './dto/swap-transaction.dto';
import { SwapTransactionsService } from './swap-transactions.service';
import { Prisma } from '@prisma/client';
import { JournalsService } from '../../accounting/journals/journals.service';
import { SwapQuotesService } from './swap-quotes.service';
import { OutstandingsService } from '../../clearing-settle/outstandings/outstandings.service';

export interface SwapOrchestratorOutput {
  swap_status_after: SwapTransactionStatus;
  emitted_events: string[];
  audit_log_id: string;
  transaction: any;
}

@Injectable()
export class SwapWorkflowOrchestrator {
  private readonly logger = new Logger(SwapWorkflowOrchestrator.name);

  constructor(
    private prisma: PrismaService,
    private eventEmitter: EventEmitter2,
    private swapService: SwapTransactionsService,
    private journalsService: JournalsService,
    private swapQuotesService: SwapQuotesService,
    private outstandingsService: OutstandingsService,
  ) {}

  private createAccountingContext(swap: {
    id: string;
    swapNo: string | null;
    ownerId: string;
    ownerType: string;
    fromAssetId: string;
    toAssetId: string;
    fromAmount: Prisma.Decimal;
    toAmount: Prisma.Decimal;
    exchangeRate: Prisma.Decimal;
  }) {
    return {
      src: {
        id: swap.id,
        swapNo: swap.swapNo,
        ownerId: swap.ownerId,
        ownerType: swap.ownerType,
        fromAssetId: swap.fromAssetId,
        toAssetId: swap.toAssetId,
        amount: swap.fromAmount.toString(),
        fromAmount: swap.fromAmount.toString(),
        toAmount: swap.toAmount.toString(),
        exchangeRate: swap.exchangeRate.toString(),
      },
    };
  }

  /**
   * R0. On action CREATE
   */
  async createSwap(
    dto: CreateSwapTransactionDto,
  ): Promise<SwapOrchestratorOutput> {
    const result = await this.prisma.$transaction(async (tx: any) => {
      const swapNo = dto.swapNo || generateReferenceNo('SWP');

      const fromAsset = await tx.asset.findUnique({
        where: { id: dto.fromAssetId },
      });
      const toAsset = await tx.asset.findUnique({
        where: { id: dto.toAssetId },
      });

      if (!fromAsset || !toAsset)
        throw new NotFoundException('Asset not found');
      if (fromAsset.type === 'FIAT' && toAsset.type === 'FIAT') {
        throw new BadRequestException('Fiat to Fiat swap is not supported');
      }

      const rateDetails = await this.swapService.getExecutableRate(
        fromAsset.id,
        toAsset.id,
      );
      const rate = new Prisma.Decimal(rateDetails.executableRate);
      const fromAmount = new Prisma.Decimal(dto.fromAmount);
      const toAmount = fromAmount.mul(rate);

      const balances = await this.journalsService.getCustomerLiabilityBalance(
        {
          ownerId: dto.ownerId,
          ownerType: dto.ownerType,
          assetId: dto.fromAssetId,
        },
        tx,
      );

      if (balances.availableBalance.lt(fromAmount)) {
        throw new BadRequestException({
          code: 'INSUFFICIENT_AVAILABLE_BALANCE',
          message: `Insufficient available balance for swap asset ${dto.fromAssetId}`,
        });
      }

      let ownerNo: string | null = null;
      if (dto.ownerType === 'CUSTOMER') {
        const owner = await tx.customerMain.findUnique({
          where: { id: dto.ownerId },
          select: { customerNo: true },
        });
        ownerNo = owner?.customerNo || null;
      }

      // Create Swap record
      const transaction = await tx.swapTransaction.create({
        data: {
          swapNo,
          ownerType: dto.ownerType,
          ownerId: dto.ownerId,
          ownerNo,
          status: SwapTransactionStatus.PENDING_COMPLIANCE,
          fromAssetId: dto.fromAssetId,
          fromAmount,
          toAssetId: dto.toAssetId,
          toAmount,
          exchangeRate: rate,
        },
        include: {
          fromAsset: true,
          toAsset: true,
        },
      });

      // Write audit trail
      const auditLog = await tx.swapTransactionAuditLog.create({
        data: {
          swapTransactionId: transaction.id,
          operatorId: dto.ownerId,
          oldStatus: 'NONE',
          newStatus: SwapTransactionStatus.PENDING_COMPLIANCE,
          reason: 'Initial creation',
        },
      });

      await this.journalsService.createJournal(
        {
          sourceType: 'SWAP',
          sourceId: transaction.id,
          eventCode: SwapEvents.EVT_SWAP_CREATED,
          context: this.createAccountingContext(transaction),
        },
        tx,
      );

      // Emit EVT_SWAP_CREATED (moved outside or using hook)
      // For now, we return it and the caller or a post-transaction hook handles it.
      // But in NestJS transaction, we should emit after the $transaction block resolves.

      return {
        swap_status_after: SwapTransactionStatus.PENDING_COMPLIANCE,
        emitted_events: [SwapEvents.EVT_SWAP_CREATED],
        audit_log_id: auditLog.id,
        transaction,
      };
    });

    // R0. Emit event AFTER transaction commit
    if (result.emitted_events.includes(SwapEvents.EVT_SWAP_CREATED)) {
      this.logger.log(
        `Emitting ${SwapEvents.EVT_SWAP_CREATED} for ${result.transaction.id}`,
      );
      this.eventEmitter.emit(SwapEvents.EVT_SWAP_CREATED, {
        swapId: result.transaction.id,
      });
    }

    return result;
  }

  async createSwapFromQuote(
    ownerId: string,
    quoteId: string,
  ): Promise<SwapOrchestratorOutput> {
    const now = new Date();

    const result = await this.prisma.$transaction(async (tx: any) => {
      const quote = await this.swapQuotesService.getActiveQuoteOrThrow(
        quoteId,
        'CUSTOMER',
        ownerId,
        now,
        tx,
      );

      const fromAmount = new Prisma.Decimal(quote.amountIn);
      const toAmount = new Prisma.Decimal(quote.amountOut);
      const rate = new Prisma.Decimal(quote.rateAllIn);
      const swapNo = generateReferenceNo('SWP');

      const balances = await this.journalsService.getCustomerLiabilityBalance(
        {
          ownerId,
          ownerType: 'CUSTOMER',
          assetId: quote.fromAssetId,
        },
        tx,
      );

      if (balances.availableBalance.lt(fromAmount)) {
        throw new BadRequestException({
          code: 'INSUFFICIENT_AVAILABLE_BALANCE',
          message: `Insufficient available balance for swap asset ${quote.fromAssetId}`,
        });
      }

      const transaction = await tx.swapTransaction.create({
        data: {
          swapNo,
          quoteId: quote.id,
          quoteNo: quote.quoteNo,
          ownerType: 'CUSTOMER',
          ownerId,
          ownerNo: quote.ownerNo,
          status: SwapTransactionStatus.PENDING_COMPLIANCE,
          fromAssetId: quote.fromAssetId,
          fromAmount,
          toAssetId: quote.toAssetId,
          toAmount,
          exchangeRate: rate,
        },
        include: {
          fromAsset: true,
          toAsset: true,
        },
      });

      await this.swapQuotesService.consumeQuoteForSwap(
        tx,
        quote.id,
        'CUSTOMER',
        ownerId,
        now,
      );

      const auditLog = await tx.swapTransactionAuditLog.create({
        data: {
          swapTransactionId: transaction.id,
          operatorId: ownerId,
          oldStatus: 'NONE',
          newStatus: SwapTransactionStatus.PENDING_COMPLIANCE,
          reason: `Created from quote ${quote.id}`,
        },
      });

      await this.journalsService.createJournal(
        {
          sourceType: 'SWAP',
          sourceId: transaction.id,
          eventCode: SwapEvents.EVT_SWAP_CREATED,
          context: this.createAccountingContext(transaction),
        },
        tx,
      );

      return {
        swap_status_after: SwapTransactionStatus.PENDING_COMPLIANCE,
        emitted_events: [SwapEvents.EVT_SWAP_CREATED],
        audit_log_id: auditLog.id,
        transaction,
      };
    });

    if (result.emitted_events.includes(SwapEvents.EVT_SWAP_CREATED)) {
      this.logger.log(
        `Emitting ${SwapEvents.EVT_SWAP_CREATED} for ${result.transaction.id}`,
      );
      this.eventEmitter.emit(SwapEvents.EVT_SWAP_CREATED, {
        swapId: result.transaction.id,
      });
    }

    return result;
  }

  /**
   * R1-R4. Status Transitions
   */
  async handleStatusTransition(
    id: string,
    dto: UpdateSwapTransactionStatusDto,
    operatorId: string,
  ): Promise<SwapOrchestratorOutput> {
    const { currentStatus, result } = await this.prisma.$transaction(async (tx: any) => {
      const transaction = await tx.swapTransaction.findUnique({
        where: { id },
      });
      if (!transaction)
        throw new NotFoundException('Swap transaction not found');

      const currentStatus = transaction.status as SwapTransactionStatus;
      const action = dto.action;
      const nextStatus = this.getNextStatus(currentStatus, action);

      const updateData: any = {
        status: nextStatus,
      };

      if (
        nextStatus === SwapTransactionStatus.SUCCESS ||
        nextStatus === SwapTransactionStatus.REJECTED
      ) {
        updateData.completedAt = new Date();
      }

      // 1. Update Transaction
      const updated = await tx.swapTransaction.update({
        where: { id },
        data: updateData,
        include: {
          fromAsset: true,
          toAsset: true,
        },
      });

      if (action === SwapTransactionAction.SUCCESS) {
        await this.outstandingsService.createForSwapSuccess(tx, updated);
      }

      // 2. Record Audit Log
      const auditLog = await tx.swapTransactionAuditLog.create({
        data: {
          swapTransactionId: id,
          operatorId,
          oldStatus: currentStatus,
          newStatus: nextStatus,
          reason: dto.reason || `Action: ${action}`,
        },
      });

      if (
        action === SwapTransactionAction.SUCCESS ||
        action === SwapTransactionAction.REJECT
      ) {
        await this.journalsService.triggerEvent(
          {
            entityType: 'SWAP',
            triggerKey: 'status',
            fromStatus: currentStatus,
            toStatus: nextStatus,
            assetType: 'ALL',
            context: this.createAccountingContext(updated),
            sourceId: id,
          },
          tx,
        );
      }

      // 3. Emit Events based on rules (with idempotency check, for notifications only)
      const emitted_events: string[] = [];

      const checkAndEmit = async (
        event: string,
        swapId: string,
        payload: any,
      ) => {
        const existingLog = await tx.swapTransactionAuditLog.findFirst({
          where: {
            swapTransactionId: swapId,
            newStatus: nextStatus,
            id: { not: auditLog.id },
          },
        });

        if (!existingLog) {
          // this.eventEmitter.emit(event, payload); // MOVE OUTSIDE
          emitted_events.push(event);
        } else {
          this.logger.warn(
            `[Idempotency] Event ${event} for swap ${swapId} already emitted previously. Skipping.`,
          );
        }
      };

      if (action === SwapTransactionAction.SUCCESS) {
        await checkAndEmit(SwapEvents.EVT_SWAP_SUCCESS, id, { swapId: id });
      } else if (action === SwapTransactionAction.REJECT) {
        await checkAndEmit(SwapEvents.EVT_SWAP_REJECTED, id, {
          swapId: id,
          reason: dto.reason,
        });
      }

      return {
        currentStatus,
        result: {
          swap_status_after: nextStatus,
          emitted_events,
          audit_log_id: auditLog.id,
          transaction: updated,
        }
      };
    });

    // R1-R4. Emit events AFTER transaction commit
    for (const event of result.emitted_events) {
      const payload =
        event === SwapEvents.EVT_SWAP_REJECTED
          ? { swapId: id, oldStatus: currentStatus, reason: dto.reason }
          : { swapId: id, oldStatus: currentStatus };
      this.logger.log(`Emitting ${event} for ${id}`);
      this.eventEmitter.emit(event, payload);
    }

    return result;
  }

  private getNextStatus(
    current: SwapTransactionStatus,
    action: SwapTransactionAction,
  ): SwapTransactionStatus {
    const transitions: Record<
      string,
      Partial<Record<SwapTransactionAction, SwapTransactionStatus>>
    > = {
      [SwapTransactionStatus.PENDING_COMPLIANCE]: {
        [SwapTransactionAction.SUCCESS]: SwapTransactionStatus.SUCCESS,
        [SwapTransactionAction.REJECT]: SwapTransactionStatus.REJECTED,
        [SwapTransactionAction.FLAG]: SwapTransactionStatus.UNDER_REVIEW,
      },
      [SwapTransactionStatus.UNDER_REVIEW]: {
        [SwapTransactionAction.SUCCESS]: SwapTransactionStatus.SUCCESS,
        [SwapTransactionAction.REJECT]: SwapTransactionStatus.REJECTED,
      },
    };

    const nextStatus = transitions[current]?.[action];

    if (!nextStatus) {
      throw new BadRequestException(
        `Invalid action '${action}' for status '${current}'`,
      );
    }

    return nextStatus;
  }
}
