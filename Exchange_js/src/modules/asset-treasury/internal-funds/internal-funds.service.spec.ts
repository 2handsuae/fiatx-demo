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
    );
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
    expect(prisma.auditLogEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'INTERNAL_FUND_CREATED_TO_SIGNING',
          statusFrom: InternalFundStatus.CREATED,
          statusTo: InternalFundStatus.SIGNING,
        }),
      }),
    );
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
    expect(prisma.auditLogEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          workflowType: 'DEPOSIT',
          workflowId: 'dep-1',
          workflowNo: 'DEP001',
        }),
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
    prisma.internalFund.findUnique.mockResolvedValue({
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

    expect(result.status).toBe(InternalFundStatus.CONFIRMED);
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
    expect(prisma.auditLogEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'INTERNAL_FUND_CONFIRMED_TO_CLEAR',
          statusFrom: InternalFundStatus.CONFIRMED,
          statusTo: InternalFundStatus.CLEAR,
        }),
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
});
