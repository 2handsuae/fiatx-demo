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
  async onSwapSucceeded(event: { swapId: string }): Promise<void> {
    try {
      const swap = await (this.prisma as any).swapTransaction.findUnique({
        where: { id: event.swapId },
        select: { toAsset: { select: { type: true } } },
      });
      if (!swap) return;

      // (1) Always accrue (was: crypto-only). Crypto-side stays ACCRUED and is
      //     settled by the EOD batch pass (eod-settlement-workflow). Fiat-side
      //     additionally settles immediately below — fee batch must spawn in
      //     parallel with the principal FIAT_SETTLE_IN batch (Spec #6).
      await this.feeAccrual.accrueForSwap(event.swapId, this.prisma);

      if (swap.toAsset?.type === 'FIAT') {
        const accruals = await (this.prisma as any).feeAccrual.findMany({
          where: { sourceType: 'SWAP', sourceId: event.swapId, status: 'ACCRUED' },
        });
        if (accruals.length) {
          await this.feeAccrual.settle(accruals, 'SWAP_FEE', 'FIAT_SWAP', this.prisma);
        }
      }
    } catch (err) {
      this.logger.error(
        `Swap fee handle failed for swap=${event.swapId}`,
        err instanceof Error ? err.stack : undefined,
      );
    }
  }

  @OnEvent(WithdrawEvents.EVT_WITHDRAWAL_SUCCESS__CRYPTO)
  async onCryptoWithdrawalSucceeded(event: {
    withdrawId: string;
  }): Promise<void> {
    try {
      const w = await (this.prisma as any).withdrawTransaction.findUnique({
        where: { id: event.withdrawId },
        select: { asset: { select: { type: true } } },
      });
      if (!w || w.asset?.type !== 'CRYPTO') return;

      await this.feeAccrual.accrueForWithdraw(event.withdrawId, this.prisma);
    } catch (err) {
      this.logger.error(
        `Crypto withdrawal fee accrual failed for withdraw=${event.withdrawId}`,
        err instanceof Error ? err.stack : undefined,
      );
    }
  }
}
