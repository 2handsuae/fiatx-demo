import { Prisma } from '@prisma/client';

export function bigintToDecimal(value: bigint, decimals: number): Prisma.Decimal {
  const neg = value < 0n;
  const abs = neg ? -value : value;
  const s = abs.toString().padStart(decimals + 1, '0');
  const whole = s.slice(0, s.length - decimals) || '0';
  const frac = decimals > 0 ? '.' + s.slice(s.length - decimals) : '';
  return new Prisma.Decimal((neg ? '-' : '') + whole + frac);
}
