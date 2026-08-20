import { Inject, Injectable, Logger } from '@nestjs/common';
import { WithdrawWorkflowService } from '../trading/withdraw-transactions/withdraw-workflow.service';
import { WithdrawTransactionsService } from '../trading/withdraw-transactions/withdraw-transactions.service';
import { SUMSUB_TXN_CLIENT, SumsubTxnClient } from '../deposit-sumsub/sumsub-txn-client.interface';
import { KytVerdict } from '../deposit-sumsub/sumsub-txn.types';
import { KYT_ONHOLD_TYPE } from '../deposit-sumsub/kyt-webhook-types';

// payload.type → 归一 verdict;'ignore' = Reviewed/Created,不推进状态机。
// 与 deposit-kyt-verdict.handler.ts 的同名表逐字一致(deliberate fork,不抽公共常量)。
const VERDICT_BY_TYPE: Record<string, KytVerdict | 'ignore'> = {
  applicantKytTxnApproved: 'approved',
  applicantKytTxnRejected: 'rejected',
  applicantKytTxnAwaitingUser: 'awaitUser',
  [KYT_ONHOLD_TYPE]: 'onHold',
  applicantKytTxnReviewed: 'ignore',
  applicantKytTxnCreated: 'ignore',
};

// approved / onHold 也拉:证据对齐(score + 报文),但都不读处置 tag。
const DETAIL_LOOKUP_VERDICTS = new Set<KytVerdict>(['approved', 'rejected', 'awaitUser', 'onHold']);
// 标签不在 webhook 里,只在 rejected/awaitUser 时才读 typedTags。
const TAG_LOOKUP_VERDICTS = new Set<KytVerdict>(['rejected', 'awaitUser']);

// 2026-08-20 制裁分主体：与 deposit-kyt-verdict.handler.ts 同构（deliberate
// fork，不抽公共常量）。SANCTION 拆成 APPLICANT / COUNTERPARTY，旧标签退役。
export type SceneTag = 'SANCTION_APPLICANT' | 'SANCTION_COUNTERPARTY' | 'PEP';
const SCENE_TAGS = new Set<SceneTag>(['SANCTION_APPLICANT', 'SANCTION_COUNTERPARTY', 'PEP']);
// 显式优先序：APPLICANT > COUNTERPARTY > PEP。
// sceneTag 是标量、循环里后写覆盖先写，不定优先级的话哪个生效取决于
// Sumsub 报文里 typedTags 的先后顺序 —— 同一笔"对手方受制裁 + 客户是 PEP"
// 的交易会时而冻单时而落人工复核，且无任何日志。收紧方向优先：
// 漏冻的代价远大于多冻一次。
const SCENE_TAG_PRIORITY: Record<SceneTag, number> = {
  SANCTION_APPLICANT: 3,
  SANCTION_COUNTERPARTY: 2,
  PEP: 1,
};
// 提现处置 tag 集合与充值不同:REJECT_REFUND(不是 RETURN_TO_SENDER——提现没有
// "退回发件人"语义,拒绝后走退款处置)。见 task-4-brief.md。
const DISPO_TAGS = new Set(['FROZEN_BY_MLRO', 'REJECT_REFUND']);

/**
 * 提现域 KYT 裁决落地 handler——mirror of DepositKytVerdictHandler(deliberate
 * fork,不泛化抽象)。翻译 applicantKytTxn{Approved,Rejected,AwaitingUser,
 * Reviewed,Created} + applicantKytOnHold webhook:映射 → 归一 verdict(+ 按需读
 * tag)→ 调 WithdrawWorkflowService.applyKytVerdict(Task 5 落地状态机;本任务
 * 只打桩)。
 *
 * 返回布尔 = "一笔 withdraw 行拥有这个 kytTxnId"——ignore 类型也做同一次查询
 * (indexed,便宜)只为回答归属,不触发工作流。orphan(两域都不认领)在这里 warn:
 * 本 router 是 SumsubIngestionService 级联分流的最后一棒。
 */
@Injectable()
export class WithdrawKytVerdictHandler {
  private readonly logger = new Logger(WithdrawKytVerdictHandler.name);

  constructor(
    private readonly workflow: WithdrawWorkflowService,
    private readonly withdrawService: WithdrawTransactionsService,
    @Inject(SUMSUB_TXN_CLIENT) private readonly sumsubTxnClient: SumsubTxnClient,
  ) {}

  async handle(payload: Record<string, unknown>): Promise<boolean> {
    const type = String(payload.type ?? '');
    const verdict = VERDICT_BY_TYPE[type];
    const kytTxnId = String(payload.kytTxnId ?? '');
    const withdraw = await this.withdrawService.findBySumsubTxnId(kytTxnId);

    if (!verdict || verdict === 'ignore') {
      this.logger.debug(`WithdrawKytVerdictHandler ignoring type: ${type}`);
      return !!withdraw;
    }

    if (!withdraw) {
      this.logger.warn(`orphan KYT verdict webhook, no withdraw for kytTxnId=${kytTxnId}`);
      return false;
    }

    let sceneTag: SceneTag | undefined;
    let dispoTag: 'FROZEN_BY_MLRO' | 'REJECT_REFUND' | undefined;
    // 风险分只有在已经拉了 txn 详情时才拿得到;approved 路径不额外多打一次 API
    // 换一个展示数字(留 null,前端显示 —)。
    let riskScore: number | null = null;
    let detailRaw: unknown;
    let applicantActions: { applicantActionId: string; externalActionId: string }[] | undefined;

    if (DETAIL_LOOKUP_VERDICTS.has(verdict)) {
      const detail = await this.sumsubTxnClient.getTxn(kytTxnId);
      riskScore = detail.riskScore ?? null;
      detailRaw = detail.raw;
      applicantActions = detail.applicantActions;
      if (TAG_LOOKUP_VERDICTS.has(verdict)) {
        for (const tag of detail.typedTags) {
          if (tag.type !== 'userDefined') continue;
          if (SCENE_TAGS.has(tag.label as SceneTag)) {
            const candidate = tag.label as SceneTag;
            if (!sceneTag || SCENE_TAG_PRIORITY[candidate] > SCENE_TAG_PRIORITY[sceneTag]) {
              sceneTag = candidate;
            }
          }
          if (DISPO_TAGS.has(tag.label)) dispoTag = tag.label as 'FROZEN_BY_MLRO' | 'REJECT_REFUND';
        }
      }
    }

    await this.workflow.applyKytVerdict(withdraw.id, {
      verdict,
      riskScore,
      ...(sceneTag && { sceneTag }),
      ...(dispoTag && { dispoTag }),
      ...(detailRaw !== undefined && { detailRaw }),
      ...(applicantActions?.length && { applicantActions }),
    });
    return true;
  }
}
