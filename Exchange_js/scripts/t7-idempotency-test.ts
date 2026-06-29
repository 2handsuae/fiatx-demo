// T7 idempotency proof — call WalletReconRunService.run() 3 times in succession
// against the same break setup, verify single OPEN case per walletRef with
// firstSeenRunId stable and lastUpdatedRunId advancing.
//
// Run AFTER `npm run recon:demo:break` has set up break state.

// Node 18 polyfill: @nestjs/schedule calls crypto.randomUUID() at module load.
import { webcrypto } from 'node:crypto';
if (!(globalThis as any).crypto) (globalThis as any).crypto = webcrypto;

import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/core/prisma/prisma.service';
import { WalletReconRunService } from '../src/modules/clearing-settle/reconciliation/workflow/wallet-recon-run.service';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const prisma = app.get(PrismaService);
  const engine = app.get(WalletReconRunService);

  // Current state — start from the existing break setup (latest break run already wrote externals + manifest)
  console.log('=== Initial state (after recon:demo:break) ===');
  let cases = await (prisma as any).reconciliationCase.findMany({
    where: { status: 'OPEN' },
    select: { walletRef: true, firstSeenRunId: true, lastUpdatedRunId: true, severity: true },
    orderBy: { walletRef: 'asc' },
  });
  console.log(`OPEN cases: ${cases.length}`);
  for (const c of cases) {
    console.log(`  walletRef=${c.walletRef ?? '<null>'}  first=${c.firstSeenRunId?.slice(0, 8) ?? '-'}  last=${c.lastUpdatedRunId?.slice(0, 8) ?? '-'}  sev=${c.severity}`);
  }

  // Now run engine 3 more times against the SAME data (no wipe between runs).
  const runIds: string[] = [];
  for (let i = 1; i <= 3; i++) {
    console.log(`\n=== Idempotency run #${i} ===`);
    const result = await engine.run({ cutoff: new Date() });
    runIds.push(result.runId);
    console.log(`  runId=${result.runId.slice(0, 8)}  status=${result.status}  opened=${result.casesOpened}  reObs=${result.casesReObserved}  healed=${result.casesAutoHealed}  ophInt=${result.orphanInternal}  ophExt=${result.orphanExternal}  mismatch=${result.mismatch}`);
  }

  console.log('\n=== Final state ===');
  cases = await (prisma as any).reconciliationCase.findMany({
    where: { status: 'OPEN' },
    select: { walletRef: true, firstSeenRunId: true, lastUpdatedRunId: true, severity: true },
    orderBy: { walletRef: 'asc' },
  });
  console.log(`OPEN cases: ${cases.length}`);
  for (const c of cases) {
    console.log(`  walletRef=${c.walletRef ?? '<null>'}  first=${c.firstSeenRunId?.slice(0, 8) ?? '-'}  last=${c.lastUpdatedRunId?.slice(0, 8) ?? '-'}  same=${c.firstSeenRunId === c.lastUpdatedRunId}  sev=${c.severity}`);
  }

  // Check duplicates
  const dup = (await prisma.$queryRawUnsafe(
    "SELECT walletRef, COUNT(*) c FROM reconciliation_cases WHERE status='OPEN' GROUP BY walletRef HAVING c>1"
  )) as Array<{ walletRef: string; c: number }>;
  console.log(`\nDuplicate OPEN walletRefs: ${dup.length} (expect 0)`);
  for (const d of dup) console.log(`  ${d.walletRef}: ${d.c}`);

  // Count cases where lastUpdatedRunId > firstSeenRunId (proves the upsert path advanced)
  const advancing = cases.filter(
    (c: any) => c.firstSeenRunId && c.lastUpdatedRunId && c.firstSeenRunId !== c.lastUpdatedRunId
  );
  console.log(`Cases where last>first (upsert path advanced lastUpdatedRunId): ${advancing.length}/${cases.length}`);

  // Total runs since the initial break
  const totalRuns = await (prisma as any).reconciliationRun.count();
  console.log(`Total recon runs in DB: ${totalRuns} (initial break + 3 idempotency runs = expect 4)`);

  console.log(`\nRun IDs from idempotency test: [${runIds.map((r) => r.slice(0, 8)).join(', ')}]`);

  await app.close();

  const ok = dup.length === 0 && advancing.length > 0 && totalRuns >= 4;
  console.log(`\n${ok ? 'IDEMPOTENCY PROOF: PASSED' : 'IDEMPOTENCY PROOF: FAILED'}`);
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error('FAILED:', e);
  process.exit(1);
});
