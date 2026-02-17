import { Prisma } from '@prisma/client';
import { InternalTransactionsService } from './internal-transactions.service';
import { InternalTransactionStatus } from './dto/internal-transaction.dto';

describe('InternalTransactionsService', () => {
  let service: InternalTransactionsService;
  let prisma: any;
  let journalsService: any;
  let clearingsService: any;

  beforeEach(() => {
    prisma = {
      internalTransaction: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      internalTransactionAuditLog: {
        create: jest.fn(),
      },
      $transaction: jest.fn((cb: any) => cb(prisma)),
    };

    journalsService = {
      triggerEvent: jest.fn(),
    };

    clearingsService = {
      triggerClearing: jest.fn(),
    };

    service = new InternalTransactionsService(
      prisma,
      journalsService,
      clearingsService,
    );
    jest.clearAllMocks();
  });

  it('should aggregate to SUCCESS when all internal funds are CONFIRMED/CLEAR', async () => {
    prisma.internalTransaction.findUnique.mockResolvedValue({
      id: 'itx-1',
      internalTxNo: 'ITX001',
      status: InternalTransactionStatus.INTERNAL_FUNDS_PENDING,
      statusHistory: '[]',
      ownerId: 'cust-1',
      ownerType: 'CUSTOMER',
      assetId: 'asset-1',
      amount: new Prisma.Decimal(10),
      netAmount: new Prisma.Decimal(10),
      feeAmount: new Prisma.Decimal(0),
      funds: [{ status: 'CONFIRMED' }, { status: 'CLEAR' }],
    });
    prisma.internalTransaction.update.mockResolvedValue({
      id: 'itx-1',
      internalTxNo: 'ITX001',
      status: InternalTransactionStatus.SUCCESS,
      ownerId: 'cust-1',
      ownerType: 'CUSTOMER',
      assetId: 'asset-1',
      amount: new Prisma.Decimal(10),
      netAmount: new Prisma.Decimal(10),
      feeAmount: new Prisma.Decimal(0),
    });
    prisma.internalTransactionAuditLog.create.mockResolvedValue({ id: 'log-1' });
    journalsService.triggerEvent.mockResolvedValue({ id: 'journal-1' });

    const result = await service.syncStatusFromFunds('itx-1', 'SYSTEM');

    expect(result.status).toBe(InternalTransactionStatus.SUCCESS);
    expect(journalsService.triggerEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'INTERNAL_TX',
        toStatus: InternalTransactionStatus.SUCCESS,
      }),
      prisma,
    );
    expect(clearingsService.triggerClearing).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceType: 'INTERNAL_TX',
        sourceId: 'itx-1',
        eventCode: 'EVT_INTERNAL_TX_SUCCESS',
      }),
      prisma,
    );
  });

  it('should trigger created event when creating from deposit success', async () => {
    prisma.internalTransaction.findUnique.mockResolvedValueOnce(null);
    prisma.internalTransaction.create.mockResolvedValue({
      id: 'itx-created',
      internalTxNo: 'ITX_NEW_1',
      status: InternalTransactionStatus.INTERNAL_FUNDS_PENDING,
      ownerType: 'CUSTOMER',
      ownerId: 'cust-1',
      assetId: 'asset-1',
      amount: new Prisma.Decimal(10),
      netAmount: new Prisma.Decimal(10),
      feeAmount: new Prisma.Decimal(0),
      fromWalletId: 'wallet-deposit',
      toWalletId: 'wallet-master',
      fromWallet: { id: 'wallet-deposit', ownerType: 'CUSTOMER' },
      toWallet: { id: 'wallet-master', ownerType: 'CUSTOMER' },
      asset: { type: 'CRYPTO' },
    });
    prisma.internalTransactionAuditLog.create.mockResolvedValue({ id: 'log-created' });
    journalsService.triggerEvent.mockResolvedValue({ id: 'journal-created' });

    const created = await service.createFromDepositSuccess(
      {
        deposit: {
          id: 'dep-1',
          depositNo: 'DEP001',
          ownerType: 'CUSTOMER',
          ownerId: 'cust-1',
          ownerNo: 'C001',
          assetId: 'asset-1',
          amount: new Prisma.Decimal(10),
          netAmount: new Prisma.Decimal(10),
          feeAmount: new Prisma.Decimal(0),
          toWalletId: 'wallet-deposit',
          toAddress: 'addr-deposit',
          toIban: null,
        },
        masterWallet: {
          id: 'wallet-master',
          address: 'addr-master',
          iban: null,
        },
      },
      'SYSTEM',
    );

    expect(created.id).toBe('itx-created');
    expect(journalsService.triggerEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'INTERNAL_TX',
        toStatus: InternalTransactionStatus.INTERNAL_FUNDS_PENDING,
        sourceId: 'itx-created',
      }),
      prisma,
    );
  });

  it('should not trigger created event on idempotent createFromDepositSuccess', async () => {
    prisma.internalTransaction.findUnique.mockResolvedValue({
      id: 'itx-existing',
      internalTxNo: 'ITX_EXIST',
      status: InternalTransactionStatus.INTERNAL_FUNDS_PENDING,
    });

    const existing = await service.createFromDepositSuccess(
      {
        deposit: {
          id: 'dep-dup',
          depositNo: 'DEP-DUP',
          ownerType: 'CUSTOMER',
          ownerId: 'cust-1',
          ownerNo: 'C001',
          assetId: 'asset-1',
          amount: new Prisma.Decimal(5),
          netAmount: new Prisma.Decimal(5),
          feeAmount: new Prisma.Decimal(0),
          toWalletId: 'wallet-deposit',
          toAddress: 'addr-deposit',
          toIban: null,
        },
        masterWallet: {
          id: 'wallet-master',
          address: 'addr-master',
          iban: null,
        },
      },
      'SYSTEM',
    );

    expect(existing.id).toBe('itx-existing');
    expect(prisma.internalTransaction.create).not.toHaveBeenCalled();
    expect(journalsService.triggerEvent).not.toHaveBeenCalled();
  });

  it('should aggregate to FAILED when has FAILED/TIMEOUT and no progressing fund', async () => {
    prisma.internalTransaction.findUnique.mockResolvedValue({
      id: 'itx-2',
      internalTxNo: 'ITX002',
      status: InternalTransactionStatus.INTERNAL_FUNDS_PENDING,
      statusHistory: '[]',
      ownerId: 'cust-1',
      ownerType: 'CUSTOMER',
      assetId: 'asset-1',
      amount: new Prisma.Decimal(10),
      netAmount: new Prisma.Decimal(10),
      feeAmount: new Prisma.Decimal(0),
      funds: [{ status: 'FAILED' }, { status: 'TIMEOUT' }],
    });
    prisma.internalTransaction.update.mockResolvedValue({
      id: 'itx-2',
      internalTxNo: 'ITX002',
      status: InternalTransactionStatus.FAILED,
      ownerId: 'cust-1',
      ownerType: 'CUSTOMER',
      assetId: 'asset-1',
      amount: new Prisma.Decimal(10),
      netAmount: new Prisma.Decimal(10),
      feeAmount: new Prisma.Decimal(0),
    });
    prisma.internalTransactionAuditLog.create.mockResolvedValue({ id: 'log-2' });
    journalsService.triggerEvent.mockResolvedValue({ id: 'journal-2' });

    const result = await service.syncStatusFromFunds('itx-2', 'SYSTEM');

    expect(result.status).toBe(InternalTransactionStatus.FAILED);
    expect(journalsService.triggerEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        toStatus: InternalTransactionStatus.FAILED,
      }),
      prisma,
    );
    expect(clearingsService.triggerClearing).not.toHaveBeenCalled();
  });

  it('should aggregate to CANCELLED when all internal funds are CANCELLED', async () => {
    prisma.internalTransaction.findUnique.mockResolvedValue({
      id: 'itx-3',
      internalTxNo: 'ITX003',
      status: InternalTransactionStatus.INTERNAL_FUNDS_PENDING,
      statusHistory: '[]',
      ownerId: 'cust-1',
      ownerType: 'CUSTOMER',
      assetId: 'asset-1',
      amount: new Prisma.Decimal(10),
      netAmount: new Prisma.Decimal(10),
      feeAmount: new Prisma.Decimal(0),
      funds: [{ status: 'CANCELLED' }, { status: 'CANCELLED' }],
    });
    prisma.internalTransaction.update.mockResolvedValue({
      id: 'itx-3',
      internalTxNo: 'ITX003',
      status: InternalTransactionStatus.CANCELLED,
      ownerId: 'cust-1',
      ownerType: 'CUSTOMER',
      assetId: 'asset-1',
      amount: new Prisma.Decimal(10),
      netAmount: new Prisma.Decimal(10),
      feeAmount: new Prisma.Decimal(0),
    });
    prisma.internalTransactionAuditLog.create.mockResolvedValue({ id: 'log-3' });
    journalsService.triggerEvent.mockResolvedValue({ id: 'journal-3' });

    const result = await service.syncStatusFromFunds('itx-3', 'SYSTEM');

    expect(result.status).toBe(InternalTransactionStatus.CANCELLED);
    expect(journalsService.triggerEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        toStatus: InternalTransactionStatus.CANCELLED,
      }),
      prisma,
    );
    expect(clearingsService.triggerClearing).not.toHaveBeenCalled();
  });
});
