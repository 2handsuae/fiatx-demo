import { BadRequestException } from '@nestjs/common';
import { TierUpgradeWorkflowService } from './tier-upgrade-workflow.service';
import { ONBOARDING_LEVELS } from '../constants/onboarding-level.constant';

const customerRow = (over: Record<string, unknown> = {}) => ({
  id: 'cid', customerNo: 'CU250907001', lifecycle: 'ACTIVE', tradingTier: 'BASIC',
  riskRating: 'LOW', sumsubApplicantId: 'MOCK-CU250907001',
  sumsubCurrentLevelName: ONBOARDING_LEVELS.CDD, ...over,
});
const appRow = (over: Record<string, unknown> = {}) => ({
  id: 'tid', upgradeNo: 'TUP250907XXXX', customerId: 'cid', status: 'IN_REVIEW',
  fromTier: 'BASIC', toTier: 'PREMIUM', materialsSubmittedAt: null, decidedAt: null, ...over,
});
const makeDeps = (row = customerRow(), app: any = null) => {
  const prisma: any = {
    customerMain: { findUnique: jest.fn().mockResolvedValue(row), findFirst: jest.fn().mockResolvedValue(row), update: jest.fn() },
    tierUpgradeApplication: {
      findFirst: jest.fn().mockResolvedValue(app),
      create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ ...appRow(), ...data })),
      update: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ ...appRow(), ...data })),
    },
    transactionLimitRule: { findMany: jest.fn().mockResolvedValue([
      { operationType: 'SWAP', period: 'DAILY', tradingTier: 'BASIC', defaultLimit: '100000' },
      { operationType: 'SWAP', period: 'DAILY', tradingTier: 'PREMIUM', defaultLimit: '1000000' },
    ]) },
    approvalCase: { findFirst: jest.fn().mockResolvedValue(null) },
    $transaction: jest.fn((fn: any) => fn(prisma)),
  };
  const customers = { updateOnboardingData: jest.fn().mockResolvedValue({}), applyTierUpgrade: jest.fn().mockResolvedValue({ fromTier: 'BASIC', toTier: 'PREMIUM' }) };
  const sumsub = { changeLevel: jest.fn().mockResolvedValue({}), createSdkToken: jest.fn().mockResolvedValue({ token: 'MOCK-SDK-TOKEN' }), createApplicant: jest.fn().mockResolvedValue({ id: 'MOCK-NEW' }) };
  const approvals = { createAndSubmit: jest.fn().mockResolvedValue({ approvalNo: 'APR0002' }) };
  const audit = { recordByActor: jest.fn(), recordSystem: jest.fn() };
  return { prisma, customers, sumsub, approvals, audit };
};
const build = (d: ReturnType<typeof makeDeps>) =>
  new TierUpgradeWorkflowService(d.prisma as any, d.customers as any, d.sumsub as any, d.approvals as any, d.audit as any);

