import { ApprovalActionTypes } from '../approvals/constants/approval.constants';
import { ApprovalDecidedEvent } from '../approvals/approval-handler.base';
import { ComplaintResolutionOutcomes } from './complaint.constants';
import { ComplaintResolutionWorkflowService } from './complaint-resolution-workflow.service';

const COMPLAINT_NO = 'CMP260101000001';

/** 波五：运营提、合规官批——propose() 的 actor 是运营，不是 RI 先例里的合规官。 */
function actorContext() {
  return { actorType: 'ADMIN' as const, userId: 'uuid-ops', userNo: 'ADM-OPS', role: 'OPS_OFFICER', roleCodes: ['OPS_OFFICER'] };
}

function makeDecidedEvent(overrides: Partial<ApprovalDecidedEvent> = {}): ApprovalDecidedEvent {
  return {
    decision: 'APPROVED',
    actionType: ApprovalActionTypes.COMPLAINT_RESOLUTION,
    entityRef: COMPLAINT_NO,
    approvalId: 'approval-id-1',
    approvalNo: 'APR-CMP-1',
    traceId: 'trace-1',
    workflowType: 'COMPLAINT',
    decisionByUserId: 'uuid-compliance-real',
    decisionByUserNo: 'ADM-COMPLIANCE',
    decisionByRole: 'COMPLIANCE_OFFICER',
    decisionReason: null,
    decidedAt: new Date().toISOString(),
    metadata: {},
    ...overrides,
  };
}

/** 行为化 mock——不是无脑 resolve（同 ri-replacement-workflow.service.spec.ts 先例）。 */
function buildDeps(o: { complaint?: any } = {}) {
  const complaints = {
    // 战役甲波五 T4（承接项B，T3 评审 Minor：propose 先开单后迁状态可留孤儿审批单——
    // 照 RI 先例「白开一张单不如提前拦」，propose() 在 createAndSubmit 之前先读投诉核状态）。
    findByNo: jest.fn().mockResolvedValue(o.complaint ?? { complaintNo: COMPLAINT_NO, currentStatus: 'INVESTIGATING' }),
    proposeResolution: jest.fn().mockResolvedValue({ complaintNo: COMPLAINT_NO }),
    applyResolution: jest.fn().mockResolvedValue({ complaintNo: COMPLAINT_NO }),
    rejectResolution: jest.fn().mockResolvedValue({ complaintNo: COMPLAINT_NO }),
  } as any;
  const approvalsService = {
    createAndSubmit: jest.fn().mockResolvedValue({ approvalNo: 'APR-CMP-1' }),
    list: jest.fn().mockResolvedValue({
      total: 1,
      items: [{ objectSnapshot: { complaintNo: COMPLAINT_NO, outcome: ComplaintResolutionOutcomes.UPHELD, resolutionText: 'Refund issued in full.' } }],
    }),
  } as any;

  const svc = new ComplaintResolutionWorkflowService(complaints, approvalsService);
  return { svc, complaints, approvalsService };
}

describe('ComplaintResolutionWorkflowService.propose', () => {
  it('提单：走正门开合规官单步审批，携带提案快照，再调 T2 proposeResolution（拿到 approvalNo 之后）', async () => {
    const { svc, complaints, approvalsService } = buildDeps();

    const result = await svc.propose(actorContext(), COMPLAINT_NO, {
      outcome: ComplaintResolutionOutcomes.UPHELD, resolutionText: 'Refund issued in full.',
    });

    expect(result).toEqual({ approvalNo: 'APR-CMP-1' });

    // 顺序断言（同 RI 先例 R1）：审批单开出之后才能调 proposeResolution（approvalNo 才存在）。
    const submitOrder = approvalsService.createAndSubmit.mock.invocationCallOrder[0];
    const proposeOrder = complaints.proposeResolution.mock.invocationCallOrder[0];
    expect(submitOrder).toBeLessThan(proposeOrder);

    // 战役甲波五 T4（承接项C，T3 评审 Minor）：objectSnapshot 精确 toEqual（恰三键），
    // 不用 objectContaining——防日后悄悄多塞一个字段（如 UUID）而测试照样绿。
    expect(approvalsService.createAndSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: ApprovalActionTypes.COMPLAINT_RESOLUTION,
        entityRef: COMPLAINT_NO,
        objectSnapshot: { complaintNo: COMPLAINT_NO, outcome: ComplaintResolutionOutcomes.UPHELD, resolutionText: 'Refund issued in full.' },
      }),
      expect.objectContaining({ reason: 'Refund issued in full.' }),
      expect.objectContaining({ userId: 'uuid-ops' }),
    );
    // proposeResolution 拿到的是审批开单后才存在的 approvalNo——不是提前伪造的。
    expect(complaints.proposeResolution).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'uuid-ops' }),
      COMPLAINT_NO,
      expect.objectContaining({ outcome: ComplaintResolutionOutcomes.UPHELD, resolutionText: 'Refund issued in full.' }),
      'APR-CMP-1',
    );
  });

  // 战役甲波五 T4（承接项B，T3 评审 Minor，照 RI 先例「白开一张单不如提前拦」）：
  // propose 在 createAndSubmit 之前先读投诉核 currentStatus ∈ {INVESTIGATING,
  // INVESTIGATING_EXTENDED}，不满足直接 400、不开单——不留孤儿审批单。
  it('预拦：投诉不在两调查态时（如 ACKNOWLEDGED）400，不开审批单、不调 T2 proposeResolution', async () => {
    const { svc, complaints, approvalsService } = buildDeps({
      complaint: { complaintNo: COMPLAINT_NO, currentStatus: 'ACKNOWLEDGED' },
    });

    await expect(svc.propose(actorContext(), COMPLAINT_NO, {
      outcome: ComplaintResolutionOutcomes.UPHELD, resolutionText: 'Refund issued in full.',
    })).rejects.toThrow(/must be under investigation/);

    expect(approvalsService.createAndSubmit).not.toHaveBeenCalled();
    expect(complaints.proposeResolution).not.toHaveBeenCalled();
  });

  it('预拦放行：INVESTIGATING_EXTENDED 也算两调查态之一，正常开单', async () => {
    const { svc, approvalsService } = buildDeps({
      complaint: { complaintNo: COMPLAINT_NO, currentStatus: 'INVESTIGATING_EXTENDED' },
    });

    await svc.propose(actorContext(), COMPLAINT_NO, {
      outcome: ComplaintResolutionOutcomes.UPHELD, resolutionText: 'Refund issued in full.',
    });

    expect(approvalsService.createAndSubmit).toHaveBeenCalledTimes(1);
  });
});

