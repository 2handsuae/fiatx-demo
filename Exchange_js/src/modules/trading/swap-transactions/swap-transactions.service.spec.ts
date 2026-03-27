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
    };

    service = new SwapTransactionsService(prisma as any, {} as any);
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
});
