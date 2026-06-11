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
  assetCurrency: string;
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
        assetCode: params.assetCurrency,
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
    const row = await (this.prisma as any).tbAccountRegistry.findUnique({
      where: { tbAccountId },
    });
    if (!row) return null;
    const [enriched] = await this.attachOwnerNames([row]);
    return enriched;
  }

  async findAll(filters: {
    assetCurrency?: string;
    ownerType?: string;
    code?: number;
    q?: string;
    skip?: number;
    take?: number;
  }) {
    const where: any = {};
    if (filters.assetCurrency) where.assetCode = filters.assetCurrency;
    if (filters.ownerType) where.ownerType = filters.ownerType;
    if (filters.code !== undefined) where.code = filters.code;

    const q = filters.q?.trim();
    if (q) {
      const byName = await (this.prisma as any).customerMain.findMany({
        where: { OR: [{ firstName: { contains: q } }, { lastName: { contains: q } }] },
        select: { id: true },
      });
      const or: any[] = [
        { ownerNo: { contains: q } },
        { description: { contains: q } },
      ];
      if (byName.length > 0) or.push({ ownerUuid: { in: byName.map((c: any) => c.id) } });
      where.OR = or;
    }

    const [rows, total] = await Promise.all([
      (this.prisma as any).tbAccountRegistry.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: filters.skip ?? 0,
        take: filters.take ?? 50,
      }),
      (this.prisma as any).tbAccountRegistry.count({ where }),
    ]);

    return { items: await this.attachOwnerNames(rows), total };
  }

  /** CUSTOMER 行批量附 ownerName(单次 IN 查询,禁 N+1);SYSTEM 行恒 null。 */
  private async attachOwnerNames(rows: any[]): Promise<any[]> {
    const uuids = [
      ...new Set(
        rows.filter((r) => r.ownerType === 'CUSTOMER' && r.ownerUuid).map((r) => r.ownerUuid),
      ),
    ];
    if (uuids.length === 0) return rows.map((r) => ({ ...r, ownerName: null }));
    const customers = await (this.prisma as any).customerMain.findMany({
      where: { id: { in: uuids } },
      select: { id: true, firstName: true, lastName: true },
    });
    const names = new Map<string, string | null>(
      customers.map((c: any) => [c.id, [c.firstName, c.lastName].filter(Boolean).join(' ') || null]),
    );
    return rows.map((r) => ({
      ...r,
      ownerName: r.ownerType === 'CUSTOMER' ? (names.get(r.ownerUuid) ?? null) : null,
    }));
  }
}
