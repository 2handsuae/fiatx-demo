import { Prisma } from '@prisma/client';
import { InternalFundStatus } from '../../asset-treasury/internal-funds/dto/internal-fund.dto';
import { InternalTransactionType } from '../../asset-treasury/internal-transactions/dto/internal-transaction.dto';
import { OutstandingSettlementsService } from './outstanding-settlements.service';

describe('OutstandingSettlementsService', () => {
  let service: OutstandingSettlementsService;
  let prisma: any;
  let internalTransactionsService: any;
  let internalFundsService: any;

  beforeEach(() => {
    prisma = {
      outstandingSettlement: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        count: jest.fn(),
      },
      outstandingSettlementItem: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      outstanding: {
        findMany: jest.fn(),
        updateMany: jest.fn(),
        count: jest.fn(),
      },
      wallet: {
        findFirst: jest.fn(),
      },
      internalFund: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
      },
      $transaction: jest.fn((cb: any) => cb(prisma)),
    };

    internalTransactionsService = {
      createStandaloneTransaction: jest.fn(),
    };
    internalFundsService = {
      createFromInternalTransaction: jest.fn(),
    };

    service = new OutstandingSettlementsService(
      prisma,
      internalTransactionsService,
      internalFundsService,
    );

    prisma.outstandingSettlement.findUnique.mockResolvedValue({
      id: 'os-1',
      settlementNo: 'OSB2401010001',
      status: 'SUCCESS',
      items: [],
    });
    prisma.outstanding.count.mockResolvedValue(0);
  });

  it('creates SUCCESS settlement immediately when no outstanding rows match', async () => {
    prisma.outstandingSettlement.create.mockResolvedValue({
      id: 'os-1',
      settlementNo: 'OSB2401010001',
    });
    prisma.outstanding.findMany.mockResolvedValueOnce([]);
    prisma.outstandingSettlement.update.mockResolvedValue({
      id: 'os-1',
      status: 'SUCCESS',
    });

    await service.createManual({ sourceType: 'SWAP' }, 'admin-1');

    expect(prisma.outstandingSettlement.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'os-1' },
        data: expect.objectContaining({
          status: 'SUCCESS',
          totalOutstandingCount: 0,
          closedOutstandingCount: 0,
          totalAssetCount: 0,
          closedAssetCount: 0,
        }),
      }),
    );
    expect(internalTransactionsService.createStandaloneTransaction).not.toHaveBeenCalled();
    expect(internalFundsService.createFromInternalTransaction).not.toHaveBeenCalled();
  });

  it('nets zero amount per asset and closes rows without creating internal execution', async () => {
    prisma.outstandingSettlement.create.mockResolvedValue({
      id: 'os-1',
      settlementNo: 'OSB2401010001',
    });
    const baseRows = [
      {
        id: 'o-in',
        assetId: 'asset-btc',
        direction: 'IN',
        amount: new Prisma.Decimal('5'),
        asset: {
          id: 'asset-btc',
          code: 'BTC',
          network: 'BTC',
          type: 'CRYPTO',
          decimals: 8,
        },
      },
      {
        id: 'o-out',
        assetId: 'asset-btc',
        direction: 'OUT',
        amount: new Prisma.Decimal('5'),
        asset: {
          id: 'asset-btc',
          code: 'BTC',
          network: 'BTC',
          type: 'CRYPTO',
          decimals: 8,
        },
      },
    ];
    prisma.outstanding.findMany
      .mockResolvedValueOnce(baseRows)
      .mockResolvedValueOnce(baseRows);
    prisma.outstandingSettlementItem.create.mockResolvedValue({
      id: 'osi-1',
    });
    prisma.outstanding.updateMany.mockResolvedValue({ count: 2 });
    prisma.outstandingSettlement.update.mockResolvedValue({
      id: 'os-1',
      status: 'SUCCESS',
    });

    await service.createManual({ sourceType: 'SWAP' }, 'admin-1');

    expect(internalTransactionsService.createStandaloneTransaction).not.toHaveBeenCalled();
    expect(internalFundsService.createFromInternalTransaction).not.toHaveBeenCalled();
    expect(prisma.outstanding.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          settlementItemId: 'osi-1',
          status: 'LOCKED',
        }),
        data: expect.objectContaining({
          status: 'CLOSED',
        }),
      }),
    );
  });

  it('creates LIQ_TO_MASTER internal execution for positive net asset amount', async () => {
    prisma.outstandingSettlement.create.mockResolvedValue({
      id: 'os-1',
      settlementNo: 'OSB2401010001',
    });
    const rows = [
      {
        id: 'o-in',
        assetId: 'asset-eth',
        direction: 'IN',
        amount: new Prisma.Decimal('12'),
        asset: {
          id: 'asset-eth',
          code: 'ETH',
          network: 'ETH',
          type: 'CRYPTO',
          decimals: 18,
        },
      },
      {
        id: 'o-out',
        assetId: 'asset-eth',
        direction: 'OUT',
        amount: new Prisma.Decimal('3'),
        asset: {
          id: 'asset-eth',
          code: 'ETH',
          network: 'ETH',
          type: 'CRYPTO',
          decimals: 18,
        },
      },
    ];
    prisma.outstanding.findMany.mockResolvedValueOnce(rows).mockResolvedValueOnce(rows);
    prisma.outstanding.updateMany.mockResolvedValue({ count: 2 });
    prisma.outstandingSettlementItem.create.mockResolvedValue({
      id: 'osi-1',
    });
    prisma.wallet.findFirst
      .mockResolvedValueOnce({
        id: 'w-liq',
        address: '0xliq',
        iban: null,
      })
      .mockResolvedValueOnce({
        id: 'w-master',
        address: '0xmaster',
        iban: null,
      });
    internalTransactionsService.createStandaloneTransaction.mockResolvedValue({
      id: 'itx-1',
    });
    internalFundsService.createFromInternalTransaction.mockResolvedValue({
      id: 'ifd-1',
      status: InternalFundStatus.CREATED,
    });
    prisma.outstandingSettlement.update.mockResolvedValue({
      id: 'os-1',
      status: 'PROCESSING',
    });

    await service.createManual({ sourceType: 'SWAP' }, 'admin-1');

    expect(internalTransactionsService.createStandaloneTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        type: InternalTransactionType.LIQ_TO_MASTER,
        sourceType: 'OUTSTANDING_SETTLEMENT',
        sourceId: 'osi-1',
        amount: expect.any(Prisma.Decimal),
      }),
      'admin-1',
      prisma,
    );
    expect(internalFundsService.createFromInternalTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        internalTransactionId: 'itx-1',
      }),
      'admin-1',
      prisma,
    );
    expect(prisma.outstandingSettlement.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'os-1' },
        data: expect.objectContaining({
          status: 'PROCESSING',
          totalOutstandingCount: 2,
          totalAssetCount: 1,
          closedAssetCount: 0,
        }),
      }),
    );
  });

  it('creates LIQ_BANK_TO_CLIENT_BANK internal execution for positive FIAT net amount', async () => {
    prisma.outstandingSettlement.create.mockResolvedValue({
      id: 'os-1',
      settlementNo: 'OSB2401010001',
    });
    const rows = [
      {
        id: 'o-in',
        assetId: 'asset-aed',
        direction: 'IN',
        amount: new Prisma.Decimal('12'),
        asset: {
          id: 'asset-aed',
          code: 'AED',
          network: null,
          type: 'FIAT',
          decimals: 2,
        },
      },
      {
        id: 'o-out',
        assetId: 'asset-aed',
        direction: 'OUT',
        amount: new Prisma.Decimal('3'),
        asset: {
          id: 'asset-aed',
          code: 'AED',
          network: null,
          type: 'FIAT',
          decimals: 2,
        },
      },
    ];
    prisma.outstanding.findMany.mockResolvedValueOnce(rows).mockResolvedValueOnce(rows);
    prisma.outstanding.updateMany.mockResolvedValue({ count: 2 });
    prisma.outstandingSettlementItem.create.mockResolvedValue({
      id: 'osi-fiat-1',
    });
    prisma.wallet.findFirst
      .mockResolvedValueOnce({
        id: 'w-liq-bank',
        address: null,
        iban: 'AE22-LIQ',
      })
      .mockResolvedValueOnce({
        id: 'w-cust-bank',
        address: null,
        iban: 'AE11-CUST',
      });
    internalTransactionsService.createStandaloneTransaction.mockResolvedValue({
      id: 'itx-fiat-1',
    });
    internalFundsService.createFromInternalTransaction.mockResolvedValue({
      id: 'ifd-fiat-1',
      status: InternalFundStatus.CREATED,
    });
    prisma.outstandingSettlement.update.mockResolvedValue({
      id: 'os-1',
      status: 'PROCESSING',
    });

    await service.createManual({ sourceType: 'SWAP' }, 'admin-1');

    expect(internalTransactionsService.createStandaloneTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        type: InternalTransactionType.LIQ_BANK_TO_CLIENT_BANK,
        sourceType: 'OUTSTANDING_SETTLEMENT',
        sourceId: 'osi-fiat-1',
      }),
      'admin-1',
      prisma,
    );
  });

  it('creates CLIENT_BANK_TO_LIQ_BANK internal execution for negative FIAT net amount', async () => {
    prisma.outstandingSettlement.create.mockResolvedValue({
      id: 'os-1',
      settlementNo: 'OSB2401010001',
    });
    const rows = [
      {
        id: 'o-in',
        assetId: 'asset-aed',
        direction: 'IN',
        amount: new Prisma.Decimal('3'),
        asset: {
          id: 'asset-aed',
          code: 'AED',
          network: null,
          type: 'FIAT',
          decimals: 2,
        },
      },
      {
        id: 'o-out',
        assetId: 'asset-aed',
        direction: 'OUT',
        amount: new Prisma.Decimal('12'),
        asset: {
          id: 'asset-aed',
          code: 'AED',
          network: null,
          type: 'FIAT',
          decimals: 2,
        },
      },
    ];
    prisma.outstanding.findMany.mockResolvedValueOnce(rows).mockResolvedValueOnce(rows);
    prisma.outstanding.updateMany.mockResolvedValue({ count: 2 });
    prisma.outstandingSettlementItem.create.mockResolvedValue({
      id: 'osi-fiat-2',
    });
    prisma.wallet.findFirst
      .mockResolvedValueOnce({
        id: 'w-cust-bank',
        address: null,
        iban: 'AE11-CUST',
      })
      .mockResolvedValueOnce({
        id: 'w-liq-bank',
        address: null,
        iban: 'AE22-LIQ',
      });
    internalTransactionsService.createStandaloneTransaction.mockResolvedValue({
      id: 'itx-fiat-2',
    });
    internalFundsService.createFromInternalTransaction.mockResolvedValue({
      id: 'ifd-fiat-2',
      status: InternalFundStatus.CREATED,
    });
    prisma.outstandingSettlement.update.mockResolvedValue({
      id: 'os-1',
      status: 'PROCESSING',
    });

    await service.createManual({ sourceType: 'SWAP' }, 'admin-1');

    expect(internalTransactionsService.createStandaloneTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        type: InternalTransactionType.CLIENT_BANK_TO_LIQ_BANK,
        sourceType: 'OUTSTANDING_SETTLEMENT',
        sourceId: 'osi-fiat-2',
      }),
      'admin-1',
      prisma,
    );
  });

  it('nets zero FIAT amount and closes rows without creating internal execution', async () => {
    prisma.outstandingSettlement.create.mockResolvedValue({
      id: 'os-1',
      settlementNo: 'OSB2401010001',
    });
    const rows = [
      {
        id: 'o-in',
        assetId: 'asset-aed',
        direction: 'IN',
        amount: new Prisma.Decimal('8'),
        asset: {
          id: 'asset-aed',
          code: 'AED',
          network: null,
          type: 'FIAT',
          decimals: 2,
        },
      },
      {
        id: 'o-out',
        assetId: 'asset-aed',
        direction: 'OUT',
        amount: new Prisma.Decimal('8'),
        asset: {
          id: 'asset-aed',
          code: 'AED',
          network: null,
          type: 'FIAT',
          decimals: 2,
        },
      },
    ];
    prisma.outstanding.findMany.mockResolvedValueOnce(rows).mockResolvedValueOnce(rows);
    prisma.outstandingSettlementItem.create.mockResolvedValue({
      id: 'osi-fiat-3',
    });
    prisma.outstanding.updateMany.mockResolvedValue({ count: 2 });
    prisma.outstandingSettlement.update.mockResolvedValue({
      id: 'os-1',
      status: 'SUCCESS',
    });

    await service.createManual({ sourceType: 'SWAP' }, 'admin-1');

    expect(internalTransactionsService.createStandaloneTransaction).not.toHaveBeenCalled();
    expect(internalFundsService.createFromInternalTransaction).not.toHaveBeenCalled();
    expect(prisma.outstanding.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          settlementItemId: 'osi-fiat-3',
          status: 'LOCKED',
        }),
        data: expect.objectContaining({
          status: 'CLOSED',
        }),
      }),
    );
  });

  it('syncSettlement closes locked rows when internal fund is CLEAR', async () => {
    prisma.outstandingSettlement.findUnique
      .mockResolvedValueOnce({
        id: 'os-1',
        items: [
          {
            id: 'osi-1',
            settlementId: 'os-1',
            status: 'PROCESSING',
            internalTransactionId: 'itx-1',
          },
        ],
      })
      .mockResolvedValueOnce({
        id: 'os-1',
        settlementNo: 'OSB2401010001',
        status: 'SUCCESS',
        items: [],
      });
    prisma.internalFund.findFirst.mockResolvedValue({
      id: 'ifd-1',
      status: InternalFundStatus.CLEAR,
    });
    prisma.outstanding.count
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0);
    prisma.outstandingSettlementItem.findMany.mockResolvedValue([
      {
        status: 'CLOSED',
        closedOutstandingCount: 2,
      },
    ]);

    await service.syncSettlement('os-1', 'admin-1');

    expect(prisma.outstanding.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          settlementItemId: 'osi-1',
          status: 'LOCKED',
        }),
        data: expect.objectContaining({
          status: 'CLOSED',
          closedByInternalFundId: 'ifd-1',
        }),
      }),
    );
    expect(prisma.outstandingSettlement.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'os-1' },
        data: expect.objectContaining({
          status: 'SUCCESS',
          closedOutstandingCount: 2,
          totalAssetCount: 1,
          closedAssetCount: 1,
        }),
      }),
    );
  });
});
