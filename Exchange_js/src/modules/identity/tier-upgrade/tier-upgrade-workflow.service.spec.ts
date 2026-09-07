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
