import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { WithdrawTransactionsService } from '../trading/withdraw-transactions/withdraw-transactions.service';
import { SUMSUB_TXN_CLIENT, SumsubTxnClient } from '../sumsub-shared/sumsub-txn-client.interface';
import { MockSumsubTxnClient } from '../sumsub-shared/sumsub-txn-client.mock';
import { WITHDRAW_VERDICT_BUTTONS, WithdrawVerdictButton } from './fixtures/verdict-buttons';
import { buildTxnReport } from '../sumsub-shared/txn-report.builder';
import { DemoScenarioActor, VERDICT_OF, mintDemoTxnId } from '../sumsub-shared/demo-scenario.base';
import { SumsubIngestionService } from '../sumsub-ingestion/sumsub-ingestion.service';
import { AuditLogsService } from '../audit-logging/audit-logs.service';
import {
  AuditActions,
  AuditEntityTypes,
  AuditWorkflowTypes,
} from '../audit-logging/constants/audit-actions.constant';
import { AuditOutcome, AuditCategory, AuditSubjectRole } from '../audit-logging/dto/audit-log.dto';

/**
 * 提现域场景仿真器 —— mirror of DepositDemoScenarioService(deliberate fork,
 * Task 10)。把 11 个**单步**裁决按钮驱动**真实** ingestionService.ingest() 走完整
 * 的前置分流→router→handler→workflow 链路,不碰 fixture/workflow/handler 本身逻辑。
 *
 * 只在 SUMSUB_MOCK_MODE=true 时才会被实际使用 —— AdminWithdrawDemoController 只在
 * 该模式下才被注册(withdraw-sumsub.module.ts),所以这里注入到的 SUMSUB_TXN_CLIENT
 * 理应总是 MockSumsubTxnClient;仍做一次 instanceof 兜底,防止误配置下的静默错误。
 */
@Injectable()
export class WithdrawDemoScenarioService {
  constructor(
    private readonly withdrawService: WithdrawTransactionsService,
    private readonly ingestionService: SumsubIngestionService,
    private readonly auditLogsService: AuditLogsService,
    @Inject(SUMSUB_TXN_CLIENT) private readonly sumsubTxnClient: SumsubTxnClient,
  ) {}

