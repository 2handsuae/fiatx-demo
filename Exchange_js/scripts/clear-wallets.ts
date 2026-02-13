import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Starting Wallet data cleanup...');

  try {
    // 1. Backup: Count existing records before deletion
    const count = await prisma.wallet.count();
    console.log(`Found ${count} wallet records to delete.`);

    if (count === 0) {
      console.log('No wallet records found. Skipping deletion.');
    } else {
      // 2. Delete: Delete all records from the 'wallet' table
      const deleted = await prisma.wallet.deleteMany({});
      console.log(`Successfully deleted ${deleted.count} wallet records.`);
    }

    // 3. Verify: Ensure count is 0
    const finalCount = await prisma.wallet.count();
    if (finalCount === 0) {
      console.log('Verification successful: Wallet table is empty.');
    } else {
      console.error(`Verification failed: ${finalCount} records still exist.`);
    }

  } catch (error) {
    console.error('Error during wallet cleanup:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
