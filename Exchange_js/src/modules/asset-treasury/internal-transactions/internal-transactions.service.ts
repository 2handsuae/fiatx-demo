import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { generateReferenceNo } from '../../../common/utils/no-generator.util';
import { JournalsService } from '../../accounting/journals/journals.service';
import { ClearingsService } from '../../clearing-settle/clearing/clearings.service';
import {
  InternalTransactionQueryDto,
  InternalTransactionApprovalStatus,
  InternalTransactionStatus,
  InternalTransactionType,
} from './dto/internal-transaction.dto';

type TxClient = Prisma.TransactionClient;

interface CreateFromDepositSuccessInput {
  deposit: {
    id: string;
    depositNo: string;
    ownerType: string;
    ownerId: string;
    ownerNo?: string | null;
    assetId: string;
    amount: Prisma.Decimal;
    netAmount: Prisma.Decimal;
    feeAmount: Prisma.Decimal;
    toWalletId?: string | null;
    toAddress?: string | null;
    toIban?: string | null;
  };
  masterWallet: {
    id: string;
    address?: string | null;
    iban?: string | null;
  };
}

interface CreateStandaloneInput {
  type: InternalTransactionType;
  sourceType: string;
  sourceId: string;
  sourceNo?: string | null;
  ownerType: string;
  ownerId: string;
  ownerNo?: string | null;
  assetId: string;
  amount: Prisma.Decimal;
  feeAmount: Prisma.Decimal;
  netAmount: Prisma.Decimal;
  fromWalletId?: string | null;
  fromAddress?: string | null;
  fromIban?: string | null;
  toWalletId?: string | null;
  toAddress?: string | null;
  toIban?: string | null;
  referenceNo?: string | null;
  status?: InternalTransactionStatus;
  approvalStatus?: InternalTransactionApprovalStatus;
  makerUserId?: string | null;
  checkerUserId?: string | null;
  checkedAt?: Date | null;
  reviewReason?: string | null;
}

@Injectable()
export class InternalTransactionsService {
  private static readonly MAX_NO_GENERATION_RETRIES = 10;
  private static readonly TERMINAL_STATUSES = new Set<InternalTransactionStatus>([
    InternalTransactionStatus.SUCCESS,
    InternalTransactionStatus.FAILED,
    InternalTransactionStatus.CANCELLED,
    InternalTransactionStatus.REJECTED,
  ]);

  constructor(
    private readonly prisma: PrismaService,
    private readonly journalsService: JournalsService,
    private readonly clearingsService: ClearingsService,
  ) {}

  private appendStatusHistory(
    current: string | null | undefined,
    nextStatus: InternalTransactionStatus,
    operatorId: string,
    reason: string,
  ): string {
    let history: any[] = [];
    try {
      if (current) {
        history = JSON.parse(current);
      }
      if (!Array.isArray(history)) history = [];
    } catch {
      history = [];
    }

    history.push({
      status: nextStatus,
      timestamp: new Date().toISOString(),
      operator: operatorId,
      note: reason,
    });
    return JSON.stringify(history);
  }

  private createAccountingContext(item: any) {
    return {
      src: {
        id: item.id,
        internalTxNo: item.internalTxNo,
        type: item.type,
        sourceType: item.sourceType,
        sourceId: item.sourceId,
        sourceNo: item.sourceNo,
        ownerType: item.ownerType,
        ownerId: item.ownerId,
        ownerNo: item.ownerNo,
        assetId: item.assetId,
        amount: item.amount?.toString?.() ?? String(item.amount ?? '0'),
        feeAmount: item.feeAmount?.toString?.() ?? String(item.feeAmount ?? '0'),
        netAmount: item.netAmount?.toString?.() ?? String(item.netAmount ?? '0'),
        fromWalletId: item.fromWalletId,
        fromWalletOwnerType: item.fromWallet?.ownerType ?? null,
        fromAddress: item.fromAddress,
        fromIban: item.fromIban,
        toWalletId: item.toWalletId,
        toWalletOwnerType: item.toWallet?.ownerType ?? null,
        toAddress: item.toAddress,
        toIban: item.toIban,
      },
    };
  }

