import { MaterialRequestsService } from './material-requests.service';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';

const ACTOR = { actorType: 'ADMIN' as const, actorId: 'u1', actorNo: 'ADM001', actorRole: 'MLRO' };

function baseRow(over: Record<string, any> = {}) {
  return {
    id: 'r1', requestNo: 'MRQ2608170001', customerId: 'c1', sumsubApplicantId: 'app-1',
    materialType: 'PROOF_OF_ADDRESS', levelName: 'wave3-action-poa-refresh',
    applicantActionId: 'act-1', externalActionId: 'ext-1',
    orderDomain: null, orderRef: null, restrictionNo: null,
    origin: 'OPERATOR_ISSUED', status: 'PENDING_SUBMISSION',
    reason: 'why', issuedBy: 'ADM001', issuedAt: new Date('2026-08-17T00:00:00Z'),
    submittedAt: null, reviewedAt: null, reviewAnswer: null, reviewRejectType: null,
    cancelledAt: null, cancelReason: null, traceId: 'MATERIAL_REQUEST:t1',
    ...over,
  };
}

function createPrismaMock() {
  const tx = {
    customerMain: { findUnique: jest.fn().mockResolvedValue({ id: 'c1', customerNo: 'CUS-001' }) },
    materialRequest: {
      create: jest.fn(async ({ data }: any) => ({ ...baseRow(), ...data })),
      findUnique: jest.fn().mockResolvedValue(baseRow()),
      update: jest.fn(async ({ data }: any) => ({ ...baseRow(), ...data })),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const prisma = {
    customerMain: { findUnique: jest.fn().mockResolvedValue({ id: 'c1', customerNo: 'CUS-001' }) },
    materialRequest: {
      create: tx.materialRequest.create,
      findUnique: jest.fn().mockResolvedValue(baseRow()),
      findFirst: jest.fn().mockResolvedValue(baseRow()),
      findMany: jest.fn().mockResolvedValue([]),
      update: tx.materialRequest.update,
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    $transaction: jest.fn((cb: any) => cb(tx)),
  } as any;
  return { prisma, tx };
}

const audit = () => ({ recordSystem: jest.fn().mockResolvedValue(undefined),
                       recordByActor: jest.fn().mockResolvedValue(undefined) } as any);

const sumsub = () => ({
  createActionSdkToken: jest.fn().mockResolvedValue({ token: 'tok-x' }),
} as any);

const INPUT = {
  customerId: 'c1', sumsubApplicantId: 'app-1', materialType: 'PROOF_OF_ADDRESS',
  levelName: 'wave3-action-poa-refresh', applicantActionId: 'act-1', externalActionId: 'ext-1',
  orderDomain: null, orderRef: null, origin: 'OPERATOR_ISSUED' as const,
  reason: 'why', issuedBy: 'ADM001',
};

describe('MaterialRequestsService.create', () => {
  it('落库带 requestNo / traceId，status 起于 PENDING_SUBMISSION', async () => {
    const { prisma } = createPrismaMock();
    const svc = new MaterialRequestsService(prisma, audit(), sumsub());
    const row = await svc.create(INPUT);
    expect(row.requestNo).toMatch(/^MRQ\d{10}$/);
    expect(row.status).toBe('PENDING_SUBMISSION');
    expect(row.traceId).toMatch(/^MATERIAL_REQUEST:/);
  });

  it('G9：requestNo 撞号（P2002）自动重生成重试，不把 P2002 抛给调用方', async () => {
    const { prisma } = createPrismaMock();
    const p2002 = Object.assign(new Error('unique'), { code: 'P2002' });
    prisma.materialRequest.create
      .mockRejectedValueOnce(p2002)
      .mockImplementationOnce(async ({ data }: any) => ({ ...baseRow(), ...data }));
    const svc = new MaterialRequestsService(prisma, audit(), sumsub());
    await expect(svc.create(INPUT)).resolves.toMatchObject({ status: 'PENDING_SUBMISSION' });
    expect(prisma.materialRequest.create).toHaveBeenCalledTimes(2);
    const first = prisma.materialRequest.create.mock.calls[0][0].data.requestNo;
    const second = prisma.materialRequest.create.mock.calls[1][0].data.requestNo;
    expect(second).not.toBe(first);
  });

  it('spec I3：orderDomain 与 orderRef 半绑 → BadRequest', async () => {
    const { prisma } = createPrismaMock();
    const svc = new MaterialRequestsService(prisma, audit(), sumsub());
    await expect(svc.create({ ...INPUT, orderDomain: 'DEPOSIT', orderRef: null } as any))
      .rejects.toThrow(BadRequestException);
    await expect(svc.create({ ...INPUT, orderDomain: null, orderRef: 'DP1' } as any))
      .rejects.toThrow(BadRequestException);
  });

  it('externalActionId 撞号（P2002）不重试，原样抛出（重试会造出第二行指向同一个 Sumsub action）', async () => {
    const { prisma } = createPrismaMock();
    const p2002 = Object.assign(new Error('unique'), {
      code: 'P2002',
      meta: { target: ['externalActionId'] },
    });
    prisma.materialRequest.create.mockRejectedValueOnce(p2002);
    const svc = new MaterialRequestsService(prisma, audit(), sumsub());
    await expect(svc.create(INPUT)).rejects.toBe(p2002);
    expect(prisma.materialRequest.create).toHaveBeenCalledTimes(1);
  });

  it('写一条 MATERIAL_REQUEST_ISSUED 审计，走当前 client（未传 tx 时即 base prisma）', async () => {
    const { prisma } = createPrismaMock();
    const a = audit();
    await new MaterialRequestsService(prisma, a, sumsub()).create(INPUT);
    expect(a.recordSystem).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'MATERIAL_REQUEST_ISSUED', entityType: 'MATERIAL_REQUEST' }),
      prisma,
    );
  });
});

