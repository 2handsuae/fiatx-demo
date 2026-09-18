// src/modules/accounting/tigerbeetle/tb-account-registry.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { TigerBeetleService } from './tigerbeetle.service';
import { hexToBigint } from './utils/tb-id.util';
import { isAssetCode, accountNameOf } from './constants/tb-account-codes.constant';

/** class-aware posted 余额(分,字符串)。资产借正=debits−credits；负债/权益贷正=credits−debits。 */
export function postedBalanceForCode(
  acct: { debits_posted: bigint; credits_posted: bigint },
  code: number,
): string {
  const net = isAssetCode(code)
    ? acct.debits_posted - acct.credits_posted
    : acct.credits_posted - acct.debits_posted;
  return net.toString();
}

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
  private readonly logger = new Logger(TbAccountRegistryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tbService: TigerBeetleService,
  ) {}

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

    const named = await this.attachOwnerNames(rows);
    return { items: this.attachAccountNames(await this.attachBalances(named)), total };
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

  /** 整页账户余额：一次 TB 批量 lookupAccounts，class-aware 算 posted 余额；
   *  TB 不可用/账户缺失 → balance=null（前端显「—」），绝不阻断列表主体。 */
  private async attachBalances(rows: any[]): Promise<any[]> {
    if (rows.length === 0) return rows;
    let byId = new Map<string, { debits_posted: bigint; credits_posted: bigint }>();
    try {
      const ids = rows.map((r) => hexToBigint(r.tbAccountId));
      const accounts = await this.tbService.lookupAccounts(ids);
      byId = new Map(accounts.map((a: any) => [a.id.toString(), a]));
    } catch (e) {
      this.logger.warn(`attachBalances: TB lookupAccounts failed, balances null for ${rows.length} account rows — ${e}`);
      return rows.map((r) => ({ ...r, balance: null }));
    }
    return rows.map((r) => {
      const acct = byId.get(hexToBigint(r.tbAccountId).toString());
      return { ...r, balance: acct ? postedBalanceForCode(acct, r.code) : null };
    });
  }

  /** 科目名称随行下发(2026-08-13)——名称的唯一真相源在 tb-account-codes.constant.ts,
   *  前端不得再自建 code→名字 映射。科目表/流水表显示名称,其余地方显示助记码。 */
  private attachAccountNames(rows: any[]): any[] {
    return rows.map((r) => ({ ...r, accountName: accountNameOf(r.code) }));
  }
}
