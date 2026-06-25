import { NotFoundException } from '@nestjs/common';
import { SwapTransactionsService } from './swap-transactions.service';

describe('SwapTransactionsService', () => {
  let service: SwapTransactionsService;
  let prisma: any;
  let internalTransferService: any;

  beforeEach(() => {
    prisma = {
      swapTransaction: {
        findUnique: jest.fn(),
      },
      internalFund: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    internalTransferService = {
      findFundsOrderBySource: jest.fn().mockResolvedValue([]),
    };

    service = new SwapTransactionsService(
      prisma as any,
      {} as any,
      {} as any,
      internalTransferService as any,
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

  it('findOne attaches fundsOrders from the 资金单 lookup (sourceType SWAP)', async () => {
    prisma.swapTransaction.findUnique.mockResolvedValue({
      id: 'swap-2',
      swapNo: 'SWP0002',
    });
    internalTransferService.findFundsOrderBySource.mockResolvedValue([
      { internalTxNo: 'ITX-SWAP-FROM', type: 'SWAP', status: 'SUCCESS', legs: [] },
      { internalTxNo: 'ITX-SWAP-TO', type: 'SWAP', status: 'SUCCESS', legs: [] },
    ]);

    const result = await service.findOne('swap-2');

    expect(
      internalTransferService.findFundsOrderBySource,
    ).toHaveBeenCalledWith('SWAP', 'swap-2');
    expect(result.fundsOrders).toHaveLength(2);
    expect(result.fundsOrders[0].internalTxNo).toBe('ITX-SWAP-FROM');
  });
});
