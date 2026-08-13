import { CustomerRestrictionsService } from './customer-restrictions.service';

/**
 * prisma.customerMain 代表事务外的基础 client；tx.customerMain 代表事务内的 client。
 * 两者分开 mock，才能断言 add/clear 的读+写确实都发生在 tx 上，而不是 base client 上。
 */
function createPrismaMock() {
  const tx = {
    customerMain: {
      findUnique: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    },
  };
  const prisma = {
    customerMain: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    $transaction: jest.fn((cb: any) => cb(tx)),
  } as any;
  return { prisma, tx };
}

describe('CustomerRestrictionsService', () => {
  it('add 写入去重，clear 只移除指定 capability', async () => {
    const { prisma, tx } = createPrismaMock();
    tx.customerMain.findUnique.mockResolvedValue({ id: 'c1', customerNo: 'C-001', restrictions: null });
    const audit = { recordByActor: jest.fn(), recordSystem: jest.fn() } as any;
    const svc = new CustomerRestrictionsService(prisma, audit);

    await svc.add('c1', ['SWAP', 'WITHDRAW'], 'KYT_REJECTED', 'system');
    expect(JSON.parse(tx.customerMain.update.mock.calls[0][0].data.restrictions))
      .toEqual([
        { capability: 'SWAP', reason: 'KYT_REJECTED' },
        { capability: 'WITHDRAW', reason: 'KYT_REJECTED' },
      ]);

    tx.customerMain.findUnique.mockResolvedValue({
      id: 'c1', customerNo: 'C-001',
      restrictions: JSON.stringify([
        { capability: 'SWAP', reason: 'KYT_REJECTED' },
        { capability: 'WITHDRAW', reason: 'KYT_REJECTED' },
      ]),
    });
    await svc.clear('c1', ['SWAP', 'WITHDRAW'], 'system');
    expect(JSON.parse(tx.customerMain.update.mock.calls[1][0].data.restrictions)).toEqual([]);
  });

  it('add 幂等：重复加同一 capability 不产生重复条目', async () => {
    const { prisma, tx } = createPrismaMock();
    tx.customerMain.findUnique.mockResolvedValue({
      id: 'c1', customerNo: 'C-001',
      restrictions: JSON.stringify([{ capability: 'SWAP', reason: 'KYT_REJECTED' }]),
    });
    const svc = new CustomerRestrictionsService(prisma, { recordByActor: jest.fn(), recordSystem: jest.fn() } as any);
    await svc.add('c1', ['SWAP'], 'KYT_REJECTED', 'system');
    expect(JSON.parse(tx.customerMain.update.mock.calls[0][0].data.restrictions)).toHaveLength(1);
  });

  it('add/clear 的读+写都发生在事务 client 上，而非 base prisma client（防并发丢更新）', async () => {
    const { prisma, tx } = createPrismaMock();
    tx.customerMain.findUnique.mockResolvedValue({ id: 'c1', customerNo: 'C-001', restrictions: null });
    const svc = new CustomerRestrictionsService(prisma, { recordByActor: jest.fn(), recordSystem: jest.fn() } as any);

    await svc.add('c1', ['SWAP'], 'KYT_REJECTED', 'system');

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.customerMain.findUnique).toHaveBeenCalledWith({ where: { id: 'c1' } });
    expect(tx.customerMain.update).toHaveBeenCalledTimes(1);
    expect(prisma.customerMain.findUnique).not.toHaveBeenCalled();
    expect(prisma.customerMain.update).not.toHaveBeenCalled();

    tx.customerMain.findUnique.mockResolvedValue({
      id: 'c1', customerNo: 'C-001',
      restrictions: JSON.stringify([{ capability: 'SWAP', reason: 'KYT_REJECTED' }]),
    });
    await svc.clear('c1', ['SWAP'], 'system');

    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(tx.customerMain.findUnique).toHaveBeenCalledTimes(2);
    expect(tx.customerMain.update).toHaveBeenCalledTimes(2);
    expect(prisma.customerMain.findUnique).not.toHaveBeenCalled();
    expect(prisma.customerMain.update).not.toHaveBeenCalled();
  });
});
