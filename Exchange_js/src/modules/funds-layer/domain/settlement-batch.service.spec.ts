import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import { SettlementBatchService } from './settlement-batch.service';

describe('SettlementBatchService', () => {
  let service: SettlementBatchService;
  let prisma: any;
  let auditLogsService: any;

  beforeEach(async () => {
    prisma = {
      settlementBatch: {
        create: jest.fn((args: any) => ({ id: 'osb-new', ...args.data })),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        update: jest.fn((args: any) => ({ id: args.where.id, ...args.data })),
      },
      internalTransaction: {
        findMany: jest.fn(),
      },
      outstanding: {
        findMany: jest.fn(),
      },
      feeAccrual: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      $transaction: jest.fn((cb: any) => cb(prisma)),
    };
    auditLogsService = { recordSystem: jest.fn() };

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        SettlementBatchService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditLogsService, useValue: auditLogsService },
      ],
    }).compile();

    service = moduleRef.get<SettlementBatchService>(SettlementBatchService);
    jest.clearAllMocks();
  });

  it('createBatch sets batchNo (OSB prefix), defaults settlementType=CRYPTO_PRINCIPAL, status=CREATED', async () => {
    const cutoffAt = new Date('2026-06-03T00:00:00.000Z');
    const created = await service.createBatch({ cutoffAt, requestId: 'req-1' });

    expect(created.batchNo).toMatch(/^OSB/);
    expect(created.settlementType).toBe('CRYPTO_PRINCIPAL');
    expect(created.status).toBe('CREATED');
    expect(created.cutoffAt).toBe(cutoffAt);
    expect(created.requestId).toBe('req-1');
    expect(prisma.settlementBatch.create).toHaveBeenCalledTimes(1);
  });

  it('createBatch honors an explicit settlementType (CRYPTO_SWAP)', async () => {
    const cutoffAt = new Date('2026-06-03T00:00:00.000Z');
    const created = await service.createBatch({
      cutoffAt,
      settlementType: 'CRYPTO_SWAP',
    });

    expect(created.settlementType).toBe('CRYPTO_SWAP');
  });

  it('createBatch persists an explicit category (SWAP_FEE)', async () => {
    const created = await service.createBatch({
      cutoffAt: new Date(),
      category: 'SWAP_FEE',
    });

    expect(created.category).toBe('SWAP_FEE');
  });

  it('createBatch defaults category to PRINCIPAL when omitted', async () => {
    const created = await service.createBatch({ cutoffAt: new Date() });

    expect(created.category).toBe('PRINCIPAL');
  });

  it('generates UUID traceId, persists it, and emits BATCH_CREATED audit', async () => {
    const capturedCreate: any[] = [];
    const capturedAudit: any[] = [];

    (prisma as any).settlementBatch.create = jest.fn((args: any) => {
      capturedCreate.push(args.data);
      return Promise.resolve({ ...args.data, id: 'b1', batchNo: 'OSB1' });
    });
    (auditLogsService as any).recordSystem = jest.fn((args: any) => {
      capturedAudit.push(args);
      return Promise.resolve();
    });

    await service.createBatch({
      cutoffAt: new Date(),
      category: 'SWAP_FEE',
      settlementType: 'FIAT_SWAP',
    });

    expect(capturedCreate).toHaveLength(1);
    expect(capturedCreate[0].traceId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );

    expect(capturedAudit).toHaveLength(1);
    expect(capturedAudit[0]).toMatchObject({
      action: 'BATCH_CREATED',
      entityType: 'SETTLEMENT_BATCH',
      entityId: 'b1',
      entityNo: 'OSB1',
      workflowType: 'SETTLEMENT',
      traceId: capturedCreate[0].traceId,
    });
  });

  describe('resolveCryptoDirection', () => {
    it('net > 0 → INTERNAL_IN / F_OPS → C_MAIN / amount = net', () => {
      const net = new Prisma.Decimal(60);
      const result = service.resolveCryptoDirection(net);
      expect(result).toEqual({
        path: 'CRYPTO_SETTLE_IN',
        fromRole: 'F_OPS',
        toRole: 'C_MAIN',
        amount: net,
      });
    });

    it('net < 0 → INTERNAL_OUT / C_MAIN → F_OPS / amount = |net|', () => {
      const net = new Prisma.Decimal(-40);
      const result = service.resolveCryptoDirection(net);
      expect(result!.path).toBe('CRYPTO_SETTLE_OUT');
      expect(result!.fromRole).toBe('C_MAIN');
      expect(result!.toRole).toBe('F_OPS');
      expect(result!.amount.toString()).toBe('40');
    });

    it('net = 0 → null', () => {
      expect(service.resolveCryptoDirection(new Prisma.Decimal(0))).toBeNull();
    });
  });

  it('recomputeBatch SUCCESS when all transfers SUCCESS and all outstandings SETTLED', async () => {
    prisma.internalTransaction.findMany.mockResolvedValue([
      { status: 'SUCCESS', assetId: 'a1' },
    ]);
    prisma.outstanding.findMany.mockResolvedValue([
      { status: 'SETTLED', assetId: 'a1', settledByTransferId: 't1' },
    ]);

    await service.recomputeBatch('batch1');

    const data = prisma.settlementBatch.update.mock.calls[0][0].data;
    expect(data.totalAssetCount).toBe(1);
    expect(data.settledAssetCount).toBe(1);
    expect(data.totalOutstandingCount).toBe(1);
    expect(data.settledOutstandingCount).toBe(1);
    expect(data.status).toBe('SUCCESS');
    expect(data.completedAt).toBeInstanceOf(Date);
  });

  it('recomputeBatch PROCESSING when a transfer not yet SUCCESS', async () => {
    prisma.internalTransaction.findMany.mockResolvedValue([
      { status: 'INTERNAL_FUNDS_PENDING', assetId: 'a1' },
    ]);
    prisma.outstanding.findMany.mockResolvedValue([
      { status: 'LOCKED', assetId: 'a1', settledByTransferId: 't1' },
    ]);

    await service.recomputeBatch('batch1');

    const data = prisma.settlementBatch.update.mock.calls[0][0].data;
    expect(data.totalAssetCount).toBe(1);
    expect(data.settledAssetCount).toBe(0);
    expect(data.totalOutstandingCount).toBe(1);
    expect(data.settledOutstandingCount).toBe(0);
    expect(data.status).toBe('PROCESSING');
    expect(data.completedAt).toBeNull();
  });

  it('recomputeBatch SUCCESS for net=0 only batch (no transfers, one SETTLED outstanding with no transfer)', async () => {
    prisma.internalTransaction.findMany.mockResolvedValue([]);
    prisma.outstanding.findMany.mockResolvedValue([
      { status: 'SETTLED', assetId: 'a1', settledByTransferId: null },
    ]);

    await service.recomputeBatch('batch1');

    const data = prisma.settlementBatch.update.mock.calls[0][0].data;
    expect(data.totalAssetCount).toBe(1);
    expect(data.settledAssetCount).toBe(1);
    expect(data.totalOutstandingCount).toBe(1);
    expect(data.settledOutstandingCount).toBe(1);
    expect(data.status).toBe('SUCCESS');
    expect(data.completedAt).toBeInstanceOf(Date);
  });

  it('recomputeBatch FEE batch: counts LOCKED accruals + status PROCESSING until all SETTLED', async () => {
    // FEE batch shape: a fee-settle transfer + 0 outstandings + N fee accruals.
    prisma.internalTransaction.findMany.mockResolvedValue([
      { status: 'INTERNAL_FUNDS_PENDING', assetId: 'a1' },
    ]);
    prisma.outstanding.findMany.mockResolvedValue([]);
    prisma.feeAccrual.findMany.mockResolvedValue([
      { status: 'LOCKED' },
      { status: 'LOCKED' },
    ]);

    await service.recomputeBatch('batch-fee-1');

    const data = prisma.settlementBatch.update.mock.calls[0][0].data;
    expect(data.totalFeeAccrualCount).toBe(2);
    expect(data.settledFeeAccrualCount).toBe(0);
    expect(data.status).toBe('PROCESSING');
    expect(data.completedAt).toBeNull();
  });

  it('recomputeBatch FEE batch: status SUCCESS only when transfer SUCCESS AND all fee accruals SETTLED', async () => {
    prisma.internalTransaction.findMany.mockResolvedValue([
      { status: 'SUCCESS', assetId: 'a1' },
    ]);
    prisma.outstanding.findMany.mockResolvedValue([]);
    prisma.feeAccrual.findMany.mockResolvedValue([
      { status: 'SETTLED' },
      { status: 'SETTLED' },
    ]);

    await service.recomputeBatch('batch-fee-2');

    const data = prisma.settlementBatch.update.mock.calls[0][0].data;
    expect(data.totalFeeAccrualCount).toBe(2);
    expect(data.settledFeeAccrualCount).toBe(2);
    expect(data.status).toBe('SUCCESS');
    expect(data.completedAt).toBeInstanceOf(Date);
  });

  it('recomputeBatch: emits BATCH_SUCCEEDED on first transition CREATED→SUCCESS', async () => {
    // Mock current batch status (before update) = CREATED, with a traceId.
    prisma.settlementBatch.findUnique.mockResolvedValue({
      id: 'b1', batchNo: 'OSB1', status: 'CREATED', traceId: 'TRACE-1',
    });
    prisma.internalTransaction.findMany.mockResolvedValue([
      { status: 'SUCCESS', assetId: 'a1' },
    ]);
    prisma.outstanding.findMany.mockResolvedValue([]);
    prisma.feeAccrual.findMany.mockResolvedValue([{ status: 'SETTLED' }]);
    const captured: any[] = [];
    auditLogsService.recordSystem.mockImplementation((args: any) => {
      captured.push(args);
      return Promise.resolve();
    });

    await service.recomputeBatch('b1');

    expect(captured).toHaveLength(1);
    expect(captured[0]).toMatchObject({
      action: 'BATCH_SUCCEEDED',
      entityType: 'SETTLEMENT_BATCH',
      entityId: 'b1',
      entityNo: 'OSB1',
      workflowType: 'SETTLEMENT',
      traceId: 'TRACE-1',
    });
  });

  it('recomputeBatch: does NOT re-emit BATCH_SUCCEEDED when previously already SUCCESS', async () => {
    // Mock current batch status (before update) = SUCCESS already.
    prisma.settlementBatch.findUnique.mockResolvedValue({
      id: 'b2', batchNo: 'OSB2', status: 'SUCCESS', traceId: 'TRACE-2',
    });
    prisma.internalTransaction.findMany.mockResolvedValue([
      { status: 'SUCCESS', assetId: 'a1' },
    ]);
    prisma.outstanding.findMany.mockResolvedValue([]);
    prisma.feeAccrual.findMany.mockResolvedValue([{ status: 'SETTLED' }]);
    auditLogsService.recordSystem.mockImplementation(() => Promise.resolve());

    await service.recomputeBatch('b2');

    expect(auditLogsService.recordSystem).not.toHaveBeenCalled();
  });

  it('recomputeBatch: does NOT emit BATCH_SUCCEEDED when result is PROCESSING (not all settled)', async () => {
    prisma.settlementBatch.findUnique.mockResolvedValue({
      id: 'b3', batchNo: 'OSB3', status: 'CREATED', traceId: 'TRACE-3',
    });
    prisma.internalTransaction.findMany.mockResolvedValue([
      { status: 'INTERNAL_FUNDS_PENDING', assetId: 'a1' },
    ]);
    prisma.outstanding.findMany.mockResolvedValue([]);
    prisma.feeAccrual.findMany.mockResolvedValue([{ status: 'LOCKED' }]);
    auditLogsService.recordSystem.mockImplementation(() => Promise.resolve());

    await service.recomputeBatch('b3');

    expect(auditLogsService.recordSystem).not.toHaveBeenCalled();
  });

  it('findOneByNoForAdmin looks up by batchNo (business key) including transfers', async () => {
    prisma.settlementBatch.findUnique.mockResolvedValue({
      id: 'osb-1',
      batchNo: 'OSB2606030001',
      transfers: [],
    });

    const found = await service.findOneByNoForAdmin('OSB2606030001');

    expect(prisma.settlementBatch.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { batchNo: 'OSB2606030001' } }),
    );
    expect(found.batchNo).toBe('OSB2606030001');
  });
});
