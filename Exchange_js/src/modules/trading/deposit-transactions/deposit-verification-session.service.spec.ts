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
    slaBreached: false,
    ...over,
  });

  beforeEach(() => {
    prisma = { depositTransaction: { findFirst: jest.fn() } };
    deposits = { markActionSubmitted: jest.fn().mockResolvedValue({ changed: true }) };
    auditLogs = { recordByActor: jest.fn() };
    svc = new DepositVerificationSessionService(prisma, deposits, auditLogs);
  });

  it('未提交 + 有 action → 给 embedUrl', async () => {
    prisma.depositTransaction.findFirst.mockResolvedValue(ROW());

    const r = await svc.getSession('cust-1', 'DEP1');

    expect(r.submitted).toBe(false);
    expect(r.embedUrl).toContain('DEP1');
  });

  // 2026-08-04 业主定稿（回改自 Task 4）：manualReason → materialKind 的映射
  // 在两值域上是双射，"是不是 PEP" 这 1 比特被无损保留，等于没脱敏。已删除
  // 该映射，本 service 从此完全不读 manualReason；这条断言直接盯着响应体
  // 不出现 EDD_PEP/PEP 字样，manualReason 取什么值都不影响响应体。
  it('EDD_PEP 的单 —— 响应体不下发 manualReason，也不含 EDD_PEP/PEP 字样', async () => {
    prisma.depositTransaction.findFirst.mockResolvedValue(ROW({ manualReason: 'EDD_PEP' }));

    const r = await svc.getSession('cust-1', 'DEP1');

    expect(JSON.stringify(r)).not.toMatch(/EDD_PEP|PEP/);
  });

  // 评审 Important 3：sumsubActionId === null 分支此前完全没测过——尚未收到
  // applicant action（例如刚进 ACTION_PENDING、webhook 还没落 setActionRefs）
  // 时既不能给 embedUrl，也不能落入"已提交"分支。
  it('未提交 + sumsubActionId 为 null → 不给 embedUrl（还没有可补的材料）', async () => {
    prisma.depositTransaction.findFirst.mockResolvedValue(ROW({ sumsubActionId: null }));

    const r = await svc.getSession('cust-1', 'DEP1');

    expect(r).toEqual({ submitted: false, embedUrl: null });
  });

  // ── Critical 修复的直接产物 ──────────────────────────────────
  // 此前响应体带一个 actionId 字段原样透传 sumsubActionId。demo fixture 里
  // PEP 场景发 aa-edd-0002、非 PEP 场景发 aa-sof-0001（deposit-sumsub/fixtures/
  // verdict-buttons.ts），客户开 DevTools 从 id 前缀（edd = enhanced due
  // diligence）就能反推出 PEP 判定，中性化形同虚设。materialKind 字段本身
  // 后来也被删除（2026-08-04 业主定稿——它是 manualReason 两值域上的双射，
  // 同样的洞）。这条断言把响应体的 key 集合钉死成白名单：以后谁往 getSession
  // 的返回值里加字段（无论叫什么名字），都会先在这里炸掉，逼着回答"这个新
  // 字段会不会泄露同等信息"，而不是像 actionId/materialKind 那样悄悄溜过去。
  it('响应体字段白名单——只有这两个 key，新增字段必须先过这条断言', async () => {
    prisma.depositTransaction.findFirst.mockResolvedValue(ROW());

    const r = await svc.getSession('cust-1', 'DEP1');

    expect(Object.keys(r).sort()).toEqual(['embedUrl', 'submitted']);
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
    // 评审 Minor 3：key 集合白名单此前只钉了"未提交+有 action"分支，
    // submitted:true 这个分支没人钉——复用同一条断言堵上。
    expect(Object.keys(a).sort()).toEqual(['embedUrl', 'submitted']);
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
  describe('submit 对 SLA 字段的重置——只在仍是 ACTION_PENDING 且未违约时才重置', () => {
    it('单子仍是 ACTION_PENDING 且 slaBreached=false → markActionSubmitted 收到 resetSla=true', async () => {
      prisma.depositTransaction.findFirst.mockResolvedValue(
        ROW({ status: 'ACTION_PENDING', slaBreached: false }),
      );

      await svc.submit('cust-1', 'DEP1');

      expect(deposits.markActionSubmitted).toHaveBeenCalledWith(
        'd-1',
        expect.any(Date),
        true,
      );
    });

    // 评审 Minor 1：判据看旗而非单看状态——ACTION_PENDING 本身也可能带
    // slaBreached=true，此时不该重置（否则 operator 的违约旗仍会被抹掉）。
    // 这条是本次修复的核心红灯：仅按 status === ACTION_PENDING 判定时，
    // 这条会误判 resetSla=true。
    it('单子是 ACTION_PENDING 但 slaBreached=true → resetSla=false（不抹违约旗）', async () => {
      prisma.depositTransaction.findFirst.mockResolvedValue(
        ROW({ status: 'ACTION_PENDING', slaBreached: true }),
      );

      await svc.submit('cust-1', 'DEP1');

      expect(deposits.markActionSubmitted).toHaveBeenCalledWith(
        'd-1',
        expect.any(Date),
        false,
      );
    });

    it('单子已被 SLA 定时器打成 MANUAL_CHECKING → resetSla=false（不抹违约旗）', async () => {
      prisma.depositTransaction.findFirst.mockResolvedValue(
        ROW({ status: 'MANUAL_CHECKING', slaBreached: true }),
      );

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

  // ── 评审 Minor 2：审计要如实反映本次到底有没有重置 SLA 表，不许恒定声称 ──
  describe('submit 的审计 reason/metadata 须与 resetSla 是否发生一致', () => {
    it('resetSla=true → 审计写"switched to provider re-review"，metadata 带 slaDeadline', async () => {
      prisma.depositTransaction.findFirst.mockResolvedValue(
        ROW({ status: 'ACTION_PENDING', slaBreached: false }),
      );

      await svc.submit('cust-1', 'DEP1');

      expect(auditLogs.recordByActor).toHaveBeenCalledWith(
        expect.objectContaining({
          reason: 'Customer submitted applicant-action materials; SLA clock switched to provider re-review',
          metadata: expect.objectContaining({
            actionId: 'aa-1',
            slaDeadline: expect.any(Date),
            waitingOn: 'PROVIDER',
          }),
        }),
        expect.anything(),
      );
    });

    it('resetSla=false（已被打成 MANUAL_CHECKING） → 审计如实写"未重置"，metadata 不带 slaDeadline；对外响应仍 {ok:true}', async () => {
      prisma.depositTransaction.findFirst.mockResolvedValue(
        ROW({ status: 'MANUAL_CHECKING', slaBreached: true }),
      );

      const result = await svc.submit('cust-1', 'DEP1');

      expect(result).toEqual({ ok: true });
      expect(auditLogs.recordByActor).toHaveBeenCalledWith(
        expect.objectContaining({
          reason: 'Customer submitted applicant-action materials; SLA clock left untouched (deposit no longer ACTION_PENDING or already SLA-breached)',
          metadata: {
            actionId: 'aa-1',
            waitingOn: 'PROVIDER',
          },
        }),
        expect.anything(),
      );
      const metadata = auditLogs.recordByActor.mock.calls[0][0].metadata;
      expect(metadata).not.toHaveProperty('slaDeadline');
    });
  });
});
