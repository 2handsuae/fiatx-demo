import { Test } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { FundsOrderService } from './funds-order.service';
import { PrismaService } from '../../core/prisma/prisma.service';
import { FundsOrderAction, FundsOrderStatus } from './dto/funds-order.dto';

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

  it('advance rejects when already terminal', async () => {
    prisma.fundsOrder.findUnique.mockResolvedValue({
      id: 'fo1', status: 'CLEARED', depositTransactionId: 'd1', withdrawTransactionId: null, swapTransactionId: null,
      legSeq: 1, attempt: 1, statusHistory: null, asset: { type: 'FIAT' },
    });
    await expect(service.advance('fo1', FundsOrderAction.CLEAR, 'SYSTEM')).rejects.toThrow(/terminal|invalid transition/i);
  });
});
