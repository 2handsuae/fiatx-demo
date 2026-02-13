
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Starting legacy configuration update...');

  // 1. Update AcctEvents
  const eventUpdates = [
    {
      code: 'EVT_DEPOSIT_CONFIRMED__CRYPTO',
      data: { triggerKey: 'status', fromStatus: 'PAYIN_LINKED', toStatus: 'CONFIRMED' }
    },
    {
      code: 'EVT_DEPOSIT_SUCCESS__CRYPTO',
      data: { triggerKey: 'status', fromStatus: 'PENDING_COMPLIANCE', toStatus: 'SUCCESS' }
    },
    {
      code: 'EVT_DEPOSIT_CONFIRMED__FIAT',
      data: { triggerKey: 'status', fromStatus: 'PAYIN_LINKED', toStatus: 'CONFIRMED' }
    },
    {
      code: 'EVT_DEPOSIT_SUCCESS__FIAT',
      data: { triggerKey: 'status', fromStatus: 'PENDING_COMPLIANCE', toStatus: 'SUCCESS' }
    },
    {
      code: 'EVT_DEPOSIT_REJECTED__CRYPTO',
      data: { triggerKey: 'status', fromStatus: 'CONFIRMED', toStatus: 'REJECTED' }
    },
    {
      code: 'EVT_DEPOSIT_REJECTED__FIAT',
      data: { triggerKey: 'status', fromStatus: 'CONFIRMED', toStatus: 'REJECTED' }
    }
  ];

  for (const update of eventUpdates) {
    await prisma.acctEvent.update({
      where: { eventCode: update.code },
      data: update.data
    });
  }
  console.log(`Updated ${eventUpdates.length} AcctEvents.`);

  // 2. Update JournalLineTemplates
  const templates = await prisma.journalHeaderTemplate.findMany({
      where: {
          templateCode: {
              in: [
                  'TPL_EVT_DEPOSIT_CONFIRMED__CRYPTO_V1',
                  'TPL_EVT_DEPOSIT_SUCCESS__CRYPTO_V1',
                  'TPL_EVT_DEPOSIT_CONFIRMED__FIAT_V1',
                  'TPL_EVT_DEPOSIT_SUCCESS__FIAT_V1'
              ]
          }
      },
      include: { journalLineTemplates: true }
  });

  let lineCount = 0;
  for (const tpl of templates) {
      for (const line of tpl.journalLineTemplates) {
          const isCustomerLine = line.accountCode.startsWith('L.CLIENT');
          const isRestricted = line.accountCode.includes('RESTRICTED') || line.accountCode.includes('AUDIT');
          
          let description = line.description;
          if (!description) {
              if (tpl.templateCode.includes('CONFIRMED')) {
                  description = isCustomerLine ? '入金确认：客户资金进入待审负债' : '入金确认：资产进入受限账户';
              } else {
                  description = isCustomerLine 
                    ? (line.drCr === 'DR' ? '入金成功：待审负债转出' : '入金成功：客户可用余额增加')
                    : (line.drCr === 'DR' ? '入金成功：资产进入可用账户' : '入金成功：受限资产转出');
              }
          }

          await prisma.journalLineTemplate.update({
              where: { id: line.id },
              data: {
                  ownerTypeSource: isCustomerLine ? 'CUSTOMER' : 'PLATFORM',
                  ownerIdSource: isCustomerLine ? 'src.ownerId' : null,
                  referenceSource: 'src.depositId',
                  description: description,
                  dimensionsRule: isCustomerLine 
                    ? '{"client_id":"{{src.ownerId}}","assetId":"{{src.assetId}}"}'
                    : '{"assetId":"{{src.assetId}}","walletid":"{{src.towalletid}}"}'
              }
          });
          lineCount++;
      }
  }
  console.log(`Updated ${lineCount} JournalLineTemplates.`);

  console.log('Legacy configuration update finished successfully.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
