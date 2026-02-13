
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { ClearingsService } from '../src/modules/clearing-settle/clearing/clearings.service';
import { PrismaService } from '../src/core/prisma/prisma.service';
import { WithdrawEvents } from '../src/modules/trading/withdraw-transactions/constants/withdraw-events.constant';

async function fixPayoutClearings() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const prisma = app.get(PrismaService);
  const clearingsService = app.get(ClearingsService);

  console.log('--- Starting Fix: Payout Clearings ---');

  // Find withdrawals that are approved/payout_pending/success
  // AND have a payout (via relation)
  const withdrawals = await prisma.withdrawTransaction.findMany({
    where: {
      status: { in: ['APPROVED', 'PAYOUT_PENDING', 'SUCCESS'] },
      payout: { isNot: null }
    },
    include: {
      payout: {
        include: {
          clearings: true
        }
      }
    }
  });

  const broken = withdrawals.filter(w => w.payout && w.payout.clearings.length === 0);
  
  console.log(`Found ${broken.length} withdrawals with Payout but NO Clearing.`);

  for (const w of broken) {
    console.log(`Fixing Withdraw: ${w.withdrawNo} (${w.id})`);
    if (!w.payout) continue;

    const eventCode = w.type === 'fiat' 
      ? WithdrawEvents.EVT_WITHDRAWAL_APPROVED__FIAT 
      : WithdrawEvents.EVT_WITHDRAWAL_APPROVED__CRYPTO;

    try {
      // 1. Trigger Clearing
      console.log(`  Triggering clearing for ${w.withdrawNo}...`);
      const clearing = await clearingsService.triggerClearing({
        sourceType: 'WITHDRAWAL',
        sourceId: w.id,
        eventCode: eventCode,
        context: {
            src: {
                amount: Number(w.amount),
                assetId: w.assetId,
                ownerId: w.ownerId,
                withdrawNo: w.withdrawNo,
                type: w.type
            }
        }
      });

      if (clearing) {
        // 2. Link Clearing to Payout
        console.log(`  Linking Clearing ${clearing.id} to Payout ${w.payout.id}...`);
        await prisma.clearing.update({
            where: { id: clearing.id },
            data: { outPayoutId: w.payout.id }
        });
        
        // 3. Optional: Fix WithdrawTransaction.payoutId if null
        if (!w.payoutId) {
             console.log(`  Fixing null payoutId on Withdraw...`);
             await prisma.withdrawTransaction.update({
                 where: { id: w.id },
                 data: { payoutId: w.payout.id }
             });
        }
        
        console.log(`✅ Fixed ${w.withdrawNo}`);
      } else {
        console.log(`⚠️ Warning: Trigger returned null for ${w.withdrawNo}`);
      }
    } catch (error) {
      console.error(`❌ Error processing ${w.withdrawNo}:`, error);
    }
  }

  console.log('--- Fix Complete ---');
  await app.close();
}

fixPayoutClearings().catch(console.error);
