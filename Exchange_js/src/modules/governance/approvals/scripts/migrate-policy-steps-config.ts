/**
 * Data migration: Backfill stepsConfig JSON for existing ApprovalActionPolicy rows.
 * Each existing checkerRoles CSV entry becomes a single-role step.
 *
 * Run: npx ts-node -r tsconfig-paths/register src/modules/governance/approvals/scripts/migrate-policy-steps-config.ts
 *
 * Safe to run multiple times (skips rows that already have stepsConfig).
 */
import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();
  try {
    const rows = await prisma.approvalActionPolicy.findMany();
    let migrated = 0;
    let skipped = 0;

    for (const row of rows) {
      if (row.stepsConfig) {
        skipped++;
        continue;
      }
      const roles = row.checkerRoles
        .split(',')
        .map((r: string) => r.trim())
        .filter(Boolean);
      const steps = roles.map((role: string, idx: number) => ({
        stepNo: idx + 1,
        roles: [role],
      }));
      await prisma.approvalActionPolicy.update({
        where: { actionType: row.actionType },
        data: { stepsConfig: JSON.stringify(steps) },
      });
      migrated++;
      console.log(`  Migrated: ${row.actionType} → ${JSON.stringify(steps)}`);
    }

    console.log(`\nDone. Migrated: ${migrated}, Skipped (already has stepsConfig): ${skipped}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
