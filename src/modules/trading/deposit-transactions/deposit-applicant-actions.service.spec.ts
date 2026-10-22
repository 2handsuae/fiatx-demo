import { DepositApplicantActionsService } from './deposit-applicant-actions.service';
import { MaterialRequestsService } from '../../identity/material-requests/material-requests.service';
import { MaterialRequestIssuerService } from '../../identity/material-requests/material-request-issuer.service';
import { MaterialRequestReviewService } from '../../identity/material-requests/material-request-review.service';
import { MaterialPolicyLoader } from '../../identity/material-requests/material-policy';
import { DomainEventNames } from '../../../common/events/domain-events.constants';
import { CustomerRestrictionsService } from '../../identity/customers/customer-restrictions.service';
import { CustomerRestrictionWorkflowService } from '../../identity/customers/customer-restriction-workflow.service';

const A1 = { applicantActionId: 'aa-1', externalActionId: 'e1' };
const A2 = { applicantActionId: 'aa-2', externalActionId: 'e2' };

// 2026-08-17 材料请求账：本类不再拥有专属子表，桩从直接操作 Prisma 子表模型
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
    depositTransaction: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'dep-1', depositNo: 'DP2608170001', ownerId: 'c1',
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
    markSubmitted: jest.fn().mockResolvedValue(true),
  } as any;
  const issuer = { register: jest.fn().mockResolvedValue({ requestNo: 'MRQ-new', restrictionNo: 'RST-1' }) } as any;
  const review = { applyReview: jest.fn().mockResolvedValue({ requestNo: 'MRQ-claim', outcome: 'APPROVED' }) } as any;
  const svc = new DepositApplicantActionsService(prisma, requests, issuer, review);
  return { svc, prisma, requests, issuer, review };
}

