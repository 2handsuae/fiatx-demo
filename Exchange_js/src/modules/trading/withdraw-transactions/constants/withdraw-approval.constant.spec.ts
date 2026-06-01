import { Prisma } from '@prisma/client';
import {
  WITHDRAW_APPROVAL_AED_THRESHOLD,
  shouldRequireApproval,
} from './withdraw-approval.constant';

describe('shouldRequireApproval', () => {
  it('threshold is 200000 AED', () => {
    expect(WITHDRAW_APPROVAL_AED_THRESHOLD.toString()).toBe('200000');
  });

  it('returns true at exactly the threshold (>=)', () => {
    expect(shouldRequireApproval({ grossAedValue: new Prisma.Decimal('200000'), rateFetchFailed: false })).toBe(true);
  });

  it('returns false just below the threshold', () => {
    expect(shouldRequireApproval({ grossAedValue: new Prisma.Decimal('199999.99'), rateFetchFailed: false })).toBe(false);
  });

  it('fail-closed: returns true when the rate fetch failed', () => {
    expect(shouldRequireApproval({ grossAedValue: null, rateFetchFailed: true })).toBe(true);
  });

  it('fail-closed: returns true when value is missing', () => {
    expect(shouldRequireApproval({ grossAedValue: null, rateFetchFailed: false })).toBe(true);
  });
});
