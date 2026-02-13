import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { ClearingsService } from '../src/modules/clearing-settle/clearing/clearings.service';
import { PrismaService } from '../src/core/prisma/prisma.service';
import { WithdrawEvents } from '../src/modules/trading/withdraw-transactions/constants/withdraw-events.constant';
import { WithdrawTransactionStatus } from '../src/modules/trading/withdraw-transactions/dto/withdraw-transaction.dto';

async function fixMissingClearing() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const prisma = app.get(PrismaService);
  const clearingsService = app.get(ClearingsService);

  console.log('--- Starting Fix: Missing Clearing for Withdrawals ---');

  // Find withdrawals that are approved/payout_pending but have no payout/clearing
  const stuckWithdrawals = await prisma.withdrawTransaction.findMany({
    where: {
      status: {
        in: [WithdrawTransactionStatus.APPROVED, WithdrawTransactionStatus.PAYOUT_PENDING],
      },
      payoutId: null, // No payout linked yet
    },
  });

  console.log(`Found ${stuckWithdrawals.length} stuck withdrawals.`);

  for (const w of stuckWithdrawals) {
    console.log(`Processing Withdraw: ${w.withdrawNo} (${w.id})`);
    
    const eventCode = w.type === 'fiat' 
      ? WithdrawEvents.EVT_WITHDRAWAL_APPROVED__FIAT 
      : WithdrawEvents.EVT_WITHDRAWAL_APPROVED__CRYPTO;

    try {
      const result = await clearingsService.triggerClearing({
        sourceType: 'WITHDRAWAL',
        sourceId: w.id,
        eventCode: eventCode,
        context: {
            src: {
                amount: w.amount.toNumber(),
                assetId: w.assetId,
                ownerId: w.ownerId,
                withdrawNo: w.withdrawNo,
                type: w.type
            }
        }
      });

      if (result) {
        console.log(`✅ Fixed: Clearing triggered. Clearing ID: ${result.id}, Payout ID: ${result.outPayoutId}`);
      } else {
        console.log(`⚠️ Warning: Trigger returned null. Check event config for ${eventCode}`);
      }
    } catch (error) {
      console.error(`❌ Error processing ${w.withdrawNo}:`, error);
    }
  }

  console.log('--- Fix Complete ---');
  await app.close();
}

fixMissingClearing().catch(console.error);