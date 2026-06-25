import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { DomainEventNames } from '../../../common/events/domain-events.constants';
import { WithdrawEvents } from '../../trading/withdraw-transactions/constants/withdraw-events.constant';
import { FeeAccrualService } from '../domain/fee-accrual.service';

/**
 * Crypto fee-accrual listener.
 *
 * On swap / crypto-withdraw success this only ACCRUES the fee (creates the
 * ACCRUED FeeAccrual rows, idempotent). Settlement is deferred to the EOD fee
 * pass (EodSettlementWorkflowService), which nets all open crypto accruals per
 * asset into a single F_*→F_FEE transfer.
 *
 * FIAT fees are NOT handled here — FiatFeeCollectionWorkflowService accrues AND
 * immediately settles them per-order (the per-customer C_VIBAN source requires a
 * single-owner settle), so we skip non-crypto here to avoid premature accrual.
 */
@Injectable()
export class FeeAccrualListenerService {
  private readonly logger = new Logger(FeeAccrualListenerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly feeAccrual: FeeAccrualService,
  ) {}

  @OnEvent(DomainEventNames.SWAP_SUCCEEDED)
  async onSwapSucceeded(_event: { swapId: string }): Promise<void> {
    return; // neutered in Phase A (no accruals) — remove in Phase C
  }

  @OnEvent(WithdrawEvents.EVT_WITHDRAWAL_SUCCESS__CRYPTO)
  async onCryptoWithdrawalSucceeded(_event: {
    withdrawId: string;
  }): Promise<void> {
    return; // neutered in Phase A (no accruals) — remove in Phase C
  }
}
