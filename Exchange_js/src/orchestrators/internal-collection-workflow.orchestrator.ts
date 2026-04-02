import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../core/prisma/prisma.service';
import { InternalTransactionsService } from '../modules/asset-treasury/internal-transactions/internal-transactions.service';
import { InternalFundsService } from '../modules/asset-treasury/internal-funds/internal-funds.service';
import { InternalFundStatus } from '../modules/asset-treasury/internal-funds/dto/internal-fund.dto';
import { buildCryptoSystemWalletNo } from '../modules/asset-treasury/wallets/system-wallet.util';
import { WalletsService } from '../modules/asset-treasury/wallets/wallets.service';
import { DepositStatusChangedEvent } from '../modules/trading/deposit-transactions/events/deposit-transaction.events';
import { DepositTransactionStatus } from '../modules/trading/deposit-transactions/dto/deposit-transaction.dto';
import {
  InternalTransactionApprovalStatus,
  InternalTransactionStatus,
  InternalTransactionType,
  TreasuryTransferInitiationMode,
  TreasuryTransferPurpose,
} from '../modules/asset-treasury/internal-transactions/dto/internal-transaction.dto';

export type InternalCollectionReconcileAction =
  | 'CREATED'
  | 'WOULD_CREATE'
  | 'IDEMPOTENT'
  | 'SKIPPED'
  | 'FAILED';

export interface InternalCollectionReconcileItem {
  depositId: string;
  depositNo: string;
  action: InternalCollectionReconcileAction;
  reason?: string;
  internalTransactionId?: string;
  internalFundId?: string;
}

export interface ReconcileMissingCollectionsParams {
  depositId?: string;
  depositNo?: string;
  onlyMissing?: boolean;
  dryRun?: boolean;
  operatorId?: string;
}

export interface ReconcileMissingCollectionsResult {
  scanned: number;
  created: number;
  idempotent: number;
  skipped: number;
  failed: number;
  items: InternalCollectionReconcileItem[];
}

export interface CollectionWalletSummaryItem {
  walletId: string;
  walletNo: string | null;
  assetId: string;
  assetCode: string;
  assetNetwork: string | null;
  ownerType: string;
  ownerId: string | null;
  ownerNo: string | null;
  ownerName: string | null;
  availableBalance: string;
  collectionAmountThreshold: string | null;
  collectionMaxAgeMinutes: number | null;
  earliestEligibleDepositAt: string | null;
  eligibleDepositAgeMinutes: number | null;
  shouldCollect: boolean;
  latestCollectionSummary: {
    internalTransactionId: string;
    internalTxNo: string;
    status: string;
    createdAt: string;
    completedAt: string | null;
  } | null;
}

export interface CollectionWalletQueryParams {
  skip?: number;
  take?: number;
  assetId?: string;
}

export interface ReconcileCollectionWalletParams {
  walletId: string;
  dryRun?: boolean;
  operatorId?: string;
}

export interface ReconcileCollectionWalletResult {
  walletId: string;
  walletNo: string | null;
  action: InternalCollectionReconcileAction;
  reason?: string;
  internalTransactionId?: string;
  internalFundId?: string;
  existingPendingAmount?: string;
  expectedCollectionAmount?: string;
  availableBalance: string;
  shouldCollect: boolean;
  collectionAmountThreshold: string | null;
  collectionMaxAgeMinutes: number | null;
}

@Injectable()
export class InternalCollectionWorkflowOrchestrator {
  private readonly logger = new Logger(InternalCollectionWorkflowOrchestrator.name);
  private static readonly RETRYABLE_ATTEMPTS = 3;
  private static readonly RETRYABLE_DELAY_MS = 250;

  constructor(
    private readonly prisma: PrismaService,
    private readonly internalTransactionsService: InternalTransactionsService,
    private readonly internalFundsService: InternalFundsService,
    private readonly walletsService: WalletsService,
  ) {}

