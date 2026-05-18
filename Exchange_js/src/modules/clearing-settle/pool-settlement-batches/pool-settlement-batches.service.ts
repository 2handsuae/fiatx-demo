import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { generateReferenceNo } from '../../../common/utils/no-generator.util';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { ReimbursementObligationsService } from '../../asset-treasury/reimbursement-obligations/reimbursement-obligations.service';
import { OutstandingsService } from '../outstandings/outstandings.service';
import { ApprovalsService } from '../../governance/approvals/approvals.service';
import { ApprovalActionTypes } from '../../governance/approvals/constants/approval.constants';
import { WalletRole as WalletRoleEnum } from '../../asset-treasury/wallets/dto/wallet.dto';
import {
  CreatePoolSettlementBatchDto,
  PoolSettlementBatchQueryDto,
  PoolSettlementBatchStatus,
} from './dto/pool-settlement-batch.dto';

type TxClient = Prisma.TransactionClient;
type SourceFamily = 'OUTSTANDING' | 'REIMBURSEMENT_OBLIGATION';
type SettlementWalletRole = WalletRoleEnum;
type NetDirection = 'A_TO_B' | 'B_TO_A';

interface NormalizedSource {
  sourceFamily: SourceFamily;
  sourceId: string;
  sourceNo: string | null;
  assetId: string;
  assetCurrency: string;
  assetType: string;
  assetNetwork: string | null;
  fromWalletId: string;
  toWalletId: string;
  walletAId: string;
  walletBId: string;
  walletPairKey: string;
  direction: NetDirection;
  amount: Prisma.Decimal;
}

interface Bucket {
  assetId: string;
  walletAId: string;
  walletBId: string;
  walletPairKey: string;
  sources: NormalizedSource[];
  netAmount: Prisma.Decimal;
}

interface ScannedSource {
  sourceFamily: SourceFamily;
  sourceId: string;
}

