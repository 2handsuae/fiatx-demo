import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { ensureBaseSeeded } from './seed.base';

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
  await seedPlatformSystemWallets(prisma);
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
    cddStatus: string;
    eddRequired: boolean;
    eddStatus: string;
    complianceStatus: string;
    cddDocumentExpiresAt: Date | null;
  }> = [
    {
      customerNo: 'CUST-MIN-0001',
      email: 'minimal_none@example.com',
      phone: '+15551000001',
      firstName: 'MinimalNone',
      cddStatus: 'NOT_STARTED',
      eddRequired: false,
      eddStatus: 'NOT_REQUIRED',
      complianceStatus: 'NONE',
      cddDocumentExpiresAt: null,
    },
    {
      customerNo: 'CUST-MIN-0002',
      email: 'minimal_progress@example.com',
      phone: '+15551000002',
      firstName: 'MinimalProgress',
      cddStatus: 'IN_PROGRESS',
      eddRequired: false,
      eddStatus: 'NOT_REQUIRED',
      complianceStatus: 'IN_PROGRESS',
      cddDocumentExpiresAt: null,
    },
    {
      customerNo: 'CUST-MIN-0003',
      email: 'minimal_active@example.com',
      phone: '+15551000003',
      firstName: 'MinimalActive',
      cddStatus: 'APPROVED',
      eddRequired: false,
      eddStatus: 'NOT_REQUIRED',
      complianceStatus: 'ACTIVE',
      cddDocumentExpiresAt: null,
    },
    {
      customerNo: 'CUST-MIN-0004',
      email: 'minimal_restricted@example.com',
      phone: '+15551000004',
      firstName: 'MinimalRestricted',
      cddStatus: 'APPROVED',
      eddRequired: true,
      eddStatus: 'REQUIRED',
      complianceStatus: 'RESTRICTED',
      cddDocumentExpiresAt: null,
    },
    {
      customerNo: 'CUST-MIN-0005',
      email: 'minimal_blocked@example.com',
      phone: '+15551000005',
      firstName: 'MinimalBlocked',
      cddStatus: 'REJECTED',
      eddRequired: false,
      eddStatus: 'NOT_REQUIRED',
      complianceStatus: 'BLOCKED',
      cddDocumentExpiresAt: null,
    },
    {
      customerNo: 'CUST-MIN-0006',
      email: 'minimal_expired@example.com',
      phone: '+15551000006',
      firstName: 'MinimalExpired',
      cddStatus: 'EXPIRED',
      eddRequired: false,
      eddStatus: 'NOT_REQUIRED',
      complianceStatus: 'EXPIRED',
      cddDocumentExpiresAt: expiredAt,
    },
  ];

  for (const item of items) {
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
        cddStatus: item.cddStatus,
        amlRiskTier: 'LOW',
        eddRequired: item.eddRequired,
        eddStatus: item.eddStatus,
        complianceStatus: item.complianceStatus,
        cddDocumentExpiresAt: item.cddDocumentExpiresAt,
        finalApprovalStatus: 'NOT_REQUIRED',
        finalApprovalReason: null,
        finalApprovalReviewerId: null,
        finalApprovalReviewedAt: null,
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
        cddStatus: item.cddStatus,
        amlRiskTier: 'LOW',
        eddRequired: item.eddRequired,
        eddStatus: item.eddStatus,
        complianceStatus: item.complianceStatus,
        cddDocumentExpiresAt: item.cddDocumentExpiresAt,
        finalApprovalStatus: 'NOT_REQUIRED',
      },
    });
  }

  console.log(`Seeded ${items.length} minimal customers.`);
}

async function seedPlatformSystemWallets(prisma: PrismaClient): Promise<void> {
  const cryptoAssets = await prisma.asset.findMany({
    where: { type: 'CRYPTO' },
    orderBy: [{ code: 'asc' }, { network: 'asc' }],
  });

  if (cryptoAssets.length === 0) {
    console.log('No CRYPTO assets found. Skip platform system wallet seeding.');
    return;
  }

  const assetMap = new Map(
    cryptoAssets.map((asset) => [
      `${normalizeSegment(asset.code)}|${normalizeSegment(asset.network || 'NA')}`,
      asset,
    ]),
  );

  const targets = [
    {
      code: 'BTC',
      network: 'BITCOIN',
      role: 'MASTER',
      ownerType: 'CUSTOMER',
      ownerNo: 'CUSTOMER_POOL',
      direction: 'BIDIRECTIONAL',
    },
    {
      code: 'BTC',
      network: 'BITCOIN',
      role: 'LIQ',
      ownerType: 'PLATFORM',
      ownerNo: 'PLATFORM',
      direction: 'BIDIRECTIONAL',
    },
    {
      code: 'USDT',
      network: 'TRON',
      role: 'MASTER',
      ownerType: 'CUSTOMER',
      ownerNo: 'CUSTOMER_POOL',
      direction: 'BIDIRECTIONAL',
    },
    {
      code: 'USDT',
      network: 'TRON',
      role: 'LIQ',
      ownerType: 'PLATFORM',
      ownerNo: 'PLATFORM',
      direction: 'BIDIRECTIONAL',
    },
  ] as const;

  let createdOrUpdated = 0;
  let skipped = 0;

  for (const target of targets) {
    const key = `${normalizeSegment(target.code)}|${normalizeSegment(target.network)}`;
    const asset = assetMap.get(key);
    if (!asset) {
      skipped += 1;
      console.warn(
        `Skip seeding ${target.role} wallet for ${target.code}-${target.network}: asset not found`,
      );
      continue;
    }

    const walletNo = `SYS_${target.role}_${normalizeSegment(target.code)}_${normalizeSegment(target.network)}`;
    const address = `sys_${target.role.toLowerCase()}_${target.code.toLowerCase()}_${target.network.toLowerCase()}`;

    await (prisma as any).wallet.upsert({
      where: { walletNo },
      update: {
        ownerType: target.ownerType,
        ownerId: null,
        ownerNo: target.ownerNo,
        type: 'CRYPTO_ADDRESS',
        direction: target.direction,
        assetId: asset.id,
        address,
        status: 'ACTIVE',
      },
      create: {
        walletNo,
        ownerType: target.ownerType,
        ownerId: null,
        ownerNo: target.ownerNo,
        type: 'CRYPTO_ADDRESS',
        direction: target.direction,
        assetId: asset.id,
        address,
        status: 'ACTIVE',
        balance: 0,
        lockedBalance: 0,
      },
    });
    createdOrUpdated += 1;
  }

  console.log(
    `Seeded/updated ${createdOrUpdated} system wallets (skipped ${skipped}).`,
  );
}

function normalizeSegment(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]+/g, '_');
}
