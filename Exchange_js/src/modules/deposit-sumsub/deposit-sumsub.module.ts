import { Module, forwardRef } from '@nestjs/common';
import { DepositWebhookRouter } from './deposit-webhook.router';
import { DepositKytVerdictHandler } from './deposit-kyt-verdict.handler';
import { SUMSUB_TXN_CLIENT } from './sumsub-txn-client.interface';
import { HttpSumsubTxnClient } from './sumsub-txn-client.http';
import { DepositTransactionsModule } from '../trading/deposit-transactions/deposit-transactions.module';

@Module({
  imports: [forwardRef(() => DepositTransactionsModule)],
  providers: [
    DepositWebhookRouter,
    DepositKytVerdictHandler,
    { provide: SUMSUB_TXN_CLIENT, useClass: HttpSumsubTxnClient },
  ],
  exports: [DepositWebhookRouter, SUMSUB_TXN_CLIENT],
})
export class DepositSumsubModule {}
