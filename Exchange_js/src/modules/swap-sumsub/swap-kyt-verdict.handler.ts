import { Inject, Injectable, Logger } from '@nestjs/common';
import { SwapWorkflowService } from '../trading/swap-transactions/swap-workflow.service';
import { SwapTransactionsService } from '../trading/swap-transactions/swap-transactions.service';
import {
  SUMSUB_TXN_CLIENT,
  SumsubTxnClient,
} from '../sumsub-shared/sumsub-txn-client.interface';
import {
  SCENE_TAGS,
  SCENE_TAG_PRIORITY,
  type SceneTag,
  type DispoTag,
} from '../sumsub-shared/scene-tags';

// 兑换只认一个处置 tag：FROZEN_BY_MLRO——没有 RETURN_TO_SENDER（充值退回原发
// 款方）/ FINAL_REJECTED（提现最终拒付）那类弧，因为兑换的 FROZEN 是零出边
// 终态（swap-transactions.service.ts 的 transitions 表 `[FROZEN]: {}`），没有
// 没收/退回/上缴那类处置可标。
const DISPO_TAGS = new Set<DispoTag>(['FROZEN_BY_MLRO']);

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

    // 与提现契约对齐（2026-08-14 parity）：approved/rejected 两类【都】拉一次
    // getTxn 落证据——提现的 DETAIL_LOOKUP_VERDICTS 四类全拉，swap 归一后只剩
    // 这两类。此前仅 rejected 拉，approved 路径 score/raw 彻底丢失，运营在
    // 详情页看不到放行单的风险分。
    const detail = await this.sumsubTxnClient.getTxn(kytTxnId);
    const detailRaw: unknown = detail.raw;
    const riskScore: number | null = detail.riskScore ?? null;
    let applicantActions:
      | { applicantActionId: string; externalActionId: string }[]
      | undefined;
    let sceneTag: SceneTag | undefined;
    let dispoTag: DispoTag | undefined;
    // tag/action 仍只在 rejected 消费（approved 没有处置分支要驱动）。
    // Task A6：不再把 typedTags 原样传下去——照抄 deposit-kyt-verdict.handler.ts
    // 的分流段，按 SCENE_TAG_PRIORITY 取优先级最高的 sceneTag（标量 max-reduce，
    // 与报文里 tag 的先后顺序无关）、把命中 DISPO_TAGS 的记成 dispoTag。
    if (verdict === 'rejected') {
      applicantActions = detail.applicantActions;
      for (const tag of detail.typedTags) {
        if (tag.type !== 'userDefined') continue;
        if (SCENE_TAGS.has(tag.label as SceneTag)) {
          const candidate = tag.label as SceneTag;
          if (!sceneTag || SCENE_TAG_PRIORITY[candidate] > SCENE_TAG_PRIORITY[sceneTag]) {
            sceneTag = candidate;
          }
        }
        if (DISPO_TAGS.has(tag.label as DispoTag)) dispoTag = tag.label as DispoTag;
      }
    }

    await this.workflow.applyKytVerdict(swap.id, {
      verdict,
      riskScore,
      ...(detailRaw !== undefined && { detailRaw }),
      ...(applicantActions?.length && { applicantActions }),
      ...(sceneTag && { sceneTag }),
      ...(dispoTag && { dispoTag }),
    });
    return true;
  }
}
