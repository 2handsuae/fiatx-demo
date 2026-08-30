// scripts/demo-swap.ts — fixed-amount swaps; fiat leg settled, crypto pending (NO EOD).
// Assumes deposits already ran (balances exist). Spec §4.3.
// NOTE: roster row #13 (FRANK) needs runFrankPreStage() to have created its order
// BEFORE deposit roster row #7 sanctioned him — only demo:all / demo:deposit do
// that (ctx.frankPreStage is per-process, not persisted). Running this script
// alone after either of those will throw a clear error on #13 rather than
// reproduce it — see runFrankPreStage's header comment (demo-lib.ts).
import { bootstrap, ensureSetup, runSwaps } from './demo-lib';

async function main() {
  const ctx = await bootstrap();
  try {
    await ensureSetup(ctx); // idempotent
    await runSwaps(ctx);
  } finally {
    await ctx.app.close();
  }
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
