import { PrismaClient } from '@prisma/client';
import { generateReferenceNo } from '../src/common/utils/no-generator.util';

const prisma = new PrismaClient();

async function main() {
  console.log('Starting data migration for No fields...');

  // 1. Users
  const users = await prisma.user.findMany();
  console.log(`Found ${users.length} users to update.`);
  for (const user of users) {
    if (user.userNo.startsWith('USR') || user.userNo === 'TEMP') {
      await prisma.user.update({
        where: { id: user.id },
        data: { userNo: generateReferenceNo('UR') },
      });
    }
  }

  // 2. Customers
  const customers = await prisma.customerMain.findMany();
  console.log(`Found ${customers.length} customers to update.`);
  for (const customer of customers) {
    if (customer.customerNo === 'TEMP' || !customer.customerNo.startsWith('CU')) {
      await prisma.customerMain.update({
        where: { id: customer.id },
        data: { customerNo: generateReferenceNo('CU') },
      });
    }
  }

  // 3. Payins
  const payins = await prisma.payin.findMany();
  console.log(`Found ${payins.length} payins to update.`);
  for (const payin of payins) {
    if (payin.payinNo === 'TEMP' || !payin.payinNo.startsWith('PI')) {
      await prisma.payin.update({
        where: { id: payin.id },
        data: { payinNo: generateReferenceNo('PI') },
      });
    }
  }

  // 4. Payouts
  const payouts = await prisma.payout.findMany();
  console.log(`Found ${payouts.length} payouts to update.`);
  for (const payout of payouts) {
    if (payout.payoutNo === 'TEMP' || !payout.payoutNo.startsWith('PO')) {
      await prisma.payout.update({
        where: { id: payout.id },
        data: { payoutNo: generateReferenceNo('PO') },
      });
    }
  }

  // 5. Clearings
  const clearings = await prisma.clearing.findMany();
  console.log(`Found ${clearings.length} clearings to update.`);
  for (const clearing of clearings) {
    if (clearing.clearingNo === 'TEMP' || !clearing.clearingNo.startsWith('CL')) {
      await prisma.clearing.update({
        where: { id: clearing.id },
        data: { clearingNo: generateReferenceNo('CL') },
      });
    }
  }

  // 6. Journals
  const journals = await prisma.journal.findMany();
  console.log(`Found ${journals.length} journals to update.`);
  for (const journal of journals) {
    if (journal.journalNo === 'TEMP' || !journal.journalNo.startsWith('JO')) {
      await prisma.journal.update({
        where: { id: journal.id },
        data: { journalNo: generateReferenceNo('JO') },
      });
    }
  }

  // 7. Assets (ensure all have assetNo)
  const assets = await prisma.asset.findMany({ where: { assetNo: null } });
  console.log(`Found ${assets.length} assets to update.`);
  for (const asset of assets) {
    await prisma.asset.update({
      where: { id: asset.id },
      data: { assetNo: `AS_${asset.code}_${asset.network || 'MAIN'}`.toUpperCase() },
    });
  }

  // 8. Wallets (ensure all have walletNo)
  const wallets = await prisma.wallet.findMany({ where: { walletNo: null } });
  console.log(`Found ${wallets.length} wallets to update.`);
  for (const wallet of wallets) {
    await prisma.wallet.update({
      where: { id: wallet.id },
      data: { 
        walletNo: generateReferenceNo('WA'),
        ownerNo: wallet.ownerType === 'PLATFORM' ? 'PLATFORM' : 'TEMP_OWNER_NO'
      },
    });
  }

  console.log('Migration completed successfully!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
