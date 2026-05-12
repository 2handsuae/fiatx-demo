import { createHash } from 'node:crypto';

/**
 * Deterministic TB transfer ID from business key.
 * Same input always produces same u128 — TB natively deduplicates.
 */
export function deterministicTransferId(
  sourceType: string,
  sourceNo: string,
  eventCode: string,
  legIndex: number,
): bigint {
  const input = `${sourceType}:${sourceNo}:${eventCode}:${legIndex}`;
  const hash = createHash('sha256').update(input).digest();
  return BigInt('0x' + hash.subarray(0, 16).toString('hex'));
}

/** bigint → hex string (for Prisma/SQLite storage) */
export function bigintToHex(value: bigint): string {
  return value.toString(16);
}

/** hex string → bigint (from Prisma/SQLite storage) */
export function hexToBigint(hex: string): bigint {
  return BigInt('0x' + hex);
}
