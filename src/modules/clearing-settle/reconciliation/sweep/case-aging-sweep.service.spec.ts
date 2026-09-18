import { CaseAgingSweepService } from './case-aging-sweep.service';

function build(candidates: any[]) {
  const caseAging: any = {
    findBreachCandidates: jest.fn().mockResolvedValue(candidates),
    markBreached: jest.fn().mockResolvedValue(undefined),
    walletNoOf: jest.fn().mockResolvedValue('WA2601017168'),
  };
  const audit: any = { recordSystem: jest.fn().mockResolvedValue(undefined) };
  return { svc: new CaseAgingSweepService(caseAging, audit), caseAging, audit };
}

const CAND = {
  id: 'c1', caseNo: 'REC20260902-007', walletRef: 'w-uuid', bucket: 'BREAK', book: 'FIRM', severity: 'LOW',
  traceId: 'trace-1', slaDeadline: new Date('2026-09-04T23:59:59.999Z'),
};

describe('CaseAgingSweepService（spec §2.1 / §2.8）', () => {
  it('到线：置标记 + 一条系统审计（显式 requestId、ageDays、业务键）', async () => {
    const { svc, caseAging, audit } = build([CAND]);
    const n = await svc.checkAgingBreaches(new Date('2026-09-07T10:00:00Z'));
    expect(n).toBe(1);
    expect(caseAging.markBreached).toHaveBeenCalledWith('c1');
    const env = audit.recordSystem.mock.calls[0][0];
    expect(env.action).toBe('RECON_CASE_AGING_BREACHED');
    expect(env.actionDomain).toBe('RECON');
    expect(env.primarySubjectType).toBe('RECONCILIATION_CASE');
    expect(env.primarySubjectNo).toBe('REC20260902-007');
    expect(env.requestId).toMatch(/^RECON_CASE_AGING_BREACHED_REC20260902-007_/);
    expect(env.metadata).toEqual(expect.objectContaining({ ageDays: 2, bucket: 'BREAK', book: 'FIRM', severity: 'LOW', slaDeadline: '2026-09-04T23:59:59.999Z' }));
    expect(JSON.stringify(env)).not.toContain('w-uuid');
  });
  it('没到线的案子什么都不发生', async () => {
    const { svc, caseAging, audit } = build([]);
    expect(await svc.checkAgingBreaches(new Date())).toBe(0);
    expect(caseAging.markBreached).not.toHaveBeenCalled();
    expect(audit.recordSystem).not.toHaveBeenCalled();
  });
  it('逐案失败不拖垮整轮：第一案抛错，第二案照常处理', async () => {
    const { svc, caseAging } = build([CAND, { ...CAND, id: 'c2', caseNo: 'REC-2' }]);
    caseAging.markBreached.mockRejectedValueOnce(new Error('boom'));
    expect(await svc.checkAgingBreaches(new Date('2026-09-07T10:00:00Z'))).toBe(1);
    expect(caseAging.markBreached).toHaveBeenCalledTimes(2);
  });
});
