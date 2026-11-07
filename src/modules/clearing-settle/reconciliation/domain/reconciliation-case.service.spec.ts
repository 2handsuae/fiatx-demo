import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ReconciliationCaseService } from './reconciliation-case.service';

const makeDeps = () => {
  const reconciliationCase = {
    count: jest.fn().mockResolvedValue(41),
    create: jest.fn().mockImplementation(async ({ data }: any) => ({ id: 'case-uuid-1', ...data })),
    update: jest.fn().mockResolvedValue({}),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
  };
  const wallet = { findUnique: jest.fn().mockResolvedValue({ walletNo: 'WA2601017168' }) };
  const prisma: any = { reconciliationCase, wallet };
  const auditLogs: any = { recordSystem: jest.fn().mockResolvedValue(undefined), recordByActor: jest.fn().mockResolvedValue(undefined) };
  return { prisma, auditLogs, reconciliationCase };
};
const ACTOR = { actorType: 'ADMIN', userId: 'uuid-1', userNo: 'ADM010', roleCodes: ['TREASURY_OFFICER'] } as any;
const dec = (s: string) => new Prisma.Decimal(s);
const openInput = (deps?: Partial<any>) => ({
  runId: 'run-1', businessDate: '2026-09-20', assetId: 'a1', assetCode: 'AED', layer: 'WALLET',
  book: 'CLIENT', walletRef: 'w-1', coaCode: '1101', ownerNo: 'CUS001',
  tbAmount: dec('100'), inTransitAmount: dec('0'), expectedExternal: dec('90'),
  actualExternal: dec('90'), deltaAmount: dec('-10'), internalDeltaAmount: dec('70') as Prisma.Decimal | null,
  severity: 'LOW', bucket: 'BREAK' as const, slaDeadline: new Date('2026-09-23T20:00:00Z'),
  traceId: 'trace-run', delta: -10n, internalDelta: 70n as bigint | null, caseReason: 'wallet_balance_and_flow_break', ...deps,
});

