import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { createHash } from 'crypto';
import { createClient as tbCreateClient } from 'tigerbeetle-node';
import { ensureBaseSeeded } from './seed.base';
import { ensureTbAccountRegistry, provisionTbAccounts } from './seed-tb.helper';
import { DEFAULT_ASSETS } from '../src/config/manifests/assets.manifest';
import { buildDeterministicNo } from '../src/common/utils/no-generator.util';
import { TB_ACCOUNT_CODES } from '../src/modules/accounting/tigerbeetle/constants/tb-account-codes.constant';
import { TB_TRANSFER_CODES } from '../src/modules/accounting/tigerbeetle/constants/tb-transfer-codes.constant';
import { TB_LEDGERS } from '../src/modules/accounting/tigerbeetle/constants/tb-ledgers.constant';
import { deterministicTransferId } from '../src/modules/accounting/tigerbeetle/utils/tb-id.util';
import {
  CRYPTO_SYSTEM_WALLET_ROLES,
  FIAT_SYSTEM_WALLET_ROLES,
} from '../src/modules/asset-treasury/wallets/system-wallet.util';
import { WalletRole } from '../src/modules/asset-treasury/wallets/dto/wallet.dto';

type SeedBusinessOptions = {
  skipEnsureBase?: boolean;
};

export async function seedBusiness(
  prisma: PrismaClient,
  options: SeedBusinessOptions = {},
): Promise<void> {
  console.log('--- Seeding Business Data (Transaction-Ready Demo) ---');

  if (!options.skipEnsureBase) {
    await ensureBaseSeeded(prisma);
  }

  // ① Assets layer
  await seedAssets(prisma);
  // ② Config layer
  await seedSwapFeeLevels(prisma);
  await seedWithdrawalFeeLevels(prisma);
  await seedTransactionLimitPolicies(prisma);
  // ③ Customers layer
  await seedCustomers(prisma);
  // Final: push all registry rows (system + customer) into TigerBeetle.
  await provisionTbAccounts(prisma);
  // Firm capital bootstrap: DR FIRM_ASSET / CR FIRM_OPS per currency.
  await seedCapitalInjection(prisma);

  console.log('✅ Business data seeded.');
}

// ─────────────────────────────────────────────────────────────
// ① Assets layer — assets + system TB accounts + system wallets
// ─────────────────────────────────────────────────────────────

function normalizeNetwork(network: string | null | undefined): string {
  return network ?? '';
}

function normalizeSegment(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]+/g, '_');
}

// System wallet roles required by V7 settlement/fee workflows, selected per
// asset type: crypto pools (C_MAIN/C_OUT/F_LIQ/F_OPS) vs fiat pools
// (C_CMA/F_SET/F_FEE/F_OPS/F_LIQ). See system-wallet.util.ts.
type SystemWalletRole = WalletRole;

