// 战役乙波一 T3 · LpProfileWorkflowService 行为测试（照 RiReplacementWorkflowService.spec.ts
// 先例：直接 new 实例 + 行为化 mock，不用 NestJS TestingModule——本文件只有两个依赖，
// 用不上 DI 容器）。
import { ConflictException } from '@nestjs/common';
import { LpProfileWorkflowService } from './lp-profile-workflow.service';
import { LpProfileStatus } from './dto/lp-profile.dto';
import { ApprovalActionTypes, ApprovalStatuses } from '../../governance/approvals/constants/approval.constants';
import { ApprovalDecidedEvent } from '../../governance/approvals/approval-handler.base';

const LP_NO = 'LPP260101000001';

const treasury = { actorType: 'ADMIN' as const, userId: 'uuid-treasury', userNo: 'ADM-TREASURY', role: 'TREASURY_OFFICER', roleCodes: ['TREASURY_OFFICER'] };

const baseRow = {
  lpNo: LP_NO,
  name: 'Falcon Liquidity FZE',
  fiatBankName: 'Emirates NBD',
  fiatIban: 'AE070331234567890123456',
  cryptoNetwork: 'TRON',
  cryptoAddress: 'TXfake00000000000000000000000001',
  agreementRef: 'AGR-2026-LP-001',
  status: LpProfileStatus.PENDING_APPROVAL,
  approvalNo: null as string | null,
};

function makeDecidedEvent(overrides: Partial<ApprovalDecidedEvent> = {}): ApprovalDecidedEvent {
  return {
    decision: 'APPROVED',
    actionType: ApprovalActionTypes.LP_PROFILE_APPROVAL,
    entityRef: LP_NO,
    approvalId: 'causation-id-1',
    approvalNo: 'APR-LP-1',
    traceId: 'trace-1',
    workflowType: 'LP_PROFILE',
    decisionByUserId: 'uuid-cfo',
    decisionByUserNo: 'ADM-CFO',
    decisionByRole: 'CFO',
    decisionReason: null,
    decidedAt: new Date().toISOString(),
    metadata: {},
    ...overrides,
  };
}

/** 行为化 mock：list() 真按 query 分流（不是无脑常量），供「在途查重」与「按 approvalNo
 *  精确查快照」两类用例断言用真实条件驱动，不是巧合对上。 */
function buildDeps() {
  const profiles = {
    create: jest.fn(async () => ({ ...baseRow })),
    findByNo: jest.fn(async () => ({ ...baseRow })),
    assertActiveByNo: jest.fn(async () => undefined),
    transition: jest.fn(async (_lpNo: string, to: string) => ({ ...baseRow, status: to })),
    stampApprovalNo: jest.fn(async () => undefined),
    applySettlementChange: jest.fn(async () => ({ ...baseRow, status: LpProfileStatus.ACTIVE })),
    recordChangeProposed: jest.fn(async () => undefined),
    recordChangeRejected: jest.fn(async () => undefined),
  } as any;

  const approvalCases: Record<string, { total: number; items: any[] }> = {};
  const approvals = {
    createAndSubmit: jest.fn(async () => ({ approvalNo: 'APR-LP-1' })),
    list: jest.fn(async (query: any) => {
      if (query.status === ApprovalStatuses.PENDING) {
        return approvalCases[`pending:${query.entityRef}:${query.actionType}`] ?? { total: 0, items: [] };
      }
      if (query.approvalNo) {
        return approvalCases[query.approvalNo] ?? { total: 0, items: [] };
      }
      return { total: 0, items: [] };
    }),
    __seedPending: (entityRef: string, actionType: string) => {
      approvalCases[`pending:${entityRef}:${actionType}`] = { total: 1, items: [{ approvalNo: 'APR-OLD-1' }] };
    },
    __seedApproved: (approvalNo: string, objectSnapshot: unknown) => {
      approvalCases[approvalNo] = { total: 1, items: [{ objectSnapshot }] };
    },
  } as any;

  const svc = new LpProfileWorkflowService(profiles, approvals);
  return { svc, profiles, approvals };
}

