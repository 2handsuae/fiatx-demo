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
} from '../dto/internal-fund.dto';
import { FundsFlowService, FIAT_TRANSITIONS } from './funds-flow.service';
import { FundsFlowAggregatorPort } from './funds-flow-aggregator.port';
import { WalletBalanceService } from '../../asset-treasury/wallets/wallet-balance.service';

describe('FundsFlowService', () => {
  let service: FundsFlowService;
  let prisma: any;
  let aggregator: any;
  let eventEmitter: any;
  let auditLogsService: any;
  let walletBalance: any;

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

    walletBalance = { adjust: jest.fn().mockResolvedValue(undefined) };

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        FundsFlowService,
        { provide: PrismaService, useValue: prisma },
        { provide: FundsFlowAggregatorPort, useValue: aggregator },
        { provide: EventEmitter2, useValue: eventEmitter },
        { provide: AuditLogsService, useValue: auditLogsService },
        { provide: WalletBalanceService, useValue: walletBalance },
      ],
    }).compile();

    service = moduleRef.get<FundsFlowService>(FundsFlowService);
    jest.clearAllMocks();
  });

  it('manual CLEAR debits fromWallet and credits toWallet by amount', async () => {
    prisma.internalFund.findUnique.mockResolvedValue({
      id: 'ifd-clr',
      status: InternalFundStatus.CONFIRMED,
      statusHistory: '[]',
      fromWalletId: 'w-from',
      toWalletId: 'w-to',
      amount: new Prisma.Decimal(250),
      sentAt: new Date(),
      confirmedAt: new Date(),
      internalTransaction: {
        id: 'itx-clr',
        sourceType: 'INTERNAL_TRANSFER',
        sourceId: 'itr-clr',
        sourceNo: 'ITRCLR',
      },
      asset: { type: 'FIAT' },
    });
    prisma.internalFund.update.mockResolvedValue({
      id: 'ifd-clr',
      status: InternalFundStatus.CLEAR,
    });
    aggregator.syncStatusFromFunds.mockResolvedValue({
      status: 'INTERNAL_FUNDS_PENDING',
    });

    await service.updateStatus(
      'ifd-clr',
      { action: InternalFundAction.CLEAR },
      'ADMIN',
    );

    const fromCall = walletBalance.adjust.mock.calls.find(
      (c: any[]) => c[0] === 'w-from',
    );
    const toCall = walletBalance.adjust.mock.calls.find(
      (c: any[]) => c[0] === 'w-to',
    );
    expect(fromCall[1].toString()).toBe('-250');
    expect(toCall[1].toString()).toBe('250');
  });

  it('auto-clear (CONFIRMED + tx SUCCESS) moves each cleared leg balance from→to', async () => {
    prisma.internalFund.findUnique.mockResolvedValue({
      id: 'ifd-auto',
      status: InternalFundStatus.CONFIRMING,
      statusHistory: '[]',
      fromWalletId: 'w-f',
      toWalletId: 'w-t',
      amount: new Prisma.Decimal(100),
      sentAt: new Date(),
      confirmedAt: null,
      internalTransaction: {
        id: 'itx-auto',
        sourceType: 'INTERNAL_TRANSFER',
        sourceId: 'itr-auto',
        sourceNo: 'ITRAUTO',
      },
      asset: { type: 'CRYPTO' },
    });
    prisma.internalFund.update.mockResolvedValue({
      id: 'ifd-auto',
      status: InternalFundStatus.CONFIRMED,
    });
    aggregator.syncStatusFromFunds.mockResolvedValue({ status: 'SUCCESS' });
    prisma.internalFund.findMany.mockResolvedValue([
      {
        id: 'ifd-auto',
        statusHistory: '[]',
        fromWalletId: 'w-f',
        toWalletId: 'w-t',
        amount: new Prisma.Decimal(100),
      },
    ]);

    await service.updateStatus(
      'ifd-auto',
      { action: InternalFundAction.CONFIRM },
      'SYSTEM',
    );

    const fromCall = walletBalance.adjust.mock.calls.find(
      (c: any[]) => c[0] === 'w-f' && c[1].toString() === '-100',
    );
    const toCall = walletBalance.adjust.mock.calls.find(
      (c: any[]) => c[0] === 'w-t' && c[1].toString() === '100',
    );
    expect(fromCall).toBeDefined();
    expect(toCall).toBeDefined();
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

  it('fiat SUBMIT without referenceNo → mock bank referenceNo 兜底写入 (BANK-<no>)', async () => {
    prisma.internalFund.findUnique.mockResolvedValue({
      id: 'ifd-fiat-sub',
      internalFundNo: 'IFD-FIAT-SUB',
      status: InternalFundStatus.CREATED,
      statusHistory: '[]',
      txHash: null,
      referenceNo: null,
      sentAt: null,
      confirmedAt: null,
      internalTransaction: {
        id: 'itx-fsub',
        sourceType: 'FIAT_SETTLEMENT',
        sourceId: 'itr-fsub',
        sourceNo: 'ITRFSUB',
      },
      asset: { type: 'FIAT' },
    });
    prisma.internalFund.update.mockResolvedValue({
      id: 'ifd-fiat-sub',
      status: InternalFundStatus.CONFIRMING,
    });
    aggregator.syncStatusFromFunds.mockResolvedValue({
      status: 'INTERNAL_FUNDS_PENDING',
    });

    await service.updateStatus(
      'ifd-fiat-sub',
      { action: InternalFundAction.SUBMIT },
      'ADMIN',
    );

    const arg = prisma.internalFund.update.mock.calls[0][0];
    expect(arg.data.referenceNo).toBe('BANK-IFD-FIAT-SUB');
    // 不碰 crypto txHash 逻辑：fiat SUBMIT 不应伪造 txHash
    expect(arg.data.txHash).toBeUndefined();
  });

  it('fiat SUBMIT with incoming referenceNo → 不覆盖，用传入值', async () => {
    prisma.internalFund.findUnique.mockResolvedValue({
      id: 'ifd-fiat-sub2',
      internalFundNo: 'IFD-FIAT-SUB2',
      status: InternalFundStatus.CREATED,
      statusHistory: '[]',
      txHash: null,
      referenceNo: null,
      sentAt: null,
      confirmedAt: null,
      internalTransaction: {
        id: 'itx-fsub2',
        sourceType: 'FIAT_SETTLEMENT',
        sourceId: 'itr-fsub2',
        sourceNo: 'ITRFSUB2',
      },
      asset: { type: 'FIAT' },
    });
    prisma.internalFund.update.mockResolvedValue({
      id: 'ifd-fiat-sub2',
      status: InternalFundStatus.CONFIRMING,
    });
    aggregator.syncStatusFromFunds.mockResolvedValue({
      status: 'INTERNAL_FUNDS_PENDING',
    });

    await service.updateStatus(
      'ifd-fiat-sub2',
      { action: InternalFundAction.SUBMIT, referenceNo: 'REF-FROM-BANK-API' },
      'ADMIN',
    );

    const arg = prisma.internalFund.update.mock.calls[0][0];
    expect(arg.data.referenceNo).toBe('REF-FROM-BANK-API');
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
        { provide: WalletBalanceService, useValue: { adjust: jest.fn().mockResolvedValue(undefined) } },
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

describe('swap legs', () => {
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
      recordByActor: jest.fn().mockResolvedValue({ id: 'audit-log-swap' }),
      recordSystem: jest.fn().mockResolvedValue({ id: 'audit-log-swap' }),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        FundsFlowService,
        { provide: PrismaService, useValue: prisma },
        { provide: FundsFlowAggregatorPort, useValue: { syncStatusFromFunds: jest.fn() } },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
        { provide: AuditLogsService, useValue: auditLogsService },
        { provide: WalletBalanceService, useValue: { adjust: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();

    service = moduleRef.get<FundsFlowService>(FundsFlowService);
    jest.clearAllMocks();
  });

  it('createSwapLeg: internalFund.create called with swapTransactionId, legSeq, internalTransactionId: null, status: CREATED', async () => {
    prisma.internalFund.create.mockImplementation(({ data }: any) =>
      Promise.resolve({ id: 'swap-leg-1', internalFundNo: data.internalFundNo, ...data }),
    );

    await service.createSwapLeg({
      swapTransactionId: 'swap-tx-1',
      legSeq: 1,
      assetId: 'asset-crypto-1',
      amount: new Prisma.Decimal(100),
      fromWalletId: 'w-from',
      toWalletId: 'w-to',
    });

    expect(prisma.internalFund.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          swapTransactionId: 'swap-tx-1',
          legSeq: 1,
          internalTransactionId: null,
          status: InternalFundStatus.CREATED,
        }),
      }),
    );
  });

  it('transitionSwapLeg: crypto leg CREATED + action SIGN → update called with status SIGNING; returns nextStatus===SIGNING', async () => {
    prisma.internalFund.findUnique.mockResolvedValue({
      id: 'swap-leg-2',
      internalFundNo: 'IFD-SWAP-2',
      status: InternalFundStatus.CREATED,
      statusHistory: '[]',
      confirmedAt: null,
      completedAt: null,
      asset: { type: 'CRYPTO' },
    });
    prisma.internalFund.update.mockResolvedValue({
      id: 'swap-leg-2',
      status: InternalFundStatus.SIGNING,
    });

    const result = await service.transitionSwapLeg('swap-leg-2', InternalFundAction.SIGN);

    expect(prisma.internalFund.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: InternalFundStatus.SIGNING }),
      }),
    );
    expect(result.nextStatus).toBe(InternalFundStatus.SIGNING);
  });

  it('transitionSwapLeg: illegal transition (CREATED + CONFIRM on crypto) → throws BadRequestException', async () => {
    prisma.internalFund.findUnique.mockResolvedValue({
      id: 'swap-leg-3',
      internalFundNo: 'IFD-SWAP-3',
      status: InternalFundStatus.CREATED,
      statusHistory: '[]',
      confirmedAt: null,
      completedAt: null,
      asset: { type: 'CRYPTO' },
    });

    await expect(
      service.transitionSwapLeg('swap-leg-3', InternalFundAction.CONFIRM),
    ).rejects.toThrow(/Invalid action/);

    expect(prisma.internalFund.update).not.toHaveBeenCalled();
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

describe('Spec #4: INTERNAL_FUND short-name audit actions', () => {
  let service: FundsFlowService;
  let prisma: any;
  let aggregator: any;
  let eventEmitter: any;
  let auditLogsService: any;
  let walletBalance: any;

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

    aggregator = { syncStatusFromFunds: jest.fn() };
    eventEmitter = { emit: jest.fn() };
    auditLogsService = {
      recordByActor: jest.fn().mockResolvedValue({ id: 'audit-log-1' }),
      recordSystem: jest.fn().mockResolvedValue({ id: 'audit-log-1' }),
    };
    walletBalance = { adjust: jest.fn().mockResolvedValue(undefined) };

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        FundsFlowService,
        { provide: PrismaService, useValue: prisma },
        { provide: FundsFlowAggregatorPort, useValue: aggregator },
        { provide: EventEmitter2, useValue: eventEmitter },
        { provide: AuditLogsService, useValue: auditLogsService },
        { provide: WalletBalanceService, useValue: walletBalance },
      ],
    }).compile();

    service = moduleRef.get<FundsFlowService>(FundsFlowService);
    jest.clearAllMocks();
  });

  it('emits CREATED short name when fund leg is created (createLeg path)', async () => {
    prisma.internalTransaction.findUnique.mockResolvedValue({
      id: 't-1',
      assetId: 'a-1',
    });
    prisma.internalFund.create.mockImplementation(({ data }: any) =>
      Promise.resolve({
        id: 'new-fund-1',
        internalFundNo: data.internalFundNo,
        ...data,
      }),
    );

    await service.createLeg(
      {
        internalTransactionId: 't-1',
        fromWalletId: 'w-from',
        toWalletId: 'w-to',
        amount: new Prisma.Decimal(5),
      },
      'SYSTEM',
    );

    expect(auditLogsService.recordByActor).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'CREATED' }),
      expect.anything(),
      expect.anything(),
    );
  });

  it('emits CREATED short name when fund is created from internal transaction', async () => {
    prisma.internalTransaction.findUnique.mockResolvedValue({
      id: 'itx-create',
      sourceType: 'INTERNAL_TRANSFER',
      sourceId: 'itr-create',
      sourceNo: 'ITRCREATE',
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
    prisma.internalFund.findFirst.mockResolvedValue(null);
    prisma.internalFund.create.mockImplementation(({ data }: any) =>
      Promise.resolve({
        id: 'new-fund-2',
        internalFundNo: data.internalFundNo,
        internalTransaction: {
          id: 'itx-create',
          internalTxNo: 'ITX-CREATE',
          sourceType: 'INTERNAL_TRANSFER',
          sourceId: 'itr-create',
          sourceNo: 'ITRCREATE',
        },
        ...data,
      }),
    );

    await service.createFromInternalTransaction(
      { internalTransactionId: 'itx-create' },
      'SYSTEM',
    );

    expect(auditLogsService.recordByActor).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'CREATED' }),
      expect.anything(),
      expect.anything(),
    );
  });

  it('emits CLEARED short name + metadata.from=CONFIRMED on auto-clear', async () => {
    prisma.internalFund.findUnique
      .mockResolvedValueOnce({
        id: 'ifd-ac',
        status: InternalFundStatus.CONFIRMING,
        statusHistory: '[]',
        sentAt: new Date(),
        confirmedAt: null,
        internalTransaction: {
          id: 'itx-ac',
          sourceType: 'INTERNAL_TRANSFER',
          sourceId: 'itr-ac',
          sourceNo: 'ITR-AC',
        },
        asset: { type: 'CRYPTO' },
      })
      .mockResolvedValue({
        id: 'ifd-ac',
        status: InternalFundStatus.CLEAR,
        statusHistory: '[]',
        sentAt: new Date(),
        confirmedAt: new Date(),
        completedAt: new Date(),
        internalTransaction: {
          id: 'itx-ac',
          sourceType: 'INTERNAL_TRANSFER',
          sourceId: 'itr-ac',
          sourceNo: 'ITR-AC',
        },
        asset: { type: 'CRYPTO' },
      });
    prisma.internalFund.update
      .mockResolvedValueOnce({
        id: 'ifd-ac',
        status: InternalFundStatus.CONFIRMED,
      })
      .mockResolvedValue({
        id: 'ifd-ac-cleared',
        status: InternalFundStatus.CLEAR,
      });
    prisma.internalFund.findMany.mockResolvedValue([
      {
        id: 'ifd-ac',
        statusHistory: '[]',
        fromWalletId: 'w-f',
        toWalletId: 'w-t',
        amount: new Prisma.Decimal(10),
      },
    ]);
    aggregator.syncStatusFromFunds.mockResolvedValue({
      id: 'itx-ac',
      status: 'SUCCESS',
    });

    await service.updateStatus(
      'ifd-ac',
      { action: InternalFundAction.CONFIRM },
      'SYSTEM',
    );

    expect(auditLogsService.recordByActor).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'CLEARED',
        metadata: expect.stringContaining('"from":"CONFIRMED"'),
      }),
      expect.anything(),
      expect.anything(),
    );
  });

  it('emits short name + metadata.from for state machine transitions (CONFIRMING → CONFIRMED)', async () => {
    prisma.internalFund.findUnique.mockResolvedValue({
      id: 'ifd-tr',
      status: InternalFundStatus.CONFIRMING,
      statusHistory: '[]',
      sentAt: new Date(),
      confirmedAt: null,
      internalTransaction: {
        id: 'itx-tr',
        sourceType: 'INTERNAL_TRANSFER',
        sourceId: 'itr-tr',
        sourceNo: 'ITR-TR',
      },
      asset: { type: 'FIAT' },
    });
    prisma.internalFund.update.mockResolvedValue({
      id: 'ifd-tr',
      status: InternalFundStatus.CONFIRMED,
    });
    aggregator.syncStatusFromFunds.mockResolvedValue({
      status: 'INTERNAL_FUNDS_PENDING',
    });

    await service.updateStatus(
      'ifd-tr',
      { action: InternalFundAction.CONFIRM },
      'ADMIN',
    );

    expect(auditLogsService.recordByActor).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'CONFIRMED',
        metadata: expect.stringContaining('"from":"CONFIRMING"'),
      }),
      expect.anything(),
      expect.anything(),
    );
  });
});
