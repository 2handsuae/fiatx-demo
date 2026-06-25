import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { DomainEventNames } from '../../../common/events/domain-events.constants';
import { SettlementBatchService } from '../domain/settlement-batch.service';
import { OutstandingConsumerService } from '../domain/outstanding-consumer.service';
import { InternalTransferService } from '../domain/internal-transfer.service';
import { FundsFlowService } from '../domain/funds-flow.service';
import { SystemWalletResolver } from '../domain/system-wallet-resolver.service';
import { WhitelistGuard } from '../guards/whitelist.guard';
import {
  InternalFundAction,
  InternalFundStatus,
  UpdateInternalFundStatusDto,
} from '../dto/internal-fund.dto';
import { TransferPath } from '../constants/internal-transfer-paths.constant';
import { FiatFeeCollectionWorkflowService } from './fiat-fee-collection-workflow.service';

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
    private readonly systemWallets: SystemWalletResolver,
    private readonly whitelist: WhitelistGuard,
    private readonly feeCollection: FiatFeeCollectionWorkflowService,
  ) {}

  @OnEvent(DomainEventNames.SWAP_SUCCEEDED)
  async onSwapSucceeded(_event: SwapSucceededEvent): Promise<void> {
    // neutered in Phase A (real-time inline accounting) — remove in Phase C
    // The new swap flow (Task 10) posts TB legs directly inline.
    // This old handler created fiat outstanding batch settlement transfers.
    return;
  }

  @OnEvent(DomainEventNames.FUNDSFLOW_STATUS_CHANGED)
  async onFundsFlowStatusChanged(_event: FundsFlowStatusChangedEvent): Promise<void> {
    // neutered in Phase A (real-time inline accounting) — remove in Phase C
    // Old fiat batch settlement hop1/hop2 sequencing no longer needed.
    return;
  }
}
