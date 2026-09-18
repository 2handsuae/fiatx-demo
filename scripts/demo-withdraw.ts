// scripts/demo-withdraw.ts — fiat (+crypto) withdrawals per demo customer → SUCCESS.
// Assumes deposits/swaps already ran (balances exist). Spec §4.4.
import { bootstrap, ensureSetup, runWithdraws } from './demo-lib';

async function main() {
  const ctx = await bootstrap();
  try {
    await ensureSetup(ctx); // idempotent
    await runWithdraws(ctx);
  } finally {
    await ctx.app.close();
  }
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
