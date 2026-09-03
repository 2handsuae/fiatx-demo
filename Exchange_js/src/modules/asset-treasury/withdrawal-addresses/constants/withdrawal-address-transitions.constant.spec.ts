import { assertWithdrawalAddressTransition, WithdrawalAddressAction, WITHDRAWAL_ADDRESS_TRANSITIONS } from './withdrawal-address-transitions.constant';

describe('提现地址状态迁移表（法二，spec §5）', () => {
  it('五条边', () => {
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
});
