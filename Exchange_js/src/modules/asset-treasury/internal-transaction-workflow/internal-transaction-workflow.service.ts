import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { generateReferenceNo } from '../../../common/utils/no-generator.util';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { ApprovalsService } from '../../governance/approvals/approvals.service';
import {
  ApprovalActionTypes,
  ApprovalActorContext,
} from '../../governance/approvals/constants/approval.constants';
import { InternalFundsService } from '../internal-funds/internal-funds.service';
import { InternalFundStatus } from '../internal-funds/dto/internal-fund.dto';
import { InternalTransactionsService } from '../internal-transactions/internal-transactions.service';
import {
  InternalTransactionApprovalStatus,
  InternalTransactionStatus,
  TreasuryTransferInitiationMode,
  TreasuryTransferPurpose,
} from '../internal-transactions/dto/internal-transaction.dto';
import {
  MANUAL_TREASURY_TRANSFER_INITIATION_MODE,
  MANUAL_TREASURY_TRANSFER_PURPOSES,
  TREASURY_TRANSFER_ROUTE_POLICIES,
  type ManualTreasuryTransferPurpose,
  type TreasuryTransferRoutePolicy,
} from '../internal-transactions/internal-transaction.constants';
import { CreateManualInternalTransactionDto } from './dto/create-manual-internal-transaction.dto';
import {
  ManualInternalTransactionReviewAction,
  ReviewManualInternalTransactionDto,
} from './dto/review-manual-internal-transaction.dto';

type TxClient = Prisma.TransactionClient;
type ApprovalOrOperator = ApprovalActorContext | string | undefined;

const DIRECT_EXECUTION_PURPOSES = new Set<TreasuryTransferPurpose>([
  TreasuryTransferPurpose.DEPOSIT_COLLECTION,
  TreasuryTransferPurpose.PAYOUT_FUNDING,
  TreasuryTransferPurpose.PAYOUT_RETURN,
]);

const SHARED_APPROVAL_PURPOSES = new Set<TreasuryTransferPurpose>([
  TreasuryTransferPurpose.LIQUIDITY_TOPUP,
  TreasuryTransferPurpose.LIQUIDITY_RETURN,
  TreasuryTransferPurpose.POOL_REBALANCING,
]);

