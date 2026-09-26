import { BadRequestException } from '@nestjs/common';
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
    list: jest.fn(),
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
  it('提单：正门开 MLRO 单步审批，携带 outcome/summary/externalCaseRef/restrictionNo 快照，并写 SANCTION_DISPOSITION_REQUESTED 审计', async () => {
    const { svc, restrictions, approvalsService, auditLogsService } = buildDeps();

    const result = await svc.initiateDisposition(CUSTOMER_NO, 'PARTIAL', 'partial name match, needs ID', 'EOCN_ENTRY_1', actorContext());

    expect(result).toEqual({ approvalNo: 'APR-SD-1', restrictionNo: RESTRICTION_NO });
    expect(restrictions.findOpenByCause).toHaveBeenCalledWith(CUSTOMER_ID, 'SANCTION', null);
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
        }),
      }),
      expect.objectContaining({ reason: 'partial name match, needs ID' }),
      expect.objectContaining({ userId: 'uuid-compliance' }),
    );

    const [input] = auditLogsService.recordByActor.mock.calls[0];
    expect(input.action).toBe(AuditActions.SANCTION_DISPOSITION_REQUESTED);
    expect(input.actionDomain).toBe('CUSTOMER');
    expect(input.outcome).toBe(AuditOutcome.SUCCESS);
    expect(input.metadata).toEqual(expect.objectContaining({ outcome: 'PARTIAL', restrictionNo: RESTRICTION_NO }));
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

  it('二次定性：PARTIAL 之后同一张仍 OPEN 的 SANCTION 便签可再次提单', async () => {
    const { svc, restrictions, approvalsService } = buildDeps();
    // PARTIAL 出口不释放便签——第二次提单查到的仍是同一张 restrictionNo。
    restrictions.findOpenByCause.mockResolvedValue(buildRestrictionRow());

    const first = await svc.initiateDisposition(CUSTOMER_NO, 'PARTIAL', 'first pass: partial match', 'EOCN_ENTRY_1', actorContext());
    approvalsService.createAndSubmit.mockResolvedValueOnce({ approvalNo: 'APR-SD-2' } as any);
    const second = await svc.initiateDisposition(CUSTOMER_NO, 'CONFIRMED', 'EOCN instructed confirm', 'EOCN_ENTRY_1', actorContext());

    expect(first.restrictionNo).toBe(RESTRICTION_NO);
    expect(second.restrictionNo).toBe(RESTRICTION_NO);
    expect(approvalsService.createAndSubmit).toHaveBeenCalledTimes(2);
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

    it('驳回后维持待裁的便签仍是同一张——CLEARED 落地不新开便签', async () => {
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

    it('二次定性 CONFIRMED：此时解列的是原 SANCTION 便签（不是某张新便签）', async () => {
      const deps = buildDeps();
      // 二次定性场景：objectSnapshot 里的 restrictionNo 仍指向最初那张（PARTIAL 未释放它）。
      withConfirmedSnapshot(deps);
      await deps.svc.onDecided(makeDecidedEvent());
      expect(deps.restrictions.release).toHaveBeenCalledWith(
        RESTRICTION_NO,
        expect.objectContaining({ releaseApprovalNo: 'APR-SD-1' }),
        expect.anything(),
      );
    });
  });

  it('无 APPROVED 快照可查（快照丢失）→ 抛错，不静默吞掉', async () => {
    const { svc, approvalsService } = buildDeps();
    approvalsService.list.mockResolvedValue({ items: [] });

    await expect(svc.onDecided(makeDecidedEvent())).rejects.toThrow(/no APPROVED SANCTION_DISPOSITION case/);
  });
});
