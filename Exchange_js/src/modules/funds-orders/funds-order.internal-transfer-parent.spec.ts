import { EventEmitter2 } from '@nestjs/event-emitter';
import { FundsOrderService } from './funds-order.service';
import { FundsOrderAction, FundsOrderStatus } from './dto/funds-order.dto';

/** 平账二期 Task 2：资金单第四种父键 internalTransferId。
 *  最小假 prisma：只实现 create() / advance() 真正碰到的两个委托。 */
function makePrisma(this: any, assetType: 'FIAT' | 'CRYPTO') {
  const rows = new Map<string, any>();
  return {
    rows,
    asset: { findUnique: jest.fn(async () => ({ id: 'asset-1', type: assetType })) },
    fundsOrder: {
      create: jest.fn(async ({ data }: any) => { const row = { id: `fo-${rows.size + 1}`, ...data }; rows.set(row.id, row); return row; }),
      findUnique: jest.fn(async ({ where }: any) => { const row = rows.get(where.id); return row ? { ...row, asset: { type: assetType } } : null; }),
      update: jest.fn(async ({ where, data }: any) => { const row = { ...rows.get(where.id), ...data }; rows.set(where.id, row); return row; }),
    },
    $transaction: async (fn: any) => fn(this),
  } as any;
}

describe('FundsOrderService —— 内部划转单父键（平账二期 Task 2）', () => {
  it('create 接受 internalTransferId 作为唯一父键，并把它带进事件的 parent', async () => {
    const prisma = makePrisma('FIAT');
    const emitter = new EventEmitter2();
    const events: any[] = [];
    emitter.on('funds_order.status.changed', (e) => events.push(e));
    const svc = new FundsOrderService(prisma, emitter);
    const row = await svc.create({ internalTransferId: 'itr-1', assetId: 'asset-1', amount: '900', fromWalletId: 'w-ops', toWalletId: 'w-set' });
    expect(row.internalTransferId).toBe('itr-1');
    expect(row.status).toBe(FundsOrderStatus.CREATED);
    expect(events[0].parent).toEqual({ depositTransactionId: undefined, withdrawTransactionId: undefined, swapTransactionId: undefined, internalTransferId: 'itr-1' });
  });

  it('两个父键同时给 → 400（恰好一个）', async () => {
    const svc = new FundsOrderService(makePrisma('FIAT'), new EventEmitter2());
    await expect(svc.create({ internalTransferId: 'itr-1', depositTransactionId: 'dep-1', assetId: 'asset-1', amount: '1' } as any)).rejects.toThrow(/exactly one parent/);
  });

  it('内部划转腿走出金那套走法表：法币 CREATED --SUBMIT--> SUBMITTED --CONFIRM--> CONFIRMED', async () => {
    const prisma = makePrisma('FIAT');
    prisma.$transaction = async (fn: any) => fn(prisma);
    const svc = new FundsOrderService(prisma, new EventEmitter2());
    const row = await svc.create({ internalTransferId: 'itr-1', assetId: 'asset-1', amount: '900' });
    expect((await svc.advance(row.id, FundsOrderAction.SUBMIT, 'E2E')).status).toBe(FundsOrderStatus.SUBMITTED);
    expect((await svc.advance(row.id, FundsOrderAction.CONFIRM, 'E2E')).status).toBe(FundsOrderStatus.CONFIRMED);
  });

  it('findByParent 按 internalTransferId 过滤', async () => {
    const prisma = makePrisma('FIAT');
    prisma.fundsOrder.findMany = jest.fn(async ({ where }: any) => [{ where }]);
    const svc = new FundsOrderService(prisma, new EventEmitter2());
    const [r] = await svc.findByParent({ internalTransferId: 'itr-9' }, { legSeq: 2 });
    expect(r.where).toEqual({ internalTransferId: 'itr-9', legSeq: 2 });
  });
});