describe('ComplaintResolutionWorkflowService.onDecided', () => {
  it('APPROVED：从审批单自带的提案载荷（同一 approvalNo）取值调用 applyResolution，不调 rejectResolution', async () => {
    const { svc, complaints, approvalsService } = buildDeps();

    await svc.onDecided(makeDecidedEvent());

    expect(approvalsService.list).toHaveBeenCalledWith(
      expect.objectContaining({ actionType: ApprovalActionTypes.COMPLAINT_RESOLUTION, approvalNo: 'APR-CMP-1', status: 'APPROVED' }),
    );
    expect(complaints.applyResolution).toHaveBeenCalledWith(
      COMPLAINT_NO, 'APR-CMP-1',
      { outcome: ComplaintResolutionOutcomes.UPHELD, resolutionText: 'Refund issued in full.' },
    );
    expect(complaints.rejectResolution).not.toHaveBeenCalled();
  });

  it.each([
    ['DECLINED', 'REJECTED'],
    ['CANCELLED', 'CANCELLED'],
    ['EXPIRED', 'EXPIRED'],
  ] as const)(
    '%s：只调 rejectResolution(decision=%s)，不查快照、不调 applyResolution——ApprovalHandlerBase 的 ' +
      'DECLINED 在这里翻译成 T2 rejectResolution 认得的 REJECTED（两处词表撞名不同词，文件头注释）',
    async (decision, expectedArg) => {
      const { svc, complaints, approvalsService } = buildDeps();

      await svc.onDecided(makeDecidedEvent({ decision }));

      expect(approvalsService.list).not.toHaveBeenCalled();
      expect(complaints.applyResolution).not.toHaveBeenCalled();
      expect(complaints.rejectResolution).toHaveBeenCalledWith(COMPLAINT_NO, 'APR-CMP-1', expectedArg);
    },
  );

  it('二次校验：按 approvalNo 精确查快照，不依赖"最新一条=本次"的假设', async () => {
    const { svc, complaints, approvalsService } = buildDeps();
    const snapshotsByApprovalNo: Record<string, any> = {
      'APR-CMP-1': { complaintNo: COMPLAINT_NO, outcome: ComplaintResolutionOutcomes.UPHELD, resolutionText: 'first' },
      'APR-CMP-2': { complaintNo: COMPLAINT_NO, outcome: ComplaintResolutionOutcomes.PARTIALLY_UPHELD, resolutionText: 'second' },
    };
    approvalsService.list.mockImplementation(async (query: any) => {
      const snapshot = snapshotsByApprovalNo[query.approvalNo];
      return { total: snapshot ? 1 : 0, items: snapshot ? [{ objectSnapshot: snapshot }] : [] };
    });

    await svc.onDecided(makeDecidedEvent({ approvalNo: 'APR-CMP-2' }));

    expect(complaints.applyResolution).toHaveBeenCalledWith(
      COMPLAINT_NO, 'APR-CMP-2',
      { outcome: ComplaintResolutionOutcomes.PARTIALLY_UPHELD, resolutionText: 'second' },
    );
  });

  it('无 APPROVED 快照可查（快照丢失）→ 抛错，不静默吞掉', async () => {
    const { svc, approvalsService } = buildDeps();
    approvalsService.list.mockResolvedValue({ total: 0, items: [] });

    await expect(svc.onDecided(makeDecidedEvent())).rejects.toThrow(/no APPROVED COMPLAINT_RESOLUTION case/);
  });
});
