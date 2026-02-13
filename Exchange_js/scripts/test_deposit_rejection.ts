import { DepositWorkflowService } from '../src/modules/workflows/deposit-workflow.service';
import { PayinsService } from '../src/modules/payins/payins.service';
import { DepositTransactionsService } from '../src/modules/deposit-transactions/deposit-transactions.service';
import { JournalsService } from '../src/modules/journals/journals.service';
import { MonitoringService } from '../src/modules/monitoring/monitoring.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PayinAction, PayinType } from '../src/modules/payins/dto/payin.dto';
import { EventEmitter2 } from '@nestjs/event-emitter';

async function main() {
  console.log('--- Testing Deposit REJECTION (Reversal) ---');
  
  const prisma = new PrismaService();
  await prisma.onModuleInit();

  const eventEmitter = new EventEmitter2();
  const journalsService = new JournalsService(prisma);
  const depositService = new DepositTransactionsService(prisma);
  const monitoringService = new MonitoringService();
  const payinsService = new PayinsService(prisma, eventEmitter);

  const workflowService = new DepositWorkflowService(
      depositService,
      journalsService,
      payinsService,
      monitoringService
  );

  eventEmitter.on('payin.created', (e) => workflowService.handlePayinCreated(e));
  eventEmitter.on('payin.status.changed', (e) => workflowService.handlePayinStatusChanged(e));
  
  // Setup Data
  const cryptoAsset = await (prisma as any).asset.findFirst({ where: { type: 'CRYPTO', code: 'BTC' } });
  const wallet = await (prisma as any).wallet.findFirst({ where: { ownerType: 'CUSTOMER', assetId: cryptoAsset!.id } });

  console.log('1. Simulate Payin & Confirm');
  const payin = await payinsService.simulate({
      assetId: cryptoAsset!.id,
      toWalletId: wallet!.id,
      type: PayinType.CRYPTO
  });
  await new Promise(r => setTimeout(r, 500));
  // Crypto needs CONFIRMING first
  await (prisma as any).payin.update({ where: { id: payin.id }, data: { status: 'CONFIRMING' } });
  await payinsService.updateStatus(payin.id, PayinAction.CONFIRM);
  await new Promise(r => setTimeout(r, 500));
  
  const linkedPayin = await payinsService.findOne(payin.id);
  const depositId = linkedPayin.depositId!;

  console.log('2. CONFIRMED -> DROPPED (Reject)');
  await payinsService.updateStatus(payin.id, PayinAction.DROP);
  await new Promise(r => setTimeout(r, 500));

  const rejectionJournal = await (prisma as any).journal.findFirst({
      where: { sourceId: depositId, eventCode: 'EVT_DEPOSIT_REJECTED__CRYPTO' }
  });

  if (rejectionJournal) {
      console.log(`[OK] Rejection Journal triggered: ${rejectionJournal.id}`);
  } else {
      console.error('[FAIL] Rejection Journal NOT triggered');
  }

  await prisma.$disconnect();
}

main().catch(console.error);
