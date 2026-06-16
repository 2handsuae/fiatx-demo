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
  async onFiatWithdrawalSucceeded(event: { withdrawId: string }): Promise<void> {
    try {
      const w = await (this.prisma as any).withdrawTransaction.findUnique({
        where: { id: event.withdrawId },
        select: { asset: { select: { type: true } } },
      });
      if (!w || w.asset?.type !== 'FIAT') return;

      // INVARIANT: fiat settle is per-order (single owner), so the WITHDRAW_FEE
      // C_VIBAN per-customer source resolved inside settle() is correct.
      await this.feeAccrual.accrueForWithdraw(event.withdrawId, this.prisma);
      const accruals = await (this.prisma as any).feeAccrual.findMany({
        where: { sourceType: 'WITHDRAW', sourceId: event.withdrawId, status: 'ACCRUED' },
      });
      if (accruals.length) {
        await this.feeAccrual.settle(accruals, 'WITHDRAW_FEE', 'FIAT_WITHDRAW', this.prisma);
      }
    } catch (err) {
      this.logger.error(
        `Withdrawal fee collection failed for withdraw=${event.withdrawId}`,
        err instanceof Error ? err.stack : undefined,
      );
    }
  }
}
