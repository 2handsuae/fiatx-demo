import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { SwapTransactionsService } from '../trading/swap-transactions/swap-transactions.service';
import { SUMSUB_TXN_CLIENT, SumsubTxnClient } from '../deposit-sumsub/sumsub-txn-client.interface';
import { MockSumsubTxnClient } from '../deposit-sumsub/sumsub-txn-client.mock';
import { SWAP_VERDICT_BUTTONS, SwapVerdictButton } from './fixtures/verdict-buttons';
import { buildTxnReport, TxnReportVerdict } from '../deposit-sumsub/fixtures/txn-report.builder';
import { KYT_ONHOLD_TYPE } from '../deposit-sumsub/kyt-webhook-types';
import { KytVerdict } from '../deposit-sumsub/sumsub-txn.types';
import { SumsubIngestionService } from '../sumsub-ingestion/sumsub-ingestion.service';
import { AuditLogsService } from '../audit-logging/audit-logs.service';
import {
  AuditActions,
  AuditEntityTypes,
  AuditWorkflowTypes,
} from '../audit-logging/constants/audit-actions.constant';
import { AuditResult } from '../audit-logging/dto/audit-log.dto';

export interface DemoScenarioActor {
  actorId: string;
  actorNo?: string;
  actorRole?: string;
}

/** webhookType → 归一 verdict,与 DepositDemoScenarioService/WithdrawDemoScenarioService 的同名表同源同值。 */
const VERDICT_OF: Record<string, KytVerdict> = {
  applicantKytTxnApproved: 'approved',
  applicantKytTxnRejected: 'rejected',
  applicantKytTxnAwaitingUser: 'awaitUser',
  [KYT_ONHOLD_TYPE]: 'onHold',
};

/**
 * webhookType → 官方报文里 review.reviewStatus / scoringResult.action 的派生表。
 * 纯展示字段(SwapKytVerdictHandler 只读 payload.type,不读这两个),按钮 fixture
 * 因此不必重复填 —— 见 fixtures/verdict-buttons.ts 类注释。
 */
const REPORT_META: Record<string, Pick<TxnReportVerdict, 'reviewStatus' | 'action'>> = {
  applicantKytTxnApproved: { reviewStatus: 'completed', action: 'score' },
  applicantKytTxnRejected: { reviewStatus: 'completed', action: 'reject' },
  applicantKytTxnAwaitingUser: { reviewStatus: 'awaitingUser', action: 'awaitUser' },
  [KYT_ONHOLD_TYPE]: { reviewStatus: 'onHold', action: 'onHold' },
};

/**
 * 兑换域场景仿真器 —— mirror of DepositDemoScenarioService / WithdrawDemoScenarioService
 * (deliberate fork, Task 9)。把 8 个**单步**裁决按钮驱动**真实**
 * ingestionService.ingest() 走完整的前置分流→router→handler→workflow 链路,不碰
 * fixture/workflow/handler 本身逻辑。
 *
 * 只在 SUMSUB_MOCK_MODE=true 时才会被实际使用 —— AdminSwapDemoController 只在该
 * 模式下才被注册(swap-sumsub.module.ts),所以这里注入到的 SUMSUB_TXN_CLIENT
 * 理应总是 MockSumsubTxnClient;仍做一次 instanceof 兜底,防止误配置下的静默错误。
 *
 * ⚠️ 已知缺口(V7_ACTION_GREEN / V8_ACTION_RED,webhookType='applicantActionReviewed'):
 * 这两个按钮投的是**人身层**事件(客户补料动作被 Sumsub 复核的结果),不是交易层
 * KYT 裁决 —— 触发时这笔兑换单早已终态(REJECTED)。查证 SumsubIngestionService.dispatch
 * (Clue 3)与 kyt-webhook-types.ts 的 KYT_VERDICT_TYPES 后确认:`applicantActionReviewed`
 * 根本不在 KYT_VERDICT_TYPES 集合里,swap/deposit/withdraw 三个 webhook router 都不会
 * 认领它;ingestion 里唯一认得这个 type 的分支(Clue 3)只匹配
 * MaterialRefreshCycle.sumsubActionId(周期性材料补审,另一个域),不认识 swap 拒绝
 * 处置写在 CustomerMain.pendingActionExternalId 上的 action id。也就是说
 * CustomerRestrictionsService.clear()/加严 目前**没有任何调用方**——这两个按钮会
 * 真实投递官方形状的 webhook、真实走一遍 ingest(),但清限制/升级这件事今天不会
 * 发生。本任务按任务书要求如实投递 + 如实回报(statusAfter 不变),不在这里补建
 * 人身层 handler —— 那是超出本任务范围的缺口,已登记进最终报告。
 */