describe('DepositApplicantActionsService', () => {
  it('新 action 走 issuer.register 落材料账，不再写旧的专属子表', async () => {
    const { svc, issuer } = build();
    await svc.syncApplicantActions('dep-1', [
      { applicantActionId: 'a1', externalActionId: 'e1' },
    ]);
    expect(issuer.register).toHaveBeenCalledWith(
      expect.objectContaining({
        orderDomain: 'DEPOSIT', orderRef: 'DP2608170001',
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
    await svc.syncApplicantActions('dep-1', [
      { applicantActionId: 'a1', externalActionId: 'e1' },
    ]);
    expect(requests.cancel).toHaveBeenCalledWith('MRQ-old', 'RETIRED_BY_SUMSUB', expect.anything());
  });

  // 真回归（2026-08-18 修）：旧退役循环对 live 里 PENDING_SUBMISSION 和 SUBMITTED
  // 一视同仁，任何一个不带该 action 的 webhook 都会把客户已提交、正等审核的行
  // 撤成 CANCELLED——客户白交，运营也看不到。退役只能针对 PENDING_SUBMISSION，
  // 与子表时代 `submittedAt === null` 等价（71483d0d 版 toRetire 过滤）。
  it('报文里已消失但状态是 SUBMITTED 的行 → 不得 cancel（客户已交、正等审核）', async () => {
    const { svc, requests } = build();
    requests.listLiveByOrder.mockResolvedValue([
      { requestNo: 'MRQ-submitted', externalActionId: 'gone', status: 'SUBMITTED' },
    ]);
    const r = await svc.syncApplicantActions('dep-1', [
      { applicantActionId: 'a1', externalActionId: 'e1' },
    ]);
    expect(requests.cancel).not.toHaveBeenCalled();
    expect(r.retired).toBe(0);
  });

  it('报文里已消失且状态是 PENDING_SUBMISSION 的行 → 照旧被 cancel', async () => {
    const { svc, requests } = build();
    requests.listLiveByOrder.mockResolvedValue([
      { requestNo: 'MRQ-pending', externalActionId: 'gone', status: 'PENDING_SUBMISSION' },
    ]);
    const r = await svc.syncApplicantActions('dep-1', [
      { applicantActionId: 'a1', externalActionId: 'e1' },
    ]);
    expect(requests.cancel).toHaveBeenCalledWith('MRQ-pending', 'RETIRED_BY_SUMSUB', expect.anything());
    expect(r.retired).toBe(1);
  });

  it('incoming 含空 externalActionId 的条目 → 被跳过，不调 issuer.register', async () => {
    const { svc, issuer } = build();
    const r = await svc.syncApplicantActions('dep-1', [
      { applicantActionId: 'a1', externalActionId: '' },
    ]);
    expect(issuer.register).not.toHaveBeenCalled();
    expect(r).toEqual({ added: 0, retired: 0 });
  });

  it('incoming 含空 applicantActionId 的条目 → 被跳过，不调 issuer.register', async () => {
    const { svc, issuer } = build();
    const r = await svc.syncApplicantActions('dep-1', [{ applicantActionId: '', externalActionId: 'e1' }]);
    expect(issuer.register).not.toHaveBeenCalled();
    expect(r).toEqual({ added: 0, retired: 0 });
  });

  it('报文里已存在的行不重复 register（幂等，重复 webhook 不造第二行）', async () => {
    const { svc, issuer, requests } = build();
    requests.listLiveByOrder.mockResolvedValue([
      { requestNo: 'MRQ-1', externalActionId: 'e1', status: 'PENDING_SUBMISSION' },
    ]);
    await svc.syncApplicantActions('dep-1', [
      { applicantActionId: 'a1', externalActionId: 'e1' },
    ]);
    expect(issuer.register).not.toHaveBeenCalled();
    expect(requests.cancel).not.toHaveBeenCalled();
  });

  it('hasOutstanding 判据 = 该单还有 PENDING_SUBMISSION 的行（SUBMITTED 不算未提交）', async () => {
    const { svc, requests } = build();
    requests.listLiveByOrder.mockResolvedValue([
      { requestNo: 'MRQ-1', externalActionId: 'e1', status: 'SUBMITTED' },
    ]);
    await expect(svc.hasOutstanding('dep-1')).resolves.toBe(false);
    requests.listLiveByOrder.mockResolvedValue([
      { requestNo: 'MRQ-2', externalActionId: 'e2', status: 'PENDING_SUBMISSION' },
    ]);
    await expect(svc.hasOutstanding('dep-1')).resolves.toBe(true);
  });

  it('两条全新 action → issuer.register 各调一次，分别带自己的 id，返回 added:2/retired:0', async () => {
    const { svc, issuer } = build();
    const r = await svc.syncApplicantActions('dep-1', [A1, A2]);

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

    const r = await svc.syncApplicantActions('dep-1', [A1, A2]);

    expect(r).toEqual({ added: 1, retired: 0 });
    expect(issuer.register).toHaveBeenCalledTimes(1);
    expect(issuer.register).toHaveBeenCalledWith(
      expect.objectContaining({ applicantActionId: 'aa-2', externalActionId: 'e2' }),
    );
    expect(requests.cancel).not.toHaveBeenCalled();
  });

  it('register 落地的字段：customerId/sumsubApplicantId/materialType/levelName/issuedBy 全对', async () => {
    const { svc, issuer } = build();
    await svc.syncApplicantActions('dep-1', [A1]);

    expect(issuer.register).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: 'c1',
        sumsubApplicantId: 'app-1',
        materialType: 'SOURCE_OF_FUNDS',
        levelName: 'wave3-action-sof-refresh',
        orderDomain: 'DEPOSIT',
        orderRef: 'DP2608170001',
        origin: 'SUMSUB_PUSHED',
        // 2026-08-29：便签挂谁由 tag 决定——本用例不传 sceneTag（普通 SOF 补料），
        // restrict 恒 false，见下方『便签挂谁由 tag 决定』describe 块。
        restrict: false,
        issuedBy: 'SYSTEM',
      }),
    );
  });

  it('充值单不存在 → 直接返回零，不查客户、不同步材料账', async () => {
    const { svc, issuer, requests, prisma } = build();
    prisma.depositTransaction.findUnique.mockResolvedValue(null);

    const r = await svc.syncApplicantActions('dep-x', [A1]);

    expect(r).toEqual({ added: 0, retired: 0 });
    expect(prisma.customerMain.findUnique).not.toHaveBeenCalled();
    expect(requests.listLiveByOrder).not.toHaveBeenCalled();
    expect(issuer.register).not.toHaveBeenCalled();
  });

  it('owner 无 Sumsub applicant → 跳过同步，不调 issuer/requests', async () => {
    const { svc, issuer, requests, prisma } = build();
    prisma.customerMain.findUnique.mockResolvedValue({ id: 'c1', sumsubApplicantId: null });

    const r = await svc.syncApplicantActions('dep-1', [A1]);

    expect(r).toEqual({ added: 0, retired: 0 });
    expect(requests.listLiveByOrder).not.toHaveBeenCalled();
    expect(issuer.register).not.toHaveBeenCalled();
  });

  // 对手方波二 Task 4：unhosted 超线认领挂起——经 issuer.register 落一张 SOURCE_OWNERSHIP_CLAIM 材料单。
  describe('registerOwnershipClaim — 认领挂起落材料账', () => {
    it('issuer.register 实参：材料型 / 绑本单 / SUMSUB_PUSHED / 不挂限制；行上三个 id 列是我方铸的本地占位（无 Sumsub action）', async () => {
      const { svc, issuer } = build();

      await svc.registerOwnershipClaim('dep-1');

      expect(issuer.register).toHaveBeenCalledTimes(1);
      const arg = issuer.register.mock.calls[0][0];
      expect(arg).toMatchObject({
        customerId: 'c1',
        sumsubApplicantId: 'app-1',
        materialType: 'SOURCE_OWNERSHIP_CLAIM',
        levelName: 'OWNERSHIP_CLAIM',
        orderDomain: 'DEPOSIT',
        orderRef: 'DP2608170001',
        origin: 'SUMSUB_PUSHED',
        restrict: false,
        issuedBy: 'SYSTEM',
      });
      // externalActionId 是材料账 @unique 键，applicantActionId 非空——两者都不是空串
      expect(arg.applicantActionId).toEqual(expect.stringMatching(/\S/));
      expect(arg.externalActionId).toEqual(expect.stringMatching(/^MRQ:/));
    });

    it('同一单再次认领 → 铸出的 externalActionId 不撞（不是常量）', async () => {
      const { svc, issuer } = build();

      await svc.registerOwnershipClaim('dep-1');
      await svc.registerOwnershipClaim('dep-1');

      const [a, b] = issuer.register.mock.calls.map((c: any[]) => c[0].externalActionId);
      expect(a).not.toBe(b);
    });

    it('充值单不存在 / owner 无 Sumsub applicant → 不调 issuer（与 syncApplicantActions 同款守卫）', async () => {
      const { svc, issuer, prisma } = build();
      prisma.customerMain.findUnique.mockResolvedValue({ id: 'c1', sumsubApplicantId: null });
      await svc.registerOwnershipClaim('dep-1');

      prisma.depositTransaction.findUnique.mockResolvedValue(null);
      await svc.registerOwnershipClaim('dep-x');

      expect(issuer.register).not.toHaveBeenCalled();
    });
  });

  // 对手方波二 Task 5：客户提交认领——找未决认领单 + 走材料账既有 markSubmitted / applyReview(GREEN)。
  describe('findPendingOwnershipClaim — 该单上客户还没交的认领单', () => {
    const live = (over: Record<string, unknown>) => ({
      requestNo: 'MRQ-x', externalActionId: 'ext-x', materialType: 'SOURCE_OWNERSHIP_CLAIM',
      status: 'PENDING_SUBMISSION', ...over,
    });

    it('按业务键查本单活行，只认 SOURCE_OWNERSHIP_CLAIM ∧ PENDING_SUBMISSION，返回定位用的 requestNo + 复核钥匙', async () => {
      const { svc, requests } = build();
      requests.listLiveByOrder.mockResolvedValue([
        live({ requestNo: 'MRQ-sof', externalActionId: 'ext-sof', materialType: 'SOURCE_OF_FUNDS' }),
        live({ requestNo: 'MRQ-claim', externalActionId: 'FORM-ext-claim' }),
      ]);

      await expect(svc.findPendingOwnershipClaim('DP2608170001'))
        .resolves.toEqual({ requestNo: 'MRQ-claim', externalActionId: 'FORM-ext-claim' });
      expect(requests.listLiveByOrder).toHaveBeenCalledWith('DEPOSIT', 'DP2608170001');
    });

    it('同单只有别的补料（SOF）待交 → null：补料不是认领，不能拿认领端点去交', async () => {
      const { svc, requests } = build();
      requests.listLiveByOrder.mockResolvedValue([live({ materialType: 'SOURCE_OF_FUNDS' })]);

      await expect(svc.findPendingOwnershipClaim('DP2608170001')).resolves.toBeNull();
    });

    it('认领单已提交（SUBMITTED，客户已交、等裁决）→ null：不能重复交', async () => {
      const { svc, requests } = build();
      requests.listLiveByOrder.mockResolvedValue([live({ status: 'SUBMITTED' })]);

      await expect(svc.findPendingOwnershipClaim('DP2608170001')).resolves.toBeNull();
    });

    it('该单没有任何活行 → null', async () => {
      const { svc } = build();
      await expect(svc.findPendingOwnershipClaim('DP2608170001')).resolves.toBeNull();
    });
  });

  describe('settleOwnershipClaim — mock Sumsub 即时回调：客户提交 → GREEN', () => {
    it('先 markSubmitted（actor=客户本人），再 applyReview(GREEN，actor=SYSTEM，按 externalActionId 定位)', async () => {
      const { svc, requests, review } = build();

      await svc.settleOwnershipClaim(
        { requestNo: 'MRQ-claim', externalActionId: 'FORM-ext-claim' },
        { customerId: 'c1', customerNo: 'CU-1' },
      );

      expect(requests.markSubmitted).toHaveBeenCalledWith('MRQ-claim', {
        actorType: 'CUSTOMER', actorId: 'c1', actorNo: 'CU-1', actorRole: 'CUSTOMER',
      });
      expect(review.applyReview).toHaveBeenCalledWith({
        externalActionId: 'FORM-ext-claim',
        reviewAnswer: 'GREEN',
        actor: { actorType: 'SYSTEM', actorId: 'SYSTEM', actorNo: 'SYSTEM', actorRole: 'SYSTEM' },
      });
      expect(requests.markSubmitted.mock.invocationCallOrder[0])
        .toBeLessThan(review.applyReview.mock.invocationCallOrder[0]);
    });
  });

  describe('hasOutstanding 的两个守卫分支', () => {
    it('充值单不存在 → false，不查材料账', async () => {
      const { svc, prisma, requests } = build();
      prisma.depositTransaction.findUnique.mockResolvedValue(null);

      await expect(svc.hasOutstanding('dep-x')).resolves.toBe(false);
      expect(requests.listLiveByOrder).not.toHaveBeenCalled();
    });

    it('材料账里该单没有任何活行 → false', async () => {
      const { svc } = build();
      await expect(svc.hasOutstanding('dep-1')).resolves.toBe(false);
    });
  });
});

