// src/modules/accounting/tigerbeetle/tb-evidence.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { COA_TO_TB_CODE, isAssetCode } from './constants/tb-account-codes.constant';

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
  debitTbAccountId?: string;
  creditTbAccountId?: string;
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
          debitTbAccountId: params.debitTbAccountId ?? null,
          creditTbAccountId: params.creditTbAccountId ?? null,
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

  async updateTransferType(
    tbTransferId: string,
    newTransferType: string,
    postTbTransferId?: string,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const client = tx ?? this.prisma;
    const data: any = { transferType: newTransferType };
    if (postTbTransferId) data.pendingId = postTbTransferId;
    await (client as any).tbTransferEvidence.update({
      where: { tbTransferId },
      data,
    });
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
    q?: string;
    coa?: string;
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

    const and: any[] = [];
    const q = filters.q?.trim();
    if (q) {
      const hex = q.toLowerCase().replace(/^0x/, '');
      and.push({ OR: [
        { tbTransferId: hex },
        { sourceNo: { contains: q } },
        { traceId: { contains: q } },
      ] });
    }
    if (filters.coa) {
      const numeric = COA_TO_TB_CODE[filters.coa];
      and.push({ OR: [
        { debitCode: filters.coa }, { creditCode: filters.coa },
        ...(numeric !== undefined ? [{ debitCode: String(numeric) }, { creditCode: String(numeric) }] : []),
      ] });
    }
    if (and.length > 0) where.AND = and;

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

  async getAccountStatement(tbAccountId: string): Promise<{
    items: Array<{
      tbTransferId: string;
      sourceType: string;
      sourceNo: string;
      eventCode: string;
      direction: 'IN' | 'OUT';
      amount: number;
      runningBalance: number;
      assetCode: string;
      memo: string | null;
      createdAt: string;
    }>;
    currentBalance: number;
  }> {
    // Sign convention by account class: assets are DEBIT-normal (a debit = IN/+,
    // balance = debits − credits); liabilities & equity are CREDIT-normal
    // (a credit = IN/+). Without this an asset account shows a negative balance.
    const reg = await (this.prisma as any).tbAccountRegistry.findUnique({
      where: { tbAccountId },
      select: { code: true },
    });
    const isAsset = reg ? isAssetCode(reg.code) : false;

    const rows = await (this.prisma as any).tbTransferEvidence.findMany({
      where: {
        transferType: 'POSTED',
        OR: [
          { creditTbAccountId: tbAccountId },
          { debitTbAccountId: tbAccountId },
        ],
      },
      orderBy: { createdAt: 'asc' },
    });

    let balance = 0;
    const items = rows.map((row: any) => {
      const isCreditSide = row.creditTbAccountId === tbAccountId;
      // asset: debit = IN ; liability/equity: credit = IN
      const direction: 'IN' | 'OUT' = isAsset
        ? (isCreditSide ? 'OUT' : 'IN')
        : (isCreditSide ? 'IN' : 'OUT');
      const amount = Number(row.amount);
      balance += direction === 'IN' ? amount : -amount;
      return {
        tbTransferId: row.tbTransferId,
        sourceType: row.sourceType,
        sourceNo: row.sourceNo,
        eventCode: row.eventCode,
        direction,
        amount,
        runningBalance: balance,
        assetCode: row.assetCode,
        memo: row.memo,
        createdAt: row.createdAt,
      };
    });

    return { items, currentBalance: balance };
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