  private isInternalTxNoUniqueConflict(error: unknown): boolean {
    const maybe = error as {
      code?: string;
      meta?: { target?: string[] | string };
    };
    if (maybe?.code !== 'P2002') return false;
    const target = maybe.meta?.target;
    if (Array.isArray(target)) return target.includes('internalTxNo');
    if (typeof target === 'string') return target.includes('internalTxNo');
    return false;
  }

  private isUniqueConstraintOnSource(error: unknown): boolean {
    const maybe = error as {
      code?: string;
      meta?: { target?: string[] | string };
    };
    if (maybe?.code !== 'P2002') return false;
    const target = maybe.meta?.target;
    if (Array.isArray(target)) {
      return (
        target.includes('sourceType') &&
        target.includes('sourceId') &&
        target.includes('type')
      );
    }
    if (typeof target === 'string') {
      return (
        target.includes('sourceType') &&
        target.includes('sourceId') &&
        target.includes('type')
      );
    }
    return false;
  }

  private async triggerStatusEvent(
    client: TxClient,
    item: any,
    fromStatus: InternalTransactionStatus | null,
    toStatus: InternalTransactionStatus,
  ) {
    await this.journalsService.triggerEvent(
      {
        entityType: 'INTERNAL_TX',
        triggerKey: 'status',
        fromStatus,
        toStatus,
        assetType: item?.asset?.type === 'FIAT' ? 'FIAT' : 'CRYPTO',
        context: this.createAccountingContext(item),
        sourceId: item.id,
      },
      client,
    );
  }

  private async createWithUniqueNo(
    client: TxClient,
    input: CreateStandaloneInput,
    operatorId: string,
  ) {
    if (!input.fromWalletId || !input.toWalletId) {
      throw new BadRequestException(
        'fromWalletId and toWalletId are required for internal transaction',
      );
    }

    for (
      let attempt = 1;
      attempt <= InternalTransactionsService.MAX_NO_GENERATION_RETRIES;
      attempt += 1
    ) {
      const internalTxNo = generateReferenceNo('ITX');
      const status =
        input.status ?? InternalTransactionStatus.INTERNAL_FUNDS_PENDING;
      const approvalStatus =
        input.approvalStatus ?? InternalTransactionApprovalStatus.APPROVED;
      const statusHistory = this.appendStatusHistory(
        null,
        status,
        operatorId,
        'Internal transaction created',
      );

      try {
        const created = await (client as any).internalTransaction.create({
          data: {
            internalTxNo,
            type: input.type,
            status,
            approvalStatus,
            makerUserId: input.makerUserId ?? null,
            checkerUserId: input.checkerUserId ?? null,
            checkedAt: input.checkedAt ?? null,
            reviewReason: input.reviewReason ?? null,
            sourceType: input.sourceType,
            sourceId: input.sourceId,
            sourceNo: input.sourceNo ?? null,
            ownerType: input.ownerType,
            ownerId: input.ownerId,
            ownerNo: input.ownerNo ?? null,
            assetId: input.assetId,
            amount: input.amount,
            feeAmount: input.feeAmount,
            netAmount: input.netAmount,
            fromWalletId: input.fromWalletId ?? null,
            fromAddress: input.fromAddress ?? null,
            fromIban: input.fromIban ?? null,
            toWalletId: input.toWalletId ?? null,
            toAddress: input.toAddress ?? null,
            toIban: input.toIban ?? null,
            referenceNo: input.referenceNo ?? null,
            statusHistory,
            completedAt: InternalTransactionsService.TERMINAL_STATUSES.has(status)
              ? new Date()
              : null,
          },
          include: {
            asset: true,
            fromWallet: {
              select: {
                id: true,
                ownerType: true,
              },
            },
            toWallet: {
              select: {
                id: true,
                ownerType: true,
              },
            },
          },
        });

        await (client as any).internalTransactionAuditLog.create({
          data: {
            internalTransactionId: created.id,
            operatorId,
            oldStatus: 'NONE',
            newStatus: status,
            reason: 'Initial creation',
          },
        });

        await this.triggerStatusEvent(client, created, null, status);
        return created;
      } catch (error) {
        if (this.isInternalTxNoUniqueConflict(error)) {
          continue;
        }
        throw error;
      }
    }

    throw new InternalServerErrorException(
      `Failed to generate unique internalTxNo after ${InternalTransactionsService.MAX_NO_GENERATION_RETRIES} attempts`,
    );
  }

