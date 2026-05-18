import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { generateReferenceNo } from '../../../common/utils/no-generator.util';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { InternalFundsService } from '../../asset-treasury/internal-funds/internal-funds.service';
import { InternalFundStatus } from '../../asset-treasury/internal-funds/dto/internal-fund.dto';
import { InternalTransactionsService } from '../../asset-treasury/internal-transactions/internal-transactions.service';
import {
  InternalTransactionStatus,
  InternalTransactionType,
} from '../../asset-treasury/internal-transactions/dto/internal-transaction.dto';
import { WalletRole } from '../../asset-treasury/wallets/dto/wallet.dto';
import {
  CreateOutstandingSettlementDto,
  OutstandingSettlementItemStatus,
  OutstandingSettlementQueryDto,
  OutstandingSettlementStatus,
} from './dto/outstanding-settlement.dto';

type TxClient = Prisma.TransactionClient;

type InternalFundStatusChangedEvent = {
  internalFundId: string;
  internalTransactionId?: string;
  oldStatus: string;
  newStatus: string;
  operatorId?: string;
};

type GroupedOutstandingBucket = {
  asset: {
    id: string;
    currency: string;
    network?: string | null;
    type: string;
  };
  rows: Array<{
    id: string;
    direction: string;
    amount: Prisma.Decimal;
  }>;
};

@Injectable()
export class OutstandingSettlementsService {
  private readonly logger = new Logger(OutstandingSettlementsService.name);
  private static readonly MAX_NO_GENERATION_RETRIES = 10;
  private static readonly FUND_FAIL_TERMINAL_STATUSES = new Set<string>([
    InternalFundStatus.FAILED,
    InternalFundStatus.TIMEOUT,
    InternalFundStatus.RETURNED,
    InternalFundStatus.CANCELLED,
  ]);

  constructor(
    private readonly prisma: PrismaService,
    private readonly internalTransactionsService: InternalTransactionsService,
    private readonly internalFundsService: InternalFundsService,
  ) {}

