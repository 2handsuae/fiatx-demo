import { Injectable, Logger } from '@nestjs/common';
import { WithdrawKytVerdictHandler } from './withdraw-kyt-verdict.handler';
import { KYT_VERDICT_TYPES } from '../sumsub-shared/kyt-webhook-types';

/**
 * 提现 Sumsub webhook 强类型路由:与 DepositWebhookRouter 同构(deliberate fork,
 * 不是泛化抽象——两域各自演进,不共享基类)。复用同一份 KYT_VERDICT_TYPES 显式集合
 * (sumsub-shared/kyt-webhook-types.ts,含官方无 `Txn` 的 applicantKytOnHold 注意事项)。
 *
 * 由 SumsubIngestionService 的级联分流在 depositWebhookRouter.route() 未命中
 * (返回 false)时才调用本 router——是级联的最后一棒。真正"两域都不认领"的孤儿
 * 判定落在 WithdrawKytVerdictHandler(找不到 withdraw 行时 warn + 返回 false),
 * 而不是重复放在 deposit 侧,避免每一笔正常的提现 KYT 事件都在 deposit 侧先报一次噪音 warn。
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
