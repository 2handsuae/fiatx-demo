import { PrismaClient } from '@prisma/client';
import { createHash } from 'crypto';
import { createClient as tbCreateClient, CreateAccountStatus } from 'tigerbeetle-node';
import {
  accountFlagsFor,
  cashAccountName,
  TB_ACCOUNT_CODES,
  TB_ACCOUNT_NAMES,
  walletAccountCodesFor,
} from '../src/modules/accounting/tigerbeetle/constants/tb-account-codes.constant';
import { ledgerForNetwork, TB_LEDGERS } from '../src/modules/accounting/tigerbeetle/constants/tb-ledgers.constant';
import { currencyForNetwork } from '../src/config/manifests/assets.manifest';
import type { NetworkCode } from '../src/config/manifests/networks.manifest';

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
      flags: input.flags ?? accountFlagsFor(input.code),
    },
  });

  return tbAccountId;
}

export type EnsureWalletCashAccountInput = {
  id: string;
  walletNo: string;
  /** 'PLATFORM' | 'CUSTOMER'(→ cashAccountCodeFor) */
  ownerType: string;
  ownerNo: string;
  vaultCode: string;
  walletRole: string;
  network: string;
};

/**
 * 种子 / 演示脚本版的「钱包户开户」（戊波一 §2.3，与 WalletCashAccountService.ensureForWallet 同语义；戊波二加码 2）：
 * 按 `walletAccountCodesFor`（客户钱包 1 + 2、平台钱包 50）写 (code, 钱包所在网络的币种 ledger, 'WALLET', wallet.id) 注册表行
 * （户名进 description、flags 按类别），并立即在 `tbClient` 上建出对应 TB 账户（"已存在"视为成功）。返回现金户（码 1 / 50）的 tbAccountId。
 * 与 ensureTbAccountRegistry 同形：有注册行就复用其 id；TB 侧 createAccounts 幂等，所以重跑安全。
 */
export async function ensureWalletCashAccount(
  prisma: PrismaClient,
  tbClient: ReturnType<typeof tbCreateClient>,
  wallet: EnsureWalletCashAccountInput,
): Promise<string> {
  const assetCurrency = currencyForNetwork(wallet.network as NetworkCode);
  const ledger = ledgerForNetwork(wallet.network as NetworkCode);

  const opened: Array<{ code: number; tbAccountId: string }> = [];
  for (const code of walletAccountCodesFor(wallet.ownerType)) {
    const tbAccountId = await ensureTbAccountRegistry(prisma, {
      code,
      ledger,
      ownerType: 'WALLET',
      ownerUuid: wallet.id,
      ownerNo: wallet.walletNo,
      assetCode: assetCurrency,
      description: cashAccountName(code, wallet),
      flags: accountFlagsFor(code),
    });
    opened.push({ code, tbAccountId });
  }

  await createSeedTbAccounts(
    tbClient,
    'WALLET',
    opened.map(({ code, tbAccountId }) => ({ tbAccountId, code, ledger, ownerUuid: wallet.id })),
    `ensureWalletCashAccount(${wallet.walletNo})`,
  );
  return opened[0].tbAccountId;
}

export type EnsureLpReceivableAccountsInput = {
  id: string;
  lpNo: string;
  name: string;
};

/**
 * 种子版的「LP 应收户开户」（戊波二，与 LpReceivableAccountService.ensureForLp 同语义）：
 * 每个 ledger（AED + USDT）一户 (51, ledger, 'LP', lp.id)，ownerNo = lpNo，户名 `Due from LP · <LP 名称>`，flags 按借方户；
 * 注册表行与 TB 账户同步建出。LP 行在 provisionTbAccounts 之后才铺，所以不能等它统一建户，这里立即建（同 ensureWalletCashAccount）。
 */
export async function ensureLpReceivableAccounts(
  prisma: PrismaClient,
  tbClient: ReturnType<typeof tbCreateClient>,
  lp: EnsureLpReceivableAccountsInput,
): Promise<void> {
  const code = TB_ACCOUNT_CODES.LP_RECEIVABLE;
  const opened: Array<{ tbAccountId: string; code: number; ledger: number; ownerUuid: string }> = [];
  for (const [currency, ledger] of Object.entries(TB_LEDGERS)) {
    const tbAccountId = await ensureTbAccountRegistry(prisma, {
      code,
      ledger,
      ownerType: 'LP',
      ownerUuid: lp.id,
      ownerNo: lp.lpNo,
      assetCode: currency,
      description: `${TB_ACCOUNT_NAMES[code]} · ${lp.name}`,
      flags: accountFlagsFor(code),
    });
    opened.push({ tbAccountId, code, ledger, ownerUuid: lp.id });
  }
  await createSeedTbAccounts(tbClient, 'LP', opened, `ensureLpReceivableAccounts(${lp.lpNo})`);
}