describe('ReconciliationCaseService（波三判据 4）', () => {
  it('openCase：按 businessDate 序号铸 caseNo，状态落 OPEN，发 RECON_CASE_OPENED', async () => {
    const d = makeDeps();
    const svc = new ReconciliationCaseService(d.prisma, d.auditLogs);
    const out = await svc.openCase(openInput());
    expect(out.caseNo).toBe('REC20260920-042');                       // count=41 → 042：服务算的，不是回显
    expect(d.reconciliationCase.create.mock.calls[0][0].data.status).toBe('OPEN');
    expect(d.reconciliationCase.create.mock.calls[0][0].data.internalDeltaAmount.toString()).toBe('70');   // 戊波二 T9a：对内差额落案件
    const audit = d.auditLogs.recordSystem.mock.calls[0][0];
    expect(audit.action).toBe('RECON_CASE_OPENED');
    expect(audit.metadata.deltaAmount).toBe('-10');                   // bigint→string 是服务干的活
    expect(audit.metadata.walletNo).toBe('WA2601017168');             // 铁律⑥：换业务键，非回显 walletRef
    expect(audit.metadata.walletRef).toBeUndefined();
    expect(JSON.stringify(audit.metadata)).not.toContain('w-1');      // UUID 不落 metadata
    // 戊波二 T10（R35）：对内差额与开案原因进审计——仅对内不平的案子 deltaAmount 是 0，审计里要读得出是账簿不平
    expect(audit.metadata.internalDeltaAmount).toBe('70');
    expect(audit.metadata.caseReason).toBe('wallet_balance_and_flow_break');
  });
  it('openCase：仅对内不平的案子审计带 internalDeltaAmount 与 wallet_internal_imbalance，deltaAmount 仍是 0；公司钱包 internalDeltaAmount 为 null', async () => {
    const d = makeDeps();
    const svc = new ReconciliationCaseService(d.prisma, d.auditLogs);
    await svc.openCase(openInput({ deltaAmount: dec('0'), delta: 0n, internalDeltaAmount: dec('-25000'), internalDelta: -25000n, caseReason: 'wallet_internal_imbalance' }));
    await svc.openCase(openInput({ internalDeltaAmount: null, internalDelta: null, caseReason: 'wallet_balance_mismatch' }));
    const first = d.auditLogs.recordSystem.mock.calls[0][0].metadata;
    expect(first.deltaAmount).toBe('0');
    expect(first.internalDeltaAmount).toBe('-25000');
    expect(first.caseReason).toBe('wallet_internal_imbalance');
    const second = d.auditLogs.recordSystem.mock.calls[1][0].metadata;
    expect(second.internalDeltaAmount).toBeNull();
    expect(second.caseReason).toBe('wallet_balance_mismatch');
  });
  it('reObserve：对内差额跟本轮量到的走（有值落值；公司钱包 / 已归零的案 null 也要写回，不留上一轮的旧值）', async () => {
    const d = makeDeps();
    const svc = new ReconciliationCaseService(d.prisma, d.auditLogs);
    const base = {
      caseId: 'c1', runId: 'run-2', tbAmount: dec('100'), inTransitAmount: dec('0'), expectedExternal: dec('90'),
      actualExternal: dec('90'), deltaAmount: dec('-10'), severity: 'LOW', bucket: 'BREAK' as const,
      assetId: 'a1', assetCode: 'AED', book: 'CLIENT', coaCode: '1101', ownerNo: 'CUS001',
    };
    await svc.reObserve({ ...base, internalDeltaAmount: dec('-30') });
    await svc.reObserve({ ...base, internalDeltaAmount: null });
    expect(d.reconciliationCase.update.mock.calls[0][0].data.internalDeltaAmount.toString()).toBe('-30');
    expect(d.reconciliationCase.update.mock.calls[1][0].data.internalDeltaAmount).toBeNull();
  });
  it('resolveAutoHealed：OPEN → RESOLVED 落 AUTO_HEALED 五字段，发 RECON_CASE_AUTO_HEALED', async () => {
    const d = makeDeps();
    d.reconciliationCase.findUnique.mockResolvedValue({ status: 'OPEN' });
    const svc = new ReconciliationCaseService(d.prisma, d.auditLogs);
    const at = new Date('2026-09-20T12:00:00Z');
    await svc.resolveAutoHealed({ caseId: 'c1', caseNo: 'REC1', walletRef: 'w-1', runId: 'run-2', traceId: null, resolvedAt: at });
    expect(d.reconciliationCase.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: { status: 'RESOLVED', resolutionReason: 'AUTO_HEALED', resolvedAt: at, lastUpdatedRunId: 'run-2', closedByRunId: 'run-2' },
    });
    const audit = d.auditLogs.recordSystem.mock.calls[0][0];
    expect(audit.action).toBe('RECON_CASE_AUTO_HEALED');
    expect(audit.metadata.walletNo).toBe('WA2601017168');             // 铁律⑥：换业务键，非回显 walletRef
    expect(audit.metadata.walletRef).toBeUndefined();
    expect(JSON.stringify(audit.metadata)).not.toContain('w-1');      // UUID 不落 metadata
  });
  it('resolveAutoHealed：已 RESOLVED 的案再 resolve 被显式拒（迁移表真调用）', async () => {
    const d = makeDeps();
    d.reconciliationCase.findUnique.mockResolvedValue({ status: 'RESOLVED' });
    const svc = new ReconciliationCaseService(d.prisma, d.auditLogs);
    await expect(svc.resolveAutoHealed({ caseId: 'c1', caseNo: 'REC1', walletRef: 'w-1', runId: 'run-2', traceId: null, resolvedAt: new Date() }))
      .rejects.toThrow(BadRequestException);
    expect(d.reconciliationCase.update).not.toHaveBeenCalled();
  });
  // 波三 T4：以下三例从 workflow/case-aging.service.spec.ts 原样迁入（markBreached →
  // markSlaBreached / simulateTimeout 随实现搬家），断言语义不变。
  it('markSlaBreached：只置标记，不碰 status', async () => {
    const d = makeDeps();
    const svc = new ReconciliationCaseService(d.prisma, d.auditLogs);
    await svc.markSlaBreached('c1');
    expect(d.reconciliationCase.update).toHaveBeenCalledWith({ where: { id: 'c1' }, data: { slaBreached: true } });
  });
  it('⚡拨钟：截止拨到过去 + 操作员审计（显式 requestId、主对象 caseNo、钱包用业务键）', async () => {
    const before = new Date('2026-09-09T23:59:59.999Z');
    const d = makeDeps();
    d.reconciliationCase.findUnique.mockResolvedValue({ id: 'c1', caseNo: 'REC20260902-007', status: 'OPEN', walletRef: 'w-uuid', slaDeadline: before, traceId: null });
    const svc = new ReconciliationCaseService(d.prisma, d.auditLogs);
    const r = await svc.simulateTimeout('REC20260902-007', ACTOR);
    const written = d.reconciliationCase.update.mock.calls[0][0].data.slaDeadline as Date;
    expect(written.getTime()).toBeLessThan(Date.now());
    expect(r.caseNo).toBe('REC20260902-007');
    const env = d.auditLogs.recordByActor.mock.calls[0][0];
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
    const closed = makeDeps();
    closed.reconciliationCase.findUnique.mockResolvedValue({ id: 'c2', caseNo: 'REC-X', status: 'RESOLVED', slaDeadline: new Date() });
    const closedSvc = new ReconciliationCaseService(closed.prisma, closed.auditLogs);
    await expect(closedSvc.simulateTimeout('REC-X', ACTOR)).rejects.toThrow(BadRequestException);

    const missing = makeDeps();
    missing.reconciliationCase.findUnique.mockResolvedValue(null);
    const missingSvc = new ReconciliationCaseService(missing.prisma, missing.auditLogs);
    await expect(missingSvc.simulateTimeout('REC-NOPE', ACTOR)).rejects.toThrow(NotFoundException);
  });
});
