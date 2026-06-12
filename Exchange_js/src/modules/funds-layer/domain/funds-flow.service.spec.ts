import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import { DomainEventNames } from '../../../common/events/domain-events.constants';
import {
  InternalFundAction,
  InternalFundStatus,
} from '../../asset-treasury/internal-funds/dto/internal-fund.dto';
import { FundsFlowService, FIAT_TRANSITIONS } from './funds-flow.service';
import { FundsFlowAggregatorPort } from './funds-flow-aggregator.port';

describe('FundsFlowService', () => {
  let service: FundsFlowService;
  let prisma: any;
  let aggregator: any;
  let eventEmitter: any;
  let auditLogsService: any;

  beforeEach(async () => {
    prisma = {
      internalFund: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        count: jest.fn(),
      },
      internalTransaction: {
        findUnique: jest.fn(),
      },
      $transaction: jest.fn((cb: any) => cb(prisma)),
    };

    aggregator = {
      syncStatusFromFunds: jest.fn(),
    };

    eventEmitter = {
      emit: jest.fn(),
    };

    auditLogsService = {
      recordByActor: jest.fn().mockResolvedValue({ id: 'audit-log-1' }),
      recordSystem: jest.fn().mockResolvedValue({ id: 'audit-log-1' }),
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        FundsFlowService,
        { provide: PrismaService, useValue: prisma },
        { provide: FundsFlowAggregatorPort, useValue: aggregator },
        { provide: EventEmitter2, useValue: eventEmitter },
        { provide: AuditLogsService, useValue: auditLogsService },
      ],
    }).compile();

    service = moduleRef.get<FundsFlowService>(FundsFlowService);
    jest.clearAllMocks();
  });

  it('advances to SIGNING on SIGN from CREATED and emits fundsflow.status.changed', async () => {
    prisma.internalFund.findUnique.mockResolvedValue({
      id: 'ifd-1',
      status: InternalFundStatus.CREATED,
      statusHistory: '[]',
      sentAt: null,
      confirmedAt: null,
      internalTransaction: {
        id: 'itx-1',
        sourceType: 'INTERNAL_TRANSFER',
        sourceId: 'itr-1',
        sourceNo: 'ITR001',
      },
      asset: { type: 'CRYPTO' },
    });
    prisma.internalFund.update.mockResolvedValue({
      id: 'ifd-1',
      status: InternalFundStatus.SIGNING,
    });
    aggregator.syncStatusFromFunds.mockResolvedValue({
      id: 'itx-1',
      status: 'INTERNAL_FUNDS_PENDING',
    });

    const result = await service.updateStatus(
      'ifd-1',
      { action: InternalFundAction.SIGN },
      'SYSTEM',
    );

    expect(result.status).toBe(InternalFundStatus.SIGNING);
    expect(aggregator.syncStatusFromFunds).toHaveBeenCalledWith(
      'itx-1',
      'SYSTEM',
      prisma,
    );
    expect(eventEmitter.emit).toHaveBeenCalledWith(
      DomainEventNames.FUNDSFLOW_STATUS_CHANGED,
      expect.objectContaining({
        fundsFlowId: 'ifd-1',
        internalTransferId: 'itx-1',
        oldStatus: InternalFundStatus.CREATED,
        newStatus: InternalFundStatus.SIGNING,
        operatorId: 'SYSTEM',
      }),
    );
  });

  it('rejects an illegal transition (CONFIRM from CREATED)', async () => {
    prisma.internalFund.findUnique.mockResolvedValue({
      id: 'ifd-2',
      status: InternalFundStatus.CREATED,
      statusHistory: '[]',
      sentAt: null,
      confirmedAt: null,
      internalTransaction: {
        id: 'itx-2',
        sourceType: 'INTERNAL_TRANSFER',
        sourceId: 'itr-2',
        sourceNo: 'ITR002',
      },
      asset: { type: 'CRYPTO' },
    });

    await expect(
      service.updateStatus(
        'ifd-2',
        { action: InternalFundAction.CONFIRM },
        'SYSTEM',
      ),
    ).rejects.toThrow(/Invalid action/);

    expect(prisma.internalFund.update).not.toHaveBeenCalled();
  });

  it('auto clears confirmed funds after transaction reaches SUCCESS', async () => {
    prisma.internalFund.findUnique
      .mockResolvedValueOnce({
        id: 'ifd-confirm-1',
        status: InternalFundStatus.CONFIRMING,
        statusHistory: '[]',
        sentAt: new Date(),
        confirmedAt: null,
        internalTransaction: {
          id: 'itx-success-1',
          sourceType: 'INTERNAL_TRANSFER',
          sourceId: 'itr-success-1',
          sourceNo: 'ITR-S-1',
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
          sourceType: 'INTERNAL_TRANSFER',
          sourceId: 'itr-success-1',
          sourceNo: 'ITR-S-1',
        },
        asset: { type: 'CRYPTO' },
      });
    prisma.internalFund.update
      .mockResolvedValueOnce({
        id: 'ifd-confirm-1',
        status: InternalFundStatus.CONFIRMED,
      })
      .mockResolvedValue({
        id: 'ifd-cleared',
        status: InternalFundStatus.CLEAR,
      });
    prisma.internalFund.findMany.mockResolvedValue([
      { id: 'ifd-confirm-1', statusHistory: '[]' },
    ]);
    aggregator.syncStatusFromFunds.mockResolvedValue({
      id: 'itx-success-1',
      status: 'SUCCESS',
    });

    const result = await service.updateStatus(
      'ifd-confirm-1',
      { action: InternalFundAction.CONFIRM },
      'SYSTEM',
    );

    expect(result.status).toBe(InternalFundStatus.CLEAR);
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
      DomainEventNames.FUNDSFLOW_STATUS_CHANGED,
      expect.objectContaining({
        fundsFlowId: 'ifd-confirm-1',
        internalTransferId: 'itx-success-1',
        oldStatus: InternalFundStatus.CONFIRMING,
        newStatus: InternalFundStatus.CONFIRMED,
      }),
    );
    expect(eventEmitter.emit).toHaveBeenNthCalledWith(
      2,
      DomainEventNames.FUNDSFLOW_STATUS_CHANGED,
      expect.objectContaining({
        fundsFlowId: 'ifd-confirm-1',
        internalTransferId: 'itx-success-1',
        oldStatus: InternalFundStatus.CONFIRMED,
        newStatus: InternalFundStatus.CLEAR,
      }),
    );
  });

  it('rejects any action from a terminal status (CLEAR)', async () => {
    prisma.internalFund.findUnique.mockResolvedValue({
      id: 'ifd-terminal',
      status: InternalFundStatus.CLEAR,
      statusHistory: '[]',
      sentAt: null,
      confirmedAt: null,
      internalTransaction: {
        id: 'itx-terminal',
        sourceType: 'INTERNAL_TRANSFER',
        sourceId: 'itr-terminal',
        sourceNo: 'ITR-T-1',
      },
      asset: { type: 'CRYPTO' },
    });

    await expect(
      service.updateStatus(
        'ifd-terminal',
        { action: InternalFundAction.CLEAR },
        'SYSTEM',
      ),
    ).rejects.toThrow(/Invalid action/);

    expect(prisma.internalFund.update).not.toHaveBeenCalled();
  });

  it('findOneByNoForAdmin returns fund by internalFundNo', async () => {
    prisma.internalFund.findUnique.mockResolvedValue({
      id: 'f1',
      internalFundNo: 'IFD123',
    });

    const r = await service.findOneByNoForAdmin('IFD123');

    expect(r).toBeDefined();
    expect(prisma.internalFund.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { internalFundNo: 'IFD123' } }),
    );
  });

  it('findOneByNoForAdmin throws NotFound when missing', async () => {
    prisma.internalFund.findUnique.mockResolvedValue(null);

    await expect(service.findOneByNoForAdmin('NOPE')).rejects.toThrow();
  });

  it('returns existing fund when createFromInternalTransaction is idempotent', async () => {
    prisma.internalTransaction.findUnique.mockResolvedValue({
      id: 'itx-3',
      sourceType: 'INTERNAL_TRANSFER',
      sourceId: 'itr-3',
      sourceNo: 'ITR003',
      assetId: 'asset-1',
      amount: new Prisma.Decimal(2),
      netAmount: new Prisma.Decimal(2),
      fromWalletId: 'w1',
      toWalletId: 'w2',
      fromAddress: '0xfrom',
      toAddress: '0xto',
      fromIban: null,
      toIban: null,
      referenceNo: 'ITR-1',
      asset: { type: 'CRYPTO' },
    });
    prisma.internalFund.findFirst.mockResolvedValue({
      id: 'ifd-existing',
      internalTransactionId: 'itx-3',
    });

    const result = await service.createFromInternalTransaction(
      { internalTransactionId: 'itx-3' },
      'SYSTEM',
    );

    expect(result.id).toBe('ifd-existing');
    expect(prisma.internalFund.create).not.toHaveBeenCalled();
  });

  // ── admin list/detail query contract (FundUX) ────────────────────────────

  it('findAllForAdmin type=CRYPTO → where.asset.type 关联筛选, list include 不带 from/toWallet', async () => {
    prisma.internalFund.findMany.mockResolvedValue([]);
    prisma.internalFund.count.mockResolvedValue(0);

    await service.findAllForAdmin({ type: 'CRYPTO' } as any);

    const arg = prisma.internalFund.findMany.mock.calls[0][0];
    expect(arg.where).toEqual(
      expect.objectContaining({ asset: { type: 'CRYPTO' } }),
    );
    expect(arg.include.fromWallet).toBeUndefined();
    expect(arg.include.toWallet).toBeUndefined();
  });

  it('findOneByNoForAdmin internalTransaction select 含 type（Linked Transfer 卡片）', async () => {
    prisma.internalFund.findUnique.mockResolvedValue({
      id: 'ifd-sel',
      internalFundNo: 'IFDSEL',
    });

    await service.findOneByNoForAdmin('IFDSEL');

    const arg = prisma.internalFund.findUnique.mock.calls[0][0];
    expect(arg.include.internalTransaction.select).toEqual(
      expect.objectContaining({ type: true }),
    );
  });

  // ── REORG (shallow reorg, crypto only) ───────────────────────────────────

  it('REORG: crypto CONFIRMING → update receives status BROADCASTED', async () => {
    prisma.internalFund.findUnique.mockResolvedValue({
      id: 'ifd-reorg',
      status: InternalFundStatus.CONFIRMING,
      statusHistory: '[]',
      sentAt: null,
      confirmedAt: null,
      internalTransaction: {
        id: 'itx-r',
        sourceType: 'INTERNAL_TRANSFER',
        sourceId: 'itr-r',
        sourceNo: 'ITRR',
      },
      asset: { type: 'CRYPTO' },
    });
    prisma.internalFund.update.mockResolvedValue({
      id: 'ifd-reorg',
      status: InternalFundStatus.BROADCASTED,
    });
    aggregator.syncStatusFromFunds.mockResolvedValue({
      status: 'INTERNAL_FUNDS_PENDING',
    });

    await service.updateStatus(
      'ifd-reorg',
      { action: InternalFundAction.REORG },
      'ADMIN',
    );

    expect(prisma.internalFund.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: InternalFundStatus.BROADCASTED,
        }),
      }),
    );
  });

  // ── mock chain receipt fallback (sim/dev, crypto only) ───────────────────

  it('crypto BROADCAST without txHash → mock txHash 兜底写入', async () => {
    prisma.internalFund.findUnique.mockResolvedValue({
      id: 'ifd-tx',
      status: InternalFundStatus.SIGNING,
      statusHistory: '[]',
      txHash: null,
      sentAt: null,
      confirmedAt: null,
      internalTransaction: {
        id: 'itx-tx',
        sourceType: 'INTERNAL_TRANSFER',
        sourceId: 'itr-tx',
        sourceNo: 'ITRTX',
      },
      asset: { type: 'CRYPTO' },
    });
    prisma.internalFund.update.mockResolvedValue({
      id: 'ifd-tx',
      status: InternalFundStatus.BROADCASTED,
    });
    aggregator.syncStatusFromFunds.mockResolvedValue({
      status: 'INTERNAL_FUNDS_PENDING',
    });

    await service.updateStatus(
      'ifd-tx',
      { action: InternalFundAction.BROADCAST },
      'ADMIN',
    );

    const arg = prisma.internalFund.update.mock.calls[0][0];
    expect(arg.data.txHash).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('crypto CONFIRM without gas → mock gasUsed/effectiveGasPrice 兜底写入', async () => {
    prisma.internalFund.findUnique.mockResolvedValue({
      id: 'ifd-gas',
      status: InternalFundStatus.CONFIRMING,
      statusHistory: '[]',
      gasUsed: null,
      effectiveGasPrice: null,
      sentAt: null,
      confirmedAt: null,
      internalTransaction: {
        id: 'itx-gas',
        sourceType: 'INTERNAL_TRANSFER',
        sourceId: 'itr-gas',
        sourceNo: 'ITRGAS',
      },
      asset: { type: 'CRYPTO' },
    });
    prisma.internalFund.update.mockResolvedValue({
      id: 'ifd-gas',
      status: InternalFundStatus.CONFIRMED,
    });
    aggregator.syncStatusFromFunds.mockResolvedValue({
      status: 'INTERNAL_FUNDS_PENDING',
    });

    await service.updateStatus(
      'ifd-gas',
      { action: InternalFundAction.CONFIRM },
      'ADMIN',
    );

    const arg = prisma.internalFund.update.mock.calls[0][0];
    expect(arg.data.gasUsed).toEqual(expect.any(String));
    expect(arg.data.effectiveGasPrice).toEqual(expect.any(String));
  });

  it('REORG: fiat CONFIRMING 仍非法（银行轨无重组）', async () => {
    prisma.internalFund.findUnique.mockResolvedValue({
      id: 'ifd-reorg-f',
      status: InternalFundStatus.CONFIRMING,
      statusHistory: '[]',
      sentAt: null,
      confirmedAt: null,
      internalTransaction: {
        id: 'itx-rf',
        sourceType: 'INTERNAL_TRANSFER',
        sourceId: 'itr-rf',
        sourceNo: 'ITRRF',
      },
      asset: { type: 'FIAT' },
    });

    await expect(
      service.updateStatus(
        'ifd-reorg-f',
        { action: InternalFundAction.REORG },
        'ADMIN',
      ),
    ).rejects.toThrow(BadRequestException);
  });
});

