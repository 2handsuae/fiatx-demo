import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { createHash } from 'crypto';
import { ensureBaseSeeded } from './seed.base';
import {
  buildDefaultPricingPolicyManifest,
  PricingPolicyManifestAsset,
} from '../src/config/manifests/pricing-policies.manifest';
import { WITHDRAWAL_POLICY_CODE } from '../src/modules/trading/pricing-center/types/pricing.types';

type SeedBusinessOptions = {
  skipEnsureBase?: boolean;
};

export async function seedBusiness(
  prisma: PrismaClient,
  options: SeedBusinessOptions = {},
): Promise<void> {
  console.log('--- Seeding Business Data (Minimal Profile) ---');

  if (!options.skipEnsureBase) {
    await ensureBaseSeeded(prisma);
  }

  await seedCustomersMinimal(prisma);
  await seedPricingPolicies(prisma);
  await seedWithdrawalFeeLevels(prisma);
  await seedTransactionLimitPolicies(prisma);
  console.log('✅ Business data seeded.');
}

async function seedCustomersMinimal(prisma: PrismaClient): Promise<void> {
  const basePassword = await bcrypt.hash('123456', 10);
  const now = new Date();
  const expiredAt = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const items: Array<{
    customerNo: string;
    email: string;
    phone: string;
    firstName: string;
    onboardingStatus:
      | 'NONE'
      | 'PENDING_CDD_INPUT'
      | 'APPROVED'
      | 'FINAL_APPROVAL'
      | 'REJECTED';
    eddRequired: boolean;
    cddDocumentExpiresAt: Date | null;
  }> = [
    {
      customerNo: 'CUST-MIN-0001',
      email: 'minimal_none@example.com',
      phone: '+15551000001',
      firstName: 'MinimalNone',
      onboardingStatus: 'NONE',
      eddRequired: false,
      cddDocumentExpiresAt: null,
    },
    {
      customerNo: 'CUST-MIN-0002',
      email: 'minimal_progress@example.com',
      phone: '+15551000002',
      firstName: 'MinimalProgress',
      onboardingStatus: 'PENDING_CDD_INPUT',
      eddRequired: false,
      cddDocumentExpiresAt: null,
    },
    {
      customerNo: 'CUST-MIN-0003',
      email: 'minimal_active@example.com',
      phone: '+15551000003',
      firstName: 'MinimalActive',
      onboardingStatus: 'APPROVED',
      eddRequired: false,
      cddDocumentExpiresAt: null,
    },
    {
      customerNo: 'CUST-MIN-0004',
      email: 'minimal_restricted@example.com',
      phone: '+15551000004',
      firstName: 'MinimalRestricted',
      onboardingStatus: 'FINAL_APPROVAL',
      eddRequired: true,
      cddDocumentExpiresAt: null,
    },
    {
      customerNo: 'CUST-MIN-0005',
      email: 'minimal_blocked@example.com',
      phone: '+15551000005',
      firstName: 'MinimalBlocked',
      onboardingStatus: 'REJECTED',
      eddRequired: false,
      cddDocumentExpiresAt: null,
    },
    {
      customerNo: 'CUST-MIN-0006',
      email: 'minimal_expired@example.com',
      phone: '+15551000006',
      firstName: 'MinimalExpired',
      onboardingStatus: 'PENDING_CDD_INPUT',
      eddRequired: false,
      cddDocumentExpiresAt: expiredAt,
    },
  ];

  for (const item of items) {
    const canonical = {
      onboardingStatus: item.onboardingStatus,
      adminStatus: item.onboardingStatus === 'APPROVED' ? 'ACTIVE' : 'INACTIVE',
    };

    await prisma.customerMain.upsert({
      where: { email: item.email },
      update: {
        customerNo: item.customerNo,
        phone: item.phone,
        firstName: item.firstName,
        lastName: 'Demo',
        passwordHash: basePassword,
        passwordUpdatedAt: now,
        customerType: 'INDIVIDUAL',
        onboardingStatus: canonical.onboardingStatus,
        adminStatus: canonical.adminStatus,
        riskRating: 'LOW',
        eddRequired: item.eddRequired,
        cddDocumentExpiresAt: item.cddDocumentExpiresAt,
      },
      create: {
        customerNo: item.customerNo,
        email: item.email,
        phone: item.phone,
        firstName: item.firstName,
        lastName: 'Demo',
        passwordHash: basePassword,
        passwordUpdatedAt: now,
        customerType: 'INDIVIDUAL',
        onboardingStatus: canonical.onboardingStatus,
        adminStatus: canonical.adminStatus,
        riskRating: 'LOW',
        eddRequired: item.eddRequired,
        cddDocumentExpiresAt: item.cddDocumentExpiresAt,
      },
    });
  }

  console.log(`Seeded ${items.length} minimal customers.`);
}

