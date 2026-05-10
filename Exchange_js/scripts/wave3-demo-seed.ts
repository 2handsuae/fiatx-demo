// scripts/wave3-demo-seed.ts
import { PrismaClient } from '@prisma/client';

async function seed() {
  const prisma = new PrismaClient();

  const customers = await prisma.customerMain.findMany({
    where: {
      onboardingStatus: 'APPROVED',
      sumsubApplicantId: { not: null },
    },
  });

  console.log(`Seeding ${customers.length} existing customers with Wave 3 holdings`);

  for (const customer of customers) {
    try {
      // Ensure default riskRating + pepStatus
      await prisma.customerMain.update({
        where: { id: customer.id },
        data: {
          riskRating: customer.riskRating || 'LOW',
          pepStatus: customer.pepStatus || 'NONE',
        },
      });

      // Create LOW tier required holdings if missing
      const requiredMaterials: Array<{
        type: string;
        mode: 'SUMSUB_MANAGED' | 'SELF_MANAGED';
        docSet?: string;
        expiresIn?: number;  // days
      }> = [
        { type: 'EMIRATES_ID', mode: 'SUMSUB_MANAGED', docSet: 'IDENTITY', expiresIn: 365 * 5 },
        { type: 'PROOF_OF_ADDRESS', mode: 'SELF_MANAGED', expiresIn: 365 },
      ];

      for (const mat of requiredMaterials) {
        const existing = await prisma.customerMaterialHolding.findUnique({
          where: {
            customerId_materialType: {
              customerId: customer.id,
              materialType: mat.type,
            },
          },
        });
        if (existing) continue;

        const verifiedAt = customer.updatedAt || customer.createdAt;
        const expiresAt = mat.expiresIn
          ? new Date(verifiedAt.getTime() + mat.expiresIn * 24 * 60 * 60 * 1000)
          : null;

        await prisma.customerMaterialHolding.create({
          data: {
            customerId: customer.id,
            materialType: mat.type,
            managementMode: mat.mode,
            sumsubIdDocSetType: mat.docSet,
            verifiedAt,
            expiresAt,
            status: 'FRESH',
          },
        });
      }

      console.log(`  ✓ ${customer.customerNo || customer.id}`);
    } catch (err: any) {
      console.error(`  ✗ ${customer.customerNo || customer.id}: ${err.message}`);
    }
  }

  await prisma.$disconnect();
  console.log('Done.');
}

seed().catch((e) => {
  console.error(e);
  process.exit(1);
});
