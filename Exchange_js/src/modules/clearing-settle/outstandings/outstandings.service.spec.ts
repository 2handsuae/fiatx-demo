import {
  BadRequestException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { OutstandingsService } from './outstandings.service';

describe('OutstandingsService', () => {
  const mockPrismaService: any = {
    outstanding: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
  };

  let service: OutstandingsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new OutstandingsService(mockPrismaService);
  });

  it('creates two outstanding rows for swap success', async () => {
    const tx: any = {
      outstanding: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValue([
          { id: 'os-out', direction: 'OUT' },
          { id: 'os-in', direction: 'IN' },
        ]),
      },
    };

    await service.createForSwapSuccess(tx, {
      id: 'swap-1',
      swapNo: 'SWP-1',
      ownerType: 'CUSTOMER',
      ownerId: 'customer-1',
      ownerNo: 'CU_0001',
      status: 'SUCCESS',
      fromAssetId: 'asset-from',
      fromAssetCurrency: 'BTC',
      fromAmount: new Prisma.Decimal(1.5),
      toAssetId: 'asset-to',
      toAssetCurrency: 'ETH',
      toAmount: new Prisma.Decimal(20),
    });

    expect(tx.outstanding.create).toHaveBeenCalledTimes(2);
    expect(tx.outstanding.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          sourceType: 'SWAP',
          sourceId: 'swap-1',
          direction: 'OUT',
        }),
      }),
    );
    expect(tx.outstanding.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          sourceType: 'SWAP',
          sourceId: 'swap-1',
          direction: 'IN',
        }),
      }),
    );
  });

  it('retries create when outstandingNo has unique conflict', async () => {
    const tx: any = {
      outstanding: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest
          .fn()
          .mockRejectedValueOnce({
            code: 'P2002',
            meta: { target: ['outstandingNo'] },
          })
          .mockResolvedValueOnce({})
          .mockResolvedValueOnce({}),
        update: jest.fn().mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValue([
          { id: 'os-out', direction: 'OUT' },
          { id: 'os-in', direction: 'IN' },
        ]),
      },
    };

    await service.createForSwapSuccess(tx, {
      id: 'swap-1',
      swapNo: 'SWP-1',
      ownerType: 'CUSTOMER',
      ownerId: 'customer-1',
      ownerNo: 'CU_0001',
      status: 'SUCCESS',
      fromAssetId: 'asset-from',
      fromAssetCurrency: 'BTC',
      fromAmount: new Prisma.Decimal(1.5),
      toAssetId: 'asset-to',
      toAssetCurrency: 'ETH',
      toAmount: new Prisma.Decimal(20),
    });

    expect(tx.outstanding.create).toHaveBeenCalledTimes(3);
  });

  it('throws when outstandingNo generation keeps conflicting', async () => {
    const tx: any = {
      outstanding: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockRejectedValue({
          code: 'P2002',
          meta: { target: ['outstandingNo'] },
        }),
        update: jest.fn().mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };

    await expect(
      service.createForSwapSuccess(tx, {
        id: 'swap-1',
        swapNo: 'SWP-1',
        ownerType: 'CUSTOMER',
        ownerId: 'customer-1',
        ownerNo: 'CU_0001',
        status: 'SUCCESS',
        fromAssetId: 'asset-from',
        fromAssetCurrency: 'BTC',
        fromAmount: new Prisma.Decimal(1.5),
        toAssetId: 'asset-to',
        toAssetCurrency: 'ETH',
        toAmount: new Prisma.Decimal(20),
      }),
    ).rejects.toThrow(InternalServerErrorException);

    expect(tx.outstanding.create).toHaveBeenCalledTimes(10);
  });

  it('throws when swap status is not SUCCESS', async () => {
    await expect(
      service.createForSwapSuccess({} as any, {
        id: 'swap-2',
        swapNo: 'SWP-2',
        ownerType: 'CUSTOMER',
        ownerId: 'customer-1',
        ownerNo: 'CU_0001',
        status: 'PENDING_COMPLIANCE',
        fromAssetId: 'asset-from',
        fromAssetCurrency: 'BTC',
        fromAmount: new Prisma.Decimal(1),
        toAssetId: 'asset-to',
        toAssetCurrency: 'ETH',
        toAmount: new Prisma.Decimal(2),
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('fills assetCode from asset master when swap assetCode is empty', async () => {
    const tx: any = {
      asset: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce({ code: 'BTC' })
          .mockResolvedValueOnce({ code: 'USDT' }),
      },
      outstanding: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValue([
          { id: 'os-out', direction: 'OUT' },
          { id: 'os-in', direction: 'IN' },
        ]),
      },
    };

    await service.createForSwapSuccess(tx, {
      id: 'swap-1',
      swapNo: 'SWP-1',
      ownerType: 'CUSTOMER',
      ownerId: 'customer-1',
      ownerNo: 'CU_0001',
      status: 'SUCCESS',
      fromAssetId: 'asset-from',
      fromAssetCurrency: null,
      fromAmount: new Prisma.Decimal(1.5),
      toAssetId: 'asset-to',
      toAssetCurrency: '',
      toAmount: new Prisma.Decimal(20),
    });

    expect(tx.asset.findUnique).toHaveBeenCalledTimes(2);
    expect(tx.outstanding.create).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        data: expect.objectContaining({
          direction: 'OUT',
          assetCode: 'BTC',
        }),
      }),
    );
    expect(tx.outstanding.create).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: expect.objectContaining({
          direction: 'IN',
          assetCode: 'USDT',
        }),
      }),
    );
  });

  it('lists outstandings for admin with total', async () => {
    mockPrismaService.outstanding.findMany.mockResolvedValue([
      { id: 'os-1', sourceType: 'SWAP' },
    ]);
    mockPrismaService.outstanding.count.mockResolvedValue(1);

    const result = await service.findAllForAdmin({
      status: 'OPEN' as any,
      direction: 'IN' as any,
      sourceType: 'SWAP',
    });

    expect(result.total).toBe(1);
    expect(result.items).toHaveLength(1);
    expect(mockPrismaService.outstanding.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: 'OPEN',
          direction: 'IN',
          sourceType: 'SWAP',
        }),
      }),
    );
  });

  it('gets one outstanding for admin', async () => {
    mockPrismaService.outstanding.findUnique.mockResolvedValue({ id: 'os-1' });

    const result = await service.findOneForAdmin('os-1');

    expect(result.id).toBe('os-1');
  });

  it('throws not found when outstanding does not exist', async () => {
    mockPrismaService.outstanding.findUnique.mockResolvedValue(null);

    await expect(service.findOneForAdmin('missing')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('includes settlement batch/transfer/fund with business-No selects, preserves existing includes', async () => {
    mockPrismaService.outstanding.findUnique.mockResolvedValue({ id: 'o1' });

    await service.findOneForAdmin('o1');

    const arg = mockPrismaService.outstanding.findUnique.mock.calls[0][0];
    expect(arg.include.settlementBatch).toEqual({
      select: { batchNo: true, settlementType: true, status: true },
    });
    expect(arg.include.settledByTransfer).toEqual({
      select: { internalTxNo: true, pathLabel: true, status: true },
    });
    expect(arg.include.closedByInternalFund).toEqual({
      select: { internalFundNo: true, status: true },
    });
    expect(arg.include.asset).toBe(true);
    expect(arg.include.swapTransaction).toBeDefined();
  });
});
