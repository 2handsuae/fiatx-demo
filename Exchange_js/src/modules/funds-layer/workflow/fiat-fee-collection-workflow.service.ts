import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { WithdrawEvents } from '../../trading/withdraw-transactions/constants/withdraw-events.constant';
import { FeeAccrualService } from '../domain/fee-accrual.service';

@Injectable()
export class FiatFeeCollectionWorkflowService {
  private readonly logger = new Logger(FiatFeeCollectionWorkflowService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly feeAccrual: FeeAccrualService,
  ) {}

  @OnEvent(WithdrawEvents.EVT_WITHDRAWAL_SUCCESS__FIAT)
  async onFiatWithdrawalSucceeded(_event: { withdrawId: string }): Promise<void> {
    // neutered in Phase A (real-time inline accounting) — remove in Phase C
    // The new withdraw flow (Task 9) posts WITHDRAW_FEE_FIRM directly to TB inline.
    // This old handler created orphan FeeAccrual rows + old-model settlement transfers.
    return;
  }
}
