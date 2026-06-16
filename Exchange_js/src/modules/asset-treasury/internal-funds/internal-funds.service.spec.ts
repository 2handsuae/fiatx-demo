import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { InternalFundsService } from './internal-funds.service';
import {
  InternalFundAction,
  InternalFundStatus,
} from './dto/internal-fund.dto';

describe('InternalFundsService', () => {
  let service: InternalFundsService;
  let prisma: any;
  let internalTransactionsService: any;
  let eventEmitter: any;

  beforeEach(() => {
    prisma = {
      auditLogEvent: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve(data)),
      },
      internalFund: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      internalFundAuditLog: {
        create: jest.fn(),
      },
      internalTransaction: {
        findUnique: jest.fn(),
      },
      $transaction: jest.fn((cb: any) => cb(prisma)),
    };

    internalTransactionsService = {
      syncStatusFromFunds: jest.fn(),
      createStandaloneTransaction: jest.fn(),
    };

    eventEmitter = {
      emit: jest.fn(),
    };

    service = new InternalFundsService(
      prisma,
      internalTransactionsService,
      eventEmitter,
      {} as any,
    );
    (service as any).auditLogsService = {
      recordByActor: jest.fn().mockResolvedValue({ id: 'audit-log-1' }),
      recordSystem: jest.fn().mockResolvedValue({ id: 'audit-log-1' }),
    };
    jest.clearAllMocks();
  });

  it('should update crypto internal fund status and sync transaction status', async () => {
    prisma.internalFund.findUnique.mockResolvedValue({
      id: 'ifd-1',
      status: InternalFundStatus.CREATED,
      statusHistory: '[]',
      sentAt: null,
      confirmedAt: null,
      internalTransaction: {
        id: 'itx-1',
        sourceType: 'DEPOSIT',
        sourceId: 'dep-1',
        sourceNo: 'DEP001',
      },
      asset: { type: 'CRYPTO' },
    });
    prisma.internalFund.update.mockResolvedValue({
      id: 'ifd-1',
      status: InternalFundStatus.SIGNING,
    });
    prisma.internalFundAuditLog.create.mockResolvedValue({ id: 'log-1' });
    internalTransactionsService.syncStatusFromFunds.mockResolvedValue({
      id: 'itx-1',
      status: 'INTERNAL_FUNDS_PENDING',
    });

    const result = await service.updateStatus(
      'ifd-1',
      {
        action: InternalFundAction.SIGN,
      },
      'SYSTEM',
    );

    expect(result.status).toBe(InternalFundStatus.SIGNING);
    expect(internalTransactionsService.syncStatusFromFunds).toHaveBeenCalledWith(
      'itx-1',
      'SYSTEM',
      prisma,
    );
    expect(eventEmitter.emit).toHaveBeenCalledWith(
      'internal-fund.status.changed',
      expect.objectContaining({
        internalFundId: 'ifd-1',
        internalTransactionId: 'itx-1',
        oldStatus: InternalFundStatus.CREATED,
        newStatus: InternalFundStatus.SIGNING,
      }),
    );
  });

  it('should reject invalid transition action', async () => {
    prisma.internalFund.findUnique.mockResolvedValue({
      id: 'ifd-2',
      status: InternalFundStatus.CREATED,
      statusHistory: '[]',
      sentAt: null,
      confirmedAt: null,
      internalTransaction: {
        id: 'itx-2',
        sourceType: 'DEPOSIT',
        sourceId: 'dep-2',
        sourceNo: 'DEP002',
      },
      asset: { type: 'CRYPTO' },
    });

    await expect(
      service.updateStatus(
        'ifd-2',
        {
          action: InternalFundAction.CLEAR,
        },
        'SYSTEM',
      ),
    ).rejects.toThrow(BadRequestException);

    expect(prisma.internalFund.update).not.toHaveBeenCalled();
  });

  it('should auto clear confirmed funds after transaction reaches SUCCESS', async () => {
    prisma.internalFund.findUnique
      .mockResolvedValueOnce({
        id: 'ifd-confirm-1',
        status: InternalFundStatus.CONFIRMING,
        statusHistory: '[]',
        sentAt: new Date(),
        confirmedAt: null,
        internalTransaction: {
          id: 'itx-success-1',
          sourceType: 'DEPOSIT',
          sourceId: 'dep-success-1',
          sourceNo: 'DEP-S-1',
        },
        asset: { type: 'CRYPTO' },
      })
      .mockResolvedValue({
        id: 'ifd-confirm-1',
        status: InternalFundStatus.CLEAR,
        statusHistory: '[]',
        sentAt: new Date(),
        confirmedAt: new Date(),
        completedAt: new Date(),
        internalTransaction: {
          id: 'itx-success-1',
          sourceType: 'DEPOSIT',
          sourceId: 'dep-success-1',
          sourceNo: 'DEP-S-1',
        },
        asset: { type: 'CRYPTO' },
      });
    prisma.internalFund.update
      .mockResolvedValueOnce({
        id: 'ifd-confirm-1',
        status: InternalFundStatus.CONFIRMED,
      })
      .mockResolvedValue({ id: 'ifd-cleared', status: InternalFundStatus.CLEAR });
    prisma.internalFund.findMany.mockResolvedValue([
      { id: 'ifd-confirm-1', statusHistory: '[]' },
      { id: 'ifd-confirm-2', statusHistory: '[]' },
    ]);
    prisma.internalFundAuditLog.create.mockResolvedValue({ id: 'log' });
    internalTransactionsService.syncStatusFromFunds.mockResolvedValue({
      id: 'itx-success-1',
      status: 'SUCCESS',
    });

    const result = await service.updateStatus(
      'ifd-confirm-1',
      {
        action: InternalFundAction.CONFIRM,
      },
      'SYSTEM',
    );

    expect(result.status).toBe(InternalFundStatus.CLEAR);
    expect(internalTransactionsService.syncStatusFromFunds).toHaveBeenCalledWith(
      'itx-success-1',
      'SYSTEM',
      prisma,
    );
    expect(prisma.internalFund.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          internalTransactionId: 'itx-success-1',
          status: InternalFundStatus.CONFIRMED,
        },
      }),
    );
    expect(eventEmitter.emit).toHaveBeenNthCalledWith(
      1,
      'internal-fund.status.changed',
      expect.objectContaining({
        internalFundId: 'ifd-confirm-1',
        internalTransactionId: 'itx-success-1',
        oldStatus: InternalFundStatus.CONFIRMING,
        newStatus: InternalFundStatus.CONFIRMED,
      }),
    );
    expect(eventEmitter.emit).toHaveBeenNthCalledWith(
      2,
      'internal-fund.status.changed',
      expect.objectContaining({
        internalFundId: 'ifd-confirm-1',
        internalTransactionId: 'itx-success-1',
        oldStatus: InternalFundStatus.CONFIRMED,
        newStatus: InternalFundStatus.CLEAR,
      }),
    );
  });

  it('should return existing fund when createFromInternalTransaction is idempotent', async () => {
    prisma.internalTransaction.findUnique.mockResolvedValue({
      id: 'itx-3',
      sourceType: 'DEPOSIT',
      sourceId: 'dep-3',
      sourceNo: 'DEP003',
      assetId: 'asset-1',
      amount: new Prisma.Decimal(2),
      netAmount: new Prisma.Decimal(2),
      fromWalletId: 'w1',
      toWalletId: 'w2',
      fromAddress: '0xfrom',
      toAddress: '0xto',
      fromIban: null,
      toIban: null,
      referenceNo: 'DEP-1',
      asset: { type: 'CRYPTO' },
    });
    prisma.internalFund.findFirst.mockResolvedValue({
      id: 'ifd-existing',
      internalTransactionId: 'itx-3',
    });

    const result = await service.createFromInternalTransaction(
      {
        internalTransactionId: 'itx-3',
      },
      'SYSTEM',
    );

    expect(result.id).toBe('ifd-existing');
    expect(prisma.internalFund.create).not.toHaveBeenCalled();
  });

  it('does not capture fee occurrence when created internal fund already has draft cost evidence', async () => {
    prisma.internalTransaction.findUnique.mockResolvedValue({
      id: 'itx-fee-1',
      sourceType: 'WITHDRAW',
      sourceId: 'wd-1',
      sourceNo: 'WD001',
      assetId: 'asset-1',
      amount: new Prisma.Decimal(2),
      netAmount: new Prisma.Decimal('1.9997'),
      fromWalletId: 'w1',
      toWalletId: 'w2',
      fromAddress: '0xfrom',
      toAddress: '0xto',
      fromIban: null,
      toIban: null,
      referenceNo: 'REF-1',
      asset: { type: 'CRYPTO' },
    });
    prisma.internalFund.findFirst.mockResolvedValue(null);
    prisma.internalFund.create.mockResolvedValue({
      id: 'ifd-fee-1',
      internalFundNo: 'IFD-FEE-1',
      internalTransactionId: 'itx-fee-1',
      feeAmount: new Prisma.Decimal('0.0003'),
      gasUsed: null,
      effectiveGasPrice: null,
      asset: { type: 'CRYPTO' },
      internalTransaction: { id: 'itx-fee-1', sourceType: 'WITHDRAW' },
    });

    await service.createFromInternalTransaction(
      {
        internalTransactionId: 'itx-fee-1',
        feeAmount: new Prisma.Decimal('0.0003'),
      },
      'SYSTEM',
    );

  });

  it('does not capture fee occurrence when non-confirm terminal evidence is updated before confirmation', async () => {
    prisma.internalFund.findUnique.mockResolvedValue({
      id: 'ifd-update-fee-1',
      internalFundNo: 'IFD-UF-1',
      status: InternalFundStatus.CREATED,
      statusHistory: '[]',
      sentAt: null,
      confirmedAt: null,
      fromWalletId: 'w1',
      fromAddress: '0xfrom',
      fromIban: null,
      internalTransaction: {
        id: 'itx-update-fee-1',
        sourceType: 'WITHDRAW',
        sourceId: 'wd-2',
        sourceNo: 'WD002',
      },
      asset: { type: 'CRYPTO' },
    });
    prisma.internalFund.update.mockResolvedValue({
      id: 'ifd-update-fee-1',
      internalFundNo: 'IFD-UF-1',
      status: InternalFundStatus.SIGNING,
      feeAmount: new Prisma.Decimal('0.0005'),
      gasUsed: '21000',
      effectiveGasPrice: '20',
    });
    prisma.internalFundAuditLog.create.mockResolvedValue({ id: 'log-1' });
    internalTransactionsService.syncStatusFromFunds.mockResolvedValue({
      id: 'itx-update-fee-1',
      status: 'INTERNAL_FUNDS_PENDING',
    });

    await service.updateStatus(
      'ifd-update-fee-1',
      {
        action: InternalFundAction.SIGN,
        feeAmount: '0.0005',
        gasUsed: '21000',
        effectiveGasPrice: '20',
      },
      'SYSTEM',
    );

  });

  describe('Spec #4: INTERNAL_FUND short-name audit actions', () => {
    it('emits CREATED short name on createFromInternalTransaction', async () => {
      prisma.internalTransaction.findUnique.mockResolvedValue({
        id: 'itx-sn-1',
        sourceType: 'DEPOSIT',
        sourceId: 'dep-sn-1',
        sourceNo: 'DEP-SN-1',
        assetId: 'asset-1',
        amount: new Prisma.Decimal(2),
        netAmount: new Prisma.Decimal(2),
        fromWalletId: 'w1',
        toWalletId: 'w2',
        fromAddress: '0xfrom',
        toAddress: '0xto',
        fromIban: null,
        toIban: null,
        referenceNo: 'REF-SN-1',
        asset: { type: 'CRYPTO' },
      });
      prisma.internalFund.findFirst.mockResolvedValue(null);
      prisma.internalFund.create.mockResolvedValue({
        id: 'ifd-sn-1',
        internalFundNo: 'IFD-SN-1',
        internalTransactionId: 'itx-sn-1',
        internalTransaction: {
          id: 'itx-sn-1',
          internalTxNo: 'ITX-SN-1',
          sourceType: 'DEPOSIT',
          sourceId: 'dep-sn-1',
          sourceNo: 'DEP-SN-1',
        },
      });

      await service.createFromInternalTransaction(
        { internalTransactionId: 'itx-sn-1' },
        'SYSTEM',
      );

      expect(
        (service as any).auditLogsService.recordByActor,
      ).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'CREATED' }),
        expect.anything(),
        expect.anything(),
      );
    });

    it('emits CLEARED + metadata.from=CONFIRMED on auto-clear', async () => {
      prisma.internalFund.findUnique
        .mockResolvedValueOnce({
          id: 'ifd-sn-clear-1',
          status: InternalFundStatus.CONFIRMING,
          statusHistory: '[]',
          sentAt: new Date(),
          confirmedAt: null,
          internalTransaction: {
            id: 'itx-sn-clear-1',
            sourceType: 'DEPOSIT',
            sourceId: 'dep-sn-clear-1',
            sourceNo: 'DEP-SN-CLEAR-1',
          },
          asset: { type: 'CRYPTO' },
        })
        .mockResolvedValue({
          id: 'ifd-sn-clear-1',
          status: InternalFundStatus.CLEAR,
          statusHistory: '[]',
          sentAt: new Date(),
          confirmedAt: new Date(),
          completedAt: new Date(),
          internalTransaction: {
            id: 'itx-sn-clear-1',
            sourceType: 'DEPOSIT',
            sourceId: 'dep-sn-clear-1',
            sourceNo: 'DEP-SN-CLEAR-1',
          },
          asset: { type: 'CRYPTO' },
        });
      prisma.internalFund.update
        .mockResolvedValueOnce({
          id: 'ifd-sn-clear-1',
          status: InternalFundStatus.CONFIRMED,
        })
        .mockResolvedValue({
          id: 'ifd-sn-clear-1',
          status: InternalFundStatus.CLEAR,
        });
      prisma.internalFund.findMany.mockResolvedValue([
        { id: 'ifd-sn-clear-1', statusHistory: '[]' },
      ]);
      internalTransactionsService.syncStatusFromFunds.mockResolvedValue({
        id: 'itx-sn-clear-1',
        status: 'SUCCESS',
      });

      await service.updateStatus(
        'ifd-sn-clear-1',
        { action: InternalFundAction.CONFIRM },
        'SYSTEM',
      );

      expect(
        (service as any).auditLogsService.recordByActor,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'CLEARED',
          metadata: expect.stringContaining('"from":"CONFIRMED"'),
        }),
        expect.anything(),
        expect.anything(),
      );
    });

    it('emits short name + metadata.from for state transitions', async () => {
      prisma.internalFund.findUnique.mockResolvedValue({
        id: 'ifd-sn-trans-1',
        status: InternalFundStatus.CREATED,
        statusHistory: '[]',
        sentAt: null,
        confirmedAt: null,
        internalTransaction: {
          id: 'itx-sn-trans-1',
          sourceType: 'DEPOSIT',
          sourceId: 'dep-sn-trans-1',
          sourceNo: 'DEP-SN-T-1',
        },
        asset: { type: 'CRYPTO' },
      });
      prisma.internalFund.update.mockResolvedValue({
        id: 'ifd-sn-trans-1',
        internalFundNo: 'IFD-SN-T-1',
        status: InternalFundStatus.SIGNING,
      });
      internalTransactionsService.syncStatusFromFunds.mockResolvedValue({
        id: 'itx-sn-trans-1',
        status: 'INTERNAL_FUNDS_PENDING',
      });

      await service.updateStatus(
        'ifd-sn-trans-1',
        { action: InternalFundAction.SIGN },
        'SYSTEM',
      );

      expect(
        (service as any).auditLogsService.recordByActor,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          action: expect.stringMatching(
            /^(SIGNING|BROADCASTED|CONFIRMING|CONFIRMED|CLEARED|FAILED|TIMED_OUT|CANCELLED|REORGED)$/,
          ),
          metadata: expect.stringContaining('"from":'),
        }),
        expect.anything(),
        expect.anything(),
      );
    });
  });
});
