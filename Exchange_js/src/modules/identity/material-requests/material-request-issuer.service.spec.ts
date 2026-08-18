import { BadRequestException, NotFoundException } from '@nestjs/common';
import { MaterialRequestIssuerService } from './material-request-issuer.service';

const ACTOR = { actorType: 'ADMIN' as const, userId: 'u1', userNo: 'ADM001', role: 'MLRO', roleCodes: ['MLRO'] };

function deps(over: Record<string, any> = {}) {
  const prisma = {
    customerMain: {
      findFirst: jest.fn().mockResolvedValue({
        id: 'c1', customerNo: 'CUS-001', sumsubApplicantId: 'app-1',
      }),
    },
    $transaction: jest.fn((cb: any) => cb({ __tx: true })),
  } as any;
  const requests = {
    create: jest.fn().mockResolvedValue({ requestNo: 'MRQ2608170001', customerId: 'c1' }),
    attachRestriction: jest.fn().mockResolvedValue(undefined),
  } as any;
  const restrictionWorkflow = {
    openRestriction: jest.fn().mockResolvedValue({ restrictionNo: 'RST2608170001', created: true }),
  } as any;
  const sumsub = {
    createApplicantAction: jest.fn().mockResolvedValue({ id: 'mock-action-xyz' }),
  } as any;
  const policy = {
    getMaterialConfig: jest.fn().mockReturnValue({
      sumsubActionLevelName: 'wave3-action-poa-refresh',
      enforceRestriction: true,
      managementMode: 'SELF_MANAGED',
      requiredForLevels: [],
    }),
  } as any;
  return { prisma, requests, restrictionWorkflow, sumsub, policy, ...over };
}

function build(d: ReturnType<typeof deps>) {
  return new MaterialRequestIssuerService(d.prisma, d.requests, d.restrictionWorkflow, d.sumsub, d.policy);
}

const BASE = {
  customerId: 'c1', materialType: 'PROOF_OF_ADDRESS',
  orderDomain: null, orderRef: null, restrict: false,
  origin: 'OPERATOR_ISSUED' as const, reason: 'need PoA', issuedBy: 'ADM001', actor: ACTOR,
};