describe('MaterialRequestsService.markSubmitted', () => {
  it('write-once：首次落章返回 true 并写审计', async () => {
    const { prisma } = createPrismaMock();
    const a = audit();
    const svc = new MaterialRequestsService(prisma, a, sumsub());
    await expect(svc.markSubmitted('MRQ2608170001', ACTOR)).resolves.toBe(true);
    expect(prisma.materialRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ requestNo: 'MRQ2608170001', status: 'PENDING_SUBMISSION' }),
      }),
    );
    expect(a.recordByActor).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'MATERIAL_REQUEST_SUBMITTED' }), expect.anything(),
    );
  });

  it('重复提交静默返回 false，不重复写审计（幂等恒成功，不吐状态机信息）', async () => {
    const { prisma } = createPrismaMock();
    prisma.materialRequest.updateMany.mockResolvedValueOnce({ count: 0 });
    const a = audit();
    await expect(new MaterialRequestsService(prisma, a, sumsub()).markSubmitted('MRQ2608170001', ACTOR))
      .resolves.toBe(false);
    expect(a.recordByActor).not.toHaveBeenCalled();
  });
});

describe('MaterialRequestsService.markReviewed', () => {
  it('GREEN → APPROVED', async () => {
    const { prisma } = createPrismaMock();
    prisma.materialRequest.findUnique
      .mockResolvedValueOnce(baseRow({ status: 'SUBMITTED' }))
      .mockResolvedValue(baseRow({ status: 'APPROVED', reviewAnswer: 'GREEN' }));
    const row = await new MaterialRequestsService(prisma, audit(), sumsub())
      .markReviewed('MRQ2608170001', 'GREEN', null, ACTOR);
    expect(row.status).toBe('APPROVED');
    expect(prisma.materialRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { requestNo: 'MRQ2608170001', status: 'SUBMITTED' } }),
    );
  });

  it('RED+RETRY → 回 PENDING_SUBMISSION 且清 submittedAt，externalActionId 不变', async () => {
    const { prisma } = createPrismaMock();
    prisma.materialRequest.findUnique
      .mockResolvedValueOnce(baseRow({ status: 'SUBMITTED', submittedAt: new Date() }))
      .mockResolvedValue(
        baseRow({ status: 'PENDING_SUBMISSION', submittedAt: null, reviewAnswer: 'RED', reviewRejectType: 'RETRY' }),
      );
    const row = await new MaterialRequestsService(prisma, audit(), sumsub())
      .markReviewed('MRQ2608170001', 'RED', 'RETRY', ACTOR);
    expect(row.status).toBe('PENDING_SUBMISSION');
    expect(prisma.materialRequest.updateMany.mock.calls[0][0].data.submittedAt).toBeNull();
    expect(row.externalActionId).toBe('ext-1');
  });

  it('RED+FINAL → REJECTED 终态', async () => {
    const { prisma } = createPrismaMock();
    prisma.materialRequest.findUnique
      .mockResolvedValueOnce(baseRow({ status: 'SUBMITTED' }))
      .mockResolvedValue(baseRow({ status: 'REJECTED', reviewAnswer: 'RED', reviewRejectType: 'FINAL' }));
    const row = await new MaterialRequestsService(prisma, audit(), sumsub())
      .markReviewed('MRQ2608170001', 'RED', 'FINAL', ACTOR);
    expect(row.status).toBe('REJECTED');
  });

  it('并发裁决：updateMany count=0（行已被别人改过）→ ConflictException，不写审计', async () => {
    const { prisma } = createPrismaMock();
    prisma.materialRequest.findUnique.mockResolvedValue(baseRow({ status: 'SUBMITTED' }));
    prisma.materialRequest.updateMany.mockResolvedValueOnce({ count: 0 });
    const a = audit();
    await expect(
      new MaterialRequestsService(prisma, a, sumsub()).markReviewed('MRQ2608170001', 'GREEN', null, ACTOR),
    ).rejects.toThrow(ConflictException);
    expect(a.recordSystem).not.toHaveBeenCalled();
  });

  it('RED 不带 rejectType → BadRequest（不许默默当成 FINAL 关单）', async () => {
    const { prisma } = createPrismaMock();
    prisma.materialRequest.findUnique.mockResolvedValue(baseRow({ status: 'SUBMITTED' }));
    await expect(new MaterialRequestsService(prisma, audit(), sumsub())
      .markReviewed('MRQ2608170001', 'RED', null, ACTOR)).rejects.toThrow(BadRequestException);
  });

  it('对已终态的行裁决 → BadRequest（状态机零出边）', async () => {
    const { prisma } = createPrismaMock();
    prisma.materialRequest.findUnique.mockResolvedValue(baseRow({ status: 'APPROVED' }));
    await expect(new MaterialRequestsService(prisma, audit(), sumsub())
      .markReviewed('MRQ2608170001', 'GREEN', null, ACTOR)).rejects.toThrow(BadRequestException);
  });

  it('行不存在 → NotFound', async () => {
    const { prisma } = createPrismaMock();
    prisma.materialRequest.findUnique.mockResolvedValue(null);
    await expect(new MaterialRequestsService(prisma, audit(), sumsub())
      .markReviewed('NOPE', 'GREEN', null, ACTOR)).rejects.toThrow(NotFoundException);
  });
});

