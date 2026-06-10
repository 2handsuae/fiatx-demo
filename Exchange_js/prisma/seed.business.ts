import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { createHash } from 'crypto';
import { ensureBaseSeeded } from './seed.base';
import { ensureTbAccountRegistry, provisionTbAccounts } from './seed-tb.helper';
import { DEFAULT_ASSETS } from '../src/config/manifests/assets.manifest';
import { buildDeterministicNo } from '../src/common/utils/no-generator.util';
import { TB_ACCOUNT_CODES } from '../src/modules/accounting/tigerbeetle/constants/tb-account-codes.constant';
import { TB_LEDGERS } from '../src/modules/accounting/tigerbeetle/constants/tb-ledgers.constant';
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
    .digest('hex')
    .toUpperCase();
  return `AE00FIATX${hash.slice(0, 16)}`;
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
    const custodyCode = isFiat
      ? TB_ACCOUNT_CODES.CLIENT_BANK
      : TB_ACCOUNT_CODES.CLIENT_CUSTODY;
    const systemAccounts = [
      { code: custodyCode, desc: isFiat ? 'CLIENT_BANK' : 'CLIENT_CUSTODY' },
      { code: TB_ACCOUNT_CODES.TRADE_CLEARING, desc: 'TRADE_CLEARING' },
      { code: TB_ACCOUNT_CODES.FEE_RECEIVABLE, desc: 'FEE_RECEIVABLE' },
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
            bankName: 'FiatX Internal Bank',
            accountName: `Platform ${role} (${asset.code})`,
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
            bankName: 'FiatX Internal Bank',
            accountName: `Platform ${role} (${asset.code})`,
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

  for (const pair of pairs) {
    const tiersJson = JSON.stringify({
      tiers: [
        {
          id: `${pair.levelCode}-TIER-001`,
          name: 'Default Tier',
          enabled: true,
          rateMarkupBps: 50,
          conditions: { amountMin: '0', amountMax: null },
          feeItems: [
            {
              id: `${pair.levelCode}-TIER-001-FEE-001`,
              itemCode: 'SWAP_SERVICE_FEE',
              calcType: 'FLAT',
              value: '0',
              min: null,
              max: null,
              roundingMode: 'ROUND',
            },
          ],
        },
      ],
    });
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

  let count = 0;
  for (const asset of assets) {
    const networkLabel = asset.network || 'FIAT';
    const levelCode = `STD-${asset.currency}-${networkLabel}`;
    const tierId = `${levelCode}-TIER-001`;
    const tiersJson = JSON.stringify({
      tiers: [
        {
          id: tierId,
          name: 'Default Tier',
          enabled: true,
          conditions: { amountMin: '0', amountMax: null },
          feeItems: [
            {
              id: `${tierId}-FEE-001`,
              itemCode: 'WITHDRAW_SERVICE_FEE',
              calcType: 'FLAT',
              value: '0',
              min: null,
              max: null,
              roundingMode: 'ROUND',
            },
            {
              id: `${tierId}-FEE-002`,
              itemCode: 'NETWORK_FEE_EST',
              calcType: 'FLAT',
              value: '0',
              min: null,
              max: null,
              roundingMode: 'ROUND',
            },
          ],
        },
      ],
    });
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

    // Customer-level TB accounts: CLIENT_CREDIT + CLIENT_AUDIT per asset.
    for (const asset of assets) {
      const ledger = TB_LEDGERS[asset.currency as keyof typeof TB_LEDGERS];
      for (const code of [TB_ACCOUNT_CODES.CLIENT_CREDIT, TB_ACCOUNT_CODES.CLIENT_AUDIT]) {
        await ensureTbAccountRegistry(prisma, {
          code,
          ledger,
          ownerType: 'CUSTOMER',
          ownerUuid: customer.id,
          ownerNo: customer.customerNo,
          assetCode: asset.code,
          description: `${code === TB_ACCOUNT_CODES.CLIENT_CREDIT ? 'CLIENT_CREDIT' : 'CLIENT_AUDIT'} for ${customer.customerNo}/${asset.code}`,
        });
      }
    }
  }

  console.log(`Seeded ${DEMO_CUSTOMERS.length} demo customers + customer TB accounts.`);
}
