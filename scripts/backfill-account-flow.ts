// scripts/backfill-account-flow.ts
//
// Phase B / T3: backfill the account_flows projection from existing
// tb_transfer_evidence rows. Idempotent — re-running is safe; the upsert
// keyed by (tbTransferId, tbAccountId) is a no-op for already-projected rows.
//
// Run after the new schema is deployed:
//   DATABASE_URL=... npx ts-node -r tsconfig-paths/register \
//     Exchange_js/scripts/backfill-account-flow.ts

import 'tsconfig-paths/register';
import { PrismaClient } from '@prisma/client';
import { AccountFlowProjectorService } from '../src/modules/clearing-settle/reconciliation/projector/account-flow-projector.service';

const BATCH_SIZE = 500;
const LOG_EVERY = 1000;

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  const projector = new AccountFlowProjectorService();

  const totalEvidence = await (prisma as any).tbTransferEvidence.count();
  console.log(`[backfill-account-flow] starting; ${totalEvidence} evidence rows to scan`);

  let skip = 0;
  let processed = 0;

  // Loop paged batches so memory stays flat regardless of corpus size.
  // findMany is ordered by createdAt asc so progress is monotonic.
  while (skip < totalEvidence) {
    const batch = await (prisma as any).tbTransferEvidence.findMany({
      orderBy: { createdAt: 'asc' },
      skip,
      take: BATCH_SIZE,
    });
    if (batch.length === 0) break;

    for (const evidence of batch) {
      await projector.persist(prisma as any, evidence);
      processed += 1;
      if (processed % LOG_EVERY === 0) {
        console.log(`[backfill-account-flow] processed ${processed}/${totalEvidence}`);
      }
    }
    skip += batch.length;
  }

  const flowCount = await (prisma as any).accountFlow.count();
  console.log(
    `[backfill-account-flow] done; processed=${processed} evidence rows; account_flows now has ${flowCount} rows`,
  );

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('[backfill-account-flow] failed:', err);
  process.exit(1);
});
