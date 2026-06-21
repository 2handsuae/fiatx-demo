import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { generateReferenceNo } from '../../../common/utils/no-generator.util';
import { InternalTransferService } from './internal-transfer.service';
import { FundsFlowService } from './funds-flow.service';
import { SystemWalletResolver } from './system-wallet-resolver.service';
import { SettlementBatchService } from './settlement-batch.service';
import {
  TransferPath,
  TRANSFER_PATH_WHITELIST,
} from '../constants/internal-transfer-paths.constant';
import { SettlementType } from '../constants/settlement-type.constant';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import {
  AuditActions,
  AuditEntityTypes,
} from '../../audit-logging/constants/audit-actions.constant';

type Tx = Prisma.TransactionClient | PrismaService;

interface AccrualInput {
  sourceType: string;
  sourceId: string;
  sourceNo?: string | null;
  ownerType: string;
  ownerId: string;
  ownerNo?: string | null;
  feeKind: string;
  category: string;
  assetId: string;
  assetCode?: string | null;
  amount: Prisma.Decimal;
  originTraceId?: string | null;
}

@Injectable()
export class FeeAccrualService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transfers: InternalTransferService,
    private readonly fundsFlow: FundsFlowService,
    private readonly systemWallets: SystemWalletResolver,
    private readonly batchService: SettlementBatchService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  private async createAccrual(tx: Tx, d: AccrualInput) {
    const findExisting = () =>
      (tx as any).feeAccrual.findUnique({
        where: {
          sourceType_sourceId_feeKind: {
            sourceType: d.sourceType,
            sourceId: d.sourceId,
            feeKind: d.feeKind,
          },
        },
      });

    const existing = await findExisting();
    if (existing) return existing; // idempotent: no audit on pre-existing row

    // feeAccrualNo comes from a low-entropy generator (4-digit random/day), so
    // rapid batches can collide on its @unique. On P2002: if the (sourceType,
    // sourceId, feeKind) row now exists it's an idempotent race → return it;
    // otherwise the clash was on feeAccrualNo → regenerate a fresh number + retry.
    for (let attempt = 0; ; attempt++) {
      try {
        const created = await (tx as any).feeAccrual.create({
          data: {
            feeAccrualNo: generateReferenceNo('FAC'),
            ...d,
            status: 'ACCRUED',
          },
        });

        // Audit only on actual create (NOT for raced-existing returned below).
        await this.auditLogsService.recordSystem({
          action: AuditActions.CREATED,
          entityType: AuditEntityTypes.FEE_ACCRUAL,
          entityId: created.id,
          entityNo: created.feeAccrualNo,
          workflowType: 'SWAP',
          reason: `${d.feeKind} accrual for ${d.sourceType}/${d.sourceNo ?? d.sourceId}`,
          sourcePlatform: 'SYSTEM',
          traceId: d.originTraceId ?? undefined,
        });

        return created;
      } catch (e: any) {
        if (e?.code !== 'P2002') throw e;
        const raced = await findExisting();
        if (raced) return raced; // lost the race, no audit
        if (attempt >= 8) throw e;
      }
    }
  }

  async accrueForSwap(swapId: string, tx: Tx = this.prisma) {
    const swap = await (tx as any).swapTransaction.findUnique({
      where: { id: swapId },
      select: {
        id: true,
        swapNo: true,
        traceId: true,
        ownerType: true,
        ownerId: true,
        ownerNo: true,
        toAssetId: true,
        feeAmount: true,
        spreadAmount: true,
        toAsset: { select: { code: true } },
      },
    });
    if (!swap) return;

    const base = {
      sourceType: 'SWAP',
      sourceId: swap.id,
      sourceNo: swap.swapNo,
      ownerType: swap.ownerType,
      ownerId: swap.ownerId,
      ownerNo: swap.ownerNo,
      category: 'SWAP_FEE',
      assetId: swap.toAssetId,
      assetCode: swap.toAsset?.code,
      originTraceId: swap.traceId ?? null,
    };

    const fee = new Prisma.Decimal(swap.feeAmount ?? 0);
    if (fee.gt(0)) {
      await this.createAccrual(tx, { ...base, feeKind: 'SERVICE_FEE', amount: fee });
    }

    const spread = new Prisma.Decimal(swap.spreadAmount ?? 0);
    if (spread.gt(0)) {
      await this.createAccrual(tx, { ...base, feeKind: 'SPREAD', amount: spread });
    }
  }

  async accrueForWithdraw(withdrawId: string, tx: Tx = this.prisma) {
    const withdraw = await (tx as any).withdrawTransaction.findUnique({
      where: { id: withdrawId },
      select: {
        id: true,
        withdrawNo: true,
        traceId: true,
        ownerType: true,
        ownerId: true,
        ownerNo: true,
        assetId: true,
        feeAmount: true,
        asset: { select: { code: true } },
      },
    });
    if (!withdraw) return;

    const fee = new Prisma.Decimal(withdraw.feeAmount ?? 0);
    if (fee.gt(0)) {
      await this.createAccrual(tx, {
        sourceType: 'WITHDRAW',
        sourceId: withdraw.id,
        sourceNo: withdraw.withdrawNo,
        ownerType: withdraw.ownerType,
        ownerId: withdraw.ownerId,
        ownerNo: withdraw.ownerNo,
        feeKind: 'WITHDRAW_FEE',
        category: 'WITHDRAW_FEE',
        assetId: withdraw.assetId,
        assetCode: withdraw.asset?.code,
        amount: fee,
        originTraceId: withdraw.traceId ?? null,
      });
    }
  }

  /**
   * Settle a set of same-category accruals: group by asset, net each group into a
   * single policy-driven F_*→F_FEE transfer, then LOCK the group's accruals.
   *
   * INVARIANT: fiat WITHDRAW_FEE sources the per-customer C_VIBAN, so a fiat-withdraw
   * settle MUST be called per-order (single owner) — the immediate-settle path
   * guarantees this. Crypto sources (F_OPS for SWAP_FEE, C_MAIN for WITHDRAW_FEE) and
   * SWAP_FEE are platform-level, so netting many owners into one transfer is correct.
   */
  async settle(
    accruals: any[],
    category: string,
    settlementType: SettlementType,
    tx: Tx,
  ): Promise<void> {
    const groups = new Map<string, any[]>();
    for (const a of accruals) {
      const list = groups.get(a.assetId) ?? [];
      list.push(a);
      groups.set(a.assetId, list);
    }

    for (const [assetId, group] of groups) {
      const amount = group.reduce(
        (sum, a) => sum.add(new Prisma.Decimal(a.amount)),
        new Prisma.Decimal(0),
      );
      if (amount.lte(0)) continue;

      const asset = await (tx as any).asset.findUnique({
        where: { id: assetId },
        select: { type: true },
      });
      const isCrypto = asset?.type === 'CRYPTO';

      let pathEnum: TransferPath;
      let fromRole: string;
      if (category === 'SWAP_FEE') {
        pathEnum = isCrypto
          ? TransferPath.CRYPTO_SWAP_FEE_COLLECT
          : TransferPath.FIAT_SWAP_FEE_COLLECT;
        fromRole = 'F_OPS';
      } else {
        pathEnum = isCrypto
          ? TransferPath.CRYPTO_WITHDRAW_FEE_COLLECT
          : TransferPath.FIAT_WITHDRAW_FEE_COLLECT;
        fromRole = isCrypto ? 'C_MAIN' : 'C_VIBAN';
      }

      const policy = TRANSFER_PATH_WHITELIST[pathEnum];

      const to = await this.systemWallets.resolve(assetId, 'F_FEE');
      const from =
        fromRole === 'C_VIBAN'
          ? await this.systemWallets.resolveCustomer(
              assetId,
              'C_VIBAN',
              group[0].ownerId,
            )
          : await this.systemWallets.resolve(assetId, fromRole);

      const batch = await this.batchService.createBatch({
        cutoffAt: new Date(),
        settlementType,
        category,
      });

      const transfer = await this.transfers.createTransfer({
        path: policy.path,
        accountingClass: policy.class,
        medium: policy.medium,
        triggerSource: settlementType,
        sourceType:
          category === 'SWAP_FEE'
            ? 'SWAP_FEE_SETTLEMENT'
            : 'WITHDRAW_FEE_SETTLEMENT',
        sourceId: `${batch.id}:${assetId}`,
        sourceNo: batch.batchNo,
        ownerType: group[0].ownerType,
        ownerId: group[0].ownerId,
        ownerNo: group[0].ownerNo,
        assetId,
        amount,
        feeAmount: new Prisma.Decimal(0),
        netAmount: amount,
        fromWalletId: from.id,
        toWalletId: to.id,
        settlementBatchId: batch.id,
      });

      await this.fundsFlow.createLeg({
        internalTransactionId: transfer.id,
        fromWalletId: from.id,
        toWalletId: to.id,
        amount,
      });

      await (tx as any).feeAccrual.updateMany({
        where: { id: { in: group.map((a) => a.id) } },
        data: {
          status: 'LOCKED',
          settledByTransferId: transfer.id,
          settlementBatchId: batch.id,
          lockedAt: new Date(),
        },
      });

      // Emit FEE_ACCRUAL.LOCKED per accrual, traceId=batch.traceId (settlement
      // root), metadata carries originTraceId so downstream recon can stitch
      // back to the originating swap/withdraw chain.
      for (const accrual of group) {
        await this.auditLogsService.recordSystem({
          action: AuditActions.LOCKED,
          entityType: AuditEntityTypes.FEE_ACCRUAL,
          entityId: accrual.id,
          entityNo: accrual.feeAccrualNo,
          workflowType: 'SETTLEMENT',
          reason: `Locked to transfer ${transfer.id} via batch ${batch.batchNo}`,
          sourcePlatform: 'SYSTEM',
          traceId: batch.traceId,
          metadata: JSON.stringify({ originTraceId: accrual.originTraceId ?? null }) as any,
        });
      }

      // Spec #7: settle 类方法内紧跟 recomputeBatch、同 tx 同步执行、不依赖 caller。
      await this.batchService.recomputeBatch(batch.id, tx);
    }
  }

  /**
   * Flip a transfer's LOCKED accruals to SETTLED when its fund leg reaches CLEAR.
   * Mirrors OutstandingConsumerService.settle: the second CLEAR sees count 0 and
   * is a no-op, so it is safe as an idempotency latch.
   */
  async settleByTransfer(
    settledByTransferId: string,
    internalFundId: string,
    tx: Tx,
  ): Promise<{ count: number }> {
    // Capture LOCKED rows BEFORE flipping so per-row audit has originTraceId
    // + settlementBatchId for traceId lookup. updateMany only returns a count,
    // so we cannot rely on it for the audit payload.
    const rows = await (tx as any).feeAccrual.findMany({
      where: { settledByTransferId, status: 'LOCKED' },
      select: { id: true, feeAccrualNo: true, originTraceId: true, settlementBatchId: true },
    });

    const result = await (tx as any).feeAccrual.updateMany({
      where: { settledByTransferId, status: 'LOCKED' },
      data: {
        status: 'SETTLED',
        closedByInternalFundId: internalFundId,
        closedAt: new Date(),
      },
    });

    // Treatment-of-root-cause: fee-accrual advances accrual state; the batch
    // tied to this transfer must be re-aggregated so its status/counters
    // reflect the new SETTLED accruals (otherwise SWAP_FEE batches stay
    // stuck at CREATED forever — observed live). Matches the convention used
    // by the other 6 workflow recomputeBatch call sites.
    const transfer = await (tx as any).internalTransaction.findUnique({
      where: { id: settledByTransferId },
      select: { settlementBatchId: true },
    });
    if (transfer?.settlementBatchId) {
      await this.batchService.recomputeBatch(transfer.settlementBatchId, tx as any);
    }

    // Emit FEE_ACCRUAL.SETTLED per row, traceId=batch.traceId (settlement root),
    // metadata carries originTraceId. Resolve batch traceIds in one findMany.
    if (rows.length > 0) {
      const batchIds = [
        ...new Set(rows.map((r: any) => r.settlementBatchId).filter(Boolean)),
      ] as string[];
      const batches =
        batchIds.length > 0
          ? await (tx as any).settlementBatch.findMany({
              where: { id: { in: batchIds } },
              select: { id: true, traceId: true },
            })
          : [];
      const batchMap = new Map<string, string>(
        batches.map((b: any) => [b.id, b.traceId]),
      );

      for (const row of rows) {
        await this.auditLogsService.recordSystem({
          action: AuditActions.SETTLED,
          entityType: AuditEntityTypes.FEE_ACCRUAL,
          entityId: row.id,
          entityNo: row.feeAccrualNo,
          workflowType: 'SETTLEMENT',
          reason: `Settled by transfer ${settledByTransferId} / fund ${internalFundId}`,
          sourcePlatform: 'SYSTEM',
          traceId: row.settlementBatchId
            ? batchMap.get(row.settlementBatchId)
            : undefined,
          metadata: JSON.stringify({ originTraceId: row.originTraceId ?? null }) as any,
        });
      }
    }

    return result;
  }

  /**
   * Unified fee-collection traceability for an order (keyed on sourceNo).
   * Works for both rails: returns whether every accrual on the order is SETTLED,
   * plus the settling transfer/batch number for each fee component.
   */
  async getFeeCollectionStatus(orderNo: string) {
    const rows = await (this.prisma as any).feeAccrual.findMany({
      where: { sourceNo: orderNo },
      include: {
        settledByTransfer: { select: { internalTxNo: true } },
        settlementBatch: { select: { batchNo: true } },
      },
    });
    return {
      collected: rows.length > 0 && rows.every((r: any) => r.status === 'SETTLED'),
      items: rows.map((r: any) => ({
        feeKind: r.feeKind,
        category: r.category,
        status: r.status,
        settledByTransferNo: r.settledByTransfer?.internalTxNo ?? null,
        settlementBatchNo: r.settlementBatch?.batchNo ?? null,
      })),
    };
  }

  async findAllForAdmin(query: any) {
    const where: any = {};
    if (query.feeAccrualNo) where.feeAccrualNo = { contains: query.feeAccrualNo };
    if (query.sourceNo) where.sourceNo = { contains: query.sourceNo };
    if (query.ownerNo) where.ownerNo = { contains: query.ownerNo };
    if (query.status) where.status = query.status;
    if (query.category) where.category = query.category;
    if (query.feeKind) where.feeKind = query.feeKind;
    if (query.assetCode) where.assetCode = query.assetCode;
    if (query.q) where.feeAccrualNo = { startsWith: query.q };
    if (query.startDate || query.endDate) {
      where.createdAt = {};
      if (query.startDate) where.createdAt.gte = new Date(query.startDate);
      if (query.endDate) where.createdAt.lte = new Date(query.endDate);
    }
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const [items, total] = await Promise.all([
      (this.prisma as any).feeAccrual.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          settlementBatch: { select: { id: true, batchNo: true } },
          settledByTransfer: { select: { id: true, internalTxNo: true } },
        },
      }),
      (this.prisma as any).feeAccrual.count({ where }),
    ]);
    return { items, total };
  }

  async findOneForAdmin(id: string) {
    const row = await (this.prisma as any).feeAccrual.findUnique({
      where: { id },
      include: {
        settlementBatch: { select: { id: true, batchNo: true } },
        settledByTransfer: { select: { id: true, internalTxNo: true } },
        closedByInternalFund: { select: { id: true, internalFundNo: true } },
      },
    });
    if (!row) return null;
    const siblings = await (this.prisma as any).feeAccrual.findMany({
      where: {
        sourceType: row.sourceType,
        sourceId: row.sourceId,
        NOT: { id: row.id },
      },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        feeAccrualNo: true,
        feeKind: true,
        amount: true,
        assetCode: true,
        status: true,
        createdAt: true,
      },
    });
    return { ...row, siblings };
  }
}