describe('LpProfileWorkflowService.initiateCreate', () => {
  it('建档：create → createAndSubmit（零 UUID 快照）→ stampApprovalNo，按序', async () => {
    const { svc, profiles, approvals } = buildDeps();

    const result = await svc.initiateCreate(
      { name: 'Falcon Liquidity FZE', fiatBankName: 'Emirates NBD', fiatIban: 'AE070331234567890123456', cryptoNetwork: 'TRON', cryptoAddress: 'TXfake00000000000000000000000001', agreementRef: 'AGR-2026-LP-001', reason: 'Onboarding' },
      treasury,
    );

    expect(result).toEqual({ lpNo: LP_NO, approvalNo: 'APR-LP-1', status: LpProfileStatus.PENDING_APPROVAL });

    const createOrder = profiles.create.mock.invocationCallOrder[0];
    const submitOrder = approvals.createAndSubmit.mock.invocationCallOrder[0];
    const stampOrder = profiles.stampApprovalNo.mock.invocationCallOrder[0];
    expect(createOrder).toBeLessThan(submitOrder);
    expect(submitOrder).toBeLessThan(stampOrder);

    expect(approvals.createAndSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: ApprovalActionTypes.LP_PROFILE_APPROVAL,
        entityRef: LP_NO,
        objectSnapshot: { lpNo: LP_NO, name: 'Falcon Liquidity FZE', fiatIban: 'AE070331234567890123456', cryptoAddress: 'TXfake00000000000000000000000001', agreementRef: 'AGR-2026-LP-001' },
      }),
      expect.objectContaining({ reason: 'Onboarding' }),
      treasury,
    );
    expect(profiles.stampApprovalNo).toHaveBeenCalledWith(LP_NO, 'APR-LP-1');
  });
});

describe('LpProfileWorkflowService.onDecided — actionType=LP_PROFILE_APPROVAL', () => {
  it('APPROVED → transition(ACTIVE)，带 approvalNo/causationId', async () => {
    const { svc, profiles } = buildDeps();
    await svc.onDecided(makeDecidedEvent({ decision: 'APPROVED' }));
    expect(profiles.transition).toHaveBeenCalledWith(LP_NO, LpProfileStatus.ACTIVE, {}, { approvalNo: 'APR-LP-1', causationId: 'causation-id-1' });
  });

  it('DECLINED → transition(REJECTED)，reason 取 decisionReason', async () => {
    const { svc, profiles } = buildDeps();
    await svc.onDecided(makeDecidedEvent({ decision: 'DECLINED', decisionReason: 'Sanctions hit on beneficial owner' }));
    expect(profiles.transition).toHaveBeenCalledWith(
      LP_NO, LpProfileStatus.REJECTED, {},
      { approvalNo: 'APR-LP-1', causationId: 'causation-id-1', reason: 'Sanctions hit on beneficial owner' },
    );
  });

  it('EXPIRED → transition(REJECTED)，reason="Approval expired"', async () => {
    const { svc, profiles } = buildDeps();
    await svc.onDecided(makeDecidedEvent({ decision: 'EXPIRED', decisionReason: null }));
    expect(profiles.transition).toHaveBeenCalledWith(
      LP_NO, LpProfileStatus.REJECTED, {},
      { approvalNo: 'APR-LP-1', causationId: 'causation-id-1', reason: 'Approval expired' },
    );
  });

  it('CANCELLED → 撤回口自己收口，不调 transition', async () => {
    const { svc, profiles } = buildDeps();
    await svc.onDecided(makeDecidedEvent({ decision: 'CANCELLED' }));
    expect(profiles.transition).not.toHaveBeenCalled();
  });
});

describe('LpProfileWorkflowService.proposeSettlementChange', () => {
  const dto = { fiatIban: 'AE070331234567890999999', reason: 'Bank switched correspondent' };

  it('守卫 ACTIVE → 查在途变更审批（无）→ createAndSubmit（新旧坐标对照，零 UUID）→ recordChangeProposed', async () => {
    const { svc, profiles, approvals } = buildDeps();

    const result = await svc.proposeSettlementChange(LP_NO, dto, treasury);

    expect(profiles.assertActiveByNo).toHaveBeenCalledWith(LP_NO);
    expect(approvals.list).toHaveBeenCalledWith(expect.objectContaining({ actionType: ApprovalActionTypes.LP_PROFILE_CHANGE, entityRef: LP_NO, status: ApprovalStatuses.PENDING }));

    const before = { fiatBankName: 'Emirates NBD', fiatIban: 'AE070331234567890123456', cryptoNetwork: 'TRON', cryptoAddress: 'TXfake00000000000000000000000001' };
    const after = { fiatBankName: 'Emirates NBD', fiatIban: 'AE070331234567890999999', cryptoNetwork: 'TRON', cryptoAddress: 'TXfake00000000000000000000000001' };
    expect(approvals.createAndSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ actionType: ApprovalActionTypes.LP_PROFILE_CHANGE, entityRef: LP_NO, objectSnapshot: { lpNo: LP_NO, before, after } }),
      expect.objectContaining({ reason: dto.reason }),
      treasury,
    );
    expect(profiles.recordChangeProposed).toHaveBeenCalledWith(
      expect.objectContaining({ lpNo: LP_NO }),
      expect.objectContaining({ before, after, reason: dto.reason }),
      treasury,
      'APR-LP-1',
    );
    expect(result).toEqual({ lpNo: LP_NO, approvalNo: 'APR-LP-1', status: LpProfileStatus.PENDING_APPROVAL });
  });

  it('已有在途变更审批 → ConflictException，不开新单', async () => {
    const { svc, approvals } = buildDeps();
    approvals.__seedPending(LP_NO, ApprovalActionTypes.LP_PROFILE_CHANGE);

    await expect(svc.proposeSettlementChange(LP_NO, dto, treasury)).rejects.toThrow(ConflictException);
    expect(approvals.createAndSubmit).not.toHaveBeenCalled();
  });
});

