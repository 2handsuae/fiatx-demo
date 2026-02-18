import { PrismaClient } from '@prisma/client';
import {
  buildDeterministicWalletNo,
  generateRandomWalletNo,
} from '../src/common/utils/no-generator.util';

type Mode = 'dry-run' | 'apply';

type BackfillItem = {
  walletId: string;
  walletRole: string;
  oldWalletNo: string;
  newWalletNo: string;
  action: 'UNCHANGED' | 'WILL_UPDATE' | 'UPDATED' | 'FAILED';
  reason?: string;
};

const SYSTEM_WALLET_ROLES = new Set([
  'MASTER',
  'PAYOUT',
  'LIQ',
  'CUST_BANK',
  'LIQ_BANK',
]);
const MAX_RANDOM_RETRIES = 30;

function parseArgs(argv: string[]): { mode: Mode } {
  let mode: Mode = 'dry-run';

  for (const arg of argv) {
    if (arg === '--apply') {
      mode = 'apply';
      continue;
    }

    if (arg === '--dry-run') {
      mode = 'dry-run';
      continue;
    }

    if (arg === '--help' || arg === '-h') {
      console.log(
        'Usage: ts-node scripts/backfill-wallet-no-v2.ts [--dry-run|--apply]',
      );
      process.exit(0);
    }

    throw new Error(`Unsupported argument: ${arg}`);
  }

  return { mode };
}

function normalizeRole(role: string | null | undefined): string {
  return String(role || 'GENERAL')
    .trim()
    .toUpperCase();
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const prisma = new PrismaClient({ log: ['warn', 'error'] });

  try {
    const wallets = await prisma.wallet.findMany({
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        walletNo: true,
        walletRole: true,
        createdAt: true,
        asset: {
          select: {
            code: true,
            network: true,
          },
        },
      },
    });

    const usedWalletNos = new Set<string>();
    const items: BackfillItem[] = [];

    for (const wallet of wallets) {
      const oldWalletNo = wallet.walletNo || '';
      const walletRole = normalizeRole(wallet.walletRole);
      const assetCode = wallet.asset?.code;
      const network = wallet.asset?.network || 'NA';

      if (!assetCode) {
        items.push({
          walletId: wallet.id,
          walletRole,
          oldWalletNo,
          newWalletNo: oldWalletNo,
          action: 'FAILED',
          reason: 'Asset not found',
        });
        continue;
      }

      if (SYSTEM_WALLET_ROLES.has(walletRole)) {
        const deterministicWalletNo = buildDeterministicWalletNo(
          walletRole,
          assetCode,
          network,
        );

        if (usedWalletNos.has(deterministicWalletNo)) {
          items.push({
            walletId: wallet.id,
            walletRole,
            oldWalletNo,
            newWalletNo: deterministicWalletNo,
            action: 'FAILED',
            reason: `Deterministic walletNo conflict: ${deterministicWalletNo}`,
          });
          continue;
        }

        usedWalletNos.add(deterministicWalletNo);
        items.push({
          walletId: wallet.id,
          walletRole,
          oldWalletNo,
          newWalletNo: deterministicWalletNo,
          action:
            oldWalletNo === deterministicWalletNo ? 'UNCHANGED' : 'WILL_UPDATE',
        });
        continue;
      }

      let selected: string | null = null;
      for (let attempt = 0; attempt < MAX_RANDOM_RETRIES; attempt += 1) {
        const candidate = generateRandomWalletNo(walletRole, wallet.createdAt);
        if (!usedWalletNos.has(candidate)) {
          selected = candidate;
          break;
        }
      }

      if (!selected) {
        items.push({
          walletId: wallet.id,
          walletRole,
          oldWalletNo,
          newWalletNo: oldWalletNo,
          action: 'FAILED',
          reason: `Failed to allocate unique walletNo after ${MAX_RANDOM_RETRIES} attempts`,
        });
        continue;
      }

      usedWalletNos.add(selected);
      items.push({
        walletId: wallet.id,
        walletRole,
        oldWalletNo,
        newWalletNo: selected,
        action: oldWalletNo === selected ? 'UNCHANGED' : 'WILL_UPDATE',
      });
    }

    const failures = items.filter((item) => item.action === 'FAILED');
    const updateTargets = items.filter((item) => item.action === 'WILL_UPDATE');
    const unchanged = items.filter((item) => item.action === 'UNCHANGED');

    console.log('--- WalletNo Backfill V2 ---');
    console.log(`Mode: ${args.mode}`);
    console.log(`Scanned: ${wallets.length}`);
    console.log(`Will update: ${updateTargets.length}`);
    console.log(`Unchanged: ${unchanged.length}`);
    console.log(`Failed: ${failures.length}`);

    if (failures.length) {
      console.log('Failures:');
      for (const failure of failures) {
        console.log(
          `- walletId=${failure.walletId}, role=${failure.walletRole}, reason=${failure.reason}`,
        );
      }
      process.exitCode = 1;
    }

    if (args.mode === 'dry-run') {
      const preview = updateTargets.slice(0, 20).map((item) => ({
        walletId: item.walletId,
        role: item.walletRole,
        oldWalletNo: item.oldWalletNo,
        newWalletNo: item.newWalletNo,
      }));
      if (preview.length) {
        console.table(preview);
      }
      return;
    }

    if (failures.length) {
      throw new Error('Backfill aborted due to failures');
    }

    await prisma.$transaction(async (tx) => {
      for (const item of updateTargets) {
        await tx.wallet.update({
          where: { id: item.walletId },
          data: { walletNo: item.newWalletNo },
        });
        item.action = 'UPDATED';
      }
    });

    console.log(`Updated: ${updateTargets.length}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error('WalletNo backfill failed:', error);
  process.exit(1);
});
