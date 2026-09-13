import { Injectable, Logger } from '@nestjs/common';
import { WithdrawKytVerdictHandler } from './withdraw-kyt-verdict.handler';
import { KYT_VERDICT_TYPES } from '../sumsub-shared/kyt-webhook-types';

/**
 * 提现 Sumsub webhook 强类型路由:与 DepositWebhookRouter 同构。复用同一份
 * KYT_VERDICT_TYPES 显式集合(sumsub-shared/kyt-webhook-types.ts,含官方无
 * `Txn` 的 applicantKytOnHold 注意事项)。
 *
 * 由 SumsubIngestionService 的级联分流在 depositWebhookRouter.route() 未命中
 * (返回 false)时才调用本 router。真正孤儿判定落在 WithdrawKytVerdictHandler /
 * SwapKytVerdictHandler(找不到行时各自 warn + 返回 false),不重复放在 deposit
 * 侧,避免每一笔正常的提现 KYT 事件都在 deposit 侧先报一次噪音 warn。
 *
 * 2026-09-13 现场量过（与 DepositWebhookRouter 一并判断，理由见其头注）：
 * route() 只有 ~10 行实码，两域间真正可字面共享的部分不到 10 行——抽基类净
 * 收益小于代价，本对 router 仍保持两份、不共享基类。同一次任务里体量大得多
 * 的 KYT 裁决落地逻辑（86% 同、113 行）已抽进
 * sumsub-shared/kyt-verdict-handler.base.ts，两者判断口径不同不是遗漏。
 */
@Injectable()
export class WithdrawWebhookRouter {
  private readonly logger = new Logger(WithdrawWebhookRouter.name);

  constructor(private readonly kytVerdictHandler: WithdrawKytVerdictHandler) {}

  async route(payload: Record<string, unknown>): Promise<boolean> {
    const type = String(payload.type ?? '');

    if (KYT_VERDICT_TYPES.has(type)) {
      return await this.kytVerdictHandler.handle(payload);
    }

    this.logger.warn(`orphan withdraw sumsub webhook type: ${type}`);
    return false;
  }
}
