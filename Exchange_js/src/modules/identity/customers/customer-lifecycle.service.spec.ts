import { BadRequestException } from '@nestjs/common';
import { CustomerLifecycleService } from './customer-lifecycle.service';

const makePrisma = (row: Record<string, unknown>) => ({
  customerMain: {
    findUnique: jest.fn().mockResolvedValue(row),
    update: jest.fn().mockResolvedValue({}),
  },
});

describe('CustomerLifecycleService.applyAction', () => {
  it('CDD_CLEARED: IN_VERIFICATION → ACTIVE，首次落 onboardingApprovedAt', async () => {
    const prisma = makePrisma({ lifecycle: 'IN_VERIFICATION', onboardingApprovedAt: null, onboardingFinalRejectedAt: null });
    const svc = new CustomerLifecycleService(prisma as any);
    const r = await svc.applyAction('cid', 'CDD_CLEARED');
    expect(r).toEqual({ from: 'IN_VERIFICATION', to: 'ACTIVE' });
    const data = prisma.customerMain.update.mock.calls[0][0].data;
    expect(data.lifecycle).toBe('ACTIVE');
    expect(data.onboardingApprovedAt).toBeInstanceOf(Date);
  });

  it('已有 onboardingApprovedAt 时进 ACTIVE 不覆盖（新客窗口只开一次）', async () => {
    const seeded = new Date('2026-06-15T09:00:00Z');
    const prisma = makePrisma({ lifecycle: 'PENDING_APPROVAL', onboardingApprovedAt: seeded, onboardingFinalRejectedAt: null });
    const svc = new CustomerLifecycleService(prisma as any);
    await svc.applyAction('cid', 'FINAL_APPROVED');
    const data = prisma.customerMain.update.mock.calls[0][0].data;
    expect(data.onboardingApprovedAt).toBeUndefined();
  });

  it('REAPPLY 被 onboardingFinalRejectedAt 堵死', async () => {
    const prisma = makePrisma({ lifecycle: 'REJECTED', onboardingApprovedAt: null, onboardingFinalRejectedAt: new Date() });
    const svc = new CustomerLifecycleService(prisma as any);
    await expect(svc.applyAction('cid', 'REAPPLY')).rejects.toThrow(BadRequestException);
    expect(prisma.customerMain.update).not.toHaveBeenCalled();
  });

  it('非法边显式抛（PROSPECT + FINAL_APPROVED）', async () => {
    const prisma = makePrisma({ lifecycle: 'PROSPECT', onboardingApprovedAt: null, onboardingFinalRejectedAt: null });
    const svc = new CustomerLifecycleService(prisma as any);
    await expect(svc.applyAction('cid', 'FINAL_APPROVED')).rejects.toThrow(BadRequestException);
  });
});
