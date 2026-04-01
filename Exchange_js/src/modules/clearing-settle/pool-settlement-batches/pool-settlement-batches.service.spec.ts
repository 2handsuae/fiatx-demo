import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PoolSettlementBatchesService } from './pool-settlement-batches.service';

describe('PoolSettlementBatchesService', () => {
  const decimal = (value: string | number) => new Prisma.Decimal(value);

  const buildWallet = (overrides: Record<string, unknown>) => ({
    id: 'wallet-unknown',
    status: 'ACTIVE',
    walletRole: 'GENERAL',
    walletNo: 'WA-GEN-UNKNOWN-NA',
    regulatoryEnablementStatus: 'EFFECTIVE',
    ...overrides,
  });

  const buildAsset = (
    id: string,
    code: string,
    type: 'CRYPTO' | 'FIAT',
    network: string | null = null,
  ) => ({
    id,
    code,
    type,
    network,
  });

  const buildOutstanding = (overrides: Record<string, unknown>) => ({
    id: 'outstanding-1',
    outstandingNo: 'OTS-1',
    status: 'OPEN',
    direction: 'IN',
    amount: decimal(1),
    assetId: 'asset-1',
    asset: buildAsset('asset-1', 'BTC', 'CRYPTO', 'BITCOIN'),
    ...overrides,
  });

  const buildReimbursement = (overrides: Record<string, unknown>) => ({
    id: 'reimbursement-1',
    obligationNo: 'ROB-1',
    status: 'OPEN',
    amount: decimal(1),
    assetId: 'asset-1',
    asset: buildAsset('asset-1', 'BTC', 'CRYPTO', 'BITCOIN'),
    sourceWalletId: 'wallet-source',
    poolRole: 'PAYOUT',
    ...overrides,
  });

  const makePrisma = () => {
    let batchItemCount = 0;
    let batchItemSourceCount = 0;

    const prisma: any = {
      outstanding: {
        findMany: jest.fn(),
        updateMany: jest.fn(),
      },
      reimbursementObligation: {
        findMany: jest.fn(),
        updateMany: jest.fn(),
      },
      wallet: {
        findFirst: jest.fn(),
      },
      poolSettlementBatch: {
        create: jest.fn(),
        update: jest.fn((args: any) =>
          Promise.resolve({
            id: args.where.id,
            status: 'CREATED',
            ...args.data,
          }),
        ),
      },
      poolSettlementBatchItem: {
        create: jest.fn((args: any) =>
          Promise.resolve({
            id: `batch-item-${++batchItemCount}`,
            ...args.data,
          }),
        ),
      },
      poolSettlementBatchItemSource: {
        create: jest.fn((args: any) =>
          Promise.resolve({
            id: `batch-item-source-${++batchItemSourceCount}`,
            ...args.data,
          }),
        ),
      },
    };

    prisma.$transaction = jest.fn((cb: any) => cb(prisma));
    return prisma;
  };

  const createService = () => {
    const prisma = makePrisma();
    const service = new PoolSettlementBatchesService(prisma);
    return { prisma, service };
  };

  const registerWallets = (prisma: any, wallets: Record<string, any>) => {
    prisma.wallet.findFirst.mockImplementation(({ where }: any) => {
      if (where?.walletNo && wallets[where.walletNo]) {
        return Promise.resolve(wallets[where.walletNo]);
      }

      if (where?.assetId && where?.walletRole) {
        const match = Object.values(wallets).find(
          (wallet: any) =>
            wallet.assetId === where.assetId &&
            wallet.walletRole === where.walletRole &&
            wallet.status === where.status,
        );
        return Promise.resolve(match || null);
      }

      return Promise.resolve(null);
    });
  };

  it('creates a batch from open outstanding and reimbursement sources', async () => {
    const { prisma, service } = createService();

    prisma.outstanding.findMany.mockResolvedValue([
      buildOutstanding({
        id: 'outstanding-1',
        direction: 'OUT',
        amount: decimal(3),
        assetId: 'asset-btc',
        asset: buildAsset('asset-btc', 'BTC', 'CRYPTO', 'BITCOIN'),
      }),
    ]);
    prisma.reimbursementObligation.findMany.mockResolvedValue([
      buildReimbursement({
        id: 'reimbursement-1',
        amount: decimal(1),
        assetId: 'asset-btc',
        asset: buildAsset('asset-btc', 'BTC', 'CRYPTO', 'BITCOIN'),
      }),
    ]);

    registerWallets(prisma, {
      'WA-MST-BTC-BITCOIN': buildWallet({
        id: 'wallet-btc-master',
        walletRole: 'MASTER',
        walletNo: 'WA-MST-BTC-BITCOIN',
        assetId: 'asset-btc',
      }),
      'WA-LIQ-BTC-BITCOIN': buildWallet({
        id: 'wallet-btc-liq',
        walletRole: 'LIQ',
        walletNo: 'WA-LIQ-BTC-BITCOIN',
        assetId: 'asset-btc',
      }),
    });

    prisma.poolSettlementBatch.create.mockImplementation(({ data }: any) =>
      Promise.resolve({
        id: 'batch-1',
        batchNo: data.batchNo,
        status: data.status,
        cutoffAt: data.cutoffAt,
        createdByUserId: data.createdByUserId,
        autoCreated: data.autoCreated,
        summaryJson: data.summaryJson,
        metadataJson: data.metadataJson,
      }),
    );

    const result: any = await (service as any).createBatch(
      {
        autoCreated: false,
        metadataJson: { source: 'test' },
      },
      'admin-1',
    );

    expect(result.status).toBe('CREATED');
    expect(result.items).toHaveLength(1);
    expect(result.itemSources).toHaveLength(2);
    expect(result.summary.routableSourceCount).toBe(2);
    expect(result.summary.skippedSourceCount).toBe(0);
  });

  it('ignores already locked sources', async () => {
    const { prisma, service } = createService();

    prisma.outstanding.findMany.mockImplementation(({ where }: any) => {
      if (where?.lockedByPoolSettlementBatchId) {
        return Promise.resolve([
          buildOutstanding({
            id: 'outstanding-open',
            direction: 'OUT',
            amount: decimal(2),
            assetId: 'asset-btc',
            asset: buildAsset('asset-btc', 'BTC', 'CRYPTO', 'BITCOIN'),
          }),
        ]);
      }

      return Promise.resolve([
        buildOutstanding({
          id: 'outstanding-open',
          direction: 'OUT',
          amount: decimal(2),
          assetId: 'asset-btc',
          asset: buildAsset('asset-btc', 'BTC', 'CRYPTO', 'BITCOIN'),
        }),
        buildOutstanding({
          id: 'outstanding-locked',
          direction: 'OUT',
          amount: decimal(5),
          assetId: 'asset-eth',
          asset: buildAsset('asset-eth', 'ETH', 'CRYPTO', 'ETHEREUM'),
          lockedByPoolSettlementBatchId: 'batch-old',
        }),
      ]);
    });
    prisma.reimbursementObligation.findMany.mockImplementation(({ where }: any) => {
      if (where?.lockedByPoolSettlementBatchId) {
        return Promise.resolve([]);
      }
      return Promise.resolve([]);
    });

    registerWallets(prisma, {
      'WA-MST-BTC-BITCOIN': buildWallet({
        id: 'wallet-btc-master',
        walletRole: 'MASTER',
        walletNo: 'WA-MST-BTC-BITCOIN',
        assetId: 'asset-btc',
      }),
      'WA-LIQ-BTC-BITCOIN': buildWallet({
        id: 'wallet-btc-liq',
        walletRole: 'LIQ',
        walletNo: 'WA-LIQ-BTC-BITCOIN',
        assetId: 'asset-btc',
      }),
      'WA-MST-ETH-ETHEREUM': buildWallet({
        id: 'wallet-eth-master',
        walletRole: 'MASTER',
        walletNo: 'WA-MST-ETH-ETHEREUM',
        assetId: 'asset-eth',
      }),
      'WA-LIQ-ETH-ETHEREUM': buildWallet({
        id: 'wallet-eth-liq',
        walletRole: 'LIQ',
        walletNo: 'WA-LIQ-ETH-ETHEREUM',
        assetId: 'asset-eth',
      }),
    });

    prisma.poolSettlementBatch.create.mockImplementation(({ data }: any) =>
      Promise.resolve({
        id: 'batch-2',
        batchNo: data.batchNo,
        status: data.status,
        cutoffAt: data.cutoffAt,
        createdByUserId: data.createdByUserId,
        autoCreated: data.autoCreated,
        summaryJson: data.summaryJson,
        metadataJson: data.metadataJson,
      }),
    );

    const result: any = await (service as any).createBatch({}, 'admin-1');

    expect(prisma.outstanding.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: 'OPEN',
          lockedByPoolSettlementBatchId: null,
        }),
      }),
    );
    expect(result.items).toHaveLength(1);
    expect(result.itemSources).toHaveLength(1);
  });

  it('skips unroutable sources and records skip counts', async () => {
    const { prisma, service } = createService();

    prisma.outstanding.findMany.mockImplementation(({ where }: any) => {
      if (where?.lockedByPoolSettlementBatchId) {
        return Promise.resolve([
          buildOutstanding({
            id: 'outstanding-good',
            direction: 'IN',
            amount: decimal(2),
            assetId: 'asset-btc',
            asset: buildAsset('asset-btc', 'BTC', 'CRYPTO', 'BITCOIN'),
          }),
        ]);
      }

      return Promise.resolve([
        buildOutstanding({
          id: 'outstanding-bad',
          direction: 'OUT',
          amount: decimal(4),
          assetId: 'asset-aed',
          asset: buildAsset('asset-aed', 'AED', 'FIAT'),
        }),
        buildOutstanding({
          id: 'outstanding-good',
          direction: 'IN',
          amount: decimal(2),
          assetId: 'asset-btc',
          asset: buildAsset('asset-btc', 'BTC', 'CRYPTO', 'BITCOIN'),
        }),
      ]);
    });
    prisma.reimbursementObligation.findMany.mockImplementation(({ where }: any) => {
      if (where?.lockedByPoolSettlementBatchId) {
        return Promise.resolve([]);
      }
      return Promise.resolve([]);
    });

    registerWallets(prisma, {
      'WA-CBK-AED-NA': buildWallet({
        id: 'wallet-aed-cust-bank',
        walletRole: 'CUST_BANK',
        walletNo: 'WA-CBK-AED-NA',
        assetId: 'asset-aed',
        regulatoryEnablementStatus: 'PENDING',
      }),
      'WA-LBK-AED-NA': buildWallet({
        id: 'wallet-aed-liq-bank',
        walletRole: 'LIQ_BANK',
        walletNo: 'WA-LBK-AED-NA',
        assetId: 'asset-aed',
      }),
      'WA-MST-BTC-BITCOIN': buildWallet({
        id: 'wallet-btc-master',
        walletRole: 'MASTER',
        walletNo: 'WA-MST-BTC-BITCOIN',
        assetId: 'asset-btc',
      }),
      'WA-LIQ-BTC-BITCOIN': buildWallet({
        id: 'wallet-btc-liq',
        walletRole: 'LIQ',
        walletNo: 'WA-LIQ-BTC-BITCOIN',
        assetId: 'asset-btc',
      }),
    });

    prisma.poolSettlementBatch.create.mockImplementation(({ data }: any) =>
      Promise.resolve({
        id: 'batch-3',
        batchNo: data.batchNo,
        status: data.status,
        cutoffAt: data.cutoffAt,
        createdByUserId: data.createdByUserId,
        autoCreated: data.autoCreated,
        summaryJson: data.summaryJson,
        metadataJson: data.metadataJson,
      }),
    );

    const result: any = await (service as any).createBatch({}, 'admin-1');

    expect(result.summary.skippedSourceCount).toBe(1);
    expect(result.summary.skippedSourcesByReason).toEqual(
      expect.objectContaining({
        'CUST_BANK wallet WA-CBK-AED-NA is not regulator-enabled': 1,
      }),
    );
    expect(result.items).toHaveLength(1);
  });

  it('fails when no eligible routable source exists', async () => {
    const { prisma, service } = createService();

    prisma.outstanding.findMany.mockResolvedValue([
      buildOutstanding({
        id: 'outstanding-bad',
        direction: 'OUT',
        amount: decimal(4),
        assetId: 'asset-aed',
        asset: buildAsset('asset-aed', 'AED', 'FIAT'),
      }),
    ]);
    prisma.reimbursementObligation.findMany.mockResolvedValue([]);

    registerWallets(prisma, {
      'WA-CBK-AED-NA': buildWallet({
        id: 'wallet-aed-cust-bank',
        walletRole: 'CUST_BANK',
        walletNo: 'WA-CBK-AED-NA',
        assetId: 'asset-aed',
        regulatoryEnablementStatus: 'PENDING',
      }),
      'WA-LBK-AED-NA': buildWallet({
        id: 'wallet-aed-liq-bank',
        walletRole: 'LIQ_BANK',
        walletNo: 'WA-LBK-AED-NA',
        assetId: 'asset-aed',
      }),
    });

    await expect((service as any).createBatch({}, 'admin-1')).rejects.toThrow(
      'No eligible routable source found for pool settlement batch',
    );
    expect(prisma.poolSettlementBatch.create).not.toHaveBeenCalled();
  });

  it('does not create items for zero-net buckets', async () => {
    const { prisma, service } = createService();

    prisma.outstanding.findMany.mockResolvedValue([
      buildOutstanding({
        id: 'outstanding-1',
        direction: 'OUT',
        amount: decimal(5),
        assetId: 'asset-aed',
        asset: buildAsset('asset-aed', 'AED', 'FIAT'),
      }),
    ]);
    prisma.reimbursementObligation.findMany.mockResolvedValue([
      buildReimbursement({
        id: 'reimbursement-1',
        amount: decimal(5),
        assetId: 'asset-aed',
        asset: buildAsset('asset-aed', 'AED', 'FIAT'),
      }),
    ]);

    registerWallets(prisma, {
      'WA-CBK-AED-NA': buildWallet({
        id: 'wallet-aed-cust-bank',
        walletRole: 'CUST_BANK',
        walletNo: 'WA-CBK-AED-NA',
        assetId: 'asset-aed',
      }),
      'WA-LBK-AED-NA': buildWallet({
        id: 'wallet-aed-liq-bank',
        walletRole: 'LIQ_BANK',
        walletNo: 'WA-LBK-AED-NA',
        assetId: 'asset-aed',
      }),
    });

    prisma.poolSettlementBatch.create.mockImplementation(({ data }: any) =>
      Promise.resolve({
        id: 'batch-4',
        batchNo: data.batchNo,
        status: data.status,
        cutoffAt: data.cutoffAt,
        createdByUserId: data.createdByUserId,
        autoCreated: data.autoCreated,
        summaryJson: data.summaryJson,
        metadataJson: data.metadataJson,
      }),
    );

    const result: any = await (service as any).createBatch({}, 'admin-1');

    expect(prisma.poolSettlementBatchItem.create).not.toHaveBeenCalled();
    expect(result.items).toHaveLength(0);
    expect(result.summary.zeroNetSourceCount).toBe(2);
  });

  it('locks included sources to the created batch', async () => {
    const { prisma, service } = createService();

    prisma.outstanding.findMany.mockResolvedValue([
      buildOutstanding({
        id: 'outstanding-1',
        direction: 'OUT',
        amount: decimal(5),
        assetId: 'asset-btc',
        asset: buildAsset('asset-btc', 'BTC', 'CRYPTO', 'BITCOIN'),
      }),
    ]);
    prisma.reimbursementObligation.findMany.mockResolvedValue([]);

    registerWallets(prisma, {
      'WA-MST-BTC-BITCOIN': buildWallet({
        id: 'wallet-btc-master',
        walletRole: 'MASTER',
        walletNo: 'WA-MST-BTC-BITCOIN',
        assetId: 'asset-btc',
      }),
      'WA-LIQ-BTC-BITCOIN': buildWallet({
        id: 'wallet-btc-liq',
        walletRole: 'LIQ',
        walletNo: 'WA-LIQ-BTC-BITCOIN',
        assetId: 'asset-btc',
      }),
    });

    prisma.poolSettlementBatch.create.mockImplementation(({ data }: any) =>
      Promise.resolve({
        id: 'batch-5',
        batchNo: data.batchNo,
        status: data.status,
        cutoffAt: data.cutoffAt,
        createdByUserId: data.createdByUserId,
        autoCreated: data.autoCreated,
        summaryJson: data.summaryJson,
        metadataJson: data.metadataJson,
      }),
    );

    await (service as any).createBatch({}, 'admin-1');

    expect(prisma.outstanding.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { in: ['outstanding-1'] },
          lockedByPoolSettlementBatchId: null,
        }),
        data: expect.objectContaining({
          lockedByPoolSettlementBatchId: 'batch-5',
        }),
      }),
    );
  });

  it('uses freshly locked source values instead of the pre-lock scan snapshot', async () => {
    const { prisma, service } = createService();

    prisma.outstanding.findMany.mockImplementation(({ where }: any) => {
      if (where?.lockedByPoolSettlementBatchId) {
        return Promise.resolve([
          buildOutstanding({
            id: 'outstanding-1',
            direction: 'OUT',
            amount: decimal(7),
            assetId: 'asset-eth',
            asset: buildAsset('asset-eth', 'ETH', 'CRYPTO', 'ETHEREUM'),
          }),
        ]);
      }

      return Promise.resolve([
        buildOutstanding({
          id: 'outstanding-1',
          direction: 'OUT',
          amount: decimal(3),
          assetId: 'asset-btc',
          asset: buildAsset('asset-btc', 'BTC', 'CRYPTO', 'BITCOIN'),
        }),
      ]);
    });
    prisma.reimbursementObligation.findMany.mockImplementation(({ where }: any) => {
      if (where?.lockedByPoolSettlementBatchId) {
        return Promise.resolve([]);
      }
      return Promise.resolve([]);
    });

    registerWallets(prisma, {
      'WA-MST-BTC-BITCOIN': buildWallet({
        id: 'wallet-btc-master',
        walletRole: 'MASTER',
        walletNo: 'WA-MST-BTC-BITCOIN',
        assetId: 'asset-btc',
      }),
      'WA-LIQ-BTC-BITCOIN': buildWallet({
        id: 'wallet-btc-liq',
        walletRole: 'LIQ',
        walletNo: 'WA-LIQ-BTC-BITCOIN',
        assetId: 'asset-btc',
      }),
      'WA-MST-ETH-ETHEREUM': buildWallet({
        id: 'wallet-eth-master',
        walletRole: 'MASTER',
        walletNo: 'WA-MST-ETH-ETHEREUM',
        assetId: 'asset-eth',
      }),
      'WA-LIQ-ETH-ETHEREUM': buildWallet({
        id: 'wallet-eth-liq',
        walletRole: 'LIQ',
        walletNo: 'WA-LIQ-ETH-ETHEREUM',
        assetId: 'asset-eth',
      }),
    });

    prisma.poolSettlementBatch.create.mockImplementation(({ data }: any) =>
      Promise.resolve({
        id: 'batch-fresh-1',
        batchNo: data.batchNo,
        status: data.status,
        cutoffAt: data.cutoffAt,
        createdByUserId: data.createdByUserId,
        autoCreated: data.autoCreated,
        summaryJson: data.summaryJson,
        metadataJson: data.metadataJson,
      }),
    );

    const result: any = await (service as any).createBatch({}, 'admin-1');

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toEqual(
      expect.objectContaining({
        assetId: 'asset-eth',
        walletPairKey: 'wallet-eth-liq::wallet-eth-master',
      }),
    );
    expect(String(result.items[0].netAmount)).toBe('7');
    expect(result.itemSources[0]).toEqual(
      expect.objectContaining({
        assetId: 'asset-eth',
        fromWalletId: 'wallet-eth-master',
        toWalletId: 'wallet-eth-liq',
      }),
    );
    expect(String(result.itemSources[0].sourceAmount)).toBe('7');
  });

  it('fails when a locked source can no longer normalize after lock', async () => {
    const { prisma, service } = createService();

    prisma.outstanding.findMany.mockImplementation(({ where }: any) => {
      if (where?.lockedByPoolSettlementBatchId) {
        return Promise.resolve([
          buildOutstanding({
            id: 'outstanding-1',
            direction: 'OUT',
            amount: decimal(7),
            assetId: 'asset-unknown',
            asset: {
              id: 'asset-unknown',
              code: 'BTC',
              type: 'OTHER',
              network: null,
            },
          }),
        ]);
      }

      return Promise.resolve([
        buildOutstanding({
          id: 'outstanding-1',
          direction: 'OUT',
          amount: decimal(3),
          assetId: 'asset-btc',
          asset: buildAsset('asset-btc', 'BTC', 'CRYPTO', 'BITCOIN'),
        }),
      ]);
    });
    prisma.reimbursementObligation.findMany.mockImplementation(({ where }: any) => {
      if (where?.lockedByPoolSettlementBatchId) {
        return Promise.resolve([]);
      }
      return Promise.resolve([]);
    });

    registerWallets(prisma, {
      'WA-MST-BTC-BITCOIN': buildWallet({
        id: 'wallet-btc-master',
        walletRole: 'MASTER',
        walletNo: 'WA-MST-BTC-BITCOIN',
        assetId: 'asset-btc',
      }),
      'WA-LIQ-BTC-BITCOIN': buildWallet({
        id: 'wallet-btc-liq',
        walletRole: 'LIQ',
        walletNo: 'WA-LIQ-BTC-BITCOIN',
        assetId: 'asset-btc',
      }),
    });

    prisma.poolSettlementBatch.create.mockImplementation(({ data }: any) =>
      Promise.resolve({
        id: 'batch-fresh-fail',
        batchNo: data.batchNo,
        status: data.status,
        cutoffAt: data.cutoffAt,
        createdByUserId: data.createdByUserId,
        autoCreated: data.autoCreated,
        summaryJson: data.summaryJson,
        metadataJson: data.metadataJson,
      }),
    );

    await expect((service as any).createBatch({}, 'admin-1')).rejects.toThrow(
      'Locked outstanding source outstanding-1 failed to normalize after lock',
    );
    expect(prisma.poolSettlementBatchItem.create).not.toHaveBeenCalled();
    expect(prisma.poolSettlementBatchItemSource.create).not.toHaveBeenCalled();
    expect(prisma.poolSettlementBatch.update).not.toHaveBeenCalled();
  });

  it('only includes sources actually locked by the current batch', async () => {
    const { prisma, service } = createService();

    const openRows = [
      buildOutstanding({
        id: 'outstanding-1',
        direction: 'OUT',
        amount: decimal(5),
        assetId: 'asset-btc',
        asset: buildAsset('asset-btc', 'BTC', 'CRYPTO', 'BITCOIN'),
      }),
      buildOutstanding({
        id: 'outstanding-2',
        direction: 'OUT',
        amount: decimal(4),
        assetId: 'asset-eth',
        asset: buildAsset('asset-eth', 'ETH', 'CRYPTO', 'ETHEREUM'),
      }),
    ];

    prisma.outstanding.findMany.mockImplementation(({ where }: any) => {
      if (where?.lockedByPoolSettlementBatchId) {
        return Promise.resolve([openRows[0]]);
      }
      return Promise.resolve(openRows);
    });
    prisma.reimbursementObligation.findMany.mockImplementation(({ where }: any) => {
      if (where?.lockedByPoolSettlementBatchId) {
        return Promise.resolve([]);
      }
      return Promise.resolve([]);
    });
    prisma.outstanding.updateMany.mockResolvedValue({ count: 1 });

    registerWallets(prisma, {
      'WA-MST-BTC-BITCOIN': buildWallet({
        id: 'wallet-btc-master',
        walletRole: 'MASTER',
        walletNo: 'WA-MST-BTC-BITCOIN',
        assetId: 'asset-btc',
      }),
      'WA-LIQ-BTC-BITCOIN': buildWallet({
        id: 'wallet-btc-liq',
        walletRole: 'LIQ',
        walletNo: 'WA-LIQ-BTC-BITCOIN',
        assetId: 'asset-btc',
      }),
      'WA-MST-ETH-ETHEREUM': buildWallet({
        id: 'wallet-eth-master',
        walletRole: 'MASTER',
        walletNo: 'WA-MST-ETH-ETHEREUM',
        assetId: 'asset-eth',
      }),
      'WA-LIQ-ETH-ETHEREUM': buildWallet({
        id: 'wallet-eth-liq',
        walletRole: 'LIQ',
        walletNo: 'WA-LIQ-ETH-ETHEREUM',
        assetId: 'asset-eth',
      }),
    });

    prisma.poolSettlementBatch.create.mockImplementation(({ data }: any) =>
      Promise.resolve({
        id: 'batch-lock-1',
        batchNo: data.batchNo,
        status: data.status,
        cutoffAt: data.cutoffAt,
        createdByUserId: data.createdByUserId,
        autoCreated: data.autoCreated,
        summaryJson: data.summaryJson,
        metadataJson: data.metadataJson,
      }),
    );

    const result: any = await (service as any).createBatch({}, 'admin-1');

    expect(prisma.outstanding.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { in: ['outstanding-1', 'outstanding-2'] },
        }),
      }),
    );
    expect(prisma.poolSettlementBatchItem.create).toHaveBeenCalledTimes(1);
    expect(result.items).toHaveLength(1);
    expect(result.itemSources).toHaveLength(1);
    expect(result.summary.skippedSourceCount).toBe(1);
    expect(result.summary.skippedSourcesByReason).toEqual(
      expect.objectContaining({
        LOCK_MISS: 1,
      }),
    );
  });

  it('fails when no sources are actually locked by the batch', async () => {
    const { prisma, service } = createService();

    prisma.outstanding.findMany.mockImplementation(({ where }: any) => {
      if (where?.lockedByPoolSettlementBatchId) {
        return Promise.resolve([]);
      }
      return Promise.resolve([
        buildOutstanding({
          id: 'outstanding-1',
          direction: 'OUT',
          amount: decimal(5),
          assetId: 'asset-btc',
          asset: buildAsset('asset-btc', 'BTC', 'CRYPTO', 'BITCOIN'),
        }),
      ]);
    });
    prisma.reimbursementObligation.findMany.mockImplementation(({ where }: any) => {
      if (where?.lockedByPoolSettlementBatchId) {
        return Promise.resolve([]);
      }
      return Promise.resolve([]);
    });
    prisma.outstanding.updateMany.mockResolvedValue({ count: 0 });

    registerWallets(prisma, {
      'WA-MST-BTC-BITCOIN': buildWallet({
        id: 'wallet-btc-master',
        walletRole: 'MASTER',
        walletNo: 'WA-MST-BTC-BITCOIN',
        assetId: 'asset-btc',
      }),
      'WA-LIQ-BTC-BITCOIN': buildWallet({
        id: 'wallet-btc-liq',
        walletRole: 'LIQ',
        walletNo: 'WA-LIQ-BTC-BITCOIN',
        assetId: 'asset-btc',
      }),
    });

    prisma.poolSettlementBatch.create.mockImplementation(({ data }: any) =>
      Promise.resolve({
        id: 'batch-lock-2',
        batchNo: data.batchNo,
        status: data.status,
        cutoffAt: data.cutoffAt,
        createdByUserId: data.createdByUserId,
        autoCreated: data.autoCreated,
        summaryJson: data.summaryJson,
        metadataJson: data.metadataJson,
      }),
    );

    await expect((service as any).createBatch({}, 'admin-1')).rejects.toThrow(
      'No sources were locked for pool settlement batch',
    );
    expect(prisma.poolSettlementBatchItem.create).not.toHaveBeenCalled();
  });

  it('nets across outstanding and reimbursement sources in one bucket', async () => {
    const { prisma, service } = createService();

    prisma.outstanding.findMany.mockResolvedValue([
      buildOutstanding({
        id: 'outstanding-1',
        direction: 'OUT',
        amount: decimal(3),
        assetId: 'asset-btc',
        asset: buildAsset('asset-btc', 'BTC', 'CRYPTO', 'BITCOIN'),
      }),
    ]);
    prisma.reimbursementObligation.findMany.mockResolvedValue([
      buildReimbursement({
        id: 'reimbursement-1',
        amount: decimal(1),
        assetId: 'asset-btc',
        asset: buildAsset('asset-btc', 'BTC', 'CRYPTO', 'BITCOIN'),
      }),
    ]);

    registerWallets(prisma, {
      'WA-MST-BTC-BITCOIN': buildWallet({
        id: 'wallet-btc-master',
        walletRole: 'MASTER',
        walletNo: 'WA-MST-BTC-BITCOIN',
        assetId: 'asset-btc',
      }),
      'WA-LIQ-BTC-BITCOIN': buildWallet({
        id: 'wallet-btc-liq',
        walletRole: 'LIQ',
        walletNo: 'WA-LIQ-BTC-BITCOIN',
        assetId: 'asset-btc',
      }),
    });

    prisma.poolSettlementBatch.create.mockImplementation(({ data }: any) =>
      Promise.resolve({
        id: 'batch-6',
        batchNo: data.batchNo,
        status: data.status,
        cutoffAt: data.cutoffAt,
        createdByUserId: data.createdByUserId,
        autoCreated: data.autoCreated,
        summaryJson: data.summaryJson,
        metadataJson: data.metadataJson,
      }),
    );

    const result: any = await (service as any).createBatch({}, 'admin-1');

    expect(result.items).toHaveLength(1);
    expect(result.itemSources).toHaveLength(2);
    expect(result.items[0]).toEqual(
      expect.objectContaining({
        assetId: 'asset-btc',
        walletPairKey: expect.any(String),
        netAmount: expect.any(Object),
      }),
    );
  });

  it('normalizes crypto reimbursement to the MASTER side', async () => {
    const { prisma, service } = createService();

    prisma.outstanding.findMany.mockResolvedValue([]);
    prisma.reimbursementObligation.findMany.mockResolvedValue([
      buildReimbursement({
        id: 'reimbursement-1',
        amount: decimal(2),
        poolRole: 'PAYOUT',
        sourceWalletId: 'wallet-payout',
        assetId: 'asset-btc',
        asset: buildAsset('asset-btc', 'BTC', 'CRYPTO', 'BITCOIN'),
      }),
    ]);

    registerWallets(prisma, {
      'WA-MST-BTC-BITCOIN': buildWallet({
        id: 'wallet-btc-master',
        walletRole: 'MASTER',
        walletNo: 'WA-MST-BTC-BITCOIN',
        assetId: 'asset-btc',
      }),
      'WA-LIQ-BTC-BITCOIN': buildWallet({
        id: 'wallet-btc-liq',
        walletRole: 'LIQ',
        walletNo: 'WA-LIQ-BTC-BITCOIN',
        assetId: 'asset-btc',
      }),
    });

    prisma.poolSettlementBatch.create.mockImplementation(({ data }: any) =>
      Promise.resolve({
        id: 'batch-7',
        batchNo: data.batchNo,
        status: data.status,
        cutoffAt: data.cutoffAt,
        createdByUserId: data.createdByUserId,
        autoCreated: data.autoCreated,
        summaryJson: data.summaryJson,
        metadataJson: data.metadataJson,
      }),
    );

    await (service as any).createBatch({}, 'admin-1');

    expect(prisma.poolSettlementBatchItemSource.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          sourceFamily: 'REIMBURSEMENT_OBLIGATION',
          fromWalletId: 'wallet-btc-liq',
          toWalletId: 'wallet-btc-master',
        }),
      }),
    );
  });
});
