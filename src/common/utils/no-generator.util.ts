import { createHash, randomUUID } from 'crypto';

export function generateReferenceNo(prefix: string): string {
  const date = new Date();
  const year = date.getFullYear().toString().slice(-2);
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');
  // 6 位随机 = 100 万个坑（原为 `Math.random() * 10000`，只有 1 万）。
  // 换的原因是实测：一次 `demo:all` 造几十张资金单，全部落在同一天同一前缀，
  // 按生日问题约 7–20% 会撞 `fundsOrderNo` 的唯一约束（2026-09-01 当天连撞两次），
  // 而它挡的是 `demo:all` 本身——造不出演示数据。6 位后同样的量级降到约 0.2%。
  // 用 randomUUID 而不是 Math.random：走 CSPRNG，熵不依赖 V8 的 PRNG 实现。
  const random = (
    parseInt(randomUUID().replace(/-/g, '').slice(0, 8), 16) % 1_000_000
  )
    .toString()
    .padStart(6, '0');
  return `${prefix}${year}${month}${day}${random}`;
}

export function buildDeterministicNo(
  prefix: string,
  ...segments: string[]
): string {
  const hash = createHash('sha256').update(segments.join('|')).digest('hex');
  const suffix = (parseInt(hash.slice(0, 4), 16) % 10000)
    .toString()
    .padStart(4, '0');
  return `${prefix}260101${suffix}`;
}
