import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { generateReferenceNo } from '../../../common/utils/no-generator.util';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import {
  AuditActions,
  AuditEntityTypes,
  AuditModules,
  buildStateTransitionAction,
} from '../../audit-logging/constants/audit-actions.constant';
import { AuditTriggerType } from '../../audit-logging/dto/audit-log.dto';
import {
  ReimbursementObligationQueryDto,
  ReimbursementObligationStatus,
  UpdateReimbursementObligationStatusDto,
} from './dto/reimbursement-obligation.dto';

@Injectable()
export class ReimbursementObligationsService {
  private readonly auditLogsService: AuditLogsService;

  constructor(private readonly prisma: PrismaService) {
    this.auditLogsService = new AuditLogsService(prisma);
  }

  async findOpenForPoolSettlementBatch(tx?: any) {
    const db = tx || this.prisma;
    const rows = await (db as any).reimbursementObligation.findMany({
      where: {
        status: 'OPEN',
        lockedByPoolSettlementBatchId: null,
      },
      select: {
        id: true,
        obligationNo: true,
        amount: true,
        assetId: true,
        poolRole: true,
        sourceWalletId: true,
        asset: {
          select: {
            id: true,
            code: true,
            type: true,
            network: true,
          },
        },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

    return rows.filter((row: any) => !row.lockedByPoolSettlementBatchId);
  }

  async findLockedForPoolSettlementBatch(batchId: string, tx?: any) {
    const db = tx || this.prisma;
    return (db as any).reimbursementObligation.findMany({
      where: {
        status: 'OPEN',
        lockedByPoolSettlementBatchId: batchId,
      },
      select: {
        id: true,
        obligationNo: true,
        amount: true,
        assetId: true,
        poolRole: true,
        sourceWalletId: true,
        asset: {
          select: {
            id: true,
            code: true,
            type: true,
            network: true,
          },
        },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  }

  async lockForPoolSettlementBatch(
    reimbursementIds: string[],
    batchId: string,
    tx?: any,
  ) {
    if (!reimbursementIds.length) return { count: 0 };

    const db = tx || this.prisma;
    return (db as any).reimbursementObligation.updateMany({
      where: {
        id: { in: reimbursementIds },
        status: 'OPEN',
        lockedByPoolSettlementBatchId: null,
      },
      data: {
        lockedByPoolSettlementBatchId: batchId,
      },
    });
  }

  async syncForOccurrence(item: any, operatorId = 'SYSTEM', tx?: any) {
    if (String(item?.reimbursementImpact || '').toUpperCase() !== 'SAFEGUARDED_POOL') {
      return null;
    }

    const db = tx || this.prisma;
    const actorType = operatorId === 'SYSTEM' ? 'SYSTEM' : 'ADMIN';
    const obligation = await (db as any).reimbursementObligation.upsert({
      where: { feeOccurrenceId: item.id },
      update: {
        assetId: item.assetId,
        amount: item.amount,
        poolRole: item.poolRole || null,
        sourceWalletId: item.sourceWalletId || null,
        sourceAccountRef: item.sourceAccountRef || null,
        reason: item.reason || null,
        traceId: item.traceId || null,
        metadata: item.metadata || null,
      },
      create: {
        obligationNo: generateReferenceNo('ROB'),
        feeOccurrenceId: item.id,
        status: ReimbursementObligationStatus.OPEN,
        assetId: item.assetId,
        amount: item.amount,
        poolRole: item.poolRole || null,
        sourceWalletId: item.sourceWalletId || null,
        sourceAccountRef: item.sourceAccountRef || null,
        reason: item.reason || `Platform reimbursement required for ${item.feeNo || item.id}`,
        traceId: item.traceId || null,
        metadata: item.metadata || null,
      },
    });

    await this.auditLogsService.recordByActor(
      {
        triggerType: AuditTriggerType.DATA_CREATE,
        action: AuditActions.REIMBURSEMENT_OBLIGATION_OPENED,
        module: AuditModules.REIMBURSEMENT_OBLIGATIONS,
        entityType: AuditEntityTypes.REIMBURSEMENT_OBLIGATION,
        entityId: obligation.id,
        entityNo: obligation.obligationNo,
        reason: obligation.reason || 'Reimbursement obligation opened',
        afterData: {
          status: obligation.status,
          feeOccurrenceId: obligation.feeOccurrenceId,
        },
        traceId: obligation.traceId || null,
        sourcePlatform: actorType === 'SYSTEM' ? 'SYSTEM' : 'ADMIN_API',
      },
      {
        actorType,
        actorId: operatorId,
        actorRole: actorType,
      },
      db,
    );

    return obligation;
  }

  async cancelOpenForOccurrence(
    feeOccurrenceId: string,
    reason: string,
    operatorId = 'SYSTEM',
    tx?: any,
  ) {
    const db = tx || this.prisma;
    const current = await (db as any).reimbursementObligation.findUnique({
      where: { feeOccurrenceId },
    });
    if (!current || current.status !== ReimbursementObligationStatus.OPEN) {
      return null;
    }

    const updated = await (db as any).reimbursementObligation.update({
      where: { feeOccurrenceId },
      data: {
        status: ReimbursementObligationStatus.CANCELLED,
        reason,
        cancelledAt: new Date(),
      },
    });

    await this.auditLogsService.recordByActor(
      {
        triggerType: AuditTriggerType.STATE_TRANSITION,
        action: buildStateTransitionAction(
          'REIMBURSEMENT_OBLIGATION',
          current.status,
          updated.status,
        ),
        module: AuditModules.REIMBURSEMENT_OBLIGATIONS,
        entityType: AuditEntityTypes.REIMBURSEMENT_OBLIGATION,
        entityId: updated.id,
        entityNo: updated.obligationNo,
        statusFrom: current.status,
        statusTo: updated.status,
        reason,
        beforeData: { status: current.status },
        afterData: { status: updated.status },
        traceId: updated.traceId || null,
        sourcePlatform: operatorId === 'SYSTEM' ? 'SYSTEM' : 'ADMIN_API',
      },
      {
        actorType: operatorId === 'SYSTEM' ? 'SYSTEM' : 'ADMIN',
        actorId: operatorId,
        actorRole: operatorId === 'SYSTEM' ? 'SYSTEM' : 'ADMIN',
      },
      db,
    );

    return updated;
  }

  async findAllForAdmin(query: ReimbursementObligationQueryDto) {
    const { skip = '0', take = '20', status, assetId, poolRole } = query;
    const where: any = {};
    if (status) where.status = status;
    if (assetId) where.assetId = assetId;
    if (poolRole) where.poolRole = poolRole;

    const [items, total] = await Promise.all([
      (this.prisma as any).reimbursementObligation.findMany({
        where,
        skip: Number(skip),
        take: Number(take),
        orderBy: { createdAt: 'desc' },
        include: {
          asset: true,
          sourceWallet: true,
          feeOccurrence: true,
          settlementInternalTransaction: true,
        },
      }),
      (this.prisma as any).reimbursementObligation.count({ where }),
    ]);

    return { items, total };
  }

  async findOneForAdmin(id: string) {
    const item = await (this.prisma as any).reimbursementObligation.findUnique({
      where: { id },
      include: {
        asset: true,
        sourceWallet: true,
        feeOccurrence: true,
        settlementInternalTransaction: true,
      },
    });
    if (!item) {
      throw new NotFoundException('Reimbursement obligation not found');
    }
    return item;
  }

  async updateStatus(
    id: string,
    dto: UpdateReimbursementObligationStatusDto,
    operatorId = 'SYSTEM',
  ) {
    const current = await (this.prisma as any).reimbursementObligation.findUnique({
      where: { id },
    });
    if (!current) {
      throw new NotFoundException('Reimbursement obligation not found');
    }

    if (
      dto.status === ReimbursementObligationStatus.OPEN &&
      current.status !== ReimbursementObligationStatus.OPEN
    ) {
      throw new BadRequestException('Cannot reopen reimbursement obligation');
    }

    const updateData: any = {
      status: dto.status,
      reason: dto.reason ?? current.reason ?? null,
    };
    if (dto.settlementInternalTransactionId !== undefined) {
      updateData.settlementInternalTransactionId =
        dto.settlementInternalTransactionId || null;
    }
    if (dto.settlementReferenceNo !== undefined) {
      updateData.settlementReferenceNo = dto.settlementReferenceNo || null;
    }
    if (dto.status === ReimbursementObligationStatus.REIMBURSED) {
      updateData.reimbursedAt = new Date();
    }
    if (dto.status === ReimbursementObligationStatus.CANCELLED) {
      updateData.cancelledAt = new Date();
    }

    const updated = await (this.prisma as any).reimbursementObligation.update({
      where: { id },
      data: updateData,
    });

    await this.auditLogsService.recordByActor(
      {
        triggerType: AuditTriggerType.STATE_TRANSITION,
        action: buildStateTransitionAction(
          'REIMBURSEMENT_OBLIGATION',
          current.status,
          updated.status,
        ),
        module: AuditModules.REIMBURSEMENT_OBLIGATIONS,
        entityType: AuditEntityTypes.REIMBURSEMENT_OBLIGATION,
        entityId: updated.id,
        entityNo: updated.obligationNo,
        statusFrom: current.status,
        statusTo: updated.status,
        reason: dto.reason || undefined,
        beforeData: { status: current.status },
        afterData: { status: updated.status },
        traceId: updated.traceId || null,
        sourcePlatform: operatorId === 'SYSTEM' ? 'SYSTEM' : 'ADMIN_API',
      },
      {
        actorType: operatorId === 'SYSTEM' ? 'SYSTEM' : 'ADMIN',
        actorId: operatorId,
        actorRole: operatorId === 'SYSTEM' ? 'SYSTEM' : 'ADMIN',
      },
      this.prisma,
    );

    return updated;
  }
}
