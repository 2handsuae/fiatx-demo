import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../core/prisma/prisma.service';
import { InternalTransactionsService } from '../modules/asset-treasury/internal-transactions/internal-transactions.service';
import { InternalFundsService } from '../modules/asset-treasury/internal-funds/internal-funds.service';
import { DepositStatusChangedEvent } from '../modules/trading/deposit-transactions/events/deposit-transaction.events';
import { DepositTransactionStatus } from '../modules/trading/deposit-transactions/dto/deposit-transaction.dto';

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

@Injectable()
export class InternalCollectionWorkflowOrchestrator {
  private readonly logger = new Logger(InternalCollectionWorkflowOrchestrator.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly internalTransactionsService: InternalTransactionsService,
    private readonly internalFundsService: InternalFundsService,
  ) {}

  @OnEvent('deposit.status.changed')
  async onDepositStatusChanged(event: DepositStatusChangedEvent) {
    if (event.newStatus !== DepositTransactionStatus.SUCCESS) {
      return null;
    }

    const result = await this.reconcileMissingCollections({
      depositId: event.depositId,
      onlyMissing: false,
      dryRun: false,
      operatorId: 'SYSTEM',
    });

    const created = result.items.find((item) => item.action === 'CREATED');
    if (!created?.internalTransactionId || !created.internalFundId) {
      return null;
    }

    return {
      internalTransactionId: created.internalTransactionId,
      internalFundId: created.internalFundId,
    };
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

        const masterWalletNo = this.buildSystemWalletNo(
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

  private buildSystemWalletNo(
    role: 'MASTER' | 'PAYOUT' | 'LIQ',
    assetCode: string,
    network: string | null | undefined,
  ) {
    const code = this.normalizeSegment(assetCode);
    const net = this.normalizeSegment(network || 'NA');
    return `SYS_${role}_${code}_${net}`;
  }

  private normalizeSegment(value: string) {
    return value.toUpperCase().replace(/[^A-Z0-9]+/g, '_');
  }
}
