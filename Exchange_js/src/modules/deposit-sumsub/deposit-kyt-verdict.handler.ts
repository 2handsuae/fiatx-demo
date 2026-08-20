import { Inject, Injectable, Logger } from '@nestjs/common';
import { DepositWorkflowService } from '../trading/deposit-transactions/deposit-workflow.service';
import { DepositTransactionsService } from '../trading/deposit-transactions/deposit-transactions.service';
import { SUMSUB_TXN_CLIENT, SumsubTxnClient } from './sumsub-txn-client.interface';
import { KytVerdict } from './sumsub-txn.types';
import { KYT_ONHOLD_TYPE } from './kyt-webhook-types';

// payload.type → 归一 verdict;'ignore' = Reviewed/Created,不推进状态机。
const VERDICT_BY_TYPE: Record<string, KytVerdict | 'ignore'> = {
  applicantKytTxnApproved: 'approved',
  applicantKytTxnRejected: 'rejected',
  applicantKytTxnAwaitingUser: 'awaitUser',
  [KYT_ONHOLD_TYPE]: 'onHold',
  applicantKytTxnReviewed: 'ignore',
  applicantKytTxnCreated: 'ignore',
};

// approved / onHold 也拉:证据对齐(score + 报文),但都不读处置 tag。
// onHold 语义是「规则已算完分、判定需人工复核」,分数与命中规则正是 officer 的决策依据;
// 此前 onHold 不拉,导致挂起单在详情页零证据(2026-07-31 实测 score/报文双空)。
const DETAIL_LOOKUP_VERDICTS = new Set<KytVerdict>(['approved', 'rejected', 'awaitUser', 'onHold']);
// 标签不在 webhook 里,只在 rejected/awaitUser 时才读 typedTags。
const TAG_LOOKUP_VERDICTS = new Set<KytVerdict>(['rejected', 'awaitUser']);

// 2026-08-20 制裁分主体：SANCTION 拆成 APPLICANT（客户本人 → 冻单+冻人）与
// COUNTERPARTY（对手方 → 只冻单）。旧的 'SANCTION' 直接退役，不留兼容映射
// （demo 约定：不做向后兼容）。
export type SceneTag = 'SANCTION_APPLICANT' | 'SANCTION_COUNTERPARTY' | 'PEP';
const SCENE_TAGS = new Set<SceneTag>(['SANCTION_APPLICANT', 'SANCTION_COUNTERPARTY', 'PEP']);
const DISPO_TAGS = new Set(['FROZEN_BY_MLRO', 'RETURN_TO_SENDER']);

/**
 * 翻译 applicantKytTxn{Approved,Rejected,AwaitingUser,Reviewed,Created} + applicantKytOnHold
 * (注意:onHold 官方命名没有 `Txn`)webhook:映射到 deposit → 归一 verdict(+ 按需读 tag)
 * → 调 DepositWorkflowService.applyKytVerdict。
 */
@Injectable()
export class DepositKytVerdictHandler {
  private readonly logger = new Logger(DepositKytVerdictHandler.name);

  constructor(
    private readonly workflow: DepositWorkflowService,
    private readonly depositService: DepositTransactionsService,
    @Inject(SUMSUB_TXN_CLIENT) private readonly sumsubTxnClient: SumsubTxnClient,
  ) {}

  // Task 4: returns boolean = "a deposit row owns this kytTxnId". Ignore-types
  // (Reviewed/Created) now also do the lookup — cheap indexed query — purely to
  // report ownership to the caller; they still never reach applyKytVerdict, so
  // the state machine is untouched. This lets SumsubIngestionService cascade to
  // withdraw-sumsub on a miss instead of silently dropping withdraw-owned events.
  async handle(payload: Record<string, unknown>): Promise<boolean> {
    const type = String(payload.type ?? '');
    const verdict = VERDICT_BY_TYPE[type];
    const kytTxnId = String(payload.kytTxnId ?? '');
    const deposit = await this.depositService.findBySumsubTxnId(kytTxnId);

    if (!verdict || verdict === 'ignore') {
      this.logger.debug(`DepositKytVerdictHandler ignoring type: ${type}`);
      return !!deposit;
    }

    if (!deposit) {
      this.logger.debug(`no deposit for kytTxnId=${kytTxnId} — cascading to withdraw router`);
      return false;
    }

    let sceneTag: SceneTag | undefined;
    let dispoTag: 'FROZEN_BY_MLRO' | 'RETURN_TO_SENDER' | undefined;
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
          // APPLICANT 恒优先：一笔交易同时命中"本人被制裁"和"对手方被制裁"
          // 是真实场景（本人在名单上、又转给了受制裁地址）。sceneTag 是标量、
          // 循环里后写覆盖先写，若不判优先级则哪个生效取决于 Sumsub 报文里
          // typedTags 的先后顺序 —— "本人命中"有一半概率被静默降级成"只冻单
          // 不冻人"，且无任何日志。漏冻人的代价远大于多冻一次。
          if (SCENE_TAGS.has(tag.label as SceneTag)) {
            if (sceneTag !== 'SANCTION_APPLICANT') sceneTag = tag.label as SceneTag;
          }
          if (DISPO_TAGS.has(tag.label)) dispoTag = tag.label as 'FROZEN_BY_MLRO' | 'RETURN_TO_SENDER';
        }
      }
    }

    await this.workflow.applyKytVerdict(deposit.id, {
      verdict,
      riskScore,
      // workflow.applyKytVerdict 的 sceneTag 形参类型还是旧的 'SANCTION' | 'PEP'
      // ——按 Task 1 brief，本任务只改信号层、不动 workflow 层，该形参类型由
      // Task 2/5/6 更新为 SceneTag。此处用宽化 cast 过渡，避免在此文件之外动刀。
      ...(sceneTag && { sceneTag: sceneTag as unknown as 'SANCTION' | 'PEP' }),
      ...(dispoTag && { dispoTag }),
      ...(detailRaw !== undefined && { detailRaw }),
      ...(applicantActions?.length && { applicantActions }),
    });
    return true;
  }
}
