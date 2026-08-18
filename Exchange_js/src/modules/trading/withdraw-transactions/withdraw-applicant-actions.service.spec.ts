import { WithdrawApplicantActionsService } from './withdraw-applicant-actions.service';

const A1 = { applicantActionId: 'aa-1', externalActionId: 'e1' };
const A2 = { applicantActionId: 'aa-2', externalActionId: 'e2' };

// 2026-08-18 材料请求账：本类不再拥有专属子表，桩从直接操作 Prisma 子表模型
// 换成材料账依赖（issuer.register / requests.listLiveByOrder / requests.
// cancel）。旧版围绕 seq 分配/续号/P2002 竞态重试的
// 用例（子表 read-modify-write 特有的坑）在新模型里不再有对应物——seq 概念
// 本身已随子表一起消失，requestNo 生成与撞号重试已下沉进
// MaterialRequestsService.create()，有它自己的 spec 覆盖，这里不重复造。
// 保留/新增的用例覆盖：全新落账、部分重叠去重、幂等 no-op、退役、
// hasOutstanding 判据，以及本次改写新引入的两条守卫分支（单不存在 / 客户无
// Sumsub applicant）。
function build() {
  const prisma = {
    withdrawTransaction: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'wd-1', withdrawNo: 'WD2608170001', ownerId: 'c1',
      }),
      update: jest.fn().mockResolvedValue({}),
    },
    customerMain: {
      findUnique: jest.fn().mockResolvedValue({ id: 'c1', sumsubApplicantId: 'app-1' }),
    },
  } as any;
  const requests = {
    listLiveByOrder: jest.fn().mockResolvedValue([]),
    cancel: jest.fn().mockResolvedValue(undefined),
  } as any;
  const issuer = { register: jest.fn().mockResolvedValue({ requestNo: 'MRQ-new', restrictionNo: 'RST-1' }) } as any;
  const svc = new WithdrawApplicantActionsService(prisma, requests, issuer);
  return { svc, prisma, requests, issuer };
}