  private ensureRegulatorEnabledCustBankWallet(wallet: {
    walletRole?: string | null;
    walletNo?: string | null;
    regulatoryEnablementStatus?: string | null;
  }) {
    if (String(wallet.walletRole || '').trim().toUpperCase() !== WalletRole.C_CMA) {
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

  private normalizeSourceType(value?: string | null) {
    const normalized = String(value || 'SWAP')
      .trim()
      .toUpperCase();
    if (normalized !== 'SWAP') {
      throw new BadRequestException(
        `Unsupported sourceType=${normalized}, only SWAP is supported`,
      );
    }
    return normalized;
  }

  private parseOptionalDate(raw: string | undefined, field: string) {
    if (!raw) return null;
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException(`${field} must be a valid ISO date string`);
    }
    return date;
  }

  private isSettlementNoUniqueConflict(error: unknown): boolean {
    const maybe = error as {
      code?: string;
      meta?: { target?: string[] | string };
    };
    if (maybe?.code !== 'P2002') return false;
    const target = maybe.meta?.target;
    if (Array.isArray(target)) return target.includes('settlementNo');
    if (typeof target === 'string') return target.includes('settlementNo');
    return false;
  }

  private isRequestIdUniqueConflict(error: unknown): boolean {
    const maybe = error as {
      code?: string;
      meta?: { target?: string[] | string };
    };
    if (maybe?.code !== 'P2002') return false;
    const target = maybe.meta?.target;
    if (Array.isArray(target)) return target.includes('requestId');
    if (typeof target === 'string') return target.includes('requestId');
    return false;
  }

  private async createSettlementWithUniqueNo(
    client: TxClient,
    input: {
      sourceType: string;
      rangeStartAt?: Date | null;
      cutoffAt: Date;
      requestId?: string | null;
      makerUserId?: string | null;
      note?: string | null;
    },
  ) {
    for (
      let attempt = 1;
      attempt <= OutstandingSettlementsService.MAX_NO_GENERATION_RETRIES;
      attempt += 1
    ) {
      try {
        return await (client as any).outstandingSettlement.create({
          data: {
            settlementNo: generateReferenceNo('OSB'),
            sourceType: input.sourceType,
            rangeStartAt: input.rangeStartAt ?? null,
            cutoffAt: input.cutoffAt,
            status: OutstandingSettlementStatus.CREATED,
            requestId: input.requestId ?? null,
            makerUserId: input.makerUserId ?? null,
            note: input.note ?? null,
          },
        });
      } catch (error) {
        if (this.isSettlementNoUniqueConflict(error)) {
          continue;
        }
        throw error;
      }
    }

    throw new InternalServerErrorException(
      `Failed to generate unique settlementNo after ${OutstandingSettlementsService.MAX_NO_GENERATION_RETRIES} attempts`,
    );
  }

  private groupByAsset(rows: any[]): GroupedOutstandingBucket[] {
    const grouped = new Map<string, GroupedOutstandingBucket>();
    for (const row of rows) {
      const assetId = String(row.assetId);
      if (!grouped.has(assetId)) {
        grouped.set(assetId, {
          asset: {
            id: row.asset.id,
            currency: row.asset.currency,
            network: row.asset.network,
            type: row.asset.type,
          },
          rows: [],
        });
      }
      const bucket = grouped.get(assetId)!;
      bucket.rows.push({
        id: row.id,
        direction: String(row.direction || ''),
        amount: new Prisma.Decimal(row.amount || 0),
      });
    }
    return Array.from(grouped.values());
  }

  private resolveExecutionDirection(
    assetType: string,
    netAmount: Prisma.Decimal,
  ): {
    internalType: InternalTransactionType;
    fromRole: WalletRole;
    toRole: WalletRole;
    amount: Prisma.Decimal;
  } {
    const normalizedAssetType = String(assetType || '').toUpperCase();

    if (normalizedAssetType === 'FIAT') {
      if (netAmount.gt(0)) {
        return {
          internalType: InternalTransactionType.LIQ_BANK_TO_CLIENT_BANK,
          fromRole: WalletRole.F_LIQ,
          toRole: WalletRole.C_CMA,
          amount: new Prisma.Decimal(netAmount),
        };
      }

      return {
        internalType: InternalTransactionType.CLIENT_BANK_TO_LIQ_BANK,
        fromRole: WalletRole.C_CMA,
        toRole: WalletRole.F_LIQ,
        amount: new Prisma.Decimal(netAmount.abs()),
      };
    }

    if (normalizedAssetType === 'CRYPTO') {
      if (netAmount.gt(0)) {
        return {
          internalType: InternalTransactionType.LIQ_TO_MASTER,
          fromRole: WalletRole.F_LIQ,
          toRole: WalletRole.C_MAIN,
          amount: new Prisma.Decimal(netAmount),
        };
      }

      return {
        internalType: InternalTransactionType.MASTER_TO_LIQ,
        fromRole: WalletRole.C_MAIN,
        toRole: WalletRole.F_LIQ,
        amount: new Prisma.Decimal(netAmount.abs()),
      };
    }

    throw new BadRequestException(
      `Unsupported asset type for settlement execution: ${assetType}`,
    );
  }

  private async resolveSystemWallet(
    client: TxClient,
    input: {
      assetId: string;
      assetCurrency: string;
      assetType: string;
      assetNetwork?: string | null;
      walletRole: WalletRole;
    },
  ) {
    const wallet = await (client as any).wallet.findFirst({
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

  private deriveSettlementStatus(itemStatuses: string[]) {
    if (!itemStatuses.length) return OutstandingSettlementStatus.SUCCESS;

    const allClosed = itemStatuses.every((status) =>
      [
        OutstandingSettlementItemStatus.CLOSED,
        OutstandingSettlementItemStatus.NETTED,
      ].includes(status as OutstandingSettlementItemStatus),
    );

    if (allClosed) return OutstandingSettlementStatus.SUCCESS;

    const hasProcessing = itemStatuses.includes(
      OutstandingSettlementItemStatus.PROCESSING,
    );
    const hasFailed = itemStatuses.includes(OutstandingSettlementItemStatus.FAILED);
    if (hasFailed && !hasProcessing) return OutstandingSettlementStatus.FAILED;

    return OutstandingSettlementStatus.PROCESSING;
  }

  private async findOneWithClient(client: TxClient, id: string) {
    const settlement = await (client as any).outstandingSettlement.findUnique({
      where: { id },
      include: {
        items: {
          orderBy: { createdAt: 'asc' },
          include: {
            asset: {
              select: {
                id: true,
                currency: true,
                type: true,
                network: true,
                decimals: true,
              },
            },
            internalTransaction: {
              select: {
                id: true,
                internalTxNo: true,
                type: true,
                status: true,
                approvalStatus: true,
                amount: true,
                feeAmount: true,
                netAmount: true,
                createdAt: true,
                completedAt: true,
                funds: {
                  select: {
                    id: true,
                    internalFundNo: true,
                    status: true,
                    amount: true,
                    createdAt: true,
                    completedAt: true,
                  },
                  orderBy: { createdAt: 'asc' },
                },
              },
            },
          },
        },
      },
    });

    if (!settlement) {
      throw new NotFoundException('Outstanding settlement not found');
    }

    const [openCount, lockedCount, closedCount] = await Promise.all([
      (client as any).outstanding.count({
        where: { settlementId: id, status: 'OPEN' },
      }),
      (client as any).outstanding.count({
        where: { settlementId: id, status: 'LOCKED' },
      }),
      (client as any).outstanding.count({
        where: { settlementId: id, status: 'CLOSED' },
      }),
    ]);

    return {
      ...settlement,
      outstandingSnapshot: {
        open: openCount,
        locked: lockedCount,
        closed: closedCount,
      },
    };
  }

  private async recomputeSettlementFromItems(
    client: TxClient,
    settlementId: string,
  ) {
    const items = await (client as any).outstandingSettlementItem.findMany({
      where: { settlementId },
      select: {
        status: true,
        closedOutstandingCount: true,
      },
    });

    const totalAssetCount = items.length;
    const closedAssetCount = items.filter((item: any) =>
      [
        OutstandingSettlementItemStatus.CLOSED,
        OutstandingSettlementItemStatus.NETTED,
      ].includes(item.status as OutstandingSettlementItemStatus),
    ).length;

    const closedOutstandingCount = items.reduce(
      (sum: number, item: any) => sum + Number(item.closedOutstandingCount || 0),
      0,
    );
    const status = this.deriveSettlementStatus(items.map((item: any) => item.status));

    await (client as any).outstandingSettlement.update({
      where: { id: settlementId },
      data: {
        status,
        totalAssetCount,
        closedAssetCount,
        closedOutstandingCount,
        completedAt:
          status === OutstandingSettlementStatus.SUCCESS ||
          status === OutstandingSettlementStatus.FAILED
            ? new Date()
            : null,
      },
    });
  }

  private isFundTerminalStatus(status: string) {
    return (
      status === InternalFundStatus.CLEAR ||
      OutstandingSettlementsService.FUND_FAIL_TERMINAL_STATUSES.has(status)
    );
  }

  private async applyFundTerminalToItem(
    client: TxClient,
    item: any,
    fund: { id: string; status: string },
    operatorId: string,
  ) {
    if (fund.status === InternalFundStatus.CLEAR) {
      await (client as any).outstanding.updateMany({
        where: {
          settlementItemId: item.id,
          status: 'LOCKED',
        },
        data: {
          status: 'CLOSED',
          closedAt: new Date(),
          closedByInternalFundId: fund.id,
        },
      });

      const closedCount = await (client as any).outstanding.count({
        where: {
          settlementItemId: item.id,
          status: 'CLOSED',
        },
      });

      await (client as any).outstandingSettlementItem.update({
        where: { id: item.id },
        data: {
          status: OutstandingSettlementItemStatus.CLOSED,
          closedOutstandingCount: Number(closedCount || 0),
          closedAt: new Date(),
        },
      });

      this.logger.log(
        `Settlement item ${item.id} closed by fund ${fund.id} (operator=${operatorId})`,
      );
      return;
    }

    if (
      OutstandingSettlementsService.FUND_FAIL_TERMINAL_STATUSES.has(fund.status) &&
      item.status === OutstandingSettlementItemStatus.PROCESSING
    ) {
      await (client as any).outstanding.updateMany({
        where: {
          settlementItemId: item.id,
          status: 'LOCKED',
        },
        data: {
          status: 'OPEN',
          settlementId: null,
          settlementItemId: null,
          lockedAt: null,
          closedAt: null,
          closedByInternalFundId: null,
        },
      });

      await (client as any).outstandingSettlementItem.update({
        where: { id: item.id },
        data: {
          status: OutstandingSettlementItemStatus.FAILED,
          closedOutstandingCount: 0,
          closedAt: null,
        },
      });

      this.logger.warn(
        `Settlement item ${item.id} marked FAILED due to fund ${fund.id} status=${fund.status} (operator=${operatorId})`,
      );
    }
  }

  @OnEvent('internal-fund.status.changed')
  async handleInternalFundStatusChanged(event: InternalFundStatusChangedEvent) {
    if (!event?.internalFundId) return;
    if (!this.isFundTerminalStatus(String(event.newStatus || ''))) return;

    try {
      await (this.prisma as any).$transaction(async (client: TxClient) => {
        const fund = await (client as any).internalFund.findUnique({
          where: { id: event.internalFundId },
          select: {
            id: true,
            status: true,
            internalTransactionId: true,
          },
        });
        if (!fund) return;

        const item = await (client as any).outstandingSettlementItem.findFirst({
          where: {
            internalTransactionId: fund.internalTransactionId,
          },
          select: {
            id: true,
            status: true,
            settlementId: true,
          },
        });
        if (!item) return;

        await this.applyFundTerminalToItem(
          client,
          item,
          fund,
          event.operatorId || 'SYSTEM',
        );
        await this.recomputeSettlementFromItems(client, item.settlementId);
      });
    } catch (error) {
      this.logger.error(
        `Failed to handle internal-fund.status.changed for fund=${event.internalFundId}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  async createManual(dto: CreateOutstandingSettlementDto, operatorId = 'SYSTEM') {
    const sourceType = this.normalizeSourceType(dto.sourceType);
    const rangeStartAt = this.parseOptionalDate(dto.rangeStartAt, 'rangeStartAt');
    const requestId = dto.requestId?.trim() || null;
    const note = dto.note?.trim() || null;
    const cutoffAt = new Date();

    if (rangeStartAt && rangeStartAt.getTime() > cutoffAt.getTime()) {
      throw new BadRequestException('rangeStartAt must be earlier than cutoffAt');
    }

    if (requestId) {
      const existing = await (this.prisma as any).outstandingSettlement.findUnique({
        where: { requestId },
        select: { id: true },
      });
      if (existing?.id) {
        return this.findOneForAdmin(existing.id);
      }
    }

    try {
      return await (this.prisma as any).$transaction(async (client: TxClient) => {
        const settlement = await this.createSettlementWithUniqueNo(client, {
          sourceType,
          rangeStartAt,
          cutoffAt,
          requestId,
          makerUserId: operatorId,
          note,
        });

        const where: any = {
          sourceType,
          status: 'OPEN',
          createdAt: {
            lte: cutoffAt,
          },
        };
        if (rangeStartAt) {
          where.createdAt.gte = rangeStartAt;
        }

        const candidateRows = await (client as any).outstanding.findMany({
          where,
          select: {
            id: true,
            assetId: true,
            direction: true,
            amount: true,
            asset: {
              select: {
                id: true,
                currency: true,
                network: true,
                type: true,
                decimals: true,
              },
            },
          },
        });

        if (!candidateRows.length) {
          await (client as any).outstandingSettlement.update({
            where: { id: settlement.id },
            data: {
              status: OutstandingSettlementStatus.SUCCESS,
              totalOutstandingCount: 0,
              closedOutstandingCount: 0,
              totalAssetCount: 0,
              closedAssetCount: 0,
              completedAt: new Date(),
            },
          });
          return this.findOneWithClient(client, settlement.id);
        }

        const candidateIds = candidateRows.map((row: any) => row.id);
        await (client as any).outstanding.updateMany({
          where: {
            id: { in: candidateIds },
            status: 'OPEN',
          },
          data: {
            status: 'LOCKED',
            settlementId: settlement.id,
            lockedAt: cutoffAt,
            closedAt: null,
            closedByInternalFundId: null,
          },
        });

        const lockedRows = await (client as any).outstanding.findMany({
          where: {
            settlementId: settlement.id,
            status: 'LOCKED',
          },
          select: {
            id: true,
            assetId: true,
            direction: true,
            amount: true,
            asset: {
              select: {
                id: true,
                currency: true,
                network: true,
                type: true,
                decimals: true,
              },
            },
          },
        });

        if (!lockedRows.length) {
          await (client as any).outstandingSettlement.update({
            where: { id: settlement.id },
            data: {
              status: OutstandingSettlementStatus.SUCCESS,
              totalOutstandingCount: 0,
              closedOutstandingCount: 0,
              totalAssetCount: 0,
              closedAssetCount: 0,
              completedAt: new Date(),
            },
          });
          return this.findOneWithClient(client, settlement.id);
        }

        const grouped = this.groupByAsset(lockedRows);
        let closedOutstandingCount = 0;
        let closedAssetCount = 0;

        for (const group of grouped) {
          const totalInAmount = group.rows
            .filter((row) => row.direction === 'IN')
            .reduce(
              (sum, row) => sum.plus(new Prisma.Decimal(row.amount)),
              new Prisma.Decimal(0),
            );
          const totalOutAmount = group.rows
            .filter((row) => row.direction === 'OUT')
            .reduce(
              (sum, row) => sum.plus(new Prisma.Decimal(row.amount)),
              new Prisma.Decimal(0),
            );
          const netAmount = totalInAmount.minus(totalOutAmount);
          const rowIds = group.rows.map((row) => row.id);

          const item = await (client as any).outstandingSettlementItem.create({
            data: {
              settlementId: settlement.id,
              assetId: group.asset.id,
              assetCode: group.asset.currency,
              totalInAmount,
              totalOutAmount,
              netAmount,
              status: netAmount.eq(0)
                ? OutstandingSettlementItemStatus.NETTED
                : OutstandingSettlementItemStatus.PROCESSING,
              outstandingCount: rowIds.length,
              closedOutstandingCount: netAmount.eq(0) ? rowIds.length : 0,
              closedAt: netAmount.eq(0) ? new Date() : null,
            },
          });

          await (client as any).outstanding.updateMany({
            where: {
              id: { in: rowIds },
              settlementId: settlement.id,
            },
            data: {
              settlementItemId: item.id,
            },
          });

          if (netAmount.eq(0)) {
            await (client as any).outstanding.updateMany({
              where: {
                settlementItemId: item.id,
                status: 'LOCKED',
              },
              data: {
                status: 'CLOSED',
                closedAt: new Date(),
                closedByInternalFundId: null,
              },
            });
            closedOutstandingCount += rowIds.length;
            closedAssetCount += 1;
            continue;
          }

          const execution = this.resolveExecutionDirection(
            group.asset.type,
            netAmount,
          );
          const [fromWallet, toWallet] = await Promise.all([
            this.resolveSystemWallet(client, {
              assetId: group.asset.id,
              assetCurrency: group.asset.currency,
              assetType: group.asset.type,
              assetNetwork: group.asset.network || null,
              walletRole: execution.fromRole,
            }),
            this.resolveSystemWallet(client, {
              assetId: group.asset.id,
              assetCurrency: group.asset.currency,
              assetType: group.asset.type,
              assetNetwork: group.asset.network || null,
              walletRole: execution.toRole,
            }),
          ]);

          const internalTx =
            await this.internalTransactionsService.createStandaloneTransaction(
              {
                type: execution.internalType,
                status: InternalTransactionStatus.INTERNAL_FUNDS_PENDING,
                sourceType: 'OUTSTANDING_SETTLEMENT',
                sourceId: item.id,
                sourceNo: settlement.settlementNo,
                ownerType: 'PLATFORM',
                ownerId: 'PLATFORM',
                ownerNo: 'PLATFORM',
                assetId: group.asset.id,
                amount: execution.amount,
                feeAmount: new Prisma.Decimal(0),
                netAmount: execution.amount,
                fromWalletId: fromWallet.id,
                fromAddress: fromWallet.address ?? null,
                fromIban: fromWallet.iban ?? null,
                toWalletId: toWallet.id,
                toAddress: toWallet.address ?? null,
                toIban: toWallet.iban ?? null,
                referenceNo: settlement.settlementNo,
              },
              operatorId,
              client,
            );

          await this.internalFundsService.createFromInternalTransaction(
            {
              internalTransactionId: internalTx.id,
              status: InternalFundStatus.CREATED,
              amount: execution.amount,
              feeAmount: new Prisma.Decimal(0),
              netAmount: execution.amount,
              referenceNo: settlement.settlementNo,
            },
            operatorId,
            client,
          );

          await (client as any).outstandingSettlementItem.update({
            where: { id: item.id },
            data: {
              internalType: execution.internalType,
              internalTransactionId: internalTx.id,
              status: OutstandingSettlementItemStatus.PROCESSING,
            },
          });
        }

        const finalStatus =
          grouped.length === closedAssetCount
            ? OutstandingSettlementStatus.SUCCESS
            : OutstandingSettlementStatus.PROCESSING;

        await (client as any).outstandingSettlement.update({
          where: { id: settlement.id },
          data: {
            status: finalStatus,
            totalOutstandingCount: lockedRows.length,
            closedOutstandingCount,
            totalAssetCount: grouped.length,
            closedAssetCount,
            completedAt:
              finalStatus === OutstandingSettlementStatus.SUCCESS
                ? new Date()
                : null,
          },
        });

        return this.findOneWithClient(client, settlement.id);
      });
    } catch (error) {
      if (requestId && this.isRequestIdUniqueConflict(error)) {
        const existing = await (this.prisma as any).outstandingSettlement.findUnique({
          where: { requestId },
          select: { id: true },
        });
        if (existing?.id) {
          return this.findOneForAdmin(existing.id);
        }
      }
      throw error;
    }
  }

  async syncSettlement(id: string, operatorId = 'SYSTEM') {
    return (this.prisma as any).$transaction(async (client: TxClient) => {
      const settlement = await (client as any).outstandingSettlement.findUnique({
        where: { id },
        include: {
          items: {
            orderBy: { createdAt: 'asc' },
          },
        },
      });
      if (!settlement) {
        throw new NotFoundException('Outstanding settlement not found');
      }

      for (const item of settlement.items || []) {
        if (!item.internalTransactionId) continue;
        const fund = await (client as any).internalFund.findFirst({
          where: { internalTransactionId: item.internalTransactionId },
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            status: true,
          },
        });
        if (!fund) continue;
        if (!this.isFundTerminalStatus(String(fund.status || ''))) continue;

        await this.applyFundTerminalToItem(client, item, fund, operatorId);
      }

      await this.recomputeSettlementFromItems(client, id);
      return this.findOneWithClient(client, id);
    });
  }

  async findAllForAdmin(query: OutstandingSettlementQueryDto) {
    const {
      skip = 0,
      take = 20,
      status,
      settlementNo,
      requestId,
      sourceType,
      startDate,
      endDate,
    } = query;

    const where: any = {};
    if (status) where.status = status;
    if (settlementNo) where.settlementNo = { contains: settlementNo };
    if (requestId) where.requestId = { contains: requestId };
    if (sourceType) where.sourceType = this.normalizeSourceType(sourceType);
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = this.parseOptionalDate(startDate, 'startDate');
      if (endDate) where.createdAt.lte = this.parseOptionalDate(endDate, 'endDate');
    }

    const [items, total] = await Promise.all([
      (this.prisma as any).outstandingSettlement.findMany({
        where,
        skip: Number(skip),
        take: Number(take),
        orderBy: { createdAt: 'desc' },
        include: {
          items: {
            select: {
              id: true,
              status: true,
            },
          },
        },
      }),
      (this.prisma as any).outstandingSettlement.count({ where }),
    ]);

    return { items, total };
  }

  async findOneForAdmin(id: string) {
    return this.findOneWithClient(this.prisma as any, id);
  }
}
