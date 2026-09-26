import { BadRequestException } from '@nestjs/common';
import { ApprovalActionTypes } from '../approvals/constants/approval.constants';
import { ApprovalDecidedEvent } from '../approvals/approval-handler.base';
import { RiReplacementWorkflowService } from './ri-replacement-workflow.service';

const RI_NO = 'RI260101000001';

function actorContext() {
  return { actorType: 'ADMIN' as const, userId: 'uuid-compliance', userNo: 'ADM-COMPLIANCE', role: 'COMPLIANCE_OFFICER', roleCodes: ['COMPLIANCE_OFFICER'] };
}

function makeDecidedEvent(overrides: Partial<ApprovalDecidedEvent> = {}): ApprovalDecidedEvent {
  return {
    decision: 'APPROVED',
    actionType: ApprovalActionTypes.RI_REPLACEMENT,
    entityRef: RI_NO,
    approvalId: 'approval-id-1',
    approvalNo: 'APR-RI-1',
    traceId: 'trace-1',
    workflowType: 'RESPONSIBLE_INDIVIDUAL',
    decisionByUserId: 'uuid-sm-real',
    decisionByUserNo: 'ADM-SM',
    decisionByRole: 'SENIOR_MANAGEMENT_OFFICER',
    decisionReason: null,
    decidedAt: new Date().toISOString(),
    metadata: {},
    ...overrides,
  };
}

/** 行为化 mock——不是无脑 resolve：assertNoPendingReplacement 真的会按当前 mock 状态
 *  抛错，供「在途查重」用例断言开单被挡住（同 sanction-disposition-workflow 先例）。 */
function buildDeps() {
  const responsibleIndividuals = {
    assertNoPendingReplacement: jest.fn().mockResolvedValue(undefined),
    recordProposal: jest.fn().mockResolvedValue({ riNo: RI_NO }),
    applyReplacement: jest.fn().mockResolvedValue({ riNo: RI_NO }),
    clearReplacement: jest.fn().mockResolvedValue({ riNo: RI_NO }),
  } as any;
  const approvalsService = {
    createAndSubmit: jest.fn().mockResolvedValue({ approvalNo: 'APR-RI-1' }),
    list: jest.fn().mockResolvedValue({
      total: 1,
      items: [{ objectSnapshot: { newIncumbentName: 'Bob Lee', effectiveFrom: '2026-06-01T00:00:00.000Z', reason: 'Alice resigned', varaRef: 'VARA-REF-1' } }],
    }),
  } as any;

  const svc = new RiReplacementWorkflowService(responsibleIndividuals, approvalsService);
  return { svc, responsibleIndividuals, approvalsService };
}

describe('RiReplacementWorkflowService.initiateReplacement', () => {
  it('提单：先查重，再走正门开高管单步审批，携带提案快照，最后落 pendingApprovalNo（recordProposal）', async () => {
    const { svc, responsibleIndividuals, approvalsService } = buildDeps();

    const result = await svc.initiateReplacement(
      RI_NO,
      { newIncumbentName: 'Bob Lee', effectiveFrom: '2026-06-01T00:00:00.000Z', reason: 'Alice resigned', varaRef: 'VARA-REF-1' },
      actorContext(),
    );

    expect(result).toEqual({ approvalNo: 'APR-RI-1' });

    // 顺序断言（控制器裁定 R1）：assertNoPendingReplacement 必须发生在 createAndSubmit 之前。
    const assertOrder = responsibleIndividuals.assertNoPendingReplacement.mock.invocationCallOrder[0];
    const submitOrder = approvalsService.createAndSubmit.mock.invocationCallOrder[0];
    const proposeOrder = responsibleIndividuals.recordProposal.mock.invocationCallOrder[0];
    expect(assertOrder).toBeLessThan(submitOrder);
    expect(submitOrder).toBeLessThan(proposeOrder);

    expect(responsibleIndividuals.assertNoPendingReplacement).toHaveBeenCalledWith(RI_NO);
    expect(approvalsService.createAndSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: ApprovalActionTypes.RI_REPLACEMENT,
        entityRef: RI_NO,
        objectSnapshot: expect.objectContaining({ newIncumbentName: 'Bob Lee', effectiveFrom: '2026-06-01T00:00:00.000Z', reason: 'Alice resigned', varaRef: 'VARA-REF-1' }),
      }),
      expect.objectContaining({ reason: 'Alice resigned' }),
      expect.objectContaining({ userId: 'uuid-compliance' }),
    );
    // recordProposal 拿到的是审批开单后才存在的 approvalNo——不是提前伪造的。
    expect(responsibleIndividuals.recordProposal).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'uuid-compliance' }),
      RI_NO,
      'APR-RI-1',
      expect.objectContaining({ newIncumbentName: 'Bob Lee' }),
    );
  });

  it('该席位已有在途换人 → 不开审批单（assertNoPendingReplacement 抛错时冒泡，不吞）', async () => {
    const { svc, responsibleIndividuals, approvalsService } = buildDeps();
    responsibleIndividuals.assertNoPendingReplacement.mockRejectedValue(
      new BadRequestException(`Responsible individual ${RI_NO} already has a pending replacement (APR-OLD-1).`),
    );

    await expect(
      svc.initiateReplacement(RI_NO, { newIncumbentName: 'Bob Lee', effectiveFrom: '2026-06-01T00:00:00.000Z', reason: 'x' }, actorContext()),
    ).rejects.toThrow(BadRequestException);

    expect(approvalsService.createAndSubmit).not.toHaveBeenCalled();
    expect(responsibleIndividuals.recordProposal).not.toHaveBeenCalled();
  });
});

