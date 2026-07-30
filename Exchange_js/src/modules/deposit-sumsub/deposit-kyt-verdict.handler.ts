import { Inject, Injectable, Logger } from '@nestjs/common';
import { DepositWorkflowService } from '../trading/deposit-transactions/deposit-workflow.service';
import { DepositTransactionsService } from '../trading/deposit-transactions/deposit-transactions.service';
import { SUMSUB_TXN_CLIENT, SumsubTxnClient } from './sumsub-txn-client.interface';
import { KytLane, KytVerdict } from './sumsub-txn.types';

// payload.type → 归一 verdict;'ignore' = Reviewed,不推进状态机。
const VERDICT_BY_TYPE: Record<string, KytVerdict | 'ignore'> = {
  applicantKytTxnApproved: 'approved',
  applicantKytTxnRejected: 'rejected',
  applicantKytTxnAwaitingUser: 'awaitUser',
  applicantKytTxnOnHold: 'onHold',
  applicantKytTxnReviewed: 'ignore',
};

// approved 也拉:证据对齐(score + 报文),但不读处置 tag。
const DETAIL_LOOKUP_VERDICTS = new Set<KytVerdict>(['approved', 'rejected', 'awaitUser']);
// 标签不在 webhook 里,只在 rejected/awaitUser 时才拉 getTxn 读 typedTags。
const TAG_LOOKUP_VERDICTS = new Set<KytVerdict>(['rejected', 'awaitUser']);

const SCENE_TAGS = new Set(['SANCTION', 'PEP']);
const DISPO_TAGS = new Set(['FROZEN_BY_MLRO', 'RETURN_TO_SENDER']);

/**
 * 翻译 applicantKytTxn{Approved,Rejected,AwaitingUser,OnHold,Reviewed} webhook:
 * 映射到 deposit → 归一 verdict(+ 按需读 tag)→ 调 DepositWorkflowService.applyKytVerdict。
 */
@Injectable()
export class DepositKytVerdictHandler {
  private readonly logger = new Logger(DepositKytVerdictHandler.name);

  constructor(
    private readonly workflow: DepositWorkflowService,
    private readonly depositService: DepositTransactionsService,
    @Inject(SUMSUB_TXN_CLIENT) private readonly sumsubTxnClient: SumsubTxnClient,
  ) {}

  async handle(payload: Record<string, unknown>): Promise<void> {
    const type = String(payload.type ?? '');
    const verdict = VERDICT_BY_TYPE[type];
    if (!verdict || verdict === 'ignore') {
      this.logger.debug(`DepositKytVerdictHandler ignoring type: ${type}`);
      return;
    }

    const kytTxnId = String(payload.kytTxnId ?? '');
    const deposit = await this.depositService.findBySumsubTxnId(kytTxnId);
    if (!deposit) {
      this.logger.warn(`orphan KYT verdict webhook, no deposit for kytTxnId=${kytTxnId}`);
      return;
    }

    // 一笔 deposit 报两笔 txn(finance + travelRule),webhook 只带 kytTxnId。
    // 反查落在哪条泳道,决定裁决回写 financeStatus 还是 travelRuleStatus。
    const lane: KytLane =
      deposit.sumsubTravelRuleTxnId === kytTxnId ? 'TRAVEL_RULE' : 'FINANCE';

    let sceneTag: 'SANCTION' | 'PEP' | undefined;
    let dispoTag: 'FROZEN_BY_MLRO' | 'RETURN_TO_SENDER' | undefined;
    // 风险分只有在已经拉了 txn 详情时才拿得到;approved 路径不额外多打一次 API
    // 换一个展示数字(留 null,前端显示 —)。
    let riskScore: number | null = null;
    let detailRaw: unknown;

    if (DETAIL_LOOKUP_VERDICTS.has(verdict)) {
      const detail = await this.sumsubTxnClient.getTxn(kytTxnId);
      riskScore = detail.riskScore ?? null;
      detailRaw = detail.raw;
      if (TAG_LOOKUP_VERDICTS.has(verdict)) {
        for (const tag of detail.typedTags) {
          if (tag.type !== 'userDefined') continue;
          if (SCENE_TAGS.has(tag.label)) sceneTag = tag.label as 'SANCTION' | 'PEP';
          if (DISPO_TAGS.has(tag.label)) dispoTag = tag.label as 'FROZEN_BY_MLRO' | 'RETURN_TO_SENDER';
        }
      }
    }

    await this.workflow.applyKytVerdict(deposit.id, {
      verdict,
      lane,
      riskScore,
      ...(sceneTag && { sceneTag }),
      ...(dispoTag && { dispoTag }),
      ...(detailRaw !== undefined && { detailRaw }),
    });
  }
}
