import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { generateReferenceNo } from '../../../common/utils/no-generator.util';
import { PrismaService } from '../../../core/prisma/prisma.service';
import {
  classifyWalletSurface,
  isProtectedPoolWalletRole,
} from '../wallets/system-wallet.util';
import { ReimbursementObligationsService } from '../reimbursement-obligations/reimbursement-obligations.service';
import { AuditLogsService } from '../../risk-engine/audit-logs/audit-logs.service';
import {
  AuditActions,
  AuditEntityTypes,
  AuditModules,
  AuditWorkflowTypes,
  buildStateTransitionAction,
} from '../../risk-engine/audit-logs/constants/audit-actions.constant';
import { AuditTriggerType } from '../../risk-engine/audit-logs/dto/audit-log.dto';
import {
  CancelFeeOccurrenceDto,
  CreateFeeOccurrenceDto,
  FeeOccurrenceQueryDto,
  FeeOccurrenceStatus,
  FeeOccurrenceType,
  FeeType,
} from './dto/fee-occurrence.dto';

@Injectable()
export class FeeOccurrencesService {
  private readonly auditLogsService: AuditLogsService;

  constructor(
    private readonly prisma: PrismaService,
    private readonly reimbursementObligationsService: ReimbursementObligationsService,
  ) {
    this.auditLogsService = new AuditLogsService(prisma);
  }

  private resolveAutomaticFeeType(assetType?: string | null) {
    return String(assetType || '').toUpperCase() === 'FIAT'
      ? FeeType.INTERNAL_BANK_FEE
      : FeeType.INTERNAL_TRANSFER_GAS;
  }

  private hasInternalFundCostEvidence(item: any) {
    const feeAmount = new Prisma.Decimal(item?.feeAmount || 0);
    return (
      feeAmount.gt(0) ||
      Boolean(item?.gasUsed) ||
      Boolean(item?.effectiveGasPrice)
    );
  }

  private deriveReimbursementContext(input: {
    poolRole?: string | null;
    sourceWallet?: any;
  }) {
    const explicitRole = String(input.poolRole || '').trim().toUpperCase();
    if (
      explicitRole === 'DEPOSIT' ||
      explicitRole === 'MASTER' ||
      explicitRole === 'PAYOUT' ||
      explicitRole === 'CUST_BANK'
    ) {
      return {
        reimbursementImpact: 'SAFEGUARDED_POOL',
        poolRole: explicitRole,
      };
    }

    const wallet = input.sourceWallet;
    const walletRole = String(wallet?.walletRole || '').trim().toUpperCase();
    if (walletRole === 'MASTER' || walletRole === 'PAYOUT' || walletRole === 'CUST_BANK') {
      return {
        reimbursementImpact: 'SAFEGUARDED_POOL',
        poolRole: walletRole,
      };
    }

    if (wallet && classifyWalletSurface(wallet) === 'CUSTOMER_DEPOSIT') {
      return {
        reimbursementImpact: 'SAFEGUARDED_POOL',
        poolRole: 'DEPOSIT',
      };
    }

    return {
      reimbursementImpact: 'NONE',
      poolRole: explicitRole || (isProtectedPoolWalletRole(walletRole) ? walletRole : null),
    };
  }

  private buildTraceIdFromInternalFund(item: any) {
    if (String(item?.internalTransaction?.sourceType || '').toUpperCase() === 'DEPOSIT') {
      const sourceId = item?.internalTransaction?.sourceId;
      if (sourceId) return `${AuditWorkflowTypes.DEPOSIT}:${sourceId}`;
    }
    if (item?.internalTransaction?.id) {
      return `${AuditWorkflowTypes.TRANSACTION}:${item.internalTransaction.id}`;
    }
    return null;
  }

  private async recordAudit(
    input: {
      action: string;
      entityId: string;
      entityNo?: string | null;
      statusFrom?: string | null;
      statusTo?: string | null;
      reason?: string | null;
      beforeData?: Record<string, unknown>;
      afterData?: Record<string, unknown>;
      traceId?: string | null;
    },
    operatorId: string,
    db: any,
  ) {
    await this.auditLogsService.recordByActor(
      {
        triggerType:
          input.statusFrom || input.statusTo
            ? AuditTriggerType.STATE_TRANSITION
            : AuditTriggerType.DATA_CREATE,
        action: input.action,
        module: AuditModules.FEE_OCCURRENCES,
        entityType: AuditEntityTypes.FEE_OCCURRENCE,
        entityId: input.entityId,
        entityNo: input.entityNo || undefined,
        statusFrom: input.statusFrom || undefined,
        statusTo: input.statusTo || undefined,
        reason: input.reason || undefined,
        beforeData: input.beforeData,
        afterData: input.afterData,
        traceId: input.traceId || undefined,
        sourcePlatform: operatorId === 'SYSTEM' ? 'SYSTEM' : 'ADMIN_API',
      },
      {
        actorType: operatorId === 'SYSTEM' ? 'SYSTEM' : 'ADMIN',
        actorId: operatorId,
        actorRole: operatorId === 'SYSTEM' ? 'SYSTEM' : 'ADMIN',
      },
      db,
    );
  }