describe('RiReplacementWorkflowService.onDecided', () => {
  it('APPROVED：从审批单自带的提案载荷（同一 approvalNo）取值调用 applyReplacement，不调 clearReplacement', async () => {
    const { svc, responsibleIndividuals, approvalsService } = buildDeps();

    await svc.onDecided(makeDecidedEvent());

    expect(approvalsService.list).toHaveBeenCalledWith(
      expect.objectContaining({ actionType: ApprovalActionTypes.RI_REPLACEMENT, approvalNo: 'APR-RI-1', status: 'APPROVED' }),
    );
    expect(responsibleIndividuals.applyReplacement).toHaveBeenCalledWith(
      RI_NO, 'APR-RI-1',
      { newIncumbentName: 'Bob Lee', effectiveFrom: '2026-06-01T00:00:00.000Z', varaRef: 'VARA-REF-1' },
    );
    expect(responsibleIndividuals.clearReplacement).not.toHaveBeenCalled();
  });

  it.each(['DECLINED', 'CANCELLED', 'EXPIRED'] as const)(
    '%s：只调 clearReplacement（不换人），不查快照、不调 applyReplacement',
    async (decision) => {
      const { svc, responsibleIndividuals, approvalsService } = buildDeps();

      await svc.onDecided(makeDecidedEvent({ decision }));

      expect(approvalsService.list).not.toHaveBeenCalled();
      expect(responsibleIndividuals.applyReplacement).not.toHaveBeenCalled();
      expect(responsibleIndividuals.clearReplacement).toHaveBeenCalledWith(RI_NO, 'APR-RI-1', decision);
    },
  );

  it('二次校验：按 approvalNo 精确查快照，不依赖"最新一条=本次"的假设', async () => {
    const { svc, responsibleIndividuals, approvalsService } = buildDeps();
    const snapshotsByApprovalNo: Record<string, any> = {
      'APR-RI-1': { newIncumbentName: 'Bob Lee', effectiveFrom: '2026-06-01T00:00:00.000Z', reason: 'first', varaRef: 'V1' },
      'APR-RI-2': { newIncumbentName: 'Carol Ng', effectiveFrom: '2027-01-01T00:00:00.000Z', reason: 'second', varaRef: 'V2' },
    };
    approvalsService.list.mockImplementation(async (query: any) => {
      const snapshot = snapshotsByApprovalNo[query.approvalNo];
      return { total: snapshot ? 1 : 0, items: snapshot ? [{ objectSnapshot: snapshot }] : [] };
    });

    await svc.onDecided(makeDecidedEvent({ approvalNo: 'APR-RI-2' }));

    expect(responsibleIndividuals.applyReplacement).toHaveBeenCalledWith(
      RI_NO, 'APR-RI-2',
      { newIncumbentName: 'Carol Ng', effectiveFrom: '2027-01-01T00:00:00.000Z', varaRef: 'V2' },
    );
  });

  it('无 APPROVED 快照可查（快照丢失）→ 抛错，不静默吞掉', async () => {
    const { svc, approvalsService } = buildDeps();
    approvalsService.list.mockResolvedValue({ total: 0, items: [] });

    await expect(svc.onDecided(makeDecidedEvent())).rejects.toThrow(/no APPROVED RI_REPLACEMENT case/);
  });
});