@Injectable()
export class SwapDemoScenarioService {
  constructor(
    private readonly swapService: SwapTransactionsService,
    private readonly ingestionService: SumsubIngestionService,
    private readonly auditLogsService: AuditLogsService,
    @Inject(SUMSUB_TXN_CLIENT) private readonly sumsubTxnClient: SumsubTxnClient,
  ) {}

  /**
   * 投递一次裁决:按 swap 的出账 Sumsub 交易生成官方形状报文 → prime mock 的
   * getTxn 应答 → 把 webhook 喂进真实 ingestion 链路。
   *
   * 状态去哪由 handler/workflow 决定,这里只如实回报投递前后的状态。
   */
  async runVerdict(swapId: string, buttonKey: string, actor: DemoScenarioActor) {
    const button = SWAP_VERDICT_BUTTONS[buttonKey];
    if (!button) {
      throw new BadRequestException(
        `Unknown verdict "${buttonKey}". Valid keys: ${Object.keys(SWAP_VERDICT_BUTTONS).join(', ')}`,
      );
    }
    if (!(this.sumsubTxnClient instanceof MockSumsubTxnClient)) {
      throw new BadRequestException(
        'Demo verdict runner requires SUMSUB_MOCK_MODE=true (SUMSUB_TXN_CLIENT is not the mock client)',
      );
    }
    const mockClient = this.sumsubTxnClient;

    const swap = await this.swapService.findByIdInternal(swapId);
    if (!swap) throw new NotFoundException(`Swap not found: ${swapId}`);
    const statusBefore = swap.status;

    // V7/V8:applicantActionReviewed 是人身层事件,没有 KYT 交易可挂 —— 单独分支,
    // 不铸 txnId、不 primeTxn(见类注释顶部的已知缺口说明)。
    if (button.webhookType === 'applicantActionReviewed') {
      return this.runApplicantActionScenario(swap, button, statusBefore, actor);
    }

    // 该单已过 initiateSwap 的同步提交(sumsubTxnIdOut 有值)→ 用它自己的真号;
    // 提交当时失败(罕见,见 submitSumsubTxnOut 的非致命失败设计)→ 现铸一个并 prime。
    const clientTxnId = `${swap.swapNo ?? swap.id}-OUT`;
    const txnId = swap.sumsubTxnIdOut ?? this.mintTxnId(swap, button.key);
    if (!swap.sumsubTxnIdOut) mockClient.primeSubmit(clientTxnId, txnId);

    const meta = REPORT_META[button.webhookType];
    const raw = buildTxnReport(
      {
        txnId,
        txnType: 'finance', // swap 出账腿恒为 finance,没有 travelRule(见 submitSumsubTxnOut)
        applicantId: swap.customer?.sumsubApplicantId ?? '',
        externalUserId: swap.customer?.customerNo ?? swap.ownerId,
        clientTxnId: swap.swapNo ?? swap.id,
        amount: Number(swap.fromAmount),
        currency: swap.fromAsset?.currency ?? '',
        isCrypto: swap.fromAsset?.type === 'CRYPTO',
        createdAtIso: new Date(swap.createdAt).toISOString(),
        direction: 'out',
      },
      {
        reviewStatus: meta.reviewStatus,
        reviewAnswer: button.verdict.reviewAnswer,
        action: meta.action,
        score: button.verdict.score ?? 0,
        applicantActions: button.verdict.applicantActions,
        typedTags: button.verdict.typedTags,
      },
    );

    mockClient.primeTxn(txnId, {
      txnId,
      verdict: VERDICT_OF[button.webhookType],
      reviewAnswer: button.verdict.reviewAnswer,
      riskScore: button.verdict.score ?? null,
      typedTags: button.verdict.typedTags ?? [],
      raw,
    });

    await this.ingestionService.ingest(this.buildKytWebhookPayload(swap, button, txnId), {
      isSimulated: true,
    });

    const refreshed = await this.swapService.findByIdInternal(swap.id);
    const statusAfter = refreshed?.status ?? statusBefore;

    await this.writeDemoAudit(swap, button, statusBefore, statusAfter, actor, {
      reason: `Demo verdict ${button.key} fed into swap ${swap.swapNo}`,
    });

    return {
      verdict: button.key,
      label: button.label,
      swapId: swap.id,
      swapNo: swap.swapNo,
      statusBefore,
      statusAfter,
    };
  }