@Injectable()
export class InternalTransactionWorkflowService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly internalTransactionsService: InternalTransactionsService,
    private readonly internalFundsService: InternalFundsService,
    private readonly approvalsService: ApprovalsService,
  ) {}

  private resolveManualPolicy(
    purpose: ManualTreasuryTransferPurpose,
    fromWalletRole: string,
    toWalletRole: string,
  ): TreasuryTransferRoutePolicy {
    const policies = TREASURY_TRANSFER_ROUTE_POLICIES[purpose];
    if (!policies?.length) {
      throw new BadRequestException(
        `Purpose ${purpose} is not allowed for manual creation`,
      );
    }

    const matched = policies.find(
      (item) =>
        item.fromRole === fromWalletRole &&
        item.toRole === toWalletRole &&
        item.allowedInitiationModes.includes(
          TreasuryTransferInitiationMode.MANUAL,
        ),
    );

    if (!matched) {
      throw new BadRequestException(
        `wallet route ${fromWalletRole} -> ${toWalletRole} is not allowed for purpose ${purpose}`,
      );
    }

    return matched;
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

  private ensureRegulatorEnabledCustBankWallet(wallet: {
    walletRole?: string | null;
    walletNo?: string | null;
    regulatoryEnablementStatus?: string | null;
  }) {
    if (String(wallet.walletRole || '').trim().toUpperCase() !== 'CUST_BANK') {
      return;
    }
    if (
      String(wallet.regulatoryEnablementStatus || '')
        .trim()
        .toUpperCase() !== 'EFFECTIVE'
    ) {
      throw new BadRequestException(
        `CUST_BANK wallet ${wallet.walletNo || 'UNKNOWN'} is not regulator-enabled`,
      );
    }
  }

  private isSelfApprovalAllowed(): boolean {
    const raw = (process.env.INTERNAL_TX_ALLOW_SELF_APPROVAL || 'false')
      .trim()
      .toLowerCase();
    return raw !== 'false' && raw !== '0' && raw !== 'no';
  }

  private normalizeActor(actor: ApprovalOrOperator): ApprovalActorContext {
    if (typeof actor === 'object' && actor) {
      return {
        actorType: 'ADMIN',
        userId: String(actor.userId || 'SYSTEM'),
        userNo: actor.userNo,
        role: actor.role,
        roleCodes: Array.isArray(actor.roleCodes) ? actor.roleCodes : [],
      };
    }

    return {
      actorType: 'ADMIN',
      userId: typeof actor === 'string' && actor.trim() ? actor.trim() : 'SYSTEM',
      userNo: typeof actor === 'string' && actor.trim() ? actor.trim() : 'SYSTEM',
      role: typeof actor === 'string' && actor.trim() ? 'ADMIN' : 'SYSTEM',
      roleCodes:
        typeof actor === 'string' && actor.trim()
          ? ['ADMIN']
          : ['SYSTEM'],
    };
  }

  private isDirectExecutionPurpose(purpose: TreasuryTransferPurpose): boolean {
    return DIRECT_EXECUTION_PURPOSES.has(purpose);
  }

  private isSharedApprovalPurpose(purpose: TreasuryTransferPurpose): boolean {
    return SHARED_APPROVAL_PURPOSES.has(purpose);
  }

  async createManualTransaction(
    dto: CreateManualInternalTransactionDto,
    actorInput: ApprovalOrOperator = 'SYSTEM',
  ) {
    const actor = this.normalizeActor(actorInput);
    const operatorId = actor.userId || 'SYSTEM';
    const purpose = dto.purpose as ManualTreasuryTransferPurpose;
    if (!MANUAL_TREASURY_TRANSFER_PURPOSES.includes(purpose)) {
      throw new BadRequestException(
        `Purpose ${purpose} is not allowed for manual creation`,
      );
    }

    const amount = new Prisma.Decimal(dto.amount);
    if (amount.lte(0)) {
      throw new BadRequestException('amount must be greater than 0');
    }

    const sourceId = this.resolveSourceId(dto.requestId);

    const transactionResult = await (this.prisma as any).$transaction(async (tx: TxClient) => {
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
      if (!fromWallet) {
        throw new NotFoundException(`From wallet ${dto.fromWalletId} not found`);
      }
      if (!toWallet) {
        throw new NotFoundException(`To wallet ${dto.toWalletId} not found`);
      }

      const policy = this.resolveManualPolicy(
        purpose,
        String(fromWallet.walletRole || '').trim().toUpperCase(),
        String(toWallet.walletRole || '').trim().toUpperCase(),
      );

      const uniqueKey = {
        sourceType_sourceId_type: {
          sourceType: 'INTERNAL_MANUAL',
          sourceId,
          type: policy.internalType,
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

      if (asset.type !== policy.assetType) {
        throw new BadRequestException(
          `Asset type mismatch: ${purpose} requires ${policy.assetType}, got ${asset.type}`,
        );
      }

      this.ensureAmountPrecision(dto.amount, Number(asset.decimals || 0));

      if (fromWallet.id === toWallet.id) {
        throw new BadRequestException('fromWalletId and toWalletId must be different');
      }
      if (fromWallet.status !== 'ACTIVE' || toWallet.status !== 'ACTIVE') {
        throw new BadRequestException('Both wallets must be ACTIVE');
      }
      if (fromWallet.assetId !== asset.id || toWallet.assetId !== asset.id) {
        throw new BadRequestException('wallet asset must match selected assetId');
      }
      this.ensureRegulatorEnabledCustBankWallet(fromWallet);
      this.ensureRegulatorEnabledCustBankWallet(toWallet);

      if (fromWallet.walletRole !== policy.fromRole) {
        throw new BadRequestException(
          `fromWallet role mismatch: expected ${policy.fromRole}, got ${fromWallet.walletRole}`,
        );
      }
      if (toWallet.walletRole !== policy.toRole) {
        throw new BadRequestException(
          `toWallet role mismatch: expected ${policy.toRole}, got ${toWallet.walletRole}`,
        );
      }

      const ownerType = fromWallet.ownerType;
      const ownerId =
        fromWallet.ownerId || fromWallet.ownerNo || `${fromWallet.ownerType}_POOL`;
      const ownerNo = fromWallet.ownerNo || ownerId;

      const internalTx = await this.internalTransactionsService.createStandaloneTransaction(
        {
          type: policy.internalType,
          purpose,
          initiationMode: MANUAL_TREASURY_TRANSFER_INITIATION_MODE,
          status: InternalTransactionStatus.INTERNAL_FUNDS_PENDING,
          approvalStatus: this.isDirectExecutionPurpose(purpose)
            ? InternalTransactionApprovalStatus.APPROVED
            : InternalTransactionApprovalStatus.PENDING,
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

      if (this.isDirectExecutionPurpose(purpose)) {
        const createdFund = await this.internalFundsService.createFromInternalTransaction(
          {
            internalTransactionId: internalTx.id,
            status: InternalFundStatus.CREATED,
            referenceNo: internalTx.referenceNo ?? null,
          },
          operatorId,
          tx,
        );

        return {
          internalTransaction: internalTx,
          internalFund: createdFund,
          approvalCase: null,
          idempotent: false,
          pendingApproval: null,
        };
      }

      if (!this.isSharedApprovalPurpose(purpose)) {
        throw new BadRequestException(`Unsupported internal transfer purpose ${purpose}`);
      }

      const approval = await this.approvalsService.createAndSubmit(
        {
          actionType: ApprovalActionTypes.TREASURY_CROSS_POOL_TRANSFER_APPROVAL,
          entityRef: internalTx.id,
          traceId: `INTERNAL_TX:${internalTx.internalTxNo}`,
          workflowType: 'INTERNAL_TX',
          workflowId: internalTx.id,
          workflowNo: internalTx.internalTxNo,
          metadata: {
            purpose,
            internalTxNo: internalTx.internalTxNo,
            sourceType: internalTx.sourceType,
            sourceNo: internalTx.sourceNo,
          },
          docRef: dto.referenceNo?.trim() || undefined,
        },
        {
          reason: dto.reason?.trim() || undefined,
          traceId: `INTERNAL_TX:${internalTx.internalTxNo}`,
          workflowType: 'INTERNAL_TX',
          workflowId: internalTx.id,
          workflowNo: internalTx.internalTxNo,
        },
        actor,
        tx,
        { emitSideEffects: false },
      );

      const updatedTx = await this.internalTransactionsService.syncApprovalProjection(
        internalTx.id,
        {
          approvalCaseId: approval.id,
          approvalStatus: InternalTransactionApprovalStatus.PENDING,
          reviewReason: dto.reason?.trim() || null,
        },
        operatorId,
        tx,
      );

      return {
        internalTransaction: updatedTx,
        internalFund: null,
        approvalCase: approval,
        idempotent: false,
        pendingApproval: {
          approvalId: approval.id,
          reason: dto.reason?.trim() || null,
        },
      };
    });

    if (transactionResult.pendingApproval) {
      await this.approvalsService.emitSubmittedSideEffects(
        transactionResult.pendingApproval.approvalId,
        actor,
        transactionResult.pendingApproval.reason,
      );
    }

    const { pendingApproval: _pendingApproval, ...result } = transactionResult;
    return result;
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
          approvalCaseId: true,
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
      if (item.approvalCaseId) {
        throw new BadRequestException(
          'Legacy review is not allowed once shared approval is linked to the transaction',
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
