import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { generateReferenceNo } from '../../../common/utils/no-generator.util';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { InternalFundsService } from '../internal-funds/internal-funds.service';
import { InternalFundStatus } from '../internal-funds/dto/internal-fund.dto';
import { InternalTransactionsService } from '../internal-transactions/internal-transactions.service';
import {
  InternalTransactionApprovalStatus,
  InternalTransactionStatus,
} from '../internal-transactions/dto/internal-transaction.dto';
import {
  MANUAL_INTERNAL_TRANSACTION_TYPES,
  MANUAL_CRYPTO_INTERNAL_TRANSACTION_TYPES,
  MANUAL_FIAT_INTERNAL_TRANSACTION_TYPES,
  MANUAL_INTERNAL_TX_TYPE_WALLET_ROUTE,
  type ManualInternalTransactionType,
} from '../internal-transactions/internal-transaction.constants';
import { CreateManualInternalTransactionDto } from './dto/create-manual-internal-transaction.dto';
import {
  ManualInternalTransactionReviewAction,
  ReviewManualInternalTransactionDto,
} from './dto/review-manual-internal-transaction.dto';

type TxClient = Prisma.TransactionClient;

@Injectable()
export class InternalTransactionWorkflowService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly internalTransactionsService: InternalTransactionsService,
    private readonly internalFundsService: InternalFundsService,
  ) {}

  private resolveManualRoute(type: ManualInternalTransactionType) {
    const route = MANUAL_INTERNAL_TX_TYPE_WALLET_ROUTE[type];
    if (!route) {
      throw new BadRequestException(`Type ${type} is not allowed for manual creation`);
    }
    return route;
  }

  private resolveExpectedAssetType(type: ManualInternalTransactionType) {
    if (
      (MANUAL_CRYPTO_INTERNAL_TRANSACTION_TYPES as readonly string[]).includes(type)
    ) {
      return 'CRYPTO';
    }
    if (
      (MANUAL_FIAT_INTERNAL_TRANSACTION_TYPES as readonly string[]).includes(type)
    ) {
      return 'FIAT';
    }

    throw new BadRequestException(`Type ${type} is not allowed for manual creation`);
  }

  private resolveSourceId(requestId?: string) {
    const trimmed = requestId?.trim();
    if (trimmed) return trimmed;
    return `MANUAL_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  }

  private ensureAmountPrecision(amount: string, decimals: number) {
    const fractionalLength = (amount.split('.')[1] || '').length;
    if (fractionalLength > Number(decimals || 0)) {
      throw new BadRequestException(
        `amount precision exceeds asset decimals (${decimals})`,
      );
    }
  }

  private isSelfApprovalAllowed(): boolean {
    const raw = (process.env.INTERNAL_TX_ALLOW_SELF_APPROVAL || 'true')
      .trim()
      .toLowerCase();
    return raw !== 'false' && raw !== '0' && raw !== 'no';
  }

  async createManualTransaction(
    dto: CreateManualInternalTransactionDto,
    operatorId = 'SYSTEM',
  ) {
    const manualType = dto.type as ManualInternalTransactionType;
    if (!MANUAL_INTERNAL_TRANSACTION_TYPES.includes(manualType)) {
      throw new BadRequestException(
        `Type ${manualType} is not allowed for manual creation`,
      );
    }

    const amount = new Prisma.Decimal(dto.amount);
    if (amount.lte(0)) {
      throw new BadRequestException('amount must be greater than 0');
    }

    const sourceId = this.resolveSourceId(dto.requestId);
    const route = this.resolveManualRoute(manualType);
    const expectedAssetType = this.resolveExpectedAssetType(manualType);

    return (this.prisma as any).$transaction(async (tx: TxClient) => {
      const uniqueKey = {
        sourceType_sourceId_type: {
          sourceType: 'INTERNAL_MANUAL',
          sourceId,
          type: manualType,
        },
      };

      const existing = await (tx as any).internalTransaction.findUnique({
        where: uniqueKey,
        include: {
          asset: true,
          fromWallet: true,
          toWallet: true,
        },
      });

      if (existing) {
        const existingFund = await (tx as any).internalFund.findFirst({
          where: { internalTransactionId: existing.id },
          orderBy: { createdAt: 'asc' },
        });
        return {
          internalTransaction: existing,
          internalFund: existingFund ?? null,
          idempotent: true,
        };
      }

      const [asset, fromWallet, toWallet] = await Promise.all([
        (tx as any).asset.findUnique({
          where: { id: dto.assetId },
        }),
        (tx as any).wallet.findUnique({
          where: { id: dto.fromWalletId },
        }),
        (tx as any).wallet.findUnique({
          where: { id: dto.toWalletId },
        }),
      ]);

      if (!asset) {
        throw new NotFoundException(`Asset ${dto.assetId} not found`);
      }
      if (asset.type !== expectedAssetType) {
        throw new BadRequestException(
          `Asset type mismatch: ${manualType} requires ${expectedAssetType}, got ${asset.type}`,
        );
      }

      this.ensureAmountPrecision(dto.amount, Number(asset.decimals || 0));

      if (!fromWallet) {
        throw new NotFoundException(`From wallet ${dto.fromWalletId} not found`);
      }
      if (!toWallet) {
        throw new NotFoundException(`To wallet ${dto.toWalletId} not found`);
      }

      if (fromWallet.id === toWallet.id) {
        throw new BadRequestException('fromWalletId and toWalletId must be different');
      }
      if (fromWallet.status !== 'ACTIVE' || toWallet.status !== 'ACTIVE') {
        throw new BadRequestException('Both wallets must be ACTIVE');
      }
      if (fromWallet.assetId !== asset.id || toWallet.assetId !== asset.id) {
        throw new BadRequestException('wallet asset must match selected assetId');
      }

      if (fromWallet.walletRole !== route.fromRole) {
        throw new BadRequestException(
          `fromWallet role mismatch: expected ${route.fromRole}, got ${fromWallet.walletRole}`,
        );
      }
      if (toWallet.walletRole !== route.toRole) {
        throw new BadRequestException(
          `toWallet role mismatch: expected ${route.toRole}, got ${toWallet.walletRole}`,
        );
      }

      const ownerType = fromWallet.ownerType;
      const ownerId =
        fromWallet.ownerId || fromWallet.ownerNo || `${fromWallet.ownerType}_POOL`;
      const ownerNo = fromWallet.ownerNo || ownerId;

      const internalTx = await this.internalTransactionsService.createStandaloneTransaction(
        {
          type: manualType,
          status: InternalTransactionStatus.INTERNAL_FUNDS_PENDING,
          approvalStatus: InternalTransactionApprovalStatus.PENDING,
          makerUserId: operatorId,
          sourceType: 'INTERNAL_MANUAL',
          sourceId,
          sourceNo: dto.requestId?.trim() || generateReferenceNo('MANUAL'),
          ownerType,
          ownerId,
          ownerNo,
          assetId: asset.id,
          amount,
          feeAmount: new Prisma.Decimal(0),
          netAmount: amount,
          fromWalletId: fromWallet.id,
          fromAddress: fromWallet.address ?? null,
          fromIban: fromWallet.iban ?? null,
          toWalletId: toWallet.id,
          toAddress: toWallet.address ?? null,
          toIban: toWallet.iban ?? null,
          referenceNo: dto.referenceNo ?? null,
          reviewReason: dto.reason?.trim() || null,
        },
        operatorId,
        tx,
      );

      return {
        internalTransaction: internalTx,
        internalFund: null,
        idempotent: false,
      };
    });
  }

  async reviewManualTransaction(
    id: string,
    dto: ReviewManualInternalTransactionDto,
    operatorId = 'SYSTEM',
  ) {
    return (this.prisma as any).$transaction(async (tx: TxClient) => {
      const item = await (tx as any).internalTransaction.findUnique({
        where: { id },
        select: {
          id: true,
          sourceType: true,
          status: true,
          approvalStatus: true,
          makerUserId: true,
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
        !this.isSelfApprovalAllowed() &&
        item.makerUserId &&
        item.makerUserId === operatorId
      ) {
        throw new BadRequestException(
          'maker and checker must be different when self approval is disabled',
        );
      }

      if (dto.action === ManualInternalTransactionReviewAction.REJECT) {
        const rejected = await this.internalTransactionsService.rejectManualReview(
          id,
          operatorId,
          dto.reason,
          tx,
        );
        return {
          internalTransaction: rejected,
          internalFund: null,
          reviewed: true,
        };
      }

      const approved = await this.internalTransactionsService.approveManualReview(
        id,
        operatorId,
        dto.reason,
        tx,
      );

      const createdFund = await this.internalFundsService.createFromInternalTransaction(
        {
          internalTransactionId: id,
          status: InternalFundStatus.CREATED,
          referenceNo: approved.referenceNo ?? null,
        },
        operatorId,
        tx,
      );

      return {
        internalTransaction: approved,
        internalFund: createdFund,
        reviewed: true,
      };
    });
  }
}
