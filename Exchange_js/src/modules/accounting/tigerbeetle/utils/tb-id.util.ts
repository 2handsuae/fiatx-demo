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

/**
 * 注册表专用：`tb_account_registry.tbAccountId` 一律 32 位补零十六进制。
 * 种子路径（prisma/seed-tb.helper.ts）用 SHA256 取前 32 位天然定长；动态开户
 * （AccountingService.createAccounts）此前用裸 bigintToHex，u128 首位为 0 时只有
 * 31 位，对账引擎按 32 位 join 落空、该账户流水静默消失（BACKLOG 2026-09-04 条）。
 * 一处改完整类问题连根拔；读侧 padTbId 补丁保留不动。
 */
export function bigintToRegistryHex(value: bigint): string {
  return bigintToHex(value).padStart(32, '0');
}

/** hex string → bigint (from Prisma/SQLite storage) */
export function hexToBigint(hex: string): bigint {
  return BigInt('0x' + hex);
}
