import { Injectable, Logger } from '@nestjs/common';
import { DepositKytVerdictHandler } from './deposit-kyt-verdict.handler';
import { DepositActionHandler } from './deposit-action.handler';

const KYT_VERDICT_TYPES = new Set([
  'applicantKytTxnApproved',
  'applicantKytTxnRejected',
  'applicantKytTxnAwaitingUser',
  'applicantKytTxnOnHold',
  'applicantKytTxnReviewed',
]);

const ACTION_TYPES = new Set(['applicantActionReviewed', 'applicantActionPending']);

/**
 * 充值 Sumsub webhook 强类型路由:按 payload.type 分派到对应 handler。
 * 上游 SumsubIngestionService.dispatch() 前置分流命中
 * applicantKytTxn 前缀 / applicantAction 前缀时调用本 router,不改老 if/else 分支。
 */
@Injectable()
export class DepositWebhookRouter {
  private readonly logger = new Logger(DepositWebhookRouter.name);

  constructor(
    private readonly kytVerdictHandler: DepositKytVerdictHandler,
    private readonly actionHandler: DepositActionHandler,
  ) {}

  async route(payload: Record<string, unknown>): Promise<void> {
    const type = String(payload.type ?? '');

    if (KYT_VERDICT_TYPES.has(type)) {
      await this.kytVerdictHandler.handle(payload);
      return;
    }

    if (ACTION_TYPES.has(type)) {
      await this.actionHandler.handle(payload);
      return;
    }

    if (type === 'applicantKytTxnCreated') {
      this.logger.debug(`applicantKytTxnCreated receipt: ${JSON.stringify(payload)}`);
      return;
    }

    this.logger.warn(`orphan deposit sumsub webhook type: ${type}`);
  }
}
