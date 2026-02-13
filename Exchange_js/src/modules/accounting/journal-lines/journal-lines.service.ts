import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { JournalLineQueryDto } from './dto/journal-line.dto';
import { CustomerBalanceHistoryQueryDto } from './dto/customer-balance-history.dto';
import { Prisma } from '@prisma/client';

@Injectable()
export class JournalLinesService {
  private readonly logger = new Logger(JournalLinesService.name);

  constructor(private prisma: PrismaService) {}

  async findAll(query: JournalLineQueryDto) {
    const { skip, take, id, journalId, journalNo, sortBy, sortOrder } = query;

    const where: any = {};

    if (id) where.id = id; // Exact match
    if (journalId) where.journalId = { contains: journalId };
    if (journalNo) where.journal = { journalNo: { contains: journalNo } };

    const orderBy: any = {};
    if (sortBy) {
      orderBy[sortBy] = sortOrder || 'asc';
    } else {
      orderBy.createdAt = 'desc';
    }

    const [items, total] = await Promise.all([
      (this.prisma as any).journalLine.findMany({
        skip: skip ? Number(skip) : 0,
        take: take ? Number(take) : 20,
        where,
        orderBy,
        include: {
          journal: {
            select: {
              eventCode: true,
              journalNo: true,
            },
          },
          account: {
            select: {
              name: true,
            },
          },
          asset: {
            select: {
              code: true,
            },
          },
        },
      }),
      (this.prisma as any).journalLine.count({ where }),
    ]);

    const parsedItems = items.map((item: any) => ({
      ...item,
      dimensions:
        typeof item.dimensions === 'string'
          ? JSON.parse(item.dimensions)
          : item.dimensions,
    }));

    return { items: parsedItems, total };
  }

  async findOne(id: string) {
    const item = await (this.prisma as any).journalLine.findUnique({
      where: { id },
      include: {
        journal: true,
        account: true,
        asset: true,
      },
    });
    if (!item) throw new NotFoundException('Journal line not found');

    return {
      ...item,
      dimensions:
        typeof item.dimensions === 'string'
          ? JSON.parse(item.dimensions)
          : item.dimensions,
    };
  }

  async getCustomerBalanceHistory(query: CustomerBalanceHistoryQueryDto) {
    const { customerId, assetId, startDate, endDate, skip, take } = query;
    const skipNum = skip ? Number(skip) : 0;
    const takeNum = take ? Number(take) : 20;

    const where: Prisma.JournalLineWhereInput = {
      accountCode: 'L.CLIENT_CREDIT',
      ownerType: 'CUSTOMER',
      ownerId: customerId,
      assetId: assetId,
    };

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate);
      if (endDate) where.createdAt.lte = new Date(endDate);
    }

    // 1. Get total count
    const total = await (this.prisma as any).journalLine.count({ where });

    // 2. Fetch current page records (ordered by createdAt ASC to calculate running balance)
    const pageRecords = await (this.prisma as any).journalLine.findMany({
      where,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      skip: skipNum,
      take: takeNum,
      include: {
        journal: {
          select: {
            eventCode: true,
            sourceType: true,
            sourceId: true,
          },
        },
        asset: {
          select: {
            code: true,
            decimals: true,
          },
        },
      },
    });

    // 3. Calculate Opening Balance
    let openingBalance = new Prisma.Decimal(0);
    if (skipNum > 0 && pageRecords.length > 0) {
      const firstRecord = pageRecords[0];
      const preSumCr = await (this.prisma as any).journalLine.aggregate({
        _sum: { amount: true },
        where: {
          ...where,
          OR: [
            { createdAt: { lt: firstRecord.createdAt } },
            {
              createdAt: firstRecord.createdAt,
              id: { lt: firstRecord.id },
            },
          ],
          drCr: 'CR',
        },
      });
      const preSumDr = await (this.prisma as any).journalLine.aggregate({
        _sum: { amount: true },
        where: {
          ...where,
          OR: [
            { createdAt: { lt: firstRecord.createdAt } },
            {
              createdAt: firstRecord.createdAt,
              id: { lt: firstRecord.id },
            },
          ],
          drCr: 'DR',
        },
      });
      openingBalance = new Prisma.Decimal(preSumCr._sum.amount || 0).minus(
        new Prisma.Decimal(preSumDr._sum.amount || 0),
      );
    } else if (skipNum > 0 && pageRecords.length === 0) {
      // If page is empty but skip > 0, calculate total balance as opening
      const totalCr = await (this.prisma as any).journalLine.aggregate({
        _sum: { amount: true },
        where: { ...where, drCr: 'CR' },
      });
      const totalDr = await (this.prisma as any).journalLine.aggregate({
        _sum: { amount: true },
        where: { ...where, drCr: 'DR' },
      });
      openingBalance = new Prisma.Decimal(totalCr._sum.amount || 0).minus(
        new Prisma.Decimal(totalDr._sum.amount || 0),
      );
    }

    // 4. Calculate running balance
    let currentBalance = openingBalance;
    const items = pageRecords.map((line: any) => {
      const amount = new Prisma.Decimal(line.amount);
      const change = line.drCr === 'CR' ? amount : amount.negated();
      currentBalance = currentBalance.plus(change);
      return {
        ...line,
        changeAmount: change,
        postBalance: currentBalance,
        dimensions:
          typeof line.dimensions === 'string'
            ? JSON.parse(line.dimensions)
            : line.dimensions,
      };
    });

    // 5. Return reversed (newest first for UI)
    return {
      items: items.reverse(),
      total,
      openingBalance: openingBalance,
      closingBalance: currentBalance,
    };
  }
}
