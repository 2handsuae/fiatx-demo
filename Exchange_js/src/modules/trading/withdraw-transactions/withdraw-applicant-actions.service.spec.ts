import { WithdrawApplicantActionsService } from './withdraw-applicant-actions.service';
import { MaterialRequestsService } from '../../identity/material-requests/material-requests.service';
import { MaterialRequestIssuerService } from '../../identity/material-requests/material-request-issuer.service';
import { CustomerRestrictionsService } from '../../identity/customers/customer-restrictions.service';
import { CustomerRestrictionWorkflowService } from '../../identity/customers/customer-restriction-workflow.service';

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
        origin: 'SUMSUB_PUSHED', restrict: false,
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
        // 2026-08-29：便签挂谁由 tag 决定——本用例不传 sceneTag（普通 SOF 补料），
        // restrict 恒 false，见下方『便签挂谁由 tag 决定』describe 块。
        restrict: false,
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

});

/**
 * 便签挂谁由 tag 决定（业主 2026-08-29 口径，Task A4，spec §2.6(5)）——镜像
 * deposit-applicant-actions.service.spec.ts 同名 describe 块，见其头注释。
 * 不把 issuer.register 桩死成写死的返回值：那样只能证明"issuer.register 被
 * 传了哪个参数"，证明不了"客户到底有没有被便签摁住"。这里走真实的
 * MaterialRequestIssuerService → CustomerRestrictionWorkflowService →
 * CustomerRestrictionsService 全链路，内存版 Prisma 只替掉纯 I/O 边界。
 */
describe('便签挂谁由 tag 决定', () => {
  const CUSTOMER_ID = 'c-tag-1';
  const WITHDRAW_ID = 'wd-tag-1';

  /** 内存版 Prisma 的 where 匹配：只需支持等值与 {in:[...]}，够用生产代码实际发出的查询形状。 */
  function matchesWhere(row: any, where: any = {}): boolean {
    return Object.entries(where).every(([key, cond]: [string, any]) => {
      if (cond && typeof cond === 'object' && 'in' in cond) return (cond.in as any[]).includes(row[key]);
      return row[key] === cond;
    });
  }

  function buildRealChain() {
    const materialRequests: any[] = [];
    const customerRestrictions: any[] = [];
    const customer = { id: CUSTOMER_ID, customerNo: 'CUS-TAG-0002', sumsubApplicantId: 'app-tag-2' };
    const withdraw = { id: WITHDRAW_ID, withdrawNo: 'WD2608290099', ownerId: CUSTOMER_ID };

    const prisma: any = {
      withdrawTransaction: {
        findUnique: jest.fn(async ({ where }: any) => (where.id === withdraw.id ? { ...withdraw } : null)),
      },
      customerMain: {
        findUnique: jest.fn(async ({ where }: any) => (where.id === customer.id ? { ...customer } : null)),
      },
      materialRequest: {
        create: jest.fn(async ({ data }: any) => {
          const row = { restrictionNo: null, ...data };
          materialRequests.push(row);
          return row;
        }),
        update: jest.fn(async ({ where, data }: any) => {
          const row = materialRequests.find((r) => r.requestNo === where.requestNo);
          Object.assign(row, data);
          return row;
        }),
        findFirst: jest.fn(async ({ where }: any) => materialRequests.find((r) => matchesWhere(r, where)) ?? null),
        findMany: jest.fn(async ({ where }: any) => materialRequests.filter((r) => matchesWhere(r, where))),
      },
      customerRestriction: {
        findFirst: jest.fn(async ({ where }: any) => customerRestrictions.find((r) => matchesWhere(r, where)) ?? null),
        findMany: jest.fn(async ({ where }: any) => customerRestrictions.filter((r) => matchesWhere(r, where))),
        createMany: jest.fn(async ({ data }: any) => {
          customerRestrictions.push(...data);
          return { count: data.length };
        }),
        count: jest.fn(async ({ where }: any) => customerRestrictions.filter((r) => matchesWhere(r, where)).length),
      },
      $transaction: jest.fn((cb: any) => cb(prisma)),
    };

    const audit = {
      recordSystem: jest.fn().mockResolvedValue(undefined),
      recordByActor: jest.fn().mockResolvedValue(undefined),
    } as any;
    const eventEmitter = { emit: jest.fn() } as any;

    const requests = new MaterialRequestsService(prisma, audit, {} as any);
    const restrictionsSvc = new CustomerRestrictionsService(prisma, audit, eventEmitter);
    const restrictionWorkflow = new CustomerRestrictionWorkflowService(prisma, restrictionsSvc, {} as any, audit);
    const issuer = new MaterialRequestIssuerService(prisma, requests, restrictionWorkflow, {} as any, {} as any);
    const svc = new WithdrawApplicantActionsService(prisma, requests, issuer);

    return { svc, prisma, customerId: customer.id, withdrawId: withdraw.id };
  }

  it('普通 SOF 补料（无 sceneTag）→ 材料请求不带 restrictionNo，客户不受限', async () => {
    const { svc, prisma, customerId, withdrawId } = buildRealChain();

    await svc.syncApplicantActions(withdrawId, [{ applicantActionId: 'a', externalActionId: 'e1' }], undefined);

    const row = await prisma.materialRequest.findFirst({ where: { externalActionId: 'e1' } });
    expect(row.restrictionNo).toBeNull();

    const open = await prisma.customerRestriction.count({
      where: { customerId, cause: 'PENDING_DOCUMENT', status: 'OPEN' },
    });
    expect(open).toBe(0);
  });

  it('PEP 补料（sceneTag=PEP_APPLICANT）→ 开客户级便签，scope 含 WITHDRAW+SWAP', async () => {
    const { svc, prisma, withdrawId } = buildRealChain();

    await svc.syncApplicantActions(withdrawId, [{ applicantActionId: 'b', externalActionId: 'e2' }], 'PEP_APPLICANT');

    const row = await prisma.materialRequest.findFirst({ where: { externalActionId: 'e2' } });
    expect(row.restrictionNo).not.toBeNull();

    const scopes = await prisma.customerRestriction.findMany({
      where: { restrictionNo: row.restrictionNo },
    });
    expect(scopes.map((s: any) => s.scope).sort()).toEqual(['SWAP', 'WITHDRAW']);
  });

  // OR 表达式的另一半分支（sceneTag === 'PEP_COUNTERPARTY'）——布尔判定不能只
  // 测一半，否则改坏另一半不会被任何用例发现。
  it('对手方 PEP 补料（sceneTag=PEP_COUNTERPARTY）→ 同样开客户级便签', async () => {
    const { svc, prisma, withdrawId } = buildRealChain();

    await svc.syncApplicantActions(withdrawId, [{ applicantActionId: 'c', externalActionId: 'e3' }], 'PEP_COUNTERPARTY');

    const row = await prisma.materialRequest.findFirst({ where: { externalActionId: 'e3' } });
    expect(row.restrictionNo).not.toBeNull();
  });
});
