import { Prisma } from '@prisma/client';

export function bigintToDecimal(value: bigint, decimals: number): Prisma.Decimal {
  const neg = value < 0n;
  const abs = neg ? -value : value;
  const s = abs.toString().padStart(decimals + 1, '0');
  const whole = s.slice(0, s.length - decimals) || '0';
  const frac = decimals > 0 ? '.' + s.slice(s.length - decimals) : '';
  return new Prisma.Decimal((neg ? '-' : '') + whole + frac);
}

/**
 * Convert a Prisma.Decimal to TigerBeetle integer units, truncating sub-unit precision.
 * E.g. Decimal('1000') at decimals=6 → 1000000000n
 */
export function decimalToTbUnits(value: Prisma.Decimal, decimals: number): bigint {
  // Truncate (ROUND_DOWN) to avoid over-posting due to floating-point rounding.
  const truncated = value.toDecimalPlaces(decimals, Prisma.Decimal.ROUND_DOWN).toFixed(decimals);
  const [whole, frac = ''] = truncated.split('.');
  return BigInt(whole + frac.padEnd(decimals, '0').slice(0, decimals));
}
