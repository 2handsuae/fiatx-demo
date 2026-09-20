import { BadRequestException } from '@nestjs/common';
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
  const prisma: any = { reconciliationCase };
  const auditLogs: any = { recordSystem: jest.fn().mockResolvedValue(undefined), recordByActor: jest.fn().mockResolvedValue(undefined) };
  return { prisma, auditLogs, reconciliationCase };
};
const dec = (s: string) => new Prisma.Decimal(s);
const openInput = (deps?: Partial<any>) => ({
  runId: 'run-1', businessDate: '2026-09-20', assetId: 'a1', assetCode: 'AED', layer: 'WALLET',
  book: 'CLIENT', walletRef: 'w-1', coaCode: '1101', ownerNo: 'CUS001',
  tbAmount: dec('100'), inTransitAmount: dec('0'), expectedExternal: dec('90'),
  actualExternal: dec('90'), deltaAmount: dec('-10'),
  severity: 'LOW', bucket: 'BREAK' as const, slaDeadline: new Date('2026-09-23T20:00:00Z'),
  traceId: 'trace-run', delta: -10n, ...deps,
});

describe('ReconciliationCaseService（波三判据 4）', () => {
  it('openCase：按 businessDate 序号铸 caseNo，状态落 OPEN，发 RECON_CASE_OPENED', async () => {
    const d = makeDeps();
    const svc = new ReconciliationCaseService(d.prisma, d.auditLogs);
    const out = await svc.openCase(openInput());
    expect(out.caseNo).toBe('REC20260920-042');                       // count=41 → 042：服务算的，不是回显
    expect(d.reconciliationCase.create.mock.calls[0][0].data.status).toBe('OPEN');
    const audit = d.auditLogs.recordSystem.mock.calls[0][0];
    expect(audit.action).toBe('RECON_CASE_OPENED');
    expect(audit.metadata.deltaAmount).toBe('-10');                   // bigint→string 是服务干的活
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
    expect(d.auditLogs.recordSystem.mock.calls[0][0].action).toBe('RECON_CASE_AUTO_HEALED');
  });
  it('resolveAutoHealed：已 RESOLVED 的案再 resolve 被显式拒（迁移表真调用）', async () => {
    const d = makeDeps();
    d.reconciliationCase.findUnique.mockResolvedValue({ status: 'RESOLVED' });
    const svc = new ReconciliationCaseService(d.prisma, d.auditLogs);
    await expect(svc.resolveAutoHealed({ caseId: 'c1', caseNo: 'REC1', walletRef: 'w-1', runId: 'run-2', traceId: null, resolvedAt: new Date() }))
      .rejects.toThrow(BadRequestException);
    expect(d.reconciliationCase.update).not.toHaveBeenCalled();
  });
});
