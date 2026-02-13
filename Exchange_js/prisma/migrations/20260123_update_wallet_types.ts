import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Starting data migration for WalletType...');

  // Update SPOT and FUNDING to CRYPTO_ADDRESS
  // Assuming existing SPOT and FUNDING wallets are crypto addresses
  const updateCrypto = await prisma.wallet.updateMany({
    where: {
      type: {
        in: ['SPOT', 'FUNDING']
      }
    },
    data: {
      type: 'CRYPTO_ADDRESS'
    }
  });

  console.log(`Updated ${updateCrypto.count} wallets to CRYPTO_ADDRESS`);

  // FIAT_BANK remains FIAT_BANK, no change needed

  console.log('Migration completed.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
