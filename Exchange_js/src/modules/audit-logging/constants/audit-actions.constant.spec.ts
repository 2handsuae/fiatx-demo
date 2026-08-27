import {
  AuditActions,
  buildInternalFundStateAction,
} from './audit-actions.constant';

describe('INTERNAL_FUND short-name actions', () => {
  it('exposes new short-name constants', () => {
    expect(AuditActions.SIGNING).toBe('SIGNING');
    expect(AuditActions.BROADCASTED).toBe('BROADCASTED');
    expect(AuditActions.CONFIRMING).toBe('CONFIRMING');
    expect(AuditActions.CONFIRMED).toBe('CONFIRMED');
    expect(AuditActions.CLEARED).toBe('CLEARED');
    expect(AuditActions.TIMED_OUT).toBe('TIMED_OUT');
    expect(AuditActions.REQUESTED).toBe('REQUESTED');
    expect(AuditActions.SUCCEEDED).toBe('SUCCEEDED');
    expect(AuditActions.FAILED).toBe('FAILED');
    expect(AuditActions.CANCELLED).toBe('CANCELLED');
    expect(AuditActions.REORGED).toBe('REORGED');
    // Reused from Spec #3 (Outstanding/FeeAccrual):
    expect(AuditActions.CREATED).toBe('CREATED');
  });
});

describe('buildInternalFundStateAction', () => {
  it.each([
    ['CREATED', 'CREATED'],
    ['SIGNING', 'SIGNING'],
    ['BROADCASTED', 'BROADCASTED'],
    ['CONFIRMING', 'CONFIRMING'],
    ['CONFIRMED', 'CONFIRMED'],
    ['CLEAR', 'CLEARED'],
    ['FAILED', 'FAILED'],
    ['TIMEOUT', 'TIMED_OUT'],
    ['CANCELLED', 'CANCELLED'],
    ['RETURNED', 'REORGED'],
  ])('maps %s → %s', (status, expected) => {
    expect(buildInternalFundStateAction(status)).toBe(expected);
  });

  it('falls back to UPPERCASE status for unknown values', () => {
    expect(buildInternalFundStateAction('unknown_state')).toBe('UNKNOWN_STATE');
  });
});

import { V1_AUDIT_ACTIONS, V4_DEPOSIT_AUDIT_ACTIONS, V5_WITHDRAW_AUDIT_ACTIONS, V6_SWAP_AUDIT_ACTIONS, DEPRECATED_AUDIT_ACTIONS } from './audit-actions.constant';
import { AuditCorrelationMode } from '../dto/audit-log.dto';

describe('第一批 · V1 词表守则', () => {
  const codes = Object.keys(V1_AUDIT_ACTIONS);

  it('恰好 45 个码', () => {
    expect(codes).toHaveLength(45);
  });

  it('全部全局唯一（键即字面量，无重复）', () => {
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('六个后缀语义封闭，无例外', () => {
    const ok = /_(REQUESTED|APPLIED|COMPLETED|CANCELLED|EXPIRED|DENIED|GRANTED|SUBMITTED|DECLINED|DISPATCHED|ACCEPTED|INITIATED|BOUND|CONFIRMED|ISSUED|GENERATED|DOWNLOADED|QUERIED|RELEASED)$/;
    const bad = codes.filter((c) => !ok.test(c));
    expect(bad).toEqual([]);
  });

  it('每码都声明了四件事', () => {
    for (const c of codes) {
      const s = V1_AUDIT_ACTIONS[c];
      expect(typeof s.domain).toBe('string');
      expect(Object.values(AuditCorrelationMode)).toContain(s.correlationMode);
      expect(Array.isArray(s.requiredFields)).toBe(true);
      expect(typeof s.requiresCausation).toBe('boolean');
    }
  });

  it('前缀优先：同一趟流程的码共享前缀', () => {
    const expectCount: Record<string, number> = {
      'ADMIN_INVITE_': 5, 'ADMIN_FIRST_LOGIN_': 4, 'ADMIN_ROLE_CHANGE_': 3,
      'ADMIN_SUSPENSION_': 2, 'ADMIN_REACTIVATION_': 2, 'ADMIN_PASSWORD_RESET_': 6,
      'ADMIN_MFA_RESET_': 3, 'ADMIN_ACCOUNT_LOCK_': 2,
      'ROLE_DEFINITION_CREATE_': 3, 'ROLE_DEFINITION_MODIFY_': 3,
      'APPROVAL_POLICY_CHANGE_': 2, 'AUDIT_EVIDENCE_EXPORT_': 3,
    };
    for (const [p, n] of Object.entries(expectCount)) {
      expect(codes.filter((c) => c.startsWith(p))).toHaveLength(n);
    }
  });

  it('恰好 13 个 START', () => {
    expect(codes.filter((c) => V1_AUDIT_ACTIONS[c].correlationMode === AuditCorrelationMode.START))
      .toHaveLength(13);
  });

  it('退役码 50 个（V1 域 11 + 充值域 18 + 提现域 18 + 兑换域 3），且与四本在用名册零交集', () => {
    expect(DEPRECATED_AUDIT_ACTIONS).toHaveLength(50);
    expect(DEPRECATED_AUDIT_ACTIONS.filter((d) => codes.includes(d))).toEqual([]);
    expect(DEPRECATED_AUDIT_ACTIONS.filter((d) => d in V4_DEPOSIT_AUDIT_ACTIONS)).toEqual([]);
    expect(DEPRECATED_AUDIT_ACTIONS.filter((d) => d in V5_WITHDRAW_AUDIT_ACTIONS)).toEqual([]);
    expect(DEPRECATED_AUDIT_ACTIONS.filter((d) => d in V6_SWAP_AUDIT_ACTIONS)).toEqual([]);
  });
});
