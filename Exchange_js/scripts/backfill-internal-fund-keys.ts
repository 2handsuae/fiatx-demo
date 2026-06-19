// scripts/backfill-internal-fund-keys.ts
//
// Idempotent backfill of the external-reference key on CLEAR internal_fund legs.
//
// V7 baseline: every CLEAR internal_fund leg is a REAL physical transfer (on-chain
// or via bank), so it MUST carry a real external reference. Crypto → txHash (already
// fabricated on BROADCAST). Fiat → bank referenceNo. Before the funds-flow SUBMIT
// fallback landed, fiat legs cleared with an empty referenceNo; this script keys the
// existing rows so they reconcile against the bank statement.
//
// What it does (branch DB):
//   For every internal_fund WHERE status='CLEAR' AND no key (referenceNo empty AND
//   txHash empty) AND asset.type='FIAT' → set referenceNo = 'BANK-' || internalFundNo.
//   Crypto CLEAR legs already carry txHash; CREATED (e.g. un-broadcast WITHDRAW) legs
//   stay keyless — correct.
//
// Safe to re-run: only touches CLEAR fiat legs that still lack any key.
//
// Run:
//   DATABASE_URL="file:/tmp/exchange_js_branch/dev.db" \
//     npx ts-node -r tsconfig-paths/register scripts/backfill-internal-fund-keys.ts

import { webcrypto } from 'node:crypto';
if (!(globalThis as any).crypto) (globalThis as any).crypto = webcrypto;

import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/core/prisma/prisma.service';

async function main() {
  const ctx = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error'],
  });
  const prisma = ctx.get(PrismaService);

  // CLEAR fiat legs with no external key.
  const targets = await prisma.internalFund.findMany({
    where: {
      status: 'CLEAR',
      asset: { type: 'FIAT' },
      AND: [
        { OR: [{ referenceNo: null }, { referenceNo: '' }] },
        { OR: [{ txHash: null }, { txHash: '' }] },
      ],
    },
    select: { id: true, internalFundNo: true },
  });

  console.log(`Found ${targets.length} CLEAR fiat internal_fund leg(s) with no key.`);

  let updated = 0;
  for (const f of targets) {
    await prisma.internalFund.update({
      where: { id: f.id },
      data: { referenceNo: `BANK-${f.internalFundNo}` },
    });
    updated += 1;
    console.log(`  ${f.internalFundNo} → referenceNo=BANK-${f.internalFundNo}`);
  }

  console.log(`\nBackfilled ${updated} leg(s).`);
  await ctx.close();
  process.exit(0);
}

main().catch((err) => {
  console.error('FATAL', err);
  process.exit(2);
});
