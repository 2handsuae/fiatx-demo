import { CaseAgingService } from './case-aging.service';

function build() {
  const prisma: any = {
    reconciliationCase: {
      findMany: jest.fn().mockResolvedValue([]),
    },
  };
  return { svc: new CaseAgingService(prisma), prisma };
}

describe('CaseAgingService（spec §2.3）', () => {
  it('findBreachCandidates 只扫 OPEN + WALLET + 未标记 + 已过线', async () => {
    const { svc, prisma } = build();
    const now = new Date('2026-09-05T00:00:00Z');
    await svc.findBreachCandidates(now);
    expect(prisma.reconciliationCase.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { status: 'OPEN', layer: 'WALLET', slaBreached: false, slaDeadline: { lt: now } },
    }));
  });
});