function buildSystemWalletAddress(
  role: SystemWalletRole,
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

function buildSystemPoolIban(role: SystemWalletRole, assetCode: string): string {
  const hash = createHash('sha256')
    .update(`${role}|${normalizeSegment(assetCode)}`)
    .digest('hex');
  // AE IBAN 形制:AE + 2 check digits + 3-digit bank code + 16-digit account (23 chars)。
  // 演示库:数字从 hash 确定性导出,不做真实 mod-97 校验(spec §7 范围外)。
  const digits = BigInt('0x' + hash.slice(0, 24)).toString().padStart(18, '0').slice(0, 18);
  return `AE${digits.slice(0, 2)}086${digits.slice(2, 18)}`;
}

async function seedAssets(prisma: PrismaClient): Promise<void> {
  for (const asset of DEFAULT_ASSETS) {
    const normalizedNetwork = normalizeNetwork(asset.network);
    const currency = asset.currency as keyof typeof TB_LEDGERS;
    const ledger = TB_LEDGERS[currency];

    const record = await prisma.asset.upsert({
      where: {
        type_currency_network: {
          type: asset.type,
          currency: asset.currency,
          network: normalizedNetwork,
        },
      },
      update: {
        assetNo: asset.assetNo,
        code: asset.code,
        decimals: asset.decimals,
        description: asset.description,
        status: 'ACTIVE',
        tbLedgerId: ledger,
      },
      create: {
        assetNo: asset.assetNo,
        type: asset.type,
        currency: asset.currency,
        code: asset.code,
        network: normalizedNetwork,
        decimals: asset.decimals,
        description: asset.description,
        status: 'ACTIVE',
        tbLedgerId: ledger,
      },
    });

    // System TB accounts (ownerType SYSTEM, no ownerUuid).
    const isFiat = asset.type === 'FIAT';
    const systemAccounts = [
      { code: TB_ACCOUNT_CODES.CLIENT_ASSET, desc: 'CLIENT_ASSET' },
      { code: TB_ACCOUNT_CODES.FIRM_ASSET, desc: 'FIRM_ASSET' },
      { code: TB_ACCOUNT_CODES.FIRM_OPS, desc: 'FIRM_OPS' },
      { code: TB_ACCOUNT_CODES.FIRM_FEE, desc: 'FIRM_FEE' },
      { code: TB_ACCOUNT_CODES.FIRM_LIQ, desc: 'FIRM_LIQ' },
      ...(isFiat ? [{ code: TB_ACCOUNT_CODES.FIRM_SET, desc: 'FIRM_SET' }] : []),
    ];
    for (const acct of systemAccounts) {
      await ensureTbAccountRegistry(prisma, {
        code: acct.code,
        ledger,
        ownerType: 'SYSTEM',
        ownerUuid: null,
        ownerNo: null,
        assetCode: asset.code,
        description: `${acct.desc} for ${asset.code}`,
      });
    }

    // System wallets (ownerType PLATFORM), one per role — fiat vs crypto pool sets.
    // C_CMA is provisioned (required by demo:withdraw fiat source pool); we hide
    // it from External Balances UI via a planWallets filter in recon-demo.ts.
    const systemRoles = isFiat ? FIAT_SYSTEM_WALLET_ROLES : CRYPTO_SYSTEM_WALLET_ROLES;
    for (const role of systemRoles) {
      const owner = { ownerType: 'PLATFORM' as const, ownerNo: 'PLATFORM' };
      const walletNo = buildDeterministicNo(
        'WA',
        role,
        normalizeSegment(asset.code),
        normalizedNetwork ? normalizeSegment(normalizedNetwork) : '',
      );

      if (isFiat) {
        await prisma.wallet.upsert({
          where: { walletNo },
          update: {
            ownerType: owner.ownerType,
            ownerId: null,
            ownerNo: owner.ownerNo,
            type: 'FIAT_BANK',
            walletRole: role,
            assetId: record.id,
            iban: buildSystemPoolIban(role, asset.code),
            bankName: 'Zand Bank PJSC',
            accountName: 'FiatX Ltd',
            status: 'ACTIVE',
          },
          create: {
            walletNo,
            ownerType: owner.ownerType,
            ownerId: null,
            ownerNo: owner.ownerNo,
            type: 'FIAT_BANK',
            walletRole: role,
            assetId: record.id,
            iban: buildSystemPoolIban(role, asset.code),
            bankName: 'Zand Bank PJSC',
            accountName: 'FiatX Ltd',
            status: 'ACTIVE',
          },
        });
      } else {
        const address = buildSystemWalletAddress(role, asset.code, asset.network);
        await prisma.wallet.upsert({
          where: { walletNo },
          update: {
            ownerType: owner.ownerType,
            ownerId: null,
            ownerNo: owner.ownerNo,
            type: 'CRYPTO_ADDRESS',
            walletRole: role,
            assetId: record.id,
            address,
            status: 'ACTIVE',
          },
          create: {
            walletNo,
            ownerType: owner.ownerType,
            ownerId: null,
            ownerNo: owner.ownerNo,
            type: 'CRYPTO_ADDRESS',
            walletRole: role,
            assetId: record.id,
            address,
            status: 'ACTIVE',
          },
        });
      }
    }
  }

  console.log(
    `Seeded ${DEFAULT_ASSETS.length} assets + system TB accounts + system wallets.`,
  );
}

// ─────────────────────────────────────────────────────────────
// ② Config layer — swap fee levels, withdrawal fee levels, limits
// ─────────────────────────────────────────────────────────────

async function seedSwapFeeLevels(prisma: PrismaClient): Promise<void> {
  const usdt = await prisma.asset.findFirst({
    where: { type: 'CRYPTO', currency: 'USDT', status: 'ACTIVE' },
    select: { id: true, currency: true },
  });
  const aed = await prisma.asset.findFirst({
    where: { type: 'FIAT', currency: 'AED', status: 'ACTIVE' },
    select: { id: true, currency: true },
  });

  if (!usdt || !aed) {
    console.log('Skip swap fee level seed: USDT/AED assets not found.');
    return;
  }

  // Both directions of the USDT/AED pair.
  const pairs: Array<{
    levelCode: string;
    name: string;
    fromAssetId: string;
    toAssetId: string;
    feeCurrency: string;
  }> = [
    {
      levelCode: 'STD-USDT-AED',
      name: 'Standard USDT → AED',
      fromAssetId: usdt.id,
      toAssetId: aed.id,
      feeCurrency: aed.currency,
    },
    {
      levelCode: 'STD-AED-USDT',
      name: 'Standard AED → USDT',
      fromAssetId: aed.id,
      toAssetId: usdt.id,
      feeCurrency: usdt.currency,
    },
  ];

  // 4-tier amount-based gradient: larger trades get better rate markup AND lower flat fee.
  // Tier boundaries differ per direction to reflect natural transaction-size distribution
  // (USDT side has finer granularity; AED side scales up faster).
  const tiersByDirection: Record<
    string,
    Array<{ amountMin: string; amountMax: string | null; rateMarkupBps: number; flatFee: string }>
  > = {
    'STD-USDT-AED': [
      { amountMin: '0',     amountMax: '500',   rateMarkupBps: 100, flatFee: '30' },
      { amountMin: '500',   amountMax: '2000',  rateMarkupBps: 60,  flatFee: '20' },
      { amountMin: '2000',  amountMax: '10000', rateMarkupBps: 40,  flatFee: '15' },
      { amountMin: '10000', amountMax: null,    rateMarkupBps: 20,  flatFee: '10' },
    ],
    'STD-AED-USDT': [
      { amountMin: '0',     amountMax: '1000',  rateMarkupBps: 100, flatFee: '8' },
      { amountMin: '1000',  amountMax: '5000',  rateMarkupBps: 60,  flatFee: '5' },
      { amountMin: '5000',  amountMax: '30000', rateMarkupBps: 40,  flatFee: '3' },
      { amountMin: '30000', amountMax: null,    rateMarkupBps: 20,  flatFee: '2' },
    ],
  };

  for (const pair of pairs) {
    const tiers = tiersByDirection[pair.levelCode].map((t, i) => {
      const tierIdx = String(i + 1).padStart(3, '0');
      return {
        id: `${pair.levelCode}-TIER-${tierIdx}`,
        name: `Tier ${i + 1} (${t.amountMin}${t.amountMax ? '-' + t.amountMax : '+'})`,
        enabled: true,
        rateMarkupBps: t.rateMarkupBps,
        conditions: { amountMin: t.amountMin, amountMax: t.amountMax },
        feeItems: [
          {
            id: `${pair.levelCode}-TIER-${tierIdx}-FEE-001`,
            itemCode: 'SWAP_SERVICE_FEE',
            calcType: 'FLAT',
            value: t.flatFee,
            min: null,
            max: null,
            roundingMode: 'ROUND',
          },
        ],
      };
    });
    const tiersJson = JSON.stringify({ tiers });
    const configHash = createHash('sha256').update(tiersJson).digest('hex');

    await prisma.swapFeeLevel.upsert({
      where: { levelCode: pair.levelCode },
      update: { tiersJson, configHash, status: 'ACTIVE' },
      create: {
        levelCode: pair.levelCode,
        name: pair.name,
        fromAssetId: pair.fromAssetId,
        toAssetId: pair.toAssetId,
        isDefault: true,
        enabled: true,
        tiersJson,
        configHash,
        status: 'ACTIVE',
        createdByUserId: 'SYSTEM',
      },
    });
  }

  console.log(`Seeded ${pairs.length} swap fee levels.`);
}

async function seedWithdrawalFeeLevels(prisma: PrismaClient): Promise<void> {
  const assets = await prisma.asset.findMany({
    where: { status: 'ACTIVE' },
    select: { id: true, currency: true, network: true, decimals: true },
    orderBy: [{ currency: 'asc' }, { network: 'asc' }],
  });

  // 4-tier amount-based gradient per asset. Larger withdrawals get higher absolute fee
  // but lower effective percentage. NETWORK_FEE_EST applies only to crypto (on-chain gas).
  const tiersByCurrency: Record<
    string,
    Array<{ amountMin: string; amountMax: string | null; serviceFee: string; networkFee: string }>
  > = {
    AED: [
      { amountMin: '0',      amountMax: '1000',    serviceFee: '30',  networkFee: '0' },
      { amountMin: '1000',   amountMax: '10000',   serviceFee: '50',  networkFee: '0' },
      { amountMin: '10000',  amountMax: '100000',  serviceFee: '100', networkFee: '0' },
      { amountMin: '100000', amountMax: null,      serviceFee: '200', networkFee: '0' },
    ],
    USDT: [
      { amountMin: '0',     amountMax: '100',   serviceFee: '3',  networkFee: '1' },
      { amountMin: '100',   amountMax: '1000',  serviceFee: '5',  networkFee: '1' },
      { amountMin: '1000',  amountMax: '10000', serviceFee: '10', networkFee: '1' },
      { amountMin: '10000', amountMax: null,    serviceFee: '20', networkFee: '1' },
    ],
  };

  // Fallback for any asset not explicitly listed above (single default tier).
  const fallbackTiers = [
    { amountMin: '0', amountMax: null, serviceFee: '5', networkFee: '0' },
  ];

  let count = 0;
  for (const asset of assets) {
    const networkLabel = asset.network || 'FIAT';
    const levelCode = `STD-${asset.currency}-${networkLabel}`;
    const tierData = tiersByCurrency[asset.currency] ?? fallbackTiers;
    const tiers = tierData.map((t, i) => {
      const tierIdx = String(i + 1).padStart(3, '0');
      const tierId = `${levelCode}-TIER-${tierIdx}`;
      return {
        id: tierId,
        name: `Tier ${i + 1} (${t.amountMin}${t.amountMax ? '-' + t.amountMax : '+'})`,
        enabled: true,
        conditions: { amountMin: t.amountMin, amountMax: t.amountMax },
        feeItems: [
          {
            id: `${tierId}-FEE-001`,
            itemCode: 'WITHDRAW_SERVICE_FEE',
            calcType: 'FLAT',
            value: t.serviceFee,
            min: null,
            max: null,
            roundingMode: 'ROUND',
          },
          {
            id: `${tierId}-FEE-002`,
            itemCode: 'NETWORK_FEE_EST',
            calcType: 'FLAT',
            value: t.networkFee,
            min: null,
            max: null,
            roundingMode: 'ROUND',
          },
        ],
      };
    });
    const tiersJson = JSON.stringify({ tiers });
    const configHash = createHash('sha256').update(tiersJson).digest('hex');

    await prisma.withdrawalFeeLevel.upsert({
      where: { levelCode },
      update: { tiersJson, configHash, status: 'ACTIVE' },
      create: {
        levelCode,
        name: `Standard ${asset.currency}`,
        assetId: asset.id,
        isDefault: true,
        enabled: true,
        tiersJson,
        configHash,
        status: 'ACTIVE',
        createdByUserId: 'SYSTEM',
      },
    });
    count++;
  }

  console.log(`Seeded ${count} withdrawal fee levels.`);
}

export async function seedTransactionLimitPolicies(prisma: PrismaClient): Promise<void> {
  const policies = [
    { policyNo: 'TLP-001', tradingTier: 'BASIC',   operationType: 'WITHDRAWAL', period: 'DAILY', limitAmount: 30000 },
    { policyNo: 'TLP-002', tradingTier: 'BASIC',   operationType: 'SWAP',       period: 'DAILY', limitAmount: 100000 },
    { policyNo: 'TLP-003', tradingTier: 'PREMIUM',  operationType: 'WITHDRAWAL', period: 'DAILY', limitAmount: 150000 },
    { policyNo: 'TLP-004', tradingTier: 'PREMIUM',  operationType: 'SWAP',       period: 'DAILY', limitAmount: 500000 },
  ];

  for (const p of policies) {
    await prisma.transactionLimitPolicy.upsert({
      where: {
        tradingTier_operationType_period: {
          tradingTier: p.tradingTier,
          operationType: p.operationType,
          period: p.period,
        },
      },
      update: {
        policyNo: p.policyNo,
        limitAmount: p.limitAmount,
      },
      create: {
        policyNo: p.policyNo,
        tradingTier: p.tradingTier,
        operationType: p.operationType,
        period: p.period,
        limitAmount: p.limitAmount,
        status: 'ACTIVE',
      },
    });
  }

  console.log(`  ✔ Seeded ${policies.length} transaction limit policies`);
}

// ─────────────────────────────────────────────────────────────
// ③ Customers layer — 8 varied demo customers + customer TB accounts
// ─────────────────────────────────────────────────────────────

type DemoCustomer = {
  email: string;
  phone: string;
  firstName: string;
  lastName: string;
  customerType: 'INDIVIDUAL' | 'CORPORATE';
  onboardingStatus: string;
  adminStatus: string;
  complianceStatus: string;
  riskRating: string;
  tradingTier: string;
  eddRequired: boolean;
  companyName?: string;
  complianceFreezeReason?: string;
};

const DEMO_CUSTOMERS: DemoCustomer[] = [
  // 2× happy (APPROVED + CLEAR)
  {
    email: 'demo_alice@example.com', phone: '+15552000001',
    firstName: 'Alice', lastName: 'Happy', customerType: 'INDIVIDUAL',
    onboardingStatus: 'APPROVED', adminStatus: 'ACTIVE', complianceStatus: 'CLEAR',
    riskRating: 'LOW', tradingTier: 'BASIC', eddRequired: false,
  },
  {
    email: 'demo_bob@example.com', phone: '+15552000002',
    firstName: 'Bob', lastName: 'Happy', customerType: 'INDIVIDUAL',
    onboardingStatus: 'APPROVED', adminStatus: 'ACTIVE', complianceStatus: 'CLEAR',
    riskRating: 'LOW', tradingTier: 'BASIC', eddRequired: false,
  },
  // 1× compliance FROZEN
  {
    email: 'demo_carol@example.com', phone: '+15552000003',
    firstName: 'Carol', lastName: 'Frozen', customerType: 'INDIVIDUAL',
    onboardingStatus: 'APPROVED', adminStatus: 'ACTIVE', complianceStatus: 'FROZEN',
    riskRating: 'MEDIUM', tradingTier: 'BASIC', eddRequired: true,
    complianceFreezeReason: 'Adverse media alert triggered',
  },
  // 1× PENDING_VERIFICATION
  {
    email: 'demo_dave@example.com', phone: '+15552000004',
    firstName: 'Dave', lastName: 'Pending', customerType: 'INDIVIDUAL',
    onboardingStatus: 'PENDING_VERIFICATION', adminStatus: 'INACTIVE', complianceStatus: 'CLEAR',
    riskRating: 'LOW', tradingTier: 'BASIC', eddRequired: false,
  },
  // 1× onboarding NONE
  {
    email: 'demo_eve@example.com', phone: '+15552000005',
    firstName: 'Eve', lastName: 'New', customerType: 'INDIVIDUAL',
    onboardingStatus: 'NONE', adminStatus: 'INACTIVE', complianceStatus: 'CLEAR',
    riskRating: 'LOW', tradingTier: 'BASIC', eddRequired: false,
  },
  // 1× HIGH risk (APPROVED + CLEAR)
  {
    email: 'demo_frank@example.com', phone: '+15552000006',
    firstName: 'Frank', lastName: 'HighRisk', customerType: 'INDIVIDUAL',
    onboardingStatus: 'APPROVED', adminStatus: 'ACTIVE', complianceStatus: 'CLEAR',
    riskRating: 'HIGH', tradingTier: 'BASIC', eddRequired: true,
  },
  // 1× PREMIUM trading tier (APPROVED + CLEAR)
  {
    email: 'demo_grace@example.com', phone: '+15552000007',
    firstName: 'Grace', lastName: 'Premium', customerType: 'INDIVIDUAL',
    onboardingStatus: 'APPROVED', adminStatus: 'ACTIVE', complianceStatus: 'CLEAR',
    riskRating: 'LOW', tradingTier: 'PREMIUM', eddRequired: false,
  },
  // 1× CORPORATE (APPROVED + CLEAR)
  {
    email: 'demo_acme@example.com', phone: '+15552000008',
    firstName: 'Henry', lastName: 'Acme', customerType: 'CORPORATE',
    onboardingStatus: 'APPROVED', adminStatus: 'ACTIVE', complianceStatus: 'CLEAR',
    riskRating: 'LOW', tradingTier: 'PREMIUM', eddRequired: false,
    companyName: 'Acme Trading LLC',
  },
];

async function seedCustomers(prisma: PrismaClient): Promise<void> {
  const passwordHash = await bcrypt.hash('123456', 10);
  const now = new Date();

  const assets = await prisma.asset.findMany({
    where: { status: 'ACTIVE' },
    select: { code: true, currency: true },
  });

  for (const c of DEMO_CUSTOMERS) {
    const data = {
      customerNo: buildDeterministicNo('CU', c.email),
      phone: c.phone,
      firstName: c.firstName,
      lastName: c.lastName,
      passwordHash,
      passwordUpdatedAt: now,
      customerType: c.customerType,
      onboardingStatus: c.onboardingStatus,
      adminStatus: c.adminStatus,
      complianceStatus: c.complianceStatus,
      complianceFreezeReason: c.complianceFreezeReason ?? null,
      complianceFreezeAt: c.complianceStatus === 'FROZEN' ? now : null,
      riskRating: c.riskRating,
      tradingTier: c.tradingTier,
      eddRequired: c.eddRequired,
      companyName: c.companyName ?? null,
    };

    const customer = await prisma.customerMain.upsert({
      where: { email: c.email },
      update: data,
      create: { email: c.email, ...data },
      select: { id: true, customerNo: true },
    });

    // Customer-level TB accounts: CLIENT_PAYABLE + DEPOSIT_SUSPENSE per asset.
    for (const asset of assets) {
      const ledger = TB_LEDGERS[asset.currency as keyof typeof TB_LEDGERS];
      for (const code of [TB_ACCOUNT_CODES.CLIENT_PAYABLE, TB_ACCOUNT_CODES.DEPOSIT_SUSPENSE]) {
        await ensureTbAccountRegistry(prisma, {
          code,
          ledger,
          ownerType: 'CUSTOMER',
          ownerUuid: customer.id,
          ownerNo: customer.customerNo,
          assetCode: asset.code,
          description: `${code === TB_ACCOUNT_CODES.CLIENT_PAYABLE ? 'CLIENT_PAYABLE' : 'DEPOSIT_SUSPENSE'} for ${customer.customerNo}/${asset.code}`,
        });
      }
    }
  }

  console.log(`Seeded ${DEMO_CUSTOMERS.length} demo customers + customer TB accounts.`);
}

// ─────────────────────────────────────────────────────────────
// Capital injection — DR FIRM_ASSET / CR FIRM_OPS per currency
// ─────────────────────────────────────────────────────────────

const SEED_FIRM_CAPITAL: Record<string, string> = {
  AED: '100000',
  USDT: '100000',
};

async function seedCapitalInjection(prisma: PrismaClient): Promise<void> {
  const tbAddress = process.env.TB_ADDRESS;
  if (!tbAddress) {
    console.log('  ⚠ TB_ADDRESS not set, skipping capital injection');
    return;
  }

  let client: ReturnType<typeof tbCreateClient>;
  try {
    client = tbCreateClient({ cluster_id: 0n, replica_addresses: [tbAddress] });
  } catch (err: any) {
    console.log(`  ⚠ Cannot connect to TigerBeetle for capital injection: ${err.message}`);
    return;
  }

  try {
    const assets = await prisma.asset.findMany({
      where: { status: 'ACTIVE' },
      select: { currency: true, decimals: true, code: true },
    });

    const transfers: any[] = [];
    for (const asset of assets) {
      const rawAmount = SEED_FIRM_CAPITAL[asset.currency];
      if (!rawAmount) continue;

      const ledger = TB_LEDGERS[asset.currency as keyof typeof TB_LEDGERS];
      const scale = BigInt(10 ** asset.decimals);
      const amount = BigInt(rawAmount) * scale;

      // Resolve FIRM_ASSET and FIRM_OPS account ids from registry
      const firmAssetReg = await (prisma as any).tbAccountRegistry.findFirst({
        where: { code: TB_ACCOUNT_CODES.FIRM_ASSET, ledger, ownerType: 'SYSTEM' },
        select: { tbAccountId: true },
      });
      const firmOpsReg = await (prisma as any).tbAccountRegistry.findFirst({
        where: { code: TB_ACCOUNT_CODES.FIRM_OPS, ledger, ownerType: 'SYSTEM' },
        select: { tbAccountId: true },
      });

      if (!firmAssetReg || !firmOpsReg) {
        console.log(`  ⚠ Missing registry entries for capital injection (${asset.currency}), skipping`);
        continue;
      }

      const transferId = deterministicTransferId('SEED_CAPITAL', asset.currency, 'CAPITAL_INJECTION', 0);

      transfers.push({
        id: transferId,
        debit_account_id: BigInt('0x' + firmAssetReg.tbAccountId),  // DR FIRM_ASSET
        credit_account_id: BigInt('0x' + firmOpsReg.tbAccountId),   // CR FIRM_OPS
        amount,
        pending_id: 0n,
        user_data_128: 0n,
        user_data_64: 0n,
        user_data_32: 0,
        timeout: 0,
        ledger,
        code: TB_TRANSFER_CODES.CAPITAL_INJECTION,
        flags: 0,
        timestamp: 0n,
      });
    }

    if (transfers.length === 0) {
      console.log('  ⚠ No capital injection transfers to create');
      return;
    }

    const TB_TRANSFER_EXISTS = 46; // CreateTransferStatus.exists
    const TB_DEV_OK = 4294967295;  // CreateTransferStatus.created (dev-mode echo)
    const errors = await client.createTransfers(transfers);
    const realErrors = errors.filter(
      (e: any) => e.status !== TB_TRANSFER_EXISTS && e.status !== TB_DEV_OK,
    );
    if (realErrors.length > 0) {
      console.log(`  ⚠ Capital injection had ${realErrors.length} errors: ${JSON.stringify(realErrors, (_, v) => typeof v === 'bigint' ? v.toString() : v)}`);
    }

    const existed = errors.filter((e: any) => e.status === TB_TRANSFER_EXISTS).length;
    console.log(`  ✔ Capital injection: ${transfers.length - existed} transfer(s) created, ${existed} already existed`);
  } finally {
    client.destroy();
  }
}
