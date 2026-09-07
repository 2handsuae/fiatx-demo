import { BadRequestException } from '@nestjs/common';
import { OnboardingWorkflowService } from './onboarding-workflow.service';
import { ONBOARDING_LEVELS } from '../constants/onboarding-level.constant';

const customerRow = (over: Record<string, unknown> = {}) => ({
  id: 'cid', customerNo: 'CU250907001', lifecycle: 'PROSPECT',
  sumsubApplicantId: null, sumsubCurrentLevelName: null,
  onboardingSubmittedAt: null, onboardingFinalRejectedAt: null, eddRequired: false,
  firstName: 'Neo', lastName: 'One', dateOfBirth: null, nationality: null,
  idDocType: null, idDocNumber: null, residentialAddress: null, riskRating: 'LOW',
  ...over,
});

const makeDeps = (row: ReturnType<typeof customerRow>) => {
  const prisma: any = {
    customerMain: { findUnique: jest.fn().mockResolvedValue(row), findFirst: jest.fn().mockResolvedValue(row) },
    approvalCase: { findFirst: jest.fn().mockResolvedValue(null) },
    $transaction: jest.fn((fn: any) => fn(prisma)),
  };
  const lifecycle = { applyAction: jest.fn().mockResolvedValue({ from: row.lifecycle, to: 'IN_VERIFICATION' }) };
  const customers = { updateOnboardingData: jest.fn().mockResolvedValue({}) };
  const sumsub = {
    createApplicant: jest.fn().mockResolvedValue({ id: 'MOCK-CU250907001' }),
    createSdkToken: jest.fn().mockResolvedValue({ token: 'MOCK-SDK-TOKEN-CU250907001' }),
  };
  const approvals = { createAndSubmit: jest.fn().mockResolvedValue({ approvalNo: 'APR0001' }) };
  const audit = { recordByActor: jest.fn().mockResolvedValue(undefined), recordSystem: jest.fn().mockResolvedValue(undefined) };
  return { prisma, lifecycle, customers, sumsub, approvals, audit };
};
const build = (d: ReturnType<typeof makeDeps>) =>
  new OnboardingWorkflowService(d.prisma as any, d.lifecycle as any, d.customers as any, d.sumsub as any, d.approvals as any, d.audit as any);

describe('OnboardingWorkflowService 客户侧旅程', () => {
  it('startVerification: 建 applicant、绑 id + CDD 档、驱 START_VERIFICATION、留痕', async () => {
    const d = makeDeps(customerRow());
    await build(d).startVerification('cid');
    expect(d.sumsub.createApplicant).toHaveBeenCalledWith({ externalUserId: 'CU250907001', levelName: ONBOARDING_LEVELS.CDD });
    expect(d.customers.updateOnboardingData).toHaveBeenCalledWith('cid',
      expect.objectContaining({ sumsubApplicantId: 'MOCK-CU250907001', sumsubCurrentLevelName: ONBOARDING_LEVELS.CDD }), expect.anything());
    expect(d.lifecycle.applyAction).toHaveBeenCalledWith('cid', 'START_VERIFICATION', expect.anything());
    expect(d.audit.recordByActor).toHaveBeenCalled();
  });

  it('startVerification: 已有 applicant 不重建（REAPPLY 续用同一 externalUserId）', async () => {
    const d = makeDeps(customerRow({ sumsubApplicantId: 'MOCK-CU250907001' }));
    await build(d).startVerification('cid');
    expect(d.sumsub.createApplicant).not.toHaveBeenCalled();
  });

  it('getSession: IN_VERIFICATION 未提交 → sdkToken + 模板；已提交 → {submitted:true, sdkToken:null}', async () => {
    const d1 = makeDeps(customerRow({ lifecycle: 'IN_VERIFICATION', sumsubCurrentLevelName: ONBOARDING_LEVELS.CDD }));
    const s1 = await build(d1).getSession('cid');
    expect(s1.submitted).toBe(false);
    expect(s1.sdkToken).toBe('MOCK-SDK-TOKEN-CU250907001');
    expect(s1.template).toEqual({ kind: 'CDD_FORM' });
    const d2 = makeDeps(customerRow({ lifecycle: 'IN_VERIFICATION', sumsubCurrentLevelName: ONBOARDING_LEVELS.CDD, onboardingSubmittedAt: new Date() }));
    const s2 = await build(d2).getSession('cid');
    expect(s2).toMatchObject({ submitted: true, sdkToken: null });
  });

  it('submit(CDD): 五列写入 + submittedAt 落值；缺字段显式拒', async () => {
    const row = customerRow({ lifecycle: 'IN_VERIFICATION', sumsubCurrentLevelName: ONBOARDING_LEVELS.CDD });
    const d = makeDeps(row);
    const dto = { dateOfBirth: '1990-01-02', nationality: 'AE', idDocType: 'PASSPORT', idDocNumber: 'P123', residentialAddress: 'Dubai' };
    await build(d).submit('cid', dto);
    expect(d.customers.updateOnboardingData).toHaveBeenCalledWith('cid',
      expect.objectContaining({ ...dto, onboardingSubmittedAt: expect.any(Date) }), undefined);
    await expect(build(makeDeps(row)).submit('cid', { ...dto, idDocNumber: '' } as any)).rejects.toThrow(BadRequestException);
  });

  it('submit(EDD): 零存储——只落 submittedAt，不写任何材料字段', async () => {
    const d = makeDeps(customerRow({ lifecycle: 'IN_VERIFICATION', sumsubCurrentLevelName: ONBOARDING_LEVELS.EDD }));
    await build(d).submit('cid', {});
    expect(d.customers.updateOnboardingData).toHaveBeenCalledWith('cid', { onboardingSubmittedAt: expect.any(Date) }, undefined);
  });

  it('reapply: 清 submittedAt 并驱 REAPPLY', async () => {
    const d = makeDeps(customerRow({ lifecycle: 'REJECTED' }));
    await build(d).reapply('cid');
    expect(d.lifecycle.applyAction).toHaveBeenCalledWith('cid', 'REAPPLY', expect.anything());
    expect(d.customers.updateOnboardingData).toHaveBeenCalledWith('cid', { onboardingSubmittedAt: null }, expect.anything());
  });
});

