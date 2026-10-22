import { assertWithdrawalAddressTransition, WithdrawalAddressAction, WITHDRAWAL_ADDRESS_TRANSITIONS } from './withdrawal-address-transitions.constant';

describe('提现地址状态迁移表（法二，spec §5）', () => {
  it('五条既有边（波一前）', () => {
    expect(assertWithdrawalAddressTransition('PENDING_ACTIVATION', WithdrawalAddressAction.ACTIVATE)).toBe('ACTIVE');
    expect(assertWithdrawalAddressTransition('PENDING_ACTIVATION', WithdrawalAddressAction.CANCEL)).toBe('CANCELLED');
    expect(assertWithdrawalAddressTransition('ACTIVE', WithdrawalAddressAction.SUSPEND)).toBe('SUSPENDED');
    expect(assertWithdrawalAddressTransition('SUSPENDED', WithdrawalAddressAction.UNSUSPEND)).toBe('ACTIVE');
    expect(assertWithdrawalAddressTransition('ACTIVE', WithdrawalAddressAction.DEACTIVATE)).toBe('DEACTIVATED');
  });
  it('终态无出边；非法跃迁抛 409 Invalid transition', () => {
    expect(WITHDRAWAL_ADDRESS_TRANSITIONS.CANCELLED).toEqual({});
    expect(WITHDRAWAL_ADDRESS_TRANSITIONS.DEACTIVATED).toEqual({});
    expect(() => assertWithdrawalAddressTransition('ACTIVE', WithdrawalAddressAction.ACTIVATE)).toThrow(/Invalid transition/);
    expect(() => assertWithdrawalAddressTransition('SUSPENDED', WithdrawalAddressAction.DEACTIVATE)).toThrow(/Invalid transition/);
    expect(() => assertWithdrawalAddressTransition('PENDING_ACTIVATION', WithdrawalAddressAction.SUSPEND)).toThrow(/Invalid transition/);
  });

  // 2026-10-22 对手方波一：+PENDING_VERIFICATION / +REJECTED，+RELEASE / +REJECT，共 7 态 9 边 7 动作
  describe('波一扩边', () => {
    it('PENDING_VERIFICATION 三条出边：RELEASE→PENDING_ACTIVATION / REJECT→REJECTED / CANCEL→CANCELLED', () => {
      expect(assertWithdrawalAddressTransition('PENDING_VERIFICATION', WithdrawalAddressAction.RELEASE)).toBe('PENDING_ACTIVATION');
      expect(assertWithdrawalAddressTransition('PENDING_VERIFICATION', WithdrawalAddressAction.REJECT)).toBe('REJECTED');
      expect(assertWithdrawalAddressTransition('PENDING_VERIFICATION', WithdrawalAddressAction.CANCEL)).toBe('CANCELLED');
    });
    it('PENDING_ACTIVATION 新增 REJECT→REJECTED', () => {
      expect(assertWithdrawalAddressTransition('PENDING_ACTIVATION', WithdrawalAddressAction.REJECT)).toBe('REJECTED');
    });
    it('PENDING_VERIFICATION 不能直接 ACTIVATE（必须先 RELEASE 过冷却）', () => {
      expect(() => assertWithdrawalAddressTransition('PENDING_VERIFICATION', WithdrawalAddressAction.ACTIVATE)).toThrow(/Invalid transition/);
    });
    it('ACTIVE 不能 REJECT；PENDING_ACTIVATION 不能 RELEASE（⚡喂 RED 打在非 pending 态必须被表拒绝）', () => {
      expect(() => assertWithdrawalAddressTransition('ACTIVE', WithdrawalAddressAction.REJECT)).toThrow(/Invalid transition/);
      expect(() => assertWithdrawalAddressTransition('SUSPENDED', WithdrawalAddressAction.REJECT)).toThrow(/Invalid transition/);
      expect(() => assertWithdrawalAddressTransition('PENDING_ACTIVATION', WithdrawalAddressAction.RELEASE)).toThrow(/Invalid transition/);
    });
    it('REJECTED 是终态：任意动作都抛、出边表为空（不可复活）', () => {
      expect(WITHDRAWAL_ADDRESS_TRANSITIONS.REJECTED).toEqual({});
      for (const action of Object.values(WithdrawalAddressAction)) {
        expect(() => assertWithdrawalAddressTransition('REJECTED', action)).toThrow(/Invalid transition/);
      }
    });
    it('数字判据：7 态 / 9 边（展开计数）/ 7 动作', () => {
      const states = Object.keys(WITHDRAWAL_ADDRESS_TRANSITIONS);
      const edges = states.flatMap((s) => Object.entries(WITHDRAWAL_ADDRESS_TRANSITIONS[s]).map(([action, to]) => `${s}+${action}->${to}`));
      expect(states).toHaveLength(7);
      expect(edges).toHaveLength(9);
      expect(Object.values(WithdrawalAddressAction)).toHaveLength(7);
    });
  });
});