/**
 * 便签挂谁由 tag 决定（业主 2026-08-29 口径，Task A4，spec §2.6(5)）。
 *
 * 与本文件其余用例的 build() 不同：这里不把 issuer.register 桩死成一个写死的
 * 返回值——那样只能证明"issuer.register 被传了哪个参数"，证明不了"客户到底
 * 有没有被便签摁住"。改用真实的 MaterialRequestIssuerService →
 * CustomerRestrictionWorkflowService → CustomerRestrictionsService 全链路，
 * 内存版 Prisma 只替掉纯 I/O 边界（审计 / 事件广播 / Sumsub），落库、幂等查、
 * scope 落表全走生产代码，读回的行是真实业务逻辑跑出来的，不是断言常量。
 */
describe('便签挂谁由 tag 决定', () => {
  const CUSTOMER_ID = 'c-tag-1';
  const DEPOSIT_ID = 'dep-tag-1';

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
    const customer = { id: CUSTOMER_ID, customerNo: 'CUS-TAG-0001', sumsubApplicantId: 'app-tag-1' };
    const deposit = { id: DEPOSIT_ID, depositNo: 'DP2608290099', ownerId: CUSTOMER_ID };

    const prisma: any = {
      depositTransaction: {
        findUnique: jest.fn(async ({ where }: any) => (where.id === deposit.id ? { ...deposit } : null)),
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
        // 认领提交链路（markSubmitted → markReviewed）用到的读/条件写。
        findUnique: jest.fn(async ({ where }: any) => materialRequests.find((r) => matchesWhere(r, where)) ?? null),
        updateMany: jest.fn(async ({ where, data }: any) => {
          const hit = materialRequests.filter((r) => matchesWhere(r, where));
          hit.forEach((r) => Object.assign(r, data));
          return { count: hit.length };
        }),
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

    const requests = new MaterialRequestsService(prisma, audit, {} as any, new MaterialPolicyLoader());
    const restrictionsSvc = new CustomerRestrictionsService(prisma, audit, eventEmitter);
    const restrictionWorkflow = new CustomerRestrictionWorkflowService(prisma, restrictionsSvc, {} as any, audit);
    const issuer = new MaterialRequestIssuerService(prisma, requests, restrictionWorkflow, {} as any, {} as any);
    const review = new MaterialRequestReviewService(prisma, requests, restrictionsSvc, restrictionWorkflow, eventEmitter);
    const svc = new DepositApplicantActionsService(prisma, requests, issuer, review);

    return { svc, prisma, eventEmitter, customerId: customer.id, customerNo: customer.customerNo, depositId: deposit.id, depositNo: deposit.depositNo };
  }

  it('普通 SOF 补料（无 sceneTag）→ 材料请求不带 restrictionNo，客户不受限', async () => {
    const { svc, prisma, customerId, depositId } = buildRealChain();

    await svc.syncApplicantActions(depositId, [{ applicantActionId: 'a', externalActionId: 'e1' }], undefined);

    const row = await prisma.materialRequest.findFirst({ where: { externalActionId: 'e1' } });
    expect(row.restrictionNo).toBeNull();

    const open = await prisma.customerRestriction.count({
      where: { customerId, cause: 'PENDING_DOCUMENT', status: 'OPEN' },
    });
    expect(open).toBe(0);
  });

  it('PEP 补料（sceneTag=PEP_APPLICANT）→ 开客户级便签，scope 含 WITHDRAW+SWAP', async () => {
    const { svc, prisma, depositId } = buildRealChain();

    await svc.syncApplicantActions(depositId, [{ applicantActionId: 'b', externalActionId: 'e2' }], 'PEP_APPLICANT');

    const row = await prisma.materialRequest.findFirst({ where: { externalActionId: 'e2' } });
    expect(row.restrictionNo).not.toBeNull();

    const scopes = await prisma.customerRestriction.findMany({
      where: { restrictionNo: row.restrictionNo },
    });
    expect(scopes.map((s: any) => s.scope).sort()).toEqual(['SWAP', 'WITHDRAW']);
  });

  // OR 表达式的另一半分支（sceneTag === 'PEP_COUNTERPARTY'）——布尔判定不能只
  // 测一半，否则改坏另一半（比如笔误成 'PEP_COUNTERPARTY_X'）不会被任何用例发现。
  it('对手方 PEP 补料（sceneTag=PEP_COUNTERPARTY）→ 同样开客户级便签', async () => {
    const { svc, prisma, depositId } = buildRealChain();

    await svc.syncApplicantActions(depositId, [{ applicantActionId: 'c', externalActionId: 'e3' }], 'PEP_COUNTERPARTY');

    const row = await prisma.materialRequest.findFirst({ where: { externalActionId: 'e3' } });
    expect(row.restrictionNo).not.toBeNull();
  });
});

/**
 * 对手方波二 Task 5：认领提交走的是**真实**材料账全链（registerOwnershipClaim → findPending → settle），
 * 内存版 Prisma 只替掉 I/O 边界。证明两件事，单看桩的实参证明不了：
 *   1) 认领单真的走完 PENDING_SUBMISSION → SUBMITTED → APPROVED（状态机边是生产代码判的）；
 *   2) 广播出去的 MATERIAL_REQUEST_REVIEWED 载荷恰是既有回炉监听（deposit-workflow.onMaterialRequestReviewed）
 *      认的形状——orderDomain='DEPOSIT'、orderRef=depositNo、outcome='APPROVED'。回炉本身（RESUME）由该监听的既有 spec 作证。
 */
describe('认领提交：真实材料账全链', () => {
  const CUSTOMER_ID = 'c-claim-1';
  const DEPOSIT_ID = 'dep-claim-1';

  function matchesWhere(row: any, where: any = {}): boolean {
    return Object.entries(where).every(([key, cond]: [string, any]) => {
      if (cond && typeof cond === 'object' && 'in' in cond) return (cond.in as any[]).includes(row[key]);
      return row[key] === cond;
    });
  }

  function buildChain() {
    const materialRequests: any[] = [];
    const customer = { id: CUSTOMER_ID, customerNo: 'CUS-CLAIM-0001', sumsubApplicantId: 'app-claim-1' };
    const deposit = { id: DEPOSIT_ID, depositNo: 'DP2610220001', ownerId: CUSTOMER_ID };
    const prisma: any = {
      depositTransaction: { findUnique: jest.fn(async () => ({ ...deposit })) },
      customerMain: { findUnique: jest.fn(async () => ({ ...customer })) },
      materialRequest: {
        create: jest.fn(async ({ data }: any) => {
          const row = { restrictionNo: null, ...data };
          materialRequests.push(row);
          return row;
        }),
        findFirst: jest.fn(async ({ where }: any) => materialRequests.find((r) => matchesWhere(r, where)) ?? null),
        findMany: jest.fn(async ({ where }: any) => materialRequests.filter((r) => matchesWhere(r, where))),
        findUnique: jest.fn(async ({ where }: any) => materialRequests.find((r) => matchesWhere(r, where)) ?? null),
        updateMany: jest.fn(async ({ where, data }: any) => {
          const hit = materialRequests.filter((r) => matchesWhere(r, where));
          hit.forEach((r) => Object.assign(r, data));
          return { count: hit.length };
        }),
      },
      $transaction: jest.fn((cb: any) => cb(prisma)),
    };
    const audit = {
      recordSystem: jest.fn().mockResolvedValue(undefined),
      recordByActor: jest.fn().mockResolvedValue(undefined),
    } as any;
    const eventEmitter = { emit: jest.fn() } as any;
    const requests = new MaterialRequestsService(prisma, audit, {} as any, new MaterialPolicyLoader());
    const restrictionsSvc = new CustomerRestrictionsService(prisma, audit, eventEmitter);
    const restrictionWorkflow = new CustomerRestrictionWorkflowService(prisma, restrictionsSvc, {} as any, audit);
    const issuer = new MaterialRequestIssuerService(prisma, requests, restrictionWorkflow, {} as any, {} as any);
    const review = new MaterialRequestReviewService(prisma, requests, restrictionsSvc, restrictionWorkflow, eventEmitter);
    const svc = new DepositApplicantActionsService(prisma, requests, issuer, review);
    return { svc, prisma, audit, eventEmitter, materialRequests, deposit };
  }

  it('挂起登记 → 找到未决认领单 → 提交并即时通过：行走到 APPROVED，广播 MATERIAL_REQUEST_REVIEWED(DEPOSIT/depositNo/APPROVED)，审计走材料账既有三条', async () => {
    const { svc, audit, eventEmitter, materialRequests, deposit } = buildChain();
    await svc.registerOwnershipClaim(DEPOSIT_ID);
    expect(materialRequests).toHaveLength(1);
    expect(materialRequests[0]).toMatchObject({
      materialType: 'SOURCE_OWNERSHIP_CLAIM', status: 'PENDING_SUBMISSION', orderDomain: 'DEPOSIT', orderRef: deposit.depositNo,
    });

    const claim = await svc.findPendingOwnershipClaim(deposit.depositNo);
    expect(claim).toEqual({ requestNo: materialRequests[0].requestNo, externalActionId: materialRequests[0].externalActionId });

    await svc.settleOwnershipClaim(claim!, { customerId: CUSTOMER_ID, customerNo: 'CUS-CLAIM-0001' });

    expect(materialRequests[0]).toMatchObject({ status: 'APPROVED', reviewAnswer: 'GREEN' });
    expect(eventEmitter.emit).toHaveBeenCalledWith(
      DomainEventNames.MATERIAL_REQUEST_REVIEWED,
      expect.objectContaining({
        requestNo: materialRequests[0].requestNo,
        orderDomain: 'DEPOSIT',
        orderRef: deposit.depositNo,
        outcome: 'APPROVED',
      }),
    );
    // 提交人是客户本人（MATERIAL_REQUEST_SUBMITTED 的 actor），通过由系统落（MATERIAL_REQUEST_APPROVED）
    const submitted = audit.recordByActor.mock.calls.find((c: any[]) => c[0].action === 'MATERIAL_REQUEST_SUBMITTED');
    expect(submitted?.[1]).toMatchObject({ actorType: 'CUSTOMER', actorNo: 'CUS-CLAIM-0001' });
    expect(audit.recordSystem.mock.calls.map((c: any[]) => c[0].action)).toContain('MATERIAL_REQUEST_APPROVED');

    // 提交完这张单就不再是"未决"：同一张认领单不能被第二次提交
    await expect(svc.findPendingOwnershipClaim(deposit.depositNo)).resolves.toBeNull();
  });
});
