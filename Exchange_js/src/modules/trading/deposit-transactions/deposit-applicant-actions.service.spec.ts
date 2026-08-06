import { Test } from '@nestjs/testing';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { DepositApplicantActionsService } from './deposit-applicant-actions.service';

const A1 = { applicantActionId: 'aa-1', externalActionId: 'EXT-1' };
const A2 = { applicantActionId: 'aa-2', externalActionId: 'EXT-2' };

describe('DepositApplicantActionsService', () => {
  let svc: DepositApplicantActionsService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      depositApplicantAction: {
        findMany: jest.fn().mockResolvedValue([]),
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        findFirst: jest.fn().mockResolvedValue(null),
        count: jest.fn().mockResolvedValue(0),
      },
      depositTransaction: { update: jest.fn(), updateMany: jest.fn() },
      $transaction: jest.fn(async (fn: any) => fn(prisma)),
    };
    const mod = await Test.createTestingModule({
      providers: [
        DepositApplicantActionsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    svc = mod.get(DepositApplicantActionsService);
  });

  it('全新单：两条都插入，seq 从 1 开始递增', async () => {
    const r = await svc.syncApplicantActions('d-1', [A1, A2]);

    expect(r).toEqual({ added: [1, 2], retired: [] });
    expect(prisma.depositApplicantAction.createMany).toHaveBeenCalledWith({
      data: [
        { depositTransactionId: 'd-1', applicantActionId: 'aa-1', externalActionId: 'EXT-1', seq: 1 },
        { depositTransactionId: 'd-1', applicantActionId: 'aa-2', externalActionId: 'EXT-2', seq: 2 },
      ],
    });
  });

  it('已有 aa-1(seq=1)，报文含 aa-1+aa-2 → 只插 aa-2，seq 接续为 2', async () => {
    prisma.depositApplicantAction.findMany.mockResolvedValue([
      { id: 'r1', applicantActionId: 'aa-1', seq: 1, submittedAt: null },
    ]);

    const r = await svc.syncApplicantActions('d-1', [A1, A2]);

    expect(r).toEqual({ added: [2], retired: [] });
    expect(prisma.depositApplicantAction.createMany).toHaveBeenCalledWith({
      data: [
        { depositTransactionId: 'd-1', applicantActionId: 'aa-2', externalActionId: 'EXT-2', seq: 2 },
      ],
    });
  });

  it('集合完全一致 → 真 no-op，不插不删', async () => {
    prisma.depositApplicantAction.findMany.mockResolvedValue([
      { id: 'r1', applicantActionId: 'aa-1', seq: 1, submittedAt: null },
    ]);

    const r = await svc.syncApplicantActions('d-1', [A1]);

    expect(r).toEqual({ added: [], retired: [] });
    expect(prisma.depositApplicantAction.createMany).not.toHaveBeenCalled();
    expect(prisma.depositApplicantAction.deleteMany).not.toHaveBeenCalled();
  });

  // Sumsub 报文带的是**当前全量列表**。它撤回一条而我方保留，该行永远算作
  // 未提交 →「全部交齐」永不成立 → 客户永久卡死（与 applyKytAwaitUser 早退
  // 那个 bug 同款形状、不同入口）。已提交的行不删——那是历史。
  it('报文撤回了未提交的 aa-2 → 删掉它；已提交的 aa-1 不动', async () => {
    prisma.depositApplicantAction.findMany.mockResolvedValue([
      { id: 'r1', applicantActionId: 'aa-1', seq: 1, submittedAt: new Date('2026-08-06') },
      { id: 'r2', applicantActionId: 'aa-2', seq: 2, submittedAt: null },
    ]);

    const r = await svc.syncApplicantActions('d-1', [A1]);

    expect(r).toEqual({ added: [], retired: [2] });
    expect(prisma.depositApplicantAction.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['r2'] } },
    });
  });

  it('报文里已提交的那条被撤回 → 不删（历史保留）', async () => {
    prisma.depositApplicantAction.findMany.mockResolvedValue([
      { id: 'r1', applicantActionId: 'aa-1', seq: 1, submittedAt: new Date('2026-08-06') },
    ]);

    const r = await svc.syncApplicantActions('d-1', []);

    expect(r).toEqual({ added: [], retired: [] });
    expect(prisma.depositApplicantAction.deleteMany).not.toHaveBeenCalled();
  });

  // nextSeq 是对撤回前的全量 existing 取 max，所以同一次调用里新增的行才不会
  // 复用被删行腾出来的 seq——这条路径 add-only/retire-only 两组测试都盖不到。
  it('同一次调用既新增又撤回：aa-1(未提交)被撤回，新增的 aa-3 不复用 aa-1 腾出的 seq=1', async () => {
    const A3 = { applicantActionId: 'aa-3', externalActionId: 'EXT-3' };
    prisma.depositApplicantAction.findMany.mockResolvedValue([
      { id: 'r1', applicantActionId: 'aa-1', seq: 1, submittedAt: null },
      { id: 'r2', applicantActionId: 'aa-2', seq: 2, submittedAt: new Date('2026-08-06') },
    ]);

    const r = await svc.syncApplicantActions('d-1', [A2, A3]);

    expect(r).toEqual({ added: [3], retired: [1] });
    expect(prisma.depositApplicantAction.createMany).toHaveBeenCalledWith({
      data: [
        { depositTransactionId: 'd-1', applicantActionId: 'aa-3', externalActionId: 'EXT-3', seq: 3 },
      ],
    });
    expect(prisma.depositApplicantAction.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['r1'] } },
    });
  });

  // seq 唯一性最终靠 @@unique([depositTransactionId, seq]) 兜底。这里模拟两次
  // 调用读到同一份陈旧 existing（并发/重复 webhook 场景下事务无法完全避免
  // 的那种撞法）：第一次落库成功，第二次落库时撞唯一约束——断言这个错误必须
  // 原样往上抛，不能被这层代码悄悄吞掉（吞掉的话 findBySeq 会查到"消失的"行）。
  it('并发下两次调用读到同一份陈旧 existing → 第二次落库撞唯一约束时错误必须原样传播', async () => {
    prisma.depositApplicantAction.findMany.mockResolvedValue([]);

    const uniqueViolation = Object.assign(new Error('Unique constraint failed on the fields: (`depositTransactionId`,`seq`)'), {
      code: 'P2002',
    });
    prisma.depositApplicantAction.createMany
      .mockResolvedValueOnce({ count: 1 })
      .mockRejectedValueOnce(uniqueViolation);

    const r1 = await svc.syncApplicantActions('d-1', [A1]);
    expect(r1).toEqual({ added: [1], retired: [] });

    await expect(svc.syncApplicantActions('d-1', [A1])).rejects.toBe(uniqueViolation);
  });

  describe('逐条提交与充值单缓存', () => {
    const DEADLINE = new Date('2026-08-13T00:00:00Z');

    it('交完最后一条 → 盖上充值单的 actionSubmittedAt', async () => {
      prisma.depositApplicantAction.updateMany = jest.fn().mockResolvedValue({ count: 1 });
      prisma.depositApplicantAction.count.mockResolvedValue(0);   // 已无未提交

      const r = await svc.submitBySeq('d-1', 2, DEADLINE, true);

      expect(r).toEqual({ changed: true, allSubmitted: true });
      expect(prisma.depositApplicantAction.updateMany).toHaveBeenCalledWith({
        where: { depositTransactionId: 'd-1', seq: 2, submittedAt: null },
        data: { submittedAt: expect.any(Date) },
      });
      const [[arg]] = prisma.depositTransaction.updateMany.mock.calls;
      expect(arg.data.actionSubmittedAt).toEqual(expect.any(Date));
      expect(arg.data.slaDeadline).toEqual(DEADLINE);
      expect(arg.data.slaBreached).toBe(false);
    });

    it('还剩未提交的 → 充值单缓存**不**盖，客户仍要继续交', async () => {
      prisma.depositApplicantAction.updateMany = jest.fn().mockResolvedValue({ count: 1 });
      prisma.depositApplicantAction.count.mockResolvedValue(1);   // 还有 1 条没交

      const r = await svc.submitBySeq('d-1', 1, DEADLINE, true);

      expect(r).toEqual({ changed: true, allSubmitted: false });
      expect(prisma.depositTransaction.updateMany).not.toHaveBeenCalled();
    });

    it('重复提交同一条 → changed:false，不重算不写库', async () => {
      prisma.depositApplicantAction.updateMany = jest.fn().mockResolvedValue({ count: 0 });

      const r = await svc.submitBySeq('d-1', 1, DEADLINE, true);

      expect(r).toEqual({ changed: false, allSubmitted: false });
      expect(prisma.depositApplicantAction.count).not.toHaveBeenCalled();
      expect(prisma.depositTransaction.updateMany).not.toHaveBeenCalled();
    });

    it('resetSla=false 时只盖 actionSubmittedAt，不碰 operator 的 SLA 两字段', async () => {
      prisma.depositApplicantAction.updateMany = jest.fn().mockResolvedValue({ count: 1 });
      prisma.depositApplicantAction.count.mockResolvedValue(0);

      await svc.submitBySeq('d-1', 1, DEADLINE, false);

      const [[arg]] = prisma.depositTransaction.updateMany.mock.calls;
      expect(arg.data).toEqual({ actionSubmittedAt: expect.any(Date) });
    });

    it('clearDepositCache 把 actionSubmittedAt 清空并重置 SLA 表', async () => {
      await svc.clearDepositCache('d-1', DEADLINE);
      expect(prisma.depositTransaction.update).toHaveBeenCalledWith({
        where: { id: 'd-1' },
        data: { actionSubmittedAt: null, slaDeadline: DEADLINE, slaBreached: false },
      });
    });
  });

  // 缓存式设计（spec §2.2）的代价是可能漂移：子表说还有未交的，充值单标量
  // 却显示已交齐。这条直接把两种表示绑死——对随机构造的提交组合，断言
  // 「标量该不该有值」与「子表还有没有未提交行」结论一致。漂了就红。
  describe('绑死两种表示（防缓存漂移）', () => {
    const DEADLINE = new Date('2026-08-13T00:00:00Z');

    it.each([
      [3, 0],  // 3 条全未交
      [3, 1],
      [3, 2],
      [3, 3],  // 3 条全交齐
      [1, 0],
      [1, 1],
    ])('%i 条 action 交了 %i 条：缓存与子表结论一致', async (total, submittedCount) => {
      const outstanding = total - submittedCount;
      prisma.depositApplicantAction.updateMany = jest.fn().mockResolvedValue({ count: 1 });
      prisma.depositApplicantAction.count.mockResolvedValue(outstanding);
      prisma.depositTransaction.updateMany.mockClear();

      const r = await svc.submitBySeq('d-1', 1, DEADLINE, true);

      const cacheWritten = prisma.depositTransaction.updateMany.mock.calls.length > 0;
      expect(r.allSubmitted).toBe(outstanding === 0);
      expect(cacheWritten).toBe(outstanding === 0);
    });
  });

});
