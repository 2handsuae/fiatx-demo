import { DepositWorkflowService } from '../src/modules/workflows/deposit-workflow.service';
import { PayinsService } from '../src/modules/payins/payins.service';
import { DepositTransactionsService } from '../src/modules/deposit-transactions/deposit-transactions.service';
import { JournalsService } from '../src/modules/journals/journals.service';
import { MonitoringService } from '../src/modules/monitoring/monitoring.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PayinAction, PayinType } from '../src/modules/payins/dto/payin.dto';
import { EventEmitter2 } from '@nestjs/event-emitter';

async function main() {
  console.log('--- Testing Deposit HELD -> CLEARED Transition ---');
  
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
  const fiatAsset = await (prisma as any).asset.findFirst({ where: { type: 'FIAT', code: 'USD' } });
  const wallet = await (prisma as any).wallet.findFirst({ where: { ownerType: 'CUSTOMER', assetId: fiatAsset!.id } });

  console.log('1. Simulate Payin');
  const payin = await payinsService.simulate({
      assetId: fiatAsset!.id,
      toWalletId: wallet!.id,
      type: PayinType.FIAT
  });
  await new Promise(r => setTimeout(r, 500));
  const linkedPayin = await payinsService.findOne(payin.id);
  const depositId = linkedPayin.depositId!;

  console.log('2. Confirm -> HELD');
  await payinsService.updateStatus(payin.id, PayinAction.CONFIRM);
  await payinsService.updateStatus(payin.id, PayinAction.CHECK);
  await payinsService.updateStatus(payin.id, PayinAction.HOLD);
  await new Promise(r => setTimeout(r, 500));

  console.log('3. HELD -> CLEARED');
  await payinsService.updateStatus(payin.id, PayinAction.CLEAR);
  await new Promise(r => setTimeout(r, 500));

  const successJournal = await (prisma as any).journal.findFirst({
      where: { sourceId: depositId, eventCode: 'EVT_DEPOSIT_SUCCESS__FIAT' }
  });

  if (successJournal) {
      console.log(`[OK] SUCCESS Journal matched from HELD: ${successJournal.id}`);
  } else {
      console.error('[FAIL] SUCCESS Journal NOT matched from HELD');
  }

  await prisma.$disconnect();
}

main().catch(console.error);
