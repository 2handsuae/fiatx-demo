import { Injectable, Logger } from '@nestjs/common';
import { DepositKytVerdictHandler } from './deposit-kyt-verdict.handler';
import { KYT_VERDICT_TYPES } from '../sumsub-shared/kyt-webhook-types';

/**
 * 充值 Sumsub webhook 强类型路由:按 payload.type 分派到对应 handler。
 * 上游 SumsubIngestionService.dispatch() 前置分流按 KYT_VERDICT_TYPES 显式集合匹配
 * (非前缀匹配)命中时才调用本 router,不改老 if/else 分支——集合里的 applicantKytOnHold
 * 恰恰没有 applicantKytTxn 前缀,故不能再用前缀判断。applicantAction* 事件不进本
 * router——补料后的重检由 Sumsub 自动重评发出的 applicantKytTxn* 驱动(见 Task 9)。
 *
 * 与 WithdrawWebhookRouter 同构。2026-09-13 现场量过：整份 route() 只有 ~10 行
 * 实码，两域间真正逐字可共享的部分不到 10 行（constructor 因 NestJS DI 反射
 * 需要具体注入类型、warn 文案的域名两处必然分叉），抽基类净得的行数比引入的
 * 泛型/抽象层样板还少，故本对 router 仍保持两份、不抽基类——同一次任务里
 * 体量大得多的 KYT 裁决落地逻辑（86% 同、113 行）已抽进
 * sumsub-shared/kyt-verdict-handler.base.ts，两者判断口径不同不是遗漏。
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
