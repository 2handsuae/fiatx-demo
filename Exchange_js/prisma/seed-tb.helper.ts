import { PrismaClient } from '@prisma/client';
import { createHash } from 'crypto';
import { createClient as tbCreateClient } from 'tigerbeetle-node';

export type EnsureTbAccountRegistryInput = {
  code: number;
  ledger: number;
  ownerType: string;
  ownerUuid?: string | null;
  ownerNo?: string | null;
  assetCode: string;
  description?: string | null;
  flags?: number;
};

/**
 * Idempotently upsert a `tbAccountRegistry` row with a deterministic
 * tbAccountId derived from (code, ledger, ownerType). Returns the tbAccountId.
 *
 * The deterministic id mirrors the historic base-seed computation so that
 * re-runs (and reuse from the business seed) produce stable account ids.
 */
export async function ensureTbAccountRegistry(
  prisma: PrismaClient,
  input: EnsureTbAccountRegistryInput,
): Promise<string> {
  const ownerUuid = input.ownerUuid ?? null;

  const existing = await (prisma as any).tbAccountRegistry.findFirst({
    where: {
      code: input.code,
      ledger: input.ledger,
      ownerType: input.ownerType,
      ownerUuid,
    },
    select: { tbAccountId: true },
  });

  if (existing) {
    return existing.tbAccountId;
  }

  // Incorporate ownerUuid so owner-scoped accounts (e.g. CUSTOMER) get a
  // distinct id per owner. System accounts (ownerUuid=null) keep the historic
  // `SEED|code|ledger|ownerType` derivation for stable ids across re-runs.
  const idSeed = ownerUuid
    ? `SEED|${input.code}|${input.ledger}|${input.ownerType}|${ownerUuid}`
    : `SEED|${input.code}|${input.ledger}|${input.ownerType}`;
  const tbAccountId = createHash('sha256')
    .update(idSeed)
    .digest('hex')
    .slice(0, 32);

  await (prisma as any).tbAccountRegistry.create({
    data: {
      tbAccountId,
      code: input.code,
      ledger: input.ledger,
      ownerType: input.ownerType,
      ownerUuid,
      ownerNo: input.ownerNo ?? null,
      assetCode: input.assetCode,
      description: input.description ?? null,
      flags: input.flags ?? 0,
    },
  });

  return tbAccountId;
}

/**
 * Connect to TigerBeetle at TB_ADDRESS, read ALL tbAccountRegistry rows, and
 * create the corresponding accounts. Idempotent — "exists" results are OK.
 * Gracefully skips when TB_ADDRESS is unset or the cluster cannot be reached.
 */
export async function provisionTbAccounts(prisma: PrismaClient): Promise<void> {
  const tbAddress = process.env.TB_ADDRESS;
  if (!tbAddress) {
    console.log('  ⚠ TB_ADDRESS not set, skipping TigerBeetle account provisioning');
    return;
  }

  let client: ReturnType<typeof tbCreateClient>;
  try {
    client = tbCreateClient({ cluster_id: 0n, replica_addresses: [tbAddress] });
  } catch (err: any) {
    console.log(`  ⚠ Cannot connect to TigerBeetle at ${tbAddress}: ${err.message}`);
    return;
  }

  try {
    const allEntries = await (prisma as any).tbAccountRegistry.findMany();
    if (allEntries.length === 0) return;

    const accounts = allEntries.map((entry: any) => ({
      id: BigInt('0x' + entry.tbAccountId),
      debits_pending: 0n,
      credits_pending: 0n,
      debits_posted: 0n,
      credits_posted: 0n,
      user_data_128: entry.ownerUuid
        ? BigInt('0x' + entry.ownerUuid.replace(/-/g, ''))
        : 0n,
      user_data_64: 0n,
      user_data_32: entry.ownerType === 'SYSTEM' ? 0 : entry.ownerType === 'CUSTOMER' ? 1 : 2,
      reserved: 0,
      ledger: entry.ledger,
      code: entry.code,
      flags: entry.flags ?? 0,
      timestamp: 0n,
    }));

    const TB_ACCOUNT_EXISTS = 21;
    const TB_DEV_OK = 4294967295; // 0xFFFFFFFF — development mode "created" status
    const errors = await client.createAccounts(accounts);
    const realErrors = errors.filter(
      (e: any) => e.status !== TB_ACCOUNT_EXISTS && e.status !== TB_DEV_OK,
    );
    if (realErrors.length > 0) {
      console.log(`  ⚠ TB account provisioning had ${realErrors.length} errors: ${JSON.stringify(realErrors, (_, v) => typeof v === 'bigint' ? v.toString() : v)}`);
    }

    const created = accounts.length - errors.filter((e: any) => e.status === TB_ACCOUNT_EXISTS).length;
    const existed = errors.filter((e: any) => e.status === TB_ACCOUNT_EXISTS).length;
    console.log(`  ✔ TB accounts provisioned: ${created} created, ${existed} already existed, ${realErrors.length} errors`);
  } finally {
    client.destroy();
  }
}
