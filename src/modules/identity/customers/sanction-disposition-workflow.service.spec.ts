import { BadRequestException, ConflictException } from '@nestjs/common';
import { addBusinessDays } from '../../governance/regulatory-filings/business-days';
import { AuditActions } from '../../audit-logging/constants/audit-actions.constant';
import { AuditOutcome } from '../../audit-logging/dto/audit-log.dto';
import { ApprovalActionTypes } from '../../governance/approvals/constants/approval.constants';
import { ApprovalDecidedEvent } from '../../governance/approvals/approval-handler.base';
import { SanctionDispositionWorkflowService } from './sanction-disposition-workflow.service';

const CUSTOMER_NO = 'CUS-SANCTION-1';
const CUSTOMER_ID = 'cust-uuid-1';
const RESTRICTION_NO = 'RST260926000001';
const OPENED_AT = new Date('2026-08-01T00:00:00.000Z');

function buildRestrictionRow(overrides: Partial<any> = {}) {
  return {
    restrictionNo: RESTRICTION_NO,
    customerId: CUSTOMER_ID,
    scopes: ['ALL'],
    cause: 'SANCTION',
    visibility: 'SILENT',
    releasePolicy: 'MLRO_APPROVAL',
    status: 'OPEN',
    reason: 'sanctions list hit',
    caseRef: CUSTOMER_NO,
    releaseOrderRef: null,
    openedAt: OPENED_AT,
    openedBy: 'SYSTEM',
    releasedAt: null,
    releasedBy: null,
    releaseApprovalNo: null,
    releaseMode: null,
    traceId: 'trace-1',
    ...overrides,
  };
}

function buildDeps() {
  const prisma = {
    customerMain: { findFirst: jest.fn().mockResolvedValue({ id: CUSTOMER_ID }) },
    $transaction: jest.fn(async (cb: any) => cb({ __tx: true })),
  } as any;
  const restrictions = {
    findOpenByCause: jest.fn().mockResolvedValue(buildRestrictionRow()),
    findByNo: jest.fn().mockResolvedValue(buildRestrictionRow()),
    release: jest.fn().mockResolvedValue(undefined),
    open: jest.fn().mockResolvedValue({ restrictionNo: 'RST260926000002', created: true }),
  } as any;
  const approvalsService = {
    createAndSubmit: jest.fn().mockResolvedValue({ approvalNo: 'APR-SD-1' }),
    // 默认无待决案（黄2 的防重复开案守卫在 initiateDisposition 里查这个）；各 describe
    // 按需用 mockResolvedValueOnce/自定义实现覆盖。
    list: jest.fn().mockResolvedValue({ total: 0, items: [] }),
  } as any;
  const auditLogsService = {
    recordByActor: jest.fn().mockResolvedValue(undefined),
  } as any;
  const filings = {
    openForSanction: jest.fn().mockResolvedValue({ filingNo: 'FIL-1' }),
  } as any;
  const materialRequestIssuer = {
    issue: jest.fn().mockResolvedValue({ requestNo: 'MRQ-1', restrictionNo: null }),
  } as any;

  const svc = new SanctionDispositionWorkflowService(
    prisma,
    restrictions,
    approvalsService,
    auditLogsService,
    filings,
    materialRequestIssuer,
  );

  return { svc, prisma, restrictions, approvalsService, auditLogsService, filings, materialRequestIssuer };
}

function actorContext() {
  return { actorType: 'ADMIN' as const, userId: 'uuid-compliance', userNo: 'ADM-COMPLIANCE', role: 'COMPLIANCE_OFFICER', roleCodes: ['COMPLIANCE_OFFICER'] };
}

function makeDecidedEvent(overrides: Partial<ApprovalDecidedEvent> = {}): ApprovalDecidedEvent {
  return {
    decision: 'APPROVED',
    actionType: ApprovalActionTypes.SANCTION_DISPOSITION,
    entityRef: CUSTOMER_NO,
    approvalId: 'approval-id-1',
    approvalNo: 'APR-SD-1',
    traceId: 'trace-1',
    workflowType: 'SANCTION_DISPOSITION',
    decisionByUserId: 'uuid-mlro-real',
    decisionByUserNo: 'ADM-MLRO',
    decisionByRole: 'MLRO',
    decisionReason: null,
    decidedAt: new Date().toISOString(),
    metadata: {},
    ...overrides,
  };
}