  async onDepositStatusChanged(event: DepositStatusChangedEvent) {
    this.logger.debug(
      `Automatic internal collection trigger disabled for deposit ${event.depositId} transition ${event.oldStatus} -> ${event.newStatus}`,
    );
    return null;
  }

  private static readonly INTERNAL_TX_TERMINAL_STATUSES = [
    InternalTransactionStatus.SUCCESS,
    InternalTransactionStatus.FAILED,
    InternalTransactionStatus.CANCELLED,
    InternalTransactionStatus.REJECTED,
    InternalTransactionStatus.EXPIRED,
  ] as const;

  private parseDecimal(value: Prisma.Decimal.Value | null | undefined) {
    return new Prisma.Decimal(value ?? 0);
  }

  private isReusableWalletDrivenPendingCollection(
    pendingCollection: {
      sourceType?: string | null;
      amount?: Prisma.Decimal.Value | null;
    } | null,
    expectedAmount: Prisma.Decimal,
  ) {
    if (!pendingCollection) {
      return false;
    }

    const sourceType = String(pendingCollection.sourceType || '').trim().toUpperCase();
    if (sourceType !== 'DEPOSIT_WALLET') {
      return false;
    }

    return this.parseDecimal(pendingCollection.amount).equals(expectedAmount);
  }

  private buildPoolOwner(wallet: {
    ownerType?: string | null;
    ownerId?: string | null;
    ownerNo?: string | null;
  }) {
    const ownerType = String(wallet.ownerType || '').trim().toUpperCase() || 'CUSTOMER';
    const ownerId = wallet.ownerId || wallet.ownerNo || `${ownerType}_POOL`;
    const ownerNo = wallet.ownerNo || ownerId;
    return { ownerType, ownerId, ownerNo };
  }