  async captureFromInternalFund(item: any, operatorId = 'SYSTEM', tx?: any) {
    if (!this.hasInternalFundCostEvidence(item)) {
      return null;
    }

    const db = tx || this.prisma;
    const reimbursement = this.deriveReimbursementContext({
      sourceWallet: item.fromWallet,
    });
    const feeType = this.resolveAutomaticFeeType(item?.asset?.type);
    const idempotencyKey = `INTERNAL_FUND:${item.id}:${feeType}`;
    const amount = new Prisma.Decimal(item.feeAmount || 0);
    const metadata = JSON.stringify({
      internalFundId: item.id,
      internalTransactionId: item.internalTransaction?.id || null,
      txHash: item.txHash || null,
      providerTxnId: item.providerTxnId || null,
      gasUsed: item.gasUsed || null,
      effectiveGasPrice: item.effectiveGasPrice || null,
      referenceNo: item.referenceNo || null,
    });

    const occurrence = await (db as any).feeOccurrence.upsert({
      where: { idempotencyKey },
      update: {
        status: FeeOccurrenceStatus.RECORDED,
        assetId: item.assetId,
        amount,
        sourceWalletId: item.fromWalletId || null,
        sourceAccountRef: item.fromIban || item.fromAddress || null,
        reimbursementImpact: reimbursement.reimbursementImpact,
        poolRole: reimbursement.poolRole,
        relatedEntityType: 'INTERNAL_TRANSACTION',
        relatedEntityId: item.internalTransaction?.id || null,
        relatedEntityNo: item.internalTransaction?.internalTxNo || null,
        evidenceRef: item.txHash || item.providerTxnId || item.referenceNo || item.internalFundNo,
        traceId: this.buildTraceIdFromInternalFund(item),
        metadata,
        cancelledAt: null,
      },
      create: {
        feeNo: generateReferenceNo('FEE'),
        feeType,
        occurrenceType: FeeOccurrenceType.DIRECT,
        status: FeeOccurrenceStatus.RECORDED,
        assetId: item.assetId,
        amount,
        payer: 'PLATFORM',
        chargedToCustomer: false,
        sourceEntityType: 'INTERNAL_FUND',
        sourceEntityId: item.id,
        sourceEntityNo: item.internalFundNo || null,
        sourceWalletId: item.fromWalletId || null,
        sourceAccountRef: item.fromIban || item.fromAddress || null,
        relatedEntityType: 'INTERNAL_TRANSACTION',
        relatedEntityId: item.internalTransaction?.id || null,
        relatedEntityNo: item.internalTransaction?.internalTxNo || null,
        reimbursementImpact: reimbursement.reimbursementImpact,
        poolRole: reimbursement.poolRole,
        evidenceRef: item.txHash || item.providerTxnId || item.referenceNo || item.internalFundNo,
        traceId: this.buildTraceIdFromInternalFund(item),
        idempotencyKey,
        metadata,
      },
    });

    await this.recordAudit(
      {
        action: AuditActions.FEE_OCCURRENCE_RECORDED,
        entityId: occurrence.id,
        entityNo: occurrence.feeNo,
        reason: 'Captured from internal fund execution evidence',
        afterData: {
          feeType: occurrence.feeType,
          occurrenceType: occurrence.occurrenceType,
          reimbursementImpact: occurrence.reimbursementImpact,
        },
        traceId: occurrence.traceId,
      },
      operatorId,
      db,
    );

    await this.reimbursementObligationsService.syncForOccurrence(
      occurrence,
      operatorId,
      db,
    );

    return occurrence;
  }

