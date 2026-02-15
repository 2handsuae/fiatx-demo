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
