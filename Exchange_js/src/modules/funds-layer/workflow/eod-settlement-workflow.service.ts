import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { DomainEventNames } from '../../../common/events/domain-events.constants';
import { SettlementBatchService } from '../domain/settlement-batch.service';
import { OutstandingConsumerService } from '../domain/outstanding-consumer.service';
import { SystemWalletResolver } from '../domain/system-wallet-resolver.service';
import { InternalTransferWorkflowService } from './internal-transfer-workflow.service';
import { FxEodService } from '../accounting/fx-eod.service';
import { FeeAccrualService } from '../domain/fee-accrual.service';
import { resolveEodCutoff } from './eod-cutoff.util';

const EOD_SOURCE_TYPE = 'EOD_SETTLEMENT';
const SWAP_FEE_SOURCE_TYPE = 'SWAP_FEE_SETTLEMENT';
const WITHDRAW_FEE_SOURCE_TYPE = 'WITHDRAW_FEE_SETTLEMENT';

interface FundsFlowStatusChangedEvent {
  fundsFlowId: string;
  internalTransferId: string;
  oldStatus: string;
  newStatus: string;
  operatorId?: string;
}

export interface RunEodSettlementResult {
  batchNo: string | null;
  assetCount: number;
  settledZero: number;
  spawned: number;
}

/**
 * V7 Phase-3 L3 EOD settlement workflow.
 *
 * Orchestrates the funds-layer domain services to settle the day's open crypto
 * outstandings: net per asset → create a settlement batch + per-asset items →
 * lock & link the consumed outstandings → for a non-zero net, spawn the
 * whitelisted INTERNAL_OUT/IN transfer (via the universal transfer workflow) →
 * recompute the batch rollup. When a spawned transfer's funds-flow clears
 * (fundsflow.status.changed → CLEAR), it settles the item's LOCKED outstandings,
 * closes the item, and recomputes the batch.
 *
 * Layering: orchestrates domain services only; the sole direct Prisma use is the
 * read-only idempotency `findFirst` and the `findUnique`/`findFirst` reads in the
 * event handler. All writes go through domain services.
 */
@Injectable()
export class EodSettlementWorkflowService {
  private readonly logger = new Logger(EodSettlementWorkflowService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly batchService: SettlementBatchService,
    private readonly consumer: OutstandingConsumerService,
    private readonly transferWorkflow: InternalTransferWorkflowService,
    private readonly systemWallets: SystemWalletResolver,
    private readonly fxEod: FxEodService,
    private readonly feeAccrual: FeeAccrualService,
  ) {}

  async runEodSettlement(operatorId = 'SYSTEM', cutoff?: Date): Promise<RunEodSettlementResult> {
    const cut = cutoff ?? resolveEodCutoff(new Date());
    const groups = await this.consumer.findOpenCryptoByAsset(cut);

    // No open crypto outstandings → skip the principal batch (avoids littering
    // the batch list with empty EOD runs), but STILL run the fee pass: a day can
    // accrue swap/withdraw fees with no net principal movement, and those open
    // accruals must still settle.
    if (groups.length === 0) {
      this.logger.log('EOD settlement: no open crypto outstandings — fee pass only');
      await this.runFeePass(cut);
      return { batchNo: null, assetCount: 0, settledZero: 0, spawned: 0 };
    }

    const batch = await this.batchService.createBatch({ cutoffAt: cut });

    let settledZero = 0;
    let spawned = 0;

    for (const group of groups) {
      const dir = this.batchService.resolveCryptoDirection(group.net);

      if (dir == null) {
        // net == 0：锁到 batch 后直接结清，无 transfer。
        await this.consumer.lockToBatch(group.outstandingIds, batch.id);
        await this.consumer.markSettledNettedZero(batch.id, group.assetId);
        settledZero += 1;
        continue;
      }

      const from = await this.systemWallets.resolve(group.assetId, dir.fromRole);
      const to = await this.systemWallets.resolve(group.assetId, dir.toRole);

      const sourceId = `${batch.id}:${group.assetId}`;
      const existing = await (this.prisma as any).internalTransaction.findFirst({
        where: { sourceType: EOD_SOURCE_TYPE, sourceId },
      });

      const transfer = existing
        ? existing
        : await this.transferWorkflow.initiate(
            {
              fromRole: dir.fromRole,
              toRole: dir.toRole,
              sourceType: EOD_SOURCE_TYPE,
              sourceId,
              sourceNo: batch.batchNo,
              ownerType: 'PLATFORM',
              ownerId: 'PLATFORM',
              assetId: group.assetId,
              amount: dir.amount.toString(),
              fromWalletId: from.id,
              toWalletId: to.id,
              triggerSource: 'EOD',
              settlementBatchId: batch.id,
              grossInAmount: group.inAmount.toString(),
              grossOutAmount: group.outAmount.toString(),
            },
            operatorId,
          );

      await this.consumer.lockToTransfer(
        group.outstandingIds,
        batch.id,
        transfer.id,
      );
      spawned += 1;
    }

    await this.batchService.recomputeBatch(batch.id);

    // Fee pass: net & settle the day's open crypto fee accruals (independent of
    // the principal pass — see runFeePass).
    await this.runFeePass(cut);

    // Two-book: bridge sweep + FX reval + invariant checks ride the same EOD run.
    await this.fxEod.runEodAccounting(batch.batchNo);

    return {
      batchNo: batch.batchNo,
      assetCount: groups.length,
      settledZero,
      spawned,
    };
  }

