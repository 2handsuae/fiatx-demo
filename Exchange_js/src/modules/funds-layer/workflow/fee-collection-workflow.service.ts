import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { DomainEventNames } from '../../../common/events/domain-events.constants';
import { AccountingService } from '../../accounting/tigerbeetle/accounting.service';
import { TB_ACCOUNT_CODES } from '../../accounting/tigerbeetle/constants/tb-account-codes.constant';
import { TB_LEDGERS } from '../../accounting/tigerbeetle/constants/tb-ledgers.constant';
import { SettlementBatchService } from '../domain/settlement-batch.service';
import { SystemWalletResolver } from '../domain/system-wallet-resolver.service';
import { bigintToDecimal } from '../accounting/tb-amount.util';
import { InternalTransferWorkflowService } from './internal-transfer-workflow.service';

const FEE_SOURCE_TYPE = 'FEE_COLLECTION';

interface FundsFlowStatusChangedEvent {
  fundsFlowId: string;
  internalTransferId: string;
  oldStatus: string;
  newStatus: string;
  operatorId?: string;
}

export interface RunFeeCollectionResult {
  batchNo: string | null;
  assetCount: number;
  collected: number;
}

interface FeeCandidate {
  assetId: string;
  currency: string;
  decimals: number;
  netBigint: bigint;
}

/**
 * V7 Phase-4 L3 fee-collection workflow.
 *
 * Drains each active crypto asset's accrued FEE_RECEIVABLE liability into Ops:
 * read the per-currency FEE_RECEIVABLE balance from TigerBeetle → for any
 * positive net, create a FEE_COLLECT settlement batch + per-asset item → spawn
 * the whitelisted FEE_COLLECT transfer (C_MAIN→F_OPS, class B; initiate triggers
 * the B-class FEE_RECEIVABLE→CUSTODY drain) via the universal transfer workflow
 * → recompute the batch rollup. When a spawned transfer's funds-flow clears
 * (fundsflow.status.changed → CLEAR), it closes the item and recomputes the
 * batch. Unlike EOD this touches no Outstanding rows.
 *
 * Layering: orchestrates domain services only; the sole direct Prisma use is the
 * asset query, the read-only idempotency `findFirst`, and the reads in the event
 * handler. All settlement writes go through domain services.
 */
@Injectable()
export class FeeCollectionWorkflowService {
  private readonly logger = new Logger(FeeCollectionWorkflowService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly accounting: AccountingService,
    private readonly batchService: SettlementBatchService,
    private readonly transferWorkflow: InternalTransferWorkflowService,
    private readonly systemWallets: SystemWalletResolver,
  ) {}

  async runFeeCollection(operatorId = 'SYSTEM'): Promise<RunFeeCollectionResult> {
    const assets = await (this.prisma as any).asset.findMany({
      where: { status: 'ACTIVE', type: 'CRYPTO' },
      select: { id: true, currency: true, decimals: true },
    });

    const candidates: FeeCandidate[] = [];
    for (const asset of assets) {
      const ledger = TB_LEDGERS[asset.currency as keyof typeof TB_LEDGERS];
      if (!ledger) {
        this.logger.debug(
          `Fee collection: no TB ledger for currency ${asset.currency} (asset=${asset.id}) — skip`,
        );
        continue;
      }

      const tbAccountId = await this.accounting.resolveTbAccountId({
        code: TB_ACCOUNT_CODES.FEE_RECEIVABLE,
        ledger,
        ownerType: 'SYSTEM',
      });
      const balance = await this.accounting.lookupBalance(tbAccountId);
      const net = balance.creditsPosted - balance.debitsPosted;
      if (net <= 0n) continue;

      candidates.push({
        assetId: asset.id,
        currency: asset.currency,
        decimals: asset.decimals,
        netBigint: net,
      });
    }

    // No accrued fees → return without creating an empty batch.
    if (candidates.length === 0) {
      this.logger.log('Fee collection: no accrued FEE_RECEIVABLE — no-op');
      return { batchNo: null, assetCount: 0, collected: 0 };
    }

    const batch = await this.batchService.createBatch({
      cutoffAt: new Date(),
      settlementType: 'FEE_COLLECT',
    });

    let collected = 0;

    for (const candidate of candidates) {
      const amount = bigintToDecimal(candidate.netBigint, candidate.decimals);

      const item = await this.batchService.createItem({
        settlementBatchId: batch.id,
        assetId: candidate.assetId,
        assetCode: candidate.currency,
        inAmount: new Prisma.Decimal(0),
        outAmount: amount,
        netAmount: amount,
        direction: 'FEE_COLLECT',
        outstandingCount: 0,
      });

      const from = await this.systemWallets.resolve(candidate.assetId, 'C_MAIN');
      const ops = await this.systemWallets.resolve(candidate.assetId, 'F_OPS');

      const sourceId = `${batch.id}:${candidate.assetId}`;
      const existing = await (this.prisma as any).internalTransaction.findFirst({
        where: { sourceType: FEE_SOURCE_TYPE, sourceId },
      });

      const transfer = existing
        ? existing
        : await this.transferWorkflow.initiate(
            {
              fromRole: 'C_MAIN',
              toRole: 'F_OPS',
              sourceType: FEE_SOURCE_TYPE,
              sourceId,
              sourceNo: batch.batchNo,
              ownerType: 'PLATFORM',
              ownerId: 'PLATFORM',
              assetId: candidate.assetId,
              amount: amount.toString(),
              fromWalletId: from.id,
              toWalletId: ops.id,
              triggerSource: 'CRON',
            },
            operatorId,
          );

      await this.batchService.linkItemTransfer(item.id, transfer.id);
      collected += 1;
    }

    await this.batchService.recomputeBatch(batch.id);

    return { batchNo: batch.batchNo, assetCount: candidates.length, collected };
  }

  @OnEvent(DomainEventNames.FUNDSFLOW_STATUS_CHANGED)
  async onFundsFlowStatusChanged(event: FundsFlowStatusChangedEvent) {
    if (!event?.internalTransferId) return;
    if (event.newStatus !== 'CLEAR') return;

    try {
      const transfer = await (this.prisma as any).internalTransaction.findUnique({
        where: { id: event.internalTransferId },
      });
      // Not one of ours — EOD / aggregation / fund-out are handled elsewhere.
      if (!transfer || transfer.sourceType !== FEE_SOURCE_TYPE) return;

      const item = await (this.prisma as any).settlementBatchItem.findFirst({
        where: { internalTransactionId: event.internalTransferId },
      });
      if (!item) {
        this.logger.warn(
          `Fee CLEAR: no settlement item for internalTransfer=${event.internalTransferId}`,
        );
        return;
      }

      // Fee collection touches no outstandings → settledCount 0.
      await this.batchService.closeItem(item.id, 0);
      await this.batchService.recomputeBatch(item.settlementBatchId);
    } catch (err) {
      this.logger.error(
        `Failed to close fee-collection item for internalTransfer=${event.internalTransferId}`,
        err instanceof Error ? err.stack : undefined,
      );
    }
  }
}