  private async evaluateCollectionWallet(walletId: string) {
    const wallet = await this.walletsService.findOne(walletId);
    if (!wallet) {
      return null;
    }

    const availableBalance = this.parseDecimal(wallet.availableBalance);
    const [policy, pendingCollection, latestCollection, latestSuccessfulCollection, deposits] = await Promise.all([
      this.prisma.safeguardingPolicy.findUnique({
        where: {
          assetId_poolRole: {
            assetId: wallet.assetId,
            poolRole: 'DEPOSIT',
          },
        },
      }),
      this.prisma.internalTransaction.findFirst({
        where: {
          purpose: TreasuryTransferPurpose.DEPOSIT_COLLECTION,
          fromWalletId: wallet.id,
          status: {
            notIn: [...InternalCollectionWorkflowOrchestrator.INTERNAL_TX_TERMINAL_STATUSES],
          },
        },
        include: {
          funds: {
            select: {
              id: true,
            },
            take: 1,
            orderBy: { createdAt: 'asc' },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.internalTransaction.findFirst({
        where: {
          purpose: TreasuryTransferPurpose.DEPOSIT_COLLECTION,
          fromWalletId: wallet.id,
        },
        orderBy: [{ createdAt: 'desc' }],
      }),
      this.prisma.internalTransaction.findFirst({
        where: {
          purpose: TreasuryTransferPurpose.DEPOSIT_COLLECTION,
          fromWalletId: wallet.id,
          status: InternalTransactionStatus.SUCCESS,
        },
        orderBy: [{ completedAt: 'desc' }, { updatedAt: 'desc' }, { createdAt: 'desc' }],
      }),
      this.prisma.depositTransaction.findMany({
        where: {
          toWalletId: wallet.id,
          status: DepositTransactionStatus.SUCCESS,
        },
        select: {
          id: true,
          depositNo: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    const latestSuccessfulCollectionAt = latestSuccessfulCollection
      ? latestSuccessfulCollection.completedAt ||
        latestSuccessfulCollection.updatedAt ||
        latestSuccessfulCollection.createdAt
      : null;

    const earliestEligibleDeposit =
      deposits.find((deposit) =>
        latestSuccessfulCollectionAt
          ? deposit.createdAt > latestSuccessfulCollectionAt
          : true,
      ) || null;

    const eligibleDepositAgeMinutes = earliestEligibleDeposit
      ? Math.max(
          0,
          Math.floor((Date.now() - earliestEligibleDeposit.createdAt.getTime()) / 60000),
        )
      : null;

    const collectionAmountThreshold = policy?.collectionAmountThreshold
      ? new Prisma.Decimal(policy.collectionAmountThreshold)
      : null;
    const collectionMaxAgeMinutes = policy?.collectionMaxAgeMinutes ?? null;

    const overAmount =
      !!collectionAmountThreshold &&
      availableBalance.gt(0) &&
      availableBalance.gte(collectionAmountThreshold);
    const overAge =
      !!collectionMaxAgeMinutes &&
      !!eligibleDepositAgeMinutes &&
      availableBalance.gt(0) &&
      eligibleDepositAgeMinutes >= collectionMaxAgeMinutes;
    const shouldCollect = overAmount || overAge;

    return {
      wallet,
      availableBalance,
      pendingCollection,
      latestCollection,
      collectionAmountThreshold,
      collectionMaxAgeMinutes,
      earliestEligibleDeposit,
      eligibleDepositAgeMinutes,
      shouldCollect,
    };
  }

  async listCollectionWallets(
    params: CollectionWalletQueryParams = {},
  ): Promise<{ items: CollectionWalletSummaryItem[]; total: number }> {
    const page = await this.walletsService.findAll({
      skip: params.skip ?? 0,
      take: params.take ?? 20,
      where: {
        walletRole: 'DEPOSIT',
        status: 'ACTIVE',
        ...(params.assetId ? { assetId: params.assetId } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });

    const evaluations = await Promise.all(
      (page.items || []).map(async (wallet: any) => {
        const details = await this.evaluateCollectionWallet(wallet.id);
        if (!details) return null;
        return {
          walletId: wallet.id,
          walletNo: wallet.walletNo ?? null,
          assetId: wallet.assetId,
          assetCode: wallet.asset?.code || '',
          assetNetwork: wallet.asset?.network || null,
          ownerType: wallet.ownerType,
          ownerId: wallet.ownerId ?? null,
          ownerNo: wallet.ownerNo ?? null,
          ownerName: wallet.ownerName ?? null,
          availableBalance: details.availableBalance.toString(),
          collectionAmountThreshold: details.collectionAmountThreshold
            ? details.collectionAmountThreshold.toString()
            : null,
          collectionMaxAgeMinutes: details.collectionMaxAgeMinutes,
          earliestEligibleDepositAt: details.earliestEligibleDeposit
            ? details.earliestEligibleDeposit.createdAt.toISOString()
            : null,
          eligibleDepositAgeMinutes: details.eligibleDepositAgeMinutes,
          shouldCollect: details.shouldCollect,
          latestCollectionSummary: details.latestCollection
            ? {
                internalTransactionId: details.latestCollection.id,
                internalTxNo: details.latestCollection.internalTxNo,
                status: details.latestCollection.status,
                createdAt: details.latestCollection.createdAt.toISOString(),
                completedAt: details.latestCollection.completedAt
                  ? details.latestCollection.completedAt.toISOString()
                  : null,
              }
            : null,
        } satisfies CollectionWalletSummaryItem;
      }),
    );

    return {
      items: evaluations.filter(Boolean) as CollectionWalletSummaryItem[],
      total: page.total,
    };
  }

  async reconcileCollectionWallet(
    params: ReconcileCollectionWalletParams,
  ): Promise<ReconcileCollectionWalletResult> {
    const { walletId, dryRun = false, operatorId = 'SYSTEM' } = params;
    const details = await this.evaluateCollectionWallet(walletId);

    if (!details) {
      return {
        walletId,
        walletNo: null,
        action: 'FAILED',
        reason: 'Wallet not found',
        availableBalance: '0',
        shouldCollect: false,
        collectionAmountThreshold: null,
        collectionMaxAgeMinutes: null,
      };
    }

    const { wallet, availableBalance, pendingCollection } = details;
    const baseResult = {
      walletId: wallet.id,
      walletNo: wallet.walletNo ?? null,
      availableBalance: availableBalance.toString(),
      shouldCollect: details.shouldCollect,
      collectionAmountThreshold: details.collectionAmountThreshold
        ? details.collectionAmountThreshold.toString()
        : null,
      collectionMaxAgeMinutes: details.collectionMaxAgeMinutes,
    };

    if (String(wallet.walletRole || '').trim().toUpperCase() !== 'DEPOSIT') {
      return {
        ...baseResult,
        action: 'SKIPPED',
        reason: `walletRole ${wallet.walletRole || 'UNKNOWN'} is not DEPOSIT`,
      };
    }

    if (String(wallet.asset?.type || '').trim().toUpperCase() !== 'CRYPTO') {
      return {
        ...baseResult,
        action: 'SKIPPED',
        reason: `asset type ${wallet.asset?.type || 'UNKNOWN'} is not CRYPTO`,
      };
    }

    if (pendingCollection) {
      const existingFund = pendingCollection.funds?.[0];
      const expectedAmount = availableBalance.toString();
      const existingPendingAmount = this.parseDecimal(pendingCollection.amount).toString();

      if (!this.isReusableWalletDrivenPendingCollection(pendingCollection, availableBalance)) {
        return {
          ...baseResult,
          action: 'FAILED',
          reason:
            `Pending collection amount mismatch: existing ${existingPendingAmount}, expected ${expectedAmount}. ` +
            'Resolve or cancel the existing collection before creating a new wallet-driven collection.',
          internalTransactionId: pendingCollection.id,
          internalFundId: existingFund?.id,
          existingPendingAmount,
          expectedCollectionAmount: expectedAmount,
        };
      }

      return {
        ...baseResult,
        action: 'IDEMPOTENT',
        reason: 'Pending collection already exists for this deposit wallet',
        internalTransactionId: pendingCollection.id,
        internalFundId: existingFund?.id,
        existingPendingAmount,
        expectedCollectionAmount: expectedAmount,
      };
    }

    if (availableBalance.lte(0)) {
      return {
        ...baseResult,
        action: 'SKIPPED',
        reason: 'Wallet available balance is zero',
      };
    }

    if (!details.shouldCollect) {
      return {
        ...baseResult,
        action: 'SKIPPED',
        reason: 'Collection thresholds are not met yet',
      };
    }

    const masterWalletNo = buildCryptoSystemWalletNo(
      'MASTER',
      wallet.asset.code,
      wallet.asset.network,
    );
    const masterWallet = await (this.prisma as any).wallet.findFirst({
      where: {
        walletNo: masterWalletNo,
        ownerType: 'CUSTOMER',
        ownerId: null,
        assetId: wallet.assetId,
        status: 'ACTIVE',
      },
    });

    if (!masterWallet) {
      return {
        ...baseResult,
        action: 'FAILED',
        reason: `Master wallet ${masterWalletNo} not found`,
      };
    }

    if (dryRun) {
      return {
        ...baseResult,
        action: 'WOULD_CREATE',
        reason: 'Dry run',
      };
    }

    const created = await (this.prisma as any).$transaction(async (tx: any) => {
      const owner = this.buildPoolOwner(wallet);
      const referenceNo = `COLL-${wallet.walletNo || wallet.id}`;
      const internalTx = await this.internalTransactionsService.createStandaloneTransaction(
        {
          type: InternalTransactionType.DEP_TO_MASTER,
          purpose: TreasuryTransferPurpose.DEPOSIT_COLLECTION,
          initiationMode: TreasuryTransferInitiationMode.AUTOMATED,
          sourceType: 'DEPOSIT_WALLET',
          sourceId: `${wallet.id}:${Date.now()}`,
          sourceNo: wallet.walletNo ?? wallet.id,
          ownerType: owner.ownerType,
          ownerId: owner.ownerId,
          ownerNo: owner.ownerNo,
          assetId: wallet.assetId,
          amount: availableBalance,
          feeAmount: new Prisma.Decimal(0),
          netAmount: availableBalance,
          fromWalletId: wallet.id,
          fromAddress: wallet.address ?? null,
          fromIban: wallet.iban ?? null,
          toWalletId: masterWallet.id,
          toAddress: masterWallet.address ?? null,
          toIban: masterWallet.iban ?? null,
          referenceNo,
          approvalStatus: InternalTransactionApprovalStatus.APPROVED,
          status: InternalTransactionStatus.INTERNAL_FUNDS_PENDING,
        },
        operatorId,
        tx,
      );

      const internalFund = await this.internalFundsService.createFromInternalTransaction(
        {
          internalTransactionId: internalTx.id,
          status: InternalFundStatus.CREATED,
          referenceNo,
        },
        operatorId,
        tx,
      );

      return { internalTx, internalFund };
    });

    return {
      ...baseResult,
      action: 'CREATED',
      internalTransactionId: created.internalTx.id,
      internalFundId: created.internalFund.id,
    };
  }

  private isRetryableInsufficientBalanceError(reason?: string): boolean {
    if (!reason) return false;
    const text = reason.toLowerCase();
    return (
      text.includes('insufficient available balance') ||
      text.includes('insufficient_wallet_balance')
    );
  }

  private async sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  async reconcileMissingCollections(
    params: ReconcileMissingCollectionsParams = {},
  ): Promise<ReconcileMissingCollectionsResult> {
    const {
      depositId,
      depositNo,
      onlyMissing = true,
      dryRun = false,
      operatorId = 'SYSTEM',
    } = params;

    const where: any = {
      status: DepositTransactionStatus.SUCCESS,
    };
    if (depositId) where.id = depositId;
    if (depositNo) where.depositNo = depositNo;
    if (!depositId && !depositNo) {
      where.asset = {
        type: 'CRYPTO',
      };
    }

    const deposits = await (this.prisma as any).depositTransaction.findMany({
      where,
      include: {
        asset: true,
        wallet: true,
        customer: {
          select: {
            customerNo: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    const result: ReconcileMissingCollectionsResult = {
      scanned: deposits.length,
      created: 0,
      idempotent: 0,
      skipped: 0,
      failed: 0,
      items: [],
    };

    for (const deposit of deposits) {
      if (deposit.asset?.type !== 'CRYPTO') {
        result.skipped += 1;
        result.items.push({
          depositId: deposit.id,
          depositNo: deposit.depositNo,
          action: 'SKIPPED',
          reason: `Asset type ${deposit.asset?.type || 'UNKNOWN'} is not CRYPTO`,
        });
        this.logger.debug(
          `Skip internal collection for deposit ${deposit.depositNo}: non-CRYPTO asset`,
        );
        continue;
      }

      const idempotencyKey = {
        sourceType_sourceId_type: {
          sourceType: 'DEPOSIT',
          sourceId: deposit.id,
          type: 'DEP_TO_MASTER',
        },
      };

      try {
        const existingTx = await (this.prisma as any).internalTransaction.findUnique({
          where: idempotencyKey,
        });
        const existingFund = existingTx
          ? await (this.prisma as any).internalFund.findFirst({
              where: { internalTransactionId: existingTx.id },
              select: { id: true },
            })
          : null;

        if (onlyMissing && existingTx) {
          result.idempotent += 1;
          result.items.push({
            depositId: deposit.id,
            depositNo: deposit.depositNo,
            action: 'IDEMPOTENT',
            reason: 'Internal transaction already exists',
            internalTransactionId: existingTx.id,
            internalFundId: existingFund?.id,
          });
          this.logger.debug(
            `Internal collection idempotent hit for deposit ${deposit.depositNo}: internalTx already exists`,
          );
          continue;
        }

        const masterWalletNo = buildCryptoSystemWalletNo(
          'MASTER',
          deposit.asset.code,
          deposit.asset.network,
        );
        const masterWallet = await (this.prisma as any).wallet.findFirst({
          where: {
            walletNo: masterWalletNo,
            ownerType: 'CUSTOMER',
            ownerId: null,
            assetId: deposit.assetId,
          },
        });

        if (!masterWallet) {
          result.skipped += 1;
          result.items.push({
            depositId: deposit.id,
            depositNo: deposit.depositNo,
            action: 'SKIPPED',
            reason: `Master wallet ${masterWalletNo} not found`,
          });
          this.logger.warn(
            `Skip internal collection for deposit ${deposit.depositNo}: master wallet ${masterWalletNo} not found`,
          );
          continue;
        }

        if (dryRun) {
          if (existingTx && existingFund) {
            result.idempotent += 1;
            result.items.push({
              depositId: deposit.id,
              depositNo: deposit.depositNo,
              action: 'IDEMPOTENT',
              reason: 'Internal transaction and fund already exist',
              internalTransactionId: existingTx.id,
              internalFundId: existingFund.id,
            });
            this.logger.debug(
              `Internal collection idempotent hit for deposit ${deposit.depositNo}`,
            );
          } else {
            result.created += 1;
            result.items.push({
              depositId: deposit.id,
              depositNo: deposit.depositNo,
              action: 'WOULD_CREATE',
              reason: 'Dry run',
              internalTransactionId: existingTx?.id,
            });
            this.logger.log(
              `Internal collection dry-run candidate: deposit=${deposit.depositNo}`,
            );
          }
          continue;
        }

        const created = await (this.prisma as any).$transaction(async (tx: any) => {
          const internalTx = await this.internalTransactionsService.createFromDepositSuccess(
            {
              deposit: {
                id: deposit.id,
                depositNo: deposit.depositNo,
                ownerType: deposit.ownerType,
                ownerId: deposit.ownerId,
                ownerNo: deposit.customer?.customerNo ?? null,
                assetId: deposit.assetId,
                amount: deposit.amount,
                netAmount: deposit.netAmount,
                feeAmount: deposit.feeAmount,
                toWalletId: deposit.toWalletId,
                toAddress: deposit.toAddress,
                toIban: deposit.toIban,
              },
              masterWallet: {
                id: masterWallet.id,
                address: masterWallet.address,
                iban: masterWallet.iban,
              },
            },
            operatorId,
            tx,
          );

          const internalFund = await this.internalFundsService.createFromInternalTransaction(
            {
              internalTransactionId: internalTx.id,
            },
            operatorId,
            tx,
          );

          return {
            internalTx,
            internalFund,
          };
        });

        const action: InternalCollectionReconcileAction =
          existingTx && existingFund ? 'IDEMPOTENT' : 'CREATED';

        if (action === 'IDEMPOTENT') {
          result.idempotent += 1;
          this.logger.debug(
            `Internal collection idempotent hit for deposit ${deposit.depositNo}`,
          );
        } else {
          result.created += 1;
          this.logger.log(
            `Internal collection created for deposit ${deposit.depositNo}: tx=${created.internalTx.id}, fund=${created.internalFund.id}`,
          );
        }

        result.items.push({
          depositId: deposit.id,
          depositNo: deposit.depositNo,
          action,
          internalTransactionId: created.internalTx.id,
          internalFundId: created.internalFund.id,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        result.failed += 1;
        result.items.push({
          depositId: deposit.id,
          depositNo: deposit.depositNo,
          action: 'FAILED',
          reason: message,
        });
        this.logger.error(
          `Internal collection failed for deposit ${deposit.depositNo}: ${message}`,
        );
      }
    }

    return result;
  }
}
