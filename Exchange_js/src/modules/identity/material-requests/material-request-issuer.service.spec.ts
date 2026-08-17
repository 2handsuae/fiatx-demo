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
});