  /**
   * 投递一次裁决:按 withdrawal 当前的 sumsubTxnType 生成官方形状报文 → prime mock
   * 的 getTxn 应答 → 把 webhook 喂进真实 ingestion 链路。
   *
   * 状态去哪由 handler/workflow 决定,这里只如实回报投递前后的状态。
   */
  async runVerdict(withdrawId: string, buttonKey: string, actor: DemoScenarioActor) {
    const button = WITHDRAW_VERDICT_BUTTONS[buttonKey];
    if (!button) {
      throw new BadRequestException(
        `Unknown verdict "${buttonKey}". Valid keys: ${Object.keys(WITHDRAW_VERDICT_BUTTONS).join(', ')}`,
      );
    }
    if (!(this.sumsubTxnClient instanceof MockSumsubTxnClient)) {
      throw new BadRequestException(
        'Demo verdict runner requires SUMSUB_MOCK_MODE=true (SUMSUB_TXN_CLIENT is not the mock client)',
      );
    }
    const mockClient = this.sumsubTxnClient;

    const withdraw = await this.withdrawService.findOneInternal(withdrawId);
    const statusBefore = withdraw.status;

    // 该单已过提交 → 用它自己的真号;还没过 → 现铸一个并 prime,等提交时取用。
    const txnId = withdraw.sumsubTxnId ?? mintDemoTxnId(withdraw.withdrawNo, withdraw.createdAt, button.key);
    if (!withdraw.sumsubTxnId) mockClient.primeSubmit(withdraw.withdrawNo, txnId);

    const txnType = (withdraw.sumsubTxnType as 'finance' | 'travelRule') ?? 'finance';
    const isCrypto = withdraw.asset?.type === 'CRYPTO';

    const raw = buildTxnReport(
      {
        txnId,
        txnType,
        applicantId: withdraw.customer?.sumsubApplicantId ?? '',
        externalUserId: withdraw.customer?.customerNo ?? withdraw.ownerId,
        clientTxnId: withdraw.withdrawNo,
        amount: Number(withdraw.amount),
        currency: withdraw.asset?.currency ?? '',
        isCrypto,
        createdAtIso: new Date(withdraw.createdAt).toISOString(),
        direction: 'out',
      },
      button.verdict,
    );

    mockClient.primeTxn(txnId, {
      txnId,
      verdict: VERDICT_OF[button.webhookType],
      reviewAnswer: button.verdict.reviewAnswer,
      riskScore: button.verdict.score,
      typedTags: button.verdict.typedTags ?? [],
      raw,
    });

    await this.ingestionService.ingest(
      this.buildWebhookPayload(withdraw, button, txnId, txnType),
      { isSimulated: true },
    );

    const refreshed = await this.withdrawService.findOneInternal(withdraw.id);

    await this.auditLogsService.recordByActor(
      {
        action: AuditActions.WITHDRAW_DEMO_SCENARIO_RUN,
        actionDomain: 'WITHDRAW',
        category: AuditCategory.BUSINESS,
        primarySubjectType: AuditEntityTypes.WITHDRAW_TRANSACTION,
        primarySubjectNo: withdraw.withdrawNo,
        ownerCustomerNo: withdraw.customer?.customerNo,
        correlationId: withdraw.correlationId ?? undefined,
        subjects: [
          { subjectType: AuditEntityTypes.WITHDRAW_TRANSACTION, subjectNo: withdraw.withdrawNo, subjectRole: AuditSubjectRole.PRIMARY },
          ...(withdraw.customer?.customerNo
            ? [{ subjectType: 'CUSTOMER', subjectNo: withdraw.customer.customerNo, subjectRole: AuditSubjectRole.OWNER }]
            : []),
        ],
        traceId: withdraw.traceId || undefined,
        outcome: AuditOutcome.SUCCESS,
        reason: `Demo verdict ${button.key} fed into withdrawal ${withdraw.withdrawNo}`,
        metadata: {
          verdict: button.key,
          webhookType: button.webhookType,
          txnType,
          statusBefore,
          statusAfter: refreshed.status,
        },
        requestId: `WITHDRAW_DEMO_VERDICT_${withdraw.withdrawNo}_${randomUUID()}`,
        sourcePlatform: 'SCRIPT',
      },
      {
        actorType: 'ADMIN',
        actorNo: actor.actorNo || 'UNKNOWN',
        actorDisplayName: actor.actorNo || 'UNKNOWN',
        actorRolesAtTime: [actor.actorRole || 'ADMIN'],
      },
    );

    return {
      verdict: button.key,
      label: button.label,
      withdrawId: withdraw.id,
      withdrawNo: withdraw.withdrawNo,
      txnType,
      statusBefore,
      statusAfter: refreshed.status,
    };
  }

  /**
   * 按官方 Transaction Monitoring webhook 形状生成 payload。handler 只读
   * type + kytTxnId,其余字段供 sumsub_webhook_events 落库回看,并让演示报文与
   * 真实报文形状一致。
   */
  private buildWebhookPayload(
    withdraw: any,
    button: WithdrawVerdictButton,
    kytTxnId: string,
    txnType: 'finance' | 'travelRule',
  ): Record<string, unknown> {
    return {
      type: button.webhookType,
      kytTxnId,
      kytDataTxnId: withdraw.withdrawNo,
      kytTxnType: txnType,
      applicantId: withdraw.customer?.sumsubApplicantId ?? '',
      applicantType: 'individual',
      externalUserId: withdraw.customer?.customerNo ?? withdraw.ownerId,
      clientId: 'fiatx',
      correlationId: `req-${randomUUID()}`,
      reviewStatus: button.verdict.reviewStatus,
      reviewResult: {
        reviewAnswer: button.verdict.reviewAnswer,
        ...(button.verdict.reviewRejectType && { reviewRejectType: button.verdict.reviewRejectType }),
      },
      sandboxMode: true,
      createdAtMs: new Date().toISOString(),
    };
  }
}
