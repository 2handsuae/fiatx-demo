import { CustomerTagService } from './customer-tag.service';

describe('CustomerTagService', () => {
  let service: CustomerTagService; let prisma: any; let audit: any;
  const now = new Date('2026-07-12T00:00:00Z');
  const actor = { actorType: 'ADMIN', userId: 'u1', roleCodes: ['SUPER_ADMIN'] } as any;
  beforeEach(() => {
    prisma = {
      customerMain: { findUnique: jest.fn() },
      customerExplicitTag: { findMany: jest.fn(), upsert: jest.fn(), delete: jest.fn() },
    };
    audit = { recordByActor: jest.fn().mockResolvedValue(undefined) };
    service = new CustomerTagService(prisma, audit);
  });

  it('assign STATIC → upsert 写表 + 审计 CUSTOMER_TAG_ASSIGNED', async () => {
    prisma.customerMain.findUnique.mockResolvedValue({ customerNo: 'C-001' });
    prisma.customerExplicitTag.upsert.mockResolvedValue({ id: 't1' });
    await service.assign('cust1', 'WHITELIST_PILOT', actor);
    expect(prisma.customerExplicitTag.upsert).toHaveBeenCalled();
    expect(audit.recordByActor).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'CUSTOMER_TAG_ASSIGNED' }), expect.anything());
  });
  it('assign DERIVED(NEW_CUSTOMER) → 抛错（不可手打）', async () => {
    await expect(service.assign('cust1', 'NEW_CUSTOMER', actor)).rejects.toThrow();
  });
  it('assign 未注册 tag → 抛错', async () => {
    await expect(service.assign('cust1', 'TYPO', actor)).rejects.toThrow();
  });
  it('revoke STATIC → delete + 审计 CUSTOMER_TAG_REVOKED', async () => {
    prisma.customerMain.findUnique.mockResolvedValue({ customerNo: 'C-001' });
    prisma.customerExplicitTag.delete.mockResolvedValue({ id: 't1' });
    await service.revoke('cust1', 'WHITELIST_PILOT', 'pilot ended', actor);
    expect(prisma.customerExplicitTag.delete).toHaveBeenCalled();
    expect(audit.recordByActor).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'CUSTOMER_TAG_REVOKED', reason: 'pilot ended' }), expect.anything());
  });
  it('revoke 缺 reason → 抛错', async () => {
    prisma.customerMain.findUnique.mockResolvedValue({ customerNo: 'C-001' });
    await expect(service.revoke('cust1', 'WHITELIST_PILOT', '', actor)).rejects.toThrow();
  });
  it('effectiveTags: 显式 WHITELIST_PILOT + PREMIUM + 注册10天前 → {WHITELIST_PILOT,VIP,NEW_CUSTOMER}', async () => {
    prisma.customerExplicitTag.findMany.mockResolvedValue([{ tagCode: 'WHITELIST_PILOT' }]);
    prisma.customerMain.findUnique.mockResolvedValue({ tradingTier: 'PREMIUM', onboardingApprovedAt: new Date('2026-07-02T00:00:00Z') });
    const tags = await service.effectiveTags('cust1', now);
    expect([...tags].sort()).toEqual(['NEW_CUSTOMER', 'VIP', 'WHITELIST_PILOT']);
  });
  it('effectiveTags: BASIC + 注册40天前 → 不含 VIP/NEW_CUSTOMER', async () => {
    prisma.customerExplicitTag.findMany.mockResolvedValue([]);
    prisma.customerMain.findUnique.mockResolvedValue({ tradingTier: 'BASIC', onboardingApprovedAt: new Date('2026-06-01T00:00:00Z') });
    const tags = await service.effectiveTags('cust1', now);
    expect(tags.has('VIP')).toBe(false);
    expect(tags.has('NEW_CUSTOMER')).toBe(false);
  });
});
