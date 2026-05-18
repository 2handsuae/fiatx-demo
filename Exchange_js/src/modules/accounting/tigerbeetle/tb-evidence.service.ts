// src/modules/accounting/tigerbeetle/tb-evidence.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { Prisma } from '@prisma/client';

interface WriteEvidenceParams {
  tbTransferId: string;
  sourceType: string;
  sourceNo: string;
  eventCode: string;
  debitCode: string;
  creditCode: string;
  amount: number | Prisma.Decimal;
  assetCurrency: string;
  traceId: string;
  actorType: string;
  actorId: string;
  memo?: string;
  pendingId?: string;
  transferType?: string;
}

@Injectable()
export class TbEvidenceService {
  private readonly logger = new Logger(TbEvidenceService.name);

  constructor(private readonly prisma: PrismaService) {}

  async writeEvidence(params: WriteEvidenceParams, tx?: Prisma.TransactionClient): Promise<void> {
    const client = tx ?? this.prisma;
    try {
      await (client as any).tbTransferEvidence.create({
        data: {
          tbTransferId: params.tbTransferId,
          sourceType: params.sourceType,
          sourceNo: params.sourceNo,
          eventCode: params.eventCode,
          debitCode: params.debitCode,
          creditCode: params.creditCode,
          amount: params.amount,
          assetCode: params.assetCurrency,
          traceId: params.traceId,
          actorType: params.actorType,
          actorId: params.actorId,
          memo: params.memo ?? null,
          pendingId: params.pendingId ?? null,
          transferType: params.transferType ?? 'POSTED',
        },
      });
    } catch (error: any) {
      this.logger.error(`Evidence write failed for transfer ${params.tbTransferId}: ${error.message}`);
      await this.writeToBacklog(params, error.message);
      throw error;
    }
  }

  private async writeToBacklog(params: WriteEvidenceParams, errorMessage: string): Promise<void> {
    try {
      await (this.prisma as any).tbEvidenceBacklog.create({
        data: {
          tbTransferId: params.tbTransferId,
          transferData: JSON.stringify({
            sourceType: params.sourceType,
            sourceNo: params.sourceNo,
            eventCode: params.eventCode,
          }),
          evidenceData: JSON.stringify(params),
          errorMessage,
          status: 'PENDING',
        },
      });
    } catch (backlogError: any) {
      this.logger.error(`CRITICAL: Evidence backlog write also failed for ${params.tbTransferId}: ${backlogError.message}`);
    }
  }

  async findBySource(sourceType: string, sourceNo: string) {
    return (this.prisma as any).tbTransferEvidence.findMany({
      where: { sourceType, sourceNo },
      orderBy: { createdAt: 'asc' },
    });
  }

  async findByTraceId(traceId: string) {
    return (this.prisma as any).tbTransferEvidence.findMany({
      where: { traceId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async findOne(tbTransferId: string) {
    return (this.prisma as any).tbTransferEvidence.findUnique({
      where: { tbTransferId },
    });
  }

  async findAll(filters: {
    sourceType?: string;
    assetCurrency?: string;
    eventCode?: string;
    transferType?: string;
    actorType?: string;
    actorId?: string;
    skip?: number;
    take?: number;
  }) {
    const where: any = {};
    if (filters.sourceType) where.sourceType = filters.sourceType;
    if (filters.assetCurrency) where.assetCode = filters.assetCurrency;
    if (filters.eventCode) where.eventCode = filters.eventCode;
    if (filters.transferType) where.transferType = filters.transferType;
    if (filters.actorType) where.actorType = filters.actorType;
    if (filters.actorId) where.actorId = filters.actorId;

    const [items, total] = await Promise.all([
      (this.prisma as any).tbTransferEvidence.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: filters.skip ?? 0,
        take: filters.take ?? 50,
      }),
      (this.prisma as any).tbTransferEvidence.count({ where }),
    ]);

    return { items, total };
  }

  async findBacklog(filters: {
    status?: string;
    skip?: number;
    take?: number;
  }) {
    const where: any = {};
    if (filters.status) where.status = filters.status;

    const [items, total] = await Promise.all([
      (this.prisma as any).tbEvidenceBacklog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: filters.skip ?? 0,
        take: filters.take ?? 50,
      }),
      (this.prisma as any).tbEvidenceBacklog.count({ where }),
    ]);

    return { items, total };
  }
}
