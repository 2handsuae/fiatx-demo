import {
  assertLpPayoutAddressTransition,
  LpPayoutAddressAction as A,
  LpPayoutAddressStatus as S,
  LP_PAYOUT_ADDRESS_TERMINAL_STATUSES,
  LP_PAYOUT_ADDRESS_TRANSITIONS,
} from './lp-payout-address-transitions.constant';

describe('LP 打款地址状态迁移表（LP 两步准入 Task 3）', () => {
  it('数字判据：6 态 / 6 边（展开计数）/ 6 动作', () => {
    const states = Object.keys(LP_PAYOUT_ADDRESS_TRANSITIONS);
    const edges = states.flatMap((s) => Object.entries(LP_PAYOUT_ADDRESS_TRANSITIONS[s]).map(([action, to]) => `${s}+${action}->${to}`));
    expect([...states].sort()).toEqual(Object.values(S).sort());
    expect(Object.values(S)).toHaveLength(6);
    expect(Object.values(A)).toHaveLength(6);
    expect([...edges].sort()).toEqual([
      'ACTIVE+DEACTIVATE->DEACTIVATED',
      'ACTIVE+SUSPEND->SUSPENDED',
      'PENDING_APPROVAL+APPROVE->ACTIVE',
      'PENDING_APPROVAL+CANCEL->CANCELLED',
      'PENDING_APPROVAL+REJECT->REJECTED',
      'SUSPENDED+REACTIVATE->ACTIVE',
    ]);
  });

  it('六条边各自返回目标态', () => {
    expect(assertLpPayoutAddressTransition(S.PENDING_APPROVAL, A.APPROVE)).toBe(S.ACTIVE);
    expect(assertLpPayoutAddressTransition(S.PENDING_APPROVAL, A.REJECT)).toBe(S.REJECTED);
    expect(assertLpPayoutAddressTransition(S.PENDING_APPROVAL, A.CANCEL)).toBe(S.CANCELLED);
    expect(assertLpPayoutAddressTransition(S.ACTIVE, A.SUSPEND)).toBe(S.SUSPENDED);
    expect(assertLpPayoutAddressTransition(S.SUSPENDED, A.REACTIVATE)).toBe(S.ACTIVE);
    expect(assertLpPayoutAddressTransition(S.ACTIVE, A.DEACTIVATE)).toBe(S.DEACTIVATED);
  });

  it('穷举 6×6 = 36 个 (态, 动作) 组合：恰好 6 个合法，其余 30 个全部抛 409 Invalid transition', () => {
    let legal = 0;
    let illegal = 0;
    for (const from of Object.values(S)) {
      for (const action of Object.values(A)) {
        try {
          assertLpPayoutAddressTransition(from, action);
          legal += 1;
        } catch (e: any) {
          expect(e.getStatus()).toBe(409);
          expect(e.message).toMatch(/Invalid transition/);
          illegal += 1;
        }
      }
    }
    expect(legal).toBe(6);
    expect(illegal).toBe(30);
  });

  it('终态 = REJECTED / CANCELLED / DEACTIVATED，出边表为空（登记即拒是落点计算不是边）', () => {
    expect([...LP_PAYOUT_ADDRESS_TERMINAL_STATUSES].sort()).toEqual([S.CANCELLED, S.DEACTIVATED, S.REJECTED].sort());
    for (const s of LP_PAYOUT_ADDRESS_TERMINAL_STATUSES) expect(LP_PAYOUT_ADDRESS_TRANSITIONS[s]).toEqual({});
  });

  it('关键禁边：SUSPENDED 不能直接 DEACTIVATE；ACTIVE 不能 APPROVE（自循环）；DEACTIVATED 不能复活', () => {
    expect(() => assertLpPayoutAddressTransition(S.SUSPENDED, A.DEACTIVATE)).toThrow(/Invalid transition/);
    expect(() => assertLpPayoutAddressTransition(S.ACTIVE, A.APPROVE)).toThrow(/Invalid transition/);
    expect(() => assertLpPayoutAddressTransition(S.DEACTIVATED, A.REACTIVATE)).toThrow(/Invalid transition/);
  });
});
