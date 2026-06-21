// scripts/demo-swap.ts — fixed-amount swaps; fiat leg settled, crypto pending (NO EOD).
// Assumes deposits already ran (balances exist). Spec §4.3.
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
