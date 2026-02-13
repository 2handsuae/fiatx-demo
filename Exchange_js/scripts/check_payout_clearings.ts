
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('--- Checking Withdrawals & Clearings ---');
  
  // Find recent withdrawals (last 10)
  const withdrawals = await prisma.withdrawTransaction.findMany({
    take: 10,
    orderBy: { createdAt: 'desc' },
    include: {
      payout: {
        include: {
          clearings: {
            include: {
              lines: true
            }
          }
        }
      }
    }
  });

  console.log(`Found ${withdrawals.length} recent withdrawals.`);

  for (const w of withdrawals) {
    const clearingCount = w.payout?.clearings?.length || 0;
    const lineCount = w.payout?.clearings?.reduce((acc, c) => acc + c.lines.length, 0) || 0;
    
    console.log(`Withdraw ${w.withdrawNo} (${w.status}):`);
    console.log(`  - Payout: ${w.payout ? w.payout.id : 'NONE'}`);
    console.log(`  - Clearings: ${clearingCount}`);
    console.log(`  - Lines: ${lineCount}`);
    
    if (w.status === 'APPROVED' || w.status === 'PAYOUT_PENDING' || w.status === 'SUCCESS') {
        if (clearingCount === 0) {
            console.log('  ❌ MISSING CLEARING DATA');
        } else {
            console.log('  ✅ Has Clearing Data');
        }
    }
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
