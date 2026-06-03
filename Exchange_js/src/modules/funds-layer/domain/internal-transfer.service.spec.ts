import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import {
  AccountingClass,
  TransferMedium,
  TransferPath,
} from '../constants/internal-transfer-paths.constant';
import { InternalTransactionStatus } from '../../asset-treasury/internal-transactions/dto/internal-transaction.dto';
import { InternalTransferService } from './internal-transfer.service';

describe('InternalTransferService', () => {
  let service: InternalTransferService;
  let prisma: any;
  let auditLogsService: any;

  beforeEach(async () => {
    prisma = {
      internalTransaction: {
        create: jest.fn((args: any) => ({ id: 'itx-new', ...args.data })),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      $transaction: jest.fn((cb: any) => cb(prisma)),
    };

    auditLogsService = {
      recordByActor: jest.fn().mockResolvedValue({ id: 'audit-log-1' }),
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        InternalTransferService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditLogsService, useValue: auditLogsService },
      ],
    }).compile();

    service = moduleRef.get<InternalTransferService>(InternalTransferService);
    jest.clearAllMocks();
  });

  it('createTransfer writes pathLabel/accountingClass/medium/traceId and type=path', async () => {
    const created = await service.createTransfer({
      path: TransferPath.AGGREGATE,
      accountingClass: AccountingClass.A,
      medium: TransferMedium.CHAIN,
      triggerSource: 'CRON',
      sourceType: 'CRON_JOB',
      sourceId: 'job-1',
      sourceNo: 'JOB001',
      ownerType: 'CUSTOMER',
      ownerId: 'cust-1',
      ownerNo: 'C0001',
      assetId: 'asset-1',
      amount: new Prisma.Decimal(10),
      feeAmount: new Prisma.Decimal(0),
      netAmount: new Prisma.Decimal(10),
      fromWalletId: 'w-from',
      toWalletId: 'w-to',
    });

    expect(created.pathLabel).toBe('AGGREGATE');
    expect(created.accountingClass).toBe('A');
    expect(created.medium).toBe('CHAIN');
    expect(typeof created.traceId).toBe('string');
    expect(created.traceId.length).toBeGreaterThan(0);
    expect(created.type).toBe('AGGREGATE');

    expect(prisma.internalTransaction.create).toHaveBeenCalledTimes(1);
    // The INTERNAL_TRANSFER_REQUESTED journey audit is written by the L3
    // workflow (InternalTransferWorkflowService), not by this domain service.
    expect(auditLogsService.recordByActor).not.toHaveBeenCalled();
  });

  it('syncStatusFromFunds rolls a pending transfer to SUCCESS when all funds are CONFIRMED/CLEAR', async () => {
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
      traceId: 'trace-1',
      funds: [
        { status: 'CONFIRMED', feeAmount: new Prisma.Decimal(1) },
        { status: 'CLEAR', feeAmount: new Prisma.Decimal(2) },
      ],
    });
    prisma.internalTransaction.update.mockImplementation((args: any) => ({
      id: 'itx-1',
      internalTxNo: 'ITX001',
      ownerId: 'cust-1',
      ownerType: 'CUSTOMER',
      ...args.data,
    }));

    const result = await service.syncStatusFromFunds('itx-1', 'SYSTEM');

    expect(prisma.internalTransaction.update).toHaveBeenCalledTimes(1);
    const updateArgs = prisma.internalTransaction.update.mock.calls[0][0];
    expect(updateArgs.where).toEqual({ id: 'itx-1' });
    expect(updateArgs.data.status).toBe(InternalTransactionStatus.SUCCESS);
    // fee recomputed as sum of fund fees (1 + 2 = 3); net = amount - fee (10 - 3 = 7)
    expect(updateArgs.data.feeAmount.equals(new Prisma.Decimal(3))).toBe(true);
    expect(updateArgs.data.netAmount.equals(new Prisma.Decimal(7))).toBe(true);
    expect(updateArgs.data.completedAt).toBeInstanceOf(Date);

    expect(result.status).toBe(InternalTransactionStatus.SUCCESS);
    expect(auditLogsService.recordByActor).toHaveBeenCalledTimes(1);
  });

  it('syncStatusFromFunds leaves an already-terminal transfer untouched', async () => {
    const existing = {
      id: 'itx-done',
      internalTxNo: 'ITX-DONE',
      status: InternalTransactionStatus.SUCCESS,
      statusHistory: '[]',
      ownerId: 'cust-1',
      ownerType: 'CUSTOMER',
      assetId: 'asset-1',
      amount: new Prisma.Decimal(10),
      netAmount: new Prisma.Decimal(10),
      feeAmount: new Prisma.Decimal(0),
      funds: [{ status: 'CONFIRMED', feeAmount: new Prisma.Decimal(0) }],
    };
    prisma.internalTransaction.findUnique.mockResolvedValue(existing);

    const result = await service.syncStatusFromFunds('itx-done', 'SYSTEM');

    expect(prisma.internalTransaction.update).not.toHaveBeenCalled();
    expect(auditLogsService.recordByActor).not.toHaveBeenCalled();
    expect(result).toBe(existing);
  });

  it('findOneByNoForAdmin throws NotFound when the row is absent', async () => {
    prisma.internalTransaction.findUnique.mockResolvedValue(null);

    await expect(service.findOneByNoForAdmin('ITX-MISSING')).rejects.toThrow(
      NotFoundException,
    );
    expect(prisma.internalTransaction.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { internalTxNo: 'ITX-MISSING' } }),
    );
  });
});
