// scripts/demo-deposit.ts — USDT + AED deposits per demo customer → SUCCESS (idempotent).
// Spec: doc-final/superpowers/specs/2026-06-21-demo-transaction-data-layer-design.md §4.2
import { bootstrap, ensureSetup, runDeposits } from './demo-lib';

async function main() {
  const ctx = await bootstrap();
  try {
    await ensureSetup(ctx); // idempotent — guarantees wallets/TB exist standalone
    await runDeposits(ctx);
  } finally {
    await ctx.app.close();
  }
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