describe('OnboardingWorkflowService 裁决与换档（webhook 侧）', () => {
  const inVerif = (over: Record<string, unknown> = {}) => customerRow({
    lifecycle: 'IN_VERIFICATION', sumsubApplicantId: 'MOCK-CU250907001',
    sumsubCurrentLevelName: ONBOARDING_LEVELS.CDD, onboardingSubmittedAt: new Date(), ...over,
  });

  it('CDD GREEN → CDD_CLEARED（直通 ACTIVE）', async () => {
    const d = makeDeps(inVerif());
    await build(d).applyReviewVerdict({ applicantId: 'MOCK-CU250907001', reviewAnswer: 'GREEN', reviewRejectType: 'RETRY' });
    expect(d.lifecycle.applyAction).toHaveBeenCalledWith('cid', 'CDD_CLEARED', expect.anything());
    expect(d.audit.recordSystem).toHaveBeenCalled();
  });

  it('EDD GREEN → VERIFICATION_PASSED（进待准入）', async () => {
    const d = makeDeps(inVerif({ sumsubCurrentLevelName: ONBOARDING_LEVELS.EDD }));
    await build(d).applyReviewVerdict({ applicantId: 'MOCK-CU250907001', reviewAnswer: 'GREEN', reviewRejectType: 'RETRY' });
    expect(d.lifecycle.applyAction).toHaveBeenCalledWith('cid', 'VERIFICATION_PASSED', expect.anything());
  });

  it('RED+FINAL → VERIFICATION_REJECTED 且落 onboardingFinalRejectedAt', async () => {
    const d = makeDeps(inVerif());
    await build(d).applyReviewVerdict({ applicantId: 'MOCK-CU250907001', reviewAnswer: 'RED', reviewRejectType: 'FINAL' });
    expect(d.lifecycle.applyAction).toHaveBeenCalledWith('cid', 'VERIFICATION_REJECTED', expect.anything());
    expect(d.customers.updateOnboardingData).toHaveBeenCalledWith('cid',
      expect.objectContaining({ onboardingFinalRejectedAt: expect.any(Date) }), expect.anything());
  });

  it('未提交先裁决 → 显式拒（非法迁移不静默）', async () => {
    const d = makeDeps(inVerif({ onboardingSubmittedAt: null }));
    await expect(build(d).applyReviewVerdict({ applicantId: 'MOCK-CU250907001', reviewAnswer: 'GREEN', reviewRejectType: 'RETRY' }))
      .rejects.toThrow(BadRequestException);
  });

  it('查无 applicant → 返回 null（落回 unrouted warn，不抛）', async () => {
    const d = makeDeps(inVerif());
    d.prisma.customerMain.findFirst.mockResolvedValue(null);
    expect(await build(d).applyReviewVerdict({ applicantId: 'X', reviewAnswer: 'GREEN', reviewRejectType: 'RETRY' })).toBeNull();
  });

  it('applyLevelChange: eddRequired=true、档名切 EDD、清 submittedAt、状态轴不动', async () => {
    const d = makeDeps(inVerif());
    await build(d).applyLevelChange({ applicantId: 'MOCK-CU250907001' });
    expect(d.customers.updateOnboardingData).toHaveBeenCalledWith('cid',
      { eddRequired: true, sumsubCurrentLevelName: ONBOARDING_LEVELS.EDD, onboardingSubmittedAt: null }, undefined);
    expect(d.lifecycle.applyAction).not.toHaveBeenCalled();
  });

  it('applyLevelChange: 非 CDD 档或未提交 → 显式拒', async () => {
    await expect(build(makeDeps(inVerif({ sumsubCurrentLevelName: ONBOARDING_LEVELS.EDD }))).applyLevelChange({ applicantId: 'MOCK-CU250907001' }))
      .rejects.toThrow(BadRequestException);
    await expect(build(makeDeps(inVerif({ onboardingSubmittedAt: null }))).applyLevelChange({ applicantId: 'MOCK-CU250907001' }))
      .rejects.toThrow(BadRequestException);
  });
});