describe('MaterialRequestsService 查询侧', () => {
  it('listLiveByCustomer 只查两个活状态', async () => {
    const { prisma } = createPrismaMock();
    await new MaterialRequestsService(prisma, audit(), sumsub()).listLiveByCustomer('c1');
    expect(prisma.materialRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { customerId: 'c1', status: { in: ['PENDING_SUBMISSION', 'SUBMITTED'] } },
      }),
    );
  });

  it('listAllByCustomer 不带 status 过滤（后台要看全部，G6）', async () => {
    const { prisma } = createPrismaMock();
    await new MaterialRequestsService(prisma, audit(), sumsub()).listAllByCustomer('c1');
    const where = prisma.materialRequest.findMany.mock.calls[0][0].where;
    expect(where).toEqual({ customerId: 'c1' });
  });
});

describe('MaterialRequestsService.unbindOrder', () => {
  it('解绑把两列一起置空（spec I3 同空同非空）', async () => {
    const { prisma } = createPrismaMock();
    prisma.materialRequest.findUnique.mockResolvedValue(
      baseRow({ orderDomain: 'DEPOSIT', orderRef: 'DP1', restrictionNo: 'RST1' }),
    );
    await new MaterialRequestsService(prisma, audit(), sumsub()).unbindOrder('MRQ2608170001', ACTOR);
    const data = prisma.materialRequest.update.mock.calls[0][0].data;
    expect(data).toMatchObject({ orderDomain: null, orderRef: null });
  });
});

