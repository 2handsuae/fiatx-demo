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
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import {
  AuditActions,
  AuditEntityTypes,
  AuditModules,
  AuditWorkflowTypes,
  buildStateTransitionAction,
} from '../../audit-logging/constants/audit-actions.constant';
import { AuditTriggerType } from '../../audit-logging/dto/audit-log.dto';
import {
  CancelFeeOccurrenceDto,
  CreateFeeOccurrenceDto,
  FeeOccurrenceQueryDto,
  FeeOccurrenceStatus,
  FeeType,
} from './dto/fee-occurrence.dto';

type AutomaticFeeTemplate = {
  feeType: FeeType;
  minMinorUnits: number;
  maxMinorUnits: number;
};

@Injectable()
export class FeeOccurrencesService {
  private static readonly PAYOUT_CRYPTO_TEMPLATES: AutomaticFeeTemplate[] = [
    { feeType: FeeType.NETWORK_GAS, minMinorUnits: 2000, maxMinorUnits: 12000 },
    { feeType: FeeType.CUSTODY_FEE, minMinorUnits: 500, maxMinorUnits: 4000 },
  ];
  private static readonly PAYOUT_FIAT_TEMPLATES: AutomaticFeeTemplate[] = [
    { feeType: FeeType.BANK_TRANSFER_FEE, minMinorUnits: 500, maxMinorUnits: 3500 },
  ];
  private static readonly INTERNAL_FUND_CRYPTO_TEMPLATES: AutomaticFeeTemplate[] = [
    { feeType: FeeType.INTERNAL_TRANSFER_GAS, minMinorUnits: 1000, maxMinorUnits: 8000 },
    { feeType: FeeType.CUSTODY_FEE, minMinorUnits: 250, maxMinorUnits: 2000 },
  ];
  private static readonly INTERNAL_FUND_FIAT_TEMPLATES: AutomaticFeeTemplate[] = [
    { feeType: FeeType.INTERNAL_BANK_FEE, minMinorUnits: 100, maxMinorUnits: 1500 },
  ];

