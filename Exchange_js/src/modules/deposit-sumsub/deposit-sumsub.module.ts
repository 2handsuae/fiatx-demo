import { Module } from '@nestjs/common';
import { DepositWebhookRouter } from './deposit-webhook.router';
import { DepositKytVerdictHandler } from './deposit-kyt-verdict.handler';
import { DepositActionHandler } from './deposit-action.handler';
import { SUMSUB_TXN_CLIENT } from './sumsub-txn-client.interface';
import { HttpSumsubTxnClient } from './sumsub-txn-client.http';

@Module({
  providers: [
    DepositWebhookRouter,
    DepositKytVerdictHandler,
    DepositActionHandler,
    { provide: SUMSUB_TXN_CLIENT, useClass: HttpSumsubTxnClient },
  ],
  exports: [DepositWebhookRouter],
})
export class DepositSumsubModule {}
