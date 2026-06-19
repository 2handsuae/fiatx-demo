import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import {
  AuditActions,
  AuditEntityTypes,
} from '../../audit-logging/constants/audit-actions.constant';
import { SettlementBatchService } from './settlement-batch.service';

type TxClient = Prisma.TransactionClient;

export interface CryptoOutstandingGroup {
  assetId: string;
  assetCode: string | null;
  decimals: number;
  inAmount: Prisma.Decimal;
  outAmount: Prisma.Decimal;
  net: Prisma.Decimal;
  outstandingIds: string[];
}

/**
 * V7 Phase-3 L1 domain service over the `outstandings` table, scoped to the
 * EOD settlement consumer flow (group → lock → link → settle). Owns its data
 * ops; write methods accept an optional `tx`. No business audit, no events.
 */
@Injectable()
export class OutstandingConsumerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly batchService: SettlementBatchService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  /**
   * All OPEN crypto outstandings not yet attached to a batch, grouped by asset.
   * net = Σ(IN) − Σ(OUT); positive means net inflow owed into the customer
   * pool, negative means net outflow to be funded from liquidity.
   */
  async findOpenCryptoByAsset(cutoff: Date): Promise<CryptoOutstandingGroup[]> {
    const rows = await (this.prisma as any).outstanding.findMany({
      where: {
        status: 'OPEN',
        asset: { type: 'CRYPTO' },
        settlementBatchId: null,
        createdAt: { lt: cutoff },
      },
      select: {
        id: true,
        direction: true,
        amount: true,
        assetId: true,
        assetCode: true,
        asset: { select: { currency: true, decimals: true } },
      },
    });

    const groups = new Map<string, CryptoOutstandingGroup>();
    for (const row of rows) {
      let group = groups.get(row.assetId);
      if (!group) {
        group = {
          assetId: row.assetId,
          assetCode: row.assetCode ?? null,
          decimals: row.asset?.decimals ?? 0,
          inAmount: new Prisma.Decimal(0),
          outAmount: new Prisma.Decimal(0),
          net: new Prisma.Decimal(0),
          outstandingIds: [],
        };
        groups.set(row.assetId, group);
      }

      const amount = new Prisma.Decimal(row.amount ?? 0);
      if (row.direction === 'IN') {
        group.inAmount = group.inAmount.plus(amount);
      } else if (row.direction === 'OUT') {
        group.outAmount = group.outAmount.plus(amount);
      }
      group.outstandingIds.push(row.id);
    }

    for (const group of groups.values()) {
      group.net = group.inAmount.minus(group.outAmount);
    }

    return Array.from(groups.values());
  }

  async lockToTransfer(
    outstandingIds: string[],
    settlementBatchId: string,
    settledByTransferId: string,
    tx?: TxClient,
  ): Promise<{ count: number }> {
    const client = (tx ?? this.prisma) as any;

    // Capture rows that WILL be locked (status='OPEN' before update) so we can
    // audit one event per affected outstanding with its originTraceId.
    const rows = await client.outstanding.findMany({
      where: { id: { in: outstandingIds }, status: 'OPEN' },
      select: { id: true, outstandingNo: true, originTraceId: true },
    });

    const result = await client.outstanding.updateMany({
      where: { id: { in: outstandingIds }, status: 'OPEN' },
      data: {
        status: 'LOCKED',
        settlementBatchId,
        settledByTransferId,
        lockedAt: new Date(),
      },
    });

    if (rows.length > 0) {
      const batch = await client.settlementBatch.findUnique({
        where: { id: settlementBatchId },
        select: { traceId: true },
      });
      for (const row of rows) {
        await this.auditLogsService.recordSystem({
          action: AuditActions.LOCKED,
          entityType: AuditEntityTypes.OUTSTANDING,
          entityId: row.id,
          entityNo: row.outstandingNo,
          workflowType: 'SETTLEMENT',
          reason: `Locked to transfer ${settledByTransferId}`,
          sourcePlatform: 'SYSTEM',
          traceId: batch?.traceId ?? undefined,
          metadata: JSON.stringify({
            originTraceId: row.originTraceId ?? null,
          }) as any,
        });
      }
    }

    return result;
  }

  async lockToBatch(
    outstandingIds: string[],
    settlementBatchId: string,
    tx?: TxClient,
  ): Promise<{ count: number }> {
    const client = (tx ?? this.prisma) as any;
    return client.outstanding.updateMany({
      where: { id: { in: outstandingIds }, status: 'OPEN' },
      data: { status: 'LOCKED', settlementBatchId, lockedAt: new Date() },
    });
  }

  async settle(
    settledByTransferId: string,
    internalFundId: string,
    tx?: TxClient,
  ): Promise<{ count: number }> {
    const client = (tx ?? this.prisma) as any;

    // Capture rows that WILL be settled (currently LOCKED) for per-row audit.
    const rows = await client.outstanding.findMany({
      where: { settledByTransferId, status: 'LOCKED' },
      select: {
        id: true,
        outstandingNo: true,
        originTraceId: true,
        settlementBatchId: true,
      },
    });

    const result = await client.outstanding.updateMany({
      where: { settledByTransferId, status: 'LOCKED' },
      data: {
        status: 'SETTLED',
        closedByInternalFundId: internalFundId,
        closedAt: new Date(),
      },
    });

    if (rows.length > 0) {
      const batchIds = Array.from(
        new Set(
          rows
            .map((r: any) => r.settlementBatchId)
            .filter((id: string | null): id is string => Boolean(id)),
        ),
      );
      const batches = batchIds.length
        ? await client.settlementBatch.findMany({
            where: { id: { in: batchIds } },
            select: { id: true, traceId: true },
          })
        : [];
      const batchMap = new Map<string, string | null>(
        batches.map((b: any) => [b.id, b.traceId]),
      );

      for (const row of rows) {
        const batchTraceId = row.settlementBatchId
          ? batchMap.get(row.settlementBatchId)
          : null;
        await this.auditLogsService.recordSystem({
          action: AuditActions.SETTLED,
          entityType: AuditEntityTypes.OUTSTANDING,
          entityId: row.id,
          entityNo: row.outstandingNo,
          workflowType: 'SETTLEMENT',
          reason: `Settled by transfer ${settledByTransferId} / fund ${internalFundId}`,
          sourcePlatform: 'SYSTEM',
          traceId: batchTraceId ?? undefined,
          metadata: JSON.stringify({
            originTraceId: row.originTraceId ?? null,
          }) as any,
        });
      }
    }

    // Spec #7: settle 末尾紧跟 recomputeBatch、同 tx、按 distinct batchId 调一次。
    if (rows.length > 0) {
      const batchIdsForRecompute: string[] = Array.from(
        new Set<string>(
          rows
            .map((r: any) => r.settlementBatchId)
            .filter((id: string | null): id is string => Boolean(id)),
        ),
      );
      for (const batchId of batchIdsForRecompute) {
        await this.batchService.recomputeBatch(batchId, client);
      }
    }

    return result;
  }

  async markSettledNettedZero(
    settlementBatchId: string,
    assetId: string,
    tx?: TxClient,
  ): Promise<{ count: number }> {
    const client = (tx ?? this.prisma) as any;

    // Capture rows that WILL be settled (LOCKED, no transfer — netted zero) for per-row audit.
    const rows = await client.outstanding.findMany({
      where: {
        settlementBatchId,
        assetId,
        settledByTransferId: null,
        status: 'LOCKED',
      },
      select: { id: true, outstandingNo: true, originTraceId: true },
    });

    const result = await client.outstanding.updateMany({
      where: {
        settlementBatchId,
        assetId,
        settledByTransferId: null,
        status: 'LOCKED',
      },
      data: { status: 'SETTLED', closedAt: new Date() },
    });

    if (rows.length > 0) {
      const batch = await client.settlementBatch.findUnique({
        where: { id: settlementBatchId },
        select: { traceId: true },
      });
      for (const row of rows) {
        await this.auditLogsService.recordSystem({
          action: AuditActions.SETTLED,
          entityType: AuditEntityTypes.OUTSTANDING,
          entityId: row.id,
          entityNo: row.outstandingNo,
          workflowType: 'SETTLEMENT',
          reason: `Settled (netted-zero) in batch ${settlementBatchId} asset ${assetId}`,
          sourcePlatform: 'SYSTEM',
          traceId: batch?.traceId ?? undefined,
          metadata: JSON.stringify({
            originTraceId: row.originTraceId ?? null,
          }) as any,
        });
      }
    }

    // Spec #7: markSettledNettedZero 末尾紧跟 recomputeBatch、同 tx。
    if (rows.length > 0) {
      await this.batchService.recomputeBatch(settlementBatchId, client);
    }

    return result;
  }

  /** OPEN, FIAT, not-yet-batched outstandings produced by a single swap. */
  async findOpenFiatBySwap(swapTransactionId: string) {
    return (this.prisma as any).outstanding.findMany({
      where: {
        swapTransactionId,
        status: 'OPEN',
        settlementBatchId: null,
        asset: { type: 'FIAT' },
      },
      select: {
        id: true,
        direction: true,
        amount: true,
        assetId: true,
        assetCode: true,
        ownerId: true,
        ownerType: true,
        ownerNo: true,
        sourceNo: true,
      },
    });
  }
}
