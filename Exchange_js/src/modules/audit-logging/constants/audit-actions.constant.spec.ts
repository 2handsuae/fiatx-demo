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
