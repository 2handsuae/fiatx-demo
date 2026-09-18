import { Inject, Injectable } from '@nestjs/common';
import { WithdrawWorkflowService } from '../trading/withdraw-transactions/withdraw-workflow.service';
import { WithdrawTransactionsService } from '../trading/withdraw-transactions/withdraw-transactions.service';
import { SUMSUB_TXN_CLIENT, SumsubTxnClient } from '../sumsub-shared/sumsub-txn-client.interface';
import { KytVerdict } from '../sumsub-shared/sumsub-txn.types';
import {
  KytVerdictHandlerBase,
  type SceneTag,
  type DispoTag,
} from '../sumsub-shared/kyt-verdict-handler.base';
import { DISPO_TAGS_BY_DOMAIN } from '../sumsub-shared/scene-tags';

// 2026-08-20 制裁分主体：与 deposit-kyt-verdict.handler.ts 同构（deliberate
// fork，不抽公共常量）。SANCTION 拆成 APPLICANT / COUNTERPARTY，旧标签退役。
// 2026-08-29：PEP 也分主体，SceneTag/SCENE_TAGS/SCENE_TAG_PRIORITY 上收到
// sumsub-shared/scene-tags（四档优先级），不再本地定义。
export type { SceneTag };

/**
 * 提现域 KYT 裁决落地 handler——mirror of DepositKytVerdictHandler。翻译
 * applicantKytTxn{Approved,Rejected,AwaitingUser,Reviewed,Created} +
 * applicantKytOnHold webhook:映射 → 归一 verdict(+ 按需读 tag)→ 调
 * WithdrawWorkflowService.applyKytVerdict。
 *
 * 公共流程（归一 verdict / 找行 / ignore-orphan 短路 / 详情+tag 读取）抽到
 * KytVerdictHandlerBase（Task 7，2026-09-13）；本类只留：域 Service 的构造
 * 注入、处置 tag 集合(DISPO_TAGS_BY_DOMAIN.WITHDRAW——与充值不同:
 * FINAL_REJECTED,不是 RETURN_TO_SENDER——提现没有"退回发件人"语义,拒绝后走
 * 最终拒付处置)、以及找不到行时的域特定日志——withdraw 找不到行会 warn
 * (与 deposit 侧的 debug 不对称,是两域现有 spec 各自断言的既有行为,
 * 2026-09-13 抽基类时原样保留,不改成一致)。
 */
@Injectable()
export class WithdrawKytVerdictHandler extends KytVerdictHandlerBase {
  protected readonly dispoTags = DISPO_TAGS_BY_DOMAIN.WITHDRAW;

  constructor(
    private readonly workflow: WithdrawWorkflowService,
    private readonly withdrawService: WithdrawTransactionsService,
    @Inject(SUMSUB_TXN_CLIENT) protected readonly sumsubTxnClient: SumsubTxnClient,
  ) {
    super();
  }

  protected findRow(kytTxnId: string) {
    return this.withdrawService.findBySumsubTxnId(kytTxnId);
  }

  protected handleRowNotFound(kytTxnId: string): void {
    this.logger.warn(`orphan KYT verdict webhook, no withdraw for kytTxnId=${kytTxnId}`);
  }

  protected applyVerdict(
    withdrawId: string,
    payload: {
      verdict: KytVerdict;
      riskScore: number | null;
      sceneTag?: SceneTag;
      dispoTag?: DispoTag;
      detailRaw?: unknown;
      applicantActions?: { applicantActionId: string; externalActionId: string }[];
    },
  ): Promise<void> {
    return this.workflow.applyKytVerdict(withdrawId, payload);
  }
}
