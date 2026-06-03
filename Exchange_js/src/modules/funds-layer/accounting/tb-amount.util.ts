import { Prisma } from '@prisma/client';

/**
 * Convert a decimal value (Prisma.Decimal / string / number) into a TB integer
 * amount scaled by `decimals`. Handles negatives, fractional padding, and
 * truncation of excess fractional digits.
 */
export function decimalToBigint(value: Prisma.Decimal | string | number, decimals: number): bigint {
  const str = String(value);
  const neg = str.startsWith('-');
  const body = neg ? str.slice(1) : str;
  const [whole, frac = ''] = body.split('.');
  const padded = frac.padEnd(decimals, '0').slice(0, decimals);
  const v = BigInt((whole || '0') + padded);
  return neg ? -v : v;
}
