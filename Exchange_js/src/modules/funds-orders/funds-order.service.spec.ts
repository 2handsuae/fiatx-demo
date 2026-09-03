import { Test } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { FundsOrderService } from './funds-order.service';
import { PrismaService } from '../../core/prisma/prisma.service';
import { FundsOrderAction, FundsOrderStatus } from './dto/funds-order.dto';
import { TERMINAL_STATUSES } from './constants/funds-order-transitions.constant';
import { fakeChainTxHash, fakeBankRef } from '../../common/utils/fake-external-refs.util';

describe('FundsOrderService', () => {
  let service: FundsOrderService;
  let prisma: any;
  let emitter: { emit: jest.Mock };

  beforeEach(async () => {
    const fundsOrderDelegate = {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    };
    prisma = {
      fundsOrder: fundsOrderDelegate,
      $transaction: jest.fn(async (cb: any) => cb(prisma)),
    };
    emitter = { emit: jest.fn() };
    const mod = await Test.createTestingModule({
      providers: [
        FundsOrderService,
        { provide: PrismaService, useValue: prisma },
        { provide: EventEmitter2, useValue: emitter },
      ],
    }).compile();
    service = mod.get(FundsOrderService);
  });

  it('create rejects when zero parent FK provided', async () => {
    await expect(
      service.create({ assetId: 'a1', amount: '1' } as any),
    ).rejects.toThrow(/exactly one parent/i);
  });

  it('create rejects when two parent FKs provided', async () => {
    await expect(
      service.create({ depositTransactionId: 'd1', swapTransactionId: 's1', assetId: 'a1', amount: '1' } as any),
    ).rejects.toThrow(/exactly one parent/i);
  });

  it('create inserts row + emits with oldStatus=null', async () => {
    prisma.fundsOrder.create.mockResolvedValue({
      id: 'fo1', fundsOrderNo: 'FO1', depositTransactionId: 'd1',
      swapTransactionId: null, withdrawTransactionId: null,
      legSeq: 1, attempt: 1, status: 'SUBMITTED',
    });
    const fo = await service.create({ depositTransactionId: 'd1', assetId: 'a1', amount: '1', initialStatus: FundsOrderStatus.SUBMITTED });
    expect(fo.status).toBe('SUBMITTED');
    expect(emitter.emit).toHaveBeenCalledWith(
      'funds_order.status.changed',
      expect.objectContaining({ oldStatus: null, newStatus: 'SUBMITTED', parent: expect.objectContaining({ depositTransactionId: 'd1' }) }),
    );
  });

  it('create emits effectiveDate from input when given (fiat CONFIRMED-at-birth path)', async () => {
    prisma.fundsOrder.create.mockResolvedValue({
      id: 'fo1', fundsOrderNo: 'FO1', depositTransactionId: 'dep1',
      swapTransactionId: null, withdrawTransactionId: null,
      legSeq: 1, attempt: 1, status: 'SUBMITTED',
    });
    await service.create({ depositTransactionId: 'dep1', assetId: 'asset-aed', amount: '10', initialStatus: FundsOrderStatus.CONFIRMED, effectiveDate: '2026-09-01' } as any);
    const payload = emitter.emit.mock.calls.find(([name]) => name === 'funds_order.status.changed')![1];
    expect(payload.effectiveDate).toBe('2026-09-01');
  });

  it('advance rejects illegal transition', async () => {
    prisma.fundsOrder.findUnique.mockResolvedValue({
      id: 'fo1', status: 'CREATED', depositTransactionId: null, withdrawTransactionId: 'w1', swapTransactionId: null,
      legSeq: 1, attempt: 1, statusHistory: null, asset: { type: 'CRYPTO' },
    });
    // CREATED + CONFIRM 非法(crypto OUT)
    await expect(service.advance('fo1', FundsOrderAction.CONFIRM, 'SYSTEM')).rejects.toThrow(/invalid transition/i);
  });

  it('advance CREATED --SUBMIT--> SUBMITTED + emits', async () => {
    prisma.fundsOrder.findUnique.mockResolvedValue({
      id: 'fo1', status: 'CREATED', depositTransactionId: null, withdrawTransactionId: 'w1', swapTransactionId: null,
      legSeq: 1, attempt: 1, statusHistory: null, asset: { type: 'CRYPTO' },
    });
    prisma.fundsOrder.update.mockResolvedValue({
      id: 'fo1', status: 'SUBMITTED', depositTransactionId: null, withdrawTransactionId: 'w1', swapTransactionId: null,
      legSeq: 1, attempt: 1,
    });
    const fo = await service.advance('fo1', FundsOrderAction.SUBMIT, 'SYSTEM');
    expect(fo.status).toBe('SUBMITTED');
    expect(emitter.emit).toHaveBeenCalledWith(
      'funds_order.status.changed',
      expect.objectContaining({ oldStatus: 'CREATED', newStatus: 'SUBMITTED' }),
    );
  });

  it('advance: deposit-parented legSeq>1 (confiscation) leg is INTERNAL — CREATED --SUBMIT--> SUBMITTED', async () => {
    // below-min confiscation moves customer wallet → firm F_FEE as a legSeq=2 internal
    // leg born CREATED; it must advance via the INTERNAL/OUT map (IN has no CREATED entry).
    prisma.fundsOrder.findUnique.mockResolvedValue({
      id: 'fo2', status: 'CREATED', depositTransactionId: 'd1', withdrawTransactionId: null, swapTransactionId: null,
      legSeq: 2, attempt: 1, statusHistory: null, asset: { type: 'FIAT' },
    });
    prisma.fundsOrder.update.mockResolvedValue({
      id: 'fo2', status: 'SUBMITTED', depositTransactionId: 'd1', withdrawTransactionId: null, swapTransactionId: null,
      legSeq: 2, attempt: 1,
    });
    const fo = await service.advance('fo2', FundsOrderAction.SUBMIT, 'SYSTEM');
    expect(fo.status).toBe('SUBMITTED');
  });

  it('advance: deposit payin (legSeq=1) stays IN — CREATED --SUBMIT--> is invalid (payin born SUBMITTED/CONFIRMED)', async () => {
    prisma.fundsOrder.findUnique.mockResolvedValue({
      id: 'fo1', status: 'CREATED', depositTransactionId: 'd1', withdrawTransactionId: null, swapTransactionId: null,
      legSeq: 1, attempt: 1, statusHistory: null, asset: { type: 'FIAT' },
    });
    await expect(service.advance('fo1', FundsOrderAction.SUBMIT, 'SYSTEM')).rejects.toThrow(/invalid transition/i);
  });

  it('advance forwards opts.effectiveDate into the status.changed event payload', async () => {
    prisma.fundsOrder.findUnique.mockResolvedValue({
      id: 'fo1', status: 'CONFIRMING', depositTransactionId: 'd1', withdrawTransactionId: null, swapTransactionId: null,
      legSeq: 1, attempt: 1, statusHistory: null, asset: { type: 'CRYPTO' },
    });
    prisma.fundsOrder.update.mockResolvedValue({
      id: 'fo1', status: 'CONFIRMED', depositTransactionId: 'd1', withdrawTransactionId: null, swapTransactionId: null,
      legSeq: 1, attempt: 1,
    });
    await service.advance('fo1', FundsOrderAction.CONFIRM, 'op-1', undefined, { effectiveDate: '2026-06-30' });
    const payload = emitter.emit.mock.calls.find(([name]) => name === 'funds_order.status.changed')![1];
    expect(payload.effectiveDate).toBe('2026-06-30');
  });

  it('advance without opts emits payload with undefined effectiveDate (unchanged)', async () => {
    prisma.fundsOrder.findUnique.mockResolvedValue({
      id: 'fo1', status: 'CONFIRMING', depositTransactionId: 'd1', withdrawTransactionId: null, swapTransactionId: null,
      legSeq: 1, attempt: 1, statusHistory: null, asset: { type: 'CRYPTO' },
    });
    prisma.fundsOrder.update.mockResolvedValue({
      id: 'fo1', status: 'CONFIRMED', depositTransactionId: 'd1', withdrawTransactionId: null, swapTransactionId: null,
      legSeq: 1, attempt: 1,
    });
    await service.advance('fo1', FundsOrderAction.CONFIRM, 'op-1');
    const payload = emitter.emit.mock.calls.find(([name]) => name === 'funds_order.status.changed')![1];
    expect(payload.effectiveDate).toBeUndefined();
  });

  it('advance rejects when already terminal', async () => {
    prisma.fundsOrder.findUnique.mockResolvedValue({
      id: 'fo1', status: 'CLEARED', depositTransactionId: 'd1', withdrawTransactionId: null, swapTransactionId: null,
      legSeq: 1, attempt: 1, statusHistory: null, asset: { type: 'FIAT' },
    });
    await expect(service.advance('fo1', FundsOrderAction.CLEAR, 'SYSTEM')).rejects.toThrow(/terminal|invalid transition/i);
  });

  describe('advanceByNo', () => {
    it('rejects swap-leg funds orders (must use swap endpoint)', async () => {
      prisma.fundsOrder.findUnique.mockResolvedValue({
        id: 'fo-swap', fundsOrderNo: 'FO-SWAP', status: 'CREATED',
        depositTransactionId: null, withdrawTransactionId: null, swapTransactionId: 's1',
        legSeq: 1, attempt: 1, statusHistory: null, asset: { type: 'CRYPTO' },
      });
      await expect(service.advanceByNo('FO-SWAP', FundsOrderAction.SUBMIT, 'ADMIN'))
        .rejects.toThrow(/swap-transactions/i);
    });

    it('advances a withdraw funds order via advance()', async () => {
      prisma.fundsOrder.findUnique
        .mockResolvedValueOnce({
          id: 'fo-wd', fundsOrderNo: 'FO-WD', status: 'CREATED',
          depositTransactionId: null, withdrawTransactionId: 'w1', swapTransactionId: null,
          legSeq: 1, attempt: 1, statusHistory: null, asset: { type: 'CRYPTO' },
        })  // advanceByNo's lookup
        .mockResolvedValueOnce({
          id: 'fo-wd', status: 'CREATED',
          depositTransactionId: null, withdrawTransactionId: 'w1', swapTransactionId: null,
          legSeq: 1, attempt: 1, statusHistory: null, asset: { type: 'CRYPTO' },
        }); // advance()'s internal FOR UPDATE lookup
      prisma.fundsOrder.update.mockResolvedValue({
        id: 'fo-wd', fundsOrderNo: 'FO-WD', status: 'SUBMITTED',
        depositTransactionId: null, withdrawTransactionId: 'w1', swapTransactionId: null,
        legSeq: 1, attempt: 1,
      });
      const result = await service.advanceByNo('FO-WD', FundsOrderAction.SUBMIT, 'ADMIN');
      expect(result.status).toBe('SUBMITTED');
    });

    it('throws NotFound for unknown fundsOrderNo', async () => {
      prisma.fundsOrder.findUnique.mockResolvedValue(null);
      await expect(service.advanceByNo('NOPE', FundsOrderAction.SUBMIT, 'ADMIN'))
        .rejects.toThrow(/not found/i);
    });
  });

  describe('findNonTerminalByWallet', () => {
    it('returns only non-terminal orders touching the wallet, with direction', async () => {
      const rows = [
        { id: '1', fundsOrderNo: 'FO-1', status: 'CONFIRMING', fromWalletId: 'W1', toWalletId: 'W2', amount: new Prisma.Decimal(100), netAmount: new Prisma.Decimal(100), txHash: '0xa', referenceNo: null, providerTxnId: null, createdAt: new Date() },
      ];
      prisma.fundsOrder.findMany = jest.fn().mockResolvedValue(rows);
      const out = await service.findNonTerminalByWallet('W1');
      expect(prisma.fundsOrder.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({
          status: { notIn: Array.from(TERMINAL_STATUSES) },
          OR: [{ fromWalletId: 'W1' }, { toWalletId: 'W1' }],
        }),
      }));
      expect(out[0].direction).toBe('OUT'); // fromWalletId === W1
    });

    it('marks direction IN when toWalletId matches the queried wallet', async () => {
      const rows = [
        { id: '2', fundsOrderNo: 'FO-2', status: 'SUBMITTED', fromWalletId: 'W2', toWalletId: 'W1', amount: new Prisma.Decimal(50), netAmount: new Prisma.Decimal(50), txHash: null, referenceNo: 'REF-2', providerTxnId: null, createdAt: new Date() },
      ];
      prisma.fundsOrder.findMany = jest.fn().mockResolvedValue(rows);
      const out = await service.findNonTerminalByWallet('W1');
      expect(out[0].direction).toBe('IN');
    });
  });

  describe('resolveExternalRef', () => {
    it('crypto → returns txHash', () => {
      const ref = service.resolveExternalRef({
        asset: { type: 'CRYPTO' }, txHash: '0xabc', referenceNo: 'ZB1',
      } as any);
      expect(ref).toBe('0xabc');
    });

    it('fiat → returns referenceNo', () => {
      const ref = service.resolveExternalRef({
        asset: { type: 'FIAT' }, txHash: '0xabc', referenceNo: 'ZB1',
      } as any);
      expect(ref).toBe('ZB1');
    });

    it('missing asset → defaults CRYPTO → txHash', () => {
      const ref = service.resolveExternalRef({ txHash: '0xabc' } as any);
      expect(ref).toBe('0xabc');
    });

    it('null column → null', () => {
      const ref = service.resolveExternalRef({ asset: { type: 'FIAT' }, referenceNo: null } as any);
      expect(ref).toBeNull();
    });
  });

  describe('stamp externalRef on reaching CONFIRMED', () => {
    it('crypto OUT: CONFIRMING --CONFIRM--> CONFIRMED mints txHash', async () => {
      const row = {
        id: 'fo1', fundsOrderNo: 'FO-CRYPTO', status: 'CONFIRMING',
        depositTransactionId: null, withdrawTransactionId: 'w1', swapTransactionId: null,
        legSeq: 1, attempt: 1, statusHistory: null, txHash: null, referenceNo: null,
        createdAt: new Date('2026-07-11T00:00:00Z'), asset: { type: 'CRYPTO' },
      };
      prisma.fundsOrder.findUnique.mockResolvedValue(row);
      prisma.fundsOrder.update.mockImplementation(async ({ data }: any) => ({ ...row, ...data }));
      await service.advance('fo1', FundsOrderAction.CONFIRM, 'SYSTEM');
      const updateArg = prisma.fundsOrder.update.mock.calls[0][0];
      expect(updateArg.data.status).toBe('CONFIRMED');
      expect(updateArg.data.txHash).toBe(fakeChainTxHash('FO-CRYPTO'));
      expect(updateArg.data.referenceNo).toBeUndefined();
    });

    it('fiat OUT: SUBMITTED --CONFIRM--> CONFIRMED mints referenceNo', async () => {
      const row = {
        id: 'fo2', fundsOrderNo: 'FO-FIAT', status: 'SUBMITTED',
        depositTransactionId: null, withdrawTransactionId: 'w2', swapTransactionId: null,
        legSeq: 1, attempt: 1, statusHistory: null, txHash: null, referenceNo: null,
        createdAt: new Date('2026-07-11T00:00:00Z'), asset: { type: 'FIAT' },
      };
      prisma.fundsOrder.findUnique.mockResolvedValue(row);
      prisma.fundsOrder.update.mockImplementation(async ({ data }: any) => ({ ...row, ...data }));
      await service.advance('fo2', FundsOrderAction.CONFIRM, 'SYSTEM');
      const updateArg = prisma.fundsOrder.update.mock.calls[0][0];
      expect(updateArg.data.status).toBe('CONFIRMED');
      expect(updateArg.data.referenceNo).toBe(fakeBankRef('FO-FIAT', row.createdAt));
    });

    it('idempotent: existing txHash (crypto deposit inbound) is NOT overwritten', async () => {
      const row = {
        id: 'fo3', fundsOrderNo: 'FO-DEP', status: 'CONFIRMING',
        depositTransactionId: 'd1', withdrawTransactionId: null, swapTransactionId: null,
        legSeq: 1, attempt: 1, statusHistory: null, txHash: '0xINBOUND', referenceNo: null,
        createdAt: new Date('2026-07-11T00:00:00Z'), asset: { type: 'CRYPTO' },
      };
      prisma.fundsOrder.findUnique.mockResolvedValue(row);
      prisma.fundsOrder.update.mockImplementation(async ({ data }: any) => ({ ...row, ...data }));
      await service.advance('fo3', FundsOrderAction.CONFIRM, 'SYSTEM');
      const updateArg = prisma.fundsOrder.update.mock.calls[0][0];
      expect(updateArg.data.txHash).toBeUndefined(); // 保留旧值,不写
    });

    it('non-CONFIRMED transition does not mint', async () => {
      const row = {
        id: 'fo4', fundsOrderNo: 'FO-SUB', status: 'SUBMITTED',
        depositTransactionId: null, withdrawTransactionId: 'w4', swapTransactionId: null,
        legSeq: 1, attempt: 1, statusHistory: null, txHash: null, referenceNo: null,
        createdAt: new Date('2026-07-11T00:00:00Z'), asset: { type: 'CRYPTO' },
      };
      prisma.fundsOrder.findUnique.mockResolvedValue(row);
      prisma.fundsOrder.update.mockImplementation(async ({ data }: any) => ({ ...row, ...data }));
      await service.advance('fo4', FundsOrderAction.OBSERVE_CONFIRMING, 'SYSTEM'); // → CONFIRMING
      const updateArg = prisma.fundsOrder.update.mock.calls[0][0];
      expect(updateArg.data.txHash).toBeUndefined();
      expect(updateArg.data.referenceNo).toBeUndefined();
    });
  });
});
