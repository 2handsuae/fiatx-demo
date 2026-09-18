import { PrismaClient } from '@prisma/client';
import { seedBase } from './seed.base';
import { seedBusiness } from './seed.business';

type SeedMode = 'base' | 'business' | 'all';

function parseMode(argv: string[]): SeedMode {
  const modeArg = argv.find((arg) => arg.startsWith('--mode='));
  const rawMode = (modeArg ? modeArg.slice('--mode='.length) : 'business').trim().toLowerCase();

  if (rawMode === 'base' || rawMode === 'business' || rawMode === 'all') {
    return rawMode;
  }

  throw new Error(`Unsupported seed mode: ${rawMode}. Allowed: base | business | all`);
}

async function main() {
  const mode = parseMode(process.argv.slice(2));
  const prisma = new PrismaClient({
    log: ['info', 'warn', 'error'],
  });

  try {
    console.log(`🚀 Start seeding (mode: ${mode})`);

    if (mode === 'base') {
      await seedBase(prisma);
    } else if (mode === 'business') {
      await seedBusiness(prisma);
    } else {
      await seedBase(prisma);
      await seedBusiness(prisma, { skipEnsureBase: true });
    }

    console.log('✅ Seeding finished successfully.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