/** 种子开户共用：把已写好注册表行的账户在 TB 上建出来（一批；"已存在"视为成功），其余错误抛。user_data_32 = 3 是 WALLET 归属、2 是 LP 归属（同 AccountingService.createAccounts）。 */
async function createSeedTbAccounts(
  tbClient: ReturnType<typeof tbCreateClient>,
  ownerKind: 'WALLET' | 'LP',
  accounts: Array<{ tbAccountId: string; code: number; ledger: number; ownerUuid: string }>,
  label: string,
): Promise<void> {
  const errors = await tbClient.createAccounts(
    accounts.map((a) => ({
      id: BigInt('0x' + a.tbAccountId),
      debits_pending: 0n,
      credits_pending: 0n,
      debits_posted: 0n,
      credits_posted: 0n,
      user_data_128: BigInt('0x' + a.ownerUuid.replace(/-/g, '')),
      user_data_64: 0n,
      user_data_32: ownerKind === 'WALLET' ? 3 : 2,
      reserved: 0,
      ledger: a.ledger,
      code: a.code,
      flags: accountFlagsFor(a.code),
      timestamp: 0n,
    })),
  );
  const realErrors = errors.filter(
    (e: any) => e.status !== CreateAccountStatus.exists && e.status !== CreateAccountStatus.created,
  );
  if (realErrors.length > 0) {
    throw new Error(
      `${label} TB createAccounts failed: ${JSON.stringify(realErrors, (_, v) => (typeof v === 'bigint' ? v.toString() : v))}`,
    );
  }
}

/**
 * 单次 createAccounts 提交的账户数上限。TigerBeetle 一批能塞多少条取决于集群的消息大小；
 * 自栈（--development）实测 250 条能过、254 条起报 "Too much data was sent or requested in this batch"。
 * 注册表随钱包增长（每个钱包一个现金户），整表一批迟早越线，故分批提交；100 离实测上限有足够余量。
 */
export const TB_CREATE_ACCOUNTS_BATCH_SIZE = 100;

/**
 * Connect to TigerBeetle at TB_ADDRESS, read ALL tbAccountRegistry rows, and
 * create the corresponding accounts (in chunks of TB_CREATE_ACCOUNTS_BATCH_SIZE).
 * Idempotent — "exists" results are OK.
 * Gracefully skips when TB_ADDRESS is unset or the cluster cannot be reached.
 */
export async function provisionTbAccounts(prisma: PrismaClient): Promise<void> {
  const tbAddress = process.env.TB_ADDRESS;
  if (!tbAddress) {
    // 不再 graceful skip：本函数只被业务 seed 调用，而业务 seed 永远需要 TigerBeetle，
    // 没有任何"这次不需要 TB"的合法场景。跳过却 exit 0 会建出一个"库是满的、账本是空的"
    // 数据库，故障点离根因很远（2026-08-31 那次 verify:coa 负余额查了一整轮没定位到）。
    throw new Error(
      'TB_ADDRESS 未设置，无法建 TigerBeetle 账户。seed 不做 graceful skip——' +
        '跳过会建出账本为空的库，失败点离根因很远。' +
        '修法：确认调用方显式传 TB_ADDRESS（见 scripts/reset-stack.sh），或先 `stack.sh up` 让 .env 落地。',
    );
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
      user_data_32: entry.ownerType === 'SYSTEM' ? 0 : entry.ownerType === 'CUSTOMER' ? 1 : entry.ownerType === 'WALLET' ? 3 : 2,
      reserved: 0,
      ledger: entry.ledger,
      code: entry.code,
      flags: entry.flags ?? accountFlagsFor(entry.code),
      timestamp: 0n,
    }));

    const TB_ACCOUNT_EXISTS = 21;
    const TB_DEV_OK = 4294967295; // 0xFFFFFFFF — development mode "created" status
    const realErrors: any[] = [];
    let existed = 0;
    for (let start = 0; start < accounts.length; start += TB_CREATE_ACCOUNTS_BATCH_SIZE) {
      const errors: any[] = await client.createAccounts(accounts.slice(start, start + TB_CREATE_ACCOUNTS_BATCH_SIZE));
      existed += errors.filter((e: any) => e.status === TB_ACCOUNT_EXISTS).length;
      realErrors.push(...errors.filter((e: any) => e.status !== TB_ACCOUNT_EXISTS && e.status !== TB_DEV_OK));
    }
    if (realErrors.length > 0) {
      console.log(`  ⚠ TB account provisioning had ${realErrors.length} errors: ${JSON.stringify(realErrors, (_, v) => typeof v === 'bigint' ? v.toString() : v)}`);
    }

    const created = accounts.length - existed;
    console.log(`  ✔ TB accounts provisioned: ${created} created, ${existed} already existed, ${realErrors.length} errors`);
  } finally {
    client.destroy();
  }
}
