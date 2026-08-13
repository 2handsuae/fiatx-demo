import { Inject, Injectable, Logger } from '@nestjs/common';
import { SwapWorkflowService } from '../trading/swap-transactions/swap-workflow.service';
import { SwapTransactionsService } from '../trading/swap-transactions/swap-transactions.service';
import {
  SUMSUB_TXN_CLIENT,
  SumsubTxnClient,
} from '../deposit-sumsub/sumsub-txn-client.interface';

// payload.type → 归一 verdict;'ignore' = Reviewed/Created,不推进状态机。
// 与 deposit-kyt-verdict.handler.ts / withdraw-kyt-verdict.handler.ts 的同名表
// 同构(deliberate fork,不抽公共常量),但取值不同:兑换没有"等"的语义 ——
// awaitingUser(等客户补料)和 onHold(等官员复核)在充值/提现各有独立状态,
// 在兑换这里统统归一成 rejected(本次不成交,材料诉求挂在人身上而不是这笔单)。
const VERDICT_BY_TYPE: Record<string, 'approved' | 'rejected' | 'ignore'> = {
  applicantKytTxnApproved: 'approved',
  applicantKytTxnRejected: 'rejected',
  applicantKytTxnAwaitingUser: 'rejected',
  applicantKytOnHold: 'rejected',
  applicantKytTxnReviewed: 'ignore',
  applicantKytTxnCreated: 'ignore',
};

/**
 * 兑换域 KYT 裁决落地 handler —— mirror of DepositKytVerdictHandler /
 * WithdrawKytVerdictHandler(deliberate fork,不泛化抽象)。翻译
 * applicantKytTxn{Approved,Rejected,AwaitingUser,Reviewed,Created} +
 * applicantKytOnHold(注意:onHold 官方命名没有 `Txn`)webhook:先按
 * sumsubTxnIdOut 认领归属,再映射 → 归一 verdict(+ 仅 rejected 时读
 * detail/typedTags)→ 调 SwapWorkflowService.applyKytVerdict(Task 6 落地状态机;
 * 本任务只定调用契约 + 打桩)。
 *
 * 认领顺序与充值/提现相反:这里先认领后判类型 —— 认领不到就是级联要继续找
 * 下一域,无论事件类型是否会推进状态机都一样是"不是我的"。
 */
@Injectable()
export class SwapKytVerdictHandler {
  private readonly logger = new Logger(SwapKytVerdictHandler.name);

  constructor(
    private readonly swapService: SwapTransactionsService,
    private readonly workflow: SwapWorkflowService,
    @Inject(SUMSUB_TXN_CLIENT)
    private readonly sumsubTxnClient: SumsubTxnClient,
  ) {}

  async handle(payload: Record<string, unknown>): Promise<boolean> {
    const type = String(payload.type ?? '');
    // 与 deposit/withdraw 同域字段:webhook payload 用 kytTxnId(见
    // sumsub-ingestion.service.ts / kyt-webhook-types.ts 的既有约定)。
    const kytTxnId = String(payload.kytTxnId ?? '');
    const swap = await this.swapService.findBySumsubTxnId(kytTxnId);
    if (!swap) {
      this.logger.warn(
        `orphan KYT verdict webhook, no swap for kytTxnId=${kytTxnId}`,
      );
      return false;
    }

    const verdict = VERDICT_BY_TYPE[type];
    if (!verdict || verdict === 'ignore') return true; // 认领了但不推进

    let detailRaw: unknown;
    let applicantActions:
      | { applicantActionId: string; externalActionId: string }[]
      | undefined;
    let typedTags: string[] | undefined;
    // approved 不需要额外证据(没有 tag 要读、也不驱动处置分支);只有 rejected
    // 才拉一次 getTxn,换 typedTags + applicantActions 给 Task 6 的处置逻辑用。
    if (verdict === 'rejected') {
      const detail = await this.sumsubTxnClient.getTxn(kytTxnId);
      detailRaw = detail.raw;
      applicantActions = detail.applicantActions;
      typedTags = (detail.typedTags ?? []).map((t) => String(t.label ?? t));
    }

    await this.workflow.applyKytVerdict(swap.id, {
      verdict,
      ...(detailRaw !== undefined && { detailRaw }),
      ...(applicantActions?.length && { applicantActions }),
      ...(typedTags?.length && { typedTags }),
    });
    return true;
  }
}
