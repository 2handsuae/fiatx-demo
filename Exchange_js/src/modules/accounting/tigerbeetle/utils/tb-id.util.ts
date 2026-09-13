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

/**
 * bigint → 32 位补零十六进制（Prisma/SQLite 存储）。
 * §A 根修（2026-09-13）：此前裸 toString(16)，u128 首 nibble 为 0 时只有 31 位
 * （1/16 每 id），account_flows 落行短一位 → 字符串 join 读面随机丢行 → 幻影失衡。
 * registry 侧同病 2026-09-04 已修（bigintToRegistryHex）；本次把补零推到本体，
 * 写侧全线定长。读侧 padTbId 补丁（wallet-flow-matcher / wallet-balance-checker /
 * tb-evidence）保留不动——新库下是无害恒等。
 */
export function bigintToHex(value: bigint): string {
  return value.toString(16).padStart(32, '0');
}

/**
 * 注册表专用：`tb_account_registry.tbAccountId` 一律 32 位补零十六进制。
 * 种子路径（prisma/seed-tb.helper.ts）用 SHA256 取前 32 位天然定长；动态开户
 * （AccountingService.createAccounts）此前用裸 bigintToHex，u128 首位为 0 时只有
 * 31 位，对账引擎按 32 位 join 落空、该账户流水静默消失（BACKLOG 2026-09-04 条）。
 * 一处改完整类问题连根拔；读侧 padTbId 补丁保留不动。
 * 2026-09-13 起与 bigintToHex 等价，保留名字只为不动调用方。
 */
export function bigintToRegistryHex(value: bigint): string {
  return bigintToHex(value);
}

/** hex string → bigint (from Prisma/SQLite storage) */
export function hexToBigint(hex: string): bigint {
  return BigInt('0x' + hex);
}