/**
 * 铸 token 2026-08-18 从 client controller 挪进了这个 service（G5 / spec I2
 * 扫描收紧后不再豁免任何位置，controller 源码里不能再拼这个出站请求对象）。
 * 归属 / 状态 / 客户是否持有 sumsubApplicantId 的判定逻辑与旧 controller
 * 版本逐字一致，只是搬了个位置。
 */
describe('MaterialRequestsService.mintSessionToken', () => {
  it('归属 + PENDING_SUBMISSION + 客户有 sumsubApplicantId → 铸 token，externalActionId 作为钥匙传给 Sumsub', async () => {
    const { prisma } = createPrismaMock();
    prisma.customerMain.findUnique.mockResolvedValue({ sumsubApplicantId: 'app-1' });
    const sb = sumsub();
    const token = await new MaterialRequestsService(prisma, audit(), sb)
      .mintSessionToken('MRQ2608170001', 'c1');
    expect(token).toBe('tok-x');
    expect(sb.createActionSdkToken).toHaveBeenCalledWith({
      applicantId: 'app-1', levelName: 'wave3-action-poa-refresh',
      externalActionId: 'ext-1', ttlInSecs: 600,
    });
  });

  it('别人的号（customerId 不匹配）→ null，不铸 token', async () => {
    const { prisma } = createPrismaMock();
    const sb = sumsub();
    const token = await new MaterialRequestsService(prisma, audit(), sb)
      .mintSessionToken('MRQ2608170001', 'someone-else');
    expect(token).toBeNull();
    expect(sb.createActionSdkToken).not.toHaveBeenCalled();
  });

  it('不存在的号 → null，不铸 token', async () => {
    const { prisma } = createPrismaMock();
    prisma.materialRequest.findUnique.mockResolvedValue(null);
    const sb = sumsub();
    const token = await new MaterialRequestsService(prisma, audit(), sb)
      .mintSessionToken('MRQ-NOPE', 'c1');
    expect(token).toBeNull();
    expect(sb.createActionSdkToken).not.toHaveBeenCalled();
  });

  it('已提交（非 PENDING_SUBMISSION）→ null，不铸 token', async () => {
    const { prisma } = createPrismaMock();
    prisma.materialRequest.findUnique.mockResolvedValue(baseRow({ status: 'SUBMITTED' }));
    const sb = sumsub();
    const token = await new MaterialRequestsService(prisma, audit(), sb)
      .mintSessionToken('MRQ2608170001', 'c1');
    expect(token).toBeNull();
    expect(sb.createActionSdkToken).not.toHaveBeenCalled();
  });

  it('终态行 → null，不铸 token', async () => {
    const { prisma } = createPrismaMock();
    prisma.materialRequest.findUnique.mockResolvedValue(baseRow({ status: 'REJECTED' }));
    const sb = sumsub();
    const token = await new MaterialRequestsService(prisma, audit(), sb)
      .mintSessionToken('MRQ2608170001', 'c1');
    expect(token).toBeNull();
    expect(sb.createActionSdkToken).not.toHaveBeenCalled();
  });

  it('客户没有 sumsubApplicantId → null，不铸 token', async () => {
    const { prisma } = createPrismaMock();
    prisma.customerMain.findUnique.mockResolvedValue({ sumsubApplicantId: null });
    const sb = sumsub();
    const token = await new MaterialRequestsService(prisma, audit(), sb)
      .mintSessionToken('MRQ2608170001', 'c1');
    expect(token).toBeNull();
    expect(sb.createActionSdkToken).not.toHaveBeenCalled();
  });
});
