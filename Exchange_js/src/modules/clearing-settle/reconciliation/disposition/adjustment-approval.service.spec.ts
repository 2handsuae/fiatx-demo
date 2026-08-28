import { AdjustmentApprovalService } from './adjustment-approval.service';
import {
  ApprovalActionTypes,
  DEFAULT_APPROVAL_POLICIES,
} from '../../../governance/approvals/constants/approval.constants';

describe('AdjustmentApprovalService', () => {
  it('只认领 RECON_ADJUSTMENT_POST', () => {
    const svc = new AdjustmentApprovalService(null as any, null as any);
    expect(svc.actionType).toBe('RECON_ADJUSTMENT_POST');
    expect(svc.workflowType).toBe('RECON');
  });

  it('批准事件转调 onApproved（单号取自 entityRef）', async () => {
    const adjustments = { onApproved: jest.fn(), onRejected: jest.fn() };
    const svc = new AdjustmentApprovalService(adjustments as any, null as any);
    await svc.handleApproved({
      // 真实字段名是 decisionByUserId（ApprovalDecisionEvent，approval.constants.ts:135），
      // 不是 decidedByUserId——brief 草稿这里手误，已按真实源码订正，否则生产环境永远落 'SYSTEM'。
      actionType: 'RECON_ADJUSTMENT_POST', entityRef: 'ADJ2608280001', decisionByUserId: 'U_OPS',
    } as any);
    expect(adjustments.onApproved).toHaveBeenCalledWith('ADJ2608280001', 'U_OPS');
  });

  it('驳回事件转调 onRejected', async () => {
    const adjustments = { onApproved: jest.fn(), onRejected: jest.fn() };
    const svc = new AdjustmentApprovalService(adjustments as any, null as any);
    await svc.handleRejected({
      actionType: 'RECON_ADJUSTMENT_POST', entityRef: 'ADJ2608280001', decisionByUserId: 'U_OPS',
    } as any);
    expect(adjustments.onRejected).toHaveBeenCalledWith('ADJ2608280001', 'U_OPS');
  });

  it('不是自己的 actionType 就不动手', async () => {
    const adjustments = { onApproved: jest.fn(), onRejected: jest.fn() };
    const svc = new AdjustmentApprovalService(adjustments as any, null as any);
    await svc.handleApproved({ actionType: 'SOMETHING_ELSE', entityRef: 'X' } as any);
    expect(adjustments.onApproved).not.toHaveBeenCalled();
  });
});

// 补测 A —— 铁律②「门不可绕」的落点：默认策略被删掉、被改成两步、或角色被换掉，
// 必须有测试当场变红；运行时不报错要等到真提交审批才会炸（"No steps configured"），那是事故现场。
describe('RECON_ADJUSTMENT_POST 默认审批策略', () => {
  it('单步、角色恰好是 OPS_OFFICER', () => {
    const policy = DEFAULT_APPROVAL_POLICIES[ApprovalActionTypes.RECON_ADJUSTMENT_POST];
    expect(policy).toBeDefined();
    expect(policy.steps).toEqual([{ stepNo: 1, roles: ['OPS_OFFICER'] }]);
  });
});