  /**
   * V7/V8 分支:投一次 applicantActionReviewed。actionId 优先用这个客户当前挂起
   * 的补料动作(CustomerMain.pendingActionExternalId,由此前一次软线拒绝写入);
   * 客户没有挂起动作时仍铸一个确定性占位符,保持报文形状真实但不假装有对应记录。
   */
  private async runApplicantActionScenario(
    swap: any,
    button: SwapVerdictButton,
    statusBefore: string,
    actor: DemoScenarioActor,
  ) {
    const actionId = swap.customer?.pendingActionExternalId ?? this.mintTxnId(swap, button.key);

    await this.ingestionService.ingest(
      {
        type: button.webhookType,
        applicantId: swap.customer?.sumsubApplicantId ?? '',
        externalUserId: swap.customer?.customerNo ?? swap.ownerId,
        actionId,
        reviewResult: { reviewAnswer: button.verdict.reviewAnswer },
        correlationId: `req-${randomUUID()}`,
        createdAtMs: new Date().toISOString(),
      },
      { isSimulated: true },
    );

    const refreshed = await this.swapService.findByIdInternal(swap.id);
    const statusAfter = refreshed?.status ?? statusBefore;

    await this.writeDemoAudit(swap, button, statusBefore, statusAfter, actor, {
      reason: `Demo verdict ${button.key} fed as applicantActionReviewed (person-level; not routed to any restrictions handler today — known gap, see class comment)`,
      extraMetadata: { actionId },
    });

    return {
      verdict: button.key,
      label: button.label,
      swapId: swap.id,
      swapNo: swap.swapNo,
      statusBefore,
      statusAfter,
    };
  }

  private async writeDemoAudit(
    swap: any,
    button: SwapVerdictButton,
    statusBefore: string,
    statusAfter: string,
    actor: DemoScenarioActor,
    opts: { reason: string; extraMetadata?: Record<string, unknown> },
  ): Promise<void> {
    await this.auditLogsService.recordByActor(
      {
        action: AuditActions.SWAP_DEMO_SCENARIO_RUN,
        entityType: AuditEntityTypes.SWAP_TRANSACTION,
        entityId: swap.id,
        entityNo: swap.swapNo || undefined,
        entityOwnerType: swap.ownerType,
        entityOwnerId: swap.ownerId,
        traceId: swap.traceId || undefined,
        workflowType: AuditWorkflowTypes.SWAP,
        result: AuditResult.SUCCESS,
        reason: opts.reason,
        metadata: {
          verdict: button.key,
          webhookType: button.webhookType,
          statusBefore,
          statusAfter,
          ...opts.extraMetadata,
        },
        requestId: `SWAP_DEMO_VERDICT_${swap.swapNo ?? swap.id}_${randomUUID()}`,
        sourcePlatform: 'ADMIN_API',
      },
      {
        actorType: 'ADMIN',
        actorId: actor.actorId,
        actorNo: actor.actorNo,
        actorRole: actor.actorRole || 'ADMIN',
      },
    );
  }

  /**
   * 把 fixture 的槽位名铸成一个真实形态的 Sumsub txnId(与
   * DepositDemoScenarioService#mintTxnId 逐字同源 —— 见该方法注释的三条性质)。
   */
  private mintTxnId(swap: { swapNo: string | null; id: string; createdAt: Date | string }, slot: string): string {
    const digest = createHash('sha1').update(`${swap.swapNo ?? swap.id}:${slot}`).digest('hex');
    const ms = new Date(swap.createdAt).getTime();
    const tsHex = Math.floor(ms / 1000).toString(16).padStart(8, '0').slice(-8);
    return `${tsHex}${digest.slice(0, 16)}`;
  }

  /**
   * 按官方 Transaction Monitoring webhook 形状生成 payload。handler 只读
   * type + kytTxnId,其余字段供 sumsub_webhook_events 落库回看,并让演示报文与
   * 真实报文形状一致。
   */
  private buildKytWebhookPayload(
    swap: any,
    button: SwapVerdictButton,
    kytTxnId: string,
  ): Record<string, unknown> {
    return {
      type: button.webhookType,
      kytTxnId,
      kytDataTxnId: swap.swapNo,
      kytTxnType: 'finance',
      applicantId: swap.customer?.sumsubApplicantId ?? '',
      applicantType: 'individual',
      externalUserId: swap.customer?.customerNo ?? swap.ownerId,
      clientId: 'fiatx',
      correlationId: `req-${randomUUID()}`,
      reviewResult: {
        reviewAnswer: button.verdict.reviewAnswer,
      },
      sandboxMode: true,
      createdAtMs: new Date().toISOString(),
    };
  }
}
