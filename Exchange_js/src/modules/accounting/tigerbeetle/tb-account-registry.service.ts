// src/modules/accounting/tigerbeetle/tb-account-registry.service.ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { Prisma } from '@prisma/client';

interface RegisterParams {
  tbAccountId: string;
  code: number;
  ledger: number;
  ownerType: string;
  ownerUuid?: string;
  ownerNo?: string;
  assetCode: string;
  description?: string;
  flags?: number;
}

interface ResolveParams {
  code: number;
  ledger: number;
  ownerType: string;
  ownerUuid?: string;
}

@Injectable()
export class TbAccountRegistryService {
  constructor(private readonly prisma: PrismaService) {}

  async register(params: RegisterParams, tx?: Prisma.TransactionClient) {
    const client = tx ?? this.prisma;
    return (client as any).tbAccountRegistry.create({
      data: {
        tbAccountId: params.tbAccountId,
        code: params.code,
        ledger: params.ledger,
        ownerType: params.ownerType,
        ownerUuid: params.ownerUuid ?? null,
        ownerNo: params.ownerNo ?? null,
        assetCode: params.assetCode,
        description: params.description ?? null,
        flags: params.flags ?? 0,
      },
    });
  }

  async resolve(params: ResolveParams, tx?: Prisma.TransactionClient) {
    const client = tx ?? this.prisma;
    return (client as any).tbAccountRegistry.findFirst({
      where: {
        code: params.code,
        ledger: params.ledger,
        ownerType: params.ownerType,
        ownerUuid: params.ownerUuid ?? null,
        status: 'ACTIVE',
      },
    });
  }

  async findByOwner(ownerUuid: string) {
    return (this.prisma as any).tbAccountRegistry.findMany({
      where: { ownerUuid, status: 'ACTIVE' },
    });
  }

  async findByTbAccountId(tbAccountId: string) {
    return (this.prisma as any).tbAccountRegistry.findUnique({
      where: { tbAccountId },
    });
  }

  async findAll(filters: {
    assetCode?: string;
    ownerType?: string;
    code?: number;
    skip?: number;
    take?: number;
  }) {
    const where: any = {};
    if (filters.assetCode) where.assetCode = filters.assetCode;
    if (filters.ownerType) where.ownerType = filters.ownerType;
    if (filters.code !== undefined) where.code = filters.code;

    const [items, total] = await Promise.all([
      (this.prisma as any).tbAccountRegistry.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: filters.skip ?? 0,
        take: filters.take ?? 50,
      }),
      (this.prisma as any).tbAccountRegistry.count({ where }),
    ]);

    return { items, total };
  }
}
