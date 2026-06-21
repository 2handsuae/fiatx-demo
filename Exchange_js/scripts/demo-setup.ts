// scripts/demo-setup.ts — ensure demo customers' wallets + TB accounts + fees (idempotent).
// Spec: doc-final/superpowers/specs/2026-06-21-demo-transaction-data-layer-design.md §4.1
import { bootstrap, ensureSetup } from './demo-lib';

async function main() {
  const ctx = await bootstrap();
  try {
    await ensureSetup(ctx);
  } finally {
    await ctx.app.close();
  }
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
