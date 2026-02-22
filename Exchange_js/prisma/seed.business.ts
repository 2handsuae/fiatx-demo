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
    publicStatus: string;
    eddRequired: boolean;
    cddDocumentExpiresAt: Date | null;
  }> = [
    {
      customerNo: 'CUST-MIN-0001',
      email: 'minimal_none@example.com',
      phone: '+15551000001',
      firstName: 'MinimalNone',
      publicStatus: 'NONE',
      eddRequired: false,
      cddDocumentExpiresAt: null,
    },
    {
      customerNo: 'CUST-MIN-0002',
      email: 'minimal_progress@example.com',
      phone: '+15551000002',
      firstName: 'MinimalProgress',
      publicStatus: 'PENDING_CDD',
      eddRequired: false,
      cddDocumentExpiresAt: null,
    },
    {
      customerNo: 'CUST-MIN-0003',
      email: 'minimal_active@example.com',
      phone: '+15551000003',
      firstName: 'MinimalActive',
      publicStatus: 'ACTIVE',
      eddRequired: false,
      cddDocumentExpiresAt: null,
    },
    {
      customerNo: 'CUST-MIN-0004',
      email: 'minimal_restricted@example.com',
      phone: '+15551000004',
      firstName: 'MinimalRestricted',
      publicStatus: 'FINAL_APPROVAL',
      eddRequired: true,
      cddDocumentExpiresAt: null,
    },
    {
      customerNo: 'CUST-MIN-0005',
      email: 'minimal_blocked@example.com',
      phone: '+15551000005',
      firstName: 'MinimalBlocked',
      publicStatus: 'REJECTED',
      eddRequired: false,
      cddDocumentExpiresAt: null,
    },
    {
      customerNo: 'CUST-MIN-0006',
      email: 'minimal_expired@example.com',
      phone: '+15551000006',
      firstName: 'MinimalExpired',
      publicStatus: 'PENDING_CDD',
      eddRequired: false,
      cddDocumentExpiresAt: expiredAt,
    },
  ];

  for (const item of items) {
    const legacy = (() => {
      if (item.publicStatus === 'ACTIVE') {
        return {
          cddStatus: 'APPROVED',
          eddStatus: item.eddRequired ? 'APPROVED' : 'NOT_REQUIRED',
          complianceStatus: 'ACTIVE',
          finalApprovalStatus: 'APPROVED',
        };
      }
      if (item.publicStatus === 'FINAL_APPROVAL') {
        return {
          cddStatus: 'APPROVED',
          eddStatus: 'APPROVED',
          complianceStatus: 'IN_PROGRESS',
          finalApprovalStatus: 'PENDING',
        };
      }
      if (item.publicStatus === 'REJECTED') {
        return {
          cddStatus: 'REJECTED',
          eddStatus: item.eddRequired ? 'REJECTED' : 'NOT_REQUIRED',
          complianceStatus: 'BLOCKED',
          finalApprovalStatus: 'REJECTED',
        };
      }
      if (item.publicStatus === 'PENDING_CDD') {
        return {
          cddStatus: item.cddDocumentExpiresAt ? 'EXPIRED' : 'IN_PROGRESS',
          eddStatus: 'NOT_REQUIRED',
          complianceStatus: item.cddDocumentExpiresAt ? 'EXPIRED' : 'IN_PROGRESS',
          finalApprovalStatus: 'NOT_REQUIRED',
        };
      }
      return {
        cddStatus: 'NOT_STARTED',
        eddStatus: 'NOT_REQUIRED',
        complianceStatus: 'NONE',
        finalApprovalStatus: 'NOT_REQUIRED',
      };
    })();

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
        publicStatus: item.publicStatus,
        cddStatus: legacy.cddStatus,
        amlRiskTier: 'LOW',
        eddRequired: item.eddRequired,
        eddStatus: legacy.eddStatus,
        complianceStatus: legacy.complianceStatus,
        cddDocumentExpiresAt: item.cddDocumentExpiresAt,
        finalApprovalStatus: legacy.finalApprovalStatus,
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
        publicStatus: item.publicStatus,
        cddStatus: legacy.cddStatus,
        amlRiskTier: 'LOW',
        eddRequired: item.eddRequired,
        eddStatus: legacy.eddStatus,
        complianceStatus: legacy.complianceStatus,
        cddDocumentExpiresAt: item.cddDocumentExpiresAt,
        finalApprovalStatus: legacy.finalApprovalStatus,
      },
    });
  }

  console.log(`Seeded ${items.length} minimal customers.`);
}
