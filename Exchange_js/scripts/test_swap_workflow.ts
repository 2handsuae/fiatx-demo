import { Test } from '@nestjs/testing';
import { SwapWorkflowService } from '../src/modules/workflows/swap-workflow.service';
import { SwapTransactionsService } from '../src/modules/swap-transactions/swap-transactions.service';
import { JournalsService } from '../src/modules/journals/journals.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { EventEmitterModule, EventEmitter2 } from '@nestjs/event-emitter';
import { SwapTransactionStatus } from '../src/modules/swap-transactions/dto/swap-transaction.dto';

async function main() {
  console.log('--- Testing Swap Workflow ---');
  
  const prisma = new PrismaService();
  await prisma.onModuleInit();

  const eventEmitter = new EventEmitter2();
  const journalsService = new JournalsService(prisma);
  const swapService = new SwapTransactionsService(prisma, eventEmitter);
  const workflowService = new SwapWorkflowService(swapService, journalsService);

  // Manual listener registration
  eventEmitter.on('EVT_SWAP_CREATED', (e) => workflowService.handleSwapCreated(e));
  eventEmitter.on('EVT_SWAP_SUCCESS', (e) => workflowService.handleSwapSuccess(e));
  eventEmitter.on('EVT_SWAP_REJECTED', (e) => workflowService.handleSwapRejected(e));

  // 1. Setup Assets
  const btc = await prisma.asset.findFirst({ where: { code: 'BTC' } });
  const usdt = await prisma.asset.findFirst({ where: { code: 'USDT' } });

  if (!btc || !usdt) {
      console.error('BTC or USDT missing. Run seed.');
      return;
  }

  // 2. Create Swap
  console.log('\nStep 1: Create Swap (BTC -> USDT)');
  const swap = await swapService.create({
      ownerType: 'CUSTOMER',
      ownerId: 'USER_SWAP_TEST',
      fromAssetId: btc.id,
      fromAmount: 0.1,
      toAssetId: usdt.id,
      toAmount: 6500,
      exchangeRate: 65000
  });

  await new Promise(r => setTimeout(r, 500));
  
  const journalCreated = await prisma.journal.findFirst({
      where: { sourceId: swap.id, eventCode: 'EVT_SWAP_CREATED' },
      include: { lines: true }
  });

  if (journalCreated) {
      console.log(`[OK] Created Journal: ${journalCreated.id}`);
      journalCreated.lines.forEach(l => {
          console.log(`     Line ${l.lineNo}: [${l.drCr}] ${l.accountCode} ${l.amount} ${l.assetId} Owner: ${l.ownerType}:${l.ownerId}`);
      });
  } else {
      console.error('[FAIL] EVT_SWAP_CREATED journal missing');
  }

  // 3. Success Swap
  console.log('\nStep 2: Success Swap');
  // Need to set status to PENDING_COMPLIANCE first if workflow expects it, 
  // but triggerEvent just needs the transition.
  // In our AcctEvent, it expects From: PENDING_COMPLIANCE
  await prisma.swapTransaction.update({ where: { id: swap.id }, data: { status: 'PENDING_COMPLIANCE' } });
  await swapService.updateStatus(swap.id, SwapTransactionStatus.SUCCESS);

  await new Promise(r => setTimeout(r, 500));

  const journalSuccess = await prisma.journal.findFirst({
      where: { sourceId: swap.id, eventCode: 'EVT_SWAP_SUCCESS' },
      include: { lines: true }
  });

  if (journalSuccess) {
      console.log(`[OK] Success Journal: ${journalSuccess.id}`);
      journalSuccess.lines.forEach(l => {
          console.log(`     Line ${l.lineNo}: [${l.drCr}] ${l.accountCode} ${l.amount} ${l.assetId} Owner: ${l.ownerType}:${l.ownerId}`);
      });
  } else {
      console.error('[FAIL] EVT_SWAP_SUCCESS journal missing');
  }

  await prisma.$disconnect();
}

main().catch(console.error);
