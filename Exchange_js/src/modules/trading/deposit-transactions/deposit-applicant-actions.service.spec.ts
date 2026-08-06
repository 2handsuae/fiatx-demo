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

});