async function seedPricingPolicies(prisma: PrismaClient): Promise<void> {
  const activeAssets = await prisma.asset.findMany({
    where: { status: 'ACTIVE' },
    orderBy: [{ type: 'asc' }, { code: 'asc' }, { network: 'asc' }],
    select: {
      id: true,
      code: true,
      currency: true,
      type: true,
      network: true,
      decimals: true,
    },
  }) as PricingPolicyManifestAsset[];

  if (activeAssets.length === 0) {
    console.log('Skip pricing policy seed: no active assets found.');
    return;
  }

  const manifestItems = buildDefaultPricingPolicyManifest(activeAssets);

  for (const item of manifestItems) {
    await prisma.pricingPolicy.upsert({
      where: { policyCode: item.policyCode },
      update: {
        policyName: item.policyName,
        business: item.business,
        channelOnline: item.channelOnline,
        channelStoreSoon: item.channelStoreSoon,
        configJson: JSON.stringify(item.config),
        updatedByUserId: 'SYSTEM',
        updatedByUserNo: 'SYSTEM',
      },
      create: {
        policyCode: item.policyCode,
        policyName: item.policyName,
        business: item.business,
        channelOnline: item.channelOnline,
        channelStoreSoon: item.channelStoreSoon,
        configJson: JSON.stringify(item.config),
        updatedByUserId: 'SYSTEM',
        updatedByUserNo: 'SYSTEM',
      },
    });
  }

  const swapManifest = manifestItems.find((item) => item.policyCode === 'SWAP_PRICING');
  const withdrawalManifest = manifestItems.find(
    (item) => item.policyCode === 'WITHDRAWAL_PRICING',
  );

  console.log(
    `Seeded pricing policies (swap pairs: ${swapManifest?.config.pairs.length || 0}, withdrawal assets: ${withdrawalManifest?.config.assets.length || 0}).`,
  );
}

async function seedWithdrawalFeeLevels(prisma: PrismaClient): Promise<void> {
  const withdrawalPolicy = await prisma.pricingPolicy.findFirst({
    where: { policyCode: WITHDRAWAL_POLICY_CODE },
  });

  if (!withdrawalPolicy) {
    console.log('Skip withdrawal fee level seed: no WITHDRAWAL_PRICING policy found.');
    return;
  }

  // Build assetId → currency lookup so we don't rely on configJson having assetCurrency
  const assets = await prisma.asset.findMany({
    where: { status: 'ACTIVE' },
    select: { id: true, currency: true },
  });
  const currencyById = new Map(assets.map((a) => [a.id, a.currency]));

  const config = JSON.parse(withdrawalPolicy.configJson);
  let count = 0;

  for (const assetEntry of config.assets) {
    const currency = assetEntry.assetCurrency || currencyById.get(assetEntry.assetId) || 'UNKNOWN';
    const networkLabel = assetEntry.network || 'FIAT';
    const levelCode = `STD-${currency}-${networkLabel}`;
    const tiersJson = JSON.stringify({ tiers: assetEntry.tiers });
    const configHash = createHash('sha256').update(tiersJson).digest('hex');

    await prisma.withdrawalFeeLevel.upsert({
      where: { levelCode },
      update: { tiersJson, configHash },
      create: {
        levelCode,
        name: `Standard ${currency}`,
        assetId: assetEntry.assetId,
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