describe('SanctionDispositionWorkflowService.initiateDisposition', () => {
  it('提单：正门开 MLRO 单步审批，携带 outcome/summary/externalCaseRef/restrictionNo/impact 快照，并写 SANCTION_DISPOSITION_REQUESTED 审计', async () => {
    const { svc, restrictions, approvalsService, auditLogsService } = buildDeps();

    const result = await svc.initiateDisposition(CUSTOMER_NO, 'PARTIAL', 'partial name match, needs ID', 'EOCN_ENTRY_1', actorContext());

    expect(result).toEqual({ approvalNo: 'APR-SD-1', restrictionNo: RESTRICTION_NO });
    expect(restrictions.findOpenByCause).toHaveBeenCalledWith(CUSTOMER_ID, 'SANCTION', null);
    // 黄2：先查有没有 PENDING 待决案，再开新案。
    expect(approvalsService.list).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: ApprovalActionTypes.SANCTION_DISPOSITION,
        entityRef: CUSTOMER_NO,
        status: 'PENDING',
      }),
    );
    expect(approvalsService.createAndSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: ApprovalActionTypes.SANCTION_DISPOSITION,
        entityRef: CUSTOMER_NO,
        objectSnapshot: expect.objectContaining({
          customerNo: CUSTOMER_NO,
          restrictionNo: RESTRICTION_NO,
          outcome: 'PARTIAL',
          summary: 'partial name match, needs ID',
          externalCaseRef: 'EOCN_ENTRY_1',
          // 黄3：审批快照带 impact——管理台审批详情页展示"批了会怎样"。
          impact: expect.stringContaining('PNMR'),
        }),
      }),
      expect.objectContaining({ reason: 'partial name match, needs ID' }),
      expect.objectContaining({ userId: 'uuid-compliance' }),
    );

    const [input] = auditLogsService.recordByActor.mock.calls[0];
    expect(input.action).toBe(AuditActions.SANCTION_DISPOSITION_REQUESTED);
    expect(input.actionDomain).toBe('CUSTOMER');
    expect(input.outcome).toBe(AuditOutcome.SUCCESS);
    expect(input.approvalNo).toBe('APR-SD-1'); // 白6：requiredFields 改守 approvalNo
    expect(input.metadata).toEqual(expect.objectContaining({ outcome: 'PARTIAL', restrictionNo: RESTRICTION_NO }));
  });

  // 黄3：三出口各自的 impact 文案人话不同，逐一断言不串味。
  it.each([
    ['CLEARED', /releases the SANCTION restriction/i],
    ['PARTIAL', /Partial Name Match Report/i],
    ['CONFIRMED', /Confirmed Name Match Report/i],
  ] as const)('%s 出口的 impact 文案带出正确的落地叙事', async (outcome, expected) => {
    const { svc, approvalsService } = buildDeps();
    await svc.initiateDisposition(CUSTOMER_NO, outcome, 'summary text', 'EOCN_ENTRY_1', actorContext());
    const [createDto] = approvalsService.createAndSubmit.mock.calls[0];
    expect((createDto.objectSnapshot as any).impact).toMatch(expected);
  });

  // 黄2：已有 PENDING 定性单时不能再开第二张——否则合规官改主意重提一个不同的
  // outcome，REQUESTED 审计却"看似成功"记了新值，MLRO 实际批的还是旧案里的旧 outcome。
  it('该客户已有 PENDING 的定性单 → 409，不开新案、不写 REQUESTED 审计', async () => {
    const { svc, approvalsService, auditLogsService } = buildDeps();
    approvalsService.list.mockResolvedValue({ total: 1, items: [{ approvalNo: 'APR-SD-OLD' }] });

    await expect(
      svc.initiateDisposition(CUSTOMER_NO, 'CONFIRMED', 'changed my mind, EOCN says confirm', 'EOCN_ENTRY_1', actorContext()),
    ).rejects.toThrow(ConflictException);
    expect(approvalsService.createAndSubmit).not.toHaveBeenCalled();
    expect(auditLogsService.recordByActor).not.toHaveBeenCalled();
  });

  it('该客户没有 OPEN 的 SANCTION 便签 → 400，不开审批案', async () => {
    const { svc, restrictions, approvalsService } = buildDeps();
    restrictions.findOpenByCause.mockResolvedValue(null);

    await expect(
      svc.initiateDisposition(CUSTOMER_NO, 'CLEARED', 'no hit found on review', 'EOCN_ENTRY_1', actorContext()),
    ).rejects.toThrow(BadRequestException);
    expect(approvalsService.createAndSubmit).not.toHaveBeenCalled();
  });

  it('summary 缺失 → 400', async () => {
    const { svc, approvalsService } = buildDeps();
    await expect(
      svc.initiateDisposition(CUSTOMER_NO, 'CLEARED', '  ', 'EOCN_ENTRY_1', actorContext()),
    ).rejects.toThrow(BadRequestException);
    expect(approvalsService.createAndSubmit).not.toHaveBeenCalled();
  });

  it('externalCaseRef 缺失 → 400', async () => {
    const { svc, approvalsService } = buildDeps();
    await expect(
      svc.initiateDisposition(CUSTOMER_NO, 'CLEARED', 'cleared after review', '', actorContext()),
    ).rejects.toThrow(BadRequestException);
    expect(approvalsService.createAndSubmit).not.toHaveBeenCalled();
  });

  it('outcome 不在三选一之内 → 400', async () => {
    const { svc, approvalsService } = buildDeps();
    await expect(
      svc.initiateDisposition(CUSTOMER_NO, 'MAYBE' as any, 'x', 'EOCN_ENTRY_1', actorContext()),
    ).rejects.toThrow(BadRequestException);
    expect(approvalsService.createAndSubmit).not.toHaveBeenCalled();
  });

  // 白7：不复用同一份静态 mock 快照——每次调用各自独立 mock 出"第一张单已不再 PENDING"
  // 这个真实前提（第一张 PARTIAL 案已经被 MLRO 批了、落地了，不再挡第二次提单），
  // 而不是让 list() 对两次调用返回同一个值蒙混过关（那样测不出黄2 的守卫到底生效没有）。
  it('二次定性：PARTIAL 案已批准落地（不再 PENDING）后，同一张仍 OPEN 的 SANCTION 便签可再次提单', async () => {
    const { svc, restrictions, approvalsService } = buildDeps();
    // PARTIAL 出口不释放便签——第二次提单查到的仍是同一张 restrictionNo。
    restrictions.findOpenByCause.mockResolvedValue(buildRestrictionRow());

    // 第一次提单：无待决案，正常开单。
    approvalsService.list.mockResolvedValueOnce({ total: 0, items: [] });
    approvalsService.createAndSubmit.mockResolvedValueOnce({ approvalNo: 'APR-SD-1' } as any);
    const first = await svc.initiateDisposition(CUSTOMER_NO, 'PARTIAL', 'first pass: partial match', 'EOCN_ENTRY_1', actorContext());

    // 第一张案已经 APPROVED 落地（PARTIAL 出口不释放便签），不再是 PENDING——
    // 第二次提单的守卫查询应查到 0 条待决案，而不是复用第一次那次查询的状态。
    approvalsService.list.mockResolvedValueOnce({ total: 0, items: [] });
    approvalsService.createAndSubmit.mockResolvedValueOnce({ approvalNo: 'APR-SD-2' } as any);
    const second = await svc.initiateDisposition(CUSTOMER_NO, 'CONFIRMED', 'EOCN instructed confirm', 'EOCN_ENTRY_1', actorContext());

    expect(first.approvalNo).toBe('APR-SD-1');
    expect(second.approvalNo).toBe('APR-SD-2');
    expect(first.restrictionNo).toBe(RESTRICTION_NO);
    expect(second.restrictionNo).toBe(RESTRICTION_NO);
    expect(approvalsService.createAndSubmit).toHaveBeenCalledTimes(2);
    expect(approvalsService.list).toHaveBeenCalledTimes(2);
  });
});

