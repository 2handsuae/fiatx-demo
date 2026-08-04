import { DepositVerificationSessionService } from './deposit-verification-session.service';

describe('DepositVerificationSessionService', () => {
  let svc: DepositVerificationSessionService;
  let prisma: any;
  let deposits: any;
  let auditLogs: any;

  const ROW = (over: any = {}) => ({
    id: 'd-1',
    depositNo: 'DEP1',
    ownerId: 'cust-1',
    status: 'ACTION_PENDING',
    manualReason: 'CLIENT_ACTION',
    sumsubActionId: 'aa-1',
    sumsubExternalActionId: 'EXT-1',
    actionSubmittedAt: null,
    ...over,
  });

  beforeEach(() => {
    prisma = { depositTransaction: { findFirst: jest.fn() } };
    deposits = { markActionSubmitted: jest.fn().mockResolvedValue({ changed: true }) };
    auditLogs = { recordByActor: jest.fn() };
    svc = new DepositVerificationSessionService(prisma, deposits, auditLogs);
  });

  it('未提交 + 有 action → 给 embedUrl 与中性 materialKind', async () => {
    prisma.depositTransaction.findFirst.mockResolvedValue(ROW());

    const r = await svc.getSession('cust-1', 'DEP1');

    expect(r.submitted).toBe(false);
    expect(r.materialKind).toBe('SOURCE_OF_FUNDS');
    expect(r.embedUrl).toContain('DEP1');
  });

  it('EDD_PEP 映射成中性 SUPPORTING_DOCUMENTS —— 不下发 manualReason', async () => {
    prisma.depositTransaction.findFirst.mockResolvedValue(ROW({ manualReason: 'EDD_PEP' }));

    const r = await svc.getSession('cust-1', 'DEP1');

    expect(r.materialKind).toBe('SUPPORTING_DOCUMENTS');
    expect(JSON.stringify(r)).not.toMatch(/EDD_PEP|PEP/);
  });

  // ── 核心：接口层的不可区分规则 ──────────────────────────────
  it('已提交的单，ACTION_PENDING 与 FROZEN 响应体全等', async () => {
    const submittedAt = new Date('2026-08-01T00:00:00Z');

    prisma.depositTransaction.findFirst.mockResolvedValue(
      ROW({ status: 'ACTION_PENDING', actionSubmittedAt: submittedAt }),
    );
    const a = await svc.getSession('cust-1', 'DEP1');

    prisma.depositTransaction.findFirst.mockResolvedValue(
      ROW({ status: 'FROZEN', actionSubmittedAt: submittedAt }),
    );
    const b = await svc.getSession('cust-1', 'DEP1');

    expect(b).toEqual(a);
  });

  it('提交端点对冻结单照样 200（不返错误码当探针）', async () => {
    prisma.depositTransaction.findFirst.mockResolvedValue(ROW({ status: 'FROZEN' }));

    await expect(svc.submit('cust-1', 'DEP1')).resolves.toEqual({ ok: true });
  });

  it('别人的单 → 404', async () => {
    prisma.depositTransaction.findFirst.mockResolvedValue(null);

    await expect(svc.getSession('cust-9', 'DEP1')).rejects.toThrow();
  });

  it('落库那次记审计；幂等的重复提交不重复记', async () => {
    prisma.depositTransaction.findFirst.mockResolvedValue(ROW());

    deposits.markActionSubmitted.mockResolvedValue({ changed: true });
    await svc.submit('cust-1', 'DEP1');
    expect(auditLogs.recordByActor).toHaveBeenCalledTimes(1);
    expect(auditLogs.recordByActor.mock.calls[0][1]).toEqual(
      expect.objectContaining({ actorType: 'CUSTOMER', actorId: 'cust-1' }),
    );

    deposits.markActionSubmitted.mockResolvedValue({ changed: false });
    await svc.submit('cust-1', 'DEP1');
    expect(auditLogs.recordByActor).toHaveBeenCalledTimes(1);   // 没涨
  });
});
