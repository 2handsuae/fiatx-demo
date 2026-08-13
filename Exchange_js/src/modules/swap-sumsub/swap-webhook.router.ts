import { Injectable, Logger } from '@nestjs/common';
import { SwapKytVerdictHandler } from './swap-kyt-verdict.handler';
import { KYT_VERDICT_TYPES } from '../deposit-sumsub/kyt-webhook-types';

/**
 * 兑换 Sumsub webhook 强类型路由:与 DepositWebhookRouter / WithdrawWebhookRouter
 * 同构(deliberate fork,不是泛化抽象——三域各自演进,不共享基类)。复用同一份
 * KYT_VERDICT_TYPES 显式集合(deposit-sumsub/kyt-webhook-types.ts,含官方无 `Txn`
 * 的 applicantKytOnHold 注意事项)。
 *
 * 由 SumsubIngestionService 的级联分流在 deposit → withdraw 都未命中(依次返回
 * false)后才调用本 router —— 是三级级联的最后一棒。真正"三域都不认领"的孤儿
 * 判定落在 SwapKytVerdictHandler(找不到 swap 行时 warn + 返回 false),而不是
 * 重复放在 deposit/withdraw 侧,避免每一笔正常的 deposit/withdraw KYT 事件都
 * 在 swap 侧先报一次噪音 warn。
 */
@Injectable()
export class SwapWebhookRouter {
  private readonly logger = new Logger(SwapWebhookRouter.name);

  constructor(private readonly kytVerdictHandler: SwapKytVerdictHandler) {}

  async route(payload: Record<string, unknown>): Promise<boolean> {
    const type = String(payload.type ?? '');

    if (KYT_VERDICT_TYPES.has(type)) {
      return await this.kytVerdictHandler.handle(payload);
    }

    this.logger.warn(`orphan swap sumsub webhook type: ${type}`);
    return false;
  }
}
