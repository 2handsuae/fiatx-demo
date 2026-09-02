import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CaseAgingService } from './case-aging.service';

const ACTOR = { actorType: 'ADMIN', userId: 'uuid-1', userNo: 'ADM010', roleCodes: ['OPS_OFFICER'] } as any;

function build(kase: any) {
  const prisma: any = {
    reconciliationCase: {
      findUnique: jest.fn().mockResolvedValue(kase),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ ...kase, ...data })),
    },
    wallet: { findUnique: jest.fn().mockResolvedValue({ walletNo: 'WA2601017168' }) },
  };
  const audit: any = { recordByActor: jest.fn().mockResolvedValue(undefined) };
  return { svc: new CaseAgingService(prisma, audit), prisma, audit };
}

describe('CaseAgingService（spec §2.3 / §2.4）', () => {
  it('findBreachCandidates 只扫 OPEN + WALLET + 未标记 + 已过线', async () => {
    const { svc, prisma } = build(null);
    const now = new Date('2026-09-05T00:00:00Z');
    await svc.findBreachCandidates(now);
    expect(prisma.reconciliationCase.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { status: 'OPEN', layer: 'WALLET', slaBreached: false, slaDeadline: { lt: now } },
    }));
  });
  it('markBreached 只置标记，不碰 status', async () => {
    const { svc, prisma } = build({ id: 'c1', status: 'OPEN' });
    await svc.markBreached('c1');
    expect(prisma.reconciliationCase.update).toHaveBeenCalledWith({ where: { id: 'c1' }, data: { slaBreached: true } });
  });
  it('⚡拨钟：截止拨到过去 + 操作员审计（显式 requestId、主对象 caseNo、钱包用业务键）', async () => {
    const before = new Date('2026-09-09T23:59:59.999Z');
    const { svc, prisma, audit } = build({ id: 'c1', caseNo: 'REC20260902-007', status: 'OPEN', walletRef: 'w-uuid', slaDeadline: before, traceId: null });
    const r = await svc.simulateTimeout('REC20260902-007', ACTOR);
    const written = prisma.reconciliationCase.update.mock.calls[0][0].data.slaDeadline as Date;
    expect(written.getTime()).toBeLessThan(Date.now());
    expect(r.caseNo).toBe('REC20260902-007');
    const env = audit.recordByActor.mock.calls[0][0];
    expect(env.action).toBe('RECON_AGING_TIMEOUT_SIMULATED');
    expect(env.actionDomain).toBe('RECON');
    expect(env.primarySubjectNo).toBe('REC20260902-007');
    expect(env.requestId).toMatch(/^RECON_AGING_TIMEOUT_SIMULATED_REC20260902-007_/);
    expect(env.subjects).toEqual(expect.arrayContaining([
      expect.objectContaining({ subjectType: 'WALLET', subjectNo: 'WA2601017168' }),
    ]));
    expect(JSON.stringify(env)).not.toContain('w-uuid');
    expect(env.metadata.previousSlaDeadline).toBe(before.toISOString());
  });
  it('⚡拨钟：已结案拒 400；不存在 404', async () => {
    const closed = build({ id: 'c2', caseNo: 'REC-X', status: 'RESOLVED', slaDeadline: new Date() });
    await expect(closed.svc.simulateTimeout('REC-X', ACTOR)).rejects.toThrow(BadRequestException);
    const missing = build(null);
    await expect(missing.svc.simulateTimeout('REC-NOPE', ACTOR)).rejects.toThrow(NotFoundException);
  });
});