  async createStandaloneTransaction(
    input: CreateStandaloneInput,
    operatorId = 'SYSTEM',
    tx?: TxClient,
  ) {
    const execute = async (client: TxClient) =>
      this.createWithUniqueNo(client, input, operatorId);

    if (tx) return execute(tx);
    return (this.prisma as any).$transaction((client: TxClient) =>
      execute(client),
    );
  }

  async createFromDepositSuccess(
    input: CreateFromDepositSuccessInput,
    operatorId = 'SYSTEM',
    tx?: TxClient,
  ) {
    const execute = async (client: TxClient) => {
      const key = {
        sourceType_sourceId_type: {
          sourceType: 'DEPOSIT',
          sourceId: input.deposit.id,
          type: InternalTransactionType.DEP_TO_MASTER,
        },
      };

      const existing = await (client as any).internalTransaction.findUnique({
        where: key,
      });
      if (existing) return existing;

      try {
        return await this.createWithUniqueNo(
          client,
          {
            type: InternalTransactionType.DEP_TO_MASTER,
            sourceType: 'DEPOSIT',
            sourceId: input.deposit.id,
            sourceNo: input.deposit.depositNo,
            ownerType: input.deposit.ownerType,
            ownerId: input.deposit.ownerId,
            ownerNo: input.deposit.ownerNo ?? null,
            assetId: input.deposit.assetId,
            amount: new Prisma.Decimal(input.deposit.netAmount),
            feeAmount: new Prisma.Decimal(0),
            netAmount: new Prisma.Decimal(input.deposit.netAmount),
            fromWalletId: input.deposit.toWalletId ?? null,
            fromAddress: input.deposit.toAddress ?? null,
            fromIban: input.deposit.toIban ?? null,
            toWalletId: input.masterWallet.id,
            toAddress: input.masterWallet.address ?? null,
            toIban: input.masterWallet.iban ?? null,
            referenceNo: input.deposit.depositNo,
            status: InternalTransactionStatus.INTERNAL_FUNDS_PENDING,
          },
          operatorId,
        );
      } catch (error) {
        if (this.isUniqueConstraintOnSource(error)) {
          return (client as any).internalTransaction.findUnique({
            where: key,
          });
        }
        throw error;
      }
    };

    if (tx) return execute(tx);
    return (this.prisma as any).$transaction((client: TxClient) =>
      execute(client),
    );
  }

  async approveManualReview(
    internalTransactionId: string,
    operatorId: string,
    reviewReason?: string | null,
    tx?: TxClient,
  ) {
    const execute = async (client: TxClient) => {
      const item = await (client as any).internalTransaction.findUnique({
        where: { id: internalTransactionId },
        include: {
          asset: true,
          fromWallet: {
            select: {
              id: true,
              ownerType: true,
            },
          },
          toWallet: {
            select: {
              id: true,
              ownerType: true,
            },
          },
        },
      });
      if (!item) {
        throw new NotFoundException('Internal transaction not found');
      }
      if (item.sourceType !== 'INTERNAL_MANUAL') {
        throw new BadRequestException('Only INTERNAL_MANUAL transaction can be reviewed');
      }
      if (item.approvalStatus !== InternalTransactionApprovalStatus.PENDING) {
        throw new BadRequestException(
          `Review is only allowed for approvalStatus=PENDING, current=${item.approvalStatus}`,
        );
      }

      const updated = await (client as any).internalTransaction.update({
        where: { id: internalTransactionId },
        data: {
          approvalStatus: InternalTransactionApprovalStatus.APPROVED,
          checkerUserId: operatorId,
          checkedAt: new Date(),
          reviewReason: reviewReason ?? null,
        },
        include: {
          asset: true,
          fromWallet: {
            select: {
              id: true,
              ownerType: true,
            },
          },
          toWallet: {
            select: {
              id: true,
              ownerType: true,
            },
          },
        },
      });

      await (client as any).internalTransactionAuditLog.create({
        data: {
          internalTransactionId,
          operatorId,
          oldStatus: item.status,
          newStatus: item.status,
          reason:
            reviewReason?.trim() ||
            'Manual review approved, waiting for internal funds execution',
        },
      });

      return updated;
    };

    if (tx) return execute(tx);
    return (this.prisma as any).$transaction((client: TxClient) =>
      execute(client),
    );
  }