describe('createLeg', () => {
  let service: FundsFlowService;
  let prisma: any;
  let auditLogsService: any;

  beforeEach(async () => {
    prisma = {
      internalFund: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        count: jest.fn(),
      },
      internalTransaction: {
        findUnique: jest.fn(),
      },
      $transaction: jest.fn((cb: any) => cb(prisma)),
    };

    auditLogsService = {
      recordByActor: jest.fn().mockResolvedValue({ id: 'audit-log-1' }),
      recordSystem: jest.fn().mockResolvedValue({ id: 'audit-log-1' }),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        FundsFlowService,
        { provide: PrismaService, useValue: prisma },
        { provide: FundsFlowAggregatorPort, useValue: { syncStatusFromFunds: jest.fn() } },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
        { provide: AuditLogsService, useValue: auditLogsService },
      ],
    }).compile();

    service = moduleRef.get<FundsFlowService>(FundsFlowService);
    jest.clearAllMocks();
  });

  it('inserts a new fund with explicit wallets and CREATED status, no findFirst short-circuit', async () => {
    prisma.internalTransaction.findUnique.mockResolvedValue({
      id: 't-1',
      assetId: 'a-1',
    });
    prisma.internalFund.create.mockImplementation(({ data }: any) =>
      Promise.resolve({ id: 'new-fund-1', internalFundNo: data.internalFundNo, ...data }),
    );

    const result = await service.createLeg(
      {
        internalTransactionId: 't-1',
        fromWalletId: 'w-from',
        toWalletId: 'w-to',
        amount: new Prisma.Decimal(5),
      },
      'SYSTEM',
    );

    expect(prisma.internalFund.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          fromWalletId: 'w-from',
          toWalletId: 'w-to',
          status: InternalFundStatus.CREATED,
          amount: new Prisma.Decimal(5),
          internalTransactionId: 't-1',
        }),
      }),
    );
    expect(result).toBeDefined();
    // No findFirst short-circuit
    expect(prisma.internalFund.findFirst).not.toHaveBeenCalled();
    // Default CREATED status → completedAt must be null (not a terminal status)
    expect(prisma.internalFund.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ completedAt: null }),
      }),
    );
  });
});