describe('SanctionDispositionWorkflowService.onDecided', () => {
  it('拒绝（非 APPROVED）：只写 SANCTION_DISPOSITION_DECIDED 审计，维持待裁，不落地任何出口', async () => {
    const { svc, restrictions, filings, materialRequestIssuer, auditLogsService, approvalsService } = buildDeps();

    await svc.onDecided(makeDecidedEvent({ decision: 'DECLINED' }));

    expect(approvalsService.list).not.toHaveBeenCalled();
    expect(restrictions.release).not.toHaveBeenCalled();
    expect(restrictions.open).not.toHaveBeenCalled();
    expect(filings.openForSanction).not.toHaveBeenCalled();
    expect(materialRequestIssuer.issue).not.toHaveBeenCalled();

    const actions = auditLogsService.recordByActor.mock.calls.map((c: any) => c[0].action);
    expect(actions).toEqual([AuditActions.SANCTION_DISPOSITION_DECIDED]);
    const [decidedInput] = auditLogsService.recordByActor.mock.calls[0];
    expect(decidedInput.outcome).toBe(AuditOutcome.SUCCESS);
  });

  // 白4：approvals.service.ts#expirePendingApprovalCase 从不给超时的 step 落
  // decidedByUserId——decisionByUserId/UserNo/Role 三者恒 null。回退不能是 'MLRO'
  // （压根没有人裁决），必须是 SYSTEM 通道。
  it('EXPIRED：无人工裁决痕迹，actor 落 SYSTEM 通道、sourcePlatform 落 CRON，不冒充 MLRO', async () => {
    const { svc, auditLogsService } = buildDeps();

    await svc.onDecided(makeDecidedEvent({
      decision: 'EXPIRED', decisionByUserId: null, decisionByUserNo: null, decisionByRole: null,
    }));

    const [decidedInput, decidedActor] = auditLogsService.recordByActor.mock.calls[0];
    expect(decidedActor).toEqual({ actorType: 'SYSTEM', actorNo: 'SYSTEM', actorDisplayName: 'SYSTEM', actorRolesAtTime: [] });
    expect(decidedInput.sourcePlatform).toBe('CRON');
  });

  // 白4：approvals.service.ts#cancel 落 decidedByUserId/UserNo（撤单的是 maker 本人，
  // 通常是合规官）但不落 decidedByRole——回退成 'MLRO' 会把"合规官撤自己提的单"记成
  // "MLRO 撤的"，角色张冠李戴；回退应是 'UNKNOWN'，不猜角色。
  it('CANCELLED：撤单人是 maker（合规官），角色回退 UNKNOWN 不冒充 MLRO', async () => {
    const { svc, auditLogsService } = buildDeps();

    await svc.onDecided(makeDecidedEvent({
      decision: 'CANCELLED', decisionByUserId: 'uuid-compliance', decisionByUserNo: 'ADM-COMPLIANCE', decisionByRole: null,
    }));

    const [decidedInput, decidedActor] = auditLogsService.recordByActor.mock.calls[0];
    expect(decidedActor.actorType).toBe('ADMIN');
    expect(decidedActor.actorNo).toBe('ADM-COMPLIANCE'); // 真实撤单人，不是 SYSTEM
    expect(decidedActor.actorRolesAtTime).toEqual(['UNKNOWN']); // 不是 ['MLRO']
    expect(decidedInput.sourcePlatform).toBe('ADMIN_API');
  });

  describe('APPROVED · CLEARED', () => {
    function withClearedSnapshot(deps: ReturnType<typeof buildDeps>) {
      deps.approvalsService.list.mockResolvedValue({
        items: [{ objectSnapshot: { customerNo: CUSTOMER_NO, restrictionNo: RESTRICTION_NO, outcome: 'CLEARED', summary: 's', externalCaseRef: 'EOCN_1' } }],
      });
    }

    it('直调限制解除执行：releaseMode=MANUAL、releaseApprovalNo=定性单号，不走 filings/材料请求', async () => {
      const deps = buildDeps();
      withClearedSnapshot(deps);

      await deps.svc.onDecided(makeDecidedEvent());

      expect(deps.restrictions.release).toHaveBeenCalledWith(RESTRICTION_NO, expect.objectContaining({
        releaseMode: 'MANUAL',
        releaseApprovalNo: 'APR-SD-1',
      }));
      expect(deps.filings.openForSanction).not.toHaveBeenCalled();
      expect(deps.materialRequestIssuer.issue).not.toHaveBeenCalled();

      const actions = deps.auditLogsService.recordByActor.mock.calls.map((c: any) => c[0].action);
      expect(actions).toEqual(expect.arrayContaining([
        AuditActions.SANCTION_DISPOSITION_DECIDED,
        AuditActions.CUSTOMER_RESTRICTION_CLEARED,
        AuditActions.CUSTOMER_UNFROZEN,
        AuditActions.SANCTION_DISPOSITION_LANDED,
      ]));
    });

    it('CUSTOMER_RESTRICTION_CLEARED/CUSTOMER_UNFROZEN 的 actor 是真实裁决人（MLRO），不是 SYSTEM', async () => {
      const deps = buildDeps();
      withClearedSnapshot(deps);

      await deps.svc.onDecided(makeDecidedEvent());

      const clearedCall = deps.auditLogsService.recordByActor.mock.calls.find(
        (c: any) => c[0].action === AuditActions.CUSTOMER_RESTRICTION_CLEARED,
      );
      expect(clearedCall).toBeDefined();
      const [, actor] = clearedCall;
      expect(actor.actorType).toBe('ADMIN');
      expect(actor.actorNo).toBe('ADM-MLRO');
      expect(actor.actorNo).not.toBe('SYSTEM');
    });

    it('CLEARED 落地只释放原有那张便签，不新开任何便签', async () => {
      const deps = buildDeps();
      withClearedSnapshot(deps);
      await deps.svc.onDecided(makeDecidedEvent());
      expect(deps.restrictions.open).not.toHaveBeenCalled();
    });
  });

  describe('APPROVED · PARTIAL', () => {
    function withPartialSnapshot(deps: ReturnType<typeof buildDeps>) {
      deps.approvalsService.list.mockResolvedValue({
        items: [{ objectSnapshot: { customerNo: CUSTOMER_NO, restrictionNo: RESTRICTION_NO, outcome: 'PARTIAL', summary: 's', externalCaseRef: 'EOCN_1' } }],
      });
    }

    it('开 PNMR（锚=SANCTION 便签 openedAt）＋自动发中性补料，维持 SILENT 便签不动', async () => {
      const deps = buildDeps();
      withPartialSnapshot(deps);

      await deps.svc.onDecided(makeDecidedEvent());

      expect(deps.restrictions.release).not.toHaveBeenCalled();
      expect(deps.restrictions.open).not.toHaveBeenCalled();
      expect(deps.filings.openForSanction).toHaveBeenCalledWith(
        'PNMR', CUSTOMER_NO, 'EOCN_1', OPENED_AT, expect.any(String), expect.objectContaining({ userId: 'uuid-mlro-real' }),
      );
      expect(deps.materialRequestIssuer.issue).toHaveBeenCalledWith(
        expect.objectContaining({
          customerId: CUSTOMER_ID,
          restrict: false,
          orderDomain: null,
          orderRef: null,
        }),
      );
      // 中性话术：不点破制裁排查
      const issueArg = deps.materialRequestIssuer.issue.mock.calls[0][0];
      expect(issueArg.reason.toLowerCase()).not.toContain('sanction');
    });

    // 白7：杀评审变异 M6——openForSanction()（PNMR 的 FILING_OPENED 就是它写的）拿到的
    // requestId，必须跟 SANCTION_DISPOSITION_LANDED 那条审计用的是同一个字符串，才能
    // "哪次裁决触发了这张单"反查回去（文件头注释的 requestId 全链同值承诺）。
    it('传给 openForSanction 的 requestId，与 SANCTION_DISPOSITION_LANDED 审计的 requestId 同值', async () => {
      const deps = buildDeps();
      withPartialSnapshot(deps);
      await deps.svc.onDecided(makeDecidedEvent());

      const [, , , , filingRequestId] = deps.filings.openForSanction.mock.calls[0];
      const landedCall = deps.auditLogsService.recordByActor.mock.calls.find(
        (c: any) => c[0].action === AuditActions.SANCTION_DISPOSITION_LANDED,
      );
      expect(landedCall).toBeDefined();
      expect(landedCall![0].requestId).toBe(filingRequestId);
    });

    it('PNMR 的 deadline 锚点是便签 openedAt（不是裁决时刻），5 个工作日窗口由此起算', async () => {
      const deps = buildDeps();
      withPartialSnapshot(deps);
      const decidedAtDifferentFromOpenedAt = new Date('2026-09-20T00:00:00.000Z');
      await deps.svc.onDecided(makeDecidedEvent({ decidedAt: decidedAtDifferentFromOpenedAt.toISOString() }));

      const [, , , anchorAt] = deps.filings.openForSanction.mock.calls[0];
      expect(anchorAt).toEqual(OPENED_AT);
      expect(anchorAt).not.toEqual(decidedAtDifferentFromOpenedAt);
      expect(addBusinessDays(anchorAt, 5)).toEqual(addBusinessDays(OPENED_AT, 5));
    });

    it('actor 口径：openForSanction 传的是裁决人真实 userId，不是 userNo，也不是 SYSTEM', async () => {
      const deps = buildDeps();
      withPartialSnapshot(deps);
      await deps.svc.onDecided(makeDecidedEvent());

      const [, , , , , landingActor] = deps.filings.openForSanction.mock.calls[0];
      expect(landingActor.userId).toBe('uuid-mlro-real');
      expect(landingActor.userId).not.toBe('ADM-MLRO');
      expect(landingActor.userId).not.toBe('SYSTEM');
    });
  });

  describe('APPROVED · CONFIRMED', () => {
    function withConfirmedSnapshot(deps: ReturnType<typeof buildDeps>) {
      deps.approvalsService.list.mockResolvedValue({
        items: [{ objectSnapshot: { customerNo: CUSTOMER_NO, restrictionNo: RESTRICTION_NO, outcome: 'CONFIRMED', summary: 's', externalCaseRef: 'EOCN_1' } }],
      });
    }

    it('CONFIRMED 翻牌原子性：解列旧便签＋开 SANCTION_CONFIRMED 便签在同一事务，且都开了 CNMR', async () => {
      const deps = buildDeps();
      withConfirmedSnapshot(deps);

      await deps.svc.onDecided(makeDecidedEvent());

      expect(deps.prisma.$transaction).toHaveBeenCalledTimes(1);
      const releaseCall = deps.restrictions.release.mock.calls[0];
      const openCall = deps.restrictions.open.mock.calls[0];
      expect(releaseCall[0]).toBe(RESTRICTION_NO);
      expect(releaseCall[2]).toEqual({ __tx: true }); // 同一个 tx client
      expect(openCall[0]).toEqual(expect.objectContaining({ cause: 'SANCTION_CONFIRMED', customerId: CUSTOMER_ID }));
      expect(openCall[1]).toEqual({ __tx: true }); // 同一个 tx client

      expect(deps.filings.openForSanction).toHaveBeenCalledWith(
        'CNMR', CUSTOMER_NO, 'EOCN_1', OPENED_AT, expect.any(String), expect.objectContaining({ userId: 'uuid-mlro-real' }),
      );
      expect(deps.materialRequestIssuer.issue).not.toHaveBeenCalled();
    });

    it('CNMR 的 deadline 锚点也是原 SANCTION 便签 openedAt（不是裁决时刻），5 个工作日窗口由此起算', async () => {
      const deps = buildDeps();
      withConfirmedSnapshot(deps);
      const decidedAtDifferentFromOpenedAt = new Date('2026-09-20T00:00:00.000Z');
      await deps.svc.onDecided(makeDecidedEvent({ decidedAt: decidedAtDifferentFromOpenedAt.toISOString() }));

      const [, , , anchorAt] = deps.filings.openForSanction.mock.calls[0];
      expect(anchorAt).toEqual(OPENED_AT);
      expect(anchorAt).not.toEqual(decidedAtDifferentFromOpenedAt);
      expect(addBusinessDays(anchorAt, 5)).toEqual(addBusinessDays(OPENED_AT, 5));
    });

    // 白7：不复用同一份静态 mock 快照——真实建两条 approval case（旧 PARTIAL 案 APR-SD-1
    // 已 APPROVED 落地、新 CONFIRMED 案 APR-SD-2 现在才被裁决），list() 按 approvalNo
    // 精确路由到各自的 objectSnapshot（白9 修法），断言 onDecided(APR-SD-2 的事件) 真的
    // 取到 APR-SD-2 的快照、而不是误取 APR-SD-1 的旧快照——这才是"二次定性"这个场景真正
    // 要测的东西，而不是重复一遍普通 CONFIRMED 落地的断言。
    it('二次定性 CONFIRMED：按 approvalNo 精确取到本次案的快照，解列的是原 SANCTION 便签', async () => {
      const deps = buildDeps();
      const snapshotsByApprovalNo: Record<string, any> = {
        'APR-SD-1': { customerNo: CUSTOMER_NO, restrictionNo: RESTRICTION_NO, outcome: 'PARTIAL', summary: 'first pass', externalCaseRef: 'EOCN_1', impact: 'partial impact' },
        'APR-SD-2': { customerNo: CUSTOMER_NO, restrictionNo: RESTRICTION_NO, outcome: 'CONFIRMED', summary: 'EOCN confirmed', externalCaseRef: 'EOCN_1', impact: 'confirmed impact' },
      };
      deps.approvalsService.list.mockImplementation(async (query: any) => {
        const snapshot = snapshotsByApprovalNo[query.approvalNo];
        return { total: snapshot ? 1 : 0, items: snapshot ? [{ objectSnapshot: snapshot }] : [] };
      });

      // 本次裁决的事件指向第二张案（APR-SD-2，CONFIRMED）——同一张便签仍指向
      // RESTRICTION_NO（PARTIAL 出口未释放它）。
      await deps.svc.onDecided(makeDecidedEvent({ approvalNo: 'APR-SD-2' }));

      expect(deps.approvalsService.list).toHaveBeenCalledWith(
        expect.objectContaining({ approvalNo: 'APR-SD-2' }),
      );
      expect(deps.restrictions.release).toHaveBeenCalledWith(
        RESTRICTION_NO,
        expect.objectContaining({ releaseApprovalNo: 'APR-SD-2' }),
        expect.anything(),
      );
      // 落地的是 CONFIRMED（第二张案），不是误落地成第一张案的 PARTIAL。
      expect(deps.restrictions.open).toHaveBeenCalledWith(
        expect.objectContaining({ cause: 'SANCTION_CONFIRMED' }),
        expect.anything(),
      );
      expect(deps.filings.openForSanction).toHaveBeenCalledWith(
        'CNMR', CUSTOMER_NO, 'EOCN_1', OPENED_AT, expect.any(String), expect.anything(),
      );
    });

    it('传给 openForSanction 的 requestId，与 SANCTION_DISPOSITION_LANDED 审计的 requestId 同值', async () => {
      const deps = buildDeps();
      withConfirmedSnapshot(deps);
      await deps.svc.onDecided(makeDecidedEvent());

      const [, , , , filingRequestId] = deps.filings.openForSanction.mock.calls[0];
      const landedCall = deps.auditLogsService.recordByActor.mock.calls.find(
        (c: any) => c[0].action === AuditActions.SANCTION_DISPOSITION_LANDED,
      );
      expect(landedCall).toBeDefined();
      expect(landedCall![0].requestId).toBe(filingRequestId);
    });
  });

  it('无 APPROVED 快照可查（快照丢失）→ 抛错，不静默吞掉', async () => {
    const { svc, approvalsService } = buildDeps();
    approvalsService.list.mockResolvedValue({ items: [] });

    await expect(svc.onDecided(makeDecidedEvent())).rejects.toThrow(/no APPROVED SANCTION_DISPOSITION case/);
  });
});
