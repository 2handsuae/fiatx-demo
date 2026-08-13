import { CustomerRestrictionsService } from './customer-restrictions.service';

describe('CustomerRestrictionsService', () => {
  it('add 写入去重，clear 只移除指定 capability', async () => {
    const prisma = { customerMain: {
      findUnique: jest.fn().mockResolvedValue({ id: 'c1', customerNo: 'C-001', restrictions: null }),
      update: jest.fn().mockResolvedValue({}),
    } } as any;
    const audit = { recordByActor: jest.fn(), recordSystem: jest.fn() } as any;
    const svc = new CustomerRestrictionsService(prisma, audit);

    await svc.add('c1', ['SWAP', 'WITHDRAW'], 'KYT_REJECTED', 'system');
    expect(JSON.parse(prisma.customerMain.update.mock.calls[0][0].data.restrictions))
      .toEqual([
        { capability: 'SWAP', reason: 'KYT_REJECTED' },
        { capability: 'WITHDRAW', reason: 'KYT_REJECTED' },
      ]);

    prisma.customerMain.findUnique.mockResolvedValue({
      id: 'c1', customerNo: 'C-001',
      restrictions: JSON.stringify([
        { capability: 'SWAP', reason: 'KYT_REJECTED' },
        { capability: 'WITHDRAW', reason: 'KYT_REJECTED' },
      ]),
    });
    await svc.clear('c1', ['SWAP', 'WITHDRAW'], 'system');
    expect(JSON.parse(prisma.customerMain.update.mock.calls[1][0].data.restrictions)).toEqual([]);
  });

  it('add 幂等：重复加同一 capability 不产生重复条目', async () => {
    const prisma = { customerMain: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'c1', customerNo: 'C-001',
        restrictions: JSON.stringify([{ capability: 'SWAP', reason: 'KYT_REJECTED' }]),
      }),
      update: jest.fn().mockResolvedValue({}),
    } } as any;
    const svc = new CustomerRestrictionsService(prisma, { recordByActor: jest.fn(), recordSystem: jest.fn() } as any);
    await svc.add('c1', ['SWAP'], 'KYT_REJECTED', 'system');
    expect(JSON.parse(prisma.customerMain.update.mock.calls[0][0].data.restrictions)).toHaveLength(1);
  });
});