describe('WithdrawApplicantActionsService', () => {
  it('新 action 走 issuer.register 落材料账，不再写旧的专属子表', async () => {
    const { svc, issuer } = build();
    await svc.syncApplicantActions('wd-1', [{ applicantActionId: 'a1', externalActionId: 'e1' }]);
    expect(issuer.register).toHaveBeenCalledWith(
      expect.objectContaining({
        orderDomain: 'WITHDRAW', orderRef: 'WD2608170001',
        origin: 'SUMSUB_PUSHED', restrict: true,
        applicantActionId: 'a1', externalActionId: 'e1',
      }),
    );
  });

  it('报文里已消失的行 → cancel(RETIRED_BY_SUMSUB)，不是删行（账不能删）', async () => {
    const { svc, requests } = build();
    requests.listLiveByOrder.mockResolvedValue([
      { requestNo: 'MRQ-old', externalActionId: 'gone', status: 'PENDING_SUBMISSION' },
    ]);
    await svc.syncApplicantActions('wd-1', [{ applicantActionId: 'a1', externalActionId: 'e1' }]);
    expect(requests.cancel).toHaveBeenCalledWith('MRQ-old', 'RETIRED_BY_SUMSUB', expect.anything());
  });

  // 真回归（同款于充值域 2026-08-18 修）：退役循环若对 live 里 PENDING_SUBMISSION
  // 和 SUBMITTED 一视同仁，任何一个不带该 action 的 webhook 都会把客户已提交、
  // 正等审核的行撤成 CANCELLED——客户白交，运营也看不到。退役只能针对
  // PENDING_SUBMISSION，与子表时代 `submittedAt === null` 等价（71483d0d 版
  // toRetire 过滤）。
  it('报文里已消失但状态是 SUBMITTED 的行 → 不得 cancel（客户已交、正等审核）', async () => {
    const { svc, requests } = build();
    requests.listLiveByOrder.mockResolvedValue([
      { requestNo: 'MRQ-submitted', externalActionId: 'gone', status: 'SUBMITTED' },
    ]);
    const r = await svc.syncApplicantActions('wd-1', [{ applicantActionId: 'a1', externalActionId: 'e1' }]);
    expect(requests.cancel).not.toHaveBeenCalled();
    expect(r.retired).toBe(0);
  });

  it('报文里已消失且状态是 PENDING_SUBMISSION 的行 → 照旧被 cancel', async () => {
    const { svc, requests } = build();
    requests.listLiveByOrder.mockResolvedValue([
      { requestNo: 'MRQ-pending', externalActionId: 'gone', status: 'PENDING_SUBMISSION' },
    ]);
    const r = await svc.syncApplicantActions('wd-1', [{ applicantActionId: 'a1', externalActionId: 'e1' }]);
    expect(requests.cancel).toHaveBeenCalledWith('MRQ-pending', 'RETIRED_BY_SUMSUB', expect.anything());
    expect(r.retired).toBe(1);
  });

  it('incoming 含空 externalActionId 的条目 → 被跳过，不调 issuer.register', async () => {
    const { svc, issuer } = build();
    const r = await svc.syncApplicantActions('wd-1', [{ applicantActionId: 'a1', externalActionId: '' }]);
    expect(issuer.register).not.toHaveBeenCalled();
    expect(r).toEqual({ added: 0, retired: 0 });
  });

  it('incoming 含空 applicantActionId 的条目 → 被跳过，不调 issuer.register', async () => {
    const { svc, issuer } = build();
    const r = await svc.syncApplicantActions('wd-1', [{ applicantActionId: '', externalActionId: 'e1' }]);
    expect(issuer.register).not.toHaveBeenCalled();
    expect(r).toEqual({ added: 0, retired: 0 });
  });

  it('报文里已存在的行不重复 register（幂等，重复 webhook 不造第二行）', async () => {
    const { svc, issuer, requests } = build();
    requests.listLiveByOrder.mockResolvedValue([
      { requestNo: 'MRQ-1', externalActionId: 'e1', status: 'PENDING_SUBMISSION' },
    ]);
    await svc.syncApplicantActions('wd-1', [{ applicantActionId: 'a1', externalActionId: 'e1' }]);
    expect(issuer.register).not.toHaveBeenCalled();
    expect(requests.cancel).not.toHaveBeenCalled();
  });

  it('hasOutstanding 判据 = 该单还有 PENDING_SUBMISSION 的行（SUBMITTED 不算未提交）', async () => {
    const { svc, requests } = build();
    requests.listLiveByOrder.mockResolvedValue([
      { requestNo: 'MRQ-1', externalActionId: 'e1', status: 'SUBMITTED' },
    ]);
    await expect(svc.hasOutstanding('wd-1')).resolves.toBe(false);
    requests.listLiveByOrder.mockResolvedValue([
      { requestNo: 'MRQ-2', externalActionId: 'e2', status: 'PENDING_SUBMISSION' },
    ]);
    await expect(svc.hasOutstanding('wd-1')).resolves.toBe(true);
  });

  it('两条全新 action → issuer.register 各调一次，分别带自己的 id，返回 added:2/retired:0', async () => {
    const { svc, issuer } = build();
    const r = await svc.syncApplicantActions('wd-1', [A1, A2]);

    expect(r).toEqual({ added: 2, retired: 0 });
    expect(issuer.register).toHaveBeenCalledTimes(2);
    expect(issuer.register).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ applicantActionId: 'aa-1', externalActionId: 'e1' }),
    );
    expect(issuer.register).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ applicantActionId: 'aa-2', externalActionId: 'e2' }),
    );
  });

  it('部分重叠：材料账已有 e1，报文来 e1+e2 → 只对 e2 调 register 一次，不撤回 e1', async () => {
    const { svc, issuer, requests } = build();
    requests.listLiveByOrder.mockResolvedValue([
      { requestNo: 'MRQ-1', externalActionId: 'e1', status: 'PENDING_SUBMISSION' },
    ]);

    const r = await svc.syncApplicantActions('wd-1', [A1, A2]);

    expect(r).toEqual({ added: 1, retired: 0 });
    expect(issuer.register).toHaveBeenCalledTimes(1);
    expect(issuer.register).toHaveBeenCalledWith(
      expect.objectContaining({ applicantActionId: 'aa-2', externalActionId: 'e2' }),
    );
    expect(requests.cancel).not.toHaveBeenCalled();
  });

  it('register 落地的字段：customerId/sumsubApplicantId/materialType/levelName/issuedBy 全对', async () => {
    const { svc, issuer } = build();
    await svc.syncApplicantActions('wd-1', [A1]);

    expect(issuer.register).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: 'c1',
        sumsubApplicantId: 'app-1',
        materialType: 'SOURCE_OF_FUNDS',
        levelName: 'wave3-action-sof-refresh',
        orderDomain: 'WITHDRAW',
        orderRef: 'WD2608170001',
        origin: 'SUMSUB_PUSHED',
        restrict: true,
        issuedBy: 'SYSTEM',
      }),
    );
  });

  it('提现单不存在 → 直接返回零，不查客户、不同步材料账', async () => {
    const { svc, issuer, requests, prisma } = build();
    prisma.withdrawTransaction.findUnique.mockResolvedValue(null);

    const r = await svc.syncApplicantActions('wd-x', [A1]);

    expect(r).toEqual({ added: 0, retired: 0 });
    expect(prisma.customerMain.findUnique).not.toHaveBeenCalled();
    expect(requests.listLiveByOrder).not.toHaveBeenCalled();
    expect(issuer.register).not.toHaveBeenCalled();
  });

  it('owner 无 Sumsub applicant → 跳过同步，不调 issuer/requests', async () => {
    const { svc, issuer, requests, prisma } = build();
    prisma.customerMain.findUnique.mockResolvedValue({ id: 'c1', sumsubApplicantId: null });

    const r = await svc.syncApplicantActions('wd-1', [A1]);

    expect(r).toEqual({ added: 0, retired: 0 });
    expect(requests.listLiveByOrder).not.toHaveBeenCalled();
    expect(issuer.register).not.toHaveBeenCalled();
  });

  describe('hasOutstanding 的两个守卫分支', () => {
    it('提现单不存在 → false，不查材料账', async () => {
      const { svc, prisma, requests } = build();
      prisma.withdrawTransaction.findUnique.mockResolvedValue(null);

      await expect(svc.hasOutstanding('wd-x')).resolves.toBe(false);
      expect(requests.listLiveByOrder).not.toHaveBeenCalled();
    });

    it('材料账里该单没有任何活行 → false', async () => {
      const { svc } = build();
      await expect(svc.hasOutstanding('wd-1')).resolves.toBe(false);
    });
  });

  // clearWithdrawCache 只操作 withdrawTransaction 自己的标量字段，从未碰过子表，
  // 与「内脏换材料账」无关——保留是因为 withdraw-workflow.service.ts 那段被
  // 明令禁止改动的状态机逻辑（I2 修复）仍在调用它，删掉会让那段代码编译不过。
  it('clearWithdrawCache 把 actionSubmittedAt 清空并重置 SLA 两字段', async () => {
    const { svc, prisma } = build();
    const deadline = new Date('2026-08-13T00:00:00Z');

    await svc.clearWithdrawCache('wd-1', deadline);

    expect(prisma.withdrawTransaction.update).toHaveBeenCalledWith({
      where: { id: 'wd-1' },
      data: { actionSubmittedAt: null, slaDeadline: deadline, slaBreached: false },
    });
  });
});