  constructor(
    private readonly prisma: PrismaService,
    private readonly reimbursementObligationsService: ReimbursementObligationsService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  private normalizeAssetType(assetType?: string | null) {
    return String(assetType || '').trim().toUpperCase();
  }

  private stableHash(seed: string) {
    let hash = 2166136261;
    for (let index = 0; index < seed.length; index += 1) {
      hash ^= seed.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  private generateMinorUnits(
    seed: string,
    minMinorUnits: number,
    maxMinorUnits: number,
  ) {
    if (maxMinorUnits <= minMinorUnits) return minMinorUnits;
    const span = maxMinorUnits - minMinorUnits + 1;
    return minMinorUnits + (this.stableHash(seed) % span);
  }

  private toAmountDecimal(minorUnits: number, decimals?: number | null) {
    const safeDecimals = Math.max(0, Number(decimals || 0));
    const divisor = new Prisma.Decimal(10).pow(safeDecimals);
    const normalizedMinorUnits = Math.max(1, Math.trunc(minorUnits));
    return new Prisma.Decimal(normalizedMinorUnits).div(divisor);
  }

  private buildAutomaticTemplates(
    entityKind: 'INTERNAL_FUND' | 'PAYOUT',
    assetType?: string | null,
  ) {
    const normalizedAssetType = this.normalizeAssetType(assetType);
    if (entityKind === 'PAYOUT') {
      return normalizedAssetType === 'FIAT'
        ? FeeOccurrencesService.PAYOUT_FIAT_TEMPLATES
        : FeeOccurrencesService.PAYOUT_CRYPTO_TEMPLATES;
    }
    return normalizedAssetType === 'FIAT'
      ? FeeOccurrencesService.INTERNAL_FUND_FIAT_TEMPLATES
      : FeeOccurrencesService.INTERNAL_FUND_CRYPTO_TEMPLATES;
  }

  private buildTraceIdFromPayout(item: any) {
    if (item?.withdrawId) {
      return `${AuditWorkflowTypes.WITHDRAW}:${item.withdrawId}`;
    }
    return null;
  }

  private stringifyMetadata(metadata: Record<string, unknown>) {
    return JSON.stringify(metadata);
  }

  private async upsertAutomaticOccurrence(
    input: {
      idempotencyKey: string;
      feeType: FeeType;
      amount: Prisma.Decimal;
      assetId: string;
      sourceEntityType: string;
      sourceEntityId: string;
      sourceEntityNo?: string | null;
      sourceWalletId?: string | null;
      sourceAccountRef?: string | null;
      relatedEntityType?: string | null;
      relatedEntityId?: string | null;
      relatedEntityNo?: string | null;
      reimbursementImpact: string;
      poolRole?: string | null;
      evidenceRef?: string | null;
      traceId?: string | null;
      metadata: string;
    },
    operatorId: string,
    db: any,
    reason: string,
  ) {
    const occurrence = await (db as any).feeOccurrence.upsert({
      where: { idempotencyKey: input.idempotencyKey },
      update: {
        status: FeeOccurrenceStatus.RECORDED,
        assetId: input.assetId,
        amount: input.amount,
        sourceWalletId: input.sourceWalletId || null,
        sourceAccountRef: input.sourceAccountRef || null,
        reimbursementImpact: input.reimbursementImpact,
        poolRole: input.poolRole || null,
        relatedEntityType: input.relatedEntityType || null,
        relatedEntityId: input.relatedEntityId || null,
        relatedEntityNo: input.relatedEntityNo || null,
        evidenceRef: input.evidenceRef || null,
        traceId: input.traceId || null,
        metadata: input.metadata,
        cancelledAt: null,
      },
      create: {
        feeNo: generateReferenceNo('FEE'),
        feeType: input.feeType,
        status: FeeOccurrenceStatus.RECORDED,
        assetId: input.assetId,
        amount: input.amount,
        payer: 'PLATFORM',
        chargedToCustomer: false,
        sourceEntityType: input.sourceEntityType,
        sourceEntityId: input.sourceEntityId,
        sourceEntityNo: input.sourceEntityNo || null,
        sourceWalletId: input.sourceWalletId || null,
        sourceAccountRef: input.sourceAccountRef || null,
        relatedEntityType: input.relatedEntityType || null,
        relatedEntityId: input.relatedEntityId || null,
        relatedEntityNo: input.relatedEntityNo || null,
        reimbursementImpact: input.reimbursementImpact,
        poolRole: input.poolRole || null,
        evidenceRef: input.evidenceRef || null,
        traceId: input.traceId || null,
        idempotencyKey: input.idempotencyKey,
        metadata: input.metadata,
      },
    });

    await this.recordAudit(
      {
        action: AuditActions.FEE_OCCURRENCE_RECORDED,
        entityId: occurrence.id,
        entityNo: occurrence.feeNo,
        reason,
        afterData: {
          feeType: occurrence.feeType,
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
    const db = tx || this.prisma;
    const reimbursement = this.deriveReimbursementContext({
      sourceWallet: item.fromWallet,
    });
    const templates = this.buildAutomaticTemplates(
      'INTERNAL_FUND',
      item?.asset?.type,
    );
    const assetDecimals = Number(item?.asset?.decimals || 0);
    const traceId = this.buildTraceIdFromInternalFund(item);
    const evidenceRef =
      item.txHash || item.providerTxnId || item.referenceNo || item.internalFundNo;

    const occurrences = [];
    for (const template of templates) {
      const amount = this.toAmountDecimal(
        this.generateMinorUnits(
          `INTERNAL_FUND:${item.id}:${template.feeType}`,
          template.minMinorUnits,
          template.maxMinorUnits,
        ),
        assetDecimals,
      );
      const metadata = this.stringifyMetadata({
        generatedBy: 'stable-pseudo-random',
        entityKind: 'INTERNAL_FUND',
        feeType: template.feeType,
        internalFundId: item.id,
        internalTransactionId: item.internalTransaction?.id || null,
        txHash: item.txHash || null,
        providerTxnId: item.providerTxnId || null,
        referenceNo: item.referenceNo || null,
      });
      const occurrence = await this.upsertAutomaticOccurrence(
        {
          idempotencyKey: `INTERNAL_FUND:${item.id}:${template.feeType}`,
          feeType: template.feeType,
          amount,
          assetId: item.assetId || item.asset?.id,
          sourceEntityType: 'INTERNAL_FUND',
          sourceEntityId: item.id,
          sourceEntityNo: item.internalFundNo || null,
          sourceWalletId: item.fromWalletId || item.fromWallet?.id || null,
          sourceAccountRef: item.fromIban || item.fromAddress || null,
          relatedEntityType: 'INTERNAL_TRANSACTION',
          relatedEntityId: item.internalTransaction?.id || null,
          relatedEntityNo: item.internalTransaction?.internalTxNo || null,
          reimbursementImpact: reimbursement.reimbursementImpact,
          poolRole: reimbursement.poolRole,
          evidenceRef,
          traceId,
          metadata,
        },
        operatorId,
        db,
        'Captured from confirmed internal fund execution',
      );
      occurrences.push(occurrence);
    }

    return occurrences;
  }

  async captureFromPayout(item: any, operatorId = 'SYSTEM', tx?: any) {
    const db = tx || this.prisma;
    const sourceWallet = item.sourceWallet || item.withdraw?.fromWallet || null;
    const reimbursement = this.deriveReimbursementContext({
      sourceWallet,
    });
    const templates = this.buildAutomaticTemplates('PAYOUT', item?.asset?.type);
    const assetDecimals = Number(item?.asset?.decimals || 0);
    const traceId = item.traceId || this.buildTraceIdFromPayout(item);
    const evidenceRef =
      item.evidenceRef ||
      item.txHash ||
      item.providerTxnId ||
      item.referenceNo ||
      item.payoutNo;

    const occurrences = [];
    for (const template of templates) {
      const amount = this.toAmountDecimal(
        this.generateMinorUnits(
          `PAYOUT:${item.id}:${template.feeType}`,
          template.minMinorUnits,
          template.maxMinorUnits,
        ),
        assetDecimals,
      );
      const metadata = this.stringifyMetadata({
        generatedBy: 'stable-pseudo-random',
        entityKind: 'PAYOUT',
        feeType: template.feeType,
        payoutId: item.id,
        withdrawId: item.withdrawId || item.withdraw?.id || null,
        txHash: item.txHash || null,
        providerTxnId: item.providerTxnId || null,
        referenceNo: item.referenceNo || null,
      });
      const occurrence = await this.upsertAutomaticOccurrence(
        {
          idempotencyKey: `PAYOUT:${item.id}:${template.feeType}`,
          feeType: template.feeType,
          amount,
          assetId: item.assetId || item.asset?.id,
          sourceEntityType: 'PAYOUT',
          sourceEntityId: item.id,
          sourceEntityNo: item.payoutNo || null,
          sourceWalletId: item.withdraw?.fromWalletId || sourceWallet?.id || null,
          sourceAccountRef:
            item.fromIban ||
            item.fromAddress ||
            item.withdraw?.fromIban ||
            item.withdraw?.fromAddress ||
            null,
          relatedEntityType: 'WITHDRAW_TRANSACTION',
          relatedEntityId: item.withdrawId || item.withdraw?.id || null,
          relatedEntityNo: item.withdraw?.withdrawNo || null,
          reimbursementImpact: reimbursement.reimbursementImpact,
          poolRole: reimbursement.poolRole,
          evidenceRef,
          traceId,
          metadata,
        },
        operatorId,
        db,
        'Captured from confirmed payout execution',
      );
      occurrences.push(occurrence);
    }

    return occurrences;
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
    const { skip = '0', take = '20', status, feeType, assetId } =
      query;
    const where: any = {};
    if (status) where.status = status;
    if (feeType) where.feeType = feeType;
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
