import { EventEmitter2 } from '@nestjs/event-emitter';
import { FundsOrderService } from './funds-order.service';
import { FundsOrderAction, FundsOrderStatus } from './dto/funds-order.dto';

/** 戊波二 T5：资金单第八种父键 houseTransferId（公司调拨单的唯一一条腿）。
 *  最小假 prisma：只实现 create() / advance() / 读面真正碰到的委托。 */
function makePrisma(assetType: 'FIAT' | 'CRYPTO') {
  const rows = new Map<string, any>();
  const prisma: any = {
    rows,
    asset: { findUnique: jest.fn(async () => ({ id: 'asset-1', type: assetType })) },
    fundsOrder: {
      create: jest.fn(async ({ data }: any) => { const row = { id: `fo-${rows.size + 1}`, ...data }; rows.set(row.id, row); return row; }),
      findUnique: jest.fn(async ({ where }: any) => { const row = rows.get(where.id); return row ? { ...row, asset: { type: assetType } } : null; }),
      update: jest.fn(async ({ where, data }: any) => { const row = { ...rows.get(where.id), ...data }; rows.set(where.id, row); return row; }),
      findMany: jest.fn(async () => []),
      count: jest.fn(async () => 0),
    },
  };
  prisma.$transaction = async (fn: any) => fn(prisma);
  return prisma;
}

describe('FundsOrderService —— 公司调拨单父键（戊波二 T5）', () => {
  it('create 接受 houseTransferId 作为唯一父键，落库并带进事件的 parent（workflow 靠它认领腿）', async () => {
    const prisma = makePrisma('FIAT');
    const emitter = new EventEmitter2();
    const events: any[] = [];
    emitter.on('funds_order.status.changed', (e) => events.push(e));
    const svc = new FundsOrderService(prisma, emitter);
    const row = await svc.create({ houseTransferId: 'htr-1', assetId: 'asset-1', amount: '100', fromWalletId: 'w-fee', toWalletId: 'w-ops' });
    expect(row.houseTransferId).toBe('htr-1');
    expect(row.status).toBe(FundsOrderStatus.CREATED);
    expect(prisma.fundsOrder.create.mock.calls[0][0].data).toMatchObject({ houseTransferId: 'htr-1', depositTransactionId: null, vendorPaymentId: null, internalTransferId: null });
    expect(events[0].parent).toMatchObject({ houseTransferId: 'htr-1' });
    expect(events[0].parent.vendorPaymentId).toBeUndefined();
  });

  it('两个父键同时给 → 400（恰好一个）；一个都不给也是 400', async () => {
    const svc = new FundsOrderService(makePrisma('FIAT'), new EventEmitter2());
    await expect(svc.create({ houseTransferId: 'htr-1', vendorPaymentId: 'vp-1', assetId: 'asset-1', amount: '1' } as any)).rejects.toThrow(/exactly one parent/);
    await expect(svc.create({ assetId: 'asset-1', amount: '1' } as any)).rejects.toThrow(/exactly one parent/);
  });

  it.each(['FIAT', 'CRYPTO'] as const)('调拨腿走出金那套走法表（%s）：CREATED --SUBMIT--> SUBMITTED，随后可 CONFIRM → CONFIRMED → CLEAR；不是 IN 方向（IN 表没有 CREATED 入口）', async (assetType) => {
    const prisma = makePrisma(assetType);
    const svc = new FundsOrderService(prisma, new EventEmitter2());
    const row = await svc.create({ houseTransferId: 'htr-1', assetId: 'asset-1', amount: '100' });
    expect((await svc.advance(row.id, FundsOrderAction.SUBMIT, 'E2E')).status).toBe(FundsOrderStatus.SUBMITTED);
    if (assetType === 'CRYPTO') expect((await svc.advance(row.id, FundsOrderAction.OBSERVE_CONFIRMING, 'E2E')).status).toBe(FundsOrderStatus.CONFIRMING);
    expect((await svc.advance(row.id, FundsOrderAction.CONFIRM, 'E2E')).status).toBe(FundsOrderStatus.CONFIRMED);
    expect((await svc.advance(row.id, FundsOrderAction.CLEAR, 'E2E')).status).toBe(FundsOrderStatus.CLEARED);
  });

  it('findByParent 按 houseTransferId 过滤', async () => {
    const prisma = makePrisma('FIAT');
    prisma.fundsOrder.findMany = jest.fn(async ({ where }: any) => [{ where }]);
    const svc = new FundsOrderService(prisma, new EventEmitter2());
    const [r] = await svc.findByParent({ houseTransferId: 'htr-9' }, { legSeq: 1 });
    expect(r.where).toEqual({ houseTransferId: 'htr-9', legSeq: 1 });
  });

  it('管理台列表的 parent 筛选 house-transfer 只取调拨腿，并把父单业务号 houseTransferNo 带出来（不带内部 id）', async () => {
    const prisma = makePrisma('FIAT');
    prisma.fundsOrder.findMany = jest.fn(async () => [{ id: 'fo-1', fundsOrderNo: 'FDO1', houseTransfer: { transferNo: 'HTR1' } }]);
    const svc = new FundsOrderService(prisma, new EventEmitter2());
    const out = await svc.findAllForAdmin({ parent: 'house-transfer' });
    expect(prisma.fundsOrder.findMany.mock.calls[0][0].where).toMatchObject({ houseTransferId: { not: null } });
    expect(prisma.fundsOrder.findMany.mock.calls[0][0].include.houseTransfer).toEqual({ select: { transferNo: true } });
    expect(out.items[0].houseTransferNo).toBe('HTR1');
  });

  it('管理台详情带出 houseTransferNo；调拨腿不计入客户销户守卫（countNonTerminalByCustomer 的 OR 名单仍恰好三项）', async () => {
    const prisma = makePrisma('FIAT');
    prisma.fundsOrder.findUnique = jest.fn(async () => ({ id: 'fo-1', fundsOrderNo: 'FDO1', houseTransfer: { id: 'htr-1', transferNo: 'HTR1', status: 'EXECUTING' } }));
    const svc = new FundsOrderService(prisma, new EventEmitter2());
    expect((await svc.findOneByNoForAdmin('FDO1')).houseTransferNo).toBe('HTR1');
    let captured: any = null;
    prisma.fundsOrder.count = jest.fn(async ({ where }: any) => { captured = where; return 0; });
    await svc.countNonTerminalByCustomer('customer-1');
    expect(captured.OR).toHaveLength(3);
  });
});