  async recordManual(dto: CreateFeeOccurrenceDto, operatorId = 'SYSTEM') {
    return (this.prisma as any).$transaction(async (db: any) => {
      let sourceWallet: any = null;
      if (dto.sourceWalletId) {
        sourceWallet = await db.wallet.findUnique({
          where: { id: dto.sourceWalletId },
        });
      }

      const reimbursement = this.deriveReimbursementContext({
        poolRole: dto.poolRole,
        sourceWallet,
      });

      if (dto.chargedToCustomer === true) {
        throw new BadRequestException(
          'WF-19 fee occurrences must remain platform-borne in v1',
        );
      }

      const created = await db.feeOccurrence.create({
        data: {
          feeNo: generateReferenceNo('FEE'),
          feeType: dto.feeType,
          occurrenceType: dto.occurrenceType,
          status: FeeOccurrenceStatus.RECORDED,
          assetId: dto.assetId,
          amount: new Prisma.Decimal(dto.amount),
          payer: 'PLATFORM',
          chargedToCustomer: false,
          sourceEntityType: dto.sourceEntityType || null,
          sourceEntityId: dto.sourceEntityId || null,
          sourceEntityNo: dto.sourceEntityNo || null,
          sourceWalletId: dto.sourceWalletId || null,
          sourceAccountRef: dto.sourceAccountRef || null,
          relatedEntityType: dto.relatedEntityType || null,
          relatedEntityId: dto.relatedEntityId || null,
          relatedEntityNo: dto.relatedEntityNo || null,
          reimbursementImpact: reimbursement.reimbursementImpact,
          poolRole: reimbursement.poolRole,
          periodStart: dto.periodStart ? new Date(dto.periodStart) : null,
          periodEnd: dto.periodEnd ? new Date(dto.periodEnd) : null,
          evidenceRef: dto.evidenceRef || null,
          traceId: dto.traceId || null,
          metadata:
            dto.metadata === undefined ? null : JSON.stringify(dto.metadata),
        },
      });

      await this.recordAudit(
        {
          action: AuditActions.FEE_OCCURRENCE_RECORDED,
          entityId: created.id,
          entityNo: created.feeNo,
          reason: 'Manual fee occurrence recorded',
          afterData: {
            feeType: created.feeType,
            occurrenceType: created.occurrenceType,
            reimbursementImpact: created.reimbursementImpact,
          },
          traceId: created.traceId,
        },
        operatorId,
        db,
      );

      await this.reimbursementObligationsService.syncForOccurrence(
        created,
        operatorId,
        db,
      );

      return created;
    });
  }

  async cancel(
    id: string,
    reasonOrDto: string | CancelFeeOccurrenceDto,
    operatorId = 'SYSTEM',
  ) {
    const dto =
      typeof reasonOrDto === 'string' ? { reason: reasonOrDto } : reasonOrDto;
    const current = await (this.prisma as any).feeOccurrence.findUnique({
      where: { id },
    });
    if (!current) {
      throw new NotFoundException('Fee occurrence not found');
    }
    if (current.status === FeeOccurrenceStatus.CANCELLED) {
      return current;
    }

    const updated = await (this.prisma as any).$transaction(async (db: any) => {
      const row = await db.feeOccurrence.update({
        where: { id },
        data: {
          status: FeeOccurrenceStatus.CANCELLED,
          cancelledAt: new Date(),
        },
      });

      await this.reimbursementObligationsService.cancelOpenForOccurrence(
        id,
        dto.reason || 'Fee occurrence cancelled',
        operatorId,
        db,
      );

      await this.recordAudit(
        {
          action: buildStateTransitionAction(
            'FEE_OCCURRENCE',
            current.status,
            row.status,
          ),
          entityId: row.id,
          entityNo: row.feeNo,
          statusFrom: current.status,
          statusTo: row.status,
          reason: dto.reason || 'Fee occurrence cancelled',
          beforeData: { status: current.status },
          afterData: { status: row.status },
          traceId: row.traceId,
        },
        operatorId,
        db,
      );

      return row;
    });

    return updated;
  }

  async findAllForAdmin(query: FeeOccurrenceQueryDto) {
    const { skip = '0', take = '20', status, feeType, occurrenceType, assetId } =
      query;
    const where: any = {};
    if (status) where.status = status;
    if (feeType) where.feeType = feeType;
    if (occurrenceType) where.occurrenceType = occurrenceType;
    if (assetId) where.assetId = assetId;

    const [items, total] = await Promise.all([
      (this.prisma as any).feeOccurrence.findMany({
        where,
        skip: Number(skip),
        take: Number(take),
        orderBy: { createdAt: 'desc' },
        include: {
          asset: true,
          sourceWallet: true,
          reimbursementObligation: true,
        },
      }),
      (this.prisma as any).feeOccurrence.count({ where }),
    ]);

    return { items, total };
  }

  async findOneForAdmin(id: string) {
    const item = await (this.prisma as any).feeOccurrence.findUnique({
      where: { id },
      include: {
        asset: true,
        sourceWallet: true,
        reimbursementObligation: true,
      },
    });
    if (!item) {
      throw new NotFoundException('Fee occurrence not found');
    }
    return item;
  }
}
