import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('--- Verifying Clearing Template ---');
  const template = await prisma.clearingTemplate.findUnique({
    where: { code: 'WITHDRAWAL_STANDARD_V1' },
    include: { lineTemplates: true }
  });

  if (template) {
    console.log('✅ Template found:', template.code);
    console.log('Description:', template.description);
    console.log('Lines count:', template.lineTemplates.length);
    template.lineTemplates.forEach(l => {
        console.log(`  - Line ${l.lineNo}: ${l.lineType} | ${l.partyType} | Source: ${l.amountSource}`);
    });
  } else {
    console.log('❌ Template NOT found');
  }

  console.log('\n--- Verifying Event Links ---');
  const events = await prisma.acctEvent.findMany({
    where: {
      eventCode: {
        in: ['EVT_WITHDRAWAL_APPROVED__CRYPTO', 'EVT_WITHDRAWAL_APPROVED__FIAT']
      }
    }
  });

  events.forEach(e => {
    console.log(`Event: ${e.eventCode} | Template: ${e.clearingTemplateCode} | Mode: ${e.clearingMode}`);
  });
  
  if (events.length === 2 && events.every(e => e.clearingTemplateCode === 'WITHDRAWAL_STANDARD_V1')) {
    console.log('✅ Events correctly linked.');
  } else {
    console.log('❌ Event linking mismatch.');
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
