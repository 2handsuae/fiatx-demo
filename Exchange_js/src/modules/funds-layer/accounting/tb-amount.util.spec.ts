import { Prisma } from '@prisma/client';
import { decimalToBigint } from './tb-amount.util';

describe('decimalToBigint', () => {
  it('scales a whole number by decimals', () => {
    expect(decimalToBigint('5', 2)).toBe(500n);
  });

  it('pads a short fractional part', () => {
    expect(decimalToBigint('1.5', 2)).toBe(150n);
  });

  it('truncates excess fractional digits', () => {
    expect(decimalToBigint('1.239', 2)).toBe(123n);
  });

  it('handles a negative value', () => {
    expect(decimalToBigint('-3.25', 2)).toBe(-325n);
  });

  it('handles zero decimals', () => {
    expect(decimalToBigint('42', 0)).toBe(42n);
  });

  it('handles a Prisma.Decimal input', () => {
    expect(decimalToBigint(new Prisma.Decimal('2.5'), 2)).toBe(250n);
  });

  it('handles a fraction with no whole part', () => {
    expect(decimalToBigint('0.07', 2)).toBe(7n);
  });
});
