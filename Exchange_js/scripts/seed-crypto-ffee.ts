/**
 * Idempotent seed: provision the platform F_FEE wallet for every CRYPTO asset.
 *
 * F_FEE was added to CRYPTO_SYSTEM_WALLET_ROLES so crypto fees have a
 * collection destination. The seed loop in prisma/seed.business.ts now creates
 * these on a full reseed, but existing branch DBs predate the change — this
 * script backfills them without a destructive rebuild.
 *
 * Mirrors the crypto branch of seedAssets() exactly: CRYPTO_ADDRESS wallets
 * with deterministic walletNo + address, ownerType PLATFORM / ownerNo PLATFORM.
 * Re-runs are safe (upsert keyed on walletNo).
 *
 * Run:
 *   DATABASE_URL="file:/tmp/exchange_js_branch/dev.db" \
 *     node -r ts-node/register -r tsconfig-paths/register scripts/seed-crypto-ffee.ts
 */
import { PrismaClient } from '@prisma/client';
import { createHash } from 'crypto';
import { DEFAULT_ASSETS } from '../src/config/manifests/assets.manifest';
import { buildDeterministicNo } from '../src/common/utils/no-generator.util';
import { WalletRole } from '../src/modules/asset-treasury/wallets/dto/wallet.dto';

// Mirror the local helpers in prisma/seed.business.ts (not exported there).
function normalizeNetwork(network: string | null | undefined): string {
  return network ?? '';
}

function normalizeSegment(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]+/g, '_');
}

function buildSystemWalletAddress(
  role: WalletRole,
  assetCode: string,
  network: string | null | undefined,
): string {
  const normalizedNetwork = normalizeSegment(network || 'NA');
  const normalizedCode = normalizeSegment(assetCode);
  const hash = createHash('sha256')
    .update(`${role}|${normalizedCode}|${normalizedNetwork}`)
    .digest('hex');

  if (normalizedNetwork === 'TRON') {
    return `T${hash.slice(0, 33)}`;
  }
  if (normalizedNetwork === 'ETHEREUM') {
    return `0x${hash.slice(0, 40)}`;
  }
  return `sys_${role.toLowerCase()}_${normalizedCode.toLowerCase()}_${normalizedNetwork.toLowerCase()}_${hash.slice(0, 12)}`;
}

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  const role = WalletRole.F_FEE;
  try {
    const cryptoAssets = DEFAULT_ASSETS.filter((a) => a.type === 'CRYPTO');
    for (const asset of cryptoAssets) {
      const normalizedNetwork = normalizeNetwork(asset.network);
      const record = await prisma.asset.findUnique({
        where: {
          type_currency_network: {
            type: asset.type,
            currency: asset.currency,
            network: normalizedNetwork,
          },
        },
      });
      if (!record) {
        console.log(`SKIP ${asset.code}: asset not found in DB`);
        continue;
      }

      const walletNo = buildDeterministicNo(
        'WA',
        role,
        normalizeSegment(asset.code),
        normalizedNetwork ? normalizeSegment(normalizedNetwork) : '',
      );
      const address = buildSystemWalletAddress(role, asset.code, asset.network);

      const wallet = await prisma.wallet.upsert({
        where: { walletNo },
        update: {
          ownerType: 'PLATFORM',
          ownerId: null,
          ownerNo: 'PLATFORM',
          type: 'CRYPTO_ADDRESS',
          walletRole: role,
          assetId: record.id,
          address,
          status: 'ACTIVE',
        },
        create: {
          walletNo,
          ownerType: 'PLATFORM',
          ownerId: null,
          ownerNo: 'PLATFORM',
          type: 'CRYPTO_ADDRESS',
          walletRole: role,
          assetId: record.id,
          address,
          mockBalance: '0',
          status: 'ACTIVE',
        },
      });

      console.log(
        `OK ${asset.code} F_FEE walletNo=${wallet.walletNo} address=${wallet.address}`,
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