describe('FIAT_TRANSITIONS', () => {
  it('CREATED --SUBMIT--> CONFIRMING', () => {
    expect(FIAT_TRANSITIONS[InternalFundStatus.CREATED][InternalFundAction.SUBMIT])
      .toBe(InternalFundStatus.CONFIRMING);
  });
  it('CONFIRMING --CONFIRM--> CONFIRMED', () => {
    expect(FIAT_TRANSITIONS[InternalFundStatus.CONFIRMING][InternalFundAction.CONFIRM])
      .toBe(InternalFundStatus.CONFIRMED);
  });
  it('CONFIRMED --CLEAR--> CLEAR and --RETURN--> RETURNED', () => {
    expect(FIAT_TRANSITIONS[InternalFundStatus.CONFIRMED][InternalFundAction.CLEAR])
      .toBe(InternalFundStatus.CLEAR);
    expect(FIAT_TRANSITIONS[InternalFundStatus.CONFIRMED][InternalFundAction.RETURN])
      .toBe(InternalFundStatus.RETURNED);
  });
  it('does NOT allow crypto SIGN/BROADCAST from CREATED', () => {
    expect(FIAT_TRANSITIONS[InternalFundStatus.CREATED][InternalFundAction.SIGN])
      .toBeUndefined();
  });
});