describe('LpProfileWorkflowService.onDecided — actionType=LP_PROFILE_CHANGE', () => {
  const after = { fiatBankName: 'Emirates NBD', fiatIban: 'AE070331234567890999999', cryptoNetwork: 'TRON', cryptoAddress: 'TXfake00000000000000000000000001' };

  it('APPROVED → 从审批单 objectSnapshot 读 after，applySettlementChange 落新坐标', async () => {
    const { svc, profiles, approvals } = buildDeps();
    approvals.__seedApproved('APR-LP-2', { lpNo: LP_NO, before: {}, after });

    await svc.onDecided(makeDecidedEvent({ actionType: ApprovalActionTypes.LP_PROFILE_CHANGE, approvalNo: 'APR-LP-2', decision: 'APPROVED' }));

    expect(approvals.list).toHaveBeenCalledWith(expect.objectContaining({ actionType: ApprovalActionTypes.LP_PROFILE_CHANGE, approvalNo: 'APR-LP-2', status: ApprovalStatuses.APPROVED }));
    expect(profiles.applySettlementChange).toHaveBeenCalledWith(LP_NO, { ...after, approvalNo: 'APR-LP-2', causationId: 'causation-id-1' });
    expect(profiles.recordChangeRejected).not.toHaveBeenCalled();
  });

  it('DECLINED → 坐标不动，recordChangeRejected 留痕，不调 applySettlementChange', async () => {
    const { svc, profiles } = buildDeps();

    await svc.onDecided(makeDecidedEvent({ actionType: ApprovalActionTypes.LP_PROFILE_CHANGE, approvalNo: 'APR-LP-2', decision: 'DECLINED', decisionReason: 'Beneficiary mismatch' }));

    expect(profiles.applySettlementChange).not.toHaveBeenCalled();
    expect(profiles.recordChangeRejected).toHaveBeenCalledWith(
      expect.objectContaining({ lpNo: LP_NO }), 'APR-LP-2', 'causation-id-1', 'Beneficiary mismatch',
    );
  });

  it('EXPIRED → 坐标不动，recordChangeRejected 留痕，reason="Settlement-change approval expired"', async () => {
    const { svc, profiles } = buildDeps();

    await svc.onDecided(makeDecidedEvent({ actionType: ApprovalActionTypes.LP_PROFILE_CHANGE, approvalNo: 'APR-LP-2', decision: 'EXPIRED', decisionReason: null }));

    expect(profiles.applySettlementChange).not.toHaveBeenCalled();
    expect(profiles.recordChangeRejected).toHaveBeenCalledWith(
      expect.objectContaining({ lpNo: LP_NO }), 'APR-LP-2', 'causation-id-1', 'Settlement-change approval expired',
    );
  });

  it('CANCELLED → 撤回口自己收口，两个落地方法都不调', async () => {
    const { svc, profiles } = buildDeps();

    await svc.onDecided(makeDecidedEvent({ actionType: ApprovalActionTypes.LP_PROFILE_CHANGE, decision: 'CANCELLED' }));

    expect(profiles.applySettlementChange).not.toHaveBeenCalled();
    expect(profiles.recordChangeRejected).not.toHaveBeenCalled();
  });
});

describe('LpProfileWorkflowService.suspend / reactivate', () => {
  it('suspend：直接 transition(SUSPENDED) + actor 审计，不建审批', async () => {
    const { svc, profiles, approvals } = buildDeps();
    const result = await svc.suspend(LP_NO, { reason: 'Underperforming this quarter' }, treasury);
    expect(profiles.transition).toHaveBeenCalledWith(LP_NO, LpProfileStatus.SUSPENDED, {}, { actor: treasury, reason: 'Underperforming this quarter' });
    expect(approvals.createAndSubmit).not.toHaveBeenCalled();
    expect(result).toEqual({ lpNo: LP_NO, status: LpProfileStatus.SUSPENDED });
  });

  it('reactivate：直接 transition(ACTIVE) + actor 审计，不建审批', async () => {
    const { svc, profiles, approvals } = buildDeps();
    const result = await svc.reactivate(LP_NO, { reason: 'Back in good standing' }, treasury);
    expect(profiles.transition).toHaveBeenCalledWith(LP_NO, LpProfileStatus.ACTIVE, {}, { actor: treasury, reason: 'Back in good standing' });
    expect(approvals.createAndSubmit).not.toHaveBeenCalled();
    expect(result).toEqual({ lpNo: LP_NO, status: LpProfileStatus.ACTIVE });
  });
});
