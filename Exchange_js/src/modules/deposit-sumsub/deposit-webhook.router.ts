import { Injectable, Logger } from '@nestjs/common';
import { DepositKytVerdictHandler } from './deposit-kyt-verdict.handler';
import { KYT_VERDICT_TYPES } from '../sumsub-shared/kyt-webhook-types';

/**
 * 充值 Sumsub webhook 强类型路由:按 payload.type 分派到对应 handler。
 * 上游 SumsubIngestionService.dispatch() 前置分流按 KYT_VERDICT_TYPES 显式集合匹配
 * (非前缀匹配)命中时才调用本 router,不改老 if/else 分支——集合里的 applicantKytOnHold
 * 恰恰没有 applicantKytTxn 前缀,故不能再用前缀判断。applicantAction* 事件不进本
 * router——补料后的重检由 Sumsub 自动重评发出的 applicantKytTxn* 驱动(见 Task 9)。
 */
@Injectable()
export class DepositWebhookRouter {
  private readonly logger = new Logger(DepositWebhookRouter.name);

  constructor(private readonly kytVerdictHandler: DepositKytVerdictHandler) {}

  // Task 4: boolean hit-flag (true = a deposit row owns this kytTxnId) so
  // SumsubIngestionService can cascade to withdraw-sumsub on a miss. Only this
  // signature change touches the deposit module — everything else is unchanged.
  async route(payload: Record<string, unknown>): Promise<boolean> {
    const type = String(payload.type ?? '');

    if (KYT_VERDICT_TYPES.has(type)) {
      return await this.kytVerdictHandler.handle(payload);
    }

    this.logger.warn(`orphan deposit sumsub webhook type: ${type}`);
    return false;
  }
}
