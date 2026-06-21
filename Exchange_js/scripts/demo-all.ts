// scripts/demo-all.ts — orchestrate the full transaction-data day + verify end-state.
// setup → deposits → swaps (fiat settled, crypto pending) → withdrawals → asserts.
// Does NOT reset: run `npm run db:biz:reset` (branch-scoped) first for a clean baseline.
// Spec: doc-final/superpowers/specs/2026-06-21-demo-transaction-data-layer-design.md §4.5/§6
import { bootstrap, ensureSetup, runDeposits, runSwaps, runWithdraws, verifyEndState } from './demo-lib';

async function main() {
  const ctx = await bootstrap();
  let ok = false;
  try {
    await ensureSetup(ctx);
    await runDeposits(ctx);
    await runSwaps(ctx);
    await runWithdraws(ctx);
    ok = await verifyEndState(ctx);
  } finally {
    await ctx.app.close();
  }
  console.log(ok ? '\n═══ demo:all DONE ✅ (all asserts pass) ═══' : '\n═══ demo:all FAILED ❌ (see asserts) ═══');
  process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
