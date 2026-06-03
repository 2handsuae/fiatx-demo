import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import {
  AuditEntityTypes,
  buildStateTransitionAction,
} from '../../audit-logging/constants/audit-actions.constant';
import {
  ReimbursementObligationQueryDto,
  ReimbursementObligationStatus,
  UpdateReimbursementObligationStatusDto,
} from './dto/reimbursement-obligation.dto';

@Injectable()
export class ReimbursementObligationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

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

        action: buildStateTransitionAction(
          'REIMBURSEMENT_OBLIGATION',
          current.status,
          updated.status,
        ),
        entityType: AuditEntityTypes.REIMBURSEMENT_OBLIGATION,
        entityId: updated.id,
        entityNo: updated.obligationNo,
        reason: dto.reason || undefined,
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
