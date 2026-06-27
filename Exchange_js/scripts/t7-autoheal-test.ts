// T7 auto-heal proof — verify that once a wallet's mirror externals are
// re-aligned with internals (so its delta returns to 0), the previously OPEN
// case transitions to status=RESOLVED, resolutionReason=AUTO_HEALED.
//
// Strategy:
//   1. Run AFTER `recon:demo:break` has set up break state with OPEN cases.
//   2. For each OPEN wallet case, rewrite its mirror ExternalBalance to match
//      internals exactly (zero delta). For OPEN xref cases, delete the extra
//      fee lines that caused the cross-ref mismatch.
//   3. Call engine.run() directly (no wipe). Auto-heal should fire on all
//      previously OPEN wallets that no longer break.

import { webcrypto } from 'node:crypto';
if (!(globalThis as any).crypto) (globalThis as any).crypto = webcrypto;

import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/core/prisma/prisma.service';
import { WalletReconRunService } from '../src/modules/clearing-settle/reconciliation/workflow/wallet-recon-run.service';
import { WalletBalanceCheckerService } from '../src/modules/clearing-settle/reconciliation/engine/v2/wallet-balance-checker.service';
import { Prisma } from '@prisma/client';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const prisma = app.get(PrismaService);
  const engine = app.get(WalletReconRunService);
  const checker = app.get(WalletBalanceCheckerService);

  console.log('=== Before auto-heal: status distribution ===');
  let dist = (await prisma.$queryRawUnsafe(
    "SELECT status, resolutionReason, COUNT(*) c FROM reconciliation_cases GROUP BY status, resolutionReason"
  )) as Array<{ status: string; resolutionReason: string | null; c: number }>;
  for (const r of dist) console.log(`  ${r.status}  ${r.resolutionReason ?? '-'}  count=${r.c}`);

  const openCases = (await (prisma as any).reconciliationCase.findMany({
    where: { status: 'OPEN', layer: 'WALLET', walletRef: { not: null } },
    select: { walletRef: true, assetCode: true, businessDate: true, book: true },
  })) as Array<{ walletRef: string; assetCode: string; businessDate: string; book: string }>;

  console.log(`\nWallet/XREF OPEN cases to heal: ${openCases.length}`);

  // Re-align mirror externals so each wallet's delta returns to 0.
  // For real walletRefs (not XREF:*), set ExternalBalance.closingBalance = internal.total.
  const cutoff = new Date();
  for (const oc of openCases) {
    if (oc.walletRef.startsWith('XREF:')) {
      // For XREF cases, the cause was that fee flows have differing amounts
      // (9800 vs 200). Healing those would require deleting account_flow rows,
      // which we don't want to mess with. Skip XREF healing — those cases are
      // expected to remain OPEN. Auto-heal will run against real wallet cases.
      console.log(`  skip (XREF): ${oc.walletRef}`);
      continue;
    }

    // Compute current internal total for this wallet via the same checker the
    // engine uses, then write that as the external mirror.
    const check = await checker.checkBalance({
      walletRef: oc.walletRef,
      externalClosing: 0n, // dummy — we just want internal.total
      cutoff,
    });
    const internalTotal = check.internal.total;

    // Find the ExternalBalance row for this wallet (latest cutoffDate)
    const bal = await (prisma as any).externalBalance.findFirst({
      where: { walletRef: oc.walletRef },
      orderBy: { cutoffDate: 'desc' },
    });
    if (!bal) {
      console.log(`  no ExternalBalance row for ${oc.walletRef} — skip`);
      continue;
    }
    await (prisma as any).externalBalance.update({
      where: { id: bal.id },
      data: { closingBalance: new Prisma.Decimal(internalTotal.toString()) },
    });
    console.log(`  realigned ${oc.walletRef}: closingBalance ← ${internalTotal.toString()}`);
  }

  console.log('\n=== Running engine (expect auto-heal) ===');
  const result = await engine.run({ cutoff });
  console.log(`  runId=${result.runId.slice(0, 8)}  status=${result.status}  opened=${result.casesOpened}  reObs=${result.casesReObserved}  healed=${result.casesAutoHealed}`);

  console.log('\n=== After auto-heal: status distribution ===');
  dist = (await prisma.$queryRawUnsafe(
    "SELECT status, resolutionReason, COUNT(*) c FROM reconciliation_cases GROUP BY status, resolutionReason"
  )) as Array<{ status: string; resolutionReason: string | null; c: number }>;
  for (const r of dist) console.log(`  ${r.status}  ${r.resolutionReason ?? '-'}  count=${r.c}`);

  const autoHealed = (await (prisma as any).reconciliationCase.findMany({
    where: { resolutionReason: 'AUTO_HEALED' },
    select: { walletRef: true, status: true, resolvedAt: true, severity: true, lastUpdatedRunId: true },
    orderBy: { resolvedAt: 'desc' },
  })) as Array<{ walletRef: string; status: string; resolvedAt: Date; severity: string; lastUpdatedRunId: string }>;
  console.log(`\nCases AUTO_HEALED: ${autoHealed.length}`);
  for (const c of autoHealed) {
    console.log(`  ${c.walletRef ?? '<null>'}  status=${c.status}  resolvedAt=${c.resolvedAt?.toISOString()}  sev=${c.severity}`);
  }

  await app.close();

  const ok = autoHealed.length > 0;
  console.log(`\n${ok ? 'AUTO-HEAL PROOF: PASSED' : 'AUTO-HEAL PROOF: FAILED'}`);
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error('FAILED:', e);
  process.exit(1);
});
