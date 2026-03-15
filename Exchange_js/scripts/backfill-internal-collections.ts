import 'tsconfig-paths/register';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import {
  InternalCollectionWorkflowOrchestrator,
  InternalCollectionReconcileItem,
} from '../src/orchestrators/internal-collection-workflow.orchestrator';

type Mode = 'dry-run' | 'apply';

interface CliArgs {
  mode: Mode;
  depositNo?: string;
}

function parseArgs(argv: string[]): CliArgs {
  let mode: Mode = 'apply';
  let depositNo: string | undefined;

  for (const arg of argv) {
    if (arg === '--dry-run') {
      mode = 'dry-run';
      continue;
    }

    if (arg.startsWith('--depositNo=')) {
      depositNo = arg.slice('--depositNo='.length).trim();
      continue;
    }

    if (arg === '--help' || arg === '-h') {
      console.log(
        'Usage: ts-node scripts/backfill-internal-collections.ts [--dry-run] [--depositNo=DEP2602179567]',
      );
      process.exit(0);
    }

    throw new Error(`Unsupported argument: ${arg}`);
  }

  return {
    mode,
    depositNo: depositNo || undefined,
  };
}

function printFailures(items: InternalCollectionReconcileItem[]) {
  const failures = items.filter((item) => item.action === 'FAILED');
  if (!failures.length) return;

  console.log('Failures:');
  for (const failure of failures) {
    console.log(`- ${failure.depositNo}: ${failure.reason || 'Unknown error'}`);
  }
}

function printSummary(mode: Mode, result: {
  scanned: number;
  created: number;
  idempotent: number;
  skipped: number;
  failed: number;
  items: InternalCollectionReconcileItem[];
}) {
  const candidates = result.items.filter(
    (item) => item.action === 'WOULD_CREATE' || item.action === 'CREATED',
  );

  console.log('--- Internal Collection Backfill Summary ---');
  console.log(`Mode: ${mode}`);
  console.log(`Scanned: ${result.scanned}`);
  console.log(`Created/WouldCreate: ${result.created}`);
  console.log(`Idempotent: ${result.idempotent}`);
  console.log(`Skipped: ${result.skipped}`);
  console.log(`Failed: ${result.failed}`);

  if (candidates.length) {
    console.log(
      `${mode === 'dry-run' ? 'Will backfill' : 'Backfilled'} deposits: ${candidates
        .map((item) => item.depositNo)
        .join(', ')}`,
    );
  } else {
    console.log('No deposits need backfill.');
  }

  printFailures(result.items);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  try {
    const orchestrator = app.get(InternalCollectionWorkflowOrchestrator);
    const result = await orchestrator.reconcileMissingCollections({
      onlyMissing: true,
      dryRun: args.mode === 'dry-run',
      depositNo: args.depositNo,
      operatorId: 'SYSTEM',
    });

    printSummary(args.mode, result);

    if (result.failed > 0) {
      process.exitCode = 1;
    }
  } finally {
    await app.close();
  }
}

void main();
