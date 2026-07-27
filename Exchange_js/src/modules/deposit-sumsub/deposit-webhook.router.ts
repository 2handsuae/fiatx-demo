import { Injectable, Logger } from '@nestjs/common';
import { DepositKytVerdictHandler } from './deposit-kyt-verdict.handler';

const KYT_VERDICT_TYPES = new Set([
  'applicantKytTxnApproved',
  'applicantKytTxnRejected',
  'applicantKytTxnAwaitingUser',
  'applicantKytTxnOnHold',
  'applicantKytTxnReviewed',
]);

/**
 * 充值 Sumsub webhook 强类型路由:按 payload.type 分派到对应 handler。
 * 上游 SumsubIngestionService.dispatch() 前置分流只命中 applicantKytTxn 前缀时调用本
 * router,不改老 if/else 分支。applicantAction* 事件不进本 router——补料后的重检由
 * Sumsub 自动重评发出的 applicantKytTxn* 驱动(见 Task 9)。
 */
@Injectable()
export class DepositWebhookRouter {
  private readonly logger = new Logger(DepositWebhookRouter.name);

  constructor(private readonly kytVerdictHandler: DepositKytVerdictHandler) {}

  async route(payload: Record<string, unknown>): Promise<void> {
    const type = String(payload.type ?? '');

    if (KYT_VERDICT_TYPES.has(type)) {
      await this.kytVerdictHandler.handle(payload);
      return;
    }

    if (type === 'applicantKytTxnCreated') {
      this.logger.debug(`applicantKytTxnCreated receipt: ${JSON.stringify(payload)}`);
      return;
    }

    this.logger.warn(`orphan deposit sumsub webhook type: ${type}`);
  }
}
