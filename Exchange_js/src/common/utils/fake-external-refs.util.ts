import { createHash } from 'node:crypto';

/**
 * Deterministic fake EVM/Tron-style txHash for demo/mock/sim paths.
 * Output: `0x` + 64 hex chars (66 chars total) — matches real EVM/Tron format.
 * Determinism: same seed → same hash → demo reproducible for screenshot
 * verification + regression tests.
 *
 * NOT for production use — production payout txHash must come from the real
 * chain via signer/RPC.
 */
export function fakeChainTxHash(seed: string): string {
  const hex = createHash('sha256').update(`tx:${seed}`).digest('hex');
  return `0x${hex}`;
}

/**
 * Deterministic fake bank reference (Zand-like).
 * Output: `ZB${YYYYMMDD}${10 hex upper}` — 仿 Zand 回执号风格。
 * Determinism: same (seed, date) → same ref.
 */
export function fakeBankRef(seed: string, date: Date | string): string {
  const ymd = (typeof date === 'string' ? date : date.toISOString().slice(0, 10)).replace(/-/g, '');
  const hex = createHash('sha256').update(`bank:${seed}`).digest('hex').slice(0, 10).toUpperCase();
  return `ZB${ymd}${hex}`;
}
