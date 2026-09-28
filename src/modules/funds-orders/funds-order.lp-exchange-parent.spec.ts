import { EventEmitter2 } from '@nestjs/event-emitter';
import { FundsOrderService } from './funds-order.service';
import { FundsOrderAction, FundsOrderStatus } from './dto/funds-order.dto';

/** 战役乙波一 T4：资金单第五种父键 lpExchangeId（照平账二期 Task 2 的
 *  funds-order.internal-transfer-parent.spec.ts 先例）。
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
      count: jest.fn(async () => 0),
    },
    $transaction: async (fn: any) => fn(this),
  } as any;
}

describe('FundsOrderService —— LP 兑换单第五父键（战役乙波一 T4）', () => {
  it('create 接受 lpExchangeId 作为唯一父键，并把它带进事件的 parent', async () => {
    const prisma = makePrisma('FIAT');
    const emitter = new EventEmitter2();
    const events: any[] = [];
    emitter.on('funds_order.status.changed', (e) => events.push(e));
    const svc = new FundsOrderService(prisma, emitter);
    const row = await svc.create({ lpExchangeId: 'lpx-1', legSeq: 1, assetId: 'asset-1', amount: '50000', fromWalletId: 'w-ops' });
    expect(row.lpExchangeId).toBe('lpx-1');
    expect(row.status).toBe(FundsOrderStatus.CREATED);
    expect(events[0].parent).toEqual({ depositTransactionId: undefined, withdrawTransactionId: undefined, swapTransactionId: undefined, internalTransferId: undefined, lpExchangeId: 'lpx-1' });
  });

  it('两个父键同时给 → 400（恰好一个）', async () => {
    const svc = new FundsOrderService(makePrisma('FIAT'), new EventEmitter2());
    await expect(svc.create({ lpExchangeId: 'lpx-1', internalTransferId: 'itr-1', assetId: 'asset-1', amount: '1' } as any)).rejects.toThrow(/exactly one parent/);
  });

  // 评审 Imp#2 修：原 SUBMIT→CONFIRM/CLEAR 路径三条方向都能走通，删掉 lpExchangeId
  // 分支也不红——换成利用 advance() 报错文案里的 direction=... 字样，拦住方向判错。
  describe('directionOf — 腿 1 卖出 OUT / 腿 2 买入 IN / 腿 3 验收转 INTERNAL', () => {
    it('腿 1（卖出，legSeq=1）：direction=OUT——CREATED 下 CLEAR 非法（OUT 表没有 CREATED→CLEAR 边）', async () => {
      const prisma = makePrisma('FIAT');
      prisma.$transaction = async (fn: any) => fn(prisma);
      const svc = new FundsOrderService(prisma, new EventEmitter2());
      const row = await svc.create({ lpExchangeId: 'lpx-1', legSeq: 1, assetId: 'asset-1', amount: '50000' });
      await expect(svc.advance(row.id, FundsOrderAction.CLEAR, 'E2E')).rejects.toThrow(/direction=OUT/);
    });

    it('腿 2（买入，legSeq=2）：direction=IN——出生 CREATED 时 SUBMIT 非法（IN 表没有 CREATED 入口，入口是 CONFIRMED）', async () => {
      const prisma = makePrisma('FIAT');
      prisma.$transaction = async (fn: any) => fn(prisma);
      const svc = new FundsOrderService(prisma, new EventEmitter2());
      const row = await svc.create({ lpExchangeId: 'lpx-1', legSeq: 2, assetId: 'asset-1', amount: '13600' });
      await expect(svc.advance(row.id, FundsOrderAction.SUBMIT, 'E2E')).rejects.toThrow(/direction=IN/);
    });

    it('腿 3（验收转，legSeq=3）：direction=INTERNAL——CREATED 下 CLEAR 非法（同 OUT 表，没有 CREATED→CLEAR 边）', async () => {
      const prisma = makePrisma('FIAT');
      prisma.$transaction = async (fn: any) => fn(prisma);
      const svc = new FundsOrderService(prisma, new EventEmitter2());
      const row = await svc.create({ lpExchangeId: 'lpx-1', legSeq: 3, assetId: 'asset-1', amount: '13600' });
      await expect(svc.advance(row.id, FundsOrderAction.CLEAR, 'E2E')).rejects.toThrow(/direction=INTERNAL/);
    });
  });

  it('findByParent 按 lpExchangeId 过滤', async () => {
    const prisma = makePrisma('FIAT');
    prisma.fundsOrder.findMany = jest.fn(async ({ where }: any) => [{ where }]);
    const svc = new FundsOrderService(prisma, new EventEmitter2());
    const [r] = await svc.findByParent({ lpExchangeId: 'lpx-9' }, { legSeq: 2 });
    expect(r.where).toEqual({ lpExchangeId: 'lpx-9', legSeq: 2 });
  });

  it('LP exchange legs never count toward the customer closure guard — countNonTerminalByCustomer 的 OR 名单恰好三项（deposit/withdraw/swap），不含 lpExchange', async () => {
    const prisma = makePrisma('FIAT');
    let capturedWhere: any = null;
    prisma.fundsOrder.count = jest.fn(async ({ where }: any) => { capturedWhere = where; return 0; });
    const svc = new FundsOrderService(prisma, new EventEmitter2());
    const count = await svc.countNonTerminalByCustomer('customer-1');
    expect(count).toBe(0);
    // 同划转单先例，LP 兑换单没有 customerId，天然不参与「某客户名下在途单」计数——
    // 这里直接核对 OR 名单的确切内容（3 项），而不是扫文本；漏加/多加一项都会被逮到。
    expect(capturedWhere.OR).toHaveLength(3);
    expect(capturedWhere.OR).toEqual([
      { deposit: { is: { ownerType: 'CUSTOMER', ownerId: 'customer-1' } } },
      { withdrawTransaction: { is: { ownerType: 'CUSTOMER', ownerId: 'customer-1' } } },
      { swapTransaction: { is: { ownerType: 'CUSTOMER', ownerId: 'customer-1' } } },
    ]);
  });
});
