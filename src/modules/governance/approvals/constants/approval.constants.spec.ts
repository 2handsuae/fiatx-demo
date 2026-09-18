import { ApprovalActionTypes, DEFAULT_APPROVAL_POLICIES } from './approval.constants';

describe('平账 B 批：补单三审批策略', () => {
  it.each([
    ApprovalActionTypes.DEPOSIT_SUPPLEMENT,
    ApprovalActionTypes.DEPOSIT_CLAWBACK,
    ApprovalActionTypes.WITHDRAW_RETURN_CLAIM,
  ])('%s = CFO 单步 / 48h / 可撤', (type) => {
    const p = (DEFAULT_APPROVAL_POLICIES as any)[type];
    expect(p.steps).toEqual([{ stepNo: 1, roles: ['CFO'] }]);
    expect(p.timeoutHours).toBe(48);
    expect(p.allowCancel).toBe(true);
  });
});
