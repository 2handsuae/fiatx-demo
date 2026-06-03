import { bigintToDecimal } from './tb-amount.util';

describe('bigintToDecimal', () => {
  it('converts 500n with 2 decimals to 5.00', () => {
    expect(bigintToDecimal(500n, 2).toString()).toBe('5');
  });

  it('500n / 2 decimals equals Decimal 5.00', () => {
    expect(bigintToDecimal(500n, 2).equals('5.00')).toBe(true);
  });

  it('converts 0n with 2 decimals to 0', () => {
    expect(bigintToDecimal(0n, 2).equals('0.00')).toBe(true);
  });

  it('converts 123n with 0 decimals to 123', () => {
    expect(bigintToDecimal(123n, 0).toString()).toBe('123');
  });

  it('converts negative -325n with 2 decimals to -3.25', () => {
    expect(bigintToDecimal(-325n, 2).toString()).toBe('-3.25');
  });

  it('pads fractional digits: 5n / 2 decimals to 0.05', () => {
    expect(bigintToDecimal(5n, 2).toString()).toBe('0.05');
  });
});
