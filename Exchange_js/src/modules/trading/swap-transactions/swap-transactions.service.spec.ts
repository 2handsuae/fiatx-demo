import { NotFoundException } from '@nestjs/common';
import { SwapTransactionsService } from './swap-transactions.service';

describe('SwapTransactionsService', () => {
  let service: SwapTransactionsService;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      swapTransaction: {
        findUnique: jest.fn(),
      },
      internalFund: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };

    service = new SwapTransactionsService(
      prisma as any,
      {} as any,
      {} as any,
    );
  });

  it('should return swap detail without including legacy auditLogs relation', async () => {
    prisma.swapTransaction.findUnique.mockResolvedValue({
      id: 'swap-1',
      swapNo: 'SWP0001',
      statusHistory: '[]',
    });

    const result = await service.findOne('swap-1');

    expect(prisma.swapTransaction.findUnique).toHaveBeenCalledWith({
      where: { id: 'swap-1' },
      include: {
        fromAsset: true,
        toAsset: true,
        customer: true,
      },
    });
    expect(result).toEqual(
      expect.objectContaining({
        id: 'swap-1',
        swapNo: 'SWP0001',
        statusHistory: '[]',
      }),
    );
  });

  it('should throw when swap detail is missing', async () => {
    prisma.swapTransaction.findUnique.mockResolvedValue(null);

    await expect(service.findOne('missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('findOne returns internalFunds (legs ordered by legSeq then attempt) and no legacy fundsOrders', async () => {
    prisma.swapTransaction.findUnique.mockResolvedValue({
      id: 'swap-2',
      swapNo: 'SWP0002',
    });
    prisma.internalFund.findMany.mockResolvedValue([
      { id: 'leg-0', legSeq: 0, attempt: 1, status: 'CLEAR' },
      { id: 'leg-1', legSeq: 1, attempt: 1, status: 'PENDING' },
    ]);

    const result = await service.findOne('swap-2');

    expect(prisma.internalFund.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { swapTransactionId: 'swap-2' },
        orderBy: [{ legSeq: 'asc' }, { attempt: 'asc' }],
      }),
    );
    expect(result.fundsOrders).toBeUndefined();
    expect(Array.isArray(result.internalFunds)).toBe(true);
    expect(result.internalFunds).toHaveLength(2);
    expect(result.internalFunds[0].id).toBe('leg-0');
  });
});
