import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PoolSettlementBatchesService } from './pool-settlement-batches.service';

describe('PoolSettlementBatchesService', () => {
  const decimal = (value: string | number) => new Prisma.Decimal(value);

  const buildWallet = (overrides: Record<string, unknown>) => ({
    id: 'wallet-unknown',
    status: 'ACTIVE',
    walletRole: 'F_OPS',
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
    poolRole: 'C_OUT',
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
        findMany: jest.fn(),
        findUnique: jest.fn(),
        count: jest.fn(),
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
    const approvalsService = {
      createAndSubmit: jest.fn(),
      emitSubmittedSideEffects: jest.fn(),
    } as any;
    const service = new PoolSettlementBatchesService(prisma, approvalsService, {} as any, {} as any);
    return { prisma, service, approvalsService };
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
        walletRole: 'C_MAIN',
        walletNo: 'WA-MST-BTC-BITCOIN',
        assetId: 'asset-btc',
      }),
      'WA-LIQ-BTC-BITCOIN': buildWallet({
        id: 'wallet-btc-liq',
        walletRole: 'F_LIQ',
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
        walletRole: 'C_MAIN',
        walletNo: 'WA-MST-BTC-BITCOIN',
        assetId: 'asset-btc',
      }),
      'WA-LIQ-BTC-BITCOIN': buildWallet({
        id: 'wallet-btc-liq',
        walletRole: 'F_LIQ',
        walletNo: 'WA-LIQ-BTC-BITCOIN',
        assetId: 'asset-btc',
      }),
      'WA-MST-ETH-ETHEREUM': buildWallet({
        id: 'wallet-eth-master',
        walletRole: 'C_MAIN',
        walletNo: 'WA-MST-ETH-ETHEREUM',
        assetId: 'asset-eth',
      }),
      'WA-LIQ-ETH-ETHEREUM': buildWallet({
        id: 'wallet-eth-liq',
        walletRole: 'F_LIQ',
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
        walletRole: 'C_CMA',
        walletNo: 'WA-CBK-AED-NA',
        assetId: 'asset-aed',
        regulatoryEnablementStatus: 'PENDING',
      }),
      'WA-LBK-AED-NA': buildWallet({
        id: 'wallet-aed-liq-bank',
        walletRole: 'F_LIQ',
        walletNo: 'WA-LBK-AED-NA',
        assetId: 'asset-aed',
      }),
      'WA-MST-BTC-BITCOIN': buildWallet({
        id: 'wallet-btc-master',
        walletRole: 'C_MAIN',
        walletNo: 'WA-MST-BTC-BITCOIN',
        assetId: 'asset-btc',
      }),
      'WA-LIQ-BTC-BITCOIN': buildWallet({
        id: 'wallet-btc-liq',
        walletRole: 'F_LIQ',
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
        walletRole: 'C_CMA',
        walletNo: 'WA-CBK-AED-NA',
        assetId: 'asset-aed',
        regulatoryEnablementStatus: 'PENDING',
      }),
      'WA-LBK-AED-NA': buildWallet({
        id: 'wallet-aed-liq-bank',
        walletRole: 'F_LIQ',
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
        walletRole: 'C_CMA',
        walletNo: 'WA-CBK-AED-NA',
        assetId: 'asset-aed',
      }),
      'WA-LBK-AED-NA': buildWallet({
        id: 'wallet-aed-liq-bank',
        walletRole: 'F_LIQ',
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
        walletRole: 'C_MAIN',
        walletNo: 'WA-MST-BTC-BITCOIN',
        assetId: 'asset-btc',
      }),
      'WA-LIQ-BTC-BITCOIN': buildWallet({
        id: 'wallet-btc-liq',
        walletRole: 'F_LIQ',
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
        walletRole: 'C_MAIN',
        walletNo: 'WA-MST-BTC-BITCOIN',
        assetId: 'asset-btc',
      }),
      'WA-LIQ-BTC-BITCOIN': buildWallet({
        id: 'wallet-btc-liq',
        walletRole: 'F_LIQ',
        walletNo: 'WA-LIQ-BTC-BITCOIN',
        assetId: 'asset-btc',
      }),
      'WA-MST-ETH-ETHEREUM': buildWallet({
        id: 'wallet-eth-master',
        walletRole: 'C_MAIN',
        walletNo: 'WA-MST-ETH-ETHEREUM',
        assetId: 'asset-eth',
      }),
      'WA-LIQ-ETH-ETHEREUM': buildWallet({
        id: 'wallet-eth-liq',
        walletRole: 'F_LIQ',
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
        walletRole: 'C_MAIN',
        walletNo: 'WA-MST-BTC-BITCOIN',
        assetId: 'asset-btc',
      }),
      'WA-LIQ-BTC-BITCOIN': buildWallet({
        id: 'wallet-btc-liq',
        walletRole: 'F_LIQ',
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
        walletRole: 'C_MAIN',
        walletNo: 'WA-MST-BTC-BITCOIN',
        assetId: 'asset-btc',
      }),
      'WA-LIQ-BTC-BITCOIN': buildWallet({
        id: 'wallet-btc-liq',
        walletRole: 'F_LIQ',
        walletNo: 'WA-LIQ-BTC-BITCOIN',
        assetId: 'asset-btc',
      }),
      'WA-MST-ETH-ETHEREUM': buildWallet({
        id: 'wallet-eth-master',
        walletRole: 'C_MAIN',
        walletNo: 'WA-MST-ETH-ETHEREUM',
        assetId: 'asset-eth',
      }),
      'WA-LIQ-ETH-ETHEREUM': buildWallet({
        id: 'wallet-eth-liq',
        walletRole: 'F_LIQ',
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
        walletRole: 'C_MAIN',
        walletNo: 'WA-MST-BTC-BITCOIN',
        assetId: 'asset-btc',
      }),
      'WA-LIQ-BTC-BITCOIN': buildWallet({
        id: 'wallet-btc-liq',
        walletRole: 'F_LIQ',
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
        walletRole: 'C_MAIN',
        walletNo: 'WA-MST-BTC-BITCOIN',
        assetId: 'asset-btc',
      }),
      'WA-LIQ-BTC-BITCOIN': buildWallet({
        id: 'wallet-btc-liq',
        walletRole: 'F_LIQ',
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
        poolRole: 'C_OUT',
        sourceWalletId: 'wallet-payout',
        assetId: 'asset-btc',
        asset: buildAsset('asset-btc', 'BTC', 'CRYPTO', 'BITCOIN'),
      }),
    ]);

    registerWallets(prisma, {
      'WA-MST-BTC-BITCOIN': buildWallet({
        id: 'wallet-btc-master',
        walletRole: 'C_MAIN',
        walletNo: 'WA-MST-BTC-BITCOIN',
        assetId: 'asset-btc',
      }),
      'WA-LIQ-BTC-BITCOIN': buildWallet({
        id: 'wallet-btc-liq',
        walletRole: 'F_LIQ',
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

  it('lists admin batches with supported filters and parsed summary json', async () => {
    const { prisma, service } = createService();
    const cutoffAt = new Date('2026-04-01T10:00:00.000Z');
    const createdAt = new Date('2026-04-01T09:00:00.000Z');

    prisma.poolSettlementBatch.findMany.mockResolvedValue([
      {
        id: 'batch-1',
        batchNo: 'PSB-0001',
        status: 'CREATED',
        cutoffAt,
        submittedAt: null,
        approvedAt: null,
        closedAt: null,
        approvalCaseId: null,
        autoCreated: false,
        createdAt,
        createdByUserId: 'admin-1',
        summaryJson: '{"routableSourceCount":2,"skippedSourceCount":1}',
      },
    ]);
    prisma.poolSettlementBatch.count.mockResolvedValue(1);

    const result = await service.findAllForAdmin({
      status: 'CREATED' as any,
      autoCreated: false,
      skip: 5,
      take: 10,
    });

    expect(prisma.poolSettlementBatch.findMany).toHaveBeenCalledWith({
      where: {
        status: 'CREATED',
        autoCreated: false,
      },
      skip: 5,
      take: 10,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        batchNo: true,
        status: true,
        cutoffAt: true,
        submittedAt: true,
        approvedAt: true,
        closedAt: true,
        approvalCaseId: true,
        autoCreated: true,
        createdAt: true,
        createdByUserId: true,
        summaryJson: true,
      },
    });
    expect(result).toEqual({
      items: [
        expect.objectContaining({
          id: 'batch-1',
          batchNo: 'PSB-0001',
          summaryJson: {
            routableSourceCount: 2,
            skippedSourceCount: 1,
          },
        }),
      ],
      total: 1,
      skip: 5,
      take: 10,
    });
  });

  it('returns batch detail with parsed json, linked items and null-item sources', async () => {
    const { prisma, service } = createService();

    prisma.poolSettlementBatch.findUnique.mockResolvedValue({
      id: 'batch-1',
      batchNo: 'PSB-0001',
      status: 'CREATED',
      cutoffAt: new Date('2026-04-01T10:00:00.000Z'),
      submittedAt: null,
      approvedAt: null,
      closedAt: null,
      approvalCaseId: 'approval-1',
      createdByUserId: 'admin-1',
      autoCreated: false,
      summaryJson: '{"skippedSourcesByReason":{"LOCK_MISS":1}}',
      metadataJson: '{"source":"manual"}',
      createdAt: new Date('2026-04-01T09:00:00.000Z'),
      updatedAt: new Date('2026-04-01T09:30:00.000Z'),
      items: [
        {
          id: 'item-1',
          batchId: 'batch-1',
          status: 'READY',
          assetId: 'asset-btc',
          walletPairKey: 'wallet-a::wallet-b',
          walletAId: 'wallet-a',
          walletBId: 'wallet-b',
          netDirection: 'A_TO_B',
          netAmount: decimal(3),
          submittedAmount: decimal(1),
          settledAmount: decimal(0),
          failedReason: null,
          createdAt: new Date('2026-04-01T09:05:00.000Z'),
          updatedAt: new Date('2026-04-01T09:05:00.000Z'),
          asset: buildAsset('asset-btc', 'BTC', 'CRYPTO', 'BITCOIN'),
          walletA: buildWallet({
            id: 'wallet-a',
            walletNo: 'WA-MST-BTC-BITCOIN',
            walletRole: 'C_MAIN',
          }),
          walletB: buildWallet({
            id: 'wallet-b',
            walletNo: 'WA-LIQ-BTC-BITCOIN',
            walletRole: 'F_LIQ',
          }),
          internalTransaction: {
            id: 'internal-tx-1',
            internalTxNo: 'ITX-1',
            status: 'PENDING',
          },
        },
      ],
      itemSources: [
        {
          id: 'source-1',
          batchId: 'batch-1',
          batchItemId: 'item-1',
          sourceFamily: 'OUTSTANDING',
          sourceId: 'outstanding-1',
          assetId: 'asset-btc',
          fromWalletId: 'wallet-a',
          toWalletId: 'wallet-b',
          direction: 'A_TO_B',
          sourceAmount: decimal(3),
          nettedAmount: decimal(0),
          settledAmount: decimal(0),
          status: 'LINKED',
          closeReason: null,
          createdAt: new Date('2026-04-01T09:05:00.000Z'),
          updatedAt: new Date('2026-04-01T09:05:00.000Z'),
          asset: buildAsset('asset-btc', 'BTC', 'CRYPTO', 'BITCOIN'),
          fromWallet: buildWallet({
            id: 'wallet-a',
            walletNo: 'WA-MST-BTC-BITCOIN',
            walletRole: 'C_MAIN',
          }),
          toWallet: buildWallet({
            id: 'wallet-b',
            walletNo: 'WA-LIQ-BTC-BITCOIN',
            walletRole: 'F_LIQ',
          }),
        },
        {
          id: 'source-2',
          batchId: 'batch-1',
          batchItemId: null,
          sourceFamily: 'REIMBURSEMENT_OBLIGATION',
          sourceId: 'reimbursement-1',
          assetId: 'asset-btc',
          fromWalletId: 'wallet-b',
          toWalletId: 'wallet-a',
          direction: 'B_TO_A',
          sourceAmount: decimal(1),
          nettedAmount: decimal(1),
          settledAmount: decimal(0),
          status: 'NETTED',
          closeReason: 'NETTED',
          createdAt: new Date('2026-04-01T09:06:00.000Z'),
          updatedAt: new Date('2026-04-01T09:06:00.000Z'),
          asset: buildAsset('asset-btc', 'BTC', 'CRYPTO', 'BITCOIN'),
          fromWallet: buildWallet({
            id: 'wallet-b',
            walletNo: 'WA-LIQ-BTC-BITCOIN',
            walletRole: 'F_LIQ',
          }),
          toWallet: buildWallet({
            id: 'wallet-a',
            walletNo: 'WA-MST-BTC-BITCOIN',
            walletRole: 'C_MAIN',
          }),
        },
      ],
    });

    const result = await service.findDetailForAdmin('batch-1');

    expect(prisma.poolSettlementBatch.findUnique).toHaveBeenCalledWith({
      where: { id: 'batch-1' },
      include: {
        items: {
          include: {
            asset: true,
            walletA: true,
            walletB: true,
            internalTransaction: {
              select: {
                id: true,
                internalTxNo: true,
                status: true,
              },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
        itemSources: {
          include: {
            asset: true,
            fromWallet: true,
            toWallet: true,
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    expect(result).toEqual(
      expect.objectContaining({
        id: 'batch-1',
        summaryJson: { skippedSourcesByReason: { LOCK_MISS: 1 } },
        metadataJson: { source: 'manual' },
        items: [
          expect.objectContaining({
            id: 'item-1',
            internalTransactionId: 'internal-tx-1',
          }),
        ],
        itemSources: [
          expect.objectContaining({ id: 'source-1', batchItemId: 'item-1' }),
          expect.objectContaining({ id: 'source-2', batchItemId: null }),
        ],
        internalTransactions: [
          {
            id: 'internal-tx-1',
            internalTxNo: 'ITX-1',
            status: 'PENDING',
            batchItemId: 'item-1',
          },
        ],
      }),
    );
  });

  it('throws not found when detail batch is missing', async () => {
    const { prisma, service } = createService();
    prisma.poolSettlementBatch.findUnique.mockResolvedValue(null);

    await expect(service.findDetailForAdmin('missing-batch')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
