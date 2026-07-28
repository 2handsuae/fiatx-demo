import { Prisma } from '@prisma/client';
import { shouldRequireApproval } from './withdraw-approval.constant';

describe('shouldRequireApproval', () => {
  it('returns true at or above the threshold (>=)', () => {
    expect(
      shouldRequireApproval(
        { grossAedValue: new Prisma.Decimal('200000'), rateFetchFailed: false },
        new Prisma.Decimal('200000'),
      ),
    ).toBe(true);
  });

  it('returns false below the threshold', () => {
    expect(
      shouldRequireApproval(
        { grossAedValue: new Prisma.Decimal('199999.99'), rateFetchFailed: false },
        new Prisma.Decimal('200000'),
      ),
    ).toBe(false);
  });

  it('fail-closed: returns true when threshold is null (rule missing)', () => {
    expect(
      shouldRequireApproval(
        { grossAedValue: new Prisma.Decimal('1'), rateFetchFailed: false },
        null,
      ),
    ).toBe(true);
  });

  it('fail-closed: returns true when the rate fetch failed', () => {
    expect(
      shouldRequireApproval(
        { grossAedValue: null, rateFetchFailed: true },
        new Prisma.Decimal('200000'),
      ),
    ).toBe(true);
  });

  it('fail-closed: returns true when value is missing', () => {
    expect(
      shouldRequireApproval(
        { grossAedValue: null, rateFetchFailed: false },
        new Prisma.Decimal('200000'),
      ),
    ).toBe(true);
  });
});