describe('MaterialRequestIssuerService.issue', () => {
  it('levelName 由注册表推导，不由调用方手打', async () => {
    const d = deps();
    await build(d).issue(BASE);
    expect(d.policy.getMaterialConfig).toHaveBeenCalledWith('PROOF_OF_ADDRESS');
    expect(d.requests.create.mock.calls[0][0].levelName).toBe('wave3-action-poa-refresh');
  });

  it('建 action 时把我方 externalActionId 传给 Sumsub（修 spec §1.3②）', async () => {
    const d = deps();
    await build(d).issue(BASE);
    const passed = d.sumsub.createApplicantAction.mock.calls[0][0];
    expect(passed.externalActionId).toEqual(expect.any(String));
    expect(passed.externalActionId.length).toBeGreaterThan(0);
    // 传给 Sumsub 的那个 id 与落库的必须是同一个，否则铸不出 token
    expect(d.requests.create.mock.calls[0][0].externalActionId).toBe(passed.externalActionId);
  });

  it('落库的 applicantActionId 用 Sumsub 返回的 id', async () => {
    const d = deps();
    await build(d).issue(BASE);
    expect(d.requests.create.mock.calls[0][0].applicantActionId).toBe('mock-action-xyz');
  });

  it('restrict=false 时不开便签，返回 restrictionNo=null', async () => {
    const d = deps();
    const out = await build(d).issue(BASE);
    expect(d.restrictionWorkflow.openRestriction).not.toHaveBeenCalled();
    expect(out.restrictionNo).toBeNull();
  });

  it('restrict=true 时开便签，caseRef 用 requestNo（autoRelease 靠它找便签）', async () => {
    const d = deps();
    const out = await build(d).issue({ ...BASE, restrict: true, restrictScopes: ['WITHDRAW'] });
    const opened = d.restrictionWorkflow.openRestriction.mock.calls[0][0];
    expect(opened.cause).toBe('PENDING_DOCUMENT');
    expect(opened.caseRef).toBe('MRQ2608170001');
    expect(opened.scopes).toEqual(['WITHDRAW']);
    expect(out.restrictionNo).toBe('RST2608170001');
    expect(d.requests.attachRestriction).toHaveBeenCalledWith(
      'MRQ2608170001', 'RST2608170001', expect.anything(),
    );
  });

  it('G4：restrictCause 传 SILENT 类 → BadRequest，绝不落地', async () => {
    const d = deps();
    await expect(
      build(d).issue({ ...BASE, restrict: true, restrictCause: 'SANCTION' as any }),
    ).rejects.toThrow(BadRequestException);
    expect(d.sumsub.createApplicantAction).not.toHaveBeenCalled();
    expect(d.requests.create).not.toHaveBeenCalled();
  });

  it('未知 materialType → BadRequest（注册表说了算）', async () => {
    const d = deps();
    d.policy.getMaterialConfig.mockReturnValue(null);
    await expect(build(d).issue({ ...BASE, materialType: 'NOPE' })).rejects.toThrow(BadRequestException);
  });

  it('客户没有 sumsubApplicantId → BadRequest（没 applicant 就没法建 action）', async () => {
    const d = deps();
    d.prisma.customerMain.findFirst.mockResolvedValue({ id: 'c1', customerNo: 'CUS-001', sumsubApplicantId: null });
    await expect(build(d).issue(BASE)).rejects.toThrow(BadRequestException);
  });

  it('客户不存在 → NotFound', async () => {
    const d = deps();
    d.prisma.customerMain.findFirst.mockResolvedValue(null);
    await expect(build(d).issue(BASE)).rejects.toThrow(NotFoundException);
  });

  it('落行与开便签同处一个事务（半成品状态是运营看不懂的脏数据）', async () => {
    const d = deps();
    await build(d).issue({ ...BASE, restrict: true });
    expect(d.prisma.$transaction).toHaveBeenCalledTimes(1);
    // 光断言 $transaction 被调用一次测不出「贴便签是不是真在这个事务里跑」——
    // openRestriction 收到的 tx 必须与 requests.create 收到的是同一个引用，
    // 否则贴便签实际是在一个独立的第二事务里提交的（本条曾是假阳性）。
    const txPassedToCreate = d.requests.create.mock.calls[0][1];
    const txPassedToOpenRestriction = d.restrictionWorkflow.openRestriction.mock.calls[0][2];
    expect(txPassedToOpenRestriction).toBeDefined();
    expect(txPassedToOpenRestriction).toBe(txPassedToCreate);
  });
});