  /**
   * EOD fee pass: settle every open (ACCRUED) crypto fee accrual.
   *
   * The asset set is gathered INDEPENDENTLY of the principal pass: the principal
   * pass only iterates assets with open outstandings, but an asset can have open
   * fee accruals with zero net principal movement this EOD (e.g. swap fees on the
   * toAsset, or a day with no withdrawals). So we query the distinct crypto
   * assetIds that have ACCRUED accruals and settle each category's net for them —
   * guaranteeing ALL open crypto fee accruals close, regardless of principal flow.
   *
   * FeeAccrualService.settle() creates its own batch + net F_*→F_FEE transfer per
   * category/asset and LOCKs the consumed accruals; the LOCKED→SETTLED flip rides
   * the transfer's funds-flow CLEAR (onFundsFlowStatusChanged → settleByTransfer).
   */
  private async runFeePass(cutoff: Date): Promise<void> {
    const assetRows = await (this.prisma as any).feeAccrual.findMany({
      where: { status: 'ACCRUED', asset: { type: 'CRYPTO' }, createdAt: { lt: cutoff } },
      distinct: ['assetId'],
      select: { assetId: true },
    });

    for (const { assetId } of assetRows) {
      const swapFees = await (this.prisma as any).feeAccrual.findMany({
        where: { assetId, category: 'SWAP_FEE', status: 'ACCRUED', createdAt: { lt: cutoff } },
      });
      if (swapFees.length) {
        await this.feeAccrual.settle(swapFees, 'SWAP_FEE', 'EOD', this.prisma);
      }

      const wdFees = await (this.prisma as any).feeAccrual.findMany({
        where: { assetId, category: 'WITHDRAW_FEE', status: 'ACCRUED', createdAt: { lt: cutoff } },
      });
      if (wdFees.length) {
        await this.feeAccrual.settle(wdFees, 'WITHDRAW_FEE', 'EOD', this.prisma);
      }
    }
  }

  @OnEvent(DomainEventNames.FUNDSFLOW_STATUS_CHANGED)
  async onFundsFlowStatusChanged(event: FundsFlowStatusChangedEvent) {
    if (!event?.internalTransferId) return;
    if (event.newStatus !== 'CLEAR') return;

    try {
      const transfer = await (this.prisma as any).internalTransaction.findUnique({
        where: { id: event.internalTransferId },
      });
      if (!transfer) return;

      // Generic settlement-completion router for fund-leg CLEAR events. Route by
      // sourceType: EOD principal transfers settle crypto outstandings; fee
      // settlement transfers (swap/withdraw) flip their LOCKED fee accruals to
      // SETTLED. Anything else is not settlement-bearing — the universal transfer
      // workflow handles its own audits.
      if (transfer.sourceType === EOD_SOURCE_TYPE) {
        if (!transfer.settlementBatchId) return;

        // 找到该 transfer 锁定的 outstanding，标 SETTLED，再重算 batch。
        await this.consumer.settle(event.internalTransferId, event.fundsFlowId);
        await this.batchService.recomputeBatch(transfer.settlementBatchId);

        // Two-book: the bridge only becomes sweepable once async CLEARs mark
        // swaps fully settled — re-run EOD accounting under the same batchNo
        // (idempotent). Never let an accounting failure break the settlement
        // closeout that just completed above.
        try {
          const batch = await (this.prisma as any).settlementBatch.findUnique({
            where: { id: transfer.settlementBatchId },
            select: { batchNo: true },
          });
          if (batch?.batchNo) {
            await this.fxEod.runEodAccounting(batch.batchNo);
          }
        } catch (accountingErr) {
          this.logger.error(
            `EOD accounting failed after CLEAR for batch=${transfer.settlementBatchId}`,
            accountingErr instanceof Error ? accountingErr.stack : undefined,
          );
        }
      } else if (
        transfer.sourceType === SWAP_FEE_SOURCE_TYPE ||
        transfer.sourceType === WITHDRAW_FEE_SOURCE_TYPE
      ) {
        // Fee accruals LOCKED to this transfer settle-on-CLEAR (LOCKED→SETTLED).
        await this.feeAccrual.settleByTransfer(
          event.internalTransferId,
          event.fundsFlowId,
          this.prisma,
        );
      }
      // else: not a settlement-bearing transfer → ignore.
    } catch (err) {
      this.logger.error(
        `Failed to settle EOD item for internalTransfer=${event.internalTransferId}`,
        err instanceof Error ? err.stack : undefined,
      );
    }
  }
}