@Injectable()
export class PoolSettlementBatchesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly approvalsService: ApprovalsService,
    private readonly outstandingsService: OutstandingsService,
    private readonly reimbursementObligationsService: ReimbursementObligationsService,
  ) {}

  private buildApprovalActorContext(actorUserId: string) {
    return {
      actorType: 'ADMIN' as const,
      userId: actorUserId,
      role: 'ADMIN',
      roleCodes: ['ADMIN'],
    };
  }

  private parseJsonField(value: unknown) {
    if (typeof value !== 'string') {
      return value ?? {};
    }

    try {
      return JSON.parse(value);
    } catch {
      return {};
    }
  }

  async findAllForAdmin(query: PoolSettlementBatchQueryDto) {
    const { skip = 0, take = 20, status, autoCreated } = query;
    const where: Prisma.PoolSettlementBatchWhereInput = {};
    if (status) where.status = status;
    if (typeof autoCreated === 'boolean') where.autoCreated = autoCreated;

    const [items, total] = await Promise.all([
      (this.prisma as any).poolSettlementBatch.findMany({
        where,
        skip: Number(skip),
        take: Number(take),
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          batchNo: true,
          status: true,
          cutoffAt: true,
          submittedAt: true,
          approvedAt: true,
          closedAt: true,
          approvalCaseId: true,
          autoCreated: true,
          createdAt: true,
          createdByUserId: true,
          summaryJson: true,
        },
      }),
      (this.prisma as any).poolSettlementBatch.count({ where }),
    ]);

    return {
      items: items.map((item: any) => ({
        ...item,
        summaryJson: this.parseJsonField(item.summaryJson),
      })),
      total,
      skip: Number(skip),
      take: Number(take),
    };
  }

  async findDetailForAdmin(id: string) {
    const batch = await (this.prisma as any).poolSettlementBatch.findUnique({
      where: { id },
      include: {
        items: {
          include: {
            asset: true,
            walletA: true,
            walletB: true,
            internalTransaction: {
              select: {
                id: true,
                internalTxNo: true,
                status: true,
              },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
        itemSources: {
          include: {
            asset: true,
            fromWallet: true,
            toWallet: true,
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!batch) {
      throw new NotFoundException('Pool settlement batch not found');
    }

    const items = (batch.items || []).map((item: any) => ({
      ...item,
      internalTransactionId: item.internalTransaction?.id ?? null,
    }));
    const itemSources = (batch.itemSources || []).map((itemSource: any) => ({
      ...itemSource,
    }));
    const internalTransactions = items
      .filter((item: any) => item.internalTransaction)
      .map((item: any) => ({
        ...item.internalTransaction,
        batchItemId: item.id,
      }));

    return {
      ...batch,
      summaryJson: this.parseJsonField(batch.summaryJson),
      metadataJson: this.parseJsonField(batch.metadataJson),
      items,
      itemSources,
      internalTransactions,
    };
  }

  private ensureRegulatorEnabledCustBankWallet(wallet: {
    walletRole?: string | null;
    walletNo?: string | null;
    regulatoryEnablementStatus?: string | null;
  }) {
    if (String(wallet.walletRole || '').trim().toUpperCase() !== WalletRoleEnum.C_CMA) {
      return;
    }

    if (
      String(wallet.regulatoryEnablementStatus || '')
        .trim()
        .toUpperCase() !== 'EFFECTIVE'
    ) {
      throw new BadRequestException(
        `C_CMA wallet ${wallet.walletNo || 'UNKNOWN'} is not regulator-enabled`,
      );
    }
  }

  private buildWalletPairKey(walletAId: string, walletBId: string) {
    return [walletAId, walletBId].sort().join('::');
  }

  private normalizeDirection(walletAId: string, walletBId: string, fromWalletId: string): NetDirection {
    return fromWalletId === walletAId ? 'A_TO_B' : 'B_TO_A';
  }

  private resolveOutstandingRoute(assetType: string, direction: string): {
    fromRole: SettlementWalletRole;
    toRole: SettlementWalletRole;
  } {
    const normalizedAssetType = String(assetType || '').trim().toUpperCase();
    const normalizedDirection = String(direction || '').trim().toUpperCase();

    if (normalizedAssetType === 'FIAT') {
      if (normalizedDirection === 'IN') {
        return { fromRole: WalletRoleEnum.F_LIQ, toRole: WalletRoleEnum.C_CMA };
      }
      if (normalizedDirection === 'OUT') {
        return { fromRole: WalletRoleEnum.C_CMA, toRole: WalletRoleEnum.F_LIQ };
      }
      throw new BadRequestException(
        `Unsupported outstanding direction ${direction} for FIAT asset`,
      );
    }

    if (normalizedAssetType === 'CRYPTO') {
      if (normalizedDirection === 'IN') {
        return { fromRole: WalletRoleEnum.F_LIQ, toRole: WalletRoleEnum.C_MAIN };
      }
      if (normalizedDirection === 'OUT') {
        return { fromRole: WalletRoleEnum.C_MAIN, toRole: WalletRoleEnum.F_LIQ };
      }
      throw new BadRequestException(
        `Unsupported outstanding direction ${direction} for CRYPTO asset`,
      );
    }

    throw new BadRequestException(
      `Unsupported asset type for outstanding routing: ${assetType}`,
    );
  }

  private resolveReimbursementRoute(assetType: string): {
    fromRole: SettlementWalletRole;
    toRole: SettlementWalletRole;
  } {
    const normalizedAssetType = String(assetType || '').trim().toUpperCase();

    if (normalizedAssetType === 'FIAT') {
      return { fromRole: WalletRoleEnum.F_LIQ, toRole: WalletRoleEnum.C_CMA };
    }

    if (normalizedAssetType === 'CRYPTO') {
      return { fromRole: WalletRoleEnum.F_LIQ, toRole: WalletRoleEnum.C_MAIN };
    }

    throw new BadRequestException(
      `Unsupported asset type for reimbursement routing: ${assetType}`,
    );
  }

  private async resolveSystemWallet(
    tx: TxClient,
    input: {
      assetId: string;
      assetCurrency: string;
      assetType: string;
      assetNetwork?: string | null;
      walletRole: SettlementWalletRole;
    },
  ) {
    const wallet = await (tx as any).wallet.findFirst({
      where: {
        walletRole: input.walletRole,
        assetId: input.assetId,
        ownerType: 'PLATFORM',
        status: 'ACTIVE',
      },
      orderBy: { createdAt: 'asc' },
    });

    if (!wallet) {
      throw new BadRequestException(
        `No ACTIVE ${input.walletRole} wallet found for asset ${input.assetCurrency}`,
      );
    }

    this.ensureRegulatorEnabledCustBankWallet(wallet);
    return wallet;
  }

  private async normalizeOutstandingSource(
    tx: TxClient,
    source: {
      id: string;
      outstandingNo?: string | null;
      direction: string;
      amount: Prisma.Decimal | string | number;
      assetId: string;
      asset: {
        id: string;
        currency: string;
        type: string;
        network?: string | null;
      };
    },
  ): Promise<NormalizedSource> {
    const route = this.resolveOutstandingRoute(source.asset.type, source.direction);
    const [fromWallet, toWallet] = await Promise.all([
      this.resolveSystemWallet(tx, {
        assetId: source.assetId,
        assetCurrency: source.asset.currency,
        assetType: source.asset.type,
        assetNetwork: source.asset.network || null,
        walletRole: route.fromRole,
      }),
      this.resolveSystemWallet(tx, {
        assetId: source.assetId,
        assetCurrency: source.asset.currency,
        assetType: source.asset.type,
        assetNetwork: source.asset.network || null,
        walletRole: route.toRole,
      }),
    ]);

    const walletAId = String(fromWallet.id) < String(toWallet.id) ? fromWallet.id : toWallet.id;
    const walletBId = String(fromWallet.id) < String(toWallet.id) ? toWallet.id : fromWallet.id;

    return {
      sourceFamily: 'OUTSTANDING',
      sourceId: source.id,
      sourceNo: source.outstandingNo || null,
      assetId: source.assetId,
      assetCurrency: source.asset.currency,
      assetType: source.asset.type,
      assetNetwork: source.asset.network || null,
      fromWalletId: fromWallet.id,
      toWalletId: toWallet.id,
      walletAId,
      walletBId,
      walletPairKey: this.buildWalletPairKey(walletAId, walletBId),
      direction: this.normalizeDirection(walletAId, walletBId, fromWallet.id),
      amount: new Prisma.Decimal(source.amount),
    };
  }

  private async normalizeReimbursementSource(
    tx: TxClient,
    source: {
      id: string;
      obligationNo?: string | null;
      amount: Prisma.Decimal | string | number;
      assetId: string;
      asset: {
        id: string;
        currency: string;
        type: string;
        network?: string | null;
      };
    },
  ): Promise<NormalizedSource> {
    const route = this.resolveReimbursementRoute(source.asset.type);
    const [fromWallet, toWallet] = await Promise.all([
      this.resolveSystemWallet(tx, {
        assetId: source.assetId,
        assetCurrency: source.asset.currency,
        assetType: source.asset.type,
        assetNetwork: source.asset.network || null,
        walletRole: route.fromRole,
      }),
      this.resolveSystemWallet(tx, {
        assetId: source.assetId,
        assetCurrency: source.asset.currency,
        assetType: source.asset.type,
        assetNetwork: source.asset.network || null,
        walletRole: route.toRole,
      }),
    ]);

    const walletAId = String(fromWallet.id) < String(toWallet.id) ? fromWallet.id : toWallet.id;
    const walletBId = String(fromWallet.id) < String(toWallet.id) ? toWallet.id : fromWallet.id;

    return {
      sourceFamily: 'REIMBURSEMENT_OBLIGATION',
      sourceId: source.id,
      sourceNo: source.obligationNo || null,
      assetId: source.assetId,
      assetCurrency: source.asset.currency,
      assetType: source.asset.type,
      assetNetwork: source.asset.network || null,
      fromWalletId: fromWallet.id,
      toWalletId: toWallet.id,
      walletAId,
      walletBId,
      walletPairKey: this.buildWalletPairKey(walletAId, walletBId),
      direction: this.normalizeDirection(walletAId, walletBId, fromWallet.id),
      amount: new Prisma.Decimal(source.amount),
    };
  }

  private bucketSources(sources: NormalizedSource[]) {
    const buckets = new Map<string, Bucket>();

    for (const source of sources) {
      const key = `${source.assetId}::${source.walletPairKey}`;
      if (!buckets.has(key)) {
        buckets.set(key, {
          assetId: source.assetId,
          walletAId: source.walletAId,
          walletBId: source.walletBId,
          walletPairKey: source.walletPairKey,
          sources: [],
          netAmount: new Prisma.Decimal(0),
        });
      }

      const bucket = buckets.get(key)!;
      bucket.sources.push(source);
      const contribution =
        source.direction === 'A_TO_B'
          ? new Prisma.Decimal(source.amount)
          : new Prisma.Decimal(source.amount).negated();
      bucket.netAmount = bucket.netAmount.plus(contribution);
    }

    return Array.from(buckets.values());
  }

  private buildSummary(input: {
    scannedSourceCount: number;
    routableSourceCount: number;
    skippedSourcesByReason: Record<string, number>;
    buckets: Bucket[];
  }) {
    const zeroNetBucketCount = input.buckets.filter((bucket) =>
      bucket.netAmount.eq(0),
    ).length;
    const zeroNetSourceCount = input.buckets
      .filter((bucket) => bucket.netAmount.eq(0))
      .reduce((sum, bucket) => sum + bucket.sources.length, 0);

    return {
      scannedSourceCount: input.scannedSourceCount,
      routableSourceCount: input.routableSourceCount,
      skippedSourceCount:
        input.scannedSourceCount - input.routableSourceCount,
      skippedSourcesByReason: input.skippedSourcesByReason,
      bucketCount: input.buckets.length,
      itemCount: input.buckets.length - zeroNetBucketCount,
      zeroNetBucketCount,
      zeroNetSourceCount,
    };
  }

  private addSkipReason(
    skippedSourcesByReason: Record<string, number>,
    reason: string,
    count = 1,
  ) {
    skippedSourcesByReason[reason] =
      (skippedSourcesByReason[reason] || 0) + count;
  }

  private async normalizeFreshLockedSources(
    tx: TxClient,
    lockedOutstandings: any[],
    lockedReimbursements: any[],
  ) {
    const normalizedSources: NormalizedSource[] = [];

    for (const source of lockedOutstandings) {
      try {
        normalizedSources.push(await this.normalizeOutstandingSource(tx, source));
      } catch (error) {
        const reason =
          error instanceof Error ? error.message : 'Unknown routing failure';
        throw new BadRequestException(
          `Locked outstanding source ${source.id} failed to normalize after lock: ${reason}`,
        );
      }
    }

    for (const source of lockedReimbursements) {
      try {
        normalizedSources.push(await this.normalizeReimbursementSource(tx, source));
      } catch (error) {
        const reason =
          error instanceof Error ? error.message : 'Unknown routing failure';
        throw new BadRequestException(
          `Locked reimbursement source ${source.id} failed to normalize after lock: ${reason}`,
        );
      }
    }

    return normalizedSources;
  }

  async createBatch(dto: CreatePoolSettlementBatchDto, operatorId: string) {
    return (this.prisma as any).$transaction(async (tx: TxClient) => {
      const [openOutstandings, openReimbursements] = await Promise.all([
        this.outstandingsService.findOpenForPoolSettlementBatch(tx),
        this.reimbursementObligationsService.findOpenForPoolSettlementBatch(tx),
      ]);

      const skippedSourcesByReason: Record<string, number> = {};
      const routableCandidates: ScannedSource[] = [];

      for (const source of openOutstandings as any[]) {
        try {
          await this.normalizeOutstandingSource(tx, source);
          routableCandidates.push({
            sourceFamily: 'OUTSTANDING',
            sourceId: source.id,
          });
        } catch (error) {
          const reason =
            error instanceof Error ? error.message : 'Unknown routing failure';
          this.addSkipReason(skippedSourcesByReason, reason);
        }
      }

      for (const source of openReimbursements as any[]) {
        try {
          await this.normalizeReimbursementSource(tx, source);
          routableCandidates.push({
            sourceFamily: 'REIMBURSEMENT_OBLIGATION',
            sourceId: source.id,
          });
        } catch (error) {
          const reason =
            error instanceof Error ? error.message : 'Unknown routing failure';
          this.addSkipReason(skippedSourcesByReason, reason);
        }
      }

      if (!routableCandidates.length) {
        throw new BadRequestException(
          'No eligible routable source found for pool settlement batch',
        );
      }

      const batch = await (tx as any).poolSettlementBatch.create({
        data: {
          batchNo: generateReferenceNo('PSB'),
          status: PoolSettlementBatchStatus.CREATED,
          cutoffAt: new Date(),
          createdByUserId: operatorId,
          autoCreated: Boolean(dto.autoCreated),
          summaryJson: JSON.stringify({}),
          metadataJson: JSON.stringify(dto.metadataJson ?? {}),
        },
      });

      await Promise.all([
        this.outstandingsService.lockForPoolSettlementBatch(
          routableCandidates
            .filter((source) => source.sourceFamily === 'OUTSTANDING')
            .map((source) => source.sourceId),
          batch.id,
          tx,
        ),
        this.reimbursementObligationsService.lockForPoolSettlementBatch(
          routableCandidates
            .filter((source) => source.sourceFamily === 'REIMBURSEMENT_OBLIGATION')
            .map((source) => source.sourceId),
          batch.id,
          tx,
        ),
      ]);

      const [lockedOutstandings, lockedReimbursements] = await Promise.all([
        this.outstandingsService.findLockedForPoolSettlementBatch(batch.id, tx),
        this.reimbursementObligationsService.findLockedForPoolSettlementBatch(
          batch.id,
          tx,
        ),
      ]);

      const lockedSourceKeys = new Set<string>();
      for (const source of lockedOutstandings as any[]) {
        lockedSourceKeys.add(`OUTSTANDING:${source.id}`);
      }
      for (const source of lockedReimbursements as any[]) {
        lockedSourceKeys.add(`REIMBURSEMENT_OBLIGATION:${source.id}`);
      }

      const lockMissCount = routableCandidates.filter(
        (source) => !lockedSourceKeys.has(`${source.sourceFamily}:${source.sourceId}`),
      ).length;
      if (lockMissCount > 0) {
        this.addSkipReason(skippedSourcesByReason, 'LOCK_MISS', lockMissCount);
      }

      const lockedSources = await this.normalizeFreshLockedSources(
        tx,
        lockedOutstandings,
        lockedReimbursements,
      );

      if (!lockedSources.length) {
        throw new BadRequestException(
          'No sources were locked for pool settlement batch',
        );
      }

      const buckets = this.bucketSources(lockedSources);
      const summary = this.buildSummary({
        scannedSourceCount: openOutstandings.length + openReimbursements.length,
        routableSourceCount: lockedSources.length,
        skippedSourcesByReason,
        buckets,
      });
      const batchWithSummary = await (tx as any).poolSettlementBatch.update({
        where: { id: batch.id },
        data: { summaryJson: JSON.stringify(summary) },
      });

      const createdItems: any[] = [];
      const createdItemSources: any[] = [];

      for (const bucket of buckets) {
        if (bucket.netAmount.eq(0)) {
          for (const source of bucket.sources) {
            const itemSource = await (tx as any).poolSettlementBatchItemSource.create(
              {
                data: {
                  batchId: batch.id,
                  batchItemId: null,
                  sourceFamily: source.sourceFamily,
                  sourceId: source.sourceId,
                  assetId: source.assetId,
                  fromWalletId: source.fromWalletId,
                  toWalletId: source.toWalletId,
                  direction: source.direction,
                  sourceAmount: new Prisma.Decimal(source.amount),
                  nettedAmount: new Prisma.Decimal(source.amount),
                  settledAmount: new Prisma.Decimal(0),
                  status: 'NETTED',
                  closeReason: 'NETTED',
                },
              },
            );
            createdItemSources.push(itemSource);
          }
          continue;
        }

        const netDirection: NetDirection = bucket.netAmount.gt(0)
          ? 'A_TO_B'
          : 'B_TO_A';
        const item = await (tx as any).poolSettlementBatchItem.create({
          data: {
            batchId: batch.id,
            status: 'READY',
            assetId: bucket.assetId,
            walletPairKey: bucket.walletPairKey,
            walletAId: bucket.walletAId,
            walletBId: bucket.walletBId,
            netDirection,
            netAmount: bucket.netAmount.abs(),
            submittedAmount: new Prisma.Decimal(0),
            settledAmount: new Prisma.Decimal(0),
          },
        });
        createdItems.push(item);

        for (const source of bucket.sources) {
          const itemSource = await (tx as any).poolSettlementBatchItemSource.create(
            {
              data: {
                batchId: batch.id,
                batchItemId: item.id,
                sourceFamily: source.sourceFamily,
                sourceId: source.sourceId,
                assetId: source.assetId,
                fromWalletId: source.fromWalletId,
                toWalletId: source.toWalletId,
                direction: source.direction,
                sourceAmount: new Prisma.Decimal(source.amount),
                nettedAmount: new Prisma.Decimal(0),
                settledAmount: new Prisma.Decimal(0),
                status: 'LINKED',
                closeReason: null,
              },
            },
          );
          createdItemSources.push(itemSource);
        }
      }

      return {
        ...batchWithSummary,
        metadataJson: dto.metadataJson ?? {},
        summary,
        items: createdItems,
        itemSources: createdItemSources,
      };
    });
  }

  async submitBatch(id: string, actorUserId: string) {
    const actor = this.buildApprovalActorContext(actorUserId);
    const transactionResult = await (this.prisma as any).$transaction(
      async (tx: TxClient) => {
        const batch = await (tx as any).poolSettlementBatch.findUniqueOrThrow({
          where: { id },
        });

        if (batch.status !== PoolSettlementBatchStatus.CREATED) {
          throw new BadRequestException('Only CREATED batch can be submitted');
        }

        const submittedAt = new Date();
        const claimResult = await (tx as any).poolSettlementBatch.updateMany({
          where: {
            id: batch.id,
            status: PoolSettlementBatchStatus.CREATED,
            approvalCaseId: null,
          },
          data: {
            status: PoolSettlementBatchStatus.APPROVAL_PENDING,
            submittedAt,
          },
        });

        if ((claimResult?.count ?? 0) !== 1) {
          const current = await (tx as any).poolSettlementBatch.findUniqueOrThrow({
            where: { id: batch.id },
          });
          throw new BadRequestException(
            `Only CREATED batch can be submitted (current status: ${current.status})`,
          );
        }

        const traceId = `POOL-SETTLEMENT:${batch.batchNo}`;
        const approval = await this.approvalsService.createAndSubmit(
          {
            actionType: ApprovalActionTypes.POOL_SETTLEMENT_BATCH_APPROVAL,
            entityRef: batch.id,
            traceId,
            workflowType: 'POOL_SETTLEMENT_BATCH',
            workflowId: batch.id,
            workflowNo: batch.batchNo,
            objectSnapshot: {
              batchId: batch.id,
              batchNo: batch.batchNo,
            },
            docRef: batch.batchNo,
          },
          {
            reason: 'Pool settlement batch submitted',
            traceId,
            workflowType: 'POOL_SETTLEMENT_BATCH',
            workflowId: batch.id,
            workflowNo: batch.batchNo,
          },
          actor,
          tx,
          { emitSideEffects: false },
        );

        const updatedBatch = await (tx as any).poolSettlementBatch.update({
          where: { id: batch.id },
          data: {
            approvalCaseId: approval.id,
          },
        });

        return {
          batch: updatedBatch,
          approvalId: approval.id,
        };
      },
    );

    await this.approvalsService.emitSubmittedSideEffects(
      transactionResult.approvalId,
      actor,
      'Pool settlement batch submitted',
    );

    return transactionResult.batch;
  }
}
