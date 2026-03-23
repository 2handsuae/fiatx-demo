import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { ensureBaseSeeded } from './seed.base';
import {
  buildDefaultPricingPolicyManifest,
  PricingPolicyManifestAsset,
} from '../src/config/manifests/pricing-policies.manifest';

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
      operatingStatus: item.onboardingStatus === 'APPROVED' ? 'ACTIVE' : 'INACTIVE',
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
        operatingStatus: canonical.operatingStatus,
        restrictionStatus: 'CLEAR',
        amlRiskTier: 'LOW',
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
        operatingStatus: canonical.operatingStatus,
        restrictionStatus: 'CLEAR',
        amlRiskTier: 'LOW',
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
