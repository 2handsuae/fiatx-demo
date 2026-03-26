import { PrismaClient } from '@prisma/client';

interface ScriptOptions {
  depositNo: string;
  apply: boolean;
}

function parseArgs(argv: string[]): ScriptOptions {
  let depositNo = 'DEP2603248501';
  let apply = false;

  for (const arg of argv) {
    if (arg === '--apply') {
      apply = true;
      continue;
    }
    if (arg.startsWith('--depositNo=')) {
      const value = arg.split('=')[1]?.trim();
      if (value) depositNo = value;
    }
  }

  return { depositNo, apply };
}

function parseJsonStringArray(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.map((item) => String(item || '').trim()).filter(Boolean)
      : [];
  } catch {
    return [];
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const prisma = new PrismaClient();

  try {
    const deposit = await prisma.depositTransaction.findFirst({
      where: { depositNo: options.depositNo },
      select: {
        id: true,
        depositNo: true,
        status: true,
      },
    });

    if (!deposit) {
      throw new Error(`Deposit not found: ${options.depositNo}`);
    }

    const rows = await (prisma as any).workflowDecisionRecord.findMany({
      where: {
        contextType: 'TX_DEPOSIT_FINAL',
        subjectId: deposit.id,
      },
      orderBy: [{ completedAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        contextType: true,
        subjectId: true,
        status: true,
        outputDecision: true,
        inputHash: true,
        createdAt: true,
        completedAt: true,
      },
    });

    console.log(
      `[repair-duplicate-deposit-final-decisions] deposit=${deposit.depositNo} id=${deposit.id} status=${deposit.status}`,
    );

    if (rows.length <= 1) {
      console.log('No duplicate TX_DEPOSIT_FINAL records found.');
      return;
    }

    const keep = rows[0];
    const duplicates = rows.slice(1);
    const duplicateIds = duplicates.map((item: any) => item.id);

    const [alerts, cases] = await Promise.all([
      (prisma as any).complianceAlert.findMany({
        where: {
          sourceType: 'DEPOSIT',
          sourceId: deposit.id,
        },
        select: {
          id: true,
          alertNo: true,
          decisionRecordIds: true,
        },
      }),
      (prisma as any).complianceIncident.findMany({
        where: {
          sourceType: 'DEPOSIT',
          entityId: deposit.id,
        },
        select: {
          id: true,
          incidentNo: true,
          decisionRecordIds: true,
        },
      }),
    ]);

    const referencedAlerts = alerts.filter((item: any) =>
      parseJsonStringArray(item.decisionRecordIds).some((id) => duplicateIds.includes(id)),
    );
    const referencedCases = cases.filter((item: any) =>
      parseJsonStringArray(item.decisionRecordIds).some((id) => duplicateIds.includes(id)),
    );

    console.log(`Keeping latest decision: ${keep.id}`);
    console.log(`Duplicate candidates: ${duplicateIds.join(', ')}`);

    if (referencedAlerts.length > 0 || referencedCases.length > 0) {
      console.log('Duplicate decisions are still referenced and will not be removed.');
      if (referencedAlerts.length > 0) {
        console.log(
          `Alert references: ${referencedAlerts
            .map((item: any) => `${item.alertNo || item.id}`)
            .join(', ')}`,
        );
      }
      if (referencedCases.length > 0) {
        console.log(
          `Case references: ${referencedCases
            .map((item: any) => `${item.incidentNo || item.id}`)
            .join(', ')}`,
        );
      }
      return;
    }

    if (!options.apply) {
      console.log('Dry run only. Re-run with --apply to delete duplicates.');
      return;
    }

    const deleted = await (prisma as any).workflowDecisionRecord.deleteMany({
      where: {
        id: { in: duplicateIds },
      },
    });

    console.log(`Deleted ${deleted.count} duplicate TX_DEPOSIT_FINAL records.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
