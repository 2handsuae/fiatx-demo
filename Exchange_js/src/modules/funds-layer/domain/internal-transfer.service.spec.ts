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
import { InternalTransactionStatus } from '../dto/internal-transaction.dto';
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
      settlementBatch: {
        findUnique: jest.fn(),
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
      path: TransferPath.CRYPTO_DEPOSIT_SWEEP,
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

    expect(created.pathLabel).toBe('CRYPTO_DEPOSIT_SWEEP');
    expect(created.accountingClass).toBe('A');
    expect(created.medium).toBe('CHAIN');
    expect(typeof created.traceId).toBe('string');
    expect(created.traceId.length).toBeGreaterThan(0);
    expect(created.type).toBe('CRYPTO_DEPOSIT_SWEEP');

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

  it('createTransfer: when settlementBatchId given, inherits batch.traceId', async () => {
    prisma.settlementBatch.findUnique = jest.fn().mockResolvedValue({
      id: 'b1',
      traceId: 'BATCH-TRACE-UUID',
    });
    const captured: any[] = [];
    prisma.internalTransaction.create = jest.fn((args: any) => {
      captured.push(args.data);
      return Promise.resolve({ id: 't1', internalTxNo: 'ITX1', ...args.data });
    });

    await service.createTransfer({
      path: TransferPath.CRYPTO_SETTLE_OUT,
      accountingClass: AccountingClass.B,
      medium: TransferMedium.CHAIN,
      triggerSource: 'EOD',
      sourceType: 'EOD_SETTLEMENT',
      sourceId: 'src1',
      ownerType: 'PLATFORM',
      ownerId: 'PLATFORM',
      assetId: 'asset1',
      amount: new Prisma.Decimal(100),
      feeAmount: new Prisma.Decimal(0),
      netAmount: new Prisma.Decimal(100),
      fromWalletId: 'w-from',
      toWalletId: 'w-to',
      settlementBatchId: 'b1',
    });

    expect(captured).toHaveLength(1);
    expect(captured[0].traceId).toBe('BATCH-TRACE-UUID');
    expect(prisma.settlementBatch.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'b1' } }),
    );
  });

  it('createTransfer: when no settlementBatchId, falls back to randomUUID (existing behavior)', async () => {
    const captured: any[] = [];
    prisma.internalTransaction.create = jest.fn((args: any) => {
      captured.push(args.data);
      return Promise.resolve({ id: 't2', internalTxNo: 'ITX2', ...args.data });
    });

    await service.createTransfer({
      path: TransferPath.CRYPTO_HOTWALLET_FUND,
      accountingClass: AccountingClass.A,
      medium: TransferMedium.CHAIN,
      triggerSource: 'WITHDRAW',
      sourceType: 'WITHDRAW',
      sourceId: 'src2',
      ownerType: 'PLATFORM',
      ownerId: 'PLATFORM',
      assetId: 'asset1',
      amount: new Prisma.Decimal(50),
      feeAmount: new Prisma.Decimal(0),
      netAmount: new Prisma.Decimal(50),
      fromWalletId: 'w-from',
      toWalletId: 'w-to',
    });

    expect(captured).toHaveLength(1);
    expect(captured[0].traceId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(prisma.settlementBatch.findUnique).not.toHaveBeenCalled();
  });

  it('createTransfer: when settlementBatchId given but batch has no traceId (historical), falls back to randomUUID', async () => {
    prisma.settlementBatch.findUnique = jest.fn().mockResolvedValue({
      id: 'b-old',
      traceId: null,
    });
    const captured: any[] = [];
    prisma.internalTransaction.create = jest.fn((args: any) => {
      captured.push(args.data);
      return Promise.resolve({ id: 't3', internalTxNo: 'ITX3', ...args.data });
    });

    await service.createTransfer({
      path: TransferPath.CRYPTO_SETTLE_OUT,
      accountingClass: AccountingClass.B,
      medium: TransferMedium.CHAIN,
      triggerSource: 'EOD',
      sourceType: 'EOD_SETTLEMENT',
      sourceId: 'src3',
      ownerType: 'PLATFORM',
      ownerId: 'PLATFORM',
      assetId: 'asset1',
      amount: new Prisma.Decimal(100),
      feeAmount: new Prisma.Decimal(0),
      netAmount: new Prisma.Decimal(100),
      fromWalletId: 'w-from',
      toWalletId: 'w-to',
      settlementBatchId: 'b-old',
    });

    expect(captured).toHaveLength(1);
    expect(captured[0].traceId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  describe('findFundsOrderBySource', () => {
    it('maps internalTransaction rows + funds legs by source', async () => {
      const prisma = {
        internalTransaction: {
          findMany: jest.fn().mockResolvedValue([
            { id: 'itx-1', internalTxNo: 'ITX-1', type: 'DEPOSIT_AGG', status: 'SUCCESS',
              funds: [{ internalFundNo: 'IF-1', status: 'CONFIRMED' }] },
          ]),
        },
      } as any;
      const svc = new InternalTransferService(prisma, { recordByActor: jest.fn() } as any);

      const result = await svc.findFundsOrderBySource('DEPOSIT', 'dep-1');

      expect(prisma.internalTransaction.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { sourceType: 'DEPOSIT', sourceId: 'dep-1' } }),
      );
      expect(result).toEqual([
        { id: 'itx-1', internalTxNo: 'ITX-1', type: 'DEPOSIT_AGG', status: 'SUCCESS',
          legs: [{ internalFundNo: 'IF-1', status: 'CONFIRMED' }] },
      ]);
    });

    it('returns [] when no rows exist', async () => {
      const prisma = {
        internalTransaction: { findMany: jest.fn().mockResolvedValue([]) },
      } as any;
      const svc = new InternalTransferService(prisma, { recordByActor: jest.fn() } as any);
      expect(await svc.findFundsOrderBySource('SWAP', 'swap-x')).toEqual([]);
    });
  });
});