  async rejectManualReview(
    internalTransactionId: string,
    operatorId: string,
    reviewReason?: string | null,
    tx?: TxClient,
  ) {
    const execute = async (client: TxClient) => {
      const item = await (client as any).internalTransaction.findUnique({
        where: { id: internalTransactionId },
        include: {
          asset: true,
          fromWallet: {
            select: {
              id: true,
              ownerType: true,
            },
          },
          toWallet: {
            select: {
              id: true,
              ownerType: true,
            },
          },
        },
      });
      if (!item) {
        throw new NotFoundException('Internal transaction not found');
      }
      if (item.sourceType !== 'INTERNAL_MANUAL') {
        throw new BadRequestException('Only INTERNAL_MANUAL transaction can be reviewed');
      }
      if (item.approvalStatus !== InternalTransactionApprovalStatus.PENDING) {
        throw new BadRequestException(
          `Review is only allowed for approvalStatus=PENDING, current=${item.approvalStatus}`,
        );
      }
      if (
        InternalTransactionsService.TERMINAL_STATUSES.has(
          item.status as InternalTransactionStatus,
        )
      ) {
        throw new BadRequestException(
          `Cannot reject terminal transaction with status=${item.status}`,
        );
      }

      const nextStatus = InternalTransactionStatus.REJECTED;
      const updated = await (client as any).internalTransaction.update({
        where: { id: internalTransactionId },
        data: {
          status: nextStatus,
          approvalStatus: InternalTransactionApprovalStatus.REJECTED,
          checkerUserId: operatorId,
          checkedAt: new Date(),
          reviewReason: reviewReason ?? null,
          statusHistory: this.appendStatusHistory(
            item.statusHistory,
            nextStatus,
            operatorId,
            reviewReason?.trim() || 'Manual review rejected',
          ),
          completedAt: new Date(),
        },
        include: {
          asset: true,
          fromWallet: {
            select: {
              id: true,
              ownerType: true,
            },
          },
          toWallet: {
            select: {
              id: true,
              ownerType: true,
            },
          },
        },
      });

      await (client as any).internalTransactionAuditLog.create({
        data: {
          internalTransactionId,
          operatorId,
          oldStatus: item.status,
          newStatus: nextStatus,
          reason: reviewReason?.trim() || 'Manual review rejected',
        },
      });

      await this.triggerStatusEvent(client, updated, item.status, nextStatus);
      return updated;
    };

    if (tx) return execute(tx);
    return (this.prisma as any).$transaction((client: TxClient) =>
      execute(client),
    );
  }