describe('MaterialRequestIssuerService.register（路径 1：Sumsub 已建好 action）', () => {
  it('不再调 createApplicantAction，直接登记两个 id', async () => {
    const d = deps();
    await build(d).register({
      customerId: 'c1', sumsubApplicantId: 'app-1', materialType: 'SOURCE_OF_FUNDS',
      levelName: 'wave3-action-sof-refresh',
      applicantActionId: 'sumsub-act-9', externalActionId: 'sumsub-ext-9',
      orderDomain: 'DEPOSIT', orderRef: 'DP2608170001',
      origin: 'SUMSUB_PUSHED', reason: 'KYT requires SoF', issuedBy: 'SYSTEM',
      restrict: false, actor: ACTOR,
    });
    expect(d.sumsub.createApplicantAction).not.toHaveBeenCalled();
    expect(d.requests.create.mock.calls[0][0]).toMatchObject({
      applicantActionId: 'sumsub-act-9',
      externalActionId: 'sumsub-ext-9',
      orderDomain: 'DEPOSIT',
      orderRef: 'DP2608170001',
      origin: 'SUMSUB_PUSHED',
    });
  });

  // ── existingRestrictionNo (2026-08-18 fix) ──────────────────────────────
  // 修一条 Critical：兑换域软线拒时便签已经在调用方 open() 过了
  // （restrict:false 表示「不要再开一张」），但旧的 register() 没有任何字段能
  // 把那张已开好的便签接进新建行 —— restrictionNo 恒为 null，GREEN 复核时
  // autoRelease 永远不会被调用，客户交齐材料后限制原地不动、永久卡死。
  const REGISTER_BASE = {
    customerId: 'c1', sumsubApplicantId: 'app-1', materialType: 'SOURCE_OF_FUNDS',
    levelName: 'wave3-action-sof-refresh',
    applicantActionId: 'sumsub-act-9', externalActionId: 'sumsub-ext-9',
    orderDomain: 'SWAP' as const, orderRef: 'SWP0001',
    origin: 'SUMSUB_PUSHED' as const, reason: 'KYT rejected — additional materials required',
    issuedBy: 'SYSTEM', actor: ACTOR,
  };

  it('existingRestrictionNo 传入时：不新开便签（openRestriction 不调用），直接把它贴到新建行上，返回值也带出来', async () => {
    const d = deps();
    const out = await build(d).register({
      ...REGISTER_BASE, restrict: false, existingRestrictionNo: 'RST2608160001',
    });
    expect(d.restrictionWorkflow.openRestriction).not.toHaveBeenCalled();
    expect(d.requests.attachRestriction).toHaveBeenCalledWith(
      'MRQ2608170001', 'RST2608160001', expect.anything(),
    );
    expect(out.restrictionNo).toBe('RST2608160001');
  });

  it('existingRestrictionNo 与 restrict:true 同传 → BadRequest（一次下发只该对应一张便签）', async () => {
    const d = deps();
    await expect(
      build(d).register({
        ...REGISTER_BASE, restrict: true, restrictCause: 'PENDING_DOCUMENT',
        existingRestrictionNo: 'RST2608160001',
      }),
    ).rejects.toThrow(BadRequestException);
    expect(d.requests.create).not.toHaveBeenCalled();
    expect(d.restrictionWorkflow.openRestriction).not.toHaveBeenCalled();
  });

  // ── 接线侧（跨两头）：register() 用真实 MaterialRequestsService（真实
  // attachRestriction 落库逻辑，不是手搓 mock），登记完之后用 findByNo 读回
  // 该行，证明 restrictionNo 真的写进了数据行 —— 这正是本次漏网的接线点：
  // 写入侧测过、复核侧（material-request-review.service.spec.ts）也测过，
  // 唯独两头之间"这一行的 restrictionNo 列到底有没有被写"从未被断言过。
  it('接线侧：register(existingRestrictionNo) 之后，用 findByNo 读回该行，restrictionNo 等于传入值', async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { MaterialRequestsService } = require('./material-requests.service');
    let stored: any = null;
    const prisma = {
      customerMain: { findFirst: jest.fn().mockResolvedValue({ id: 'c1', customerNo: 'CUS-001', sumsubApplicantId: 'app-1' }) },
      materialRequest: {
        create: jest.fn(async ({ data }: any) => {
          stored = { id: 'r1', ...data };
          return stored;
        }),
        findUnique: jest.fn(async () => stored),
        update: jest.fn(async ({ data }: any) => {
          stored = { ...stored, ...data };
          return stored;
        }),
      },
      $transaction: jest.fn((cb: any) => cb(prisma)),
    } as any;
    const auditLogsService = { recordSystem: jest.fn().mockResolvedValue(undefined) } as any;
    const sumsubClient = {} as any;
    const requests = new MaterialRequestsService(prisma, auditLogsService, sumsubClient);

    const restrictionWorkflow = { openRestriction: jest.fn() } as any;
    const policy = { getMaterialConfig: jest.fn().mockReturnValue({ sumsubActionLevelName: 'wave3-action-sof-refresh' }) } as any;
    const issuer = new MaterialRequestIssuerService(prisma, requests, restrictionWorkflow, sumsubClient, policy);

    const out = await issuer.register({ ...REGISTER_BASE, restrict: false, existingRestrictionNo: 'RST-1' });

    expect(restrictionWorkflow.openRestriction).not.toHaveBeenCalled();
    expect(out.restrictionNo).toBe('RST-1');

    const row = await requests.findByNo(out.requestNo);
    expect(row?.restrictionNo).toBe('RST-1');
  });
});
