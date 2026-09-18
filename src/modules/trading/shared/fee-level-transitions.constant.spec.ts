import { assertFeeLevelTransition, FeeLevelAction, assertFeeChangeRequestTransition, FeeChangeRequestAction, FEE_LEVEL_TRANSITIONS } from './fee-level-transitions.constant';

describe('费率等级 / 变更单迁移表（两族共用，spec §7）', () => {
  it('等级四边', () => {
    expect(assertFeeLevelTransition('PENDING_APPROVAL', FeeLevelAction.APPROVE)).toBe('ACTIVE');
    expect(assertFeeLevelTransition('PENDING_APPROVAL', FeeLevelAction.DECLINE)).toBe('REJECTED');
    expect(assertFeeLevelTransition('PENDING_APPROVAL', FeeLevelAction.CANCEL)).toBe('CANCELLED');
    expect(assertFeeLevelTransition('ACTIVE', FeeLevelAction.RETIRE)).toBe('RETIRED');
  });
  it('REJECTED / CANCELLED / RETIRED 终态；FAILED 不是状态', () => {
    expect(FEE_LEVEL_TRANSITIONS.REJECTED).toEqual({});
    expect(FEE_LEVEL_TRANSITIONS.RETIRED).toEqual({});
    expect((FEE_LEVEL_TRANSITIONS as any).FAILED).toBeUndefined();
    expect(() => assertFeeLevelTransition('RETIRED', FeeLevelAction.RETIRE)).toThrow(/Invalid transition/);
    expect(() => assertFeeLevelTransition('PENDING_APPROVAL', FeeLevelAction.RETIRE)).toThrow(/Invalid transition/);
  });
  it('变更单四边，EXPIRED 单独终态', () => {
    expect(assertFeeChangeRequestTransition('PENDING_APPROVAL', FeeChangeRequestAction.APPROVE)).toBe('APPROVED');
    expect(assertFeeChangeRequestTransition('PENDING_APPROVAL', FeeChangeRequestAction.DECLINE)).toBe('REJECTED');
    expect(assertFeeChangeRequestTransition('PENDING_APPROVAL', FeeChangeRequestAction.CANCEL)).toBe('CANCELLED');
    expect(assertFeeChangeRequestTransition('PENDING_APPROVAL', FeeChangeRequestAction.EXPIRE)).toBe('EXPIRED');
    expect(() => assertFeeChangeRequestTransition('APPROVED', FeeChangeRequestAction.CANCEL)).toThrow(/Invalid transition/);
  });
});
