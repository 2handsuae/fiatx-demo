import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DepositTransactionsService } from '../trading/deposit-transactions/deposit-transactions.service';
import { SUMSUB_TXN_CLIENT, SumsubTxnClient } from '../sumsub-shared/sumsub-txn-client.interface';
import { MockSumsubTxnClient } from '../sumsub-shared/sumsub-txn-client.mock';
import { DEPOSIT_VERDICT_BUTTONS, DepositVerdictButton } from './fixtures/verdict-buttons';
import { buildTxnReport } from '../sumsub-shared/txn-report.builder';
import { DemoScenarioActor, VERDICT_OF, mintDemoTxnId } from '../sumsub-shared/demo-scenario.base';
import { SumsubIngestionService } from '../sumsub-ingestion/sumsub-ingestion.service';
import { AuditLogsService } from '../audit-logging/audit-logs.service';
import { AuditActions, AuditEntityTypes } from '../audit-logging/constants/audit-actions.constant';
import { AuditOutcome, AuditCategory, AuditSubjectRole } from '../audit-logging/dto/audit-log.dto';

/**
 * Task 4(计划「充值仿真裁决按钮」):把此前 8 个多步场景剧本改成 9 个**单步**裁决按钮。
 * 驱动**真实** ingestionService.ingest() 走完整的前置分流→router→handler→workflow 链路,
 * 不碰 fixture/workflow/handler 本身逻辑。
 *
 * 只在 SUMSUB_MOCK_MODE=true 时才会被实际使用 —— AdminDepositDemoController 只在该模式下
 * 才被注册(deposit-sumsub.module.ts),所以这里注入到的 SUMSUB_TXN_CLIENT 理应总是
 * MockSumsubTxnClient;仍做一次 instanceof 兜底,防止误配置下的静默错误。
 */
@Injectable()
export class DepositDemoScenarioService {
  constructor(
    private readonly depositService: DepositTransactionsService,
    private readonly ingestionService: SumsubIngestionService,
    private readonly auditLogsService: AuditLogsService,
    @Inject(SUMSUB_TXN_CLIENT) private readonly sumsubTxnClient: SumsubTxnClient,
  ) {}

  /**
   * 投递一次裁决:按 deposit 当前的 sumsubTxnType 生成官方形状报文 → prime mock 的
   * getTxn 应答 → 把 webhook 喂进真实 ingestion 链路。
   *
   * 与旧 runScenario 的区别:不再有"剧本/预期终态"概念。状态去哪由 handler 决定,
   * 这里只如实回报投递前后的状态,不做 matchedExpectation 判定。
   */
  async runVerdict(depositId: string, buttonKey: string, actor: DemoScenarioActor) {
    const button = DEPOSIT_VERDICT_BUTTONS[buttonKey];
    if (!button) {
      throw new BadRequestException(
        `Unknown verdict "${buttonKey}". Valid keys: ${Object.keys(DEPOSIT_VERDICT_BUTTONS).join(', ')}`,
      );
    }
    if (!(this.sumsubTxnClient instanceof MockSumsubTxnClient)) {
      throw new BadRequestException(
        'Demo verdict runner requires SUMSUB_MOCK_MODE=true (SUMSUB_TXN_CLIENT is not the mock client)',
      );
    }
    const mockClient = this.sumsubTxnClient;

    const deposit = await this.depositService.findOne(depositId);
    const statusBefore = deposit.status;

    // 该单已过 L1 → 用它自己的真号;还没过 → 现铸一个并 prime,等 L1 取用。
    const txnId = deposit.sumsubTxnId ?? mintDemoTxnId(deposit.depositNo, deposit.createdAt, button.key);
    if (!deposit.sumsubTxnId) mockClient.primeSubmit(deposit.depositNo, txnId);

    const txnType = (deposit.sumsubTxnType as 'finance' | 'travelRule') ?? 'finance';
    const isCrypto = deposit.asset?.type === 'CRYPTO';

    const raw = buildTxnReport(
      {
        txnId,
        txnType,
        applicantId: deposit.customer?.sumsubApplicantId ?? '',
        externalUserId: deposit.customer?.customerNo ?? deposit.ownerId,
        clientTxnId: deposit.depositNo,
        amount: Number(deposit.amount),
        currency: deposit.asset?.currency ?? '',
        isCrypto,
        createdAtIso: new Date(deposit.createdAt).toISOString(),
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
      this.buildWebhookPayload(deposit, button, txnId, txnType),
      { isSimulated: true },
    );

    const refreshed = await this.depositService.findOne(deposit.id);

    await this.auditLogsService.recordByActor(
      {
        action: AuditActions.DEPOSIT_DEMO_SCENARIO_RUN,
        actionDomain: 'DEPOSIT',
        category: AuditCategory.BUSINESS,
        primarySubjectType: AuditEntityTypes.DEPOSIT_TRANSACTION,
        primarySubjectNo: deposit.depositNo,
        ownerCustomerNo: deposit.customer?.customerNo,
        correlationId: deposit.correlationId ?? undefined,
        subjects: [
          { subjectType: AuditEntityTypes.DEPOSIT_TRANSACTION, subjectNo: deposit.depositNo, subjectRole: AuditSubjectRole.PRIMARY },
          ...(deposit.customer?.customerNo
            ? [{ subjectType: 'CUSTOMER', subjectNo: deposit.customer.customerNo, subjectRole: AuditSubjectRole.OWNER }]
            : []),
        ],
        traceId: deposit.traceId || undefined,
        outcome: AuditOutcome.SUCCESS,
        reason: `Demo verdict ${button.key} fed into deposit ${deposit.depositNo}`,
        metadata: {
          verdict: button.key,
          webhookType: button.webhookType,
          txnType,
          statusBefore,
          statusAfter: refreshed.status,
        },
        requestId: `DEPOSIT_DEMO_VERDICT_${deposit.depositNo}_${randomUUID()}`,
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
      depositId: deposit.id,
      depositNo: deposit.depositNo,
      txnType,
      statusBefore,
      statusAfter: refreshed.status,
    };
  }

  /**
   * 按官方 Transaction Monitoring webhook 形状生成 payload
   * (2026-07-31 查证 docs.sumsub.com/reference/transaction-monitoring-webhooks)。
   * handler 只读 type + kytTxnId,其余字段供 sumsub_webhook_events 落库回看,
   * 并让演示报文与真实报文形状一致。
   */
  private buildWebhookPayload(
    deposit: any,
    button: DepositVerdictButton,
    kytTxnId: string,
    txnType: 'finance' | 'travelRule',
  ): Record<string, unknown> {
    return {
      type: button.webhookType,
      kytTxnId,
      kytDataTxnId: deposit.depositNo,
      kytTxnType: txnType,
      applicantId: deposit.customer?.sumsubApplicantId ?? '',
      applicantType: 'individual',
      externalUserId: deposit.customer?.customerNo ?? deposit.ownerId,
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
