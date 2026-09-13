import { Inject, Injectable } from '@nestjs/common';
import { DepositWorkflowService } from '../trading/deposit-transactions/deposit-workflow.service';
import { DepositTransactionsService } from '../trading/deposit-transactions/deposit-transactions.service';
import { SUMSUB_TXN_CLIENT, SumsubTxnClient } from '../sumsub-shared/sumsub-txn-client.interface';
import { KytVerdict } from '../sumsub-shared/sumsub-txn.types';
import {
  KytVerdictHandlerBase,
  type SceneTag,
  type DispoTag,
} from '../sumsub-shared/kyt-verdict-handler.base';
import { DISPO_TAGS_BY_DOMAIN } from '../sumsub-shared/scene-tags';

// 2026-08-20 制裁分主体：SANCTION 拆成 APPLICANT（客户本人 → 冻单+冻人）与
// COUNTERPARTY（对手方 → 只冻单）。旧的 'SANCTION' 直接退役，不留兼容映射
// （demo 约定：不做向后兼容）。
// 2026-08-29：PEP 也分主体，SceneTag/SCENE_TAGS/SCENE_TAG_PRIORITY 上收到
// sumsub-shared/scene-tags（四档优先级），不再本地定义。
export type { SceneTag };

/**
 * 翻译 applicantKytTxn{Approved,Rejected,AwaitingUser,Reviewed,Created} + applicantKytOnHold
 * (注意:onHold 官方命名没有 `Txn`)webhook:映射到 deposit → 归一 verdict(+ 按需读 tag)
 * → 调 DepositWorkflowService.applyKytVerdict。
 *
 * 公共流程（归一 verdict / 找行 / ignore-orphan 短路 / 详情+tag 读取）抽到
 * KytVerdictHandlerBase（Task 7，2026-09-13）；本类只留：域 Service 的构造注入、
 * 处置 tag 集合（DISPO_TAGS_BY_DOMAIN.DEPOSIT）、以及找不到行时的域特定日志
 * ——deposit 找不到行是 debug（预期级联给 withdraw），不是 warn。
 */
@Injectable()
export class DepositKytVerdictHandler extends KytVerdictHandlerBase {
  protected readonly dispoTags = DISPO_TAGS_BY_DOMAIN.DEPOSIT;

  constructor(
    private readonly workflow: DepositWorkflowService,
    private readonly depositService: DepositTransactionsService,
    @Inject(SUMSUB_TXN_CLIENT) protected readonly sumsubTxnClient: SumsubTxnClient,
  ) {
    super();
  }

  protected findRow(kytTxnId: string) {
    return this.depositService.findBySumsubTxnId(kytTxnId);
  }

  // Task 4: 找不到行 = 与 withdraw-sumsub 的级联未命中,是预期路径,只 debug 不 warn
  // (真正"两域都不认领"的孤儿判定落在 WithdrawKytVerdictHandler / SwapKytVerdictHandler)。
  protected handleRowNotFound(kytTxnId: string): void {
    this.logger.debug(`no deposit for kytTxnId=${kytTxnId} — cascading to withdraw router`);
  }

  protected applyVerdict(
    depositId: string,
    payload: {
      verdict: KytVerdict;
      riskScore: number | null;
      sceneTag?: SceneTag;
      dispoTag?: DispoTag;
      detailRaw?: unknown;
      applicantActions?: { applicantActionId: string; externalActionId: string }[];
    },
  ): Promise<void> {
    return this.workflow.applyKytVerdict(depositId, payload);
  }
}