describe('TierUpgradeWorkflowService 申请侧', () => {
  it('apply: 建单(IN_REVIEW,BASIC→PREMIUM) + applicant 换 PREMIUM 档 + 客户 actor 留痕', async () => {
    const d = makeDeps();
    const r = await build(d).apply('cid');
    expect(r.upgradeNo).toMatch(/^TUP/);
    expect(d.sumsub.changeLevel).toHaveBeenCalledWith('MOCK-CU250907001', ONBOARDING_LEVELS.PREMIUM);
    expect(d.customers.updateOnboardingData).toHaveBeenCalledWith('cid',
      expect.objectContaining({ sumsubCurrentLevelName: ONBOARDING_LEVELS.PREMIUM }), expect.anything());
    expect(d.audit.recordByActor.mock.calls[0][0].action).toBe('TIER_UPGRADE_APPLIED');
  });
  it('守卫：非 ACTIVE / 非 BASIC / 已有在途单 → 各显式拒', async () => {
    await expect(build(makeDeps(customerRow({ lifecycle: 'IN_VERIFICATION' }))).apply('cid')).rejects.toThrow(BadRequestException);
    await expect(build(makeDeps(customerRow({ tradingTier: 'PREMIUM' }))).apply('cid')).rejects.toThrow(BadRequestException);
    await expect(build(makeDeps(customerRow(), appRow())).apply('cid')).rejects.toThrow(BadRequestException);
  });
  it('getOverview: 两档限额并排 + stage 派生（IN_REVIEW 未交=SUBMIT_MATERIALS，已交=UNDER_REVIEW）', async () => {
    const o1 = await build(makeDeps(customerRow(), appRow())).getOverview('cid');
    expect(o1.application).toEqual({ upgradeNo: 'TUP250907XXXX', stage: 'SUBMIT_MATERIALS' });
    expect(o1.limits).toEqual([{ operationType: 'SWAP', period: 'DAILY', basicLimit: '100000', premiumLimit: '1000000' }]);
    expect(o1.canApply).toBe(false);
    const o2 = await build(makeDeps(customerRow(), appRow({ materialsSubmittedAt: new Date() }))).getOverview('cid');
    expect(o2.application!.stage).toBe('UNDER_REVIEW');
  });
  it('submitMaterials: 落 materialsSubmittedAt + TIER_UPGRADE_SUBMITTED；无在途单/已交 → 显式拒', async () => {
    const d = makeDeps(customerRow(), appRow());
    await build(d).submitMaterials('cid');
    expect(d.prisma.tierUpgradeApplication.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ materialsSubmittedAt: expect.any(Date) }) }));
    await expect(build(makeDeps(customerRow(), null)).submitMaterials('cid')).rejects.toThrow(BadRequestException);
    await expect(build(makeDeps(customerRow(), appRow({ materialsSubmittedAt: new Date() }))).submitMaterials('cid')).rejects.toThrow(BadRequestException);
  });
});

describe('TierUpgradeWorkflowService 裁决路径（webhook 侧）', () => {
  const submitted = () => appRow({ materialsSubmittedAt: new Date() });

  it('GREEN → IN_REVIEW 沿边 MATERIALS_CLEARED + VERDICT_APPLIED 带 fromStatus/toStatus', async () => {
    const d = makeDeps(customerRow(), submitted());
    const r = await build(d).applyReviewVerdict({ applicantId: 'MOCK-CU250907001', reviewAnswer: 'GREEN', reviewRejectType: 'RETRY' });
    expect(r).toMatchObject({ customerNo: 'CU250907001', to: 'MATERIALS_CLEARED' });
    expect(d.prisma.tierUpgradeApplication.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'MATERIALS_CLEARED' }) }));
    const audited = d.audit.recordSystem.mock.calls.find(([p]: any[]) => p.action === 'TIER_UPGRADE_VERDICT_APPLIED');
    expect(audited[0].afterData).toMatchObject({ fromStatus: 'IN_REVIEW', toStatus: 'MATERIALS_CLEARED', reviewAnswer: 'GREEN' });
  });

  it('RED+RETRY → 不迁移，清 materialsSubmittedAt 重开会话（spec §4 承接波二先例）', async () => {
    const d = makeDeps(customerRow(), submitted());
    const r = await build(d).applyReviewVerdict({ applicantId: 'MOCK-CU250907001', reviewAnswer: 'RED', reviewRejectType: 'RETRY' });
    expect(r!.to).toBe('IN_REVIEW');
    expect(d.prisma.tierUpgradeApplication.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ materialsSubmittedAt: null }) }));
  });

  it('RED+FINAL → REJECTED + decidedAt；客户 lifecycle 全程不碰', async () => {
    const d = makeDeps(customerRow(), submitted());
    const r = await build(d).applyReviewVerdict({ applicantId: 'MOCK-CU250907001', reviewAnswer: 'RED', reviewRejectType: 'FINAL' });
    expect(r!.to).toBe('REJECTED');
    expect(d.prisma.customerMain.update).not.toHaveBeenCalled();
  });

  it('无在审升级单 → 返回 null（落回入驻线，两线隔离）', async () => {
    const d = makeDeps(customerRow(), null);
    expect(await build(d).applyReviewVerdict({ applicantId: 'MOCK-CU250907001', reviewAnswer: 'GREEN', reviewRejectType: 'RETRY' })).toBeNull();
  });

  it('未提交先裁决 → 显式拒（非法迁移不静默）', async () => {
    const d = makeDeps(customerRow(), appRow()); // materialsSubmittedAt: null
    await expect(build(d).applyReviewVerdict({ applicantId: 'MOCK-CU250907001', reviewAnswer: 'GREEN', reviewRejectType: 'RETRY' }))
      .rejects.toThrow(BadRequestException);
  });
});