  async syncStatusFromFunds(
    internalTransactionId: string,
    operatorId = 'SYSTEM',
    tx?: TxClient,
  ) {
    const execute = async (client: TxClient) => {
      const item = await (client as any).internalTransaction.findUnique({
        where: { id: internalTransactionId },
        include: {
          asset: true,
          fromWallet: {
            select: {
              id: true,
              ownerType: true,
            },
          },
          toWallet: {
            select: {
              id: true,
              ownerType: true,
            },
          },
          funds: {
            select: {
              status: true,
              feeAmount: true,
            },
          },
        },
      });
      if (!item) {
        throw new NotFoundException('Internal transaction not found');
      }

      const current = item.status as InternalTransactionStatus;
      const statuses = (item.funds || []).map((fund: any) => String(fund.status));
      if (!statuses.length) return item;
      if (InternalTransactionsService.TERMINAL_STATUSES.has(current)) {
        return item;
      }

      let next = current;

      if (
        statuses.every((status: string) =>
          ['CONFIRMED', 'CLEAR'].includes(status),
        )
      ) {
        next = InternalTransactionStatus.SUCCESS;
      } else if (statuses.every((status: string) => status === 'CANCELLED')) {
        next = InternalTransactionStatus.CANCELLED;
      } else {
        const hasFailed = statuses.some(
          (status: string) => status === 'FAILED' || status === 'TIMEOUT',
        );
        const hasProgressing = statuses.some(
          (status: string) =>
            ![
              'FAILED',
              'TIMEOUT',
              'CONFIRMED',
              'CLEAR',
              'CANCELLED',
              'RETURNED',
            ].includes(status),
        );

        if (hasFailed && !hasProgressing) {
          next = InternalTransactionStatus.FAILED;
        }
      }

      if (next === current) return item;

      const totalFee = (item.funds || []).reduce(
        (sum: Prisma.Decimal, fund: any) =>
          sum.plus(new Prisma.Decimal(fund.feeAmount || 0)),
        new Prisma.Decimal(0),
      );
      const amount = new Prisma.Decimal(item.amount || 0);
      const nextNetAmount = amount.minus(totalFee);

      const updated = await (client as any).internalTransaction.update({
        where: { id: internalTransactionId },
        data: {
          status: next,
          feeAmount: totalFee,
          netAmount: nextNetAmount,
          statusHistory: this.appendStatusHistory(
            item.statusHistory,
            next,
            operatorId,
            `Aggregated from internal funds`,
          ),
          completedAt: InternalTransactionsService.TERMINAL_STATUSES.has(next)
            ? new Date()
            : null,
        },
        include: {
          asset: true,
          fromWallet: {
            select: {
              id: true,
              ownerType: true,
            },
          },
          toWallet: {
            select: {
              id: true,
              ownerType: true,
            },
          },
        },
      });

      await (client as any).internalTransactionAuditLog.create({
        data: {
          internalTransactionId,
          operatorId,
          oldStatus: current,
          newStatus: next,
          reason: 'Aggregated from internal funds',
        },
      });

      if (next === InternalTransactionStatus.SUCCESS) {
        const successEventCode =
          updated?.asset?.type === 'FIAT'
            ? 'EVT_INTERNAL_TX_SUCCESS__FIAT'
            : 'EVT_INTERNAL_TX_SUCCESS__CRYPTO';
        await this.clearingsService.triggerClearing(
          {
            sourceType: 'INTERNAL_TX',
            sourceId: updated.id,
            eventCode: successEventCode,
            context: this.createAccountingContext(updated),
          },
          client,
        );
      }

      await this.triggerStatusEvent(client, updated, current, next);
      return updated;
    };

    if (tx) return execute(tx);
    return (this.prisma as any).$transaction((client: TxClient) =>
      execute(client),
    );
  }

  async findAllForAdmin(query: InternalTransactionQueryDto) {
    const {
      skip = 0,
      take = 20,
      status,
      type,
      approvalStatus,
      sourceType,
      sourceId,
      sourceNo,
      ownerId,
      ownerNo,
      assetId,
      internalTxNo,
      startDate,
      endDate,
    } = query;

    const where: any = {};
    if (status) where.status = status;
    if (type) where.type = type;
    if (approvalStatus) where.approvalStatus = approvalStatus;
    if (sourceType) where.sourceType = sourceType;
    if (sourceId) where.sourceId = { contains: sourceId };
    if (sourceNo) where.sourceNo = { contains: sourceNo };
    if (ownerId) where.ownerId = ownerId;
    if (ownerNo) where.ownerNo = { contains: ownerNo };
    if (assetId) where.assetId = assetId;
    if (internalTxNo) where.internalTxNo = { contains: internalTxNo };
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate);
      if (endDate) where.createdAt.lte = new Date(endDate);
    }

    const [items, total] = await Promise.all([
      (this.prisma as any).internalTransaction.findMany({
        where,
        skip: Number(skip),
        take: Number(take),
        orderBy: { createdAt: 'desc' },
        include: {
          asset: true,
          fromWallet: true,
          toWallet: true,
          funds: {
            select: {
              id: true,
              status: true,
              internalFundNo: true,
            },
          },
        },
      }),
      (this.prisma as any).internalTransaction.count({ where }),
    ]);

    return { items, total };
  }

  async findOneForAdmin(id: string) {
    const item = await (this.prisma as any).internalTransaction.findUnique({
      where: { id },
      include: {
        asset: true,
        fromWallet: true,
        toWallet: true,
        funds: {
          include: {
            asset: true,
            fromWallet: true,
            toWallet: true,
          },
          orderBy: { createdAt: 'asc' },
        },
        auditLogs: {
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    if (!item) {
      throw new NotFoundException('Internal transaction not found');
    }
    return item;
  }
}
