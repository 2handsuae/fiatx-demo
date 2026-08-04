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

  // 评审 Important 3：sumsubActionId === null 分支此前完全没测过——尚未收到
  // applicant action（例如刚进 ACTION_PENDING、webhook 还没落 setActionRefs）
  // 时既不能给 embedUrl，也不能落入"已提交"分支。
  it('未提交 + sumsubActionId 为 null → 不给 embedUrl（还没有可补的材料）', async () => {
    prisma.depositTransaction.findFirst.mockResolvedValue(ROW({ sumsubActionId: null }));

    const r = await svc.getSession('cust-1', 'DEP1');

    expect(r).toEqual({ submitted: false, embedUrl: null, materialKind: null });
  });

  // ── Critical 修复的直接产物 ──────────────────────────────────
  // 此前响应体带一个 actionId 字段原样透传 sumsubActionId。demo fixture 里
  // PEP 场景发 aa-edd-0002、非 PEP 场景发 aa-sof-0001（deposit-sumsub/fixtures/
  // verdict-buttons.ts），客户开 DevTools 从 id 前缀（edd = enhanced due
  // diligence）就能反推出 materialKind 想封的 PEP 判定，中性化形同虚设。
  // 这条断言把响应体的 key 集合钉死成白名单：以后谁往 getSession 的返回值里
  // 加字段（无论叫什么名字），都会先在这里炸掉，逼着回答"这个新字段会不会
  // 泄露同等信息"，而不是像 actionId 那样悄悄溜过去。
  it('响应体字段白名单——只有这三个 key，新增字段必须先过这条断言', async () => {
    prisma.depositTransaction.findFirst.mockResolvedValue(ROW());

    const r = await svc.getSession('cust-1', 'DEP1');

    expect(Object.keys(r).sort()).toEqual(['embedUrl', 'materialKind', 'submitted']);
  });

  it('actionId 不再下发（即便 sumsubActionId 本身就是 aa-edd-… 这类携带信息的 id）', async () => {
    prisma.depositTransaction.findFirst.mockResolvedValue(
      ROW({ sumsubActionId: 'aa-edd-0002', manualReason: 'EDD_PEP' }),
    );

    const r: any = await svc.getSession('cust-1', 'DEP1');

    expect(r.actionId).toBeUndefined();
    expect(JSON.stringify(r)).not.toMatch(/aa-edd|aa-sof/);
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

  // 评审 Important 3：真正高危的路径——单子还没提交就被冻，客户端此时仍在
  // 轮询这个新端点。此前只测了"已提交单在两态间响应体全等"，没测过"未提交
  // 单被冻后响应体是否还和 COMPLIANCE_PENDING 时一样"，而这恰恰是新端点
  // 存在的意义（不可区分规则唯一真正会被触发考验的时刻）。
  it('未提交的单被冻，客户端仍在轮询 → 响应体与冻结前（COMPLIANCE_PENDING）逐字段一致', async () => {
    prisma.depositTransaction.findFirst.mockResolvedValue(
      ROW({ status: 'COMPLIANCE_PENDING', actionSubmittedAt: null }),
    );
    const before = await svc.getSession('cust-1', 'DEP1');

    prisma.depositTransaction.findFirst.mockResolvedValue(
      ROW({ status: 'FROZEN', actionSubmittedAt: null }),
    );
    const afterFrozen = await svc.getSession('cust-1', 'DEP1');

    expect(afterFrozen).toEqual(before);
    expect(afterFrozen.submitted).toBe(false);
    expect(afterFrozen.embedUrl).toContain('DEP1');
  });

  it('提交端点对冻结单照样 200（不返错误码当探针）', async () => {
    prisma.depositTransaction.findFirst.mockResolvedValue(ROW({ status: 'FROZEN' }));

    await expect(svc.submit('cust-1', 'DEP1')).resolves.toEqual({ ok: true });
  });

  // 评审 Important 1：BELOW_MIN 隐藏单的存在性预言机。findAll 的 customerScope
  // 与 findOneForCustomer 都把这类单当不存在处理（where.limitHoldReason = null /
  // 显式 404），本端点必须对齐——否则对隐藏单返 200、对真不存在的单返 404，
  // 客户能借此探出"我有一笔列表里看不到的单"存在。
  it('mustFindOwn 的查询条件带 limitHoldReason:null，与客户面其它两条口子对齐', async () => {
    prisma.depositTransaction.findFirst.mockResolvedValue(ROW());

    await svc.getSession('cust-1', 'DEP1');

    expect(prisma.depositTransaction.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { depositNo: 'DEP1', ownerId: 'cust-1', limitHoldReason: null },
      }),
    );
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

  // ── 评审 Important 2：客户提交不能单方面抹掉 operator 可见的 SLA 违约旗 ──
  describe('submit 对 SLA 字段的重置——只在仍是 ACTION_PENDING 时才重置', () => {
    it('单子仍是 ACTION_PENDING → markActionSubmitted 收到 resetSla=true', async () => {
      prisma.depositTransaction.findFirst.mockResolvedValue(ROW({ status: 'ACTION_PENDING' }));

      await svc.submit('cust-1', 'DEP1');

      expect(deposits.markActionSubmitted).toHaveBeenCalledWith(
        'd-1',
        expect.any(Date),
        true,
      );
    });

    it('单子已被 SLA 定时器打成 MANUAL_CHECKING → resetSla=false（不抹违约旗）', async () => {
      prisma.depositTransaction.findFirst.mockResolvedValue(ROW({ status: 'MANUAL_CHECKING' }));

      await svc.submit('cust-1', 'DEP1');

      expect(deposits.markActionSubmitted).toHaveBeenCalledWith(
        'd-1',
        expect.any(Date),
        false,
      );
    });

    it('单子已被冻结(FROZEN) → resetSla=false（同上，冻结态同样不许被客户提交清旗）', async () => {
      prisma.depositTransaction.findFirst.mockResolvedValue(ROW({ status: 'FROZEN' }));

      await svc.submit('cust-1', 'DEP1');

      expect(deposits.markActionSubmitted).toHaveBeenCalledWith(
        'd-1',
        expect.any(Date),
        false,
      );
    });
  });
});