describe('TierUpgradeWorkflowService 审批路径', () => {
  const cleared = () => appRow({ status: 'MATERIALS_CLEARED', materialsSubmittedAt: new Date() });

  it('submitAcceptance: MATERIALS_CLEARED 才可提；开单走正门并留痕带 approvalNo', async () => {
    const d = makeDeps(customerRow(), cleared());
    const r = await build(d).submitAcceptance('CU250907001', 'limits raise', { actorType: 'ADMIN', userNo: 'OP01', roleCodes: ['OPS_OFFICER'] } as any);
    expect(r.approvalNo).toBe('APR0002');
    const snap = d.approvals.createAndSubmit.mock.calls[0][0];
    expect(snap).toMatchObject({ actionType: 'CUSTOMER_TIER_UPGRADE', entityRef: 'CU250907001' });
    expect(snap.objectSnapshot).toMatchObject({ upgradeNo: 'TUP250907XXXX', fromTier: 'BASIC', toTier: 'PREMIUM' });
    await expect(build(makeDeps(customerRow(), appRow())).submitAcceptance('CU250907001', 'x', {} as any)).rejects.toThrow(BadRequestException);
  });

  it('已有在批单 → 显式拒（不重复开单）', async () => {
    const d = makeDeps(customerRow(), cleared());
    d.prisma.approvalCase.findFirst.mockResolvedValue({ approvalNo: 'APR0001', status: 'PENDING' });
    await expect(build(d).submitAcceptance('CU250907001', 'x', {} as any)).rejects.toThrow(/APR0001/);
  });

  it('onAcceptanceDecided APPROVED → 申请单沿边 APPROVED + 档位写口同事务调用 + 留痕', async () => {
    const d = makeDeps(customerRow(), cleared());
    await build(d).onAcceptanceDecided({ decision: 'APPROVED', entityRef: 'CU250907001', approvalNo: 'APR0002', decisionByUserNo: 'SM01' } as any);
    expect(d.customers.applyTierUpgrade).toHaveBeenCalledWith('cid', expect.anything());
    expect(d.prisma.tierUpgradeApplication.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'APPROVED', decidedAt: expect.any(Date) }) }));
    expect(d.prisma.$transaction).toHaveBeenCalledTimes(1);
    const audited = d.audit.recordByActor.mock.calls.find(([p]: any[]) => p.action === 'TIER_UPGRADE_ACCEPTANCE_DECIDED');
    expect(audited[0].afterData).toMatchObject({ decision: 'APPROVED', beforeTier: 'BASIC', afterTier: 'PREMIUM', fromStatus: 'MATERIALS_CLEARED', toStatus: 'APPROVED' });
  });

  it('DECLINED → REJECTED，档位不动、lifecycle 不碰', async () => {
    const d = makeDeps(customerRow(), cleared());
    await build(d).onAcceptanceDecided({ decision: 'DECLINED', entityRef: 'CU250907001', approvalNo: 'APR0002' } as any);
    expect(d.customers.applyTierUpgrade).not.toHaveBeenCalled();
    expect(d.prisma.tierUpgradeApplication.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'REJECTED' }) }));
  });
});
